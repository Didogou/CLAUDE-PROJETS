/**
 * Déclarations des tools exposés à l'IA co-auteur.
 *
 * Chaque tool a :
 *   - nom (stable, utilisé par l'IA)
 *   - description (guide l'IA, montre quand utiliser)
 *   - inputSchema (JSON Schema, valide les args)
 *
 * Pour le POC : un seul tool `create_npc`. À étendre au fur et à mesure
 * (create_section, add_choice, set_condition…).
 */

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>  // JSON Schema draft 7 compatible (sous-ensemble commun)
}

export const CREATE_NPC_TOOL: ToolDefinition = {
  name: 'create_npc',
  description:
    "Crée un personnage non-joueur (PNJ) dans le livre de l'auteur. À utiliser UNIQUEMENT quand tu as un nom, un type (allié/ennemi/neutre) ET une brève description. Si l'auteur hésite, propose-lui plusieurs options avant d'appeler ce tool.",
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: "Nom du PNJ (ex: 'Travis', 'Gregor le barman', 'Mystérieux inconnu')",
      },
      type: {
        type: 'string',
        enum: ['ally', 'enemy', 'neutral'],
        description: "Rôle narratif : 'ally' (dans le gang/équipe du héros), 'enemy' (adversaire), 'neutral' (marchand, informateur, passant important)",
      },
      description: {
        type: 'string',
        description: "Description physique + rôle en 1-2 phrases. En français si l'auteur parle français, sinon dans sa langue.",
      },
    },
    required: ['name', 'type', 'description'],
  },
}

export const ALL_TOOLS: ToolDefinition[] = [CREATE_NPC_TOOL]

/** Stock en mémoire des NPCs créés pendant la session POC (pas de DB). */
export interface CreatedNpc {
  id: string
  name: string
  type: 'ally' | 'enemy' | 'neutral'
  description: string
  createdAt: number
}

/** Exécute un tool côté serveur et retourne le résultat à renvoyer à l'IA. */
export function executeTool(
  name: string,
  args: Record<string, unknown>,
  session: { npcs: CreatedNpc[] },
): { result: unknown; error?: string } {
  switch (name) {
    case 'create_npc': {
      const { name: npcName, type, description } = args as {
        name: string
        type: 'ally' | 'enemy' | 'neutral'
        description: string
      }
      if (!npcName || !type || !description) {
        return { result: null, error: 'Champs requis manquants : name, type, description' }
      }
      const npc: CreatedNpc = {
        id: `npc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: npcName,
        type,
        description,
        createdAt: Date.now(),
      }
      session.npcs.push(npc)
      return { result: { success: true, npc_id: npc.id, message: `PNJ "${npcName}" créé.` } }
    }
    default:
      return { result: null, error: `Tool inconnu : ${name}` }
  }
}
