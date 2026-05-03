/**
 * Helper client : exécute un inpaint SDXL via /api/comfyui/inpaint.
 *
 * Workflow attendu côté UI :
 *   1. L'utilisateur peint un mask blanc sur la zone à corriger
 *      (cf. InpaintMaskCanvas) → blob PNG du mask uploadé
 *   2. Cet helper appelle l'API avec image source + mask + prompt local
 *      ("hands, detailed fingers" pour réparer les mains, etc.)
 *   3. Renvoie l'URL Supabase du résultat inpainté
 */

export interface InpaintRegionParams {
  /** URL Supabase de l'image source. */
  imageUrl: string
  /** URL Supabase du mask (blanc = zone à inpainter, noir = à conserver). */
  maskUrl: string
  /** Filename ComfyUI du checkpoint SDXL. */
  checkpoint: string
  /** Prompt positif court ciblant la zone (ex: "hands, detailed fingers, anatomically correct"). */
  promptPositive: string
  /** Prompt négatif optionnel (sinon défaut SDXL anti-mains-cassées). */
  promptNegative?: string
  /** Chemin Supabase de stockage du résultat. */
  storagePath: string
  /** Force du redessin (0-1). 0.85 par défaut, plus élevé = remplacement plus drastique. */
  denoise?: number
  steps?: number
  cfg?: number
}

export async function inpaintRegion(params: InpaintRegionParams): Promise<string> {
  const res = await fetch('/api/comfyui/inpaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: params.imageUrl,
      mask_url: params.maskUrl,
      checkpoint: params.checkpoint,
      prompt_positive: params.promptPositive,
      prompt_negative: params.promptNegative,
      storage_path: params.storagePath,
      steps: params.steps,
      cfg: params.cfg,
      denoise: params.denoise,
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Inpaint a échoué (${res.status}). ${errText.slice(0, 300)}`)
  }
  const d = await res.json()
  if (!d.image_url) throw new Error(d.error || 'Inpaint : pas d\'URL en retour')
  return d.image_url as string
}
