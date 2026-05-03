/**
 * Helper autonome pour attacher un portrait extrait (via le sous-wizard
 * "Extraire en fiche") à un NPC, soit en mettant à jour un NPC existant,
 * soit en en créant un nouveau.
 *
 * Conçu pour être appelé depuis n'importe quel composant (aujourd'hui
 * page.tsx via le callback onCharacterExtracted du PlanWizard, demain
 * éventuellement depuis la fiche NPC elle-même) sans dupliquer la logique.
 *
 * Le helper gère :
 *   - le prompt utilisateur (choix du NPC ou saisie d'un nouveau nom)
 *   - l'appel API (PATCH /api/npcs/:id ou POST /api/books/:bookId/npcs)
 *   - le retour d'un résultat structuré pour que l'appelant MAJ son state
 *
 * Il ne touche pas directement au state React — l'appelant récupère le
 * résultat ({ action, npc }) et décide comment mettre à jour ses listes.
 */
import type { Npc } from '@/types'

export type AttachPortraitAction =
  | { action: 'cancel' }
  | { action: 'update'; npc: Npc }
  | { action: 'create'; npc: Npc }
  | { action: 'error'; message: string }

export interface AttachExtractedPortraitParams {
  bookId: string
  npcs: Npc[]
  portraitUrl: string
  /**
   * Optionnel : fonction pour prompter l'utilisateur.
   * Défaut = window.prompt. Permet de remplacer par une vraie modale plus tard.
   */
  prompt?: (message: string) => string | null
}

/**
 * Défauts minimaux pour créer un NPC. Alignés sur NPC_DEFAULTS de page.tsx
 * mais dupliqués ici pour rester indépendant du monolithe.
 */
const MINIMAL_NPC_DEFAULTS = {
  type: 'allié' as const,
  description: '',
  appearance: '', origin: '', group_name: '',
  force: 5, agilite: 5, intelligence: 5, magie: 0, endurance: 10, chance: 5,
  special_ability: '', resistances: '', loot: '',
  speech_style: '', dialogue_intro: '',
  voice_id: '', voice_prompt: '',
}

export async function attachExtractedPortrait(
  params: AttachExtractedPortraitParams,
): Promise<AttachPortraitAction> {
  const { bookId, npcs, portraitUrl } = params
  const promptFn = params.prompt ?? ((msg: string) => window.prompt(msg, ''))

  // Récap pour l'utilisateur : liste des NPCs existants (✓ = ont déjà un portrait)
  const list = npcs.length > 0
    ? '\n\nNPCs existants :\n' + npcs.map((n, k) => `  ${k + 1}. ${n.name}${n.portrait_url ? ' ✓' : ''}`).join('\n')
    : '\n\n(Aucun NPC existant — un nouveau sera créé.)'

  const message =
    'Fiche extraite avec succès.\n' +
    'Nom du personnage pour cette fiche ?\n' +
    '→ Tape un nom existant pour MAJ son portrait.\n' +
    '→ Tape un nouveau nom pour créer un NPC.' +
    list

  const name = promptFn(message)?.trim()
  if (!name) return { action: 'cancel' }

  const existing = npcs.find(n => n.name.toLowerCase() === name.toLowerCase())

  if (existing) {
    const r = await fetch(`/api/npcs/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portrait_url: portraitUrl }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      return { action: 'error', message: `MAJ NPC échouée : ${e.error ?? r.status}` }
    }
    return { action: 'update', npc: { ...existing, portrait_url: portraitUrl } }
  }

  // Création d'un nouveau NPC
  const r = await fetch(`/api/books/${bookId}/npcs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      ...MINIMAL_NPC_DEFAULTS,
      portrait_url: portraitUrl,
    }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    return { action: 'error', message: `Création NPC échouée : ${e.error ?? r.status}` }
  }
  const created = await r.json() as Npc
  return { action: 'create', npc: created }
}
