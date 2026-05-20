'use client'
/**
 * StickyPreviewPanel — preview "tout le livre" sticky à droite du Studio Section.
 *
 * Refonte 2026-05-09 (commit B) :
 *   - Reçoit la liste plate `items: PlayableItem[]` (= toutes les pellicules
 *     vidéo + images des plans static, ordonnées section.number puis sort_order)
 *   - State machine : currentItemIdx + globalTime + playing
 *   - Auto-advance vidéo → vidéo (avec crossfade 350ms)
 *   - STOP forcé quand l'item suivant est une image (l'auteur clique Play
 *     pour avancer — décision UX 2026-05-09)
 *   - Sync avec le timeline : selectedPlanId qui change → seek au 1er item
 *     du plan sélectionné
 *   - Rendu : tous les médias en absolute, opacity-based switching pour le
 *     crossfade (même pattern que AnimationStudioPreview)
 *
 * À venir commit C : compteur "Section 2/15 · Plan 3/4", indicateur visuel
 * "▶ pour continuer" sur image, polish.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Smartphone, Tablet, Monitor, ChevronDown, Check,
  Volume2, VolumeX, RotateCcw, Play,
} from 'lucide-react'
import type { PlayableItem } from './playable-items'

type DeviceCategory = 'mobile' | 'tablet' | 'desktop'

interface DevicePreset {
  id: string
  name: string
  category: DeviceCategory
  width: number
  height: number
}

const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphone-16',         name: 'iPhone 16',          category: 'mobile',  width: 393, height: 852 },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max',  category: 'mobile',  width: 440, height: 956 },
  { id: 'galaxy-s24',        name: 'Galaxy S24',         category: 'mobile',  width: 360, height: 780 },
  { id: 'ipad-mini',         name: 'iPad Mini',          category: 'tablet',  width: 744, height: 1133 },
  { id: 'ipad-pro-11',       name: 'iPad Pro 11"',       category: 'tablet',  width: 834, height: 1194 },
  { id: 'desktop-1080p',     name: 'Desktop 1080p',      category: 'desktop', width: 1920, height: 1080 },
]

const CATEGORY_LABEL: Record<DeviceCategory, string> = {
  mobile: 'Mobile', tablet: 'Tablette', desktop: 'Desktop',
}
const CATEGORY_ICON: Record<DeviceCategory, React.ComponentType<{ size?: number }>> = {
  mobile: Smartphone, tablet: Tablet, desktop: Monitor,
}

interface StickyPreviewPanelProps {
  /** Liste plate des items lisibles (vidéos + images) du livre, ordonnée. */
  items: PlayableItem[]
  /** Plan actuellement sélectionné dans la timeline — quand ça change, on
   *  seek au 1er item de ce plan. */
  selectedPlanId: string | null
  /** Callback "Ouvrir dans Studio Designer" — bouton intégré sous la preview. */
  onOpenInDesigner?: (planId: string) => void
}

