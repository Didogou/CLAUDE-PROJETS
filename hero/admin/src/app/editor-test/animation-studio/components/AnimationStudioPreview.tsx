'use client'
/**
 * AnimationStudioPreview — preview vidéo simple (refonte 2026-05-09).
 *
 * Décision : retirer tout le retraitement d'image (pan-and-scan / crop /
 * zoom / record). Le format de la vidéo sera fixé à la génération LTX
 * (phone / tablette / landscape) → pas besoin d'un cadrage post-prod ici.
 *
 * Features gardées :
 *   - Lecture multi-pellicules concaténées (chainage automatique)
 *   - Scrub bar globale + frame-by-frame ← → (hold-to-repeat)
 *   - Trim end : « −1 frame » (incrémental, hold) et « Couper ici → fin »
 *     (pour retirer les artefacts LTX à la fin d'une vidéo générée)
 *   - Trim restauration
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, Maximize2, ChevronLeft, ChevronRight,
  Scissors, RotateCcw, Smartphone, Tablet, Monitor, RotateCw,
  Volume2, VolumeX,
} from 'lucide-react'
import type { AnimationPellicule } from '@/components/image-editor/EditorStateContext'

// ── Device presets (alignés avec StickyPreviewPanel du Studio Section) ──
type DeviceCategory = 'mobile' | 'tablet' | 'desktop'
interface DevicePreset {
  id: string
  name: string
  category: DeviceCategory
  width: number   // dimensions natives en portrait
  height: number
}
const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphone-16',         name: 'iPhone 16',          category: 'mobile',  width: 393,  height: 852 },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max',  category: 'mobile',  width: 440,  height: 956 },
  { id: 'galaxy-s24',        name: 'Galaxy S24',         category: 'mobile',  width: 360,  height: 780 },
  { id: 'ipad-mini',         name: 'iPad Mini',          category: 'tablet',  width: 744,  height: 1133 },
  { id: 'ipad-pro-11',       name: 'iPad Pro 11"',       category: 'tablet',  width: 834,  height: 1194 },
  { id: 'desktop-1080p',     name: 'Desktop 1080p',      category: 'desktop', width: 1920, height: 1080 },
]
const CATEGORY_ICON: Record<DeviceCategory, typeof Smartphone> = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
}

interface PelliculeWithOffset {
  pellicule: AnimationPellicule
  startTime: number
  endTime: number
  duration: number
}

function buildPelliculeOffsets(
  pellicules: AnimationPellicule[],
  actualDurations: Record<string, number>,
): { list: PelliculeWithOffset[]; totalDuration: number } {
  let acc = 0
  const list = pellicules.map(p => {
    const fallback = p.shots.reduce((s, sh) => s + sh.duration, 0)
    const rawDuration = actualDurations[p.id] ?? fallback
    const trimStart = p.trimStart ?? 0
    const trimEnd = p.trimEnd ?? rawDuration
    const duration = Math.max(0, trimEnd - trimStart)
    const startTime = acc
    acc += duration
    return { pellicule: p, startTime, endTime: acc, duration }
  })
  return { list, totalDuration: acc }
}

function findActivePelliculeIdx(offsets: PelliculeWithOffset[], t: number): number {
  for (let i = 0; i < offsets.length; i++) {
    if (t < offsets[i].endTime) return i
  }
  return Math.max(0, offsets.length - 1)
}

interface AnimationStudioPreviewProps {
  visible: boolean
  pellicules: AnimationPellicule[]
  baseImageUrl: string | null
  /** Si l'auteur sélectionne une pellicule dans la timeline → seek à son début. */
  selectedPelliculeId?: string | null
  /** Met à jour une pellicule (utilisé pour trimEnd). */
  onUpdatePellicule?: (id: string, patch: Partial<AnimationPellicule>) => void
  /** Ouvre en plein écran (lightbox). */
  onOpenLightbox?: () => void
  /** Phase 2 (refonte 2026-05-14ab) — sync cursor + activePellicule vers
   *  caller (= Studio Section drive le highlight bloc + barre rouge timeline). */
  onCursorChange?: (globalMs: number) => void
  onActivePelliculeChange?: (pelliculeId: string | null) => void
  /** Refonte 2026-05-14av — Sync Play/Pause depuis la timeline. Quand cette
   *  prop change, le preview démarre/stoppe sa lecture en miroir. Permet
   *  au bouton Play de la timeline de piloter la lecture du preview. */
  externalPlaying?: boolean
}

