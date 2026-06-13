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

/** Une étape de préparation structurée (option A). */
export type ExtractedStep = {
  /** Le texte de l'étape (fidèle à la fiche). */
  text: string;
  /** Labels d'ingrédients utilisés à cette étape (sous-ensemble de la liste). */
  ingredients: string[];
  /** Ustensiles de cette étape (labels canoniques singuliers ; inférence ok). */
  utensils: string[];
};

export type ExtractedRecipeSheet = {
  /** Numéro de fiche imprimé sur l'image (« Recette 1 », « Fiche 2 »,
   *  etc.). null si absent / illisible. Utilisé pour calculer le
   *  sheet_index à l'enregistrement. */
  sheetNumber: number | null;
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
  /** Étapes de préparation structurées, ordonnées (haut → bas de la fiche). */
  preparationSteps: ExtractedStep[];
  /** Union de tous les ustensiles de la recette (labels singuliers). */
  utensils: string[];
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
    // Étapes STRUCTURÉES (texte + ingrédients + ustensiles par étape) =
    // sortie plus volumineuse → 6000 pour éviter toute troncature.
    max_tokens: 6000,
    tools: [
      {
        name: 'save_recipe_sheet',
        description: 'Enregistre les infos extraites de la fiche recette.',
        input_schema: {
          type: 'object',
          properties: {
            sheetNumber: {
              type: ['integer', 'null'],
              description:
                'Numéro de la fiche/recette si imprimé sur l\'image. Cherche "Recette 1", "Fiche 2", "N°3", "Recette n°4", chiffre en haut de la fiche, etc. C\'est l\'ordre dans lequel Karine veut classer ses fiches. null si absent ou illisible.',
            },
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
            preparationSteps: {
              type: 'array',
              description:
                'Étapes de préparation DANS L\'ORDRE de la fiche (haut → bas). 1 entrée = 1 étape. Reste fidèle au texte, n\'invente jamais d\'étape.',
              items: {
                type: 'object',
                properties: {
                  text: {
                    type: 'string',
                    description:
                      'Texte de l\'étape, fidèle à la fiche. Retire la numérotation de tête ("1.", "Étape 2 :").',
                  },
                  ingredients: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      'Labels des ingrédients utilisés À CETTE ÉTAPE — UNIQUEMENT des labels présents dans le tableau "ingredients" ci-dessus (mêmes mots exacts). Ex: l\'étape "mélanger thon et feta" → ["thon", "feta"]. Tableau vide si l\'étape ne manipule aucun ingrédient (ex: "préchauffer le four").',
                  },
                  utensils: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      'Ustensiles de CETTE étape, nom canonique SINGULIER minuscule. INFÉRENCE autorisée depuis le verbe ("enfourner"→"four", "poêler"→"poêle", "mixer"→"mixeur", "fouetter"→"fouet"). Déduplique. Tableau vide si rien.',
                  },
                },
                required: ['text', 'ingredients', 'utensils'],
              },
            },
            utensils: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Ustensiles de cuisine nécessaires, en nom canonique SINGULIER et minuscule ("four", "poêle", "casserole", "saladier", "fouet", "couteau", "plaque de cuisson", "mixeur"). ⚠️ Contrairement aux ingrédients, l\'INFÉRENCE est autorisée ICI : déduis l\'ustensile du verbe de cuisson même s\'il n\'est pas écrit ("enfourner"/"au four" → "four" ; "poêler"/"faire revenir" → "poêle" ; "mixer" → "mixeur" ; "fouetter" → "fouet"). Déduplique. Maximum ~8. Tableau vide si rien d\'exploitable.',
            },
          },
          required: [
            'sheetNumber',
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
            'preparationSteps',
            'utensils',
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

🔢 NUMÉRO DE FICHE (sheetNumber) :
- Cherche un numéro imprimé sur l'image : "Recette 1", "Fiche 2", "N°3", "Recette n°4", "1/12" (= fiche 1 sur 12), gros chiffre en coin de fiche, etc.
- Renvoie UNIQUEMENT le numéro de la fiche courante (pas le "12" de "1/12").
- Si tu vois "Recette 1", sheetNumber=1. Si "Fiche 7", sheetNumber=7.
- null si absent ou illisible.

Règles :
- Reste 100% fidèle au texte de l'image. N'invente jamais une quantité ou un ingrédient.
- Sépare quantité / unité / label proprement. ⚠️ L'unité ("g", "ml", "cl", "cs", "cc"…) NE DOIT JAMAIS apparaître dans le label.
- Pour "1/2 oignon" : quantity=0.5, unit=null, label="oignon".
- Pour "1 c. à soupe d'huile d'olive" : quantity=1, unit="cs", label="huile d'olive".
- Pour "250 g de tomates cerises" : quantity=250, unit="g", label="tomates cerises". (PAS label="g tomates cerises".)
- Pour "120 g de poulet haché" : quantity=120, unit="g", label="poulet haché".
- Si un ingrédient n'a pas de quantité ("sel, poivre", "persil frais"), quantity=null, unit=null.

⚠️ FRACTIONS EN TOUTES LETTRES : tu DOIS aussi reconnaître les
écritures littérales et les convertir en décimal dans quantity, JAMAIS
les recopier dans le label :
- "un demi chou-fleur" / "demi chou-fleur" / "la moitié d'un chou-fleur" / "½ chou-fleur"
   → quantity=0.5, unit=null, label="chou-fleur".
- "un quart de citron" / "1/4 de citron" / "¼ de citron"
   → quantity=0.25, unit=null, label="citron".
- "un tiers de concombre" / "1/3 de concombre"
   → quantity=0.33, unit=null, label="concombre".
- "trois quarts d'avocat" / "3/4 d'avocat" / "¾ d'avocat"
   → quantity=0.75, unit=null, label="avocat".
- "une pincée de sel" → quantity=1, unit="pincée", label="sel".
- "deux gousses d'ail" → quantity=2, unit=null, label="gousses d'ail".
INTERDIT : label="demi chou-fleur", label="moitié de chou-fleur",
label="1/2 chou-fleur". La fraction va TOUJOURS dans quantity (en
décimal), jamais dans le label.
- Cherche temps prep + cuisson dans les pictos ⏱️ / ⏲️ ou texte "préparation : X min".
- Calories : "kcal par portion" est le format standard ; renvoie le nombre.
- Macros : si tu vois "Protéines : 25 g", "Lipides : 12 g", "Glucides : 40 g" (par portion), renseigne proteinsG/lipidsG/carbsG. Cherche aussi des icônes nutritionnelles (camembert macros) ou pavé "Pour 1 portion : 25g P / 12g L / 40g G". null si non visible.
- Tags : "riche en protéines", "saine", "équilibrée", "gourmande", etc.

📝 PRÉPARATION (preparationSteps) — étapes STRUCTURÉES, dans l'ordre (haut → bas), 1 entrée par étape :
- text : le texte de l'étape, fidèle à la fiche (n'invente jamais une étape, retire la numérotation de tête).
- ingredients : les labels d'ingrédients utilisés À CETTE étape, UNIQUEMENT pris dans le tableau "ingredients" ci-dessus (mêmes mots). Ex : "Mélangez le thon et la feta" → ["thon", "feta"]. Vide si l'étape ne manipule pas d'ingrédient ("préchauffer le four").
- utensils : les ustensiles de CETTE étape (nom canonique SINGULIER minuscule). INFÉRENCE autorisée depuis le verbe : "enfourner"/"180°C" → "four" ; "poêler"/"faire revenir" → "poêle" ; "porter à ébullition" → "casserole" ; "mixer" → "mixeur" ; "fouetter" → "fouet" ; "mélanger dans un saladier" → "saladier". Vide si rien.
- Si aucune préparation lisible : tableau vide.

🍳 USTENSILES (utensils, niveau recette) :
- L'UNION de tous les ustensiles utilisés dans la recette (mêmes noms canoniques que dans les étapes), dédupliquée. Maximum ~8.

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

  // Garde uniquement un log warn discret quand des ingrédients sont
  // filtrés (placeholder Haiku type "—", "?"). Utile pour détecter
  // des dérives futures du modèle sans polluer les logs en cas
  // normal.
  if (Array.isArray(input.ingredients)) {
    const rawCount = (input.ingredients as unknown[]).length;
    if (rawCount !== ingredients.length) {
      console.warn(
        `[recipe-vision] ${rawCount - ingredients.length} ingrédient(s) filtré(s) (placeholder/vide).`,
      );
    }
  }

  // --- Étapes structurées (option A) ---------------------------------------
  const STRIP_NUM = /^\s*(?:\d+\s*[.)°:-]\s*|étape\s*\d+\s*[:.)-]?\s*|[-–•*]\s*)/i;
  const strList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
  const lowerDedup = (arr: string[]): string[] =>
    Array.from(new Set(arr.map((x) => x.toLowerCase()).filter(Boolean)));

  const preparationSteps: ExtractedStep[] = Array.isArray(input.preparationSteps)
    ? (input.preparationSteps as unknown[])
        .map((raw) => {
          const s = (raw ?? {}) as Record<string, unknown>;
          return {
            text:
              typeof s.text === 'string'
                ? s.text.trim().replace(STRIP_NUM, '').trim()
                : '',
            ingredients: strList(s.ingredients),
            utensils: lowerDedup(strList(s.utensils)),
          };
        })
        .filter((s) => s.text.length > 0)
    : [];

  // Ustensiles niveau recette = union (top-level + tous ceux des étapes).
  const utensils: string[] = lowerDedup([
    ...strList(input.utensils),
    ...preparationSteps.flatMap((s) => s.utensils),
  ]);

  return {
    // sheetNumber : entier positif uniquement (Vision peut renvoyer 0
    // ou négatif si confusion). Filtre à `null` dans ces cas.
    sheetNumber:
      typeof input.sheetNumber === 'number' &&
      Number.isFinite(input.sheetNumber) &&
      input.sheetNumber >= 1
        ? Math.round(input.sheetNumber)
        : null,
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
    preparationSteps,
    utensils,
  };
}
