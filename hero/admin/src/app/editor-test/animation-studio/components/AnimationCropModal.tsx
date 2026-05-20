'use client'
/**
 * AnimationCropModal — éditeur de cadrage pan-and-scan au niveau ANIMATION
 * (Palier D V3 2026-05-08).
 *
 * Refonte demandée par l'auteur 2026-05-08 : le cadrage doit être défini sur
 * l'animation entière (= toutes les pellicules concaténées en séquence), pas
 * par-pellicule. Permet à un travelling de traverser les frontières P1→P2.
 *
 * Architecture (option D — recherche outils pros validée) :
 *   - Modal verrouillé (click outside / Échap ne ferment pas)
 *   - Single-view : un téléphone avec image source à l'intérieur, draggable
 *   - Multi-vidéo stackées (option D) : N pellicules, une seule visible à la
 *     fois selon le temps global. Switch automatique aux frontières.
 *   - Timeline globale [0..totalDuration] avec markers keyframes + frontières
 *     pellicules (lignes verticales)
 *   - Onglets device (phone / tablette ↕ / tablette ↔) avec leurs propres kf
 *
 * Persistance via setAnimationCropKeyframes (au niveau EditorState).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Play, Pause, Smartphone, Tablet, RotateCcw, Plus, Trash2,
  ZoomIn, ZoomOut,
} from 'lucide-react'
import type {
  AnimationPellicule, CropDevice, CropKeyframe,
} from '@/components/image-editor/EditorStateContext'

// ── Specs devices (alignées avec StickyPreviewPanel + AnimationStudioPreview) ─
interface DeviceSpec {
  label: string
  ratioLabel: string
  resolution: { w: number; h: number }
  ratio: number
}
function makeDeviceSpec(label: string, ratioLabel: string, w: number, h: number): DeviceSpec {
  return { label, ratioLabel, resolution: { w, h }, ratio: w / h }
}
const DEVICE_RATIOS: Record<CropDevice, DeviceSpec> = {
  phone:           makeDeviceSpec('📱 Mobile',     '393:852',  393,  852),
  tabletPortrait:  makeDeviceSpec('📋 Tablette ↕', '744:1133', 744,  1133),
  tabletLandscape: makeDeviceSpec('📋 Tablette ↔', '1133:744', 1133, 744),
}

/** Sémantique scale (refonte 2026-05-08) : scale=1 = FIT-CONTAIN (image
 *  entièrement visible avec letterbox). scale>1 = image grandit, finit par
 *  cropper. Pour passer en plein cover (= remplir le tel), il faut scale ≈
 *  videoAspect/deviceAspect (= ~3.94 pour 16:9 sur 9:19.5). */
const SCALE_MIN = 0.3
const SCALE_MAX = 5  // allows fit-cover (≈3.94 pour 16:9→9:19.5) + zoom in
const SCALE_STEP_WHEEL = 0.05
const SCALE_STEP_BTN = 0.15
const KF_SNAP_THRESHOLD = 0.1  // 100ms — un peu plus tolérant qu'avant car
                               // currentTime global a plus de variabilité

// ── Math helpers ──────────────────────────────────────────────────────

/** Sémantique fit-CONTAIN à scale=1 — temporaire en attendant le refacto
 *  option C complet. À scale=1 l'image fits-contain dans le tel ; à scale>1
 *  elle grossit (et finit par cropper). */
function computeImageSize(
  videoAspect: number, deviceAspect: number, scale: number,
): { wRatio: number; hRatio: number } {
  let baseW: number, baseH: number
  if (videoAspect >= deviceAspect) {
    baseW = 1
    baseH = deviceAspect / videoAspect
  } else {
    baseW = videoAspect / deviceAspect
    baseH = 1
  }
  return { wRatio: baseW * scale, hRatio: baseH * scale }
}

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

function findKeyframeIdxAtTime(kfs: CropKeyframe[] | undefined, t: number): number {
  if (!kfs) return -1
  for (let i = 0; i < kfs.length; i++) {
    if (Math.abs(kfs[i].time - t) <= KF_SNAP_THRESHOLD) return i
  }
  return -1
}

// ── Pellicule sequencing helpers ──────────────────────────────────────

interface PelliculeWithOffset {
  pellicule: AnimationPellicule
  startTime: number  // sec depuis début animation
  endTime: number    // sec depuis début animation
  duration: number   // sec
}

/** Construit les offsets cumulatifs des pellicules.
 *  Priorité de calcul de durée :
 *    1. actualDurations[id] = durée RÉELLE du <video> (depuis onLoadedMetadata)
 *    2. fallback : somme des shots.duration (= durée estimée TTS, peut différer
 *       sensiblement de la vraie durée du fichier vidéo)
 *  La 1ère est plus précise — elle bouge dès qu'une vidéo charge ses métadonnées. */
