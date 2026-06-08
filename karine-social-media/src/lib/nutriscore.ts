/**
 * Calcul du Nutri-Score selon l'algorithme officiel Santé publique
 * France — VERSION 2024 (en vigueur depuis le 1er janvier 2024).
 *
 * Source : journal officiel + publications SPF
 *   https://www.santepubliquefrance.fr/determinants-de-sante/nutrition-et-activite-physique/articles/nutri-score
 *
 * L'algorithme est déterministe — pas besoin d'IA ni de service tiers.
 *
 * Principe :
 *   1. On part des valeurs nutritionnelles PAR 100g du produit fini
 *      (énergie, sucres, AGS, sodium, fibres, protéines, %FVL).
 *   2. On calcule des "points négatifs" (P : pénalisent) et des
 *      "points positifs" (N : favorisent).
 *   3. Score final = P - N
 *   4. Mapping en lettre A-E selon des seuils.
 *
 * 3 variantes selon le type de produit (voir computeNutriscore) :
 *   - GENERIC   : la majorité des plats et recettes
 *   - BEVERAGE  : boissons (sauf eau et boissons à base de lait)
 *   - FAT       : matières grasses, huiles, beurres, fromages affinés
 *
 * Ce module ne gère QUE le calcul. L'agrégation des ingrédients (recette
 * → valeurs par 100g) est dans nutriscore-aggregate.ts.
 */

export type NutriscoreCategory = 'GENERIC' | 'BEVERAGE' | 'FAT';
export type NutriscoreGrade = 'A' | 'B' | 'C' | 'D' | 'E';

/** Entrée du calcul : valeurs nutritionnelles par 100g du produit fini. */
export type NutriscoreInput = {
  /** kcal par 100g */
  kcal: number;
  /** Sucres totaux, g par 100g */
  sugars: number;
  /** Acides gras saturés, g par 100g */
  saturatedFat: number;
  /** Sodium, mg par 100g (= sel/2.5 × 1000) */
  sodiumMg: number;
  /** Fibres alimentaires, g par 100g */
  fibers: number;
  /** Protéines, g par 100g */
  proteins: number;
  /** Pourcentage de fruits/légumes/légumineuses (FVL) dans le produit,
   *  de 0 à 100. Bonus si > 40% (GENERIC) ou > 60% (BEVERAGE). */
  fruitsVegLegumesPct: number;
};

export type NutriscoreResult = {
  grade: NutriscoreGrade;
  /** Score final (P - N). Plus c'est bas, mieux c'est. */
  points: number;
  /** Décomposition pour affichage debug / page admin. */
  breakdown: {
    negativePoints: number;
    positivePoints: number;
    negativeDetail: {
      energy: number;
      sugars: number;
      saturatedFat: number;
      sodium: number;
    };
    positiveDetail: {
      fibers: number;
      proteins: number;
      fvl: number;
    };
  };
  category: NutriscoreCategory;
};

// =====================================================================
// Tables de points officielles Nutri-Score 2024
// =====================================================================

/** Renvoie le nombre de points pour une valeur donnée, en cherchant le
 *  premier seuil dépassé dans la table. La table est ordonnée du plus
 *  petit nombre de points au plus grand. Chaque entrée = [valeur_min, points]
 *  → "si la valeur est >= valeur_min, on donne `points`". On retourne
 *  le maximum atteint. */
function scoreFromTable(value: number, table: readonly [number, number][]): number {
  let last = 0;
  for (const [threshold, pts] of table) {
    if (value >= threshold) last = pts;
    else break;
  }
  return last;
}

// --- ÉNERGIE (kJ/100g — SPF utilise kJ, on convertit depuis kcal) ---
// 1 kcal = 4.184 kJ
const KCAL_TO_KJ = 4.184;

// Points énergie pour aliments GENERIC (kJ/100g)
const NEG_ENERGY_GENERIC: readonly [number, number][] = [
  [0, 0],
  [336, 1],
  [672, 2],
  [1008, 3],
  [1344, 4],
  [1680, 5],
  [2010, 6],
  [2350, 7],
  [2690, 8],
  [3030, 9],
  [3370, 10],
];

