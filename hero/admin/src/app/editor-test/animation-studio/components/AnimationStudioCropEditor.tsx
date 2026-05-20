'use client'
/**
 * AnimationStudioCropEditor — pan-and-scan multi-keyframes V3 (Palier D 2026-05-08).
 *
 * UX option D (validée 2026-05-08 après recherche outils pros) :
 *   - Single-view : un téléphone (chassis arrondi) au centre EST la zone d'édition
 *   - La vidéo source vit À L'INTÉRIEUR du téléphone, draggable directement
 *   - Scale : la molette / +/− zoome ou dézoome l'image dans le tel
 *     (scale<1 → letterbox noir visible nativement, comme un vrai écran)
 *   - Pas de side-by-side ni de mini-preview : la vue principale EST la preview
 *
 * Multi-keyframes :
 *   - L'auteur drague à différents temps → keyframes auto-créées
 *   - Le runtime interpole entre les keyframes pour produire un travelling
 *
 * Cf project_designer_animation_screen_redesign_2026_05_07.md + recherche
 *  outils pros (Premiere/DaVinci/CapCut/Kdenlive/FCP) qui convergent tous
 *  vers single-view.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Smartphone, Tablet, RotateCcw, Plus, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import type {
  CropDevice, CropKeyframe, Shot,
} from '@/components/image-editor/EditorStateContext'

interface DeviceSpec {
  label: string
  ratioLabel: string
  resolution: { w: number; h: number }
  ratio: number
}
function makeDeviceSpec(label: string, ratioLabel: string, w: number, h: number): DeviceSpec {
  return { label, ratioLabel, resolution: { w, h }, ratio: w / h }
}
/** Dimensions devices alignées avec StickyPreviewPanel du Studio Section
 *  (iPhone 16 réel, iPad Mini réel) — consistance entre les 2 écrans. */
const DEVICE_RATIOS: Record<CropDevice, DeviceSpec> = {
  phone:           makeDeviceSpec('📱 Mobile',     '393:852',  393,  852),  // iPhone 16
  tabletPortrait:  makeDeviceSpec('📋 Tablette ↕', '744:1133', 744,  1133), // iPad Mini ↕
  tabletLandscape: makeDeviceSpec('📋 Tablette ↔', '1133:744', 1133, 744),  // iPad Mini ↔
}

const SCALE_MIN = 0.3
const SCALE_MAX = 3
const SCALE_STEP_WHEEL = 0.05
const SCALE_STEP_BTN = 0.1
/** Tolérance pour considérer qu'on est "sur" une keyframe (snap). */
const KF_SNAP_THRESHOLD = 0.05

interface AnimationStudioCropEditorProps {
  shot: Shot
  videoAspect: number
  videoResolution?: { w: number; h: number }
  videoUrl?: string | null
  posterUrl?: string | null
  currentTime: number
  playing: boolean
  duration: number
  onSeek: (time: number) => void
  onChange: (cropKeyframes: Shot['cropKeyframes']) => void
}

// ── Math helpers ──────────────────────────────────────────────────────

/** Calcule les dimensions de l'image source affichée DANS le tel pour un
 *  scale et un device donnés.
 *
 *  Convention : à scale=1, la source remplit le téléphone selon le côté
 *  contraignant (= source's smallest dim covers phone) — comportement "fit
 *  to fill" ou "default cover" en termes pano/scan.
 *
 *  - Source plus large que device (videoAspect > deviceAspect) :
 *      à scale=1, hauteur source = hauteur phone, largeur source > largeur phone
 *  - Source plus haute :
 *      à scale=1, largeur source = largeur phone, hauteur source > hauteur phone
 *
 *  scale > 1 → image plus grande, plus de crop
 *  scale < 1 → image plus petite, letterbox apparaît */
function computeImageSize(
  videoAspect: number, deviceAspect: number, scale: number,
): { wRatio: number; hRatio: number } {
  // wRatio/hRatio = taille image en fraction de phone (ex: 1.5 = 150% de phone)
  if (videoAspect >= deviceAspect) {
    // Wide source : à scale=1 → height fits, width overflows
    const hRatio = scale
    const wRatio = scale * (videoAspect / deviceAspect)
    return { wRatio, hRatio }
  } else {
    // Tall source : à scale=1 → width fits, height overflows
    const wRatio = scale
    const hRatio = scale * (deviceAspect / videoAspect)
    return { wRatio, hRatio }
  }
}

