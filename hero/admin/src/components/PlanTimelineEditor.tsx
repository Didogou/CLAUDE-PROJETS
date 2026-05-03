'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  type MediaBlock,
  type MediaBlockType,
  type PhraseTiming,
  blockTimeWindow,
  blockTypeColor,
  blockTypeIcon,
  computePhraseTimings,
  formatDurationMs,
  resolveBlockMedia,
  PHRASE_GAP_MS,
} from '@/lib/timeline'
import { type AnimationInstance, defaultDurationMsForAnimation, previewUrlOfAnimation } from '@/lib/animations'

// ── Sources média disponibles pour ce plan ──────────────────────────────────

export interface AvailableMedia {
  imageUrl?: string
  variants?: string[]
  /** Liste des animations du plan (modèle unifié — remplace derivations/travelling/videoUrl) */
  animations?: AnimationInstance[]
}

interface Props {
  phrases: string[]
  available: AvailableMedia
  blocks: MediaBlock[]
  onChange: (blocks: MediaBlock[]) => void
  wpm?: number
  wordIntervalMs?: number
  /** Pause entre phrases (ms). Défaut PHRASE_GAP_MS (4000). */
  phraseGapMs?: number
  /** Position de lecture courante (ms) — affiche un curseur si défini.
   *  Utiliser de préférence `cursorMsRef` + `cursorActive` pour un suivi fluide
   *  sans re-render BookPage (évite saccades). */
  playbackCursorMs?: number
  /** Ref partagée contenant la position de lecture courante (ms ou null).
   *  Quand fournie + `cursorActive` true, l'éditeur poll cette ref en rAF et met à jour
   *  son curseur sans déclencher de re-render BookPage. */
  cursorMsRef?: React.MutableRefObject<number | null>
  cursorActive?: boolean
}

// ── Durées par défaut ────────────────────────────────────────────────────────

const DEFAULT_IMAGE_MS = 3_000
const DEFAULT_VIDEO_MS = 5_000
const DEFAULT_FRAME_MS_DERIVATION = 150
const DEFAULT_FRAME_MS_TRAVELLING = 100
const MIN_BLOCK_MS = 300

interface PaletteItem {
  key: string
  label: string
  type: MediaBlockType
  url?: string
  urls?: string[]
  defaultDurationMs: number
}

function buildPalette(available: AvailableMedia): PaletteItem[] {
  const items: PaletteItem[] = []
  if (available.imageUrl) {
    items.push({ key: 'main', label: 'Image principale', type: 'image', url: available.imageUrl, defaultDurationMs: DEFAULT_IMAGE_MS })
  }
  ;(available.variants ?? []).forEach((url, i) =>
    items.push({ key: `var${i}`, label: `Variante ${i + 1}`, type: 'variant', url, defaultDurationMs: DEFAULT_IMAGE_MS }),
  )
  // Animations dans l'ordre de création (cs.animations est déjà ordonné)
  ;(available.animations ?? []).forEach(anim => {
    if (!anim.output || (!anim.output.url && !(anim.output.urls && anim.output.urls.length))) return
    const type: MediaBlockType =
      anim.kind === 'video_wan' || anim.kind === 'wan_camera' || anim.kind === 'latent_sync' ? 'video' :
      anim.kind === 'derivation' ? 'derivation' :
      anim.kind === 'motion_brush' ? 'derivation' :
      'travelling'
    items.push({
      key: anim.id,
      label: anim.name,
      type,
      url: anim.output.url,
      urls: anim.output.urls,
      defaultDurationMs: defaultDurationMsForAnimation(anim),
    })
  })
  return items
}

// ── Composant ────────────────────────────────────────────────────────────────

