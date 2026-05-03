/**
 * Parseur de texte unifié — extrait du simulateur (page.tsx parseTaggedSegments + getNarrChunks).
 *
 * Source unique consommée par :
 *   - simulateur (SectionPreviewCard, blocs narratif/auto-advance)
 *   - mini-tel preview (PlanFrame / PlanPlayer)
 *   - timeline éditeur
 *   - tout futur lecteur
 *
 * Convention de tags reconnue :
 *   [name]contenu[/name]                 → speaker = "name", bubbleType = ("foule" si name='foule', undefined sinon)
 *   [name:type]contenu[/name:type]       → speaker = "name", bubbleType = "type"
 *   Tags non fermés (corruption distribution) → tolérés via fallback regex
 */

export type BubbleType = 'discours' | 'foule' | 'pensee' | 'discussion' | 'radio' | 'bruit'

export interface NarrChunk {
  text: string
  /** True si ce chunk termine une phrase complète (.!?…»). Ajoute un break long. */
  lineBreak: boolean
  speaker?: string
  bubbleType?: string  // string libre (peut être un BubbleType ou une valeur custom)
}

export interface TaggedSegment {
  text: string
  speaker?: string
  bubbleType?: string
}

// ── Parser principal ────────────────────────────────────────────────────────

/**
 * Découpe un texte en segments taggés/non-taggés.
 * "[cypress:discours]Hi.[/cypress:discours] Suite." →
 *   [{ speaker:'cypress', bubbleType:'discours', text:'Hi.' }, { text:'Suite.' }]
 */
export function parseTaggedSegments(text: string): TaggedSegment[] {
  const segments: TaggedSegment[] = []
  const tagRe = /\[([a-zA-ZÀ-ÿ0-9_:]+)\]([\s\S]*?)\[\/\1\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(text)) !== null) {
    if (m.index > last) {
      const plain = text.slice(last, m.index).trim()
      if (plain) segments.push({ text: plain })
    }
    const full = m[1].toLowerCase()
    const colonIdx = full.indexOf(':')
    const speaker = colonIdx >= 0 ? full.slice(0, colonIdx) : full
    const bubbleType = colonIdx >= 0 ? full.slice(colonIdx + 1) : (speaker === 'foule' ? 'foule' : undefined)
    segments.push({ speaker, bubbleType, text: m[2].trim() })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    const remainder = text.slice(last)
    // Tag ouvrant non fermé (corruption) → fallback
    const unclosedRe = /\[([a-zA-ZÀ-ÿ0-9_:]+)\]([\s\S]+)$/
    const uc = unclosedRe.exec(remainder)
    if (uc) {
      const plain = remainder.slice(0, uc.index).trim()
      if (plain) segments.push({ text: plain })
      const full = uc[1].toLowerCase()
      const colonIdx = full.indexOf(':')
      const speaker = colonIdx >= 0 ? full.slice(0, colonIdx) : full
      const bubbleType = colonIdx >= 0 ? full.slice(colonIdx + 1) : (speaker === 'foule' ? 'foule' : undefined)
      segments.push({ speaker, bubbleType, text: uc[2].trim() })
    } else {
      const plain = remainder.trim()
      if (plain) segments.push({ text: plain })
    }
  }
  return segments.length ? segments : [{ text }]
}

/**
 * Découpe une phrase (potentiellement multi-tag) en chunks de chunks à révéler un par un.
 * Logique exacte du simulateur : split sur ponctuation forte, puis sur virgules/points-virgules.
 */
export function getNarrChunks(text: string): NarrChunk[] {
  const result: NarrChunk[] = []
  const segments = parseTaggedSegments(text)
  for (const seg of segments) {
    const lines = seg.text.split(/(?<=[.!?…»])\s+/).map(s => s.trim()).filter(Boolean)
    for (const line of lines) {
      const inlines = line.split(/(?<=[,;:])[ ]*/g).map(s => s.trim()).filter(Boolean)
      for (let i = 0; i < inlines.length; i++) {
        result.push({ text: inlines[i], lineBreak: i === inlines.length - 1, speaker: seg.speaker, bubbleType: seg.bubbleType })
      }
    }
  }
  return result
}

// ── Timing : formule exacte du simulateur ────────────────────────────────────

/**
 * Délai d'apparition d'un chunk (ms). Formule miroir du simulateur (page.tsx ~10898) :
 *   delay = readMs(chunk précédent) + baseBreak(chunk précédent)
 *   readMs = round(wordCount / wpm * 60_000)
 *   baseBreak = lineBreak ? interval×5 : interval×2
 *
 * On retourne ici la DURÉE PROPRE du chunk (= délai jusqu'au suivant).
 * Le simulateur utilise la même valeur côté setTimeout.
 */