function buildPelliculeOffsets(
  pellicules: AnimationPellicule[],
  actualDurations: Record<string, number>,
): {
  list: PelliculeWithOffset[]
  totalDuration: number
} {
  let acc = 0
  const list = pellicules.map(p => {
    const fallbackDur = p.shots.reduce((s, sh) => s + sh.duration, 0)
    const duration = actualDurations[p.id] ?? fallbackDur
    const startTime = acc
    acc += duration
    return { pellicule: p, startTime, endTime: acc, duration }
  })
  return { list, totalDuration: acc }
}

function findActivePelliculeIdx(offsets: PelliculeWithOffset[], globalTime: number): number {
  for (let i = 0; i < offsets.length; i++) {
    if (globalTime < offsets[i].endTime) return i
  }
  return Math.max(0, offsets.length - 1)
}

// ── Component ─────────────────────────────────────────────────────────

interface AnimationCropModalProps {
  open: boolean
  pellicules: AnimationPellicule[]
  cropKeyframes: Partial<Record<CropDevice, CropKeyframe[]>>
  baseImageUrl: string | null
  onChange: (cropKeyframes: Partial<Record<CropDevice, CropKeyframe[]>>) => void
  onClose: () => void
}

export default function AnimationCropModal({
  open, pellicules, cropKeyframes, baseImageUrl, onChange, onClose,
}: AnimationCropModalProps) {
  const [device, setDevice] = useState<CropDevice>('phone')
  const [globalTime, setGlobalTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [videoAspect, setVideoAspect] = useState<number | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  /** Durées RÉELLES des vidéos par pellicule.id, mises à jour par
   *  onLoadedMetadata. La somme = vraie totalDuration (sans dépendre des
   *  shots.duration estimés TTS). */
  const [actualDurations, setActualDurations] = useState<Record<string, number>>({})

  const screenRef = useRef<HTMLDivElement>(null)
  /** Refs vers les <video> stackées. videoRefs.current[i] = pellicule i. */
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])

  // ── Compute pellicule offsets + active idx ──────────────────────────
  const { list: offsets, totalDuration } = useMemo(
    () => buildPelliculeOffsets(pellicules, actualDurations),
    [pellicules, actualDurations],
  )
  const activeIdx = findActivePelliculeIdx(offsets, globalTime)
  const activePellicule = offsets[activeIdx]?.pellicule ?? null

  // ── Compute current crop state (interpolé) ──────────────────────────
  const targetSpec = DEVICE_RATIOS[device]
  const kfs = cropKeyframes[device] ?? []
  const activeKfIdx = findKeyframeIdxAtTime(kfs, globalTime)
  const interpRaw = interpolateAtTime(kfs, globalTime)
  const aspect = videoAspect ?? 1.778  // fallback 16:9 si pas encore loadé
  const { wRatio, hRatio } = computeImageSize(aspect, targetSpec.ratio, interpRaw.scale)
  // Clamp X/Y au range valide pour le scale courant. Couvre le cas où la kf
  // a été créée à un scale différent (ex: scale=1 puis dezoom à 0.7) → x peut
  // se retrouver hors range, ce qui pousse l'image off-screen. On clampe au
  // render pour que l'auteur voie toujours quelque chose de cohérent.
  const minXClamp = wRatio > 1 ? 0.5 / wRatio : 0.5
  const maxXClamp = wRatio > 1 ? 1 - 0.5 / wRatio : 0.5
  const minYClamp = hRatio > 1 ? 0.5 / hRatio : 0.5
  const maxYClamp = hRatio > 1 ? 1 - 0.5 / hRatio : 0.5
  const interp = {
    x: Math.max(minXClamp, Math.min(maxXClamp, interpRaw.x)),
    y: Math.max(minYClamp, Math.min(maxYClamp, interpRaw.y)),
    scale: interpRaw.scale,
  }

  // ── Reset au open/close ─────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setGlobalTime(0)
      setPlaying(false)
      setDevice('phone')
      videoRefs.current.forEach(v => { if (v) { v.pause(); v.currentTime = 0 } })
    } else {
      // À l'ouverture, démarre au début de la 1ère pellicule générée pour
      // que l'auteur voie immédiatement quelque chose (pas une plage noire).
      const firstGenIdx = offsets.findIndex(o => o.pellicule.videoUrl)
      if (firstGenIdx >= 0) {
        setGlobalTime(offsets[firstGenIdx].startTime)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Sync vidéos (currentTime + play) ────────────────────────────────
  /** Quand globalTime change (scrub manuel), sync la vidéo active à
   *  (globalTime - pellicule.startTime). Les autres vidéos sont paused +
   *  currentTime=0 (pas besoin de les avancer, elles ne jouent pas). */
  useEffect(() => {
    if (!open) return
    const active = offsets[activeIdx]
    if (!active) return
    const localTime = globalTime - active.startTime
    const v = videoRefs.current[activeIdx]
    if (v && Math.abs(v.currentTime - localTime) > 0.15) {
      try { v.currentTime = localTime } catch { /* readyState ignore */ }
    }
  }, [globalTime, activeIdx, offsets, open])

  /** Gère play/pause + switch entre pellicules. */
  useEffect(() => {
    if (!open) return
    videoRefs.current.forEach((v, i) => {
      if (!v) return
      if (i === activeIdx && playing) {
        if (v.paused) void v.play().catch(() => {/* autoplay block */})
      } else {
        if (!v.paused) v.pause()
      }
    })
  }, [playing, activeIdx, open])

  /** onTimeUpdate du <video> actif → bumps globalTime (sauf scrubbing). */
  function handleVideoTimeUpdate(idx: number) {
    return (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (idx !== activeIdx || scrubbing) return
      const v = e.currentTarget
      const off = offsets[idx]
      if (!off) return
      setGlobalTime(off.startTime + v.currentTime)
    }
  }

  /** onEnded de la vidéo active → cherche la prochaine pellicule GÉNÉRÉE
   *  (skip les non-générées pour éviter les écrans noirs en lecture). */
  function handleVideoEnded(idx: number) {
    return () => {
      if (idx !== activeIdx) return
      let nextIdx = idx + 1
      while (nextIdx < offsets.length && !offsets[nextIdx].pellicule.videoUrl) {
        nextIdx++
      }
      if (nextIdx < offsets.length) {
        setGlobalTime(offsets[nextIdx].startTime)
      } else {
        // Fin de l'animation (plus de pellicule générée derrière)
        setPlaying(false)
        setGlobalTime(totalDuration)
      }
    }
  }

  /** onLoadedMetadata par <video> : enregistre la VRAIE durée de la pellicule
   *  (pour que la timeline corresponde à la lecture réelle) + l'aspect-ratio
   *  pour la 1ère vidéo (commun à toutes les pellicules en pratique). */
  function handleVideoLoadedMetadata(idx: number) {
    return (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget
      const p = pellicules[idx]
      // Durée réelle de la vidéo (peut différer de shots.duration TTS-estimé)
      if (p && isFinite(v.duration) && v.duration > 0) {
        setActualDurations(prev => {
          if (prev[p.id] === v.duration) return prev
          return { ...prev, [p.id]: v.duration }
        })
      }
      // Aspect ratio (depuis la 1ère vidéo qui charge)
      const w = v.videoWidth
      const h = v.videoHeight
      if (w > 0 && h > 0 && !videoAspect) {
        setVideoAspect(w / h)
      }
    }
  }

  // ── Persistance helpers ─────────────────────────────────────────────
  function pushKfs(newKfs: CropKeyframe[]) {
    const next = { ...cropKeyframes }
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
      time: globalTime,
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

  // ── Drag de l'image ─────────────────────────────────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLElement>) {
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
    let workingIdx = activeKfIdx
    if (workingIdx < 0) {
      const newKf: CropKeyframe = {
        time: globalTime,
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
      const dxPhone = (ev.clientX - startMouse.x) / screenRect.width
      const dyPhone = (ev.clientY - startMouse.y) / screenRect.height
      const dxSource = -dxPhone / dragWRatio
      const dySource = -dyPhone / dragHRatio
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

  // ── Scale ──────────────────────────────────────────────────────────
  function changeScale(delta: number) {
    const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, interp.scale + delta))
    if (Math.abs(newScale - interp.scale) < 1e-4) return
    if (activeKfIdx >= 0) {
      patchKf(activeKfIdx, { scale: newScale })
    } else {
      const newKf: CropKeyframe = {
        time: globalTime,
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

  // ── Play/Scrub controls ────────────────────────────────────────────
  function togglePlay() {
    if (globalTime >= totalDuration - 0.05) {
      setGlobalTime(0)
    }
    setPlaying(p => !p)
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const t = parseFloat(e.target.value)
    setGlobalTime(t)
  }

  function fmt(t: number) {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // ── Render ─────────────────────────────────────────────────────────
  if (!open) return null

  // Affichage de l'image draggable — style absolu calculé depuis interp + ratios
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

  const dragAxisHint = activeKfIdx >= 0
    ? '🟢 Keyframe active — drag/wheel pour ajuster'
    : kfs.length === 0
      ? '+ Drag pour ajouter une keyframe au temps courant'
      : '↻ Scrub vers une keyframe ou clique +'

  // Has at least one ungenerated pellicule?
  const ungeneratedCount = pellicules.filter(p => !p.videoUrl).length

  return (
    <AnimatePresence>
      <motion.div
        className="ac-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        // ⚠ Modal verrouillé : pas de close on backdrop click (demandé 2026-05-08)
      >
        <motion.div
          className="ac-modal"
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        >
          {/* Header : tabs device au centre + close à droite */}
          <header className="ac-header">
            <div className="ac-header-title">Cadrage de l&apos;animation</div>
            <div className="ac-tabs">
              {(Object.keys(DEVICE_RATIOS) as CropDevice[]).map(d => {
                const isActive = d === device
                const isSet = (cropKeyframes[d]?.length ?? 0) > 0
                const spec = DEVICE_RATIOS[d]
                return (
                  <button
                    type="button"
                    key={d}
                    className={`ac-tab ${isActive ? 'active' : ''}`}
                    onClick={() => setDevice(d)}
                    title={`${spec.label} — ${spec.resolution.w}×${spec.resolution.h} (${spec.ratioLabel})`}
                  >
                    {d === 'phone' ? <Smartphone size={13} /> : <Tablet size={13} />}
                    <span>{spec.label}</span>
                    {isSet && <span className="ac-dot" />}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              className="ac-close"
              onClick={onClose}
              title="Fermer"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </header>

          {/* Body : phone au centre avec image dedans */}
          <div className="ac-body" onWheel={handleWheel}>
            <div className="ac-phone-stage">
              {ungeneratedCount > 0 && (
                <div className="ac-warn">
                  ⚠ {ungeneratedCount} pellicule{ungeneratedCount > 1 ? 's non générées' : ' non générée'} — la lecture saute ces segments
                </div>
              )}
              <div className="ac-phone-frame">
                {/* Dimensions hardcodées en rem pour garantir aspect-ratio
                 *  exact, indépendant du contexte flex / vh / aspect-ratio CSS
                 *  qui s'avèrent trop fragiles. height=28rem, width=height×ratio. */}
                <div
                  ref={screenRef}
                  className={`ac-phone-screen ${activeKfIdx >= 0 ? 'active' : ''}`}
                  style={{
                    height: '28rem',
                    width: `${28 * targetSpec.ratio}rem`,
                  } as React.CSSProperties}
                >
                  {/* N <video> stackées (option D), une seule visible. */}
                  {pellicules.map((p, idx) => (
                    p.videoUrl ? (
                      <video
                        key={p.id}
                        ref={el => { videoRefs.current[idx] = el }}
                        src={p.videoUrl}
                        muted
                        playsInline
                        preload="auto"
                        style={{
                          ...imageStyle,
                          display: idx === activeIdx ? 'block' : 'none',
                        }}
                        onPointerDown={handlePointerDown}
                        onLoadedMetadata={handleVideoLoadedMetadata(idx)}
                        onTimeUpdate={handleVideoTimeUpdate(idx)}
                        onEnded={handleVideoEnded(idx)}
                        draggable={false}
                      />
                    ) : null
                  ))}
                  {/* Fallback quand la pellicule active n'a pas de vidéo : on
                   *  cherche la dernière frame d'une pellicule générée précédente
                   *  (continuité visuelle), sinon baseImageUrl, sinon placeholder. */}
                  {!activePellicule?.videoUrl && (() => {
                    // Cherche en arrière la dernière pellicule générée pour
                    // afficher sa lastFrame (continuité) ; à défaut baseImageUrl.
                    let fallbackUrl: string | null = activePellicule?.firstFrameUrl ?? null
                    if (!fallbackUrl) {
                      for (let i = activeIdx - 1; i >= 0; i--) {
                        if (offsets[i].pellicule.lastFrameUrl) {
                          fallbackUrl = offsets[i].pellicule.lastFrameUrl
                          break
                        }
                      }
                    }
                    if (!fallbackUrl) fallbackUrl = baseImageUrl
                    return fallbackUrl ? (
                      <>
                        <img
                          src={fallbackUrl}
                          alt="Aperçu"
                          style={imageStyle}
                          onPointerDown={handlePointerDown}
                          draggable={false}
                        />
                        <div className="ac-ungen-overlay">
                          <span>P{activeIdx + 1} non générée</span>
                          <span className="ac-ungen-sub">Aperçu = dernière frame du segment précédent</span>
                        </div>
                      </>
                    ) : (
                      <div className="ac-empty">P{activeIdx + 1} non générée — aucun aperçu disponible</div>
                    )
                  })()}
                </div>
              </div>
              <div className="ac-phone-meta">
                {targetSpec.label} · {targetSpec.resolution.w}×{targetSpec.resolution.h} · scale {interp.scale.toFixed(2)}×
              </div>
            </div>
          </div>

          {/* Zoom toolbar */}
          <div className="ac-zoom-row">
            <button
              type="button"
              className="ac-zoom-btn"
              onClick={() => changeScale(-SCALE_STEP_BTN)}
              disabled={interp.scale <= SCALE_MIN + 1e-4}
              title="Dézoomer"
              aria-label="Dézoomer"
            >
              <ZoomOut size={13} />
            </button>
            <span className="ac-zoom-value">{interp.scale.toFixed(2)}×</span>
            <button
              type="button"
              className="ac-zoom-btn"
              onClick={() => changeScale(SCALE_STEP_BTN)}
              disabled={interp.scale >= SCALE_MAX - 1e-4}
              title="Zoomer"
              aria-label="Zoomer"
            >
              <ZoomIn size={13} />
            </button>
          </div>

          {/* Timeline keyframes (avec frontières pellicules superposées) */}
          <div className="ac-timeline">
            <button
              type="button"
              className="ac-add-kf"
              onClick={addKeyframe}
              title="Ajouter une keyframe au temps courant"
              disabled={activeKfIdx >= 0}
            >
              <Plus size={11} />
              <span>Keyframe ici ({fmt(globalTime)})</span>
            </button>
            <div
              className="ac-timeline-track"
              onClick={(e) => {
                const track = e.currentTarget
                const r = track.getBoundingClientRect()
                const k = (e.clientX - r.left) / r.width
                setGlobalTime(Math.max(0, Math.min(totalDuration, k * totalDuration)))
              }}
            >
              {/* Frontières pellicules (lignes verticales) */}
              {offsets.slice(1).map((off, i) => (
                <div
                  key={`bound-${i}`}
                  className="ac-pell-boundary"
                  style={{ left: totalDuration > 0 ? `${(off.startTime / totalDuration) * 100}%` : '0%' }}
                  title={`Début P${i + 2} (${fmt(off.startTime)})`}
                />
              ))}
              {/* Cursor de position courante */}
              {totalDuration > 0 && (
                <div
                  className="ac-timeline-cursor"
                  style={{ left: `${(globalTime / totalDuration) * 100}%` }}
                />
              )}
              {/* Markers keyframes */}
              {kfs.map((kf, idx) => (
                <button
                  type="button"
                  key={`${kf.time}-${idx}`}
                  className={`ac-kf-marker ${idx === activeKfIdx ? 'active' : ''}`}
                  style={{ left: totalDuration > 0 ? `${(kf.time / totalDuration) * 100}%` : '0%' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setGlobalTime(kf.time)
                  }}
                  title={`Keyframe @ ${fmt(kf.time)}`}
                />
              ))}
            </div>
            {activeKfIdx >= 0 && (
              <button
                type="button"
                className="ac-delete-kf"
                onClick={() => deleteKeyframe(activeKfIdx)}
                title="Supprimer la keyframe active"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>

          {/* Play controls + scrub global */}
          <div className="ac-play-row">
            <button
              type="button"
              className="ac-play-btn"
              onClick={togglePlay}
              title={playing ? 'Pause' : 'Jouer'}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <span className="ac-time">{fmt(globalTime)}</span>
            <input
              type="range"
              className="ac-scrub"
              min={0}
              max={totalDuration || 0}
              step={0.01}
              value={globalTime}
              onChange={handleScrub}
              onMouseDown={() => setScrubbing(true)}
              onMouseUp={() => setScrubbing(false)}
              onTouchStart={() => setScrubbing(true)}
              onTouchEnd={() => setScrubbing(false)}
              aria-label="Position globale dans l'animation"
            />
            <span className="ac-time">{fmt(totalDuration)}</span>
          </div>

          {/* Footer */}
          <div className="ac-footer">
            <button
              type="button"
              className="ac-reset"
              onClick={deleteAllKeyframes}
              disabled={kfs.length === 0}
              title="Tout effacer pour ce device"
            >
              <RotateCcw size={11} />
              <span>Tout effacer</span>
            </button>
            <span className="ac-hint">{dragAxisHint}</span>
            <span className="ac-dims">
              {pellicules.length} pellicule{pellicules.length > 1 ? 's' : ''} · {fmt(totalDuration)} · {kfs.length} kf
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