// Points énergie pour BOISSONS (kJ/100mL)
const NEG_ENERGY_BEVERAGE: readonly [number, number][] = [
  [0, 0],
  [30, 1],
  [60, 2],
  [90, 3],
  [120, 4],
  [150, 5],
  [180, 6],
  [210, 7],
  [240, 8],
  [270, 9],
  [300, 10],
];

// --- SUCRES (g/100g pour GENERIC, g/100mL pour BEVERAGE) ---
const NEG_SUGARS_GENERIC: readonly [number, number][] = [
  [0, 0],
  [3.4, 1],
  [6.8, 2],
  [10, 3],
  [14, 4],
  [17, 5],
  [20, 6],
  [24, 7],
  [27, 8],
  [31, 9],
  [34, 10],
  [37, 11],
  [41, 12],
  [44, 13],
  [48, 14],
  [51, 15],
];

const NEG_SUGARS_BEVERAGE: readonly [number, number][] = [
  [0, 0],
  [0.5, 1],
  [2, 2],
  [3.5, 3],
  [5, 4],
  [6, 5],
  [7, 6],
  [8, 7],
  [9, 8],
  [10, 9],
  [11, 10],
];

// --- ACIDES GRAS SATURÉS (g/100g) ---
const NEG_AGS_GENERIC: readonly [number, number][] = [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [5, 5],
  [6, 6],
  [7, 7],
  [8, 8],
  [9, 9],
  [10, 10],
];

const NEG_AGS_BEVERAGE: readonly [number, number][] = NEG_AGS_GENERIC;

// Pour les matières grasses, on utilise un ratio AGS/lipides totaux
// → table différente (FAT). Implémentation simplifiée : on reprend
// GENERIC en l'attendant.
const NEG_AGS_FAT: readonly [number, number][] = NEG_AGS_GENERIC;

// --- SODIUM (mg/100g — SPF a basculé du sel au sodium en 2024) ---
const NEG_SODIUM_GENERIC: readonly [number, number][] = [
  [0, 0],
  [80, 1],
  [160, 2],
  [240, 3],
  [320, 4],
  [400, 5],
  [500, 6],
  [600, 7],
  [700, 8],
  [800, 9],
  [900, 10],
  [1000, 11],
  [1100, 12],
  [1200, 13],
  [1300, 14],
  [1400, 15],
  [1500, 16],
  [1600, 17],
  [1700, 18],
  [1800, 19],
  [1900, 20],
];

const NEG_SODIUM_BEVERAGE: readonly [number, number][] = NEG_SODIUM_GENERIC;

// --- POINTS POSITIFS ---

// FIBRES (g/100g) — AOAC method depuis 2024
const POS_FIBERS_GENERIC: readonly [number, number][] = [
  [0, 0],
  [3, 1],
  [4.1, 2],
  [5.2, 3],
  [6.3, 4],
  [7.4, 5],
];

// PROTÉINES (g/100g)
const POS_PROTEINS_GENERIC: readonly [number, number][] = [
  [0, 0],
  [2.4, 1],
  [4.8, 2],
  [7.2, 3],
  [9.6, 4],
  [12, 5],
  [14, 6],
  [17, 7],
];

const POS_PROTEINS_BEVERAGE: readonly [number, number][] = [
  [0, 0],
  [1.2, 1],
  [1.5, 2],
  [1.8, 3],
  [2.1, 4],
  [2.4, 5],
  [2.7, 6],
];

// FVL (% fruits/légumes/légumineuses)
function scoreFVL(pct: number, category: NutriscoreCategory): number {
  if (category === 'BEVERAGE') {
    if (pct >= 80) return 10;
    if (pct >= 60) return 4;
    if (pct >= 40) return 2;
    return 0;
  }
  // GENERIC + FAT
  if (pct >= 80) return 5;
  if (pct >= 60) return 2;
  if (pct >= 40) return 1;
  return 0;
}

// =====================================================================
// Mapping points → lettre
// =====================================================================

