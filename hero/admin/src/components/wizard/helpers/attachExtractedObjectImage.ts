/**
 * Helper autonome pour attacher une image extraite à un Objet (Item) du livre,
 * soit en mettant à jour un Item existant, soit en en créant un nouveau.
 *
 * L'URL est stockée dans `illustration_url` (l'image principale de l'objet,
 * affichée sur la scène et dans les fiches).
 *
 * Miroir de attachExtractedPortrait.ts (pour les NPCs). Design identique :
 *   - logique pure, zéro state React
 *   - renvoie un résultat structuré que l'appelant applique à son state
 */
import type { Item } from '@/types'

export type AttachObjectAction =
  | { action: 'cancel' }
  | { action: 'update'; item: Item }
  | { action: 'create'; item: Item }
  | { action: 'error'; message: string }

export interface AttachExtractedObjectImageParams {
  bookId: string
  /** Items existants pour proposer une MAJ si nom matche. */
  items: Item[]
  /** URL de l'image à stocker dans illustration_url. */
  imageUrl: string
  /** Optionnel : ID d'un Item existant à cibler directement (évite le prompt). */
  targetItemId?: string
  /** Optionnel : nom à créer si aucun existant ne matche (évite le prompt). */
  newItemName?: string
  /** Optionnel : override pour les prompts utilisateur (test friendly). */
  prompt?: (message: string) => string | null
}

const MINIMAL_ITEM_DEFAULTS = {
  // 'outil' = catégorie la plus générique (pas d'effet spécial par défaut).
  // L'utilisateur changera via la fiche Item si besoin.
  item_type: 'outil' as const,
  category: 'persistant' as const,
  description: '',
  sections_used: [] as string[],
  effect: {} as Record<string, unknown>,
}

export async function attachExtractedObjectImage(
  params: AttachExtractedObjectImageParams,
): Promise<AttachObjectAction> {
  const { bookId, items, imageUrl, targetItemId, newItemName } = params
  const promptFn = params.prompt ?? ((m: string) => window.prompt(m, ''))

  // Mode direct : si targetItemId ou newItemName fournis, pas de prompt.
  let nameOrId: string | null = null
  if (targetItemId) {
    const target = items.find(i => i.id === targetItemId)
    if (!target) return { action: 'error', message: 'Item introuvable.' }
    const r = await fetch(`/api/items/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ illustration_url: imageUrl }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      return { action: 'error', message: `MAJ Item échouée : ${e.error ?? r.status}` }
    }
    return { action: 'update', item: { ...target, illustration_url: imageUrl } }
  }

  if (newItemName) {
    nameOrId = newItemName
  } else {
    // Mode prompt : récap + demande nom
    const list = items.length > 0
      ? '\n\nObjets existants :\n' + items.map((it, k) => `  ${k + 1}. ${it.name}${it.illustration_url ? ' ✓' : ''}`).join('\n')
      : '\n\n(Aucun objet existant — un nouveau sera créé.)'
    const message =
      'Image extraite — quel objet ?\n' +
      '→ Tape un nom existant pour MAJ son illustration.\n' +
      '→ Tape un nouveau nom pour créer un Item.' +
      list
    nameOrId = promptFn(message)?.trim() ?? null
    if (!nameOrId) return { action: 'cancel' }
  }

  const existing = items.find(i => i.name.toLowerCase() === nameOrId!.toLowerCase())

  if (existing) {
    const r = await fetch(`/api/items/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ illustration_url: imageUrl }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      return { action: 'error', message: `MAJ Item échouée : ${e.error ?? r.status}` }
    }
    return { action: 'update', item: { ...existing, illustration_url: imageUrl } }
  }

  // Création d'un nouvel Item
  const r = await fetch(`/api/books/${bookId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: nameOrId,
      ...MINIMAL_ITEM_DEFAULTS,
      illustration_url: imageUrl,
    }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    return { action: 'error', message: `Création Item échouée : ${e.error ?? r.status}` }
  }
  const data = await r.json()
  const created = (data.item ?? data) as Item
  return { action: 'create', item: created }
}
