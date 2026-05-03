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
import React, { useEffect, useRef, useState } from 'react'
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
  const { signalBackgroundClick, cutMode, layers, activeLayerIdx } = useEditorState()
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
      {imageUrl ? (
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
              src={imageUrl}
              alt="image en édition"
              crossOrigin="anonymous"
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                userSelect: 'none',
                // Base invisible → on garde l'<img> en DOM (pour que imgRef reste
                // valide pour les mesures de CanvasOverlay) mais on le masque visuellement
                visibility: baseVisible ? 'visible' : 'hidden',
              }}
              draggable={false}
            />

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
