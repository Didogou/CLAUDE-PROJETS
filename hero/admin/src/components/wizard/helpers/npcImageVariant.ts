/**
 * Helpers purs pour résoudre le bon champ image d'un NPC selon le variant
 * choisi dans une composition 360°.
 *
 *   portrait         → portrait_url         (buste fond gris, ref IPAdapter)
 *   portrait_scenic  → portrait_scenic_url  (buste avec décor, affichage joueur)
 *   fullbody_gray    → fullbody_gray_url    (plein-pied fond gris)
 *   fullbody_scenic  → fullbody_scenic_url  (plein-pied avec décor)
 */
import type { Npc } from '@/types'
import type { NpcImageVariant } from '../types'

/** Récupère l'URL du NPC pour le variant donné. Fallback sur portrait_url si manquant. */
export function resolveNpcImageUrl(npc: Npc, variant: NpcImageVariant = 'portrait'): string | undefined {
  switch (variant) {
    case 'portrait':        return npc.portrait_url
    case 'portrait_scenic': return npc.portrait_scenic_url ?? npc.portrait_url
    case 'fullbody_gray':   return npc.fullbody_gray_url   ?? npc.portrait_url
    case 'fullbody_scenic': return npc.fullbody_scenic_url ?? npc.fullbody_gray_url ?? npc.portrait_url
  }
}

/** Liste des variants qui ont effectivement une URL pour ce NPC. */
export function availableVariants(npc: Npc): { key: NpcImageVariant; label: string; url: string }[] {
  const out: { key: NpcImageVariant; label: string; url: string }[] = []
  if (npc.portrait_url)         out.push({ key: 'portrait',        label: '👤 Portrait (gris)',         url: npc.portrait_url })
  if (npc.portrait_scenic_url)  out.push({ key: 'portrait_scenic', label: '🖼️ Portrait (décor)',        url: npc.portrait_scenic_url })
  if (npc.fullbody_gray_url)    out.push({ key: 'fullbody_gray',   label: '🧍 Plein-pied (gris)',       url: npc.fullbody_gray_url })
  if (npc.fullbody_scenic_url)  out.push({ key: 'fullbody_scenic', label: '🌆 Plein-pied (décor)',      url: npc.fullbody_scenic_url })
  return out
}