export default function AnimationStudioPreview({
  visible, pellicules, baseImageUrl, selectedPelliculeId, onUpdatePellicule, onOpenLightbox,
  onCursorChange, onActivePelliculeChange, externalPlaying,
}: AnimationStudioPreviewProps) {
  const [globalTime, setGlobalTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [actualDurations, setActualDurations] = useState<Record<string, number>>({})
  const [scrubbing, setScrubbing] = useState(false)
  /** Audio toggle. Default = unmuted (l'auteur veut entendre les dialogues
   *  baked-in du MP4 LTX). Le crossfade ne crée pas d'overlap audio car
   *  l'ancienne pellicule est mise en pause par le play/pause effect. */
  const [muted, setMuted] = useState(false)
  /** Device et orientation — comme YouTube : portrait = vidéo wide letterboxée
   *  haut/bas, landscape = vidéo wide remplit (= comportement object-fit:contain). */
  const [deviceId, setDeviceId] = useState<string>('iphone-16')
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Close picker on click outside
  useEffect(() => {
    if (!pickerOpen) return
    function onDocClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [pickerOpen])

  const device = DEVICE_PRESETS.find(d => d.id === deviceId) ?? DEVICE_PRESETS[0]
  const DeviceIcon = CATEGORY_ICON[device.category]
  /** Dimensions du frame en rem, calculées en JS pour que :
   *   - le picker change la taille (mobile vs tablet vs desktop) visiblement
   *   - l'orientation pivote correctement la forme
   *   - chaque device garde sa proportion exacte
   *  Approche : on travaille en longer/shorter (et pas width/height) pour
   *  gérer correctement les desktops dont la dim native est width > height. */
  const LONGEST_REM: Record<DeviceCategory, number> = {
    mobile: 22,    // ≈ 352px le plus long
    tablet: 26,    // ≈ 416px
    desktop: 30,   // ≈ 480px (limite raisonnable du panel)
  }
  const longest = LONGEST_REM[device.category]
  const longerDim = Math.max(device.width, device.height)
  const shorterDim = Math.min(device.width, device.height)
  const shortToLongAspect = shorterDim / longerDim  // toujours < 1
  const shorter = longest * shortToLongAspect
  // portrait = display vertical (longer en hauteur)
  // landscape = display horizontal (longer en largeur)
  const frameW = orientation === 'portrait' ? shorter : longest
  const frameH = orientation === 'portrait' ? longest : shorter
  /** Largeur du panneau preview qui s'adapte au frame. Min 22rem pour garder
   *  le picker confortable, sinon = frame + padding pour que le frame tienne
   *  toujours sans être tronqué. */
  const panelWidth = Math.max(22, frameW + 2)

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const playingRef = useRef(playing)
  const globalTimeRef = useRef(globalTime)

  const { list: offsets, totalDuration } = useMemo(
    () => buildPelliculeOffsets(pellicules, actualDurations),
    [pellicules, actualDurations],
  )
  const activeIdx = findActivePelliculeIdx(offsets, globalTime)
  const activePellicule = offsets[activeIdx]?.pellicule ?? null

  // Sync refs
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { globalTimeRef.current = globalTime }, [globalTime])

  // Refonte 2026-05-14av — sync externalPlaying (= timeline) → playing local.
  // Quand l'auteur clique Play sur la timeline, le preview démarre la lecture
  // (et inversement Pause). Géré comme une prop "controlled" partielle :
  // si externalPlaying est défini, on aligne playing dessus.
  useEffect(() => {
    if (externalPlaying === undefined) return
    setPlaying(externalPlaying)
  }, [externalPlaying])
  // Notif sync cursor → caller. Throttle naturel par React rerender (~60fps).
  useEffect(() => { onCursorChange?.(globalTime) }, [globalTime, onCursorChange])
  // Notif active pellicule change → caller (highlight bloc dans timeline).
  useEffect(() => {
    onActivePelliculeChange?.(activePellicule?.id ?? null)
  }, [activePellicule?.id, onActivePelliculeChange])

  // Refonte 2026-05-14ba — Stop auto sur image_static.
  // Quand la lecture séquentielle atteint une pellicule de type image_static,
  // on pause automatiquement (pas de mouvement à jouer = inutile + crée une
  // attente sourde sans feedback). L'auteur reprendra Play s'il veut sauter
  // à la suivante. Skip si on vient JUSTE de démarrer (sinon Play ne marche
  // jamais quand l'image est sélectionnée au démarrage).
  const playStartedAtRef = useRef(0)
  useEffect(() => {
    if (playing) playStartedAtRef.current = Date.now()
  }, [playing])
  useEffect(() => {
    if (!playing) return
    if (!activePellicule) return
    const ext = activePellicule as typeof activePellicule & { type?: string }
    if (ext.type !== 'image_static') return
    // Tolerance 250ms : si on vient de Play sur une image, on permet 1 brief
    // affichage avant de stopper pour que l'auteur voie qu'elle est active.
    if (Date.now() - playStartedAtRef.current < 250) return
    setPlaying(false)
  }, [playing, activePellicule])

  // ── Sync vidéos avec globalTime + trimStart ────────────────────────
  // En lecture : seuil large pour éviter le jitter (timeUpdate maintient déjà
  // la sync). En pause (frame-by-frame, trim, scrub fin) : seuil serré pour
  // que la vidéo affiche EXACTEMENT la frame voulue.
  useEffect(() => {
    const active = offsets[activeIdx]
    if (!active) return
    const trimStart = active.pellicule.trimStart ?? 0
    const localTime = globalTime - active.startTime + trimStart
    const v = videoRefs.current[activeIdx]
    if (!v) return
    const threshold = playingRef.current ? 0.15 : 0.001
    if (Math.abs(v.currentTime - localTime) > threshold) {
      try { v.currentTime = localTime } catch { /* ignore */ }
    }
  }, [globalTime, activeIdx, offsets])

  // ── Play/pause sync : seul l'active video joue, les autres pause ──
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return
      if (i === activeIdx && playing) {
        if (v.paused) void v.play().catch(() => {/* autoplay block */})
      } else {
        if (!v.paused) v.pause()
      }
    })
  }, [playing, activeIdx])

  // ── Auto-seek à la pellicule sélectionnée dans la timeline ───────
  useEffect(() => {
    if (!selectedPelliculeId) return
    const target = offsets.find(o => o.pellicule.id === selectedPelliculeId)
    if (target) setGlobalTime(target.startTime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPelliculeId])

  // ── Video event handlers ──────────────────────────────────────────
  function handleVideoTimeUpdate(idx: number) {
    return (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (idx !== activeIdx || scrubbing) return
      const v = e.currentTarget
      const off = offsets[idx]
      if (!off) return
      const trimStart = off.pellicule.trimStart ?? 0
      const trimEnd = off.pellicule.trimEnd
      // Trim end atteint → enchaîne sur suivante (refonte 2026-05-15be —
      // même logique que handleVideoEnded : enchaîne vidéos, stop sur images).
      if (trimEnd !== undefined && v.currentTime >= trimEnd) {
        const nextIdx = idx + 1
        if (nextIdx >= offsets.length) {
          setPlaying(false)
          setGlobalTime(totalDuration)
          return
        }
        const nextPell = offsets[nextIdx].pellicule
        if (nextPell.videoUrl) {
          setGlobalTime(offsets[nextIdx].startTime)
        } else {
          setPlaying(false)
          setGlobalTime(offsets[nextIdx].startTime)
        }
        return
      }
      setGlobalTime(off.startTime + (v.currentTime - trimStart))
    }
  }

  function handleVideoEnded(idx: number) {
    return () => {
      if (idx !== activeIdx) return
      const nextIdx = idx + 1
      if (nextIdx >= offsets.length) {
        // Fin de séquence : stop
        setPlaying(false)
        setGlobalTime(totalDuration)
        return
      }
      const nextPell = offsets[nextIdx].pellicule
      // Refonte 2026-05-15be — enchaîne sur la pellicule suivante :
      //   - Si vidéo (videoUrl set) → continue à jouer
      //   - Si image_static (pas de videoUrl) → STOP dessus (l'auteur voit l'image)
      // Avant on skippait les images pour chercher la prochaine vidéo, ce qui
      // ignorait complètement les pellicules image_static placées en séquence.
      if (nextPell.videoUrl) {
        setGlobalTime(offsets[nextIdx].startTime)
      } else {
        setPlaying(false)
        setGlobalTime(offsets[nextIdx].startTime)
      }
    }
  }

  function handleVideoLoadedMetadata(idx: number) {
    return (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget
      const p = pellicules[idx]
      if (p && isFinite(v.duration) && v.duration > 0) {
        setActualDurations(prev =>
          prev[p.id] === v.duration ? prev : { ...prev, [p.id]: v.duration }
        )
      }
    }
  }

  // ── Play/scrub controls ───────────────────────────────────────────
  function handleTogglePlay() {
    if (globalTime >= totalDuration - 0.05) setGlobalTime(0)
    setPlaying(p => !p)
  }
  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    setGlobalTime(parseFloat(e.target.value))
  }

  function fmt(t: number) {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // ── Frame-by-frame avec hold-to-repeat ────────────────────────────
  const FRAME_DURATION = 1 / 30
  const stepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function stepFrameOnce(direction: -1 | 1) {
    if (playingRef.current) {
      const v = videoRefs.current[activeIdx]
      if (v) v.pause()
      setPlaying(false)
    }
    setGlobalTime(prev =>
      Math.max(0, Math.min(totalDuration, prev + direction * FRAME_DURATION))
    )
  }
  function startStepHold(direction: -1 | 1) {
    stepFrameOnce(direction)
    stepTimeoutRef.current = setTimeout(() => {
      stepIntervalRef.current = setInterval(() => stepFrameOnce(direction), 80)
    }, 350)
  }
  function stopStepHold() {
    if (stepTimeoutRef.current) { clearTimeout(stepTimeoutRef.current); stepTimeoutRef.current = null }
    if (stepIntervalRef.current) { clearInterval(stepIntervalRef.current); stepIntervalRef.current = null }
  }
  useEffect(() => stopStepHold, [])

  // ── Trim end (incrémental + grosse coupe) ────────────────────────
  // Après chaque coupe : pause + seek juste avant la nouvelle fin pour que
  // l'auteur VOIE la nouvelle dernière frame visible (et pas les frames cut).
  function pauseIfPlaying() {
    if (playingRef.current) {
      const v = videoRefs.current[activeIdx]
      if (v) v.pause()
      setPlaying(false)
    }
  }
  function trimOneFrameFromEnd() {
    const active = offsets[activeIdx]
    if (!active || !onUpdatePellicule) return
    const trimStart = active.pellicule.trimStart ?? 0
    const rawDuration = actualDurations[active.pellicule.id]
      ?? active.pellicule.shots.reduce((s, sh) => s + sh.duration, 0)
    const currentTrimEnd = active.pellicule.trimEnd ?? rawDuration
    const newTrimEnd = currentTrimEnd - FRAME_DURATION
    if (newTrimEnd <= trimStart + FRAME_DURATION) return
    onUpdatePellicule(active.pellicule.id, { trimEnd: newTrimEnd })
    pauseIfPlaying()
    // -0.005 = juste avant la coupe (sinon findActivePelliculeIdx jump au suivant)
    const newGlobal = active.startTime + (newTrimEnd - trimStart) - 0.005
    setGlobalTime(Math.max(0, newGlobal))
  }
  function trimEndAtCurrentTime() {
    const active = offsets[activeIdx]
    if (!active || !onUpdatePellicule) return
    const trimStart = active.pellicule.trimStart ?? 0
    const localTime = globalTime - active.startTime + trimStart
    if (localTime <= trimStart + 0.1) return
    onUpdatePellicule(active.pellicule.id, { trimEnd: localTime })
    pauseIfPlaying()
    // globalTime déjà au point de coupe → recule de 5ms pour rester sur la
    // pellicule courante (pas jumper à la suivante)
    setGlobalTime(Math.max(0, globalTime - 0.005))
  }
  function clearTrimEnd() {
    const active = offsets[activeIdx]
    if (!active || !onUpdatePellicule) return
    onUpdatePellicule(active.pellicule.id, { trimEnd: undefined })
  }

  /** Capture la frame courante du <video> à un temps donné, l'upload sur
   *  Supabase Storage, et set la pellicule.firstFrameUrl avec l'URL retour.
   *  Refonte 2026-05-10 — fix UX : quand l'auteur trim le début de la
   *  vidéo (artefact LTX), la vignette pellicule dans la timeline restait
   *  l'ancienne frame 0 moche. Cette fonction capture la NOUVELLE first
   *  frame visible (= à `time = trimStart`) et update la vignette.
   *
   *  Debouncé (400ms) pour ne pas spammer l'upload pendant un hold-to-repeat
   *  (= 10 trim/s pendant que l'auteur tient le bouton). Seul le DERNIER
   *  trim de la rafale déclenche le upload. */
  const captureDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function scheduleNewStartFrameCapture(pelliculeId: string, time: number) {
    if (!onUpdatePellicule) return
    if (captureDebounceRef.current) clearTimeout(captureDebounceRef.current)
    captureDebounceRef.current = setTimeout(async () => {
      const v = videoRefs.current[activeIdx]
      if (!v || v.videoWidth === 0) return
      // 1. Seek puis attend l'event 'seeked' avant de drawImage (sinon on
      //    capture potentiellement la frame courante, pas celle voulue).
      const dataUrl = await new Promise<string | null>((resolve) => {
        const onSeeked = () => {
          v.removeEventListener('seeked', onSeeked)
          const canvas = document.createElement('canvas')
          canvas.width = v.videoWidth
          canvas.height = v.videoHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) { resolve(null); return }
          try {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
            resolve(canvas.toDataURL('image/jpeg', 0.88))
          } catch (err) {
            // SecurityError = canvas tainted (CORS). Le video element a
            // crossOrigin="anonymous" mais Supabase doit servir CORS aussi.
            console.warn('[AnimationStudioPreview] capture frame CORS taint:', err)
            resolve(null)
          }
        }
        v.addEventListener('seeked', onSeeked, { once: true })
        v.currentTime = time
      })
      if (!dataUrl) return
      // 2. Upload sur Storage
      try {
        const r = await fetch('/api/storage/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data_url: dataUrl,
            path: `studio/animation/trim-thumbs/${pelliculeId}-start-${Date.now()}.jpg`,
          }),
        })
        const data = await r.json() as { url?: string }
        if (data.url) {
          onUpdatePellicule(pelliculeId, { firstFrameUrl: data.url })
        }
      } catch (err) {
        console.warn('[AnimationStudioPreview] upload trim-thumb failed (non-bloquant):', err)
      }
    }, 400)
  }

  /** Coupe 1 frame du DÉBUT de la pellicule (refonte 2026-05-10).
   *  Utile quand LTX produit une 1ère frame "abstrait peinture" (artefact
   *  warmup du modèle) → l'auteur veut juste virer cette frame moche.
   *  Pattern hold-to-repeat comme −1 frame fin. */
  function trimOneFrameFromStart() {
    const active = offsets[activeIdx]
    if (!active || !onUpdatePellicule) return
    const rawDuration = actualDurations[active.pellicule.id]
      ?? active.pellicule.shots.reduce((s, sh) => s + sh.duration, 0)
    const trimEnd = active.pellicule.trimEnd ?? rawDuration
    const currentTrimStart = active.pellicule.trimStart ?? 0
    const newTrimStart = currentTrimStart + FRAME_DURATION
    if (newTrimStart >= trimEnd - FRAME_DURATION) return  // garde au moins 1 frame
    onUpdatePellicule(active.pellicule.id, { trimStart: newTrimStart })
    pauseIfPlaying()
    // Replace au tout début de la nouvelle zone visible
    setGlobalTime(active.startTime)
    // Capture la nouvelle 1ère frame visible → met à jour la vignette pellicule
    scheduleNewStartFrameCapture(active.pellicule.id, newTrimStart)
  }

  /** Coupe TOUT du début jusqu'au temps courant (= équivalent "Couper ici → fin"
   *  mais pour le début). */
  function trimStartAtCurrentTime() {
    const active = offsets[activeIdx]
    if (!active || !onUpdatePellicule) return
    const trimEnd = active.pellicule.trimEnd
      ?? actualDurations[active.pellicule.id]
      ?? active.pellicule.shots.reduce((s, sh) => s + sh.duration, 0)
    const currentTrimStart = active.pellicule.trimStart ?? 0
    const localTime = globalTime - active.startTime + currentTrimStart
    if (localTime >= trimEnd - 0.1) return
    onUpdatePellicule(active.pellicule.id, { trimStart: localTime })
    pauseIfPlaying()
    setGlobalTime(active.startTime)
    scheduleNewStartFrameCapture(active.pellicule.id, localTime)
  }

  function clearTrimStart() {
    const active = offsets[activeIdx]
    if (!active || !onUpdatePellicule) return
    onUpdatePellicule(active.pellicule.id, { trimStart: undefined })
    // Restaure la vignette = frame 0 de la vidéo
    scheduleNewStartFrameCapture(active.pellicule.id, 0)
  }

  // ── Render ────────────────────────────────────────────────────────
  const hasAnyVideo = pellicules.some(p => p.videoUrl)
  // Phase 1b (refonte 2026-05-14z) : autorise la lecture si au moins une
  // pellicule a soit videoUrl, soit firstFrameUrl. Pour les blocs sans
  // vidéo (image_static), on affiche firstFrame en fallback statique
  // pendant duration_ms (le cursor RAF avance indépendamment).
  const hasAnyPlayable = pellicules.some(p => p.videoUrl || p.firstFrameUrl)
  const fallbackPoster = activePellicule?.firstFrameUrl ?? baseImageUrl ?? null

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.aside
          className="as-preview"
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 32 }}
          aria-label="Aperçu"
          style={{ width: `${panelWidth}rem` }}
        >
          {/* Picker device + orientation (= comme YouTube/Studio Section). */}
          <div className="as-preview-picker-row" ref={pickerRef}>
            <button
              type="button"
              className="as-preview-picker-btn"
              onClick={() => setPickerOpen(o => !o)}
              title="Choisir le device"
            >
              <DeviceIcon size={13} />
              <span>{device.name}</span>
              <span className="as-preview-picker-arrow">▾</span>
            </button>
            {/* Orientation toggle — icône Smartphone qui pivote selon l'orientation
             *  courante (= visuellement on voit un tel debout vs couché). */}
            <button
              type="button"
              className={`as-preview-orient-btn ${orientation}`}
              onClick={() => setOrientation(o => o === 'portrait' ? 'landscape' : 'portrait')}
              title={`Orientation : ${orientation === 'portrait' ? 'portrait' : 'paysage'} (cliquer pour basculer)`}
              aria-label="Basculer orientation"
            >
              <DeviceIcon size={13} />
            </button>
            {pickerOpen && (
              <div className="as-preview-picker-menu">
                {DEVICE_PRESETS.map(d => {
                  const Ico = CATEGORY_ICON[d.category]
                  const isActive = d.id === deviceId
                  return (
                    <button
                      type="button"
                      key={d.id}
                      className={`as-preview-picker-item ${isActive ? 'active' : ''}`}
                      onClick={() => { setDeviceId(d.id); setPickerOpen(false) }}
                    >
                      <Ico size={12} />
                      <span>{d.name}</span>
                      <span className="as-preview-picker-dim">
                        {d.width}×{d.height}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Frame device avec dimensions explicites en rem (= taille déterministe,
           *  pas d'ambiguïté flex/aspect-ratio). Chassis dark + écran intérieur.
           *  Vidéo en object-fit: contain → comportement YouTube.
           *  Toutes les vidéos sont rendues simultanément (position:absolute), seule
           *  l'active a opacity:1 — du coup, quand activeIdx change, la CSS transition
           *  d'opacity crée un crossfade automatique entre l'ancienne et la nouvelle
           *  pellicule (= raccord doux à la place d'un cut sec). */}
          <div
            className={`as-preview-frame as-preview-device-frame as-preview-cat-${device.category}`}
            style={{
              width: `${frameW}rem`,
              height: `${frameH}rem`,
            }}
          >
            <div className="as-preview-screen">
              {hasAnyVideo ? (
                <>
                  {pellicules.map((p, idx) => (
                    p.videoUrl ? (
                      <video
                        key={p.id}
                        ref={el => { videoRefs.current[idx] = el }}
                        src={p.videoUrl}
                        muted={muted}
                        playsInline
                        preload="auto"
                        crossOrigin="anonymous"
                        className="as-preview-media"
                        style={{ opacity: idx === activeIdx ? 1 : 0 }}
                        onLoadedMetadata={handleVideoLoadedMetadata(idx)}
                        onTimeUpdate={handleVideoTimeUpdate(idx)}
                        onEnded={handleVideoEnded(idx)}
                      />
                    ) : null
                  ))}
                  {!activePellicule?.videoUrl && fallbackPoster && (
                    <img
                      src={fallbackPoster}
                      alt="Aperçu"
                      className="as-preview-media"
                      style={{ opacity: 1 }}
                    />
                  )}
                </>
              ) : fallbackPoster ? (
                <img
                  src={fallbackPoster}
                  alt="Aperçu"
                  className="as-preview-media"
                  style={{ opacity: 1 }}
                />
              ) : (
                <div className="as-preview-empty">Aucune image</div>
              )}
              {/* Mockup overlay choix sur dernière pellicule (Step 2 refonte
               *  2026-05-11). Affiché EN PERMANENCE quand la dernière pellicule
               *  du plan a exit kind='choices'. V1 mockup éditorial — le vrai
               *  lecteur livre-jeu (ailleurs) gérera le timing fin. */}
              {(() => {
                const lastPell = pellicules[pellicules.length - 1]
                const isLastActive = lastPell?.id === activePellicule?.id
                const exit = activePellicule?.exit
                if (!isLastActive || exit?.kind !== 'choices') return null
                return (
                  <div className="as-preview-exit-overlay">
                    <div className="as-preview-exit-backdrop" />
                    <div className="as-preview-exit-list">
                      {exit.options.map((opt, idx) => {
                        const tgtIdx = opt.targetPelliculeId
                          ? pellicules.findIndex(p => p.id === opt.targetPelliculeId)
                          : -1
                        const tgtLabel = opt.targetPelliculeId === null
                          ? '🏁 Fin de section'
                          : tgtIdx >= 0 ? `→ Pellicule ${tgtIdx + 1}` : '⚠ cible introuvable'
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            className="as-preview-exit-btn-choice"
                            onClick={() => console.log('[Preview mockup] choice clicked:', opt)}
                          >
                            <span className="as-preview-exit-num">{idx + 1}.</span>
                            <span className="as-preview-exit-label">{opt.label || '(sans label)'}</span>
                            <span className="as-preview-exit-target">{tgtLabel}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
            {onOpenLightbox && (hasAnyVideo || fallbackPoster) && (
              <button
                type="button"
                className="as-preview-fullscreen-btn"
                onClick={onOpenLightbox}
                title="Plein écran"
                aria-label="Ouvrir en plein écran"
              >
                <Maximize2 size={12} />
              </button>
            )}
          </div>

          {/* Scrub bar globale + frame-by-frame avec hold-to-repeat */}
          {totalDuration > 0 && (
            <div className="as-preview-scrub-row">
              <button
                type="button"
                className="as-preview-frame-btn"
                onPointerDown={() => startStepHold(-1)}
                onPointerUp={stopStepHold}
                onPointerLeave={stopStepHold}
                onPointerCancel={stopStepHold}
                disabled={globalTime <= 0.001}
                title="Frame précédente (maintenir pour défiler)"
                aria-label="Frame précédente"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="as-preview-time">{fmt(globalTime)}</span>
              <input
                type="range"
                className="as-preview-scrub"
                min={0}
                max={totalDuration}
                step={0.01}
                value={globalTime}
                onChange={handleScrub}
                onMouseDown={() => setScrubbing(true)}
                onMouseUp={() => setScrubbing(false)}
                onTouchStart={() => setScrubbing(true)}
                onTouchEnd={() => setScrubbing(false)}
                aria-label="Position globale dans l'animation"
              />
              <span className="as-preview-time">{fmt(totalDuration)}</span>
              <button
                type="button"
                className="as-preview-frame-btn"
                onPointerDown={() => startStepHold(1)}
                onPointerUp={stopStepHold}
                onPointerLeave={stopStepHold}
                onPointerCancel={stopStepHold}
                disabled={globalTime >= totalDuration - 0.001}
                title="Frame suivante (maintenir pour défiler)"
                aria-label="Frame suivante"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}

          {/* Trim controls — début à GAUCHE, fin à DROITE. Le LTX 2.3 produit
           *  parfois une 1ère frame "warmup" abstraite (artefact peinture)
           *  qu'il faut virer ; et tend à ajouter un title-card / fondu en
           *  fin → 2 jeux de boutons symétriques pour les 2 cas. */}
          {onUpdatePellicule && activePellicule?.videoUrl && (
            <div className="as-preview-trim-row">
              {/* ─── Trim DÉBUT (à gauche) ─── */}
              <button
                type="button"
                className="as-preview-trim-btn"
                onPointerDown={() => {
                  trimOneFrameFromStart()
                  stepTimeoutRef.current = setTimeout(() => {
                    stepIntervalRef.current = setInterval(trimOneFrameFromStart, 100)
                  }, 350)
                }}
                onPointerUp={stopStepHold}
                onPointerLeave={stopStepHold}
                onPointerCancel={stopStepHold}
                title="Couper 1 frame du début (maintenir pour cut plusieurs)"
              >
                <Scissors size={11} />
                <span>début +1 frame</span>
              </button>
              <button
                type="button"
                className="as-preview-trim-btn"
                onClick={trimStartAtCurrentTime}
                title="Couper TOUT du début jusqu'au temps courant"
              >
                <Scissors size={11} />
                <span>début ← ici</span>
              </button>
              {activePellicule.trimStart !== undefined && activePellicule.trimStart > 0 && (
                <>
                  <span className="as-preview-trim-info">
                    ✂ {activePellicule.trimStart.toFixed(2)}s
                  </span>
                  <button
                    type="button"
                    className="as-preview-trim-btn"
                    onClick={clearTrimStart}
                    title="Restaurer le début complet"
                  >
                    <RotateCcw size={11} />
                  </button>
                </>
              )}

              {/* Séparateur visuel entre Début et Fin */}
              <span className="as-preview-trim-sep" aria-hidden>·</span>

              {/* ─── Trim FIN (à droite) ─── */}
              <button
                type="button"
                className="as-preview-trim-btn"
                onPointerDown={() => {
                  trimOneFrameFromEnd()
                  stepTimeoutRef.current = setTimeout(() => {
                    stepIntervalRef.current = setInterval(trimOneFrameFromEnd, 100)
                  }, 350)
                }}
                onPointerUp={stopStepHold}
                onPointerLeave={stopStepHold}
                onPointerCancel={stopStepHold}
                title="Couper 1 frame depuis la fin (maintenir pour cut plusieurs)"
              >
                <Scissors size={11} />
                <span>fin −1 frame</span>
              </button>
              <button
                type="button"
                className="as-preview-trim-btn"
                onClick={trimEndAtCurrentTime}
                title="Couper TOUT depuis le temps courant jusqu'à la fin"
              >
                <Scissors size={11} />
                <span>fin ici → </span>
              </button>
              {activePellicule.trimEnd !== undefined && (
                <>
                  <span className="as-preview-trim-info">
                    ✂ {activePellicule.trimEnd.toFixed(2)}s
                  </span>
                  <button
                    type="button"
                    className="as-preview-trim-btn"
                    onClick={clearTrimEnd}
                    title="Restaurer la durée pleine"
                  >
                    <RotateCcw size={11} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Play/pause + mute + meta */}
          <div className="as-preview-controls">
            <button
              type="button"
              className="as-preview-play-btn"
              onClick={handleTogglePlay}
              disabled={!hasAnyPlayable}
              title={playing ? 'Pause' : 'Jouer'}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
              <span>{playing ? 'Pause' : 'Jouer'}</span>
            </button>
            <button
              type="button"
              className="as-preview-mute-btn"
              onClick={() => setMuted(m => !m)}
              disabled={!hasAnyPlayable}
              title={muted ? 'Activer le son' : 'Couper le son'}
              aria-label={muted ? 'Activer le son' : 'Couper le son'}
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <span className="as-preview-meta">
              {pellicules.length} pellicule{pellicules.length > 1 ? 's' : ''}
              {totalDuration > 0 && ` · ${totalDuration.toFixed(1)}s`}
            </span>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
