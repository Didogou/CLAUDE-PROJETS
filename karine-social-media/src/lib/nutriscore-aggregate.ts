/**
 * Agrégation : recette (ingrédients + quantités + Ciqual) → valeurs
 * nutritionnelles par 100g du plat fini → input du Nutri-Score.
 *
 * Le matching ingrédient → Ciqual reste basique (par nom) au Palier 1.
 * Au Palier 3 on basculera sur du matching Mistral + persistence.
 */

import type { NutriscoreInput } from './nutriscore';

export type CiqualFoodLite = {
  id: number;
  name: string;
  kcal_per_100g: number | null;
  proteins_g: number | null;
  lipids_g: number | null;
  carbs_g: number | null;
  fibers_g: number | null;
  sugars_g: number | null;
  salt_g: number | null;
  sodium_mg: number | null;
  /** Poids moyen d'1 unité de cet aliment (1 tomate, 1 œuf…) en g.
   *  Alimenté par Mistral via le persist helper, ou override Karine.
   *  Null = pas encore connu OU 1 unité n'a pas de sens (huile, sel).
   *  Sentinel ~0.0001 = "non pertinent" : ignorer. */
  avg_unit_weight_g?: number | null;
};

export type RecipeIngredientLite = {
  category: string;
  label: string;
  quantity: number | null;
  unit: string | null;
  note?: string | null;
  /** Lien explicite vers Ciqual quand Karine l'a renseigné via la
   *  page admin Nutri-Score. Quand présent, on l'utilise directement
   *  sans passer par le quick-match. */
  ciqual_food_id?: number | null;
};

/** Conversion d'une unité texte vers des grammes (estimation usuelle).
 *  Pour les liquides, on prend une densité moyenne de 1 g/mL (eau).
 *  Pour les huiles spécifiquement, le caller peut ajuster avec un
 *  facteur 0.92 si besoin (négligeable pour la plupart des recettes). */
const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1,
  gr: 1,
  gramme: 1,
  grammes: 1,
  kg: 1000,
  ml: 1,
  cl: 10,
  l: 1000,
  cs: 15,           // cuillère à soupe ~ 15g/15ml
  'c. à soupe': 15,
  'cuillère à soupe': 15,
  cc: 5,            // cuillère à café ~ 5g/5ml
  'c. à café': 5,
  'cuillère à café': 5,
  pincée: 0.5,
  pincee: 0.5,
  tasse: 200,
  bol: 250,
  verre: 200,
};

/**
 * Convertit (qty, unit, ciqual_id) en grammes.
 *
 *  - Unité de masse/volume connue (g, ml, cs…) → conversion directe
 *  - Pas d'unité (« 8 tomates cerises ») → poids unitaire du Ciqual
 *    lié (`ciqualUnitWeights.get(ciqual_food_id)`)
 *  - Sinon → 0 (ingrédient compté comme orphelin dans la confiance)
 *
 * Plus de fallback heuristique (« 50g par défaut ») : si on ne sait
 * pas, on ne devine pas. Le poids unitaire vient de
 * `ciqual_foods.avg_unit_weight_g` alimenté par Mistral + Karine
 * (voir src/lib/ciqual-unit-weight.ts).
 */
function unitToGrams(
  qty: number,
  unit: string | null,
  ciqualFoodId: number | null | undefined,
  ciqualUnitWeights: Map<number, number>,
): number {
  if (typeof qty !== 'number' || qty <= 0) return 0;
  const u = (unit ?? '').trim().toLowerCase();
  if (u) {
    const factor = UNIT_TO_GRAMS[u];
    if (typeof factor === 'number') return qty * factor;
    // Unité inconnue (ex. "g/c" sans signification claire) → on bascule
    // sur le poids unitaire Ciqual si dispo. Sinon 0.
  }
  if (typeof ciqualFoodId === 'number') {
    const w = ciqualUnitWeights.get(ciqualFoodId);
    if (typeof w === 'number' && w > 0) return qty * w;
  }
  return 0;
}

