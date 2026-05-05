/**
 * Wrapper utilitaire pour libérer la VRAM ComfyUI AVANT + APRÈS chaque génération.
 *
 * Principe de base Hero (cf `feedback_always_free_vram_after_gen.md`) : sur 8 GB
 * VRAM, ne PAS libérer entre 2 wf = OOM systématique. Ce wrapper standardise
 * le pattern pour tous les helpers ComfyUI.
 *
 * Usage :
 *   export const runMyHelper = (opts) => withFreeVram(() => _runMyHelperImpl(opts))
 *
 * Le wrapper :
 *   1. Free AVANT (POST /api/comfyui/free) → libère ce qui reste de la gen précédente
 *   2. Attend 1.5s pour laisser Python collect (gc.collect implicite)
 *   3. Exécute la fonction
 *   4. Free APRÈS dans `finally` (même en cas d'erreur) → libère ce qui a été chargé
 *
 * Note : le free fetch est `.catch(() => {})` car non-critique. Si /free
 * échoue, on continue quand même — la gen peut tomber en OOM mais ne doit pas
 * être bloquée par un free qui foire.
 */

const FREE_URL = '/api/comfyui/free'
const POST_FREE_DELAY_MS = 1500  // laisse Python gc.collect après le free

/**
 * Wrap n'importe quelle fonction async ComfyUI avec free VRAM AVANT + APRÈS.
 * @param fn Fonction async à exécuter (souvent l'impl interne `_runXxxImpl`)
 * @returns Le résultat de fn, ou throw si fn throw
 */
export async function withFreeVram<T>(fn: () => Promise<T>): Promise<T> {
  // Free AVANT
  await fetch(FREE_URL, { method: 'POST' }).catch(() => {})
  await new Promise(r => setTimeout(r, POST_FREE_DELAY_MS))

  try {
    return await fn()
  } finally {
    // Free APRÈS (même en cas d'erreur — important pour ne pas laisser
    // de modèles chargés après une gen qui crash en cours)
    await fetch(FREE_URL, { method: 'POST' }).catch(() => {})
  }
}
