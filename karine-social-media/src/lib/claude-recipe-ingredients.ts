import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { RecipeIngredient } from '@/data/recipes';

/**
 * Extrait une liste d'ingrédients structurés depuis un texte libre saisi
 * par Karine en admin (1 ingrédient par ligne typiquement).
 *
 * Utilise Claude Sonnet 4.6 avec tool_use pour forcer un schéma JSON
 * valide. Modèle léger (text-only, pas Vision) → ~2s, coût ~$0.003 par
 * recette.
 *
 * Exemple d'entrée :
 *   200 g de feta
 *   3 tomates mûres
 *   Huile d'olive
 *   Sel, poivre
 *   1 oignon
 *
 * Exemple de sortie :
 *   [
 *     { category: "Produits frais & Laitiers", label: "feta", quantity: 200, unit: "g", note: null },
 *     { category: "Fruits & Légumes", label: "tomates mûres", quantity: 3, unit: null, note: null },
 *     { category: "Épicerie", label: "huile d'olive", quantity: null, unit: null, note: null },
 *     { category: "Épicerie", label: "sel, poivre", quantity: null, unit: null, note: null },
 *     { category: "Fruits & Légumes", label: "oignon", quantity: 1, unit: null, note: null },
 *   ]
 */
export async function extractIngredientsFromText(
  ingredientsText: string,
): Promise<RecipeIngredient[]> {
  const cleaned = ingredientsText.trim();
  if (!cleaned) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    tools: [
      {
        name: 'save_ingredients',
        description:
          'Enregistre la liste d\'ingrédients extraite du texte en JSON structuré.',
        input_schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  category: {
                    type: 'string',
                    description:
                      'Catégorie de courses française (ex: "Fruits & Légumes", "Produits frais & Laitiers", "Épicerie", "Viandes & Charcuterie", "Pain & Autres", "Surgelés", "Boissons"). Choisir parmi ces catégories standards autant que possible.',
                  },
                  label: {
                    type: 'string',
                    description:
                      'Nom de l\'ingrédient SANS quantité ni unité, en minuscules sauf noms propres. Ex: "feta", "tomates cerises", "huile d\'olive".',
                  },
                  quantity: {
                    type: ['number', 'null'],
                    description:
                      'La quantité numérique. null si pas de quantité ("sel, poivre", "huile d\'olive"). Pour "1/2 chou" mettre 0.5.',
                  },
                  unit: {
                    type: ['string', 'null'],
                    description:
                      'L\'unité ("g", "kg", "ml", "cl", "l", "cs" pour cuillère à soupe, "cc" pour cuillère à café, "boule", "sachet", "gousse", "tranche"). null si compte en pièces ("3 courgettes").',
                  },
                  note: {
                    type: ['string', 'null'],
                    description:
                      'Précision libre ("facultatif", "frais", "pour la marinade"). null si rien.',
                  },
                },
                required: ['category', 'label', 'quantity', 'unit', 'note'],
              },
            },
          },
          required: ['items'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'save_ingredients' },
    messages: [
      {
        role: 'user',
        content: `Tu es chargé d'extraire une liste d'ingrédients d'une recette française.

Règles :
- Reste fidèle au texte. N'invente pas d'ingrédient.
- Sépare quantité / unité / label proprement.
- Catégorise selon les rayons supermarché standards :
  Fruits & Légumes / Produits frais & Laitiers / Viandes & Charcuterie /
  Épicerie / Pain & Autres / Surgelés / Boissons.
- Si une ligne contient plusieurs ingrédients groupés ("sel, poivre"), garde-les groupés en UN item.
- Ignore les phrases d'introduction ou de note de bas de page.

Voici le texte :

${cleaned}

Appelle save_ingredients avec ta réponse.`,
      },
    ],
  });

  const toolUse = message.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude n\'a pas appelé save_ingredients.');
  }
  const input = toolUse.input as { items?: unknown };
  if (!Array.isArray(input.items)) {
    throw new Error('Sortie Claude invalide : items n\'est pas un tableau.');
  }
  return input.items
    .map((it): RecipeIngredient | null => {
      if (!it || typeof it !== 'object') return null;
      const obj = it as Record<string, unknown>;
      const category = typeof obj.category === 'string' ? obj.category.trim() : '';
      const label = typeof obj.label === 'string' ? obj.label.trim() : '';
      if (!category || !label) return null;
      return {
        category,
        label,
        quantity: typeof obj.quantity === 'number' ? obj.quantity : null,
        unit: typeof obj.unit === 'string' ? obj.unit.trim() || null : null,
        note: typeof obj.note === 'string' ? obj.note.trim() || null : null,
      };
    })
    .filter((x): x is RecipeIngredient => x !== null);
}