/** Stemming léger pluriel français : "pommes" → "pomme", "oignons" → "oignon".
 *  N'enlève le s final que pour les mots de 5+ chars (évite "des" → "de"). */
function stem(t: string): string {
  return t.length >= 5 && t.endsWith('s') ? t.slice(0, -1) : t;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Ligatures FR : œ et æ ne sont PAS décomposés par NFD (pas des
    // caractères composés). On les transforme explicitement, ce qui
    // permet d'aligner "œuf" sur "oeuf" (+ le stemming peut alors
    // s'appliquer car "œufs" devient "oeufs" qui passe la barre des 5).
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

/** Matching ingrédient → Ciqual, placeholder côté client en attendant
 *  un vrai recours serveur (RPC + aliases) pour les cas qui restent
 *  orphelins. Améliorations 2026-06-08 par rapport à la V1 :
 *   - Stemming pluriel ("tomates" matche "tomate")
 *   - Apostrophes séparatrices (d'ail → "d" + "ail")
 *   - Bonus si nom Ciqual commence par un token (match exact préféré)
 *   - Malus longueur plus fort pour préférer les noms courts/génériques */
/**
 * Règle ANSES sel par défaut.
 *
 * Quand une recette mentionne "sel" sans quantité (« sel, poivre »,
 * « une pincée de sel », « sel à votre goût »…), Vision n'a aucun
 * nombre à mettre dans `quantity` → l'ingrédient était jusqu'ici
 * ignoré du calcul Nutri-Score, ce qui sous-estime l'apport sodium.
 *
 * Reco ANSES : objectif 5 g sel/jour adulte, ~1-1,5 g par repas.
 * On considère qu'une recette mentionnant le sel apporte au moins
 * **0,5 g** (≈ 1 pincée) — valeur prudente, validée Didier 2026-06-08.
 *
 * Karine peut toujours surcharger en saisissant une quantité précise
 * dans l'éditeur Nutri-Score (override total).
 */
export function applySaltDefault<T extends RecipeIngredientLite>(
  ingredients: T[],
): { resolved: T[]; mutated: boolean } {
  let mutated = false;
  const out = ingredients.map((ing) => {
    // Si Karine a déjà saisi une qty → on respecte son choix.
    if (typeof ing.quantity === 'number' && ing.quantity > 0) return ing;
    const lower = (ing.label ?? '').toLowerCase().trim();
    // Catche "sel", "sel marin", "sel et poivre", "sel, poivre, herbes",
    // "une pincée de sel", "fleur de sel"… Le \b évite "selle", "selvage"…
    if (!/\bsel\b/.test(lower)) return ing;
    mutated = true;
    return { ...ing, quantity: 0.5, unit: 'g' } as T;
  });
  return { resolved: out, mutated };
}

export function quickMatchCiqual(
  label: string,
  ciqualFoods: CiqualFoodLite[],
): CiqualFoodLite | null {
  const rawTokens = normalize(label)
    .split(/[\s,()/'’]+/)
    .filter((t) => t.length >= 3)
    .map(stem);
  if (rawTokens.length === 0) return null;

  let bestScore = 0;
  let best: CiqualFoodLite | null = null;
  for (const f of ciqualFoods) {
    const fname = normalize(f.name);
    let matched = 0;
    let score = 0;
    for (const t of rawTokens) {
      if (fname.includes(t)) {
        score += t.length;
        matched++;
      }
    }
    if (matched === 0) continue;

    // Bonus si TOUS les tokens recherchés sont présents
    if (matched === rawTokens.length) score += 20;

    // Bonus si le nom Ciqual COMMENCE par un des tokens (match exact)
    if (rawTokens.some((t) => fname.startsWith(t))) score += 5;

    // Malus longueur : on préfère "Oignon, cru" (11) à "Tarte à l'oignon,
    // préemballée" (32). Pénalité linéaire à partir de 15 chars.
    score -= Math.max(0, f.name.length - 15) * 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return bestScore >= 6 ? best : null;
}

export type AggregateResult = {
  /** Valeurs nutritionnelles par 100g du plat fini. */
  per100g: NutriscoreInput;
  /** Pourcentage de confiance dans le calcul (0 à 1). Plus c'est haut,
   *  plus on est confiant. Si <0.6, à afficher avec un disclaimer. */
  confidence: number;
  /** Poids total du plat agrégé (g). */
  totalGrams: number;
  /** Diagnostic pour la page admin : ingrédients ignorés / non matchés. */
  problems: Array<{
    label: string;
    reason: 'no-quantity' | 'no-ciqual-match' | 'estimated-weight' | 'unit-unknown';
    estimatedGrams?: number;
  }>;
};

/**
 * Agrège une liste d'ingrédients (avec quantités) en valeurs
 * nutritionnelles par 100g du plat fini.
 *
 * Pour chaque ingrédient :
 *   1. Convertir la quantité en grammes (unit + label-based estimation)
 *   2. Trouver le match Ciqual (par nom pour le POC)
 *   3. Calculer l'apport : (grammes × kcal_per_100g_ciqual) / 100
 *
 * Puis on rapporte aux 100g du total.
 *
 * Estimation FVL (fruits/légumes/légumineuses) : on regarde si le nom
 * Ciqual appartient au groupe "fruits", "légumes" ou "légumineuses".
 */
export function aggregateIngredients(
  ingredients: RecipeIngredientLite[],
  ciqualFoods: CiqualFoodLite[],
  ciqualGroups: Map<number, string>, // id → group_name
  ciqualUnitWeights: Map<number, number> = new Map(), // id → avg_unit_weight_g
): AggregateResult {
  let totalGrams = 0;          // poids tenté (qty renseignée)
  let totalGramsMatched = 0;   // poids effectivement matché Ciqual
  let totalKcal = 0;
  let totalProteins = 0;
  let totalCarbs = 0;
  let totalSugars = 0;
  let totalFibers = 0;
  let totalLipids = 0;
  let totalSodium = 0;
  let fvlGrams = 0;

  const problems: AggregateResult['problems'] = [];

  for (const ing of ingredients) {
    if (typeof ing.quantity !== 'number' || ing.quantity <= 0) {
      // Ingrédient SANS quantité (typiquement "sel, poivre", "herbes")
      // → on n'a aucune base pour calculer ni pour pondérer. On NE
      // pénalise PAS la confiance : ces ingrédients d'assaisonnement
      // ont un impact nutritionnel négligeable.
      problems.push({ label: ing.label, reason: 'no-quantity' });
      continue;
    }
    const grams = unitToGrams(ing.quantity, ing.unit, ing.ciqual_food_id ?? null, ciqualUnitWeights);
    if (grams <= 0) {
      // Pas de g convertible ET pas de poids unitaire connu sur le
      // Ciqual lié → ingrédient non quantifiable. On le trace pour
      // que l'admin sache qu'il faut compléter (saisir unité OU
      // que Mistral résolve le poids).
      problems.push({ label: ing.label, reason: 'unit-unknown' });
      continue;
    }

    const wasEstimated = !ing.unit || !UNIT_TO_GRAMS[ing.unit.toLowerCase()];
    if (wasEstimated) {
      // Trace informative (utile en page admin pour transparence),
      // mais on ne pénalise plus la confiance là-dessus — la formule
      // pondérée par le poids capture déjà l'incertitude.
      problems.push({
        label: ing.label,
        reason: 'estimated-weight',
        estimatedGrams: grams,
      });
    }

    totalGrams += grams;

    // Si Karine a explicitement renseigné le ciqual_food_id (via la
    // page admin), on l'utilise tel quel. Sinon, quick-match par nom.
    let match: CiqualFoodLite | null = null;
    if (typeof ing.ciqual_food_id === 'number') {
      match = ciqualFoods.find((f) => f.id === ing.ciqual_food_id) ?? null;
    }
    if (!match) {
      match = quickMatchCiqual(ing.label, ciqualFoods);
    }
    if (!match) {
      problems.push({ label: ing.label, reason: 'no-ciqual-match' });
      continue;
    }
    totalGramsMatched += grams;

    const kcal = match.kcal_per_100g ?? 0;
    const proteins = match.proteins_g ?? 0;
    const carbs = match.carbs_g ?? 0;
    const sugars = match.sugars_g ?? 0;
    const fibers = match.fibers_g ?? 0;
    const lipids = match.lipids_g ?? 0;
    const sodiumPer100 = match.sodium_mg ?? (match.salt_g ?? 0) * 400; // 1g sel ≈ 400mg Na

    totalKcal += (grams * kcal) / 100;
    totalProteins += (grams * proteins) / 100;
    totalCarbs += (grams * carbs) / 100;
    totalSugars += (grams * sugars) / 100;
    totalFibers += (grams * fibers) / 100;
    totalLipids += (grams * lipids) / 100;
    totalSodium += (grams * sodiumPer100) / 100;

    // FVL : si le groupe Ciqual contient "fruit", "légume" ou "légumineuse"
    const group = (ciqualGroups.get(match.id) ?? '').toLowerCase();
    if (/fruit|legume|légume|legumineuse|légumineuse/.test(group)) {
      fvlGrams += grams;
    }
  }

  if (totalGramsMatched === 0) {
    return {
      per100g: {
        kcal: 0, sugars: 0, saturatedFat: 0, sodiumMg: 0,
        fibers: 0, proteins: 0, fruitsVegLegumesPct: 0,
      },
      confidence: 0,
      totalGrams,
      problems,
    };
  }

  // Rapporter aux 100g sur le POIDS MATCHÉ (pas le poids total) :
  // les ingrédients non matchés tireraient les kcal vers le bas. Ici
  // on extrapole : "à composition similaire, voilà ce que ferait 100g
  // de plat". La confiance < 100 % dit que c'est une estimation.
  const factor = 100 / totalGramsMatched;
  // AGS estimés à 30% des lipides (approximation usuelle, plus précis si
  // Ciqual le fournissait nativement — colonne à ajouter au Palier 3)
  const saturatedFat = (totalLipids * factor) * 0.3;

  const per100g: NutriscoreInput = {
    kcal: totalKcal * factor,
    sugars: totalSugars * factor,
    saturatedFat,
    sodiumMg: totalSodium * factor,
    fibers: totalFibers * factor,
    proteins: totalProteins * factor,
    // FVL sur le poids matché aussi : si Ciqual a identifié 200g de
    // légumes sur 400g de poids matché, c'est 50 % de FVL.
    fruitsVegLegumesPct: (fvlGrams / totalGramsMatched) * 100,
  };

  // Confiance pondérée par le POIDS (décision 2026-06-08) :
  //   ratio du poids effectivement matché Ciqual sur le poids total
  //   des ingrédients avec quantité renseignée.
  //
  // Avantages vs le comptage d'ingrédients :
  //  - Le sel/poivre sans qty ne pénalise PAS la confiance.
  //  - Sel avec qty 2g sur 500g de plat = impact négligeable (0.4%).
  //  - Tahini 50g non matché sur 500g = impact réaliste (10%).
  //
  // Représente l'incertitude réelle du calcul Nutri-Score, pas un
  // décompte arbitraire d'ingrédients.
  const confidence =
    totalGrams === 0 ? 0 : totalGramsMatched / totalGrams;

  return {
    per100g,
    confidence: Math.max(0, Math.min(1, confidence)),
    totalGrams,
    problems,
  };
}
