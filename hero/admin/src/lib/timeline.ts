/**
 * Timeline — durée du texte d'un plan + modèle de blocs média.
 *
 * Source de vérité : WPM (mots/minute) + intervalles entre chunks, calqué exactement
 * sur la logique du simulateur (GameSimTab dans page.tsx).
 *
 * Formule (mode narratif) :
 *   delay = (wordCount / readingWpm) * 60_000 + (lineBreak ? interval×5 : interval×2)
 *
 * Les chunks sont découpés sur la ponctuation forte [.!?…] (comme le simulateur).
 * Les tags style ElevenLabs [pause], [pause longue] ajoutent un délai fixe.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type MediaBlockType = 'image' | 'derivation' | 'travelling' | 'video' | 'variant'

/** Ancrage du bloc :
 *  - `phrase` : snap aux frontières de phrases (robuste à la réécriture)
 *  - `time`   : positions absolues en ms (précis, indépendant)
 *  - `after`  : commence exactement à la fin d'un autre bloc, dure `duration_ms`
 *               → si le bloc de référence est redimensionné, ce bloc suit automatiquement.
 */
export type MediaAnchor =
  | { mode: 'phrase'; start_phrase: number; end_phrase: number }
  | { mode: 'time'; start_ms: number; end_ms: number }
  | { mode: 'after'; after_block_id: string; duration_ms: number }

export interface MediaBlock {
  id: string
  type: MediaBlockType
  /** URL d'image fixe (image/variant/derivation seul) ou première frame.
   *  Snapshot au moment de la création. Si `source_ref` est défini, l'URL est
   *  re-résolue dynamiquement au render — utile pour suivre les régénérations. */
  source_url?: string
  /** Liste d'URLs pour séquences (derivation/travelling) — joué frame-by-frame */
  source_urls?: string[]
  /** Référence symbolique vers la source. Quand défini, on lit la dernière URL
   *  depuis l'état du plan plutôt que la valeur figée de source_url/_urls.
   *  Valeurs : 'main' | 'video' | 'derivations_seq' | 'travelling_seq' | 'var0', 'var1', ... */
  source_ref?: string
  /** FPS pour les séquences (default: 12) */
  fps?: number
  /** Label affiché dans l'UI (ex: "Travelling 30f", "Variante 2") */
  label?: string
  anchor: MediaAnchor
}

// ── Résolution dynamique des URLs (auto-refresh après régénération) ─────────

export interface ResolvedBlockMedia {
  url?: string
  urls?: string[]
}

export interface AvailableAnimationRef {
  id: string
  /** URLs des frames si séquence, sinon undefined */
  urls?: string[]
  /** URL unique si vidéo */
  url?: string
}

export interface AvailableMediaSnapshot {
  imageUrl?: string
  variants?: string[]
  /** Animations indexées par id pour résolution dynamique des `source_ref: 'anim_<id>'` */
  animations?: AvailableAnimationRef[]
  // Champs legacy gardés pour compat avec anciens blocs (source_ref='derivations_seq' etc.)
  derivations?: string[]
  travelling?: string[]
  videoUrl?: string
}

/**
 * Renvoie les URLs ACTUELLES pour un bloc en consultant la palette dispo.
 * Si le bloc a un `source_ref`, on relit la dernière valeur. Sinon fallback sur
 * les URLs figées (legacy / blocs créés avant l'introduction de source_ref).
 */
export function resolveBlockMedia(
  block: MediaBlock,
  available: AvailableMediaSnapshot,
): ResolvedBlockMedia {
  if (block.source_ref) {
    switch (block.source_ref) {
      case 'main':
        return { url: available.imageUrl }
      // Legacy refs (anciens blocs créés avant le modèle animations[])
      case 'video':
        return { url: available.videoUrl }
      case 'derivations_seq':
        return { urls: available.derivations }
      case 'travelling_seq':
        return { urls: available.travelling }
      default:
        // var0, var1, var2…
        if (block.source_ref.startsWith('var')) {
          const idx = parseInt(block.source_ref.slice(3), 10)
          if (Number.isFinite(idx)) return { url: available.variants?.[idx] }
        }
        // anim_xxxxx (nouveau modèle unifié)
        if (block.source_ref.startsWith('anim_')) {
          const id = block.source_ref
          const anim = available.animations?.find(a => a.id === id)
          if (anim) return { url: anim.url, urls: anim.urls }
        }
    }
  }
  return { url: block.source_url, urls: block.source_urls }
}

// ── Parser unifié — délégation à lib/sim-text-parser.ts ──────────────────────
// L'ancien parser local (getChunksFromPhrase + tags ElevenLabs avec délais) a été
// remplacé par celui du simulateur (parseTaggedSegments + getNarrChunks) pour
// garantir un rendu et un timing identiques entre simulateur et mini-tel preview.

import {
  parseTaggedSegments as _parseTaggedSegments,
  getNarrChunks as _getNarrChunks,
  chunkDurationMs as _chunkDurationMs,
  computePhraseTimings as _computePhraseTimings,
  getVisibleTextAtCursor as _getVisibleTextAtCursor,
  PHRASE_GAP_MS as _PHRASE_GAP_MS,
  type NarrChunk as _NarrChunk,
  type PhraseTiming as _PhraseTiming,
  type VisibleText as _VisibleText,
} from './sim-text-parser'