function gradeFromPoints(points: number, category: NutriscoreCategory): NutriscoreGrade {
  if (category === 'BEVERAGE') {
    // L'eau est toujours A, autres boissons :
    if (points <= 1) return 'B';
    if (points <= 5) return 'C';
    if (points <= 9) return 'D';
    return 'E';
  }
  if (category === 'FAT') {
    if (points <= -6) return 'A';
    if (points <= 2) return 'B';
    if (points <= 10) return 'C';
    if (points <= 18) return 'D';
    return 'E';
  }
  // GENERIC (la majorité des recettes Karine)
  if (points <= 0) return 'A';
  if (points <= 2) return 'B';
  if (points <= 10) return 'C';
  if (points <= 18) return 'D';
  return 'E';
}

// =====================================================================
// API publique
// =====================================================================

export function computeNutriscore(
  input: NutriscoreInput,
  category: NutriscoreCategory = 'GENERIC',
): NutriscoreResult {
  // Conversion kcal → kJ pour le calcul (SPF utilise kJ depuis 2024)
  const kj = input.kcal * KCAL_TO_KJ;

  // Tables selon catégorie
  const tableEnergy =
    category === 'BEVERAGE' ? NEG_ENERGY_BEVERAGE : NEG_ENERGY_GENERIC;
  const tableSugars =
    category === 'BEVERAGE' ? NEG_SUGARS_BEVERAGE : NEG_SUGARS_GENERIC;
  const tableAgs =
    category === 'BEVERAGE'
      ? NEG_AGS_BEVERAGE
      : category === 'FAT'
        ? NEG_AGS_FAT
        : NEG_AGS_GENERIC;
  const tableSodium =
    category === 'BEVERAGE' ? NEG_SODIUM_BEVERAGE : NEG_SODIUM_GENERIC;
  const tableProteins =
    category === 'BEVERAGE' ? POS_PROTEINS_BEVERAGE : POS_PROTEINS_GENERIC;

  // Points négatifs
  const negDetail = {
    energy: scoreFromTable(kj, tableEnergy),
    sugars: scoreFromTable(input.sugars, tableSugars),
    saturatedFat: scoreFromTable(input.saturatedFat, tableAgs),
    sodium: scoreFromTable(input.sodiumMg, tableSodium),
  };
  const negativePoints =
    negDetail.energy +
    negDetail.sugars +
    negDetail.saturatedFat +
    negDetail.sodium;

  // Points positifs
  const posDetail = {
    fibers: scoreFromTable(input.fibers, POS_FIBERS_GENERIC),
    proteins: scoreFromTable(input.proteins, tableProteins),
    fvl: scoreFVL(input.fruitsVegLegumesPct, category),
  };

  // Règle spéciale GENERIC : si negativePoints >= 11, on ne compte
  // pas les points "protéines" SAUF si fvl >= 5. C'est une mesure pour
  // empêcher qu'un produit très gras/salé soit "remonté" par sa
  // teneur élevée en protéines (ex: fromage, charcuterie).
  let proteinsCount = posDetail.proteins;
  if (category === 'GENERIC' && negativePoints >= 11 && posDetail.fvl < 5) {
    proteinsCount = 0;
  }
  const positivePoints = posDetail.fibers + proteinsCount + posDetail.fvl;

  const points = negativePoints - positivePoints;
  const grade = gradeFromPoints(points, category);

  return {
    grade,
    points,
    breakdown: {
      negativePoints,
      positivePoints,
      negativeDetail: negDetail,
      positiveDetail: { ...posDetail, proteins: proteinsCount },
    },
    category,
  };
}

/** Couleurs réglementaires pour l'affichage du badge. Tons HEX exacts
 *  des supports officiels Santé publique France. */
export const NUTRISCORE_COLORS: Record<NutriscoreGrade, { bg: string; text: string }> = {
  A: { bg: '#038141', text: '#ffffff' },
  B: { bg: '#85bb2f', text: '#ffffff' },
  C: { bg: '#fecb02', text: '#000000' },
  D: { bg: '#ee8100', text: '#ffffff' },
  E: { bg: '#e63e11', text: '#ffffff' },
};
