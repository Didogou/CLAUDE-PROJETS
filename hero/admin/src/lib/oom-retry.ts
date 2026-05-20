/**
 * oom-retry — wrapper retry-on-CUDA-OOM pour les helpers ComfyUI client.
 *
 * Refonte 2026-05-12 (option B retry auto). Pattern :
 *   1. Premier essai normal
 *   2. Si erreur capture mot-clé OOM/CUDA → force free VRAM agressif
 *      (/api/comfyui/force-free) + attente 2s + retry
 *   3. Si 2e essai aussi plante → throw normal
 *
 * Avantage : invisible pour le caller en usage normal (1 seul essai), robuste
 * si OOM (1 retry auto, ~30s extra dû au reload du modèle).
 */

const OOM_PATTERNS = [
  /out of memory/i,
  /outofmemory/i,
  /cudaerror/i,
  /accelerat/i,  // torch.AcceleratorError
  /cuda runtime error/i,
]

/** True si le message d'erreur ressemble à un CUDA OOM. */
export function isOomError(message: string): boolean {
  return OOM_PATTERNS.some(re => re.test(message))
}

interface WithOomRetryOpts {
  /** Nombre de retries après le 1er essai. Défaut 1 (= 1 retry max). */
  maxRetries?: number
  /** Délai (ms) après free avant retry. Défaut 2500. */
  retryDelayMs?: number
  /** Hook appelé quand on détecte un OOM (avant retry). Permet au caller de
   *  mettre à jour l'UI (genre BakeStatus "Récupération mémoire en cours…"). */
  onOomDetected?: (attempt: number) => void
}

/**
 * Exécute `fn` et retry automatiquement si on détecte une erreur CUDA OOM.
 * Force un free VRAM agressif côté ComfyUI entre les essais.
 */
export async function withOomRetry<T>(fn: () => Promise<T>, opts?: WithOomRetryOpts): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 1
  const retryDelayMs = opts?.retryDelayMs ?? 2500
  let lastErr: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (!isOomError(msg) || attempt >= maxRetries) {
        // Pas OOM, ou plus de retries disponibles → throw normalement
        throw err
      }
      console.warn(
        `[oom-retry] OOM détecté (tentative ${attempt + 1}/${maxRetries + 1}). ` +
        `Force free VRAM + retry dans ${retryDelayMs}ms…`,
        msg.slice(0, 200),
      )
      opts?.onOomDetected?.(attempt + 1)
      try {
        await fetch('/api/comfyui/force-free', { method: 'POST' })
      } catch (freeErr) {
        console.warn('[oom-retry] force-free a échoué :', freeErr)
      }
      await new Promise(r => setTimeout(r, retryDelayMs))
    }
  }

  // Théoriquement inaccessible (throw dans la boucle), mais TS exige un return
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
