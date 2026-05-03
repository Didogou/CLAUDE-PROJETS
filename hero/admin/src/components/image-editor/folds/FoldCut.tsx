'use client'
/**
 * Fold "Découpe" : baguette magique dans un rectangle.
 *
 * Flow (3 étapes) :
 *   1. **Tracer un rectangle** sur l'image → délimite la zone de détection
 *   2. **SAM auto** démarre automatiquement au release du drag (~30-60s first
 *      run, cache ensuite) → détecte les N objets dans le rectangle
 *   3. **Hover + clic** sur l'objet voulu → le mask est sélectionné (le canvas
 *      affiche marching ants au hover, halo rose sur la sélection validée)
 *   4. Actions disponibles sur le mask : Supprimer · Inpaint · Créer calque animé
 *
 * Contrairement au flow précédent qui affichait TOUTES les zones SAM en
 * même temps (invivable, 50+ rectangles colorés), ici on n'affiche QUE
 * l'objet survolé, pattern Photoshop "Object Selection" / Magnific / Krea.
 */
import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Eraser, Palette, User, Save, Trash2, Film, Loader2, MousePointerClick, Wand2, Paintbrush, Undo2 } from 'lucide-react'
import { useEditorState } from '../EditorStateContext'
import { CHECKPOINTS } from '@/lib/comfyui'
import { extractZonesFromRect, extractZoneAsTransparentFullSize, combineMasksMulti } from '../helpers/extractZones'
import { brushStrokesToMaskUrl } from '../helpers/brushToMask'

interface FoldCutProps {
  imageUrl: string | null
  storagePathPrefix: string
  onImageReplaced: (newUrl: string) => void
}

type ActionKey = 'erase' | 'recolor' | 'replace_with' | 'create_anim_layer' | 'save_pos'

const ACTION_LABELS: Record<ActionKey, { label: string; icon: React.ReactNode; color: string; implemented: boolean }> = {
  erase:             { label: 'Supprimer',        icon: <Eraser size={14} />,   color: 'var(--ie-danger)',  implemented: true },
  recolor:           { label: 'Changer couleur',  icon: <Palette size={14} />,  color: 'var(--ie-info)',    implemented: false },
  replace_with:      { label: 'Remplacer par…',   icon: <User size={14} />,     color: 'var(--ie-accent)',  implemented: false },
  create_anim_layer: { label: 'Créer un calque animé', icon: <Film size={14} />, color: 'var(--ie-success)', implemented: true },
  save_pos:          { label: 'Sauver position',  icon: <Save size={14} />,     color: 'var(--ie-success)', implemented: false },
}

