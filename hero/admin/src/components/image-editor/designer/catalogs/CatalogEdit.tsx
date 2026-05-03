'use client'
/**
 * CatalogEdit — workflow Découpe SAM (refonte multi-select Phase 6b refonte).
 *
 * 3 phases dérivées de l'état EditorStateContext :
 *  - 'drawing'  : pas encore de SAM (wandMasks vide). Affiche instruction
 *                 "Trace une zone sur l'image" avec icône pulsante.
 *  - 'computing': SAM en cours (driven par BakeProgressModal full-screen via
 *                 setBakeStatus). Le catalog peut afficher un placeholder léger.
 *  - 'results'  : wandMasks populated. Affiche grid des cuts avec checkboxes
 *                 + boutons d'action (Extraire / Supprimer / [À venir]).
 *
 * Comportement clé :
 *  - Auto-select TOUTES les masks dès qu'elles arrivent (selectedWandUrls = all)
 *  - Sync bidirectionnel canvas↔grid via shared state (toggleWandSelection)
 *  - Click "Recommencer" → clearWand + nouveau drag possible
 *
 * Cf. designer-decoupe-workflow-mockup.html pour le visuel.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Scissors, Package, Trash2, User, Briefcase, Repeat2, RotateCcw, Check, X as XIcon, Sparkles, Loader2 } from 'lucide-react'
import CatalogShell from './CatalogShell'
import { useEditorState } from '../../EditorStateContext'
import { useAICutCommandOptional } from '../../AICutCommandContext'
import {
  extractZonesFromRect,
  combineMasksMulti,
  extractZoneAsTransparentFullSize,
  buildLivePreviewBlobUrl,
} from '../../helpers/extractZones'
import { brushStrokesToMaskUrl } from '../../helpers/brushToMask'
import { computeFloodFill, uploadMaskFromData, preloadImageData } from '../../helpers/magicWand'
import { grabCutToMaskUrl, loadOpenCV, isOpenCVLoaded } from '../../helpers/grabCut'
import { samPromptToMaskUrl } from '../../helpers/samPrompt'
import { lassoPolygonToMaskUrl } from '../../helpers/lassoToMask'
import { CHECKPOINTS } from '@/lib/comfyui'

interface CatalogEditProps {
  onClose: () => void
  storagePathPrefix: string
}

export default function CatalogEdit({ onClose, storagePathPrefix }: CatalogEditProps) {
  const {
    imageUrl, setImageUrl,
    cutSelection, cutDragging, setCutSelection, setCutMode,
    cutTool,
    brushStrokes, clearBrushStrokes,
    wandMasks, selectedWandUrls,
    setWandMasks, patchWandMaskUrl, setSelectedWandUrls, clearWand,
    pushWandMask,
    pixelPick, setPixelPick,
    lassoDraft, setLassoDraft,
    cutResultUrl, clearCutResult,
    setBakeStatus,
    addLayer,
    selectedDetectionId,
  } = useEditorState()

  /** Tolérance Magic Wand (1-100). 15 = défaut prudent qui marche bien sur
   *  illustrations cartoon avec aplats colorés. 30 était trop permissif
   *  sur des images à dominante de teinte uniforme (ex: taverne tons bois
   *  → flood fill remplit toute l'image). Le user peut toujours monter via
   *  le slider si la sélection initiale est trop petite. */
  const [magicWandTolerance, setMagicWandTolerance] = useState(15)

  /** Granularité de découpage SAM (par défaut 'large' = gros objets uniquement,
   *  10-20 zones max au lieu des 50+ avec 'coarse'). User peut affiner via
   *  le toggle Gros/Moyen/Fin dans le panneau de confirmation. */
  const [samGranularity, setSamGranularity] = useState<'large' | 'coarse' | 'fine'>('large')

  /** Stack des masks Magic Wand pour permettre Ctrl+Z / "Annuler dernière".
   *  À chaque ajout, on push l'URL. Annuler = pop + remove from wandMasks. */
  const magicMaskStackRef = useRef<string[]>([])

  /** Token de requête lasso. Incrémenté seulement au switch d'outil — les
   *  uploads en vol comparent à ce token et s'annulent si périmés. */
  const lassoReqRef = useRef(0)

  /** Live preview blob URL — affichée dans la grosse vignette du panel pour
   *  montrer "ce qui serait extrait si on cliquait Extraire maintenant".
   *  Recalculée debounced à chaque changement de sélection / cutResultUrl /
   *  cutTool. La caller (cet effet) revoke l'ancienne URL avant de la
   *  remplacer pour éviter les fuites mémoire. */
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'extract' | 'erase' | null>(null)
  /** RequestId : cancel les SAM stale si le user trace un nouveau rect */
  const requestIdRef = useRef(0)
  /** Track le dernier wandMasks vu pour auto-select au transition empty→populated */
  const prevWandMasksLenRef = useRef(0)

  // ── Active cutMode pendant que ce catalog est mounted ────────────────
  useEffect(() => {
    setCutMode(true)
    return () => setCutMode(false)
  }, [setCutMode])

  // ── Lance SAM uniquement à la confirmation explicite de l'utilisateur ──
  async function launchSam() {
    if (!cutSelection || !imageUrl || cutDragging) return
    const w01 = cutSelection.x2 - cutSelection.x1
    const h01 = cutSelection.y2 - cutSelection.y1
    if (w01 < 0.03 || h01 < 0.03) return

    const myReq = ++requestIdRef.current
    setError(null)
    setBakeStatus({
      startedAt: Date.now(),
      kind: 'sam_cut',
      phase: 'Détection des objets dans la zone…',
      estimatedTotalSec: 30,
    })

    try {
      const zones = await extractZonesFromRect({
        imageUrl,
        rect: cutSelection,
        storagePathPrefix,
        granularity: samGranularity,
      })
      if (requestIdRef.current !== myReq) return
      const masks = zones.map(z => ({ url: z.maskUrl, index: z.index }))
      setWandMasks(masks)
      // ⚡ Auto-select TOUTES les masks détectées (différence-clé vs legacy)
      setSelectedWandUrls(masks.map(m => m.url))
    } catch (err) {
      if (requestIdRef.current === myReq) {
        setError(err instanceof Error ? err.message : 'SAM a échoué')
      }
    } finally {
      if (requestIdRef.current === myReq) {
        setBakeStatus(null)
      }
    }
  }

  // ── GrabCut : extraction d'1 objet via OpenCV.js (lazy-loadé 1ère fois) ──
  async function launchGrabCut() {
    if (!cutSelection || !imageUrl || cutDragging) return
    const w01 = cutSelection.x2 - cutSelection.x1
    const h01 = cutSelection.y2 - cutSelection.y1
    if (w01 < 0.03 || h01 < 0.03) return

    const myReq = ++requestIdRef.current
    setError(null)
    const wasOpenCVLoaded = isOpenCVLoaded()
    setBakeStatus({
      startedAt: Date.now(),
      kind: 'grabcut',
      phase: wasOpenCVLoaded
        ? 'GrabCut analyse l\'objet (CPU)…'
        : 'Chargement OpenCV.js (10 MB)…',
      estimatedTotalSec: wasOpenCVLoaded ? 3 : 8,
    })

    try {
      // Si pas encore loadé, le 1er appel à grabCutToMaskUrl déclenche le download
      if (!wasOpenCVLoaded) {
        await loadOpenCV()
        if (requestIdRef.current !== myReq) return
        setBakeStatus({
          startedAt: Date.now(),
          kind: 'grabcut',
          phase: 'GrabCut analyse l\'objet (CPU)…',
          estimatedTotalSec: 3,
        })
      }

      const result = await grabCutToMaskUrl({
        imageUrl,
        rect: cutSelection,
        storagePathPrefix,
        iterations: 5,
      })
      if (requestIdRef.current !== myReq) return
      if (!result) {
        setError('GrabCut n\'a rien trouvé dans cette zone.')
        return
      }

      // Ajoute aux wandMasks (avec contours pour marching ants)
      const newMask = {
        url: result.maskUrl,
        index: wandMasks.length,
        contours: result.contours,
      }
      setWandMasks([...wandMasks, newMask])
      setSelectedWandUrls([...selectedWandUrls, result.maskUrl])
    } catch (err) {
      if (requestIdRef.current === myReq) {
        setError(err instanceof Error ? err.message : 'GrabCut a échoué')
      }
    } finally {
      if (requestIdRef.current === myReq) {
        setBakeStatus(null)
      }
    }
  }

  function cancelPendingRect() {
    setCutSelection(null)
    setError(null)
  }

  // ── Magic Wand : Annuler la dernière sélection (V1 simple, pas de redo) ──
  /** True quand le tool actif fonctionne par clicks-points avec stack d'undo
   *  (Magic Wand + SAM Prompt-point). Drive Ctrl+Z et le bouton "Annuler dernière". */
  const isClickPointTool = cutTool === 'magic_wand' || cutTool === 'sam_prompt'

  function undoLastMagicMask() {
    if (!isClickPointTool) return
    const lastUrl = magicMaskStackRef.current.pop()
    if (!lastUrl) {
      // Stack vide → fallback : retire le dernier mask quel qu'il soit
      if (wandMasks.length === 0) return
      const lastMask = wandMasks[wandMasks.length - 1]
      setWandMasks(wandMasks.slice(0, -1))
      setSelectedWandUrls(selectedWandUrls.filter(u => u !== lastMask.url))
      return
    }
    setWandMasks(wandMasks.filter(m => m.url !== lastUrl))
    setSelectedWandUrls(selectedWandUrls.filter(u => u !== lastUrl))
    setError(null)
  }

  // Ctrl+Z global pour annuler la dernière sélection (Magic Wand + SAM Prompt)
  // Capture mode pour éviter de voler le Ctrl+Z global du Designer.
  useEffect(() => {
    if (!isClickPointTool) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const inField = target.matches('input, textarea, [contenteditable="true"]')
      if (inField) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        undoLastMagicMask()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClickPointTool, wandMasks, selectedWandUrls])

  // Détecte la transition pour resync visuel
  useEffect(() => {
    prevWandMasksLenRef.current = wandMasks.length
  }, [wandMasks.length])

  // ── Magic Wand : pré-charge l'image dans le cache imageData dès l'entrée ──
  // En mode Magic Wand, ça permet au 1er click d'être quasi-instant (sans
  // attendre 200-500ms de re-load image).
  useEffect(() => {
    if (cutTool !== 'magic_wand' || !imageUrl) return
    void preloadImageData(imageUrl).catch(err => {
      console.warn('[magic-wand] preload failed:', err)
    })
  }, [cutTool, imageUrl])

  // ── Magic Wand : écoute pixelPick et lance le floodFill 2-étapes ──────
  // 1. computeFloodFill (instant ~30ms si imageData en cache) → contours visibles
  //    immédiatement via marching ants SVG dans CanvasOverlay
  // 2. uploadMaskFromData (async ~500ms-2s) en arrière-plan → URL stockée
  // Le mask est dans wandMasks dès l'étape 1, l'URL est patché à l'étape 2.
  useEffect(() => {
    if (cutTool !== 'magic_wand') return
    if (!pixelPick || !imageUrl) return

    let cancelled = false
    async function runMagicWand() {
      try {
        // ── ÉTAPE 1 : compute local (instant) ───────────────────────────
        const compute = await computeFloodFill({
          imageUrl: imageUrl!,
          x: pixelPick!.x,
          y: pixelPick!.y,
          threshold: magicWandTolerance,
        })
        if (cancelled) return
        if (!compute) {
          setError('Aucune zone détectée à cet endroit.')
          return
        }

        // Ajoute le mask AVEC contours mais URL vide. CanvasOverlay rend
        // les marching ants depuis les contours immédiatement.
        const newIndex = wandMasks.length
        const placeholderUrl = `pending:${Date.now()}_${newIndex}`
        const newMask = {
          url: placeholderUrl,
          index: newIndex,
          contours: compute.contours,
        }
        setWandMasks([...wandMasks, newMask])
        setSelectedWandUrls([...selectedWandUrls, placeholderUrl])
        // Push dans le stack pour Ctrl+Z (référence par placeholderUrl, sera
        // patché à l'URL réelle après upload).
        magicMaskStackRef.current.push(placeholderUrl)

        // ── ÉTAPE 2 : upload PNG en background ──────────────────────────
        try {
          const realUrl = await uploadMaskFromData(compute.rawMask, storagePathPrefix)
          if (cancelled) return
          // Patch atomique URL placeholder → URL réelle (action reducer dédiée
          // pour éviter le stale-closure des function updaters).
          patchWandMaskUrl(placeholderUrl, realUrl)
          // Patch le stack aussi
          magicMaskStackRef.current = magicMaskStackRef.current.map(u =>
            u === placeholderUrl ? realUrl : u
          )
        } catch (uploadErr) {
          if (cancelled) return
          // L'upload a échoué → retire le mask (sinon impossible d'agir dessus).
          // On utilise un getter via wandMasks (peut être stale, mais le filter
          // côté reducer via setWandMasks(array) est OK car URL placeholder unique).
          // Pour la robustesse on dispatch un setWandMasks avec un filter sur la
          // valeur courante du state via getCurrentMasks ref. Simplest = setError
          // + ne pas patcher (le placeholder reste, mais ne fait rien de mal).
          setError(uploadErr instanceof Error ? uploadErr.message : 'Upload mask échoué')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Magic Wand a échoué')
        }
      } finally {
        // On consomme le pick (clear) pour permettre un re-click au même endroit.
        if (!cancelled) setPixelPick(null)
      }
    }
    void runMagicWand()
    return () => { cancelled = true }
    // pixelPick.ts dans deps : permet 2 clicks au même endroit (re-trigger)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelPick?.ts, cutTool])

  // ── Lasso : écoute lassoDraft.closed et convertit en mask ──────────────
  // Quand l'utilisateur ferme le polygone (clic-near-start / dblclic poly,
  // mouseup / retour-au-départ free), on rasterise et upload, puis on ajoute
  // aux wandMasks avec contours.
  //
  // ⚠ Cancellation : on N'UTILISE PAS le cleanup useEffect pour annuler. Notre
  // propre `setLassoDraft(null)` (clear visuel immédiat) re-déclencherait
  // l'effet, et le cleanup mettrait `cancelled = true` AVANT que l'upload se
  // termine → la mask serait jetée. Place : un ref incrémenté seulement quand
  // le cutTool change (= vrai "switch away from lasso").
  useEffect(() => {
    if (cutTool !== 'lasso_poly' && cutTool !== 'lasso_free') return
    if (!lassoDraft || !lassoDraft.closed || !imageUrl) return
    if (lassoDraft.points.length < 3) {
      setLassoDraft(null)
      return
    }

    const myReq = lassoReqRef.current
    const points = lassoDraft.points
    // ⚠ On NE clear PAS lassoDraft tout de suite. Le polygone closed reste
    // affiché (en marching ants via la classe dz-marching-ants-path) pendant
    // l'upload (~500 ms). Une fois la mask poussée dans wandMasks, on clear
    // le draft → la marching-ants raster prend le relais (transition invisible).
    void (async () => {
      try {
        const result = await lassoPolygonToMaskUrl({
          imageUrl: imageUrl!,
          points,
          storagePathPrefix,
        })
        if (lassoReqRef.current !== myReq || !result) {
          setLassoDraft(null)
          return
        }
        pushWandMask({
          url: result.maskUrl,
          contours: result.contours,
        })
        magicMaskStackRef.current.push(result.maskUrl)
        // Maintenant que la mask est dans wandMasks, on peut clear le draft —
        // l'utilisateur verra immédiatement la mask "officielle" à la place.
        setLassoDraft(null)
      } catch (err) {
        setLassoDraft(null)
        if (lassoReqRef.current === myReq) {
          setError(err instanceof Error ? err.message : 'Lasso a échoué')
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lassoDraft?.closed, cutTool])

  // Invalide les requêtes lasso en vol à chaque switch d'outil
  useEffect(() => {
    lassoReqRef.current++
  }, [cutTool])

  // ── Live preview : recalcule la vignette panel à chaque changement de
  // sélection/résultat/outil. Debounced 250ms pour éviter de spammer le canvas
  // pipeline pendant qu'on clique vite plusieurs masks. Tout en mémoire (no
  // upload) → instantané après le 1er load des masks (browser cache HTTP).
  useEffect(() => {
    if (!imageUrl) {
      setLivePreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      return
    }
    // Preview = TOUTES les sélections (wand + brush), indépendant du tool
    // actif. Le cutTool ne sert qu'à driver le curseur/comportement courant,
    // pas à filtrer ce qui est inclus dans la découpe.
    const masksForPreview = selectedWandUrls.length > 0
      ? selectedWandUrls
      : wandMasks.map(m => m.url)
    const strokesForPreview = brushStrokes

    if (!cutResultUrl && masksForPreview.length === 0 && strokesForPreview.length === 0) {
      setLivePreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      buildLivePreviewBlobUrl({
        imageUrl,
        baseExtractedUrl: cutResultUrl,
        selectedMaskUrls: masksForPreview,
        brushStrokes: strokesForPreview,
      })
        .then(url => {
          if (cancelled) {
            if (url) URL.revokeObjectURL(url)
            return
          }
          setLivePreviewUrl(prev => {
            if (prev) URL.revokeObjectURL(prev)
            return url
          })
        })
        .catch(err => {
          if (!cancelled) console.warn('[live-preview]', err)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, cutResultUrl, selectedWandUrls, wandMasks, brushStrokes])

  // Cleanup blob URL au unmount
  useEffect(() => {
    return () => {
      if (livePreviewUrl) URL.revokeObjectURL(livePreviewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── SAM Prompt-point : écoute pixelPick et appelle l'API SAM 2 ─────────
  // Différent de Magic Wand : pas de compute local, appel API ComfyUI ~1-2s.
  // BakeProgressModal pendant le call (pas de feedback instantané possible).
  useEffect(() => {
    if (cutTool !== 'sam_prompt') return
    if (!pixelPick || !imageUrl) return

    let cancelled = false
    const myReq = ++requestIdRef.current

    async function runSamPrompt() {
      setError(null)
      setBakeStatus({
        startedAt: Date.now(),
        kind: 'sam_cut',
        phase: 'SAM analyse l\'objet pointé…',
        estimatedTotalSec: 3,
      })
      try {
        const result = await samPromptToMaskUrl({
          imageUrl: imageUrl!,
          x: pixelPick!.x,
          y: pixelPick!.y,
          storagePathPrefix,
        })
        if (cancelled || requestIdRef.current !== myReq) return
        if (!result) {
          setError('SAM n\'a rien trouvé à cet endroit.')
          return
        }
        const newMask = {
          url: result.maskUrl,
          index: wandMasks.length,
          contours: result.contours,
        }
        setWandMasks([...wandMasks, newMask])
        setSelectedWandUrls([...selectedWandUrls, result.maskUrl])
        magicMaskStackRef.current.push(result.maskUrl)
      } catch (err) {
        if (!cancelled && requestIdRef.current === myReq) {
          setError(err instanceof Error ? err.message : 'SAM Prompt a échoué')
        }
      } finally {
        if (!cancelled && requestIdRef.current === myReq) {
          setBakeStatus(null)
          setPixelPick(null)
        }
      }
    }
    void runSamPrompt()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelPick?.ts, cutTool])

  // ── Phase courante (dérivée de l'état) ──────────────────────────────
  // - 'results'         : SAM done, masks à afficher
  // - 'pending-confirm' : rectangle tracé (drag fini), attend confirmation user
  // - 'drawing'         : pas encore de rectangle ou drag en cours
  const hasValidRect = !!cutSelection
    && !cutDragging
    && (cutSelection.x2 - cutSelection.x1) >= 0.03
    && (cutSelection.y2 - cutSelection.y1) >= 0.03

  const phase: 'drawing' | 'pending-confirm' | 'results' =
    wandMasks.length > 0 ? 'results'
    : hasValidRect      ? 'pending-confirm'
    :                     'drawing'
  const allSelected = selectedWandUrls.length === wandMasks.length && wandMasks.length > 0
  const noneSelected = selectedWandUrls.length === 0

  function toggleAll() {
    if (allSelected) setSelectedWandUrls([])
    else setSelectedWandUrls(wandMasks.map(m => m.url))
  }

  function handleRestart() {
    clearWand()
    setError(null)
  }

  // ── Actions multi-select ──────────────────────────────────────────────

  /** Extraire chaque mask sélectionné comme calque transparent. */
  async function runMultiExtract() {
    if (!imageUrl || selectedWandUrls.length === 0 || busy) return
    setError(null); setBusy('extract')
    try {
      // Pour brush : on n'a qu'un seul mask synthétisé depuis brushStrokes.
      // Pour wand : N masks individuels.
      const urls = cutTool === 'brush'
        ? [await brushStrokesToMaskUrl(brushStrokes, imageUrl, storagePathPrefix)]
        : selectedWandUrls

      let count = 0
      for (const maskUrl of urls) {
        if (!maskUrl) continue
        const extractedUrl = await extractZoneAsTransparentFullSize(
          imageUrl, maskUrl, storagePathPrefix,
        )
        addLayer({
          name: `Découpe ${count + 1}`,
          type: 'image',
          composition: undefined,
          media_url: extractedUrl,
          baked_url: extractedUrl,
          visible: true,
          opacity: 1,
          blend: 'normal',
          activeView: 'animation',
        })
        count++
      }
      // Reset pour permettre une nouvelle découpe
      clearWand()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  /** Supprimer (Inpaint) : combine tous les masks sélectionnés en 1 puis 1 inpaint. */
  async function runMultiErase() {
    if (!imageUrl || selectedWandUrls.length === 0 || busy) return
    setError(null); setBusy('erase')
    try {
      // Combine tous les masks en un seul (union pixel) pour 1 seul inpaint
      const combinedMaskUrl = cutTool === 'brush'
        ? await brushStrokesToMaskUrl(brushStrokes, imageUrl, storagePathPrefix)
        : await combineMasksMulti(selectedWandUrls, storagePathPrefix)
      if (!combinedMaskUrl) throw new Error('Aucun masque à supprimer')

      // Description du contexte via Claude Vision
      const descRes = await fetch('/api/editor/describe-inpaint-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      })
      const descData = await descRes.json() as { prompt?: string; error?: string }
      if (!descRes.ok || !descData.prompt) {
        throw new Error(descData.error ?? 'Analyse du contexte échouée')
      }

      // SDXL Inpaint
      const defaultCheckpoint = CHECKPOINTS.find(c => c.key === 'juggernaut')?.filename
        ?? CHECKPOINTS[0].filename
      const res = await fetch('/api/comfyui/inpaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          mask_url: combinedMaskUrl,
          checkpoint: defaultCheckpoint,
          prompt_positive: descData.prompt,
          storage_path: `${storagePathPrefix}_inpaint_${Date.now()}`,
          style_reference_weight: 0.6,
        }),
      })
      const d = await res.json() as { image_url?: string; error?: string }
      if (!res.ok) throw new Error(d.error || `Erreur ${res.status}`)
      if (!d.image_url) throw new Error('Pas d\'URL en retour')

      setImageUrl(d.image_url)
      clearWand()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <CatalogShell
      title={<><Scissors size={13} style={{ marginRight: 6 }} />Découpe</>}
      onClose={onClose}
      showSearch={false}
    >
      {/* AI Cut Command — pré-validation de la découpe générée par IA depuis
       * la commande naturelle (Ctrl+K). Apparaît en haut du panel quand le
       * pipeline NLU+Grounded-SAM est en cours ou a un résultat à valider. */}
      <AICutPanel imageUrl={imageUrl} />

      {/* Découpe composite — UNE seule vignette qui s'enrichit à chaque clic
       * "Extraire". Le bouton "Effacer les sélections" vide les marching ants
       * du canvas (mais conserve la vignette composite). Le trash rouge vide
       * le composite (mais garde les sélections actives). */}
      {(cutResultUrl || livePreviewUrl || wandMasks.length > 0 || brushStrokes.length > 0) && (
        <div className="dz-cut-extracted">
          <div className="dz-cut-extracted-header">
            <span>
              {cutResultUrl
                ? (wandMasks.length > 0 || brushStrokes.length > 0
                    ? 'Découpe + sélections'
                    : 'Découpe')
                : (wandMasks.length > 0 || brushStrokes.length > 0
                    ? 'Aperçu de la sélection'
                    : 'En attente d\'extraction')}
            </span>
            {cutResultUrl && (
              <button
                type="button"
                className="dz-cut-extracted-clear"
                onClick={clearCutResult}
                title="Vider la découpe (les sélections restent actives)"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
          {livePreviewUrl ? (
            <div className="dz-cut-composite-tile" title="Aperçu live de la découpe">
              <img src={livePreviewUrl} alt="Aperçu de la découpe" />
            </div>
          ) : selectedDetectionId ? (
            // Mode auto-sélection : pas de message Extraire (le user n'a pas
            // à extraire, juste à visualiser la sélection courante).
            <div className="dz-cut-composite-empty">
              Sélection active — aperçu en cours de calcul…
            </div>
          ) : (
            <div className="dz-cut-composite-empty">
              Trace une sélection sur l&apos;image — l&apos;aperçu apparaîtra ici.
              <br />
              Clique <strong>Extraire</strong> pour la sauvegarder.
            </div>
          )}
          {(wandMasks.length > 0 || brushStrokes.length > 0) && (
            <button
              type="button"
              className="dz-cut-clear-selections"
              onClick={() => { clearWand(); clearBrushStrokes(); }}
              title="Vide les pointillés sur le canvas (n'efface pas la découpe sauvegardée)"
            >
              <RotateCcw size={11} />
              <span>Effacer les sélections du canvas</span>
            </button>
          )}
        </div>
      )}

      {!imageUrl ? (
        <div className="dz-catalog-empty">
          Choisis ou génère une image base avant d&apos;utiliser la découpe.
        </div>
      ) : selectedDetectionId ? (
        // Mode auto-sélection : panneau réduit à la visualisation. Pas de
        // phases creation (drawing/pending-confirm) — celles-ci appartiennent
        // au flow legacy de découpe manuelle, hors-sujet ici. Le composite
        // section au-dessus suffit pour montrer "ce qui est sélectionné".
        null
      ) : phase === 'drawing' ? (
        <div className="dz-cut-drawing">
          <div className="dz-cut-drawing-icon">
            <Scissors size={28} />
          </div>
          <div className="dz-cut-drawing-label">
            {cutTool === 'brush' ? 'Peins la zone à extraire'
              : cutTool === 'magic_wand' ? 'Clique sur un objet à extraire'
              : cutTool === 'sam_prompt' ? 'Clique sur l\'objet à extraire (IA sémantique)'
              : cutTool === 'grabcut' ? 'Encadre l\'objet (rectangle serré)'
              : 'Trace une zone sur l\'image'}
          </div>
          <div className="dz-cut-drawing-hint">
            {cutTool === 'brush'
              ? 'Trace au pinceau les pixels que tu veux découper.'
              : cutTool === 'magic_wand'
                ? 'Cliquer sélectionne tous les pixels de couleur similaire connectés. Re-clique sur d\'autres objets pour les ajouter à la sélection.'
                : cutTool === 'sam_prompt'
                  ? 'SAM 2 détecte sémantiquement l\'objet entier (gère les gradients lumineux, ombres, textures complexes). Re-clique pour ajouter d\'autres objets. ~1-2s par click.'
                  : cutTool === 'grabcut'
                    ? 'Drag un rectangle serré autour de l\'objet. GrabCut isolera automatiquement le foreground du background (algo non-IA, gratuit, ~1-3s).'
                    : 'Drag pour dessiner un rectangle. SAM détectera automatiquement les objets dans cette zone.'}
          </div>

          {/* Slider tolérance — uniquement pour Magic Wand */}
          {cutTool === 'magic_wand' && (
            <ToleranceSlider value={magicWandTolerance} onChange={setMagicWandTolerance} />
          )}

          {error && <div className="dz-cut-error">{error}</div>}
        </div>
      ) : phase === 'pending-confirm' ? (
        <div className="dz-cut-confirm">
          <div className="dz-cut-confirm-icon">
            <Scissors size={28} />
          </div>
          <div className="dz-cut-confirm-title">Extraire cette zone ?</div>
          <div className="dz-cut-confirm-hint">
            {cutTool === 'grabcut'
              ? <>GrabCut va isoler l&apos;objet principal de la zone (algo classique, CPU local).<br />Cela prend ~1-3 secondes.</>
              : <>SAM va analyser le rectangle pour détecter les objets à l&apos;intérieur.<br />Cela prend ~30 secondes.</>
            }
          </div>

          {/* Sélecteur granularité — uniquement pour SAM (GrabCut donne 1 mask) */}
          {cutTool === 'wand' && (
            <div className="dz-cut-granularity">
              <div className="dz-cut-granularity-label">Taille minimale des objets</div>
              <div className="dz-cut-granularity-buttons">
                <button
                  type="button"
                  className={`dz-cut-granularity-btn ${samGranularity === 'large' ? 'active' : ''}`}
                  onClick={() => setSamGranularity('large')}
                  title="Gros objets uniquement (canapé, arbre…)"
                >
                  Gros
                </button>
                <button
                  type="button"
                  className={`dz-cut-granularity-btn ${samGranularity === 'coarse' ? 'active' : ''}`}
                  onClick={() => setSamGranularity('coarse')}
                  title="Compromis : 30-80 zones."
                >
                  Moyen
                </button>
                <button
                  type="button"
                  className={`dz-cut-granularity-btn ${samGranularity === 'fine' ? 'active' : ''}`}
                  onClick={() => setSamGranularity('fine')}
                  title="Tous les détails. 50-200 zones."
                >
                  Fin
                </button>
              </div>
              <div className="dz-cut-granularity-hint">
                {samGranularity === 'large' && 'Quelques gros objets (canapé entier, arbre…)'}
                {samGranularity === 'coarse' && 'Compromis — peut éclater certains objets en parties'}
                {samGranularity === 'fine' && 'Détails individuels — beaucoup de zones, à filtrer ensuite'}
              </div>
            </div>
          )}

          <div className="dz-cut-confirm-actions">
            <button
              type="button"
              className="dz-cut-action primary"
              onClick={cutTool === 'grabcut' ? launchGrabCut : launchSam}
            >
              <Check size={14} />
              <span>Extraire</span>
            </button>
            <button
              type="button"
              className="dz-cut-action"
              onClick={cancelPendingRect}
            >
              <XIcon size={14} />
              <span>Annuler</span>
            </button>
          </div>
          {error && <div className="dz-cut-error">{error}</div>}
        </div>
      ) : (
        <div className="dz-cut-results">
          {/* Slider tolérance accessible aussi en mode results (ré-ajustement) */}
          {cutTool === 'magic_wand' && (
            <ToleranceSlider value={magicWandTolerance} onChange={setMagicWandTolerance} compact />
          )}

          {/* Annuler dernière (click-point tools : Magic Wand + SAM Prompt).
           * Retire la dernière sélection ajoutée (= un mask), utile quand on a
           * cliqué un objet par erreur. Les autres sélections restent. */}
          {isClickPointTool && wandMasks.length > 0 && (
            <button
              type="button"
              className="dz-cut-restart"
              onClick={undoLastMagicMask}
              disabled={busy !== null}
              title="Retire la dernière sélection (Ctrl+Z)"
            >
              <RotateCcw size={12} />
              <span>↶ Annuler dernière sélection</span>
              <kbd style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.6 }}>Ctrl+Z</kbd>
            </button>
          )}

          {/* Actions secondaires migrées dans la toolbar (icônes Copier /
           * Supprimer / Calque / Personnage / Objet à droite du ciseau).
           * Le panneau de gauche s'arrête à "Annuler dernière sélection". */}

          {error && <div className="dz-cut-error">{error}</div>}
        </div>
      )}
    </CatalogShell>
  )
}


// ── Sub-component : ToleranceSlider (Magic Wand) ─────────────────────────

interface ToleranceSliderProps {
  value: number
  onChange: (v: number) => void
  /** Mode compact pour le contexte 'results' (1 ligne au lieu de 3) */
  compact?: boolean
}

function ToleranceSlider({ value, onChange, compact = false }: ToleranceSliderProps) {
  return (
    <div className={`dz-tolerance ${compact ? 'compact' : ''}`}>
      <div className="dz-tolerance-row">
        <label className="dz-tolerance-label">
          Tolérance couleur
        </label>
        <span className="dz-tolerance-value">{value}</span>
      </div>
      <input
        type="range"
        min={1}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="dz-tolerance-input"
      />
      {!compact && (
        <div className="dz-tolerance-hint">
          Faible = sélection précise · Haute = inclut les variations de couleur
        </div>
      )}
    </div>
  )
}


// ── Sub-component : AICutPanel (pré-validation de la découpe IA) ──────────
//
// Affiche les différentes phases du pipeline AI cut command :
//   - parsing/searching : spinner + texte de progression
//   - preview : info objet trouvé + boutons Garder / Annuler
//   - unsupported_intent : "Cette commande n'est pas encore implémentée"
//   - not_found : "Pas trouvé : <objet>"
//   - error : message + hint éventuel (ex: instructions Ollama install)
// Aucun rendu en phase 'idle'.

interface AICutPanelProps {
  imageUrl: string | null
}

function AICutPanel({ imageUrl }: AICutPanelProps) {
  const ctx = useAICutCommandOptional()
  if (!ctx) return null
  const { status, confirm, cancel } = ctx
  if (status.phase === 'idle') return null
  if (!imageUrl) return null

  return (
    <div className="dz-aicut-panel">
      <div className="dz-aicut-header">
        <Sparkles size={12} />
        <span>Découpe IA</span>
      </div>

      {(status.phase === 'parsing' || status.phase === 'searching') && (
        <div className="dz-aicut-loading">
          <Loader2 size={20} className="dz-aicut-spin" />
          <div className="dz-aicut-loading-label">
            {status.phase === 'parsing'
              ? 'Compréhension de la commande…'
              : <>Recherche de <strong>{(status as { parsed: { object_fr: string } }).parsed.object_fr}</strong>…</>}
          </div>
          <div className="dz-aicut-loading-hint">
            {status.phase === 'parsing'
              ? 'NLU local Qwen'
              : (() => {
                  const eng = (status as { parsed: { suggested_engine: string } }).parsed.suggested_engine
                  if (eng === 'florence_res') return 'Florence-2 RES (1 sujet relationnel)'
                  if (eng === 'florence_ctpg') return 'Florence-2 CTPG + SAM 2 (multi-objets)'
                  return 'GroundingDINO + SAM 1'
                })()}
          </div>
        </div>
      )}

      {status.phase === 'preview' && (
        <div className="dz-aicut-preview">
          <div className="dz-aicut-preview-found">
            ✓ Trouvé : <strong>{status.parsed.object_fr}</strong>
            {status.parsed.spatial && (
              <span className="dz-aicut-preview-spatial">
                {' '}· {SPATIAL_LABEL[status.parsed.spatial]}
              </span>
            )}
          </div>
          <div className="dz-aicut-preview-tile" title="Aperçu de la découpe IA">
            <div
              className="dz-cut-tile-content"
              style={{
                backgroundImage: `url("${imageUrl}")`,
                WebkitMaskImage: `url("${status.maskUrl}")`,
                maskImage: `url("${status.maskUrl}")`,
              }}
              aria-hidden
            />
          </div>
          <div className="dz-aicut-preview-actions">
            <button
              type="button"
              className="dz-aicut-btn dz-aicut-btn-primary"
              onClick={confirm}
            >
              <Check size={13} />
              <span>Garder la découpe</span>
            </button>
            <button
              type="button"
              className="dz-aicut-btn"
              onClick={cancel}
            >
              <XIcon size={13} />
              <span>Annuler</span>
            </button>
          </div>
          <div className="dz-aicut-preview-source">
            {status.parsed.source === 'regex' ? '⚡ Compris par règles (instant)' : '🧠 Compris par IA locale'}
          </div>
        </div>
      )}

      {status.phase === 'unsupported_intent' && (
        <div className="dz-aicut-message">
          <div className="dz-aicut-message-title">
            🚧 Intent reconnu mais non implémenté
          </div>
          <div className="dz-aicut-message-body">
            L&apos;IA a compris : <strong>{INTENT_LABEL[status.parsed.intent]}</strong>{' '}
            sur <strong>{status.parsed.object_fr || '?'}</strong>.
            <br /><br />
            Seule l&apos;extraction est active pour l&apos;instant. Les autres
            actions (suppression, remplacement, changement couleur…) viendront.
          </div>
          <button type="button" className="dz-aicut-btn" onClick={cancel}>
            <XIcon size={13} /><span>Fermer</span>
          </button>
        </div>
      )}

      {status.phase === 'not_found' && (
        <div className="dz-aicut-message">
          <div className="dz-aicut-message-title">
            🔍 Aucun <strong>{status.parsed.object_fr}</strong> détecté
          </div>
          <div className="dz-aicut-message-body">{status.message}</div>
          <button type="button" className="dz-aicut-btn" onClick={cancel}>
            <XIcon size={13} /><span>OK</span>
          </button>
        </div>
      )}

      {status.phase === 'error' && (
        <div className="dz-aicut-message dz-aicut-error">
          <div className="dz-aicut-message-title">⚠ Erreur IA</div>
          <div className="dz-aicut-message-body">{status.message}</div>
          {status.hint && (
            <div className="dz-aicut-message-hint">{status.hint}</div>
          )}
          <button type="button" className="dz-aicut-btn" onClick={cancel}>
            <XIcon size={13} /><span>Fermer</span>
          </button>
        </div>
      )}
    </div>
  )
}

const SPATIAL_LABEL: Record<string, string> = {
  center: 'au centre', left: 'à gauche', right: 'à droite',
  top: 'en haut', bottom: 'en bas',
  top_left: 'en haut à gauche', top_right: 'en haut à droite',
  bottom_left: 'en bas à gauche', bottom_right: 'en bas à droite',
  foreground: 'au premier plan', background: 'en arrière-plan',
  largest: 'le plus grand', smallest: 'le plus petit',
}

const INTENT_LABEL: Record<string, string> = {
  extract: 'Extraire', remove: 'Supprimer', replace: 'Remplacer',
  change_color: 'Changer la couleur', change_material: 'Changer le matériau',
  add: 'Ajouter', effect: 'Ajouter un effet', unknown: '(inconnu)',
}