// Re-export pour compat avec les imports existants
export const parseTaggedSegments = _parseTaggedSegments
export const getNarrChunks = _getNarrChunks
export const chunkDurationMs = _chunkDurationMs
export const computePhraseTimings = _computePhraseTimings
export const getVisibleTextAtCursor = _getVisibleTextAtCursor
export const PHRASE_GAP_MS = _PHRASE_GAP_MS
export type NarrChunk = _NarrChunk
export type PhraseTiming = _PhraseTiming
export type VisibleText = _VisibleText
// BubbleType reste utilisé localement (renderChunkGroup, etc.) — conservé en string libre
export type BubbleType = 'discours' | 'foule' | 'bruit' | 'pensee' | 'discussion' | 'radio'

/**
 * Découpe un bloc de texte en sous-phrases, en respectant les tags ElevenLabs
 * `[tag]contenu[/tag]` qui restent atomiques. Logique calquée sur le simulateur.
 *
 * Ex: "Bonjour. [pause]Comment ça va ?[/pause] Bien." →
 *     ["Bonjour.", "[pause]Comment ça va ?[/pause]", "Bien."]
 */
export function splitIntoSubPhrases(text: string): string[] {
  if (!text || !text.trim()) return []
  const result: string[] = []
  const tRe = /\[([a-zA-ZÀ-ÿ0-9_:]+)\]([\s\S]*?)\[\/\1\]/g
  let last = 0
  let m: RegExpExecArray | null
  tRe.lastIndex = 0
  while ((m = tRe.exec(text)) !== null) {
    if (m.index > last) {
      const plain = text.slice(last, m.index).trim()
      if (plain) {
        result.push(
          ...plain
            .split(/(?<=[.!?…»])\s+/)
            .map(s => s.trim())
            .filter(Boolean),
        )
      }
    }
    result.push(m[0].trim())
    last = m.index + m[0].length
  }
  if (last < text.length) {
    const plain = text.slice(last).trim()
    if (plain) {
      result.push(
        ...plain
          .split(/(?<=[.!?…»])\s+/)
          .map(s => s.trim())
          .filter(Boolean),
      )
    }
  }
  return result
}

/** Durée totale d'un plan en millisecondes. */
export function computePlanDuration(
  phrases: string[],
  wpm = 180,
  wordIntervalMs = 200,
): number {
  const timings = computePhraseTimings(phrases, wpm, wordIntervalMs)
  return timings.length > 0 ? timings[timings.length - 1].end_ms : 0
}

// ── Conversion ancrage → fenêtre temporelle ──────────────────────────────────

/**
 * Convertit l'ancrage d'un bloc en fenêtre {start_ms, end_ms} absolue dans le plan.
 * Utilisé pour le rendu visuel et la lecture.
 *
 * Pour le mode 'after', on résout récursivement via `allBlocks` — le bloc démarre
 * à la fin du bloc référencé et dure `duration_ms`. Garde contre les cycles.
 */
export function blockTimeWindow(
  block: MediaBlock,
  timings: PhraseTiming[],
  allBlocks?: MediaBlock[],
  visited: Set<string> = new Set(),
): { start_ms: number; end_ms: number } {
  if (block.anchor.mode === 'time') {
    return { start_ms: block.anchor.start_ms, end_ms: block.anchor.end_ms }
  }
  if (block.anchor.mode === 'phrase') {
    const startIdx = Math.max(0, Math.min(timings.length - 1, block.anchor.start_phrase))
    const endIdx = Math.max(startIdx, Math.min(timings.length - 1, block.anchor.end_phrase))
    return {
      start_ms: timings[startIdx]?.start_ms ?? 0,
      end_ms: timings[endIdx]?.end_ms ?? 0,
    }
  }
  // mode === 'after' (narrowing explicite)
  const afterAnchor = block.anchor as Extract<MediaAnchor, { mode: 'after' }>
  if (visited.has(block.id)) {
    // cycle détecté → fallback + warn pour aider au debug
    if (typeof window !== 'undefined') {
      console.warn(`[timeline] Cycle d'ancrage détecté sur bloc ${block.id} (${block.label ?? block.type}). Les blocs se référencent mutuellement — revois les "Après un bloc" de ce plan.`)
    }
    return { start_ms: 0, end_ms: afterAnchor.duration_ms }
  }
  visited.add(block.id)
  if (allBlocks) {
    const ref = allBlocks.find(b => b.id === afterAnchor.after_block_id)
    if (ref) {
      const refWin = blockTimeWindow(ref, timings, allBlocks, visited)
      return { start_ms: refWin.end_ms, end_ms: refWin.end_ms + afterAnchor.duration_ms }
    }
  }
  // bloc référencé introuvable → démarre au début
  return { start_ms: 0, end_ms: afterAnchor.duration_ms }
}

// ── Helpers UI ───────────────────────────────────────────────────────────────

export function formatDurationMs(ms: number): string {
  const totalSec = ms / 1000
  if (totalSec < 1) return `${ms}ms`
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`
  const min = Math.floor(totalSec / 60)
  const sec = Math.round(totalSec % 60)
  return `${min}m ${sec.toString().padStart(2, '0')}s`
}

export function blockTypeColor(type: MediaBlockType): string {
  switch (type) {
    case 'image':
      return '#e0a742' // doré
    case 'variant':
      return '#b48edd' // violet
    case 'derivation':
      return '#64b5f6' // bleu clair
    case 'travelling':
      return '#7ab8d8' // cyan
    case 'video':
      return '#e8a84c' // orange
  }
}

export function blockTypeIcon(type: MediaBlockType): string {
  switch (type) {
    case 'image':
      return '🖼️'
    case 'variant':
      return '🎲'
    case 'derivation':
      return '🔄'
    case 'travelling':
      return '📐'
    case 'video':
      return '🎬'
  }
}