export default function FoldCut({ imageUrl, storagePathPrefix, onImageReplaced }: FoldCutProps) {
  const {
    cutSelection, cutDragging, setCutSelection, setCutMode,
    wandMasks, currentMaskUrl, selectedWandUrls, wandBusy,
    setWandMasks, setCurrentMask, setWandBusy, clearWand,
    cutTool, setCutTool,
    brushStrokes, brushSize, brushMode,
    undoBrushStroke, clearBrushStrokes, setBrushSize, setBrushMode,
    addLayer,
  } = useEditorState()
  const [busy, setBusy] = useState<ActionKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Granularité de SAM :
   *  - 'coarse' : gros aggregats (arbre entier au lieu de chaque grappe de
   *    feuilles). Défaut — plus naturel pour extraire un sujet complet.
   *  - 'fine' : détecte chaque petit détail. Utile si le rect contient plusieurs
   *    petits objets à distinguer.
   *
   * Changer la granularité re-lance SAM avec le même rect.
   */
  const [granularity, setGranularity] = useState<'coarse' | 'fine'>('coarse')

  // Active cutMode pour que CanvasOverlay accepte le drag-to-rect + hover wand
  useEffect(() => {
    setCutMode(true)
    return () => setCutMode(false)
  }, [setCutMode])

  // ── Auto-lance SAM dès qu'un rect est tracé ──────────────────────────
  //
  // Dès que l'utilisateur release son drag (cutSelection valide + assez grand),
  // on lance extractZonesFromRect sans bouton intermédiaire. Le requestIdRef
  // évite qu'une ancienne requête écrase un rect plus récent.
  const requestIdRef = useRef(0)
  useEffect(() => {
    // N'attaque SAM qu'après le release du drag (`cutDragging === false`) —
    // sinon on lancerait une requête dès le premier pixel de mouvement.
    if (cutDragging) return
    // SAM ne tourne qu'en mode baguette magique — sinon le pinceau hériterait
    // d'une détection automatique non sollicitée.
    if (cutTool !== 'wand') return
    const hasValidRect = cutSelection !== null &&
      (cutSelection.x2 - cutSelection.x1) > 0.01 &&
      (cutSelection.y2 - cutSelection.y1) > 0.01
    if (!hasValidRect || !imageUrl || wandMasks.length > 0) return

    const reqId = ++requestIdRef.current
    setError(null); setWandBusy(true)
    ;(async () => {
      try {
        const zones = await extractZonesFromRect({
          imageUrl, rect: cutSelection!, storagePathPrefix, granularity,
        })
        if (reqId !== requestIdRef.current) return
        if (zones.length === 0) {
          setError('Aucun objet détecté. Trace un rectangle plus précis autour du sujet.')
          setWandBusy(false)
          return
        }
        setWandMasks(zones.map(z => ({ url: z.maskUrl, index: z.index })))
      } catch (err) {
        if (reqId !== requestIdRef.current) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (reqId === requestIdRef.current) setWandBusy(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutSelection, imageUrl, cutDragging, granularity, cutTool])

  // ── Recalcul de currentMaskUrl = union des zones sélectionnées ────────
  //
  // À chaque toggle (clic sur une zone), on recalcule l'union de toutes les
  // zones sélectionnées côté client (canvas API) puis on upload le mask unique
  // final. Utilise `combineMasksMulti` (1 seul upload quelle que soit la taille).
  // requestIdRef pour ignorer les unions obsolètes si l'utilisateur clique vite.
  const unionRequestIdRef = useRef(0)
  useEffect(() => {
    const reqId = ++unionRequestIdRef.current
    if (selectedWandUrls.length === 0) {
      setCurrentMask(null)
      return
    }
    if (selectedWandUrls.length === 1) {
      // Un seul = pas d'union à faire, on utilise directement l'URL
      setCurrentMask(selectedWandUrls[0])
      return
    }
    ;(async () => {
      try {
        const unionUrl = await combineMasksMulti(selectedWandUrls, storagePathPrefix)
        if (reqId !== unionRequestIdRef.current) return // obsolète
        setCurrentMask(unionUrl)
      } catch (err) {
        if (reqId !== unionRequestIdRef.current) return
        console.warn('[FoldCut] union failed:', err)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWandUrls])

  /** Change la granularité et relance SAM sur le rect courant. */
  function handleGranularityChange(next: 'coarse' | 'fine') {
    if (next === granularity) return
    setGranularity(next)
    // Force un re-fetch : on vide les masks → l'useEffect re-attaquera avec
    // la nouvelle granularité (car son guard `wandMasks.length > 0` sera OK).
    setWandMasks([])
    setCurrentMask(null)
  }

  const hasRect = cutSelection !== null &&
    (cutSelection.x2 - cutSelection.x1) > 0.01 &&
    (cutSelection.y2 - cutSelection.y1) > 0.01
  const hasMasks = wandMasks.length > 0
  const hasWandMask = currentMaskUrl !== null
  const hasBrushStrokes = brushStrokes.length > 0
  // Un mask est utilisable si : wand a une union sélectionnée OU le pinceau
  // a au moins un trait de paint (le mask final sera généré à l'action click).
  const hasMask = cutTool === 'wand' ? hasWandMask : hasBrushStrokes
  const canApplyAction = hasMask && imageUrl !== null && !busy

  // ── Actions ───────────────────────────────────────────────────────────

  /**
   * Supprimer : pipeline 100% automatique, zéro prompt utilisateur.
   *
   *   1. Claude Vision regarde l'image et décrit le background (hors sujet)
   *      → /api/editor/describe-inpaint-context renvoie un prompt SDXL court
   *   2. SDXL Inpaint (Juggernaut XL) rempli la zone masquée :
   *      - prompt = description Claude
   *      - style_reference = self (l'image source) → préserve lumière/teintes
   *      - style_reference_weight = 0.6 (défaut solide pour cas complexes)
   *   3. Le résultat remplace l'image courante
   *
   * Durée : ~60-90s au total (~3s Claude Vision + ~60s SDXL).
   */
  /** Résout l'URL du mask à utiliser — wand : currentMaskUrl déjà uploadé ;
   *  brush : on génère le mask depuis les strokes puis on upload. */
  async function resolveMaskUrl(): Promise<string | null> {
    if (cutTool === 'wand') return currentMaskUrl
    if (!imageUrl) return null
    return await brushStrokesToMaskUrl(brushStrokes, imageUrl, storagePathPrefix)
  }

  async function runErase() {
    if (!imageUrl) return
    setError(null); setBusy('erase')
    try {
      const maskUrl = await resolveMaskUrl()
      if (!maskUrl) throw new Error('Aucun masque défini')

      // 1. Claude Vision décrit le contexte
      const descRes = await fetch('/api/editor/describe-inpaint-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      })
      const descData = await descRes.json() as { prompt?: string; error?: string }
      if (!descRes.ok || !descData.prompt) {
        throw new Error(descData.error ?? 'Analyse du contexte échouée')
      }

      // 2. SDXL Inpaint avec le prompt généré + style-ref self
      const defaultCheckpoint = CHECKPOINTS.find(c => c.key === 'juggernaut')?.filename
        ?? CHECKPOINTS[0].filename
      const res = await fetch('/api/comfyui/inpaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          mask_url: maskUrl,
          checkpoint: defaultCheckpoint,
          prompt_positive: descData.prompt,
          storage_path: `${storagePathPrefix}_inpaint_${Date.now()}`,
          style_reference_weight: 0.6,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `Erreur ${res.status}`)
      if (!d.image_url) throw new Error('Pas d\'URL en retour')

      onImageReplaced(d.image_url)
      handleReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function runCreateAnimLayer() {
    if (!imageUrl) return
    setError(null); setBusy('create_anim_layer')
    try {
      const maskUrl = await resolveMaskUrl()
      if (!maskUrl) throw new Error('Aucun masque défini')
      const extractedUrl = await extractZoneAsTransparentFullSize(
        imageUrl, maskUrl, storagePathPrefix,
      )
      addLayer({
        name: 'Sujet extrait',
        type: 'image',
        composition: undefined,
        media_url: extractedUrl,
        baked_url: extractedUrl,
        visible: true,
        opacity: 1,
        blend: 'normal',
        activeView: 'animation',
      })
      handleReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function runAction(key: ActionKey) {
    if (!ACTION_LABELS[key].implemented) {
      setError(`« ${ACTION_LABELS[key].label} » arrive en v2.`)
      return
    }
    if (key === 'erase') return runErase()
    if (key === 'create_anim_layer') return runCreateAnimLayer()
  }

  function handleReset() {
    setCutSelection(null)
    clearWand()
    clearBrushStrokes()
    setError(null)
  }

  // ── Rendu ────────────────────────────────────────────────────────────────

  // 3 étapes — différentes selon l'outil.
  // Wand  : 1/ Rect  2/ Hover+clic  3/ Action
  // Brush : 1/ Peindre  2/ Ajuster  3/ Action
  type Step = 1 | 2 | 3
  const step: Step = cutTool === 'wand'
    ? (!hasRect ? 1 : !hasWandMask ? 2 : 3)
    : (!hasBrushStrokes ? 1 : 3)
  const stepTexts: Record<Step, string> = cutTool === 'wand' ? {
    1: 'Trace un rectangle autour de la zone qui contient le sujet.',
    2: wandBusy
      ? 'SAM analyse le rectangle…'
      : hasMasks
        ? `${wandMasks.length} objet${wandMasks.length > 1 ? 's' : ''} détecté${wandMasks.length > 1 ? 's' : ''}. Clic sur une zone pour l'ajouter / la retirer.`
        : 'Aucun objet détecté. Trace un rectangle différent.',
    3: `${selectedWandUrls.length} zone${selectedWandUrls.length > 1 ? 's' : ''} sélectionnée${selectedWandUrls.length > 1 ? 's' : ''}. Clic sur une autre zone pour l'ajouter, re-clic pour la retirer, ou choisis une action.`,
  } : {
    1: 'Peins la zone que tu veux traiter. Ajuste la taille de la pointe avec le slider.',
    2: '',  // pas de phase 2 en mode brush
    3: `${brushStrokes.length} trait${brushStrokes.length > 1 ? 's' : ''} — passe en gomme pour affiner, annule le dernier trait, ou choisis une action.`,
  }

  const helperBg = step === 1 ? 'var(--ie-accent-faint)'
    : step === 2 ? (hasMasks && !wandBusy ? 'rgba(78, 213, 213, 0.08)' : 'var(--ie-surface-3)')
    : 'rgba(16, 185, 129, 0.08)'
  const helperBorder = step === 1 ? 'var(--ie-accent)'
    : step === 2 ? (hasMasks && !wandBusy ? '#4ed5d5' : 'var(--ie-border)')
    : 'var(--ie-success)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-3)' }}>
      {/* Onglets d'outil — Baguette magique SAM / Pinceau manuel.
           Switcher d'outil = vide l'état de l'autre (mental model clair). */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ie-space-1)',
        padding: 2, background: 'var(--ie-surface-2)', borderRadius: 'var(--ie-radius)',
        border: '1px solid var(--ie-border)',
      }}>
        <button
          onClick={() => setCutTool('wand')}
          disabled={wandBusy || busy !== null}
          style={toolTabStyle(cutTool === 'wand', wandBusy || busy !== null)}
          title="Détection automatique via SAM — rectangle puis clic sur les zones"
        ><Wand2 size={13} /> Baguette</button>
        <button
          onClick={() => setCutTool('brush')}
          disabled={wandBusy || busy !== null}
          style={toolTabStyle(cutTool === 'brush', wandBusy || busy !== null)}
          title="Pinceau manuel — peins la zone toi-même, taille de pointe réglable"
        ><Paintbrush size={13} /> Pinceau</button>
      </div>

      {/* Aide contextuelle — 3 étapes avec stepper visuel */}
      <div style={{
        padding: 'var(--ie-space-3)',
        background: helperBg,
        border: `1px solid ${helperBorder}`,
        borderRadius: 'var(--ie-radius)',
        fontSize: 'var(--ie-text-sm)',
        color: 'var(--ie-text)',
        display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)',
        lineHeight: 1.4,
        transition: 'background 180ms, border-color 180ms',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ie-space-2)' }}>
          <MousePointerClick size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span style={{ fontSize: 'var(--ie-text-xs)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ie-text-muted)' }}>
            Étape {step} / 3
            {wandBusy && <Loader2 size={11} className="ie-spin" style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
          </span>
        </div>
        <span>{stepTexts[step]}</span>
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          {[1, 2, 3].map(s => (
            <div
              key={s}
              style={{
                height: 3,
                flex: 1,
                borderRadius: 2,
                background: s < step ? 'var(--ie-success)'
                  : s === step ? 'var(--ie-accent)'
                  : 'var(--ie-border-strong)',
                opacity: s < step ? 0.65 : s === step ? 1 : 0.35,
                transition: 'all 180ms',
              }}
            />
          ))}
        </div>
      </div>

      {/* Contrôles pinceau — mode brush uniquement : taille pointe + mode +
           undo + effacer tout. Placés avant les actions pour suivre le flow
           naturel (peindre → ajuster → action). */}
      {cutTool === 'brush' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)' }}>
          {/* Paint / Erase toggle */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ie-space-1)',
            padding: 2, background: 'var(--ie-surface-2)', borderRadius: 'var(--ie-radius)',
            border: '1px solid var(--ie-border)',
          }}>
            <button
              onClick={() => setBrushMode('paint')}
              disabled={busy !== null}
              style={brushModeBtnStyle(brushMode === 'paint', busy !== null)}
              title="Peindre — ajoute au masque"
            ><Paintbrush size={12} /> Peindre</button>
            <button
              onClick={() => setBrushMode('erase')}
              disabled={busy !== null}
              style={brushModeBtnStyle(brushMode === 'erase', busy !== null)}
              title="Gommer — retire du masque"
            ><Eraser size={12} /> Gomme</button>
          </div>

          {/* Taille de pointe */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)',
            }}>
              <span>Taille de pointe</span>
              <span style={{ fontWeight: 600, color: 'var(--ie-text)', fontVariantNumeric: 'tabular-nums' }}>
                {(brushSize * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min={0.005} max={0.15} step={0.005}
              value={brushSize}
              onChange={(e) => setBrushSize(parseFloat(e.target.value))}
              disabled={busy !== null}
              style={{ width: '100%', accentColor: 'var(--ie-accent)' }}
            />
          </div>

          {/* Actions brush — undo dernier trait + effacer tout */}
          {hasBrushStrokes && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ie-space-1)' }}>
              <motion.button
                onClick={undoBrushStroke}
                disabled={busy !== null}
                whileTap={{ scale: 0.97 }}
                style={brushActionBtnStyle(busy !== null)}
                title="Annule le dernier trait"
              ><Undo2 size={12} /> Dernier trait</motion.button>
              <motion.button
                onClick={clearBrushStrokes}
                disabled={busy !== null}
                whileTap={{ scale: 0.97 }}
                style={brushActionBtnStyle(busy !== null)}
                title="Efface tous les traits"
              ><Trash2 size={12} /> Tout effacer</motion.button>
            </div>
          )}
        </div>
      )}

      {/* Granularité SAM — affiché une fois que des masks existent, en mode wand.
           Permet de re-lancer la détection avec des gros aggregats (coarse,
           défaut : idéal pour extraire un arbre / personnage entier) ou des
           détails fins (fine : chaque petit objet détecté séparément). */}
      {cutTool === 'wand' && hasMasks && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ie-space-1)',
          padding: 2, background: 'var(--ie-surface-2)', borderRadius: 'var(--ie-radius)',
          border: '1px solid var(--ie-border)',
        }}>
          <button
            onClick={() => handleGranularityChange('coarse')}
            disabled={wandBusy}
            style={granularityBtnStyle(granularity === 'coarse', wandBusy)}
            title="Gros aggregats — groupe les détails (ex : feuillage entier d'un arbre)"
          >🌳 Gros éléments</button>
          <button
            onClick={() => handleGranularityChange('fine')}
            disabled={wandBusy}
            style={granularityBtnStyle(granularity === 'fine', wandBusy)}
            title="Détail fin — détecte chaque petit objet séparément"
          >🔍 Détail fin</button>
        </div>
      )}

      {/* Actions — activées quand un mask est validé.
           Flow Supprimer : 100% automatique, zéro prompt visible.
           Claude Vision → SDXL Inpaint + IPAdapter style-ref (self) en interne. */}
      {hasMask && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)' }}>
          {(Object.keys(ACTION_LABELS) as ActionKey[]).map(key => {
            const info = ACTION_LABELS[key]
            const running = busy === key
            const enabled = canApplyAction && info.implemented && !busy
            const isHero = key === 'create_anim_layer'
            return (
              <motion.button
                key={key}
                onClick={() => void runAction(key)}
                disabled={!enabled}
                whileHover={enabled ? { x: isHero ? 0 : 2, scale: isHero ? 1.01 : 1 } : undefined}
                whileTap={enabled ? { scale: 0.98 } : undefined}
                title={info.implemented ? info.label : `${info.label} — bientôt disponible`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--ie-space-2)',
                  padding: isHero ? 'var(--ie-space-3)' : 'var(--ie-space-2) var(--ie-space-3)',
                  borderRadius: 'var(--ie-radius)',
                  border: isHero && enabled ? '1px solid var(--ie-success)' : `1px solid ${enabled ? 'var(--ie-border-strong)' : 'var(--ie-border)'}`,
                  background: running ? 'var(--ie-accent-faint)' : isHero && enabled ? 'rgba(16, 185, 129, 0.08)' : 'var(--ie-surface)',
                  color: enabled ? 'var(--ie-text)' : 'var(--ie-text-faint)',
                  fontSize: 'var(--ie-text-sm)',
                  fontWeight: isHero ? 600 : 500,
                  textAlign: 'left',
                  cursor: enabled ? 'pointer' : 'not-allowed',
                  opacity: enabled ? 1 : (info.implemented ? 0.5 : 0.4),
                  boxShadow: isHero && enabled ? '0 1px 2px rgba(16, 185, 129, 0.15)' : 'none',
                  transition: 'background 150ms, border-color 150ms, box-shadow 150ms',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ color: info.color, flexShrink: 0, display: 'inline-flex' }}>{info.icon}</span>
                <span style={{ flex: 1 }}>{info.label}</span>
                {running && <Loader2 size={12} className="ie-spin" />}
                {!info.implemented && <span style={{ fontSize: 10, color: 'var(--ie-text-faint)', fontStyle: 'italic' }}>v2</span>}
                {isHero && enabled && !running && <span style={{ fontSize: 10, color: 'var(--ie-success)', fontWeight: 700, letterSpacing: '0.02em' }}>NOUVEAU</span>}
              </motion.button>
            )
          })}
        </div>
      )}

      {/* Reset */}
      {(hasRect || hasMasks || hasBrushStrokes) && (
        <motion.button onClick={handleReset} whileTap={{ scale: 0.97 }} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-2)',
          padding: 'var(--ie-space-2)',
          borderRadius: 'var(--ie-radius)',
          border: '1px solid var(--ie-border-strong)',
          background: 'transparent',
          color: 'var(--ie-text-muted)',
          fontSize: 'var(--ie-text-sm)',
          cursor: 'pointer',
        }}>
          <Trash2 size={13} />
          Recommencer
        </motion.button>
      )}

      {error && (
        <div style={{
          padding: 'var(--ie-space-2) var(--ie-space-3)',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid var(--ie-danger)',
          borderRadius: 'var(--ie-radius)',
          color: 'var(--ie-danger)',
          fontSize: 'var(--ie-text-sm)',
          lineHeight: 1.4,
        }}>⚠ {error}</div>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function granularityBtnStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: 'var(--ie-space-2)',
    borderRadius: 'var(--ie-radius-sm)',
    background: active ? 'var(--ie-surface)' : 'transparent',
    boxShadow: active ? 'var(--ie-shadow-sm)' : 'none',
    color: active ? 'var(--ie-text)' : 'var(--ie-text-muted)',
    fontSize: 'var(--ie-text-xs)',
    fontWeight: active ? 600 : 500,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-1)',
    cursor: disabled ? 'wait' : 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    opacity: disabled ? 0.5 : 1,
    transition: 'all var(--ie-transition)',
  }
}

function toolTabStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: 'var(--ie-space-2) var(--ie-space-3)',
    borderRadius: 'var(--ie-radius-sm)',
    background: active ? 'var(--ie-accent)' : 'transparent',
    color: active ? 'var(--ie-accent-text-on)' : 'var(--ie-text-muted)',
    fontSize: 'var(--ie-text-sm)',
    fontWeight: active ? 600 : 500,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-2)',
    cursor: disabled ? 'wait' : 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    opacity: disabled ? 0.5 : 1,
    boxShadow: active ? 'var(--ie-shadow-sm)' : 'none',
    transition: 'all var(--ie-transition)',
  }
}

function brushModeBtnStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: 'var(--ie-space-2)',
    borderRadius: 'var(--ie-radius-sm)',
    background: active ? 'var(--ie-surface)' : 'transparent',
    color: active ? 'var(--ie-text)' : 'var(--ie-text-muted)',
    fontSize: 'var(--ie-text-xs)',
    fontWeight: active ? 600 : 500,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-1)',
    cursor: disabled ? 'wait' : 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    opacity: disabled ? 0.5 : 1,
    boxShadow: active ? 'var(--ie-shadow-sm)' : 'none',
    transition: 'all var(--ie-transition)',
  }
}

function brushActionBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: 'var(--ie-space-2)',
    borderRadius: 'var(--ie-radius-sm)',
    background: 'var(--ie-surface-2)',
    color: 'var(--ie-text-muted)',
    fontSize: 'var(--ie-text-xs)',
    fontWeight: 500,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-1)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid var(--ie-border)',
    fontFamily: 'inherit',
    opacity: disabled ? 0.5 : 1,
    transition: 'all var(--ie-transition)',
  }
}
