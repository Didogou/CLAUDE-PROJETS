/**
 * Helper client : génère un panorama 360° équirectangulaire via ComfyUI
 * (seamless-tiling spinagon + LoRA 360Redmond + optionnel IPAdapter FaceID).
 *
 * Wrapper léger autour de /api/comfyui/panorama360.
 */

/** Un NPC à injecter via IPAdapter FaceID dans le pano. */
export interface Panorama360Character {
  /** URL Supabase du portrait_url du NPC (sera uploadé dans ComfyUI). */
  portraitUrl: string
  /** Poids IPAdapter (0-1). 0.7 par défaut, moins que scene_composition car le pano est plus large. */
  weight?: number
  /** Nom du NPC (pour logs et storage path). */
  name?: string
}

export interface GeneratePanorama360Params {
  checkpoint: string
  promptPositive: string
  promptNegative?: string
  /** Style (realistic, photo, manga, comic, bnw, dark_fantasy, sketch). Applique le suffix correspondant au prompt. */
  style?: string
  /** Largeur équirectangulaire. 2048 par défaut (VR standard), 4096 pour upscale futur. */
  width?: number
  /** Hauteur. 1024 par défaut (ratio 2:1 obligatoire). */
  height?: number
  /** Filename du LoRA 360Redmond. Laisse undefined pour tester sans LoRA. */
  lora360?: string
  loraStrengthModel?: number
  loraStrengthClip?: number
  /** Persos à injecter via IPAdapter FaceID (chacun avec portrait Supabase + poids). */
  characters?: Panorama360Character[]
  /** Utiliser MakeCircularVAE. Désactiver si GPU Blackwell throw CUDA error. */
  useCircularVae?: boolean
  steps?: number
  cfg?: number
  seed?: number
  storagePath: string
}

export async function generatePanorama360(params: GeneratePanorama360Params): Promise<string> {
  const res = await fetch('/api/comfyui/panorama360', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      checkpoint: params.checkpoint,
      prompt_positive: params.promptPositive,
      prompt_negative: params.promptNegative,
      style: params.style,
      width: params.width,
      height: params.height,
      lora_360: params.lora360,
      lora_strength_model: params.loraStrengthModel,
      lora_strength_clip: params.loraStrengthClip,
      characters: params.characters,
      use_circular_vae: params.useCircularVae,
      steps: params.steps,
      cfg: params.cfg,
      seed: params.seed,
      storage_path: params.storagePath,
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Panorama 360° a échoué (${res.status}). ${errText.slice(0, 400)}`)
  }
  const d = await res.json()
  if (!d.image_url) throw new Error(d.error || 'Panorama 360° : pas d\'URL en retour')
  return d.image_url as string
}
