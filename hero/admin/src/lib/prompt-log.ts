'use client'
/**
 * prompt-log — Capture client-side de tous les prompts/payloads envoyés aux
 * APIs AI/vidéo/audio de Hero pour visualisation/debug par l'auteur.
 *
 * Refonte 2026-05-10 : feature "voir tout ce qui est envoyé" demandée pour
 * pouvoir diagnostiquer les outputs LTX/Mistral/Qwen/ElevenLabs sans aller
 * fouiller la console F12 ou les logs serveur Next.
 *
 * Architecture :
 *   - Module-level array (max 100 entrées, ring buffer-like)
 *   - Listeners abonnés via subscribe() pour re-render React via
 *     useSyncExternalStore dans le PromptInspector
 *   - installFetchInterceptor() patche window.fetch UNE FOIS au mount du layout
 *     pour intercepter automatiquement toutes les requêtes matchant URL_PATTERNS.
 *     Pas d'injection manuelle dans chaque appel — zéro modif des callers.
 *   - body/response parsés en JSON si possible, sinon stockés en raw text
 *   - response.clone() pour lire le body sans consumer le stream original
 *
 * Sécurité/perf :
 *   - Skipped si pas dans le navigateur (SSR safe)
 *   - Réinstallation idempotente (`installed` flag)
 *   - Body responses limitées à ~500KB pour éviter explosion mémoire si une
 *     réponse vidéo MP4 binaire passe par fetch (improbable mais défensif)
 */

export interface PromptLogEntry {
  id: string
  timestamp: number          // Date.now()
  url: string
  method: string             // GET / POST / PATCH / etc.
  /** Body parsé en JSON si applicable. */
  body?: unknown
  /** Body brut si non-JSON OU si parse échoue. */
  bodyText?: string
  /** HTTP status final (undefined si erreur réseau). */
  status?: number
  durationMs?: number
  /** Response parsée en JSON si applicable. */
  response?: unknown
  /** Response brute (truncatée si très grande). */
  responseText?: string
  /** Message d'erreur si la requête a fail (erreur réseau, abort, …). */
  error?: string
}

const MAX_ENTRIES = 100
const MAX_RESPONSE_TEXT_BYTES = 500_000  // 500KB par response (truncate au-delà)
const URL_PATTERNS = [
  '/api/ai/',                   // Mistral extract, futurs endpoints AI
  '/api/comfyui',               // LTX, Qwen, Flux, etc. (workflows ComfyUI)
  '/api/elevenlabs',            // TTS
  '/api/describe-scene',        // Qwen VL
  '/api/translate-text',        // Claude Haiku
  '/api/audio/',                // concat
  '/api/storage/upload',        // crops, audios, images uploadées
  '/api/generate',              // routes /api/generate*
]

let entries: PromptLogEntry[] = []
const listeners = new Set<() => void>()
let installed = false

/** Snapshot courant — utilisé par useSyncExternalStore. Référence stable
 *  quand pas d'event = pas de re-render inutile. */
export function getEntries(): PromptLogEntry[] {
  return entries
}

/** Abonne un listener (UI panel) qui se déclenche à chaque mutation. Retour
 *  = unsubscribe pour cleanup useEffect. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function clearAll(): void {
  entries = []
  notify()
}

function notify(): void {
  // Recrée un nouveau array pour que useSyncExternalStore détecte le change
  // (référence change). Sans ça, snapshot stable = pas de re-render.
  entries = [...entries]
  for (const l of listeners) l()
}

function pushEntry(entry: PromptLogEntry): void {
  entries = [entry, ...entries].slice(0, MAX_ENTRIES)
  for (const l of listeners) l()
}

/** Patche window.fetch UNE FOIS pour logger les requêtes matchant URL_PATTERNS.
 *  Idempotent : safe d'appeler depuis plusieurs layouts. SSR safe (no-op si
 *  window indéfini). */
export function installFetchInterceptor(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const original = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined) ?? 'GET').toUpperCase()

    const matches = URL_PATTERNS.some(p => url.includes(p))
    if (!matches) return original(input, init)

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

    // Capture body avant le send (init.body est consumé après)
    let bodyText: string | undefined
    let bodyParsed: unknown
    if (init?.body) {
      if (typeof init.body === 'string') {
        bodyText = init.body
        try { bodyParsed = JSON.parse(init.body) } catch { /* not JSON, keep as text */ }
      } else if (init.body instanceof FormData) {
        bodyText = '[FormData]'  // ne pas tenter de sérialiser, peut contenir des Files
      } else if (init.body instanceof Blob) {
        bodyText = `[Blob ${init.body.size} bytes ${init.body.type}]`
      } else {
        bodyText = String(init.body)
      }
    }

    try {
      const res = await original(input, init)
      // Clone pour lire le body sans consumer l'original (qui sera consumé par
      // le caller avec res.json() etc.)
      let responseText: string | undefined
      let responseParsed: unknown
      try {
        const clone = res.clone()
        const buf = await clone.text()
        if (buf.length > MAX_RESPONSE_TEXT_BYTES) {
          responseText = buf.slice(0, MAX_RESPONSE_TEXT_BYTES) + `\n[…truncated, total=${buf.length}B]`
        } else {
          responseText = buf
        }
        if (responseText) {
          try { responseParsed = JSON.parse(responseText) } catch { /* not JSON */ }
        }
      } catch {
        // Clone/read échoué (rare, ex: stream déjà consommé) — on log sans response
      }

      pushEntry({
        id, timestamp: Date.now(), url, method,
        body: bodyParsed, bodyText,
        status: res.status,
        durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
        response: responseParsed,
        responseText,
      })
      return res
    } catch (err) {
      pushEntry({
        id, timestamp: Date.now(), url, method,
        body: bodyParsed, bodyText,
        durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}
