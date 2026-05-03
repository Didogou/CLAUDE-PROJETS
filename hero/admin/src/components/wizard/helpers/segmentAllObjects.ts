/**
 * Helper client : lance SAM 2 auto-segmentation sur une image, récupère
 * l'ensemble des masks détectés (un par objet présent dans l'image).
 *
 * Utilisé par le mode "Baguette magique" de SubExtractCharacter : l'utilisateur
 * n'a qu'à hover → clic, plus besoin de placer des points.
 */

export interface AutoMaskCandidate {
  /** URL Supabase du mask PNG (blanc = objet, noir = fond). */
  url: string
  /** Index d'ordre du mask (du + grand au + petit typiquement). */
  index: number
}

export interface SegmentAllObjectsResult {
  masks: AutoMaskCandidate[]
  count: number
}

// Cache module-level : évite de relancer SAM auto (~30-60s GPU) quand
// l'utilisateur switch plusieurs fois entre modes sur la même image.
// Clé = URL de l'image. Invalidé au reload de la page.
const segmentCache = new Map<string, SegmentAllObjectsResult>()

export async function segmentAllObjects(imageUrl: string, force = false): Promise<SegmentAllObjectsResult> {
  if (!force && segmentCache.has(imageUrl)) {
    return segmentCache.get(imageUrl)!
  }
  // On NE passe PAS min_mask_region_area côté client : la route serveur gère
  // son propre défaut (0 = pas de post-processing, safe). Sinon on écrase la
  // valeur de buildSAM2AutoWorkflow par un faux défaut client.
  const res = await fetch('/api/comfyui/segment-auto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`SAM auto a échoué (${res.status}). ${errText.slice(0, 300)}`)
  }
  const d = await res.json() as SegmentAllObjectsResult
  segmentCache.set(imageUrl, d)
  return d
}

/** Vide le cache (ex : pour relancer une détection après un changement côté ComfyUI). */
export function clearSegmentCache(imageUrl?: string) {
  if (imageUrl) segmentCache.delete(imageUrl)
  else segmentCache.clear()
}
