/**
 * MultiTrackTimeline — helpers (refonte 2026-05-12).
 *
 * Inspirés du legacy `src/lib/timeline.ts` mais adaptés au nouveau modèle
 * multi-pistes Hero (pas d'anchor.mode 'phrase' ni 'after' — ici tout est en
 * ms absolus et l'overlap est interdit par piste).
 */

import type { TimelineState, TrackKind, TimelineBlock } from './types'
import { blocksOfTrack, wouldOverlap } from './types'

// ── Formattage ────────────────────────────────────────────────────────────

/** "0:08.500" → minutes:secondes.millièmes (3 chiffres). Pour ruler timeline
 *  + affichage durée bloc. */
export function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, ms) / 1000
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  const milli = Math.floor((totalSec - Math.floor(totalSec)) * 1000)
  return `${m}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`
}

/** "0:08" si milli=0, sinon "0:08.5" (1 décimale). Compact pour le ruler. */
export function formatDurationMsCompact(ms: number): string {
  const totalSec = Math.max(0, ms) / 1000
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (Math.abs(s - Math.round(s)) < 0.01) {
    return `${m}:${String(Math.round(s)).padStart(2, '0')}`
  }
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

// ── Snap (grille temporelle) ──────────────────────────────────────────────

/** Snap au pas de grille le plus proche. ex: snapToGrid(2347, 100) → 2300.
 *  Refonte 2026-05-12 : remplace le snap "à la phrase" du legacy (qui
 *  s'appuyait sur les phrases narratrices, pas pertinent ici). */
export function snapToGrid(ms: number, gridMs: number = 100): number {
  return Math.max(0, Math.round(ms / gridMs) * gridMs)
}

/** Snap au bord d'un bloc voisin si on est à moins de `tolMs`. Sinon snap à
 *  la grille. Permet à l'auteur de "coller" un bloc juste après un autre
 *  sans gap quand il drag près du bord. */
export function snapToNeighborOrGrid(
  state: TimelineState,
  track: TrackKind,
  rawMs: number,
  tolMs: number = 200,
  gridMs: number = 100,
): number {
  // Cherche le bord du bloc voisin le plus proche (start ou end).
  let bestEdge: number | null = null
  let bestDist = Infinity
  for (const b of blocksOfTrack(state, track)) {
    const edges = [b.startMs, b.startMs + b.durationMs]
    for (const e of edges) {
      const d = Math.abs(rawMs - e)
      if (d < bestDist) {
        bestDist = d
        bestEdge = e
      }
    }
  }
  if (bestEdge !== null && bestDist <= tolMs) return bestEdge
  return snapToGrid(rawMs, gridMs)
}

// ── Recherche de placement ────────────────────────────────────────────────

/** Retourne la position d'insertion pour un nouveau bloc à droite du dernier
 *  bloc de la piste (= ajout en fin de séquence). Utile pour le bouton
 *  "+ Ajouter à la fin". */
export function appendPositionMs(state: TimelineState, track: TrackKind): number {
  const blocks = blocksOfTrack(state, track)
  if (blocks.length === 0) return 0
  const last = blocks[blocks.length - 1]
  return last.startMs + last.durationMs
}

/** Trouve la place libre la plus proche de `dropMs` sur `track` qui peut
 *  accueillir un bloc de durée `durationMs` SANS overlap. Retourne null si
 *  aucune place dispo (= piste pleine, impossible en pratique car on peut
 *  toujours append à la fin → fallback appendPositionMs). */
export function findFreeSlot(
  state: TimelineState,
  track: TrackKind,
  dropMs: number,
  durationMs: number,
): number {
  // Si la position drop ne crée pas d'overlap, on la prend.
  if (!wouldOverlap(state, track, dropMs, durationMs)) {
    return Math.max(0, dropMs)
  }
  // Sinon, scan les "trous" entre blocs + après le dernier.
  const blocks = blocksOfTrack(state, track)
  // Trou avant le 1er bloc
  if (blocks.length > 0 && blocks[0].startMs >= durationMs) {
    if (dropMs < blocks[0].startMs) return Math.max(0, blocks[0].startMs - durationMs)
  }
  // Trous entre blocs
  for (let i = 0; i < blocks.length - 1; i++) {
    const gapStart = blocks[i].startMs + blocks[i].durationMs
    const gapEnd = blocks[i + 1].startMs
    if (gapEnd - gapStart >= durationMs) {
      // On préfère caler le nouveau bloc juste après le bloc i (snap au bord)
      return gapStart
    }
  }
  // Sinon append à la fin (toujours possible)
  return appendPositionMs(state, track)
}

// ── Conversions ms ↔ pixels ───────────────────────────────────────────────

/** Convertit ms → pixels selon le zoom. Ex: 1000ms × pxPerSec=80 / 1000 = 80px.
 *  Pas de clamp — l'appelant gère. */
export function msToPx(ms: number, pxPerSec: number): number {
  return (ms / 1000) * pxPerSec
}

/** Convertit pixels → ms selon le zoom. */
export function pxToMs(px: number, pxPerSec: number): number {
  return (px / pxPerSec) * 1000
}

// ── Tri / lookup ──────────────────────────────────────────────────────────

/** Trouve un bloc par son id parmi tous les blocs (toutes pistes confondues). */
export function findBlockById(state: TimelineState, id: string): TimelineBlock | null {
  return state.blocks.find(b => b.id === id) ?? null
}

/** Recalcule la durée totale de la séquence (= max end de tous les blocs).
 *  Sert à dimensionner le ruler horizontal. */
export function computeTotalDurationMs(blocks: TimelineBlock[]): number {
  if (blocks.length === 0) return 0
  return Math.max(0, ...blocks.map(b => b.startMs + b.durationMs))
}
