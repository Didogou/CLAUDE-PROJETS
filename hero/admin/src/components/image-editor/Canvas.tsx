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
      muted
      playsInline
      // Pas de crossOrigin pour la vidéo : pas besoin de canvas readback
      // et ça évite les échecs CORS si le serveur ne renvoie pas les
      // headers exigés par l'anonymous mode.
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
    currentVideoUrl, currentVideoFirstFrameUrl, currentVideoPlayId,
    animationPellicules, animationSelectedPelliculeId,
    setAnimationPlaying,
    sequencePlayheadIdx, advanceSequencePlayhead,
    sequenceWaitingForChoice, pickSequenceChoice,
  } = useEditorState()

  // Phase E3.5 — Pellicule en attente de choix joueur (overlay sur canvas).
  // Si la séquence est en pause sur une pellicule avec exit='choices',
  // on affiche les boutons des choix par-dessus le canvas.
  const choicesOverlay = useMemo(() => {
    if (!sequenceWaitingForChoice || sequencePlayheadIdx === null) return null
    const pell = animationPellicules[sequencePlayheadIdx]
    if (!pell || !pell.exit || pell.exit.kind !== 'choices') return null
    return pell.exit.options
  }, [sequenceWaitingForChoice, sequencePlayheadIdx, animationPellicules])

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

  // E2.5 — Timer pour image_static en lecture séquence.
  // Quand sequencePlayheadIdx pointe sur une pellicule de type image_static,
  // le Canvas affiche déjà l'image (via displayedImageUrl + setCurrentVideo
  // null dans le reducer). Reste à programmer l'avance auto après duration.
  // Cleanup obligatoire si le playhead change ou le composant unmount → évite
  // les advance fantômes d'anciennes timers.
  useEffect(() => {
    if (sequencePlayheadIdx === null) return
    const currentPell = animationPellicules[sequencePlayheadIdx]
    if (!currentPell || currentPell.type !== 'image_static') return
    // image_static dans séquence → timer pour avancer après duration secondes
    const ms = currentPell.duration * 1000
    const timer = setTimeout(() => {
      advanceSequencePlayhead()
    }, ms)
    return () => clearTimeout(timer)
  }, [sequencePlayheadIdx, animationPellicules, advanceSequencePlayhead])

  // L'image affichée dans Canvas. Priorité :
  //   1. animationStaticImageUrl si pellicule sélectionnée (et pas de vidéo qui joue)
  //   2. imageUrl base sinon
  // Le rendu <video> (si currentVideoUrl) reste au-dessus de l'<img>.
  const displayedImageUrl = (!currentVideoUrl && animationStaticImageUrl) || imageUrl

  // Phase E — Effet ambiance image_static : si la pellicule sélectionnée
  // (ou en cours de lecture séquence) est de type image_static avec un preset
  // effet, on render la couche particules par-dessus l'image. Pas de vidéo
  // qui joue en parallèle (image_static n'a pas de videoUrl).
  const activeImageEffectParams = useMemo(() => {
    if (currentVideoUrl) return null  // priorité vidéo, pas d'effet
    const activeIdx = sequencePlayheadIdx ?? animationPellicules.findIndex(p => p.id === animationSelectedPelliculeId)
    if (activeIdx < 0) return null
    const pell = animationPellicules[activeIdx]
    if (!pell || pell.type !== 'image_static' || !pell.effectPreset) return null
    const preset = WEATHER_PRESETS.find(p => p.key === pell.effectPreset)
    return preset
      ? { params: preset.defaults, opacity: preset.defaultOpacity }
      : null
  }, [currentVideoUrl, sequencePlayheadIdx, animationPellicules, animationSelectedPelliculeId])
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
      {displayedImageUrl ? (
        <>
          {/* Wrapper qui impose le ratio du Format choisi.
              L'image dedans est en object-fit: cover → croppée pour remplir
              entièrement le ratio cible. Quand l'utilisateur change de
              format, l'image se recrope visuellement (preview du prochain
              rendu) sans toucher à l'image source. */}
          <div
            ref={wrapperRef}
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
            {activeImageEffectParams && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 1,
                  pointerEvents: 'none',
                  opacity: activeImageEffectParams.opacity,
                }}
              >
                <ParticleLayer
                  weather={activeImageEffectParams.params}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            )}

            {currentVideoUrl && (
              <video
                /* key sur playId → re-mount du <video> à CHAQUE setCurrentVideo
                 * (même URL identique). Force autoplay → permet de re-jouer la
                 * même vidéo via re-clic sur la pellicule. */
                key={`anim-video-${currentVideoPlayId}`}
                src={currentVideoUrl}
                poster={currentVideoFirstFrameUrl ?? undefined}
                autoPlay
                muted
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

            {/* Phase E3.5 — Overlay choix joueur : la séquence est en attente,
             *  l'utilisateur clique un choix → la séquence reprend sur la
             *  pellicule cible. Z-index élevé pour passer par-dessus tout
             *  (vidéo, effects, layers). */}
            {choicesOverlay && choicesOverlay.length > 0 && (
              <div className="dz-canvas-choices-overlay">
                <div className="dz-canvas-choices-prompt">Que choisis-tu ?</div>
                <div className="dz-canvas-choices-buttons">
                  {choicesOverlay.map((choice, idx) => (
                    <button
                      key={choice.id}
                      type="button"
                      className="dz-canvas-choice-btn"
                      onClick={() => pickSequenceChoice(choice.targetPelliculeId)}
                    >
                      <span className="dz-canvas-choice-num">R{idx + 1}</span>
                      <span className="dz-canvas-choice-label">
                        {choice.label || <em>(choix sans texte)</em>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
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
