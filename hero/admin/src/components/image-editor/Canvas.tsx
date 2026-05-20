'use client'
/**
 * Canvas : zone centrale d'affichage de l'image en cours d'édition.
 *
 * Structure :
 *   .ie-canvas (flex center, position: relative)
 *     ├── <img>          — centrée, max-width/height: 100%, object-fit: contain
 *     └── CanvasOverlay  — positionnée absolument exactement sur l'image
 *
 * L'overlay calcule sa position/taille à partir de offsetLeft/offsetTop et
 * clientWidth/clientHeight du <img> via ResizeObserver — garantit l'alignement
 * pixel-perfect des sprites même quand les panneaux sont redimensionnés.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ImageIcon } from 'lucide-react'
import type { Npc, Item, Choice } from '@/types'
import CanvasOverlay from './CanvasOverlay'
import SceneDetectionsOverlay from './SceneDetectionsOverlay'
import ParticleLayer from './ParticleLayer'
import LightningEffect from './LightningEffect'
import RainyDayGlassLayer from './RainyDayGlassLayer'
import { useEditorState } from './EditorStateContext'
import { formatToAspectRatio } from './GenerationPanel'
import { WEATHER_PRESETS } from './types'
import { chromaKeyGrayToTransparent } from '@/lib/image-extraction-analysis'
import { flattenLayersToImage } from '@/lib/flatten-layers'
import { runFluxKontext } from '@/lib/comfyui-flux-kontext'

/**
 * Sous-composant pour les calques vidéo — gère le playbackRate en fonction
 * de la prop `speed`. Utilisé pour les bakes animation ET les overlays
 * atmosphère (pluie, neige, brouillard…) qui ont une vitesse ajustable.
 */
function LayerVideo({ src, speed, style }: { src: string; speed: number; style: React.CSSProperties }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed, src])
  return (
    <video
      ref={videoRef}
      src={src}
      autoPlay
      loop
      // muted retiré 2026-05-06 — les vidéos LTX 2.3 contiennent maintenant
      // le lipsync TTS, l'auteur veut entendre. Si le browser bloque
      // l'autoplay (politique anti-son), il faut un clic utilisateur préalable
      // (ce qui est généralement le cas car l'auteur a cliqué pour générer).
      playsInline
      onLoadedMetadata={(e) => { e.currentTarget.playbackRate = speed }}
      onError={(e) => { console.error('[Canvas] Layer video failed to load:', src, e) }}
      style={style}
    />
  )
}

interface CanvasProps {
  imageUrl: string | null
  npcs: Npc[]
  items: Item[]
  choices: Choice[]
  /** Format sélectionné dans le GenerationPanel — sert à ajuster le ratio
   *  du placeholder quand aucune image n'est encore chargée. */
  format: string
}

