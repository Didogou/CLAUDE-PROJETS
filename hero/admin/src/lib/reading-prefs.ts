/**
 * Source unique des paramètres de rendu d'un plan, consommée par :
 *   - simulateur (GameSimTab / SectionPreviewCard)
 *   - mini-tel preview (panneau illustration)
 *   - timeline éditeur
 *   - transitions cinématiques
 *
 * Cascade de résolution (du plus spécifique au plus général) :
 *   plan.plan_prefs.X
 *     ↳ globalSimPrefs.X         (localStorage `sim_prefs_<pathname>`)
 *       ↳ PLAN_DEFAULTS.X        (constantes)
 */

// ── Type runtime (camelCase) consommé par les composants ─────────────────────

export interface PlanPrefs {
  wpm: 120 | 180 | 240
  wordIntervalMs: 120 | 200 | 280 | 400
  captionStyle: 1 | 2 | 3
  textFontSize: 13 | 15 | 17 | 19
  thoughtStyle: 1 | 2 | 3
  /** Pause (ms) entre 2 phrases atomiques. Défaut 4000 (= 2s readReady + 2s autoAdvance simulateur). */
  phraseGapMs: number
}

export const PLAN_DEFAULTS: PlanPrefs = {
  wpm: 180,
  wordIntervalMs: 200,
  captionStyle: 1,
  textFontSize: 15,
  thoughtStyle: 3,
  phraseGapMs: 4000,
}

// ── Type stockage (snake_case) — image.plan_prefs ────────────────────────────

export interface PlanPrefsOverride {
  wpm?: 120 | 180 | 240
  word_interval_ms?: 120 | 200 | 280 | 400
  caption_style?: 1 | 2 | 3
  text_font_size?: 13 | 15 | 17 | 19
  thought_style?: 1 | 2 | 3
  phrase_gap_ms?: number
}

/** Convertit un override snake_case en patch camelCase (sans clés undefined). */
function fromOverride(o: PlanPrefsOverride | undefined): Partial<PlanPrefs> {
  if (!o) return {}
  const out: Partial<PlanPrefs> = {}
  if (o.wpm != null) out.wpm = o.wpm
  if (o.word_interval_ms != null) out.wordIntervalMs = o.word_interval_ms
  if (o.caption_style != null) out.captionStyle = o.caption_style
  if (o.text_font_size != null) out.textFontSize = o.text_font_size
  if (o.thought_style != null) out.thoughtStyle = o.thought_style
  if (o.phrase_gap_ms != null) out.phraseGapMs = o.phrase_gap_ms
  return out
}

/** Lit un objet "simPrefs" libre (camelCase, partiellement renseigné) en patch typé. */
function fromGlobal(g: Record<string, unknown> | undefined): Partial<PlanPrefs> {
  if (!g) return {}
  const out: Partial<PlanPrefs> = {}
  if (typeof g.readingWpm === 'number') out.wpm = g.readingWpm as PlanPrefs['wpm']
  if (typeof g.wordIntervalMs === 'number') out.wordIntervalMs = g.wordIntervalMs as PlanPrefs['wordIntervalMs']
  if (typeof g.captionStyle === 'number') out.captionStyle = g.captionStyle as PlanPrefs['captionStyle']
  if (typeof g.textFontSize === 'number') out.textFontSize = g.textFontSize as PlanPrefs['textFontSize']
  if (typeof g.thoughtStyle === 'number') out.thoughtStyle = g.thoughtStyle as PlanPrefs['thoughtStyle']
  if (typeof g.phraseGapMs === 'number') out.phraseGapMs = g.phraseGapMs
  return out
}

/**
 * Calcule les prefs effectives d'un plan en fusionnant override plan + global + défauts.
 * Garantit qu'aucun champ ne vaut undefined.
 */
export function effectivePlanPrefs(
  planOverride: PlanPrefsOverride | undefined,
  globalSimPrefs: Record<string, unknown> | undefined,
): PlanPrefs {
  return {
    ...PLAN_DEFAULTS,
    ...fromGlobal(globalSimPrefs),
    ...fromOverride(planOverride),
  }
}

// ── Compat : helper restreint à la lecture (wpm + interval seulement) ─────────

export interface ReadingPrefs {
  wpm: number
  wordIntervalMs: number
}

export const READING_DEFAULTS: ReadingPrefs = { wpm: PLAN_DEFAULTS.wpm, wordIntervalMs: PLAN_DEFAULTS.wordIntervalMs }

export function effectiveReadingPrefs(
  planOverride: PlanPrefsOverride | { wpm?: number; word_interval_ms?: number } | undefined,
  globalDefault: Partial<ReadingPrefs> | Record<string, unknown> | undefined,
): ReadingPrefs {
  const full = effectivePlanPrefs(planOverride as PlanPrefsOverride | undefined, globalDefault as Record<string, unknown> | undefined)
  return { wpm: full.wpm, wordIntervalMs: full.wordIntervalMs }
}

// ── Mots rouges (auto + override plan) ───────────────────────────────────────

export function effectiveRedWords(
  autoWords: Set<string>,
  planRedWords: string[] | undefined,
): Set<string> {
  if (!planRedWords || planRedWords.length === 0) return autoWords
  const merged = new Set(autoWords)
  for (const w of planRedWords) {
    const clean = w.trim().toLowerCase()
    if (clean) merged.add(clean)
  }
  return merged
}

// ── localStorage helpers (défauts globaux) ────────────────────────────────────

export const SIM_PREFS_EVENT = 'hero-sim-prefs-changed'

export function simPrefsStorageKey(pathname: string): string {
  return `sim_prefs_${pathname}`
}

/** Émet un event window pour notifier toute la page (BookPage + GameSimTab + panels). */
export function broadcastSimPrefsChange(prefs: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SIM_PREFS_EVENT, { detail: prefs }))
}
