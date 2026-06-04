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
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
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
            proteinsG: {
              type: ['number', 'null'],
              description:
                'Protéines par portion en grammes. Cherche "Protéines : 25 g", "P : 30g", icônes nutritionnelles. null si non mentionné.',
            },
            lipidsG: {
              type: ['number', 'null'],
              description:
                'Lipides par portion en grammes. Cherche "Lipides : 12 g", "L : 12g", "matières grasses". null si non mentionné.',
            },
            carbsG: {
              type: ['number', 'null'],
              description:
                'Glucides par portion en grammes. Cherche "Glucides : 40 g", "G : 40g". null si non mentionné.',
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
                'Liste structurée des ingrédients. Reste fidèle au texte de la fiche. ⚠️ N\'AJOUTE JAMAIS une ligne d\'ingrédient si tu n\'arrives pas à lire son nom (label). Une ligne avec quantité mais sans label est INTERDITE — préfère omettre cette ligne plutôt que de la retourner avec un label vide.',
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
                      'Nom de l\'ingrédient SEUL, en minuscules, SANS la quantité NI l\'unité, JAMAIS VIDE. Exemples : "poivrons jaunes", "thon au naturel", "boulgour cuit", "huile d\'olive", "tomates cerises". ⚠️ NE JAMAIS commencer le label par une unité ("g", "ml", "cl", "cs", "cc") — l\'unité a sa propre colonne. ⚠️ Si tu ne peux pas déterminer le label d\'une ligne, OMETS COMPLÈTEMENT cette ligne du tableau — ne retourne jamais "" ou "?" comme label.',
                  },
                  quantity: {
                    type: ['number', 'null'],
                    description:
                      'Quantité numérique. "2 gros poivrons" = 2. "120 g égoutté" = 120. "250 g de tomates cerises" = 250. null si "huile d\'olive", "sel, poivre".',
                  },
                  unit: {
                    type: ['string', 'null'],
                    description:
                      'Unité OBLIGATOIREMENT ici si présente : "g", "kg", "ml", "cl", "l", "boite", "c. à soupe" ou "cs", "c. à café" ou "cc". ⚠️ Si tu vois "250 g de tomates cerises", tu DOIS mettre quantity=250, unit="g", label="tomates cerises". NE PAS faire label="g tomates cerises". null si compte en pièces.',
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
            'proteinsG',
            'lipidsG',
            'carbsG',
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
- Sépare quantité / unité / label proprement. ⚠️ L'unité ("g", "ml", "cl", "cs", "cc"…) NE DOIT JAMAIS apparaître dans le label.
- Pour "1/2 oignon" : quantity=0.5, unit=null, label="oignon".
- Pour "1 c. à soupe d'huile d'olive" : quantity=1, unit="cs", label="huile d'olive".
- Pour "250 g de tomates cerises" : quantity=250, unit="g", label="tomates cerises". (PAS label="g tomates cerises".)
- Pour "120 g de poulet haché" : quantity=120, unit="g", label="poulet haché".
- Si un ingrédient n'a pas de quantité ("sel, poivre", "persil frais"), quantity=null, unit=null.
- Cherche temps prep + cuisson dans les pictos ⏱️ / ⏲️ ou texte "préparation : X min".
- Calories : "kcal par portion" est le format standard ; renvoie le nombre.
- Macros : si tu vois "Protéines : 25 g", "Lipides : 12 g", "Glucides : 40 g" (par portion), renseigne proteinsG/lipidsG/carbsG. Cherche aussi des icônes nutritionnelles (camembert macros) ou pavé "Pour 1 portion : 25g P / 12g L / 40g G". null si non visible.
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

  // Filtre les placeholders ("—", "?", "...", "n/a", "illisible"…)
  // que Haiku peut retourner quand il n'arrive pas à lire un label
  // au lieu d'omettre la ligne. Empêche ces ingrédients fantômes
  // d'arriver dans menu_meal_sheets.ingredients.
  const PLACEHOLDER_LABEL =
    /^(?:[?\-—.…\s]+|n\/?a|illisible|ingr[ée]dient(?:\s+illisible)?|inconnu)$/i;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const ingredients: RecipeIngredient[] = Array.isArray(input.ingredients)
    ? (input.ingredients as any[])
        .filter(
          (it: any) =>
            it && typeof it.label === 'string' && typeof it.category === 'string',
        )
        .map((it: any) => ({
          category: String(it.category).trim(),
          label: String(it.label).trim(),
          quantity: typeof it.quantity === 'number' ? it.quantity : null,
          unit: typeof it.unit === 'string' ? it.unit.trim() || null : null,
          note: typeof it.note === 'string' ? it.note.trim() || null : null,
        }))
        .filter(
          (it: RecipeIngredient) =>
            it.label.length > 0 &&
            !PLACEHOLDER_LABEL.test(it.label) &&
            it.category.length > 0,
        )
    : [];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Log debug verbeux temporaire — Karine peut consulter les logs
  // Vercel pour voir EXACTEMENT ce que Haiku retourne pour chaque
  // fiche. À retirer après stabilisation des labels.
  console.log(
    '[recipe-vision] RAW Haiku ingredients (avant filtre) :',
    JSON.stringify(input.ingredients, null, 2),
  );
  console.log(
    '[recipe-vision] FILTERED ingredients (après filtre) :',
    JSON.stringify(ingredients, null, 2),
  );
  if (Array.isArray(input.ingredients)) {
    const rawCount = (input.ingredients as unknown[]).length;
    if (rawCount !== ingredients.length) {
      console.warn(
        `[recipe-vision] ${rawCount - ingredients.length} ingrédient(s) filtré(s) (placeholder/vide).`,
      );
    }
  }

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
    proteinsG:
      typeof input.proteinsG === 'number' && Number.isFinite(input.proteinsG)
        ? Math.round(input.proteinsG * 10) / 10
        : null,
    lipidsG:
      typeof input.lipidsG === 'number' && Number.isFinite(input.lipidsG)
        ? Math.round(input.lipidsG * 10) / 10
        : null,
    carbsG:
      typeof input.carbsG === 'number' && Number.isFinite(input.carbsG)
        ? Math.round(input.carbsG * 10) / 10
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
