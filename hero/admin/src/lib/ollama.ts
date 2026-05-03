/**
 * Ollama client wrapper.
 *
 * Ollama est un serveur local qui expose des modèles LLM (Phi-3, Qwen, Llama…)
 * sur localhost:11434. Installation :
 *   1. https://ollama.com/download (Windows installer)
 *   2. `ollama pull qwen2.5:1.5b` (~1GB) ou `ollama pull phi3:mini` (~2.3GB)
 *   3. Le service tourne automatiquement en arrière-plan
 *
 * Variables d'env :
 *   OLLAMA_HOST  (default: http://localhost:11434)
 *   OLLAMA_MODEL (default: qwen2.5:1.5b)
 *
 * Utilisation typique :
 *   const result = await ollamaJSON({ system, prompt, schemaHint })
 *   // result est un objet JS parsé depuis la réponse JSON du modèle
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b'

export interface OllamaJSONOptions {
  /** System prompt — instructions de format / rôle du modèle. */
  system: string
  /** User prompt — la requête concrète. */
  prompt: string
  /** Modèle à utiliser. Default : env OLLAMA_MODEL ou 'qwen2.5:1.5b'. */
  model?: string
  /** Température. Default 0.1 (déterministe pour NLU). */
  temperature?: number
  /** Timeout en ms. Default 15s. */
  timeoutMs?: number
}

export interface OllamaError extends Error {
  /** Distinguer "service down" (à installer/démarrer) vs autres erreurs. */
  reason: 'unreachable' | 'timeout' | 'model_not_found' | 'invalid_json' | 'other'
}

/**
 * Appelle Ollama avec contrainte de format JSON (`format: 'json'`) et parse
 * la réponse. Le modèle est forcé de retourner du JSON valide via la contrainte
 * Ollama, mais on parse quand même côté TS pour exposer le typage.
 *
 * Retourne l'objet parsé. Throw OllamaError avec `reason` typé en cas d'échec.
 */
export async function ollamaJSON<T = unknown>(opts: OllamaJSONOptions): Promise<T> {
  const {
    system,
    prompt,
    model = OLLAMA_MODEL,
    temperature = 0.1,
    timeoutMs = 15_000,
  } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        system,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature },
      }),
    })
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error).name === 'AbortError') {
      throw makeError('timeout', `Ollama timeout après ${timeoutMs}ms`)
    }
    throw makeError('unreachable',
      `Ollama injoignable sur ${OLLAMA_HOST}. ` +
      `Vérifie qu'il est installé (https://ollama.com) et démarré.`)
  }
  clearTimeout(timer)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 404 || /model.*not found/i.test(text)) {
      throw makeError('model_not_found',
        `Modèle "${model}" non trouvé. Lance \`ollama pull ${model}\` puis réessaie.`)
    }
    throw makeError('other', `Ollama HTTP ${res.status} : ${text.slice(0, 300)}`)
  }

  const data = await res.json() as { response?: string; error?: string }
  if (data.error) throw makeError('other', data.error)
  if (!data.response) throw makeError('invalid_json', 'Réponse Ollama vide')

  try {
    return JSON.parse(data.response) as T
  } catch {
    throw makeError('invalid_json',
      `Réponse Ollama non-JSON : ${data.response.slice(0, 300)}`)
  }
}

function makeError(reason: OllamaError['reason'], message: string): OllamaError {
  const err = new Error(message) as OllamaError
  err.reason = reason
  return err
}

/** Vérifie si le serveur Ollama répond. Sert à gating l'UI ("activer NLU IA"). */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Support des modèles vision (VLM) — Qwen 2.5 VL, LLaVA, Moondream… ────────
// L'API Ollama accepte un champ `images: string[]` (base64 sans prefix data:)
// pour les modèles vision. Sinon le pattern est identique à ollamaJSON.
//
// Modèle par défaut : qwen2.5vl:3b — ~5-6 GB GGUF, fits 8 GB VRAM, structured
// JSON natif. Drop-in replacement pour Claude Vision dans /api/analyze-pose.
// Voir mémoire `project_image_recognition_local_alternatives.md`.

const OLLAMA_VLM_MODEL = process.env.OLLAMA_VLM_MODEL ?? 'qwen2.5vl:3b'

export interface OllamaVisionJSONOptions extends OllamaJSONOptions {
  /** Images en base64 (sans le préfixe `data:image/...`). Ollama API accepte
   *  un tableau, mais la plupart des VLMs ne traitent qu'une image par appel. */
  images: string[]
}

/**
 * Appelle un VLM via Ollama avec images + prompt + contrainte JSON.
 * Pareil que `ollamaJSON` mais accepte le champ `images: [base64...]`.
 *
 * Default model : qwen2.5vl:3b (à puller via `ollama pull qwen2.5vl:3b`).
 * Override possible via env `OLLAMA_VLM_MODEL`.
 *
 * Timeout par défaut 30s (vs 15s pour ollamaJSON texte) car les VLMs sont
 * plus lents (encodage image + inférence).
 */
export async function ollamaVisionJSON<T = unknown>(opts: OllamaVisionJSONOptions): Promise<T> {
  const {
    system, prompt, images,
    model = OLLAMA_VLM_MODEL,
    temperature = 0.1,
    timeoutMs = 30_000,
  } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        system,
        prompt,
        images,
        stream: false,
        format: 'json',
        options: { temperature },
      }),
    })
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error).name === 'AbortError') {
      throw makeError('timeout', `Ollama VLM timeout après ${timeoutMs}ms`)
    }
    throw makeError('unreachable',
      `Ollama injoignable sur ${OLLAMA_HOST}. ` +
      `Vérifie qu'il est installé (https://ollama.com) et démarré.`)
  }
  clearTimeout(timer)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 404 || /model.*not found/i.test(text)) {
      throw makeError('model_not_found',
        `Modèle VLM "${model}" non trouvé. Lance \`ollama pull ${model}\` puis réessaie.`)
    }
    throw makeError('other', `Ollama HTTP ${res.status} : ${text.slice(0, 300)}`)
  }

  const data = await res.json() as { response?: string; error?: string }
  if (data.error) throw makeError('other', data.error)
  if (!data.response) throw makeError('invalid_json', 'Réponse Ollama VLM vide')

  try {
    return JSON.parse(data.response) as T
  } catch {
    throw makeError('invalid_json',
      `Réponse Ollama VLM non-JSON : ${data.response.slice(0, 300)}`)
  }
}