export default function StickyPreviewPanel({ items, selectedPlanId }: StickyPreviewPanelProps) {
  const [deviceId, setDeviceId] = useState<string>('iphone-16')
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  // ── Player state ────────────────────────────────────────────────────
  const [currentItemIdx, setCurrentItemIdx] = useState(0)
  /** Position de lecture DANS l'item vidéo courant (en s, post-trimStart).
   *  Toujours 0 si l'item courant est une image. */
  const [globalTime, setGlobalTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [actualDurations, setActualDurations] = useState<Record<string, number>>({})
  const [muted, setMuted] = useState(false)
  /** True quand on a atteint la fin de la liste après lecture continue.
   *  Décide d'afficher l'icône Rejouer au centre du screen (vs interaction
   *  Play/Pause classique). Reset dès qu'on relance / scrub / change de plan. */
  const [hasReachedEnd, setHasReachedEnd] = useState(false)
  /** False tant que l'auteur n'a pas encore cliqué sur le screen depuis qu'il
   *  est entré dans cette section. Décide d'afficher le gros bouton Play
   *  initial (= affordance de lecture). Reset à chaque changement de section. */
  const [hasInteracted, setHasInteracted] = useState(false)

  /** Refs vers chaque <video> (pour seek/play/pause précis). */
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const playingRef = useRef(playing)
  useEffect(() => { playingRef.current = playing }, [playing])

  /** Ref vers togglePlay — permet au handler clavier (espace) d'appeler la
   *  version la plus récente sans re-binding à chaque render. */
  const togglePlayRef = useRef<() => void>(() => {})

  const preset = DEVICE_PRESETS.find(d => d.id === deviceId) ?? DEVICE_PRESETS[0]
  const Icon = CATEGORY_ICON[preset.category]
  const groupedPresets: Record<DeviceCategory, DevicePreset[]> = {
    mobile: DEVICE_PRESETS.filter(d => d.category === 'mobile'),
    tablet: DEVICE_PRESETS.filter(d => d.category === 'tablet'),
    desktop: DEVICE_PRESETS.filter(d => d.category === 'desktop'),
  }

  // Click extérieur ferme le picker
  useEffect(() => {
    if (!pickerOpen) return
    function onDocClick(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [pickerOpen])

  // ── Sync timeline → preview : selectedPlanId change → jump au 1er item ──
  useEffect(() => {
    if (!selectedPlanId) return
    const idx = items.findIndex(it => it.planId === selectedPlanId)
    if (idx < 0) return
    setCurrentItemIdx(idx)
    setGlobalTime(0)
    // Pause par défaut quand l'auteur change manuellement de plan (= il édite)
    setPlaying(false)
    setHasReachedEnd(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanId, items.length])

  /** Garde currentItemIdx dans les bornes si items change (suppression/ajout). */
  useEffect(() => {
    if (currentItemIdx >= items.length) {
      setCurrentItemIdx(Math.max(0, items.length - 1))
      setGlobalTime(0)
      setPlaying(false)
    }
  }, [items.length, currentItemIdx])

  /** Reset hasInteracted à chaque changement de section. On utilise le
   *  sectionId du 1er item comme proxy (tous les items partagent le même
   *  sectionId en mode "section-only"). À l'entrée dans une nouvelle section
   *  → le gros bouton Play initial réapparaît pour signaler qu'on peut lancer. */
  const currentSectionId = items[0]?.sectionId ?? null
  useEffect(() => {
    setHasInteracted(false)
  }, [currentSectionId])

  const currentItem: PlayableItem | null = items[currentItemIdx] ?? null
  const isOnImage = currentItem?.kind === 'image'
  const isOnVideo = currentItem?.kind === 'video'

  /** Index d'affichage 1-based de chaque plan, basé sur son ordre d'apparition
   *  DANS la liste d'items lisibles. Évite que le compteur "Plan: X" reflète
   *  un plan fantôme du DB (= sort_order présent mais sans contenu visuel) :
   *  on numérote uniquement ce que l'auteur voit vraiment dans le preview. */
  const planDisplayIdxByPlanId = useMemo(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const it of items) {
      if (!map.has(it.planId)) {
        idx += 1
        map.set(it.planId, idx)
      }
    }
    return map
  }, [items])

  // Durée vidéo courante (pour scrub bar)
  const currentVideoRawDuration = isOnVideo
    ? (actualDurations[currentItem.id] ?? currentItem.duration ?? 0)
    : 0
  const currentVideoTrimStart = isOnVideo ? (currentItem.trimStart ?? 0) : 0
  const currentVideoTrimEnd = isOnVideo
    ? (currentItem.trimEnd ?? currentVideoRawDuration)
    : 0
  const currentVideoPlayableDuration = Math.max(
    0, currentVideoTrimEnd - currentVideoTrimStart,
  )

  // ── Auto-advance helper ─────────────────────────────────────────────
  function advanceToItem(nextIdx: number, autoPlay: boolean) {
    if (nextIdx >= items.length) {
      // Fin de la section : pause sur le dernier frame + flag pour afficher
      // l'icône Rejouer au centre du screen.
      setPlaying(false)
      setHasReachedEnd(true)
      return
    }
    const next = items[nextIdx]
    setCurrentItemIdx(nextIdx)
    setGlobalTime(0)
    if (next.kind === 'image') {
      // STOP forcé : l'auteur clique pour avancer (décision UX 2026-05-09)
      setPlaying(false)
    } else {
      setPlaying(autoPlay)
    }
  }

  /** Rejoue depuis le 1er item (reset complet). Appelé par l'icône Rejouer
   *  ou par un click sur l'écran quand on est en état "fin de section". */
  function replay() {
    if (items.length === 0) return
    setHasReachedEnd(false)
    setCurrentItemIdx(0)
    setGlobalTime(0)
    setPlaying(items[0].kind === 'video')
  }

  // ── Sync vidéo active : seek currentTime quand globalTime change ─────
  useEffect(() => {
    if (!isOnVideo || !currentItem) return
    const v = videoRefs.current[currentItem.id]
    if (!v) return
    const target = (currentItem.trimStart ?? 0) + globalTime
    const threshold = playingRef.current ? 0.15 : 0.001
    if (Math.abs(v.currentTime - target) > threshold) {
      try { v.currentTime = target } catch { /* ignore */ }
    }
  }, [globalTime, isOnVideo, currentItem])

  // ── Sync play/pause : seul l'élément actif lit ─────────────────────
  useEffect(() => {
    Object.entries(videoRefs.current).forEach(([id, v]) => {
      if (!v) return
      const isActive = isOnVideo && currentItem?.id === id
      if (isActive && playing) {
        if (v.paused) void v.play().catch(() => { /* autoplay block */ })
      } else {
        if (!v.paused) v.pause()
      }
    })
  }, [playing, currentItem, isOnVideo])

  // ── Video event handlers ────────────────────────────────────────────
  function makeOnTimeUpdate(itemId: string) {
    return (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (!isOnVideo || currentItem?.id !== itemId || scrubbing) return
      const v = e.currentTarget
      const trimStart = currentItem.trimStart ?? 0
      const trimEnd = currentItem.trimEnd
      // Trim end atteint → advance (déclenche le crossfade vers item suivant)
      if (trimEnd !== undefined && v.currentTime >= trimEnd) {
        advanceToItem(currentItemIdx + 1, true)
        return
      }
      setGlobalTime(v.currentTime - trimStart)
    }
  }
  function makeOnEnded(itemId: string) {
    return () => {
      if (!isOnVideo || currentItem?.id !== itemId) return
      advanceToItem(currentItemIdx + 1, true)
    }
  }
  function makeOnLoadedMetadata(itemId: string) {
    return (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget
      if (isFinite(v.duration) && v.duration > 0) {
        setActualDurations(prev =>
          prev[itemId] === v.duration ? prev : { ...prev, [itemId]: v.duration }
        )
      }
    }
  }

  // ── Play / scrub controls ────────────────────────────────────────────
  function togglePlay() {
    if (items.length === 0) return
    if (hasReachedEnd) { replay(); return }
    if (isOnImage) {
      // Sur une image, "Play" = avancer à l'item suivant
      advanceToItem(currentItemIdx + 1, true)
      return
    }
    if (isOnVideo) {
      // Si on est à la fin de la vidéo, on rewind avant de relancer
      if (globalTime >= currentVideoPlayableDuration - 0.05) setGlobalTime(0)
      setPlaying(p => !p)
    }
  }

  /** Click n'importe où sur le screen = togglePlay (pattern YouTube).
   *  Remplace le bouton Play centré (retiré 2026-05-09 : intrusif).
   *  Marque aussi hasInteracted = true → fait disparaître l'overlay Play
   *  initial qui sert d'affordance à l'arrivée. */
  function handleScreenClick() {
    setHasInteracted(true)
    togglePlay()
  }

  function seekFromClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!isOnVideo || currentVideoPlayableDuration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setGlobalTime(ratio * currentVideoPlayableDuration)
    setHasReachedEnd(false)
  }

  // ── Raccourci clavier ESPACE = togglePlay (commit C) ────────────────
  // Garde-fou : on ignore l'event si l'utilisateur tape dans un input/textarea
  // ou un contenteditable (= pas voler son espace de typing). Le ref de
  // togglePlay évite re-binding à chaque render.
  useEffect(() => { togglePlayRef.current = togglePlay })
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (!t) return
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return
      e.preventDefault()
      togglePlayRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── Rendu ─────────────────────────────────────────────────────────────
  // On ne rend que l'item courant + une fenêtre voisine (perf : pas la peine
  // de garder 50 vidéos montées). Mais pour le crossfade on garde l'item
  // précédent visible pendant 350ms via opacity. Solution simple : window
  // de 3 (prev, current, next) tous montés en absolute.
  const renderableIndices = useMemo(() => {
    const set = new Set<number>([currentItemIdx])
    if (currentItemIdx > 0) set.add(currentItemIdx - 1)
    if (currentItemIdx + 1 < items.length) set.add(currentItemIdx + 1)
    return set
  }, [currentItemIdx, items.length])

  // Fallback : pas d'items du tout (livre vide)
  if (items.length === 0) {
    return (
      <aside className="ss-stickypv">
        <div className="ss-stickypv-picker" ref={pickerRef}>
          <button
            type="button"
            className={`ss-stickypv-picker-trigger ${pickerOpen ? 'open' : ''}`}
            onClick={() => setPickerOpen(o => !o)}
          >
            <Icon size={14} />
            <span className="ss-stickypv-picker-name">{preset.name}</span>
            <ChevronDown size={14} className="ss-stickypv-picker-chevron" />
          </button>
        </div>
        <div
          className={`ss-stickypv-frame ss-stickypv-frame-${preset.category}`}
          style={{ aspectRatio: `${preset.width} / ${preset.height}` }}
        >
          <div className="ss-stickypv-screen">
            <div className="ss-stickypv-screen-empty">Aucun plan dans le livre</div>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="ss-stickypv">
      {/* ── Picker de format ──────────────────────────────────────────── */}
      <div className="ss-stickypv-picker" ref={pickerRef}>
        <button
          type="button"
          className={`ss-stickypv-picker-trigger ${pickerOpen ? 'open' : ''}`}
          onClick={() => setPickerOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
        >
          <Icon size={14} />
          <span className="ss-stickypv-picker-name">{preset.name}</span>
          <ChevronDown size={14} className="ss-stickypv-picker-chevron" />
        </button>
        {pickerOpen && (
          <div className="ss-stickypv-picker-menu" role="listbox">
            {(['mobile', 'tablet', 'desktop'] as DeviceCategory[]).map(cat => {
              const CatIcon = CATEGORY_ICON[cat]
              return (
                <div key={cat} className="ss-stickypv-picker-group">
                  <div className="ss-stickypv-picker-group-title">
                    <CatIcon size={11} />
                    <span>{CATEGORY_LABEL[cat]}</span>
                  </div>
                  {groupedPresets[cat].map(d => (
                    <button
                      key={d.id}
                      type="button"
                      role="option"
                      aria-selected={d.id === deviceId}
                      className={`ss-stickypv-picker-item ${d.id === deviceId ? 'active' : ''}`}
                      onClick={() => { setDeviceId(d.id); setPickerOpen(false) }}
                    >
                      <span className="ss-stickypv-picker-item-name">{d.name}</span>
                      <span className="ss-stickypv-picker-item-dim">{d.width}×{d.height}</span>
                      {d.id === deviceId && <Check size={11} />}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Frame device ──────────────────────────────────────────────── */}
      <div
        className={`ss-stickypv-frame ss-stickypv-frame-${preset.category}`}
        style={{ aspectRatio: `${preset.width} / ${preset.height}` }}
      >
        {/* Screen cliquable : tout l'écran fait Play/Pause/Continuer/Rejouer
         *  (pattern YouTube). Le bouton play central a été retiré 2026-05-09. */}
        <div
          className="ss-stickypv-screen"
          onClick={handleScreenClick}
          title={
            hasReachedEnd ? 'Cliquer pour rejouer'
              : isOnImage  ? 'Cliquer pour continuer'
              : playing    ? 'Cliquer pour pause'
              : 'Cliquer pour lire'
          }
        >
          {items.map((item, idx) => {
            if (!renderableIndices.has(idx)) return null
            const isActive = idx === currentItemIdx
            if (item.kind === 'video') {
              return (
                <video
                  key={item.id}
                  ref={el => { videoRefs.current[item.id] = el }}
                  src={item.videoUrl}
                  muted={muted}
                  playsInline
                  preload="auto"
                  className="ss-stickypv-media"
                  style={{ opacity: isActive ? 1 : 0 }}
                  onLoadedMetadata={makeOnLoadedMetadata(item.id)}
                  onTimeUpdate={makeOnTimeUpdate(item.id)}
                  onEnded={makeOnEnded(item.id)}
                />
              )
            }
            // image item
            return (
              <img
                key={item.id}
                src={item.imageUrl}
                alt={item.planTitle}
                className="ss-stickypv-media"
                style={{ opacity: isActive ? 1 : 0 }}
              />
            )
          })}

          {/* Overlay centré : Rejouer (fin de section) OU Play initial (arrivée).
           *  pointer-events: none → le clic passe au screen, qui appelle
           *  handleScreenClick (replay ou togglePlay selon l'état). */}
          {hasReachedEnd ? (
            <div className="ss-stickypv-center-overlay is-replay" aria-label="Rejouer">
              <RotateCcw size={28} />
            </div>
          ) : !hasInteracted && items.length > 0 ? (
            <div className="ss-stickypv-center-overlay is-play" aria-label="Lecture">
              <Play size={28} fill="currentColor" />
            </div>
          ) : null}

          {/* Hint visible quand on est arrêté sur une image fixe.
           *  Indique à l'auteur que c'est intentionnel et comment avancer. */}
          {isOnImage && !hasReachedEnd && (
            <div className="ss-stickypv-image-hint">
              <span>Image fixe</span>
              <span className="ss-stickypv-hint-sep">·</span>
              <span>cliquer pour continuer</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Progress bar (vidéo courante seulement) + meta + mute ───── */}
      {currentItem && (
        <div className="ss-stickypv-controls">
          <div className="ss-stickypv-progress" onClick={seekFromClick}>
            <div
              className="ss-stickypv-progress-fill"
              style={{
                width: isOnVideo && currentVideoPlayableDuration > 0
                  ? `${(globalTime / currentVideoPlayableDuration) * 100}%`
                  : isOnImage ? '100%' : '0%',
              }}
            />
          </div>
          <div className="ss-stickypv-meta">
            <span className="ss-stickypv-time">
              {isOnVideo ? formatTime(globalTime) : '—'}
              <span className="muted"> / {isOnVideo ? formatTime(currentVideoPlayableDuration) : '∞'}</span>
            </span>
            <span className="ss-stickypv-counters">
              Plan&nbsp;: {planDisplayIdxByPlanId.get(currentItem.planId) ?? 1}
              {currentItem.kind === 'video' && (
                <> &nbsp;·&nbsp; Pellicule&nbsp;: {currentItem.sequenceIdx + 1}</>
              )}
            </span>
            <button
              type="button"
              className="ss-stickypv-mute-btn"
              onClick={() => setMuted(m => !m)}
              title={muted ? 'Activer le son' : 'Couper le son'}
              aria-label={muted ? 'Activer le son' : 'Couper le son'}
            >
              {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
          </div>
          {/* 2e ligne meta : titre du plan courant (peut être long, donc séparé
           *  pour pas être tronqué par les compteurs / mute btn). */}
          <div className="ss-stickypv-plan-title" title={`${currentItem.sectionTitle ? currentItem.sectionTitle + ' — ' : ''}${currentItem.planTitle}`}>
            {currentItem.sectionTitle && (
              <span className="ss-stickypv-section-name">{currentItem.sectionTitle}</span>
            )}
            <span className="ss-stickypv-plan-name">{currentItem.planTitle}</span>
          </div>
        </div>
      )}
    </aside>
  )
}

function formatTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}