export function chunkDurationMs(chunk: NarrChunk, wpm: number, wordIntervalMs: number): number {
  const wordCount = chunk.text.split(/\s+/).filter(Boolean).length
  const readMs = Math.round((wordCount / Math.max(1, wpm)) * 60_000)
  const baseBreak = chunk.lineBreak ? wordIntervalMs * 5 : wordIntervalMs * 2
  return readMs + baseBreak
}

/** Pause par défaut entre 2 phrases (ms). Simulateur : 2s readReady + 2s autoAdvance = 4s.
 *  Désormais paramétrable via `phraseGapMs` sur computePhraseTimings/getVisibleTextAtCursor. */
export const PHRASE_GAP_MS_DEFAULT = 4000
/** @deprecated utiliser PHRASE_GAP_MS_DEFAULT ou le param `phraseGapMs`. Conservé pour compat. */
export const PHRASE_GAP_MS = PHRASE_GAP_MS_DEFAULT

// ── Timing par phrase + helper pour cursor-based playback ────────────────────

export interface PhraseTiming {
  index: number
  text: string
  start_ms: number
  end_ms: number
  duration_ms: number
}

export function computePhraseTimings(
  phrases: string[],
  wpm = 180,
  wordIntervalMs = 200,
  phraseGapMs: number = PHRASE_GAP_MS_DEFAULT,
): PhraseTiming[] {
  const result: PhraseTiming[] = []
  let cursor = 0
  for (let i = 0; i < phrases.length; i++) {
    const text = phrases[i] ?? ''
    const chunks = getNarrChunks(text)
    const duration = chunks.length > 0
      ? chunks.reduce((sum, c) => sum + chunkDurationMs(c, wpm, wordIntervalMs), 0)
      : 800 // phrase vide → durée minimale
    result.push({ index: i, text, start_ms: cursor, end_ms: cursor + duration, duration_ms: duration })
    cursor += duration + phraseGapMs
  }
  return result
}

export interface VisibleText {
  phraseIndex: number
  visibleChunks: NarrChunk[]
  newestChunkIdx: number
  inGap: boolean
}

/**
 * À un instant `cursorMs`, retourne quels chunks de quelle phrase doivent être visibles.
 * Reproduit l'accumulation chunk-par-chunk du simulateur.
 */
export function getVisibleTextAtCursor(
  cursorMs: number,
  phrases: string[],
  timings: PhraseTiming[],
  wpm: number,
  wordIntervalMs: number,
  phraseGapMs: number = PHRASE_GAP_MS_DEFAULT,
): VisibleText {
  if (timings.length === 0) {
    return { phraseIndex: -1, visibleChunks: [], newestChunkIdx: -1, inGap: false }
  }
  const last = timings[timings.length - 1]
  if (cursorMs >= last.end_ms + phraseGapMs) {
    return { phraseIndex: last.index, visibleChunks: getNarrChunks(last.text), newestChunkIdx: -1, inGap: true }
  }
  for (const t of timings) {
    if (cursorMs < t.start_ms) {
      const prev = timings[t.index - 1]
      if (!prev) return { phraseIndex: -1, visibleChunks: [], newestChunkIdx: -1, inGap: false }
      return { phraseIndex: prev.index, visibleChunks: getNarrChunks(prev.text), newestChunkIdx: -1, inGap: true }
    }
    if (cursorMs < t.end_ms) {
      const elapsed = cursorMs - t.start_ms
      const chunks = getNarrChunks(t.text)
      const visible: NarrChunk[] = []
      let cumul = 0
      let newestIdx = -1
      for (let k = 0; k < chunks.length; k++) {
        const d = chunkDurationMs(chunks[k], wpm, wordIntervalMs)
        if (cumul <= elapsed) {
          visible.push(chunks[k])
          newestIdx = k
        }
        cumul += d
      }
      return { phraseIndex: t.index, visibleChunks: visible, newestChunkIdx: newestIdx, inGap: false }
    }
    if (cursorMs < t.end_ms + phraseGapMs) {
      return { phraseIndex: t.index, visibleChunks: getNarrChunks(t.text), newestChunkIdx: -1, inGap: true }
    }
  }
  return { phraseIndex: -1, visibleChunks: [], newestChunkIdx: -1, inGap: false }
}
