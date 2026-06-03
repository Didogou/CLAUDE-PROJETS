import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { RecipeIngredient } from '@/data/recipes';

/**
 * Lecture Vision des fiches recettes par Claude Haiku 4.5.
 *
 * Pourquoi Haiku 4.5 et pas Sonnet :
 *   - 3× moins cher (~$0.003 vs ~$0.01 par recette)
 *   - Qualité suffisante pour cette tâche structurée (lire une fiche
 *     recette claire avec ingrédients + temps + calories visibles)
 *   - Même SDK Anthropic, juste model ID différent
 *
 * 2 fonctions exposées :
 *   - extractRecipeTitleFromCover : lit juste le titre depuis la cover
 *     principale (ex: "6 Recettes de Poivrons Farcis")
 *   - extractRecipeSheetFromImage : lit TOUT depuis une fiche détaillée
 *     (titre variante, calories, temps, servings, tags, aliments,
 *      ingrédients structurés)
 */

const MODEL = 'claude-haiku-4-5-20251001';

export type ExtractedRecipeSheet = {
  title: string | null;
  servings: number | null;
  calories: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  aliments: string[];
  ingredients: RecipeIngredient[];
};

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/** Extrait juste le titre de la recette depuis l'image principale. */
export async function extractRecipeTitleFromCover(
  imageBuffer: Buffer,
  mediaType: MediaType,
): Promise<string | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [
      {
        name: 'save_title',
        description: 'Enregistre le titre de la recette extrait de l\'image.',
        input_schema: {
          type: 'object',
          properties: {
            title: {
              type: ['string', 'null'],
              description:
                'Titre principal lisible sur l\'image (ex: "Poivrons farcis", "6 Recettes de Poivrons Farcis"). Garder la formulation originale, sans les ornements ("Recette n°2 :", "✨"). null si rien de lisible.',
            },
          },
          required: ['title'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'save_title' },
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
            text: `Tu lis une image de couverture de recette française. Extrait UNIQUEMENT le titre principal de la recette (le gros titre visible). Pas de description, pas de sous-titre. Appelle save_title.`,
          },
        ],
      },
    ],
  });
  const toolUse = message.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') return null;
  const input = toolUse.input as { title?: unknown };
  return typeof input.title === 'string' ? input.title.trim() : null;
}

/**
 * Extrait toutes les infos d'une fiche détaillée (= recette complète
 * lisible sur une seule image : ingrédients + temps + calories).
 */
