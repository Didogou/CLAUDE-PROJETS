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
  /** AG saturés (g/100g) — source Ciqual ANSES.
   *  Si null, on retombe sur lipids_g × 0.3 (approximation moyenne).
   *  Utilisé pour calculer le point AGS du Nutri-Score. */
  saturated_fat_g: number | null;
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

// Mots vides FR + qualificatifs courants qui faussent le matching
// ("pépites DE chocolat noir", "banane BIEN mûre", "fruits OU légumes").
// On les filtre AVANT tokenisation pour que le premier token soit
// le NOM REEL de l'aliment, pas un connecteur ou un adjectif.
const STOP_WORDS = new Set([
  'de', 'du', 'des', 'et', 'ou', 'au', 'aux', 'avec', 'sans', 'en',
  'le', 'la', 'les', 'un', 'une', 'plus', 'bien', 'tres',
  // Qualificatifs de maturite / etat qui ne sont pas dans Ciqual
  // (Ciqual decrit le mode de prep : "cru", "cuit", "seche")
  'mure', 'mur', 'mature', 'frai', 'frais', 'fraiche', 'fraich',
  // Formes / decoupes : "pepites de", "morceaux de", "tranches de",
  // "gousse de", "rondelle de", etc. Le nom apres "de" est le vrai.
  'pepite', 'morceau', 'tranche', 'rondelle', 'gousse', 'feuille',
  'feuilles', 'cube', 'cubes', 'dose', 'doses', 'pincee', 'pincees',
]);

// Indices "viande" : si un de ces tokens apparait dans le label, on
// applique la REGLE METIER "viande = cuit par defaut". Privilegie les
// candidats Ciqual avec marqueur de cuisson, penalise les "cru".
// Cf. ciqual-aliases/auto-resolve qui applique la meme regle aux
// aliases ambigus. Liste restreinte aux mots NON-AMBIGUS (pas "blanc"
// qui peut etre blanc d'oeuf, pas "filet" qui peut etre filet de
// poisson, etc.).
const MEAT_KEYWORDS = new Set([
  'poulet', 'dinde', 'boeuf', 'porc', 'agneau', 'veau', 'canard',
  'lapin', 'jambon', 'saucisse', 'magret', 'bavette', 'entrecote',
  'rumsteck', 'gigot', 'cordon', 'nugget', 'viande',
  // Stems de ces mots (chaine ne se termine pas par 's' avec
  // length>=5, donc pas raccourcis par le stemmer — sauf pluriels)
  'poulets', 'dindes', 'jambons', 'saucisses', 'magrets',
]);
// Marqueurs explicites de cuisson dans le nom Ciqual
const RAW_RE = /\b(cru|crue|crus|crues)\b/;
const COOKED_RE =
  /\b(cuit|cuite|cuits|cuites|grill|r[ôo]ti|po[êe]l|brais|appert|vapeur|frit|frite|bouilli|blanchi|confit|mijot)/;
// Marqueurs explicites "cru" dans le LABEL utilisateur (tartare,
// carpaccio, sashimi = explicitement cru → on n'applique pas la
// regle "viande cuit par defaut").
const LABEL_EXPLICIT_RAW_RE = /\b(cru|crue|crus|crues|tartare|carpaccio|sashimi)\b/;

// REGLE TRANSFORMATION : on penalise les variantes transformees
// (poudre, sechee, en conserve, nectar, etc.) quand le label ne les
// demande pas. Sinon "gingembre frais" → "Gingembre, poudre" et
// "fruit de la passion" → "Nectar de fruit de la passion".
const TRANSFORMED_RE =
  /\b(poudre|moulu|moulue|s[ée]che|s[ée]chee|s[ée]chees|sec|d[ée]shydrat|lyophilis|nectar|jus de|au sirop|en sirop|appertis|conserve|en bo[iî]te|congel|surgel)\b/;
const LABEL_TRANSFORMATION_RE =
  /\b(poudre|moulu|moulue|s[ée]che|sec|d[ée]shydrat|lyophilis|nectar|jus|sirop|appertis|conserve|en bo[iî]te|congel|surgel|en bocal)\b/;