/** Interpole linéairement (x, y, scale) à un temps t entre keyframes. */
function interpolateAtTime(
  kfs: CropKeyframe[] | undefined, t: number,
): { x: number; y: number; scale: number } {
  if (!kfs || kfs.length === 0) return { x: 0.5, y: 0.5, scale: 1 }
  const sorted = [...kfs].sort((a, b) => a.time - b.time)
  if (t <= sorted[0].time) return { x: sorted[0].x, y: sorted[0].y, scale: sorted[0].scale }
  const last = sorted[sorted.length - 1]
  if (t >= last.time) return { x: last.x, y: last.y, scale: last.scale }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (a.time <= t && t <= b.time) {
      const span = b.time - a.time
      const k = span > 0 ? (t - a.time) / span : 0
      return {
        x: a.x + k * (b.x - a.x),
        y: a.y + k * (b.y - a.y),
        scale: a.scale + k * (b.scale - a.scale),
      }
    }
  }
  return { x: last.x, y: last.y, scale: last.scale }
}

/** Trouve l'index de la kf "snappée" au temps t (dans KF_SNAP_THRESHOLD). */
function findKeyframeIdxAtTime(kfs: CropKeyframe[] | undefined, t: number): number {
  if (!kfs) return -1
  for (let i = 0; i < kfs.length; i++) {
    if (Math.abs(kfs[i].time - t) <= KF_SNAP_THRESHOLD) return i
  }
  return -1
}

// ── Component ─────────────────────────────────────────────────────────