export async function extractRecipeSheetFromImage(
  imageBuffer: Buffer,
  mediaType: MediaType,
): Promise<ExtractedRecipeSheet> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [
      {
        name: 'save_recipe_sheet',
        description: 'Enregistre les infos extraites de la fiche recette.',
        input_schema: {
          type: 'object',
          properties: {
            title: {
              type: ['string', 'null'],
              description:
                'Titre de cette variante de la recette (ex: "Poivrons farcis thon, tomates & feta"). null si absent.',
            },
            servings: {
              type: ['integer', 'null'],
              description:
                'Nombre de personnes ("pour 2 portions" = 2, "pour 4 personnes" = 4). null si non mentionné.',
            },
            calories: {
              type: ['integer', 'null'],
              description:
                'Calories par portion (kcal). Cherche "370 kcal par portion", "calories : 250", etc. null si non mentionné.',
            },
            prepTimeMin: {
              type: ['integer', 'null'],
              description:
                'Temps de préparation en minutes. null si non mentionné.',
            },
            cookTimeMin: {
              type: ['integer', 'null'],
              description:
                'Temps de cuisson en minutes. null si non mentionné.',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Tags / qualificatifs courts visibles ("riche en protéines", "équilibrée", "faible en calories", "végétarien"). Garder l\'expression originale.',
            },
            aliments: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Aliments principaux de la recette (ingrédients vedettes, ex: "thon", "poivron", "feta"). Maximum 5.',
            },
            ingredients: {
              type: 'array',
              description:
                'Liste structurée des ingrédients. Reste fidèle au texte de la fiche.',
              items: {
                type: 'object',
                properties: {
                  category: {
                    type: 'string',
                    description:
                      'Catégorie de courses : "Fruits & Légumes", "Produits frais & Laitiers", "Viandes & Charcuterie", "Épicerie", "Pain & Autres", "Surgelés", "Boissons", "Conserves".',
                  },
                  label: {
                    type: 'string',
                    description:
                      'Nom de l\'ingrédient en minuscules sans la quantité ("poivrons jaunes", "thon au naturel", "boulgour cuit", "huile d\'olive").',
                  },
                  quantity: {
                    type: ['number', 'null'],
                    description:
                      'Quantité numérique ("2 gros poivrons" = 2, "120 g égoutté" = 120). null si "huile d\'olive", "sel, poivre".',
                  },
                  unit: {
                    type: ['string', 'null'],
                    description:
                      'Unité ("g", "ml", "cl", "boite", "c. à soupe" ou "cs", "c. à café" ou "cc"). null si compte en pièces.',
                  },
                  note: {
                    type: ['string', 'null'],
                    description:
                      'Précision entre parenthèses ("égoutté", "frais", "émincé"). null si rien.',
                  },
                },
                required: ['category', 'label', 'quantity', 'unit', 'note'],
              },
            },
          },
          required: [
            'title',
            'servings',
            'calories',
            'prepTimeMin',
            'cookTimeMin',
            'tags',
            'aliments',
            'ingredients',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'save_recipe_sheet' },
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
            text: `Tu lis une fiche recette française complète (titre + ingrédients listés + temps + calories + tags).

Règles :
- Reste 100% fidèle au texte de l'image. N'invente jamais une quantité ou un ingrédient.
- Sépare quantité / unité / label proprement.
- Pour "1/2 oignon" : quantity=0.5, unit=null, label="oignon".
- Pour "1 c. à soupe d'huile d'olive" : quantity=1, unit="cs", label="huile d'olive".
- Si un ingrédient n'a pas de quantité ("sel, poivre", "persil frais"), quantity=null, unit=null.
- Cherche temps prep + cuisson dans les pictos ⏱️ / ⏲️ ou texte "préparation : X min".
- Calories : "kcal par portion" est le format standard ; renvoie le nombre.
- Tags : "riche en protéines", "saine", "équilibrée", "gourmande", etc.

Appelle save_recipe_sheet.`,
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Haiku n\'a pas appelé save_recipe_sheet.');
  }
  const input = toolUse.input as Record<string, unknown>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ingredients: RecipeIngredient[] = Array.isArray(input.ingredients)
    ? (input.ingredients as any[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((it: any) => it && typeof it.label === 'string' && typeof it.category === 'string')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((it: any) => ({
          category: String(it.category).trim(),
          label: String(it.label).trim(),
          quantity: typeof it.quantity === 'number' ? it.quantity : null,
          unit: typeof it.unit === 'string' ? it.unit.trim() || null : null,
          note: typeof it.note === 'string' ? it.note.trim() || null : null,
        }))
    : [];

  return {
    title: typeof input.title === 'string' ? input.title.trim() : null,
    servings:
      typeof input.servings === 'number' && Number.isFinite(input.servings)
        ? Math.round(input.servings)
        : null,
    calories:
      typeof input.calories === 'number' && Number.isFinite(input.calories)
        ? Math.round(input.calories)
        : null,
    prepTimeMin:
      typeof input.prepTimeMin === 'number' && Number.isFinite(input.prepTimeMin)
        ? Math.round(input.prepTimeMin)
        : null,
    cookTimeMin:
      typeof input.cookTimeMin === 'number' && Number.isFinite(input.cookTimeMin)
        ? Math.round(input.cookTimeMin)
        : null,
    tags: Array.isArray(input.tags)
      ? (input.tags as unknown[])
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    aliments: Array.isArray(input.aliments)
      ? (input.aliments as unknown[])
          .filter((a): a is string => typeof a === 'string')
          .map((a) => a.trim())
          .filter(Boolean)
      : [],
    ingredients,
  };
}