// Normalize qui CONSERVE les accents (juste lowercase) — utilisee pour
// le matching strict "pate" ≠ "pâté", "cote" ≠ "côté", etc. Sans cette
// distinction, normalize() rend "pâte" et "pâté" identiques (les deux
// deviennent "pate") → "pâtes (penne)" matche "Pâté au jambon".
const normalizeKeep = (s: string) => s.toLowerCase();

/**
 * Alias resolu (`status='resolved'`) qui forcera un match direct
 * vers un ciqual_id donne. Karine peut en creer manuellement depuis
 * /admin/recettes/ciqual-base (bouton "+ alias").
 *
 * Format : { ciqual_id, alias } ou alias est DEJA normalise (lowercase
 * sans accents). On normalise aussi le label utilisateur pour la
 * comparaison, donc la table peut stocker au choix la forme brute ou
 * normalisée — on re-normalise par securite.
 */
export type CiqualAlias = { ciqual_id: number; alias: string };

export function quickMatchCiqual(
  label: string,
  ciqualFoods: CiqualFoodLite[],
  aliases?: CiqualAlias[],
): CiqualFoodLite | null {
  // PRIORITE ABSOLUE aux aliases resolus : si le label normalise
  // matche EXACTEMENT un alias, on retourne le Ciqual associe sans
  // passer par le scoring naif. C'est ce qui permet a Karine de
  // forcer "pate de curry rouge" → Sauce au curry sans coder l'algo
  // pour ce cas precis.
  if (aliases && aliases.length > 0) {
    const labelNormFull = normalize(label).trim().replace(/\s+/g, ' ');
    for (const a of aliases) {
      const aliasNorm = normalize(a.alias).trim().replace(/\s+/g, ' ');
      if (aliasNorm === labelNormFull) {
        const f = ciqualFoods.find((c) => c.id === a.ciqual_id);
        if (f) return f;
      }
    }
  }

  // On tokenise EN PARALLELE en 3 versions :
  //  - keepRaw  : avec accents + sans stem (pour bonus "match exact")
  //  - keep     : avec accents + stem (matching strict)
  //  - strip    : sans accents + stem (matching tolerant)
  // Le triple sert au matching 2-tier ET au bonus exact pre-stem qui
  // distingue "pâtes" (Pâtes seches) de "pâte" (Pâte de fruits).
  const labelKeep = normalizeKeep(label);
  const labelStrip = normalize(label);
  const splitRe = /[\s,()/'’0-9%]+/;
  const tokensKeepRaw = labelKeep.split(splitRe).filter((t) => t.length >= 3);
  const tokensKeep = tokensKeepRaw.map(stem);
  const tokensStrip = labelStrip.split(splitRe).filter((t) => t.length >= 3).map(stem);

  // Filtre par STOP_WORDS (sur version strippee) + garde les triplets
  const rawTokens: Array<{ keepRaw: string; keep: string; strip: string }> = [];
  for (let i = 0; i < tokensStrip.length; i++) {
    if (!STOP_WORDS.has(tokensStrip[i])) {
      rawTokens.push({
        keepRaw: tokensKeepRaw[i],
        keep: tokensKeep[i],
        strip: tokensStrip[i],
      });
    }
  }
  if (rawTokens.length === 0) return null;

  // REGLE METIER VIANDES : si le label contient un mot-cle viande
  // ET ne dit pas explicitement "cru/tartare/carpaccio", on penalise
  // les Ciqual "cru" et on bonifie les "cuit".
  const isMeatLabel =
    rawTokens.some((t) => MEAT_KEYWORDS.has(t.strip)) &&
    !LABEL_EXPLICIT_RAW_RE.test(labelStrip);

  // REGLE TRANSFORMATION : on penalise les Ciqual transformes (poudre,
  // sechee, nectar, en conserve) si le label ne demande pas la
  // transformation. Sinon "gingembre frais" → "Gingembre, poudre".
  const labelHasTransform = LABEL_TRANSFORMATION_RE.test(labelStrip);

  let bestScore = 0;
  let best: CiqualFoodLite | null = null;
  for (const f of ciqualFoods) {
    const fnameKeep = normalizeKeep(f.name);
    const fnameStrip = normalize(f.name);
    // MATCHING MOT-ENTIER + 2-TIER : on tokenise le nom Ciqual en 2
    // versions et on cherche selon precision de l'user.
    const fnameWordsKeepRaw = new Set(
      fnameKeep.split(splitRe).filter((w) => w.length >= 3),
    );
    const fnameWordsKeep = new Set(
      [...fnameWordsKeepRaw].map(stem),
    );
    const fnameWordsStrip = new Set(
      fnameStrip.split(splitRe).filter((w) => w.length >= 3).map(stem),
    );
    let matched = 0;
    let score = 0;
    rawTokens.forEach((t, idx) => {
      let isMatch = false;
      if (fnameWordsKeep.has(t.keep)) {
        // Match STRICT (accents respectes) : "pâte" matche "pâte",
        // pas "pâté".
        isMatch = true;
      } else if (t.keep === t.strip && fnameWordsStrip.has(t.strip)) {
        // User n'a pas d'accent dans son token → on tolere une
        // version stripee dans Ciqual ("creme" matche "crème").
        isMatch = true;
      }
      // Sinon : user avait un accent ET Ciqual n'a pas le meme accent
      // → NO MATCH (intention precise non respectee).
      if (isMatch) {
        const weight = idx === 0 ? 2 : 1;
        score += t.strip.length * weight;
        matched++;
        // BONUS MATCH EXACT (pre-stem) : si la version BRUTE du token
        // (avec accents et 's' final) est presente telle quelle dans
        // le nom Ciqual, +5 pts. Distingue "pâtes" (Pâtes seches)
        // de "pâte" (Pâte de fruits), pousse "tomates" vers une
        // entree Ciqual au pluriel si elle existe.
        if (fnameWordsKeepRaw.has(t.keepRaw)) score += 5;
      }
    });
    if (matched === 0) continue;

    // Bonus PROPORTIONNEL au nombre de tokens matches : matcher 2/3
    // doit clairement battre matcher 1/3, meme si le 2eme token est
    // court. Sans ce bonus, "creme liquide legere" matche "Creme de
    // cassis" (1/3 → 15 pts) au lieu de "Creme 12% MG, legere, fluide"
    // (2/3 → 14 pts car penalisee par sa longueur).
    if (matched > 1) score += (matched - 1) * 10;

    // Bonus si TOUS les tokens recherchés sont présents
    if (matched === rawTokens.length) score += 20;

    // Bonus si le nom Ciqual COMMENCE par un des tokens (match exact)
    if (rawTokens.some((t) => fnameStrip.startsWith(t.strip))) score += 5;

    // GROS bonus si le nom Ciqual commence par "<premier_token>,"
    // → c'est la forme CANONIQUE Ciqual. Ex. "Banane, chair sans peau,
    // crue" est l'entree canonique de la banane ; "Banane plantain,
    // crue" est une variete distincte. Sans ce bonus, le malus longueur
    // favorise les noms courts ("plantain") sur les noms canoniques
    // qui contiennent des qualifiers descriptifs.
    if (rawTokens[0] && fnameStrip.startsWith(rawTokens[0].strip + ',')) {
      score += 10;
    }

    // Malus longueur reduit (0.25 au lieu de 0.5) : on prefere toujours
    // les noms courts, mais sans ecraser les noms canoniques Ciqual qui
    // ont des qualifiers descriptifs ("Chocolat noir 50 % de cacao
    // environ, tablette" - 50 chars - ne doit pas etre disqualifie).
    score -= Math.max(0, f.name.length - 15) * 0.25;

    // REGLE VIANDES (cuit par defaut)
    if (isMeatLabel) {
      if (RAW_RE.test(fnameStrip)) score -= 15;
      if (COOKED_RE.test(fnameStrip)) score += 10;
    }

    // REGLE TRANSFORMATION : si label ne demande pas la transformation
    // mais que Ciqual est transforme → malus 12 pts. Evite que
    // "gingembre frais" → "Gingembre, poudre", "fruit de la passion"
    // → "Nectar de fruit de la passion", "tomate" → "Sauce tomate".
    if (!labelHasTransform && TRANSFORMED_RE.test(fnameStrip)) {
      score -= 12;
    }

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
  let totalSaturatedFat = 0;
  // Suit séparément la couverture AGS : si certains ingrédients n'ont
  // pas de saturated_fat_g connu, on devra fallback sur 30% pour eux.
  let totalLipidsWithoutAgs = 0;
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

    // AGS : on préfère la valeur Ciqual exacte. Si null (ancien import,
    // aliment custom), on accumule les lipides dans un seau séparé pour
    // appliquer le fallback 30% à la fin uniquement sur cette partie.
    if (match.saturated_fat_g !== null && match.saturated_fat_g !== undefined) {
      totalSaturatedFat += (grams * match.saturated_fat_g) / 100;
    } else {
      totalLipidsWithoutAgs += (grams * lipids) / 100;
    }

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
  // AGS Nutri-Score (fix 2026-06-12 — agent C bug critique #2) :
  // - Pour les ingrédients avec saturated_fat_g connu en Ciqual : valeur exacte.
  // - Pour ceux sans (ancien import, aliment custom) : fallback 30% des
  //   lipides UNIQUEMENT pour leur fraction (pas sur le total).
  // Avant le fix : 30% global → quiches/gratins beurre+fromage affichés A-B
  // alors qu'ils devraient être C-D. Maintenant : valeur réelle = beurre 65%,
  // comté 60%, huile d'olive 14%, donc le score reflète la réalité.
  const saturatedFat =
    (totalSaturatedFat + totalLipidsWithoutAgs * 0.3) * factor;

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

  // Confiance combinée (révision 2026-06-12 v2) :
  //   - weightCoverage   = poids matché Ciqual / poids total qty-renseigné
  //   - ingredientPenalty = pénalité douce proportionnelle au % d'ingrédients
  //     sans données, capée à 30% maximum
  //   - confidence = weightCoverage × (1 - ingredientPenalty)
  //
  // Pourquoi cette version (v2) :
  //   v1 (2026-06-12 matin) : confidence = weightCoverage × ingredientCoverage
  //   → 1 ingrédient sans qty sur 10 = -10% direct, trop dur sur les salades
  //     de fruits qui ont menthe/zest sans qty mais 90% du poids couvert.
  //   v2 : pénalité de 30% MAX même si tous les ingrédients sont sans qty.
  //   → 1 sans qty sur 10 = -3% (97% des cas), juste un petit signal.
  //   → 5 sans qty sur 10 = -15% (85%), signal plus net.
  //   → tous sans qty = -30% (cap), mais en pratique totalGrams=0 → 0%.
  //
  // Cap visuel : si AU MOINS 1 problème, on plafonne à 0.99 pour qu'on ne
  // voie JAMAIS "100%" sur une recette incomplète. C'est ce qui était
  // trompeur sur le Caviar d'aubergines.
  const weightCoverage =
    totalGrams === 0 ? 0 : totalGramsMatched / totalGrams;
  const ingredientPenalty =
    ingredients.length === 0
      ? 0
      : Math.min(0.3, (problems.length / ingredients.length) * 0.3);
  let confidence = weightCoverage * (1 - ingredientPenalty);
  // Cap à 0.99 si au moins 1 ingrédient a un problème (no-qty, unit-unknown,
  // estimated-weight) — empêche d'afficher "100%" sur une recette imparfaite.
  if (problems.length > 0) {
    confidence = Math.min(confidence, 0.99);
  }

  return {
    per100g,
    confidence: Math.max(0, Math.min(1, confidence)),
    totalGrams,
    problems,
  };
}
