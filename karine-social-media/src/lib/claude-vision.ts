import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { ShoppingListItem } from '@/data/menus';

/** Réponse structurée extraite d'une image de liste de courses. */
export type ExtractedShoppingList = {
  portions: number | null;
  items: ShoppingListItem[];
};

/**
 * Envoie l'image à Claude Vision et lui demande d'extraire la liste
 * structurée. On utilise le `tool_use` du SDK Anthropic pour forcer un
 * JSON conforme au schéma — ça évite tout problème de parsing.
 *
 * Coût indicatif : Sonnet 4.6 ~ $0.003/$0.015 per Mtok. Une image de
 * liste de courses ≈ 1500 tokens input + 800 tokens output → ~$0.01.
 */
export async function extractShoppingListFromImage(
  imageBuffer: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
): Promise<ExtractedShoppingList> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    tools: [
      {
        name: 'save_shopping_list',
        description:
          'Enregistre la liste de courses extraite de l\'image en JSON structuré.',
        input_schema: {
          type: 'object',
          properties: {
            portions: {
              type: ['integer', 'null'],
              description:
                'Nombre de personnes pour lequel la liste est calibrée (cherche "pour X personnes" ou similaire dans l\'image). null si non mentionné.',
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  category: {
                    type: 'string',
                    description:
                      'La catégorie/section dans laquelle l\'item apparaît (ex: "Fruits & Légumes", "Épicerie", "Viandes & Charcuterie", "Pain & Autres", "Produits frais & Laitiers"). Garder l\'orthographe française avec accents.',
                  },
                  label: {
                    type: 'string',
                    description:
                      'Le nom de l\'ingrédient SANS la quantité ni l\'unité (ex: "courgettes", "feta", "huile d\'olive"). Lowercase sauf noms propres.',
                  },
                  quantity: {
                    type: ['number', 'null'],
                    description:
                      'Le nombre. null si pas de quantité ("Sel, poivre", "Persil ou basilic frais", "Farine"). Pour "1/2 chou rouge" utiliser 0.5.',
                  },
                  unit: {
                    type: ['string', 'null'],
                    description:
                      'L\'unité ("g", "kg", "ml", "cl", "l", "cs" pour cuillère à soupe, "cc" pour cuillère à café). null si pas d\'unité (compte en pièces, ex: "3 courgettes").',
                  },
                  note: {
                    type: ['string', 'null'],
                    description:
                      'Précision entre parenthèses ou facultatif (ex: "facultatif", "pour les tartinettes", "pour ajouter du croquant"). null si rien.',
                  },
                },
                required: ['category', 'label', 'quantity', 'unit', 'note'],
              },
            },
          },
          required: ['portions', 'items'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'save_shopping_list' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: `Tu es chargé d'extraire une liste de courses française depuis l'image.

Règles :
- Reste 100% fidèle au texte de l'image. N'invente JAMAIS un ingrédient ni une quantité.
- Si une quantité a une unité ("250 g"), sépare en quantity=250 + unit="g".
- Si pas d'unité ("3 courgettes"), quantity=3 + unit=null.
- Pour les fractions ("1/2 chou rouge"), quantity=0.5.
- Si l'item n'a pas de quantité ("Sel, poivre", "Farine", "Persil ou basilic frais"), mets quantity=null et unit=null.
- Si plusieurs ingrédients sont groupés ("Sel, poivre"), crée UNE entrée par groupement de l'image (n'éclate pas).
- Les "astuces" / "conseils" / "batch cooking" ne sont PAS des items à extraire. Ignore-les.
- Cherche aussi "pour X personnes" ou "X portions" dans l'image pour remplir portions.

Appelle l'outil save_shopping_list avec ta réponse structurée.`,
          },
        ],
      },
    ],
  });

  // Extraire la sortie de l'appel d'outil
  const toolUse = message.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(
      'Claude Vision n\'a pas appelé l\'outil save_shopping_list. Réessaie avec une image plus claire.',
    );
  }

  // tool_use.input est typé `unknown` par le SDK car le schéma est dynamique.
  // Le schéma forcé garantit la forme, mais on valide quand même par sécurité.
  const input = toolUse.input as ExtractedShoppingList;
  if (!Array.isArray(input.items)) {
    throw new Error('Sortie Vision invalide : items n\'est pas un tableau.');
  }

  return {
    portions: typeof input.portions === 'number' ? input.portions : null,
    items: input.items.map((it) => ({
      category: String(it.category ?? '').trim(),
      label: String(it.label ?? '').trim(),
      quantity: typeof it.quantity === 'number' ? it.quantity : null,
      unit: typeof it.unit === 'string' ? it.unit.trim() : null,
      note: typeof it.note === 'string' ? it.note.trim() : null,
    })),
  };
}