export default function PlanTimelineEditor({
  phrases,
  available,
  blocks,
  onChange,
  wpm = 180,
  wordIntervalMs = 200,
  phraseGapMs = PHRASE_GAP_MS,
  playbackCursorMs,
  cursorMsRef,
  cursorActive = false,
}: Props) {
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [dragOverPos, setDragOverPos] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const timings = useMemo(() => computePhraseTimings(phrases, wpm, wordIntervalMs, phraseGapMs), [phrases, wpm, wordIntervalMs, phraseGapMs])
  const totalMs = timings.length > 0 ? timings[timings.length - 1].end_ms + phraseGapMs : 0
  const palette = useMemo(() => buildPalette(available), [available])

  // Curseur fluide via rAF interne (lit cursorMsRef sans re-render BookPage).
  // useState pour déclencher le repaint local seulement, indépendamment de BookPage.
  const [internalCursorMs, setInternalCursorMs] = useState<number | null>(null)
  useEffect(() => {
    if (!cursorActive || !cursorMsRef) {
      setInternalCursorMs(null)
      return
    }
    let rafId = 0
    const tick = () => {
      const v = cursorMsRef.current
      setInternalCursorMs(prev => prev === v ? prev : v)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [cursorActive, cursorMsRef])
  // Cursor effectif : ref-based si fourni, sinon prop (legacy)
  const effectiveCursorMs = cursorActive && cursorMsRef ? internalCursorMs : playbackCursorMs

  // ── Helpers de timing/snap/overlap ────────────────────────────────────────

  function nearestPhraseStartIdx(targetMs: number): number {
    if (timings.length === 0) return 0
    let best = 0
    let bestDist = Math.abs(timings[0].start_ms - targetMs)
    for (let i = 1; i < timings.length; i++) {
      const d = Math.abs(timings[i].start_ms - targetMs)
      if (d < bestDist) { best = i; bestDist = d }
    }
    return best
  }

  /** Liste des points de "snap" possibles : début/fin de chaque phrase + fin de chaque bloc existant. */
  function snapTargets(exceptId?: string): number[] {
    const set = new Set<number>([0, totalMs])
    for (const t of timings) set.add(t.start_ms)
    for (const b of blocks) {
      if (b.id === exceptId) continue
      const w = blockTimeWindow(b, timings, blocks)
      set.add(w.end_ms)
    }
    return [...set].sort((a, b) => a - b)
  }

  /** Trouve le snap target le plus proche de `desired` (peut être phrase-start ou bloc-end). */
  function nearestSnap(desired: number, exceptId?: string): number {
    const targets = snapTargets(exceptId)
    let best = targets[0] ?? 0
    let bestDist = Math.abs(best - desired)
    for (const t of targets) {
      const d = Math.abs(t - desired)
      if (d < bestDist) { best = t; bestDist = d }
    }
    return Math.max(0, Math.min(totalMs, best))
  }

  /** Espace libre depuis `start` jusqu'au prochain bloc (ou `totalMs`). */
  function availableSpaceFrom(start: number, exceptId?: string): number {
    const others = blocks
      .filter(b => b.id !== exceptId)
      .map(b => blockTimeWindow(b, timings, blocks))
      .filter(w => w.start_ms > start - 1)
      .sort((a, b) => a.start_ms - b.start_ms)
    const nextStart = others[0]?.start_ms ?? totalMs
    return Math.max(0, nextStart - start)
  }

  /**
   * Place un bloc selon les règles UX :
   * 1. Snap au plus proche (phrase ou fin de bloc)
   * 2. Si l'espace dispo >= requestedDur → place à durée pleine
   * 3. Si espace dispo dans [MIN, requestedDur[ → réduit la durée pour fitter
   * 4. Si espace dispo < MIN → INSERT : place à durée pleine, décale tout ce qui suit
   */
  function planPlacement(desired: number, requestedDur: number, exceptId?: string): {
    start: number
    end: number
    needsShift: boolean
    shiftFromMs: number
    shiftAmountMs: number
  } {
    const snap = nearestSnap(desired, exceptId)
    const space = availableSpaceFrom(snap, exceptId)
    if (space >= requestedDur) {
      return { start: snap, end: snap + requestedDur, needsShift: false, shiftFromMs: 0, shiftAmountMs: 0 }
    }
    if (space >= MIN_BLOCK_MS) {
      // Réduit la durée pour fitter dans l'espace dispo
      return { start: snap, end: snap + space, needsShift: false, shiftFromMs: 0, shiftAmountMs: 0 }
    }
    // Espace insuffisant → insert + shift
    return { start: snap, end: snap + requestedDur, needsShift: true, shiftFromMs: snap, shiftAmountMs: requestedDur }
  }

  /**
   * Décale tous les blocs dont la fenêtre commence à >= threshold de `amount` ms.
   * Convertit phrase/after → time pour pouvoir décaler proprement (sinon impossible).
   */
  function shiftBlocksAtOrAfter(blocksToShift: MediaBlock[], threshold: number, amount: number, exceptId?: string): MediaBlock[] {
    return blocksToShift.map(b => {
      if (b.id === exceptId) return b
      const w = blockTimeWindow(b, timings, blocksToShift)
      if (w.start_ms < threshold) return b
      const newStart = Math.max(0, Math.min(totalMs, w.start_ms + amount))
      const newEnd = Math.max(newStart + MIN_BLOCK_MS, Math.min(totalMs, w.end_ms + amount))
      return { ...b, anchor: { mode: 'time' as const, start_ms: newStart, end_ms: newEnd } }
    })
  }

  /** Plus grande durée possible à partir de `start`, sans dépasser le bloc suivant ni totalMs. */
  function maxEndFrom(start: number, exceptId?: string): number {
    const others = blocks
      .filter(b => b.id !== exceptId)
      .map(b => blockTimeWindow(b, timings, blocks))
      .filter(w => w.start_ms > start)
      .sort((a, b) => a.start_ms - b.start_ms)
    return others.length > 0 ? others[0].start_ms : totalMs
  }

  // ── Création / suppression / update ───────────────────────────────────────

  function newBlockId() { return `tlb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }

  function createBlockFromPalette(item: PaletteItem, dropMs: number) {
    if (totalMs === 0) return
    const placement = planPlacement(dropMs, item.defaultDurationMs)
    // Si insertion forcée → décale tous les blocs au-delà du point d'insertion
    const baseBlocks = placement.needsShift
      ? shiftBlocksAtOrAfter(blocks, placement.shiftFromMs, placement.shiftAmountMs)
      : blocks
    const block: MediaBlock = {
      id: newBlockId(),
      type: item.type,
      source_url: item.url,
      source_urls: item.urls,
      source_ref: item.key,
      fps: item.urls ? Math.round(1000 / (item.type === 'travelling' ? DEFAULT_FRAME_MS_TRAVELLING : DEFAULT_FRAME_MS_DERIVATION)) : undefined,
      label: item.label,
      anchor: { mode: 'time', start_ms: placement.start, end_ms: placement.end },
    }
    onChange([...baseBlocks, block])
    setEditingBlockId(block.id)
  }

  function removeBlock(id: string) {
    // Convertit les blocs qui pointent sur celui-ci (anchor='after', after_block_id=id) en 'time'
    // avec la position actuelle figée — évite les blocs orphelins qui retomberaient à 0s.
    const updated = blocks
      .filter(b => b.id !== id)
      .map(b => {
        if (b.anchor.mode === 'after' && b.anchor.after_block_id === id) {
          const win = blockTimeWindow(b, timings, blocks)
          return { ...b, anchor: { mode: 'time' as const, start_ms: win.start_ms, end_ms: win.end_ms } }
        }
        return b
      })
    onChange(updated)
    if (editingBlockId === id) setEditingBlockId(null)
  }

  function updateBlock(id: string, patch: Partial<MediaBlock>) {
    onChange(blocks.map(b => (b.id === id ? { ...b, ...patch } : b)))
  }

  function setBlockTimes(id: string, start: number, end: number) {
    const safeStart = Math.max(0, Math.min(totalMs - MIN_BLOCK_MS, start))
    const safeEnd = Math.max(safeStart + MIN_BLOCK_MS, Math.min(totalMs, end))
    updateBlock(id, { anchor: { mode: 'time', start_ms: safeStart, end_ms: safeEnd } })
  }

  /** Redimensionne en préservant le mode d'ancrage si c'est 'after' (sinon → 'time'). */
  function resizeBlockEnd(id: string, start: number, end: number) {
    const block = blocks.find(b => b.id === id)
    if (!block) return
    const safeStart = Math.max(0, Math.min(totalMs - MIN_BLOCK_MS, start))
    const safeEnd = Math.max(safeStart + MIN_BLOCK_MS, Math.min(totalMs, end))
    const newDuration = safeEnd - safeStart
    if (block.anchor.mode === 'after') {
      // Préserve le chaînage, update juste la durée
      updateBlock(id, { anchor: { mode: 'after', after_block_id: block.anchor.after_block_id, duration_ms: newDuration } })
    } else {
      updateBlock(id, { anchor: { mode: 'time', start_ms: safeStart, end_ms: safeEnd } })
    }
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────

  function onPaletteDragStart(e: React.DragEvent, item: PaletteItem) {
    e.dataTransfer.setData('application/x-hero-media', JSON.stringify({ key: item.key }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  function onTrackDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    setDragOverPos(Math.max(0, Math.min(100, pct)))
  }

  function onTrackDragLeave() { setDragOverPos(null) }

  function onTrackDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOverPos(null)
    const raw = e.dataTransfer.getData('application/x-hero-media')
    if (!raw) return
    try {
      const { key } = JSON.parse(raw) as { key: string }
      const item = palette.find(p => p.key === key)
      if (!item) return
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return
      const dropMs = ((e.clientX - rect.left) / rect.width) * totalMs
      createBlockFromPalette(item, Math.max(0, Math.min(totalMs, dropMs)))
    } catch { /* ignore */ }
  }

  // ── Drag bloc existant (move + resize) ───────────────────────────────────

  function startMove(e: React.MouseEvent, block: MediaBlock) {
    e.preventDefault()
    const win = blockTimeWindow(block, timings, blocks)
    const rect = trackRef.current!.getBoundingClientRect()
    const startX = e.clientX
    const origStart = win.start_ms
    const len = win.end_ms - win.start_ms
    const onMove = (ev: MouseEvent) => {
      const deltaMs = totalMs * ((ev.clientX - startX) / rect.width)
      const requestedStart = origStart + deltaMs
      // Smart placement avec snap (phrase OU fin de bloc), réduction ou décalage si besoin
      const placement = planPlacement(requestedStart, len, block.id)
      let baseBlocks = blocks
      if (placement.needsShift) {
        baseBlocks = shiftBlocksAtOrAfter(blocks, placement.shiftFromMs, placement.shiftAmountMs, block.id)
      }
      const updated = baseBlocks.map(b => b.id === block.id
        ? { ...b, anchor: { mode: 'time' as const, start_ms: placement.start, end_ms: placement.end } }
        : b)
      onChange(updated)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function startResize(e: React.MouseEvent, block: MediaBlock) {
    e.preventDefault()
    e.stopPropagation()
    const win = blockTimeWindow(block, timings, blocks)
    const rect = trackRef.current!.getBoundingClientRect()
    const startX = e.clientX
    const origEnd = win.end_ms
    const maxEnd = maxEndFrom(win.start_ms, block.id)
    const onMove = (ev: MouseEvent) => {
      const deltaMs = totalMs * ((ev.clientX - startX) / rect.width)
      const newEnd = Math.max(win.start_ms + MIN_BLOCK_MS, Math.min(maxEnd, origEnd + deltaMs))
      // Resize préserve le mode 'after' si actif (garde le chaînage intact)
      resizeBlockEnd(block.id, win.start_ms, newEnd)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  if (phrases.length === 0) {
    return (
      <div style={{ padding: '0.8rem', fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center' }}>
        📜 Distribuez d'abord du texte à ce plan pour pouvoir construire la timeline.
      </div>
    )
  }

  const editingBlock = blocks.find(b => b.id === editingBlockId) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.6rem 0.7rem' }}>
      {/* ── Palette ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <div style={{ fontSize: '0.55rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'bold' }}>
          🎒 Médias disponibles — glissez sur la timeline ↓
        </div>
        {palette.length === 0 ? (
          <div style={{ padding: '0.6rem', fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic', border: '1px dashed var(--border)', borderRadius: '4px' }}>
            Aucun média dispo. Génère image / dérivations / travelling / vidéo dans les sections au-dessus.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {palette.map(it => {
              const color = blockTypeColor(it.type)
              const previewUrl = it.url ?? it.urls?.[0]
              const isVideo = !!previewUrl && /\.(mp4|webm|mov|m4v|ogg)(?:[?&#]|$)/i.test(previewUrl)
              return (
                <div
                  key={it.key}
                  draggable
                  onDragStart={e => onPaletteDragStart(e, it)}
                  title={`${it.label} — ${formatDurationMs(it.defaultDurationMs)} par défaut. Glisse-moi sur la timeline.`}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem 0.25rem 0.3rem', background: `${color}15`, border: `1px solid ${color}55`, borderRadius: '6px', cursor: 'grab', fontSize: '0.65rem', color, fontWeight: 600, userSelect: 'none' }}
                >
                  {previewUrl
                    ? (isVideo
                      ? <video src={previewUrl} muted autoPlay loop playsInline style={{ width: 28, height: 16, objectFit: 'cover', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.1)' }} />
                      : <img src={previewUrl} alt="" style={{ width: 28, height: 16, objectFit: 'cover', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.1)' }} />
                    )
                    : <span style={{ width: 28, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', fontSize: '0.7rem' }}>{blockTypeIcon(it.type)}</span>
                  }
                  <span>{it.label}</span>
                  <span style={{ opacity: 0.55, fontSize: '0.55rem' }}>{formatDurationMs(it.defaultDurationMs)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
        <span><strong style={{ color: 'var(--accent)' }}>{formatDurationMs(totalMs)}</strong> · {blocks.length} média{blocks.length > 1 ? 's' : ''} · {phrases.length} phrase{phrases.length > 1 ? 's' : ''}</span>
        <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>WPM {wpm}</span>
      </div>

      {/* Phrase markers */}
      <PhraseMarkersBar timings={timings} totalMs={totalMs} />

      {/* ── Single track (drop zone + tous les blocs en superposition impossible) ── */}
      <div
        ref={trackRef}
        onDragOver={onTrackDragOver}
        onDragLeave={onTrackDragLeave}
        onDrop={onTrackDrop}
        style={{ position: 'relative', height: '44px', background: 'var(--surface-2)', borderRadius: '6px', border: '1px solid var(--border)' }}
      >
        {blocks.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic', pointerEvents: 'none' }}>
            Glisse un média ici pour le poser sur la timeline.
          </div>
        )}

        {/* Tous les blocs sur la même piste */}
        {blocks.map(b => {
          const win = blockTimeWindow(b, timings, blocks)
          const leftPct = (win.start_ms / totalMs) * 100
          const widthPct = Math.max(2, ((win.end_ms - win.start_ms) / totalMs) * 100)
          const color = blockTypeColor(b.type)
          const selected = editingBlockId === b.id
          return (
            <div
              key={b.id}
              onMouseDown={e => startMove(e, b)}
              onClick={e => { e.stopPropagation(); setEditingBlockId(id => (id === b.id ? null : b.id)) }}
              title={`${b.label ?? b.type} — ${formatDurationMs(win.end_ms - win.start_ms)}`}
              style={{
                position: 'absolute',
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                top: 4,
                bottom: 4,
                background: `${color}${selected ? '55' : '33'}`,
                border: `${selected ? 2 : 1}px solid ${color}${selected ? 'cc' : '88'}`,
                borderRadius: '4px',
                color,
                fontSize: '0.62rem',
                fontWeight: 'bold',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                gap: '0.2rem',
                padding: '0 0.4rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                userSelect: 'none',
                boxShadow: selected ? `0 0 8px ${color}99` : undefined,
              }}
            >
              <span>{blockTypeIcon(b.type)}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label ?? b.type}</span>
              <div
                onMouseDown={e => startResize(e, b)}
                title="Redimensionner"
                style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'ew-resize', background: 'rgba(255,255,255,0.06)' }}
              />
            </div>
          )
        })}

        {/* Curseur de lecture (▶ Preview en cours) — barre verticale.
            Sans transition CSS : le rAF interne (cursorMsRef) met à jour à 60 Hz, donc
            la position glisse naturellement frame-par-frame. */}
        {effectiveCursorMs != null && totalMs > 0 && (() => {
          const pct = Math.max(0, Math.min(100, (effectiveCursorMs / totalMs) * 100))
          return (
            <div style={{ position: 'absolute', left: `${pct}%`, top: -3, bottom: -3, width: '2px', background: '#f5b942', boxShadow: '0 0 6px #f5b942cc, 0 0 14px #f5b94288', pointerEvents: 'none', zIndex: 6 }}>
              <div style={{ position: 'absolute', top: -6, left: -4, width: 10, height: 10, borderRadius: '50%', background: '#f5b942', boxShadow: '0 0 8px #f5b942' }} />
            </div>
          )
        })()}

        {/* Indicateur snap pendant drag (phrase OU fin de bloc, le plus proche) */}
        {dragOverPos !== null && totalMs > 0 && (() => {
          const dropMs = (dragOverPos / 100) * totalMs
          const snap = nearestSnap(dropMs)
          const snapPct = (snap / totalMs) * 100
          // Détermine le label selon la nature du snap
          let label = `${(snap / 1000).toFixed(1)}s`
          const matchPhrase = timings.find(t => Math.abs(t.start_ms - snap) < 1)
          if (matchPhrase) label = `P${matchPhrase.index + 1}`
          else {
            const matchBlockEnd = blocks.find(b => {
              const w = blockTimeWindow(b, timings, blocks)
              return Math.abs(w.end_ms - snap) < 1
            })
            if (matchBlockEnd) label = `→ fin ${matchBlockEnd.label?.slice(0, 12) ?? matchBlockEnd.type}`
          }
          return (
            <div style={{ position: 'absolute', left: `${snapPct}%`, top: -2, bottom: -2, width: '2px', background: '#52c484', boxShadow: '0 0 8px #52c484cc', pointerEvents: 'none', zIndex: 5 }}>
              <div style={{ position: 'absolute', top: -18, left: -50, width: 100, fontSize: '0.55rem', color: '#52c484', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap', textShadow: '0 0 4px #000' }}>
                {label}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Panneau d'édition du bloc sélectionné ── */}
      {editingBlock && (
        <BlockEditPanel
          block={editingBlock}
          allBlocks={blocks}
          totalMs={totalMs}
          timings={timings}
          phrasesCount={phrases.length}
          available={available}
          maxEnd={maxEndFrom(blockTimeWindow(editingBlock, timings, blocks).start_ms, editingBlock.id)}
          onUpdate={patch => updateBlock(editingBlock.id, patch)}
          onSetTimes={(s, e) => setBlockTimes(editingBlock.id, s, e)}
          onRemove={() => removeBlock(editingBlock.id)}
          onClose={() => setEditingBlockId(null)}
        />
      )}
    </div>
  )
}

// ── Sous-composants ──────────────────────────────────────────────────────────

function PhraseMarkersBar({ timings, totalMs }: { timings: PhraseTiming[]; totalMs: number }) {
  if (totalMs === 0) return null
  return (
    <div style={{ position: 'relative', height: '24px', background: 'var(--surface-2)', borderRadius: '4px', border: '1px solid var(--border)' }}>
      {timings.map(t => {
        const leftPct = (t.start_ms / totalMs) * 100
        const widthPct = (t.duration_ms / totalMs) * 100
        return (
          <div
            key={t.index}
            title={`P${t.index + 1} (${formatDurationMs(t.duration_ms)}) — "${t.text.slice(0, 60)}${t.text.length > 60 ? '…' : ''}"`}
            style={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: 0, bottom: 0, borderLeft: t.index > 0 ? '1px solid #ffffff22' : 'none', padding: '3px 5px', fontSize: '0.55rem', color: 'var(--muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', boxSizing: 'border-box' }}
          >
            <span style={{ color: '#7ab8d8', fontWeight: 'bold' }}>P{t.index + 1}</span>{' '}
            <span style={{ opacity: 0.6 }}>{formatDurationMs(t.start_ms)}</span>
          </div>
        )
      })}
    </div>
  )
}

function BlockEditPanel({
  block,
  allBlocks,
  totalMs,
  timings,
  phrasesCount,
  available,
  maxEnd,
  onUpdate,
  onSetTimes,
  onRemove,
  onClose,
}: {
  block: MediaBlock
  allBlocks: MediaBlock[]
  totalMs: number
  timings: PhraseTiming[]
  phrasesCount: number
  available: AvailableMedia
  maxEnd: number
  onUpdate: (patch: Partial<MediaBlock>) => void
  onSetTimes: (start: number, end: number) => void
  onRemove: () => void
  onClose: () => void
}) {
  const resolved = resolveBlockMedia(block, available)
  const win = blockTimeWindow(block, timings, allBlocks)
  const color = blockTypeColor(block.type)
  const anchorMode = block.anchor.mode
  const durMs = win.end_ms - win.start_ms
  const durSec = (durMs / 1000).toFixed(1)
  // Autres blocs éligibles pour ancrage 'after' (tout sauf soi + pas de cycle direct)
  const otherBlocksForAfter = allBlocks.filter(b => b.id !== block.id)

  return (
    <div style={{ padding: '0.6rem 0.7rem', background: 'var(--surface)', border: `1px solid ${color}66`, borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.7rem', flexWrap: 'wrap' }}>
        <span style={{ color, fontWeight: 'bold' }}>{blockTypeIcon(block.type)} {block.label ?? block.type}</span>
        {block.source_urls && <span style={{ color: 'var(--muted)' }}>· {block.source_urls.length} frames</span>}
        <button onClick={onClose} style={{ marginLeft: 'auto', fontSize: '0.6rem', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer' }}>
          Fermer
        </button>
        <button onClick={onRemove} style={{ fontSize: '0.6rem', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid #c94c4c66', background: '#c94c4c22', color: '#c94c4c', cursor: 'pointer' }}>
          ✕ Supprimer
        </button>
      </div>

      {/* ── Mode d'ancrage : 3 radios ── */}
      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', fontSize: '0.65rem', color: 'var(--muted)', flexWrap: 'wrap', paddingBottom: '0.3rem', borderBottom: '1px dashed var(--border)' }}>
        <span style={{ color: 'var(--muted)', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ancrage</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
          <input type="radio" checked={anchorMode === 'phrase'} onChange={() => onUpdate({ anchor: { mode: 'phrase', start_phrase: 0, end_phrase: Math.max(0, phrasesCount - 1) } })} />
          📌 Phrases
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
          <input type="radio" checked={anchorMode === 'time'} onChange={() => onUpdate({ anchor: { mode: 'time', start_ms: win.start_ms, end_ms: win.end_ms } })} />
          🔒 Temps
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: otherBlocksForAfter.length === 0 ? 'not-allowed' : 'pointer', opacity: otherBlocksForAfter.length === 0 ? 0.4 : 1 }}>
          <input
            type="radio"
            checked={anchorMode === 'after'}
            disabled={otherBlocksForAfter.length === 0}
            onChange={() => {
              if (otherBlocksForAfter.length === 0) return
              onUpdate({ anchor: { mode: 'after', after_block_id: otherBlocksForAfter[0].id, duration_ms: durMs || 2000 } })
            }}
          />
          🔗 Après un bloc
        </label>
        {block.fps != null && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: 'auto' }}>
            FPS
            <input
              type="number"
              min={1}
              max={60}
              value={block.fps}
              onChange={e => onUpdate({ fps: Math.max(1, Math.min(60, Number(e.target.value) || 12)) })}
              style={{ width: '36px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)', fontSize: '0.65rem', textAlign: 'center' }}
            />
          </label>
        )}
      </div>

      {/* ── Fields selon le mode ── */}
      {anchorMode === 'time' && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.65rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <strong style={{ color: 'var(--foreground)' }}>Début</strong>
            <input
              type="number" step={0.1} min={0} max={(totalMs / 1000).toFixed(1)}
              value={(win.start_ms / 1000).toFixed(1)}
              onChange={e => {
                const newStart = Math.max(0, Math.min(totalMs, Number(e.target.value) * 1000))
                onSetTimes(newStart, newStart + durMs)
              }}
              style={{ width: '52px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)', fontSize: '0.7rem', textAlign: 'center' }}
            /> s
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <strong style={{ color: 'var(--foreground)' }}>Durée</strong>
            <input
              type="number" step={0.1} min={0.3} max={((maxEnd - win.start_ms) / 1000).toFixed(1)}
              value={durSec}
              onChange={e => {
                const newDur = Math.max(0.3, Number(e.target.value)) * 1000
                const newEnd = Math.min(maxEnd, win.start_ms + newDur)
                onSetTimes(win.start_ms, newEnd)
              }}
              style={{ width: '52px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)', fontSize: '0.7rem', textAlign: 'center', fontWeight: 'bold' }}
            />
            <span style={{ color: 'var(--muted)' }}>s</span>
            <span style={{ color: 'var(--muted)', fontSize: '0.55rem', opacity: 0.7 }}>(max {((maxEnd - win.start_ms) / 1000).toFixed(1)}s)</span>
          </label>
        </div>
      )}

      {anchorMode === 'phrase' && block.anchor.mode === 'phrase' && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.65rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <strong style={{ color: 'var(--foreground)' }}>Début phrase</strong>
            <input
              type="number" min={1} max={phrasesCount}
              value={block.anchor.start_phrase + 1}
              onChange={e => {
                const v = Math.max(1, Math.min(phrasesCount, Number(e.target.value) || 1)) - 1
                const end = Math.max(v, (block.anchor as { mode: 'phrase'; start_phrase: number; end_phrase: number }).end_phrase)
                onUpdate({ anchor: { mode: 'phrase', start_phrase: v, end_phrase: end } })
              }}
              style={{ width: '44px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)', fontSize: '0.7rem', textAlign: 'center' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <strong style={{ color: 'var(--foreground)' }}>Fin phrase</strong>
            <input
              type="number" min={1} max={phrasesCount}
              value={block.anchor.end_phrase + 1}
              onChange={e => {
                const v = Math.max(1, Math.min(phrasesCount, Number(e.target.value) || 1)) - 1
                const start = Math.min(v, (block.anchor as { mode: 'phrase'; start_phrase: number; end_phrase: number }).start_phrase)
                onUpdate({ anchor: { mode: 'phrase', start_phrase: start, end_phrase: v } })
              }}
              style={{ width: '44px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)', fontSize: '0.7rem', textAlign: 'center' }}
            />
          </label>
          <span style={{ opacity: 0.7 }}>→ durée actuelle : {formatDurationMs(durMs)}</span>
        </div>
      )}

      {anchorMode === 'after' && block.anchor.mode === 'after' && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.65rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <strong style={{ color: 'var(--foreground)' }}>Après</strong>
            <select
              value={block.anchor.after_block_id}
              onChange={e => onUpdate({ anchor: { mode: 'after', after_block_id: e.target.value, duration_ms: durMs } })}
              style={{ fontSize: '0.7rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)', maxWidth: 180 }}
            >
              {otherBlocksForAfter.map(b => <option key={b.id} value={b.id}>{b.label ?? b.type}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <strong style={{ color: 'var(--foreground)' }}>Durée</strong>
            <input
              type="number" step={0.1} min={0.3}
              value={(block.anchor.duration_ms / 1000).toFixed(1)}
              onChange={e => {
                const newDur = Math.max(0.3, Number(e.target.value)) * 1000
                onUpdate({ anchor: { mode: 'after', after_block_id: (block.anchor as { mode: 'after'; after_block_id: string; duration_ms: number }).after_block_id, duration_ms: newDur } })
              }}
              style={{ width: '52px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)', fontSize: '0.7rem', textAlign: 'center', fontWeight: 'bold' }}
            /> s
          </label>
          <span style={{ opacity: 0.7 }}>
            → position auto : {(win.start_ms / 1000).toFixed(1)}s - {(win.end_ms / 1000).toFixed(1)}s
            (si le bloc précédent bouge, celui-ci suit)
          </span>
        </div>
      )}

      {/* Source preview — utilise resolveBlockMedia pour toujours afficher la dernière version */}
      {(resolved.url || (resolved.urls && resolved.urls.length > 0)) && (
        <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
          {(resolved.urls ?? (resolved.url ? [resolved.url] : [])).slice(0, 14).map((url, k) => (
            <img key={k} src={url} alt={`frame ${k + 1}`} style={{ width: '40px', height: '22px', objectFit: 'cover', borderRadius: '2px', border: '1px solid var(--border)' }} />
          ))}
          {(resolved.urls?.length ?? 0) > 14 && (
            <span style={{ fontSize: '0.55rem', color: 'var(--muted)', alignSelf: 'center' }}>+{(resolved.urls?.length ?? 0) - 14}</span>
          )}
        </div>
      )}
    </div>
  )
}