export default function Canvas({ imageUrl, npcs, items, choices, format }: CanvasProps) {
  const {
    signalBackgroundClick, cutMode, layers, activeLayerIdx,
    currentVideoUrl, currentVideoFirstFrameUrl, currentVideoPlayId, currentVideoAutoplay,
    animationPellicules, animationSelectedPelliculeId,
    setAnimationPlaying,
    sequencePlayheadIdx, advanceSequencePlayhead,
    addLayer, setBakeStatus,
    updateLayer, setActiveLayer,
    replaceBase,
  } = useEditorState()

  // Animation Phase A : si une pellicule est sélectionnée et qu'aucune vidéo
  // ne joue, le Canvas affiche l'"état initial" de la pellicule selon la table :
  //   pell.firstFrameUrl > prev.lastFrameUrl > base imageUrl
  // (cf design 2026-05-05). Ça permet à l'auteur de voir le point de départ
  // visuel de chaque pellicule au survol/clic, même non encore générée.
  const animationStaticImageUrl = useMemo(() => {
    if (!animationSelectedPelliculeId) return null
    const idx = animationPellicules.findIndex(p => p.id === animationSelectedPelliculeId)
    if (idx < 0) return null
    const pell = animationPellicules[idx]
    if (pell.firstFrameUrl) return pell.firstFrameUrl
    const prev = idx > 0 ? animationPellicules[idx - 1] : null
    if (prev?.lastFrameUrl) return prev.lastFrameUrl
    return null  // tombe sur l'imageUrl base via le rendu standard
  }, [animationSelectedPelliculeId, animationPellicules])

  // L'image affichée dans Canvas. Priorité :
  //   1. animationStaticImageUrl si pellicule sélectionnée (et pas de vidéo qui joue)
  //   2. imageUrl base sinon
  // Le rendu <video> (si currentVideoUrl) reste au-dessus de l'<img>.
  const displayedImageUrl = (!currentVideoUrl && animationStaticImageUrl) || imageUrl

  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // Taille rendue du wrapper en CSS px (pas DPR-multiplied). Utilisée par
  // RainyDayGlassLayer qui a besoin de la taille effective du conteneur pour
  // dimensionner son canvas par-dessus la bbox de chaque zone glass.
  const [wrapperSize, setWrapperSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!wrapperRef.current) return
    const el = wrapperRef.current
    const ro = new ResizeObserver(() => {
      setWrapperSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setWrapperSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const baseVisible = layers[0]?.visible !== false

  // ── Drag & drop perso depuis CatalogCharacters (refonte 2026-05-09) ──
  // Pattern : l'auteur drag une card perso → drop sur le canvas → on crée
  // un calque image avec un `placement` (x, y, scale) normalisé. Pas de
  // Flux Kontext ici : compositing CSS instantané. Le perso peut être
  // repositionné/régénéré ensuite.
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    // En mode découpe, le canvas capte les clics → on n'autorise pas le drop
    // pour ne pas créer de conflit avec les outils SAM/lasso/brush.
    if (cutMode) return
    if (!e.dataTransfer.types.includes('application/json')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (cutMode) return
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/json')
    if (!raw) return
    let parsed: { kind?: string; characterId?: string; characterName?: string; mediaUrl?: string }
    try { parsed = JSON.parse(raw) } catch { return }
    if (parsed.kind !== 'character-placement' || !parsed.mediaUrl) return

    // Coordonnées relatives au wrapper de l'image (pas du canvas global)
    const rect = e.currentTarget.getBoundingClientRect()
    const dropX = (e.clientX - rect.left) / rect.width
    const dropY = (e.clientY - rect.top) / rect.height
    // Scale par défaut : 35% de la hauteur du canvas. Ajustable ensuite par
    // l'auteur (V1 = pas de handles, V1.1 ajoutera resize).
    const scale = 0.35
    const halfW = scale * 0.5
    const halfH = scale * 0.5

    // Chroma-key client-side : la banque stocke les persos sur fond gris
    // #808080 (convention IPAdapter). Pour overlay CSS direct il faut du
    // transparent → on convertit avant d'addLayer. Upload Supabase pour
    // persistence (cf feedback_always_persist_to_supabase). ~1-2s.
    setBakeStatus({
      startedAt: Date.now(),
      kind: 'sam_cut',
      phase: 'Préparation du calque…',
      estimatedTotalSec: 2,
    })
    let mediaUrl = parsed.mediaUrl
    let aspect = 1  // fallback carré si load échoue
    try {
      const transparentUrl = await chromaKeyGrayToTransparent(
        parsed.mediaUrl,
        `studio/dropped_chars/${parsed.characterId ?? 'char'}_${Date.now()}.png`,
      )
      if (transparentUrl) mediaUrl = transparentUrl
      // Calcule l'aspect natural pour le wrapper CSS (V1.1) — permet de
      // positionner les handles de resize sans attendre le load de l'img.
      try {
        const probe = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('aspect probe failed'))
          img.src = mediaUrl
        })
        if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
          aspect = probe.naturalWidth / probe.naturalHeight
        }
      } catch { /* fallback aspect=1 */ }
    } finally {
      setBakeStatus(null)
    }

    addLayer({
      type: 'image',
      media_url: mediaUrl,
      name: parsed.characterName ?? 'Calque',
      visible: true,
      opacity: 1,
      character_id: parsed.characterId ?? null,
      placement: {
        x: Math.max(0, Math.min(1 - halfW * 2, dropX - halfW)),
        y: Math.max(0, Math.min(1 - halfH * 2, dropY - halfH)),
        scale,
        aspect,
      },
    })
  }

  // ── V1.1 : Drag-to-move + resize handle (refonte 2026-05-09) ──────
  // Pattern : pointer down sur le calque actif → suit la souris (move) ou
  // le handle bottom-right → resize uniforme. Bloqué en mode découpe.
  const dragRef = useRef<{
    type: 'move' | 'resize'
    layerIdx: number
    startMouseX: number  // normalisé 0-1 dans le wrapper
    startMouseY: number
    initialPlacement: { x: number; y: number; scale: number; aspect: number }
  } | null>(null)

  function handleStartMove(layerIdx: number) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (cutMode) return
      const layer = layers[layerIdx]
      if (!layer?.placement || !wrapperRef.current) return
      e.stopPropagation()
      e.preventDefault()
      setActiveLayer(layerIdx)
      const r = wrapperRef.current.getBoundingClientRect()
      dragRef.current = {
        type: 'move',
        layerIdx,
        startMouseX: (e.clientX - r.left) / r.width,
        startMouseY: (e.clientY - r.top) / r.height,
        initialPlacement: { ...layer.placement },
      }
      window.addEventListener('pointermove', handleDragMove)
      window.addEventListener('pointerup', handleDragEnd)
    }
  }

  function handleStartResize(layerIdx: number) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (cutMode) return
      const layer = layers[layerIdx]
      if (!layer?.placement || !wrapperRef.current) return
      e.stopPropagation()
      e.preventDefault()
      setActiveLayer(layerIdx)
      const r = wrapperRef.current.getBoundingClientRect()
      dragRef.current = {
        type: 'resize',
        layerIdx,
        startMouseX: (e.clientX - r.left) / r.width,
        startMouseY: (e.clientY - r.top) / r.height,
        initialPlacement: { ...layer.placement },
      }
      window.addEventListener('pointermove', handleDragMove)
      window.addEventListener('pointerup', handleDragEnd)
    }
  }

  function handleDragMove(ev: PointerEvent) {
    const drag = dragRef.current
    if (!drag || !wrapperRef.current) return
    const r = wrapperRef.current.getBoundingClientRect()
    const curX = (ev.clientX - r.left) / r.width
    const curY = (ev.clientY - r.top) / r.height
    const init = drag.initialPlacement

    if (drag.type === 'move') {
      const dx = curX - drag.startMouseX
      const dy = curY - drag.startMouseY
      // Pattern Figma/Photoshop : permet au calque de déborder du canvas
      // (négativement à gauche/haut, ou au-delà à droite/bas) pour pouvoir
      // exposer la poignée resize quand le calque est plus large que le canvas.
      // Garde-fou : au moins 20% du calque doit toujours intersecter le canvas
      // pour que l'auteur puisse le re-grabber. Refonte 2026-05-10 — fix
      // bug "impossible d'atteindre le resize handle quand le calque touche
      // le bord droit du canvas".
      const layerW = init.scale * init.aspect  // largeur normalisée canvas
      const layerH = init.scale                  // hauteur normalisée canvas
      const minVisibleX = Math.min(0.2, layerW * 0.5)
      const minVisibleY = Math.min(0.2, layerH * 0.5)
      const newX = Math.max(minVisibleX - layerW, Math.min(1 - minVisibleX, init.x + dx))
      const newY = Math.max(minVisibleY - layerH, Math.min(1 - minVisibleY, init.y + dy))
      updateLayer(drag.layerIdx, {
        placement: { ...init, x: newX, y: newY },
      })
    } else {
      // Resize : nouveau scale = distance verticale du top du calque à la souris
      // Min 5% pour éviter de réduire à zéro, max 100% du canvas.
      const newScale = Math.max(0.05, Math.min(1, curY - init.y))
      updateLayer(drag.layerIdx, {
        placement: { ...init, scale: newScale },
      })
    }
  }

  function handleDragEnd() {
    dragRef.current = null
    window.removeEventListener('pointermove', handleDragMove)
    window.removeEventListener('pointerup', handleDragEnd)
  }

  // Cleanup global : si le component unmount pendant un drag, retirer listeners
  useEffect(() => () => {
    window.removeEventListener('pointermove', handleDragMove)
    window.removeEventListener('pointerup', handleDragEnd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── V1.2 : "Intégrer avec IA" — refine un calque placé via Kontext ──
  // Pattern hybride : drag-and-drop CSS pour placement rapide, puis Kontext
  // pour intégration finale (shadows + lighting + edge blending). L'auteur
  // garde le contrôle exact sur position/scale, Kontext s'occupe juste du
  // raccord visuel. ~1-2 min Kontext.
  const refiningRef = useRef(false)
  async function handleRefinePlacedLayer(layerIdx: number) {
    if (refiningRef.current) return  // anti-double-click
    if (!imageUrl) return
    const layer = layers[layerIdx]
    if (!layer?.placement) return
    refiningRef.current = true
    setBakeStatus({
      startedAt: Date.now(),
      kind: 'insert_character',
      phase: 'Aplatissement de la scène…',
      estimatedTotalSec: 90,
    })
    try {
      // 1. Flatten = base + ce calque seul (= la scène que voit l'auteur)
      const flatUrl = await flattenLayersToImage({
        baseImageUrl: imageUrl,
        layers: [layers[0], layer],  // base + le calque à refine uniquement
        storagePathPrefix: `studio/refine_placed/${Date.now()}`,
        skipFirstLayerAsBase: true,  // layers[0] = base, dessinée séparément
      })
      setBakeStatus({
        startedAt: Date.now(),
        kind: 'insert_character',
        phase: 'Intégration IA (shadows + lighting)…',
        estimatedTotalSec: 80,
      })
      // 2. Kontext refine — instruction d'intégration (pas d'insertion, le
      //    perso est déjà là dans flatUrl).
      const integrationPrompt = `Naturally integrate the existing character into the scene. Add a soft realistic shadow at the character's feet on the floor matching the scene's lighting direction. Match the character's lighting tone to the surrounding ambient lighting (warm or cool). Soften the character's edges to blend smoothly with the environment. Do NOT change the character's appearance, pose, clothing, identity, position, or scale.`
      const integratedUrl = await runFluxKontext({
        sourceUrl: flatUrl,
        prompt: integrationPrompt,
        guidance: 2.5,
        storagePathPrefix: `studio/refine_placed/${Date.now()}_integrated`,
      })
      // 3. Replace base — cascade delete tous les calques (= le calque placé
      //    est auto-retiré, le perso est maintenant baked dans la nouvelle base).
      replaceBase(integratedUrl)
    } catch (err) {
      console.error('[refine-placed-layer]', err)
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Intégration IA échouée : ${msg}`)
    } finally {
      refiningRef.current = false
      setBakeStatus(null)
    }
  }

  // ── Mode extraction (refonte 2026-05-09) ──────────────────────────
  // Si le calque actif a mode='extraction' (= image chargée pour bosser sur
  // détourage/extraction de personnages), on bypass complètement le rendu
  // base + overlay : on affiche l'image SEULE à sa taille naturelle (contain),
  // sans contrainte d'aspect-ratio du Format. Pas d'overlays NPC/items, pas
  // de calques additionnels, pas de vidéo animation. Outils = Ciseaux only.
  const activeLayerForExtraction = layers[activeLayerIdx]
  const isExtractionMode =
    activeLayerForExtraction?.mode === 'extraction'
    && !!activeLayerForExtraction?.media_url

  return (
    <motion.div
      className="ie-canvas"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
      onClick={(e) => {
        // En mode Découpe : ne pas fermer les folds ni désélectionner si un
        // drag sort des bords de l'image (mouseup outside → click sur .ie-canvas).
        // L'utilisateur a déjà un bouton "Désélectionner la zone" dans le fold.
        if (cutMode) return
        if (e.target === e.currentTarget) signalBackgroundClick()
      }}
    >
      {isExtractionMode ? (
        /* Mode extraction : image natural-size, pas de crop, pas d'overlay
         *  base/calques. Le wrapper laisse l'image décider de son ratio
         *  (max-width/max-height: 100%). object-fit: contain garantit qu'on
         *  voit l'image entière. CanvasOverlay est conservé pour permettre
         *  les outils Découpe (lasso/brush/SAM point/magic wand) de capter
         *  les clics sur l'image. NPCs/items/choices passés vides — pas de
         *  sens en extraction. */
        <div
          ref={wrapperRef}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: '100%',
            borderRadius: 'var(--ie-radius-md)',
            overflow: 'hidden',
            boxShadow: 'var(--ie-shadow-lg)',
            background: 'var(--ie-surface-3)',
          }}
        >
          <img
            ref={imgRef}
            src={activeLayerForExtraction!.media_url!}
            alt={activeLayerForExtraction!.name}
            crossOrigin="anonymous"
            draggable={false}
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              userSelect: 'none',
            }}
          />
          <CanvasOverlay
            imgRef={imgRef}
            npcs={[]}
            items={[]}
            choices={[]}
            onClickEmpty={() => signalBackgroundClick()}
          />
        </div>
      ) : displayedImageUrl ? (
        <>
          {/* Wrapper qui impose le ratio du Format choisi.
              L'image dedans est en object-fit: cover → croppée pour remplir
              entièrement le ratio cible. Quand l'utilisateur change de
              format, l'image se recrope visuellement (preview du prochain
              rendu) sans toucher à l'image source.
              Drag & drop activé : drop d'une card perso depuis CatalogCharacters
              → addLayer avec placement (refonte 2026-05-09). */}
          <div
            ref={wrapperRef}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
              position: 'relative',
              aspectRatio: formatToAspectRatio(format),
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: '100%',
              borderRadius: 'var(--ie-radius-md)',
              overflow: 'hidden',
              boxShadow: 'var(--ie-shadow-lg)',
              transition: 'aspect-ratio 300ms cubic-bezier(0.16, 1, 0.3, 1)',
              background: 'var(--ie-surface-3)',
            }}
          >
            <img
              ref={imgRef}
              src={displayedImageUrl}
              alt="image en édition"
              crossOrigin="anonymous"
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                userSelect: 'none',
                // Base invisible → on garde l'<img> en DOM (pour que imgRef reste
                // valide pour les mesures de CanvasOverlay) mais on le masque visuellement.
                // Si une vidéo de plan animation joue par-dessus, on cache aussi l'img
                // pour ne pas voir un flash de l'image de base avant le 1er frame vidéo.
                visibility: (baseVisible && !currentVideoUrl) ? 'visible' : 'hidden',
              }}
              draggable={false}
            />

            {/*
              Plan animation (kind='animation') : <video> superposée sur l'image base.
              Joue 1× puis fige sur la dernière frame (cf décision 2026-05-03 — la
              vidéo n'est pas un loop d'ambiance, c'est un plan narratif). Le poster
              affiche la 1ère frame pendant le chargement → pas de flash blanc.
              `pointerEvents: none` laisse passer les clics aux overlays (npcs, items).
            */}
            {/* Phase E — couche effet ambiance pour pellicule image_static.
             *  Rendue par-dessus l'image (z-index 1) mais sous la vidéo si une
             *  vidéo joue (currentVideoUrl prioritaire). pointerEvents: none
             *  pour laisser passer les clics aux overlays NPC/items. */}
            {currentVideoUrl && (
              <video
                /* key sur playId → re-mount du <video> à CHAQUE setCurrentVideo
                 * (même URL identique). Force autoplay → permet de re-jouer la
                 * même vidéo via re-clic sur la pellicule. */
                key={`anim-video-${currentVideoPlayId}`}
                src={currentVideoUrl}
                poster={currentVideoFirstFrameUrl ?? undefined}
                autoPlay={currentVideoAutoplay}
                controls
                /* muted retiré 2026-05-06 — la vidéo contient le lipsync TTS,
                 * l'auteur doit entendre. controls visible pour permettre à
                 * l'auteur de relancer la lecture quand currentVideoAutoplay
                 * est false (arrivée initiale sur la section animation). */
                playsInline
                onError={(e) => console.error('[Canvas] Plan animation video failed:', currentVideoUrl, e)}
                /* onPlay : signale que la lecture commence → DesignerLayout
                 * rétracte temporairement la bande basse (canvas redevient visible). */
                onPlay={() => setAnimationPlaying(true)}
                /* À la fin de lecture, 2 comportements possibles :
                 * - Mode séquence (sequencePlayheadIdx !== null) : advance directement
                 *   à la prochaine pellicule générée → pas de seek 0 (évite flash
                 *   firstFrame entre 2 vidéos). advanceSequencePlayhead set le nouvel
                 *   currentVideoUrl + playId++ → re-mount video → autoplay.
                 *   setAnimationPlaying NE PAS faire false ici → la bande basse
                 *   reste rétractée pendant toute la séquence.
                 * - Mode lecture isolée (sequencePlayheadIdx === null) : seek 0 + pause
                 *   → affiche firstFrame statique. setAnimationPlaying(false). */
                onEnded={(e) => {
                  if (sequencePlayheadIdx !== null) {
                    advanceSequencePlayhead()
                    // Note : si advance reset playhead à null (= fin séquence),
                    // setAnimationPlaying restera true jusqu'au prochain onEnded
                    // de la dernière vidéo. À ce moment, sequencePlayheadIdx est
                    // déjà null donc on tombe dans la branche else → seek 0 + pause.
                  } else {
                    const v = e.currentTarget
                    v.pause()
                    try { v.currentTime = 0 } catch {/* edge case browsers */}
                    setAnimationPlaying(false)
                  }
                }}
                onPause={() => setAnimationPlaying(false)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              />
            )}

            {/*
              Composition des calques non-base : chaque calque additionnel
              visible est rendu en overlay position:absolute par-dessus la Base,
              au même ratio (object-fit: cover) → ses pixels s'alignent pixel-
              perfect avec la Base (car le PNG extrait fait la même taille
              natW×natH que la source, transparent hors-sujet).

              Stack : index 1 = juste au-dessus de la Base, index N = tout en haut.
              Le layer courant ne se distingue PAS visuellement du reste (pattern
              Photoshop : tous les calques visibles participent au rendu final).
            */}
            {layers.slice(1).map((layer, i) => {
              if (!layer.visible) return null
              const layerIdx = 1 + i
              const isActive = layerIdx === activeLayerIdx

              // Calque météo (particules) : pas d'URL, juste un ParticleLayer.
              // On NE met PAS le drop-shadow rose d'indicateur d'actif : les
              // centaines de particules hériteraient chacune du halo → l'image
              // entière devient rose. La sélection du calque se voit déjà via
              // l'onglet LayerTabs + le fold Atmosphère en surbrillance.
              if (layer.weather) {
                // Opacité ParticleLayer = layer.opacity (global du calque) ×
                // weather.particleOpacity (spécifique aux particules : permet
                // de baisser la pluie sans toucher aux effets glass qui ont
                // leur propre glassOpacity).
                const particleOpacity = (layer.opacity ?? 1) * (layer.weather.particleOpacity ?? 1)
                const weatherStyle: React.CSSProperties = {
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: particleOpacity,
                  pointerEvents: 'none',
                  userSelect: 'none',
                  zIndex: layerIdx,
                }
                // Lightning a une logique événementielle différente des particules
                // continues : rendu séparé pour éviter de polluer ParticleLayer.
                if (layer.weather.kind === 'lightning') {
                  return (
                    <LightningEffect
                      key={layer._uid}
                      weather={layer.weather}
                      style={weatherStyle}
                    />
                  )
                }
                // Pour la pluie : ParticleLayer rend la pluie + tous les
                // effets non-glass (flaques, éclats, gouttelettes). Les zones
                // glass sont déléguées à RainyDayGlassLayer (canvas séparé).
                //
                // Z-order : "premier dans la liste = au-dessus" → on itère les
                // glass en ordre inversé (en DOM, plus tard = au-dessus).
                //
                // Pas de carve : le calque vitre reste uniforme partout. Sa
                // transparence naturelle (opacité de la zone vitre) laisse voir
                // ce qui est derrière, y compris les ploc rendus par ParticleLayer.
                // Pour rendre les ploc visibles à travers la vitre, l'utilisateur
                // baisse l'opacité de la VITRE (pas de la flaque).
                const glassZones = layer.weather.kind === 'rain'
                  ? (layer.weather.impactZones ?? []).filter(z => z.surface === 'glass')
                  : []
                const glassZonesReversed = [...glassZones].reverse()
                return (
                  <React.Fragment key={layer._uid}>
                    <ParticleLayer
                      weather={layer.weather}
                      style={weatherStyle}
                    />
                    {imageUrl && wrapperSize.w > 0 && wrapperSize.h > 0 && glassZonesReversed.map(zone => (
                      <div
                        key={zone.id}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          zIndex: layerIdx,
                          pointerEvents: 'none',
                          opacity: layer.opacity ?? 1,
                        }}
                      >
                        <RainyDayGlassLayer
                          zoneEntry={zone}
                          bgImageUrl={imageUrl}
                          containerWidth={wrapperSize.w}
                          containerHeight={wrapperSize.h}
                        />
                      </div>
                    ))}
                  </React.Fragment>
                )
              }

              const url = layer.baked_url ?? layer.media_url
              if (!url) return null
              // Filet de sécurité : si l'URL est une blob: (éphémère, morte au
              // refresh), on skip le render → évite onError fail loop. Cf bug
              // 2026-05-03 : layers transparents via image-diff retournaient des
              // blob URL avant le fix d'upload Supabase. Le sanitize au load
              // (EditorStateContext) couvre l'hydratation, ce check couvre les
              // calques ajoutés en mémoire pendant la session (ex: fallback
              // upload Supabase échoué).
              if (url.startsWith('blob:')) {
                if (typeof window !== 'undefined' && !((layer as { _blob_warned?: boolean })._blob_warned)) {
                  console.warn('[Canvas] Skipping layer with ephemeral blob URL:', layer.name, url)
                  ;(layer as { _blob_warned?: boolean })._blob_warned = true
                }
                return null
              }
              // Détection vidéo : regex lenient qui matche `.mp4` / `.webm` n'importe
              // où dans l'URL (y compris dans un query param filename=...mp4, cas
              // des URLs proxy /api/comfyui/media?filename=X.mp4).
              const isVideo = /\.(mp4|webm|mov)/i.test(url)
              // Pour une VIDÉO (motion_brush sort un MP4 plein cadre), on applique
              // un CSS mask-image avec l'alpha du PNG d'extraction (media_url) :
              // seule la région du sujet est visible, le reste laisse voir la Base.
              // MP4 ne supporte pas l'alpha, cette technique contourne cette limite
              // côté navigateur (Chrome/Firefox/Safari modernes).
              const videoMaskUrl = isVideo && layer.type === 'image' ? layer.media_url : null
              // Layers avec `placement` (refonte 2026-05-09 — drag-and-drop) :
              // rendus dans un WRAPPER avec aspectRatio CSS connu → permet de
              // positionner précisément les handles de resize. Quand actif :
              // pointer-events auto + handle bottom-right pour resize.
              // Layers sans placement : comportement historique (full-canvas
              // overlay + object-fit: cover, type des extractions Kontext).
              const isPlaced = !!layer.placement
              if (isPlaced) {
                const p = layer.placement!
                return (
                  <div
                    key={layer._uid}
                    className="ie-placed-layer-wrapper"
                    onPointerDown={handleStartMove(layerIdx)}
                    style={{
                      position: 'absolute',
                      left: `${p.x * 100}%`,
                      top: `${p.y * 100}%`,
                      height: `${p.scale * 100}%`,
                      aspectRatio: `${p.aspect}`,
                      opacity: layer.opacity ?? 1,
                      mixBlendMode: layer.blend && layer.blend !== 'normal' ? layer.blend : undefined,
                      // En mode découpe, on désactive pour que canvas capte
                      // les clics SAM/lasso. Sinon : auto = clic active +
                      // drag déplace dans la même gesture (pattern Photoshop).
                      pointerEvents: cutMode ? 'none' : 'auto',
                      cursor: cutMode ? 'default' : 'move',
                      userSelect: 'none',
                      zIndex: layerIdx,
                      // Liseré + outline rose autour du calque actif
                      outline: isActive ? '2px solid #EC4899' : undefined,
                      outlineOffset: isActive ? '-1px' : undefined,
                      borderRadius: '2px',
                    }}
                  >
                    <img
                      src={url}
                      alt=""
                      crossOrigin="anonymous"
                      draggable={false}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'fill',
                        display: 'block',
                        pointerEvents: 'none',
                        filter: isActive
                          ? 'drop-shadow(0 0 2px rgba(236, 72, 153, 0.6))'
                          : undefined,
                      }}
                      onError={(e) => console.error('[Canvas] Placed layer img failed:', url, e)}
                    />
                    {/* Handle resize bottom-right (visible quand actif).
                     *  Drag → scale uniforme, top-left ancré.
                     *  Position INSIDE le wrapper (right:4px, bottom:4px) plutôt
                     *  qu'outside (-6/-6) — sinon quand le perso atteint le bord
                     *  du canvas, la poignée est clippée par `overflow:hidden`
                     *  du canvas wrapper et devient invisible/ungrabable
                     *  (bug 2026-05-10). Ring blanc + ombre pour rester lisible
                     *  même sur fond chargé. */}
                    {isActive && (
                      <div
                        className="ie-placed-resize-handle"
                        onPointerDown={handleStartResize(layerIdx)}
                        style={{
                          position: 'absolute',
                          right: '4px',
                          bottom: '4px',
                          width: '16px',
                          height: '16px',
                          background: '#EC4899',
                          border: '2px solid white',
                          borderRadius: '3px',
                          cursor: 'nwse-resize',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.55)',
                          pointerEvents: 'auto',
                          zIndex: 10,
                        }}
                        title="Glisser pour redimensionner"
                      />
                    )}
                    {/* Bouton "Intégrer avec IA" (V1.2 refonte 2026-05-09) :
                     *  envoie la scène aplatie à Kontext pour shadows +
                     *  lighting + edge blending → remplace la base + supprime
                     *  ce calque (perso baked propre). ~1-2 min. */}
                    {isActive && !cutMode && (
                      <button
                        type="button"
                        className="ie-placed-refine-btn"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRefinePlacedLayer(layerIdx)
                        }}
                        title="Intégrer ce perso dans la scène avec IA (ombres + lumière)"
                        style={{
                          position: 'absolute',
                          top: '-2.2rem',
                          left: '0',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.3rem 0.7rem',
                          background: '#EC4899',
                          color: 'white',
                          border: 'none',
                          borderRadius: '0.3rem',
                          font: '600 0.7rem inherit',
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                          pointerEvents: 'auto',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ✨ Intégrer avec IA
                      </button>
                    )}
                  </div>
                )
              }
              const layerStyle: React.CSSProperties = {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: layer.opacity ?? 1,
                mixBlendMode: layer.blend && layer.blend !== 'normal' ? layer.blend : undefined,
                pointerEvents: 'none',
                userSelect: 'none',
                zIndex: layerIdx,
                // Liseré rose autour de la silhouette du calque ACTIF.
                filter: isActive
                  ? 'drop-shadow(0 0 2px #EC4899) drop-shadow(0 0 4px rgba(236, 72, 153, 0.6))'
                  : undefined,
                // Masque CSS via l'alpha du PNG d'extraction — clip la vidéo full-
                // frame à la silhouette du sujet uniquement.
                ...(videoMaskUrl && {
                  WebkitMaskImage: `url(${videoMaskUrl})`,
                  maskImage: `url(${videoMaskUrl})`,
                  WebkitMaskSize: '100% 100%',
                  maskSize: '100% 100%',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskMode: 'alpha',
                  maskMode: 'alpha',
                }),
              }
              return isVideo ? (
                <LayerVideo
                  key={layer._uid}
                  src={url}
                  speed={1}
                  style={layerStyle}
                />
              ) : (
                <img
                  key={layer._uid}
                  src={url}
                  alt=""
                  crossOrigin="anonymous"
                  draggable={false}
                  onError={(e) => {
                    console.error('[Canvas] Layer image failed to load:', url, e)
                  }}
                  style={layerStyle}
                />
              )
            })}

            <CanvasOverlay
              imgRef={imgRef}
              npcs={npcs}
              items={items}
              choices={choices}
              onClickEmpty={() => signalBackgroundClick()}
            />

            {/* Étape 1+2 : overlay des objets pré-détectés (bboxes + glow hover).
             *  Visible uniquement quand !cutMode (en mode édition normal). */}
            <SceneDetectionsOverlay imgRef={imgRef} />
          </div>
        </>
      ) : (
        <div
          className="ie-placeholder"
          style={{
            // Le placeholder adopte le ratio du format choisi → l'utilisateur
            // voit à quoi ressemblera l'image avant de générer.
            width: 'min(100%, 70vh)',
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: formatToAspectRatio(format),
            flexDirection: 'column',
            gap: 'var(--ie-space-3)',
            transition: 'aspect-ratio 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <ImageIcon size={48} strokeWidth={1.2} />
          <div>Aucune image — génère ou choisis depuis la banque</div>
          <div style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
            Format : {format}
          </div>
        </div>
      )}
    </motion.div>
  )
}
