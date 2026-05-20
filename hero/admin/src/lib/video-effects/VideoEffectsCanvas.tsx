'use client'
/**
 * VideoEffectsCanvas — Phase B catalogue complet (refonte 2026-05-15bn).
 *
 * Pipeline : <video> HTML caché → THREE.VideoTexture → quad fullscreen avec
 * material basic (juste sample) → EffectComposer (@react-three/postprocessing)
 * qui applique en chaîne les effets cinéma → <canvas> WebGL.
 *
 * Ordre des effets (important — color basics AVANT cinéma) :
 *   1. BrightnessContrast (color base)
 *   2. HueSaturation (color base)
 *   3. ChromaticAberration (cinéma)
 *   4. Bloom (HDR halations)
 *   5. Pixelation (rétro 8-bit)
 *   6. Glitch (datamosh ponctuel)
 *   7. Noise (film grain — toujours en dernier)
 *   8. Vignette (assombrissement bords — toujours en dernier)
 *
 * Cas d'usage Hero : color grading + effets cinéma temps réel sur preview
 * pellicule animation, sans ré-encodage MP4 source.
 */

import React, { useRef, useEffect, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import {
  EffectComposer, BrightnessContrast, HueSaturation, Vignette, Noise,
  ChromaticAberration, Bloom, Pixelation, Glitch,
  Sepia, DotScreen, Scanline, Grid, ColorAverage, ColorDepth, LUT,
} from '@react-three/postprocessing'
import { BlendFunction, GlitchMode } from 'postprocessing'
import * as THREE from 'three'
import { useLutTexture } from './useLutTexture'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface VideoEffectsParams {
  /** -1 (sombre) → 0 (neutre) → +1 (sur-exposé). Default 0. */
  brightness?: number
  /** -1 (mou) → 0 (neutre) → +1 (très contrasté). Default 0. */
  contrast?: number
  /** -1 (n&b) → 0 (neutre) → +1 (très saturé). Default 0. */
  saturate?: number
  /** -1 → 0 (neutre) → +1 (rotation hue, 1 = 360°). Default 0. */
  hue?: number
  /** 0 (off) → 1 (vignette intense). Default 0. */
  vignette?: number
  /** 0 (off) → 1 (très granuleux). Default 0. */
  filmGrain?: number
  /** 0 (off) → 1 (forte aberration RGB). Default 0. */
  chromaticAberration?: number
  /** 0 (off) → 1 (bloom intense). Default 0. */
  bloom?: number
  /** 0 (off) → 1 (très pixelisé). Default 0. */
  pixelate?: number
  /** Mode glitch — sporadic = aléatoire, constant = continu, off = désactivé. */
  glitch?: 'off' | 'sporadic' | 'constant'
  // ── Nouveaux effets POC catalogue étendu (refonte 2026-05-15bv) ────────────
  /** 0 (off) → 1 (sépia complet). */
  sepia?: number
  /** 0 (off) → 1 (halftone très marqué). */
  dotScreen?: number
  /** 0 (off) → 1 (scanlines CRT marquées). */
  scanline?: number
  /** 0 (off) → 1 (grille HUD opaque). */
  grid?: number
  /** 0 (off) → 1 (image moyennée monochrome). */
  colorAverage?: number
  /** 0 (off) → 1 (réduction couleurs 8-bit posterize). 1 = 4 bits par canal. */
  colorDepth?: number
  /** Preset cinéma (override les autres params). null = pas de preset. */
  preset?: keyof typeof PRESETS | null
}

interface VideoEffectsCanvasProps {
  videoUrl: string
  params?: VideoEffectsParams
  width?: string | number
  height?: string | number
  aspectRatio?: number
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  /** Callback ref vers le <video> interne — remplace le hack querySelector.
   *  Appelé à chaque (re)montage avec l'élément actif, et avec null au démontage.
   *  Refonte 2026-05-15bz — fixe race StrictMode dev qui pointait sur un orphelin
   *  après cleanup (src='' → play() rejette NotSupportedError). */
  onVideoElement?: (v: HTMLVideoElement | null) => void
  /** URL d'une LUT 3D `.cube` (Adobe Cube LUT 1.0) à appliquer EN PREMIER
   *  dans la chaîne d'effets. Refonte 2026-05-15cb — adoption standard LUT.
   *  Si null/undefined : aucune LUT, fallback sur les params shader seuls. */
  lutUrl?: string | null
  /** Callback notifié quand le ratio source est détecté (loadedmetadata).
   *  Refonte 2026-05-15cw — permet au parent d'adapter le wrapper externe
   *  (ex: efx-preview-box) au format réel de la vidéo source. */
  onAspectChange?: (aspect: number) => void
}

// ─── Presets paramétriques ─────────────────────────────────────────────────
// V1 = recettes de réglages plutôt que vrais LUT 3D. Donne 80% du look ciné
// pour 5% du coût. V2 si besoin = parser .cube + LUT3D effect réel.

// Refonte 2026-05-15bt — calibration prudente après que cinema_warm ait été
// validé visuellement par l'auteur. Mêmes ordres de grandeur, juste la teinte
// (hue) et la saturation déplacées dans la bonne direction selon le look visé.
export const PRESETS = {
  cinema_warm: {
    brightness: 0.05, contrast: 0.15, saturate: 0.1, hue: 0.02,
    vignette: 0.3, filmGrain: 0.05,
  },
  cinema_cold: {
    // Mirroir de cinema_warm : hue négatif léger (vers bleu), saturation
    // basse mais non-négative pour éviter le bug visuel observé sur −0.15.
    brightness: 0.02, contrast: 0.15, saturate: 0.05, hue: -0.04,
    vignette: 0.3, filmGrain: 0.05,
  },
  noir: {
    // Saturation à 0 (= n&b), pas −1 (le clamp peut faire des trucs étranges).
    brightness: 0.03, contrast: 0.3, saturate: 0, hue: 0,
    vignette: 0.45, filmGrain: 0.12,
  },
  retro_80s: {
    brightness: 0.04, contrast: 0.1, saturate: 0.2, hue: 0.03,
    vignette: 0.2, chromaticAberration: 0.2, bloom: 0.4,
  },
  cyberpunk: {
    brightness: 0.0, contrast: 0.2, saturate: 0.3, hue: -0.06,
    vignette: 0.35, bloom: 0.5, chromaticAberration: 0.15,
  },
} as const

export const PRESET_LABELS: Record<keyof typeof PRESETS, string> = {
  cinema_warm: 'Cinéma chaud',
  cinema_cold: 'Cinéma froid',
  noir: 'Noir & blanc',
  retro_80s: 'Rétro 80s',
  cyberpunk: 'Cyberpunk',
}

function resolveParams(params: VideoEffectsParams): Required<Omit<VideoEffectsParams, 'preset' | 'glitch'>> & { glitch: VideoEffectsParams['glitch'] } {
  const base: Required<Omit<VideoEffectsParams, 'preset' | 'glitch'>> = {
    brightness: 0, contrast: 0, saturate: 0, hue: 0,
    vignette: 0, filmGrain: 0, chromaticAberration: 0, bloom: 0, pixelate: 0,
    sepia: 0, dotScreen: 0, scanline: 0, grid: 0, colorAverage: 0, colorDepth: 0,
  }
  const fromPreset = params.preset ? PRESETS[params.preset] : null
  return {
    brightness: params.brightness ?? fromPreset?.brightness ?? base.brightness,
    contrast: params.contrast ?? fromPreset?.contrast ?? base.contrast,
    saturate: params.saturate ?? fromPreset?.saturate ?? base.saturate,
    hue: params.hue ?? fromPreset?.hue ?? base.hue,
    vignette: params.vignette ?? fromPreset?.vignette ?? base.vignette,
    filmGrain: params.filmGrain
      ?? (fromPreset && 'filmGrain' in fromPreset ? fromPreset.filmGrain : base.filmGrain),
    chromaticAberration: params.chromaticAberration
      ?? (fromPreset && 'chromaticAberration' in fromPreset ? fromPreset.chromaticAberration : 0),
    bloom: params.bloom
      ?? (fromPreset && 'bloom' in fromPreset ? fromPreset.bloom : 0),
    pixelate: params.pixelate ?? base.pixelate,
    sepia: params.sepia ?? base.sepia,
    dotScreen: params.dotScreen ?? base.dotScreen,
    scanline: params.scanline ?? base.scanline,
    grid: params.grid ?? base.grid,
    colorAverage: params.colorAverage ?? base.colorAverage,
    colorDepth: params.colorDepth ?? base.colorDepth,
    glitch: params.glitch ?? 'off',
  }
}

// ─── Composants 3D internes ────────────────────────────────────────────────

/** Quad fullscreen qui samplifie la vidéo (sans color logic — laissé aux effets). */
function VideoPlane({ video }: { video: HTMLVideoElement }) {
  const texture = useMemo(() => {
    const t = new THREE.VideoTexture(video)
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    // Refonte 2026-05-15br — colorSpace en NoColorSpace (= linéaire pass-through).
    // SRGBColorSpace gonflait les valeurs (sRGB→linear ×~2.2) avant le composer,
    // BrightnessContrast/HueSaturation overflowaient → clamp blanc cramé. Le
    // renderer convertit en sortie via gl.outputColorSpace = SRGB.
    t.colorSpace = THREE.NoColorSpace
    return t
  }, [video])

  const material = useMemo(() => new THREE.MeshBasicMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }), [texture])

  // Force texture update à chaque frame pour suivre la vidéo en lecture
  useFrame(() => {
    texture.needsUpdate = true
  })

  return (
    <mesh material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

// ─── Composant exporté ─────────────────────────────────────────────────────

export default function VideoEffectsCanvas({
  videoUrl, params = {}, width = '100%', height = '100%', aspectRatio,
  autoPlay = true, loop = true, muted = true, onVideoElement, lutUrl,
  onAspectChange,
}: VideoEffectsCanvasProps) {
  // Charge la LUT 3D si fournie. null tant que l'asset n'est pas prêt.
  const lutTexture = useLutTexture(lutUrl ?? null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoEl, setVideoEl] = React.useState<HTMLVideoElement | null>(null)
  const [detectedAspect, setDetectedAspect] = React.useState<number | null>(null)

  // Stable ref vers le callback parent (évite de re-trigger l'effet à chaque render)
  const onVideoElementRef = useRef(onVideoElement)
  useEffect(() => { onVideoElementRef.current = onVideoElement }, [onVideoElement])

  // Refonte 2026-05-15ce — Création du <video> dépend UNIQUEMENT de videoUrl.
  // Les changements de loop/muted/autoPlay sont synchronisés via effets séparés
  // SANS recréer l'élément (sinon le sniper tracker tient une ref stale → src
  // vide → play() rejette NotSupportedError).
  useEffect(() => {
    const v = document.createElement('video')
    v.src = videoUrl
    v.crossOrigin = 'anonymous'
    v.playsInline = true
    v.style.display = 'none'
    document.body.appendChild(v)
    videoRef.current = v
    setVideoEl(v)
    onVideoElementRef.current?.(v)
    const onMeta = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        const a = v.videoWidth / v.videoHeight
        setDetectedAspect(a)
        // Refonte 2026-05-15cw — notifie aussi le parent du ratio détecté.
        onAspectChange?.(a)
      }
    }
    v.addEventListener('loadedmetadata', onMeta)
    // Si la metadata est déjà chargée au mount (ex: cache navigateur), fire immédiatement.
    if (v.readyState >= 1 && v.videoWidth > 0) {
      onMeta()
    }
    return () => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.pause()
      v.src = ''
      v.remove()
      videoRef.current = null
      setVideoEl(null)
      onVideoElementRef.current?.(null)
    }
  }, [videoUrl])

  // Sync loop/muted sans recréer l'élément
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.loop = loop
    v.muted = muted
  }, [loop, muted])

  // autoPlay initial — déclenche play() une seule fois quand le video est prêt.
  // Ne re-run pas tant que videoUrl n'a pas changé (= flag pour autoplay only-once).
  const autoPlayDoneRef = useRef(false)
  useEffect(() => {
    autoPlayDoneRef.current = false
  }, [videoUrl])
  useEffect(() => {
    const v = videoRef.current
    if (!v || !autoPlay || autoPlayDoneRef.current) return
    autoPlayDoneRef.current = true
    void v.play().catch(() => { /* autoplay blocked */ })
  }, [autoPlay, videoEl])

  const p = useMemo(() => resolveParams(params), [params])

  const finalAspect = aspectRatio ?? detectedAspect ?? 16 / 9

  // Conversions vers les API postprocessing
  // - HueSaturation : hue en radians, saturation [-1..1]
  // - BrightnessContrast : brightness [-1..1], contrast [-1..1]
  // - Vignette : darkness [0..1], offset (smooth) [0..1]
  // - ChromaticAberration : Vector2 offset (small values 0..0.005)
  // - Bloom : intensity (luminanceThreshold géré séparément)
  // - Pixelation : granularity en pixels (mappons 0..1 → 0..16)
  // - Noise : opacity [0..1]

  return (
    <div style={{
      width, height,
      // Refonte 2026-05-15cw — n'applique aspect-ratio que si pas de height
      // explicite (sinon override pénible). Le parent (ex: efx-preview-box)
      // gère déjà l'aspect quand height='100%'.
      ...(height === '100%' ? {} : { aspectRatio: finalAspect }),
      background: '#000', position: 'relative',
    }}>
      {videoEl && (
        <Canvas
          orthographic
          // Refonte 2026-05-15bo — camera ortho en NDC (-1..1) pour matcher
          // le plane 2x2 fullscreen. Default R3F = bounds en pixels → plane
          // de 2 unités = 2 pixels = invisible (canvas tout noir).
          camera={{ position: [0, 0, 1], left: -1, right: 1, top: 1, bottom: -1, near: 0, far: 2 }}
          // Refonte 2026-05-15br — outputColorSpace = SRGB pour conversion
          // linear → sRGB en sortie (la VideoTexture est marquée linéaire en
          // amont, le composer travaille en linéaire, et le renderer convertit
          // au moment d'écrire sur le canvas final).
          // Refonte 2026-05-15cr — preserveDrawingBuffer:true pour permettre
          // drawImage(webglCanvas) côté composer Phase D (sinon frame buffer
          // est vidé après chaque draw → screenshot noir).
          gl={{ antialias: false, alpha: false, outputColorSpace: THREE.SRGBColorSpace, preserveDrawingBuffer: true }}
          // Refonte 2026-05-15cu — dpr=1 fixe (au lieu de [1, 2]) pour éviter
          // le lag rAF sur écrans Retina (canvas 2× pixels = 4× coût GPU avec
          // LUT 3D + composer = preview au ralenti perçu, fixe au F12 car
          // viewport rétrécit). L'export bakeé utilise videoEl.videoWidth
          // natif (pas le canvas CSS), donc qualité d'export inchangée.
          dpr={1}
          style={{ width: '100%', height: '100%' }}
        >
          <VideoPlane video={videoEl} />
          <EffectComposer multisampling={0}>
            {/* LUT 3D EN PREMIER (color grading pro). Refonte 2026-05-15cb. */}
            {lutTexture ? (
              <LUT lut={lutTexture} tetrahedralInterpolation />
            ) : <></>}
            <BrightnessContrast brightness={p.brightness} contrast={p.contrast} />
            <HueSaturation hue={p.hue * Math.PI} saturation={p.saturate} />
            {/* Sépia (refonte 2026-05-15bv) — opacity 0..1, BlendFunction NORMAL */}
            {p.sepia > 0 ? (
              <Sepia intensity={p.sepia} blendFunction={BlendFunction.NORMAL} />
            ) : <></>}
            {/* ColorAverage : moyenne globale de couleur (look monochrome créatif) */}
            {p.colorAverage > 0 ? (
              <ColorAverage blendFunction={BlendFunction.NORMAL} />
            ) : <></>}
            {/* ColorDepth : posterize 8-bit (1 = 4 bits → couleurs plates rétro) */}
            {p.colorDepth > 0 ? (
              <ColorDepth bits={Math.max(2, Math.round(8 - p.colorDepth * 6))} />
            ) : <></>}
            {p.chromaticAberration > 0 ? (
              <ChromaticAberration
                offset={new THREE.Vector2(p.chromaticAberration * 0.005, p.chromaticAberration * 0.005)}
                radialModulation={false}
                modulationOffset={0}
              />
            ) : <></>}
            {p.bloom > 0 ? (
              <Bloom intensity={p.bloom * 1.2} luminanceThreshold={0.6} luminanceSmoothing={0.3} mipmapBlur />
            ) : <></>}
            {p.pixelate > 0 ? (
              <Pixelation granularity={Math.round(p.pixelate * 16)} />
            ) : <></>}
            {p.glitch && p.glitch !== 'off' ? (
              <Glitch
                delay={new THREE.Vector2(1.5, 3.5)}
                duration={new THREE.Vector2(0.3, 1.0)}
                strength={new THREE.Vector2(0.2, 0.6)}
                mode={p.glitch === 'constant' ? GlitchMode.CONSTANT_MILD : GlitchMode.SPORADIC}
                active
                ratio={0.85}
              />
            ) : <></>}
            {p.filmGrain > 0 ? (
              <Noise opacity={p.filmGrain * 0.5} blendFunction={BlendFunction.OVERLAY} premultiply />
            ) : <></>}
            {/* DotScreen — halftone style BD/Pop Art (refonte 2026-05-15bv).
             *  Refonte 2026-05-15cb : BlendFunction OVERLAY (au lieu de NORMAL)
             *  pour superposer les dots à l'image source au lieu d'écraser ;
             *  scale boosté pour des dots visibles (sinon mini-points = noir). */}
            {p.dotScreen > 0 ? (
              <DotScreen
                angle={Math.PI * 0.25}
                scale={1 + p.dotScreen * 12}
                blendFunction={BlendFunction.OVERLAY}
              />
            ) : <></>}
            {/* Scanline CRT (lignes horizontales fines) */}
            {p.scanline > 0 ? (
              <Scanline
                density={1.25}
                opacity={p.scanline * 0.5}
                blendFunction={BlendFunction.OVERLAY}
              />
            ) : <></>}
            {/* Grid HUD (rétro / sci-fi) */}
            {p.grid > 0 ? (
              <Grid
                scale={1 + p.grid * 4}
                lineWidth={p.grid * 0.4}
                blendFunction={BlendFunction.OVERLAY}
              />
            ) : <></>}
            {p.vignette > 0 ? (
              <Vignette darkness={p.vignette} offset={0.3} />
            ) : <></>}
          </EffectComposer>
        </Canvas>
      )}
    </div>
  )
}