export default function AnimationStudioCropEditor({
  shot, videoAspect, videoResolution, videoUrl, posterUrl,
  currentTime, playing, duration, onSeek, onChange,
}: AnimationStudioCropEditorProps) {
  const [device, setDevice] = useState<CropDevice>('phone')
  /** Ref vers l'écran du tel (parent du <video> draggable). Sert au drag pour
   *  convertir delta-pixel en delta-coord-phone. */
  const screenRef = useRef<HTMLDivElement>(null)
  /** Ref vers la <video> de l'éditeur. Synchronisée à la vidéo principale du
   *  Lightbox via useEffect (currentTime + playing). */
  const videoElRef = useRef<HTMLVideoElement | null>(null)

  const targetSpec = DEVICE_RATIOS[device]
  const kfs = shot.cropKeyframes?.[device] ?? []
  const activeIdx = findKeyframeIdxAtTime(kfs, currentTime)
  const interp = interpolateAtTime(kfs, currentTime)
  const { wRatio, hRatio } = computeImageSize(videoAspect, targetSpec.ratio, interp.scale)

  // ── Sync vidéo (currentTime + play) ─────────────────────────────────
  useEffect(() => {
    if (!videoUrl) return
    const v = videoElRef.current
    if (!v) return
    if (Math.abs(v.currentTime - currentTime) > 0.15) {
      try { v.currentTime = currentTime } catch { /* readyState too low, ignore */ }
    }
  }, [currentTime, videoUrl])

  useEffect(() => {
    if (!videoUrl) return
    const v = videoElRef.current
    if (!v) return
    if (playing && v.paused) void v.play().catch(() => {/* autoplay block */})
    else if (!playing && !v.paused) v.pause()
  }, [playing, videoUrl])

  // ── Persistance helpers ─────────────────────────────────────────────
  function pushKfs(newKfs: CropKeyframe[]) {
    const next: Shot['cropKeyframes'] = { ...(shot.cropKeyframes ?? {}) }
    if (newKfs.length === 0) {
      delete next[device]
    } else {
      next[device] = [...newKfs].sort((a, b) => a.time - b.time)
    }
    onChange(next)
  }

  function patchKf(idx: number, patch: Partial<CropKeyframe>) {
    const newKfs = kfs.map((kf, i) => i === idx ? { ...kf, ...patch } : kf)
    pushKfs(newKfs)
  }

  function addKeyframe() {
    const newKf: CropKeyframe = {
      time: currentTime,
      x: interp.x,
      y: interp.y,
      scale: interp.scale,
    }
    pushKfs([...kfs, newKf])
  }

  function deleteKeyframe(idx: number) {
    pushKfs(kfs.filter((_, i) => i !== idx))
  }

  function deleteAllKeyframes() {
    pushKfs([])
  }

  // ── Drag de l'image dans le tel ─────────────────────────────────────
  /** Drag : l'utilisateur drague le contenu (sens DIRECT, comme un finger
   *  sur smartphone). Drag droite = la vue se décale → contenu visible côté
   *  gauche du tel = ce qui était à gauche dans la source = source x DIMINUE
   *  (= x dans nos coords, qui est le source-coord visible au centre du tel). */
  function handlePointerDown(e: React.PointerEvent<HTMLVideoElement>) {
    e.preventDefault()
    e.stopPropagation()
    const screen = screenRef.current
    if (!screen) return
    const screenRect = screen.getBoundingClientRect()
    const startMouse = { x: e.clientX, y: e.clientY }
    const startPos = { x: interp.x, y: interp.y }
    const dragWRatio = wRatio
    const dragHRatio = hRatio

    let localKfs: CropKeyframe[] = [...kfs]
    let workingIdx = activeIdx
    if (workingIdx < 0) {
      const newKf: CropKeyframe = {
        time: currentTime,
        x: startPos.x,
        y: startPos.y,
        scale: interp.scale,
      }
      localKfs = [...localKfs, newKf].sort((a, b) => a.time - b.time)
      workingIdx = localKfs.findIndex(kf =>
        kf.time === newKf.time
        && kf.x === newKf.x
        && kf.y === newKf.y
        && kf.scale === newKf.scale
      )
      pushKfs(localKfs)
    }

    function onMove(ev: PointerEvent) {
      // delta_pixels → delta normalisé en phone-coords [0..1] de phone
      const dxPhone = (ev.clientX - startMouse.x) / screenRect.width
      const dyPhone = (ev.clientY - startMouse.y) / screenRect.height
      // delta_x_source = -delta_x_phone / wRatio
      // (drag droite → source center se décale vers la gauche → x diminue)
      // Le facteur 1/wRatio convertit "phone-width" en "source-x normalized".
      const dxSource = -dxPhone / dragWRatio
      const dySource = -dyPhone / dragHRatio
      // Clamp source-coords : si l'image est plus grande que le tel sur un
      // axe, on permet de panner librement dans cet axe (avec bornes pour
      // que le bord de la source reste visible) ; sinon (letterbox), pas de
      // pan utile sur cet axe → snap à 0.5.
      const minX = dragWRatio > 1 ? 0.5 / dragWRatio : 0.5
      const maxX = dragWRatio > 1 ? 1 - 0.5 / dragWRatio : 0.5
      const minY = dragHRatio > 1 ? 0.5 / dragHRatio : 0.5
      const maxY = dragHRatio > 1 ? 1 - 0.5 / dragHRatio : 0.5
      const newX = Math.max(minX, Math.min(maxX, startPos.x + dxSource))
      const newY = Math.max(minY, Math.min(maxY, startPos.y + dySource))
      localKfs = localKfs.map((kf, i) =>
        i === workingIdx ? { ...kf, x: newX, y: newY } : kf
      )
      pushKfs(localKfs)
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Scale (zoom in/out) ─────────────────────────────────────────────
  function changeScale(delta: number) {
    const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, interp.scale + delta))
    if (Math.abs(newScale - interp.scale) < 1e-4) return
    if (activeIdx >= 0) {
      patchKf(activeIdx, { scale: newScale })
    } else {
      const newKf: CropKeyframe = {
        time: currentTime,
        x: interp.x,
        y: interp.y,
        scale: newScale,
      }
      pushKfs([...kfs, newKf])
    }
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    changeScale(e.deltaY < 0 ? SCALE_STEP_WHEEL : -SCALE_STEP_WHEEL)
  }

  // ── UI helpers ──────────────────────────────────────────────────────
  const dragAxisHint = activeIdx >= 0
    ? '🟢 Keyframe active — drag/wheel pour ajuster'
    : kfs.length === 0
      ? '+ Drag pour ajouter une keyframe au temps courant'
      : '↻ Scrub vers une keyframe ou clique +'

  function fmt(t: number) {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // ── Position de l'image dans l'écran tel ────────────────────────────
  // image_w = wRatio × screenW, image_h = hRatio × screenH (en CSS %)
  // Position top-left dans l'écran tel :
  //   left = (0.5 - x × wRatio) × 100% (en % de screenW)
  //   top  = (0.5 - y × hRatio) × 100%
  // Quand x=0.5 et wRatio=1 → left = 0 (image bord gauche au bord gauche tel)
  // Quand x=0 et wRatio=2 → left = 0.5×100 = 50% (image décalée à droite,
  //   = tel voit la partie gauche de la source)
  const imageStyle: React.CSSProperties = {
    position: 'absolute',
    width: `${wRatio * 100}%`,
    height: `${hRatio * 100}%`,
    left: `${(0.5 - interp.x * wRatio) * 100}%`,
    top: `${(0.5 - interp.y * hRatio) * 100}%`,
    objectFit: 'fill',
    cursor: 'grab',
    touchAction: 'none',
    userSelect: 'none',
  }

  return (
    <div className="as-crop-editor">
      {/* Tabs device */}
      <div className="as-crop-tabs">
        {(Object.keys(DEVICE_RATIOS) as CropDevice[]).map(d => {
          const isActive = d === device
          const isSet = (shot.cropKeyframes?.[d]?.length ?? 0) > 0
          const spec = DEVICE_RATIOS[d]
          return (
            <button
              type="button"
              key={d}
              className={`as-crop-tab ${isActive ? 'active' : ''}`}
              onClick={() => setDevice(d)}
              title={`${spec.label} — ${spec.resolution.w}×${spec.resolution.h} px (${spec.ratioLabel})`}
            >
              {d === 'phone' ? <Smartphone size={13} /> : <Tablet size={13} />}
              <span className="as-crop-tab-label">{spec.label}</span>
              <span className="as-crop-tab-ratio">{spec.ratioLabel}</span>
              {isSet && <span className="as-crop-dot" aria-label={`${kfs.length} keyframes`} />}
            </button>
          )
        })}
      </div>

      {/* Body : single-view phone au centre, image source dedans */}
      <div className="as-crop-body" onWheel={handleWheel}>
        <div className="as-crop-phone-stage">
          <div className="as-crop-phone-frame">
            <div
              ref={screenRef}
              className={`as-crop-phone-screen ${activeIdx >= 0 ? 'active' : ''}`}
              style={{ aspectRatio: targetSpec.ratio } as React.CSSProperties}
            >
              {videoUrl ? (
                <video
                  ref={videoElRef}
                  src={videoUrl}
                  poster={posterUrl ?? undefined}
                  muted
                  playsInline
                  preload="auto"
                  style={imageStyle}
                  onPointerDown={handlePointerDown}
                  draggable={false}
                />
              ) : posterUrl ? (
                <img
                  src={posterUrl}
                  alt={`Cadrage ${targetSpec.label}`}
                  style={imageStyle}
                  onPointerDown={handlePointerDown as unknown as React.PointerEventHandler<HTMLImageElement>}
                  draggable={false}
                />
              ) : (
                <div className="as-crop-phone-empty">Pas d&apos;aperçu</div>
              )}
            </div>
          </div>
          <div className="as-crop-phone-meta">
            {targetSpec.label} · {targetSpec.resolution.w}×{targetSpec.resolution.h} · scale {interp.scale.toFixed(2)}×
            {videoResolution && ` · source ${videoResolution.w}×${videoResolution.h}`}
          </div>
        </div>
      </div>

      {/* Zoom toolbar */}
      <div className="as-crop-zoom-row">
        <button
          type="button"
          className="as-crop-zoom-btn"
          onClick={() => changeScale(-SCALE_STEP_BTN)}
          disabled={interp.scale <= SCALE_MIN + 1e-4}
          title="Dézoomer (image plus petite, letterbox sur le tel)"
          aria-label="Dézoomer"
        >
          <ZoomOut size={13} />
        </button>
        <span className="as-crop-zoom-value" title={`Scale ${interp.scale.toFixed(2)}× — bornes ${SCALE_MIN}..${SCALE_MAX}`}>
          {interp.scale.toFixed(2)}×
        </span>
        <button
          type="button"
          className="as-crop-zoom-btn"
          onClick={() => changeScale(SCALE_STEP_BTN)}
          disabled={interp.scale >= SCALE_MAX - 1e-4}
          title="Zoomer (cadre plus serré sur le sujet)"
          aria-label="Zoomer"
        >
          <ZoomIn size={13} />
        </button>
      </div>

      {/* Timeline keyframes */}
      <div className="as-crop-timeline">
        <button
          type="button"
          className="as-crop-add-kf"
          onClick={addKeyframe}
          title="Ajouter une keyframe au temps courant"
          disabled={activeIdx >= 0}
        >
          <Plus size={11} />
          <span>Keyframe ici ({fmt(currentTime)})</span>
        </button>
        <div
          className="as-crop-timeline-track"
          onClick={(e) => {
            const track = e.currentTarget
            const r = track.getBoundingClientRect()
            const k = (e.clientX - r.left) / r.width
            onSeek(Math.max(0, Math.min(duration, k * duration)))
          }}
        >
          {duration > 0 && (
            <div
              className="as-crop-timeline-cursor"
              style={{ left: `${(currentTime / duration) * 100}%` }}
            />
          )}
          {kfs.map((kf, idx) => (
            <button
              type="button"
              key={`${kf.time}-${idx}`}
              className={`as-crop-kf-marker ${idx === activeIdx ? 'active' : ''}`}
              style={{ left: duration > 0 ? `${(kf.time / duration) * 100}%` : '0%' }}
              onClick={(e) => {
                e.stopPropagation()
                onSeek(kf.time)
              }}
              title={`Keyframe @ ${fmt(kf.time)} — click pour seek`}
            />
          ))}
        </div>
        {activeIdx >= 0 && (
          <button
            type="button"
            className="as-crop-delete-kf"
            onClick={() => deleteKeyframe(activeIdx)}
            title="Supprimer la keyframe active"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="as-crop-footer">
        <button
          type="button"
          className="as-crop-reset"
          onClick={deleteAllKeyframes}
          disabled={kfs.length === 0}
          title="Tout effacer pour ce device"
        >
          <RotateCcw size={11} />
          <span>Tout effacer</span>
        </button>
        <span className="as-crop-hint">{dragAxisHint}</span>
        <span className="as-crop-dims">
          {kfs.length} keyframe{kfs.length > 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
