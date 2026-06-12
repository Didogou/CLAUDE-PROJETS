export type RecipeCategory =
  | 'petit_dejeuner'
  | 'salade'
  | 'plat'
  | 'sauce'
  | 'gouter'
  | 'dessert'
  | 'boisson'
  | 'aperitif'
  | 'repas_fete'
  | 'sur_le_pouce'
  | 'tradition';

/** Structure d'un ingrédient (réutilise la même shape que les items de
 *  liste de courses pour pouvoir agréger sans conversion).
 *
 *  `ciqual_food_id` : lien vers la table Ciqual pour le calcul
 *  Nutri-Score. Ajouté 2026-06-08, optionnel — vaut null sur les
 *  recettes existantes tant que Karine ne l'a pas renseigné via la
 *  page admin Nutri-Score. */
export type RecipeIngredient = {
  category: string;
  label: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  ciqual_food_id?: number | null;
};

/**
 * Une fiche détaillée d'une recette. Chaque fiche est une recette
 * complète à part entière (calories, temps, ingrédients propres).
 *
 * 1 recette mère = N>=1 fiches détaillées. Si Karine n'upload pas de
 * fiche détaillée, on en crée automatiquement une à partir de la cover
 * principale.
 */
export type RecipeSheet = {
  /** UUID de la sheet (différent du slug recipe). */
  id: string;
  /** Ordre d'affichage dans la pellicule (0 = par défaut). */
  sheetIndex: number;
  /** Titre de cette variante (ex: "Poivrons farcis thon, tomates & feta"). */
  title: string | null;
  /** URL de l'image de la fiche détaillée. */
  coverImageUrl: string;
  servings: number;
  calories: number | null;
  /** Macros par PORTION, calculées automatiquement depuis
   *  ingredients × Ciqual à la sauvegarde côté admin. Null si la
   *  couverture Ciqual est insuffisante (< 30% des ingrédients). */
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  aliments: string[];
  ingredients: RecipeIngredient[];
  /** Texte brut éditable (Karine peut le corriger après extraction). */
  ingredientsText: string | null;
  /** Étapes de préparation ordonnées (haut → bas de la fiche),
   *  extraites par Vision. Contenu réservé (paywall) côté abonnée. */
  preparationSteps: string[];
  /** Slugs d'ustensiles référençant le catalogue public.utensils. */
  utensils: string[];
  /** Compteur de likes (dénormalisé sur recipe_sheets.likes_count). */
  likesCount: number;
  /** Nutri-Score persisté en BDD (calculé à la sauvegarde admin).
   *  Null si la recette n'a pas encore été passée par la page admin
   *  Nutri-Score OU si la confiance était trop basse pour produire un
   *  grade fiable. Les pages publiques l'affichent si ≥ 0.5 confiance. */
  nutriscoreGrade: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  nutriscoreConfidence: number | null;
  /** Override admin végétarien : null = auto, true/false = forcé.
   *  Le tag effectif est calculé via computeSheetDietaryTags() dans
   *  src/lib/dietary-tags.ts. */
  isVegetarianOverride: boolean | null;
  /** Override admin sans gluten : null = auto, true/false = forcé. */
  isGlutenFreeOverride: boolean | null;
  /** Override admin sans porc : null = auto, true/false = forcé. */
  isPorkFreeOverride: boolean | null;
  /** Tags diététiques EFFECTIFS de cette fiche (override + auto).
   *  Calculés server-side. Permettent d'afficher les labels sur
   *  une fiche détaillée individuelle (SheetCarousel) sans avoir
   *  besoin de re-calculer côté client (les ingredients sont scrubés). */
  dietary: {
    isVegetarian: boolean;
    isGlutenFree: boolean;
    isPorkFree: boolean;
  };
};

/** Tags diététiques agrégés sur l'ensemble des fiches d'une recette.
 *  Calculés server-side dans `getPublishedRecipesLite` (les ingrédients
 *  ne fuitent pas au client). Règle d'agrégation : OR sur les sheets —
 *  la recette est taguée si AU MOINS UNE fiche correspond. */
export type DietaryTags = {
  isVegetarian: boolean;
  isGlutenFree: boolean;
  isPorkFree: boolean;
};

export type Recipe = {
  id: string; // slug, utilisé pour l'URL /recettes/[id]
  /** UUID interne (bigint en DB), pour FK vers recipe_sheets. */
  internalId: number;
  /** Tags diététiques pré-calculés server-side. Évite d'avoir à
   *  exposer la liste des ingrédients au client. */
  dietaryTags: DietaryTags;
  title: string;
  category: RecipeCategory;
  coverImage: string;
  slides: string[];
  isSeasonal: boolean;
  isFeatured: boolean;
  /** "Tout le monde" : true = accessible aux visiteurs non abonnés,
   *  false = réservée aux abonnées / patientes. */
  isPublic: boolean;
  likesCount: number;
  prepPhotos: string[];
  /** Fiches détaillées (toujours au moins 1 après création). */
  sheets: RecipeSheet[];

  // ==========================================================
  // CHAMPS LEGACY (reflètent sheets[0] pour ne pas casser le
  // code existant qui lit ces propriétés directement).
  // À ne PAS modifier directement : modifier la sheet à la place.
  // ==========================================================
  /** @deprecated alias de sheets[0].calories */
  calories: number | null;
  /** @deprecated alias de sheets[0].prepTimeMin */
  prepTimeMin: number | null;
  /** @deprecated alias de sheets[0].cookTimeMin */
  cookTimeMin: number | null;
  /** @deprecated alias de sheets[0].servings */
  servings: number;
  /** @deprecated alias de sheets[0].tags */
  tags: string[];
  /** @deprecated alias de sheets[0].aliments */
  aliments: string[];
  /** @deprecated alias de sheets[0].ingredients */
  ingredients: RecipeIngredient[];
  /** @deprecated alias de sheets[0].ingredientsText */
  ingredientsText: string | null;
};

export const CATEGORY_LABELS: Record<RecipeCategory, string> = {
  petit_dejeuner: 'Petits déjeuners',
  salade: 'Salades',
  plat: 'Plats',
  sauce: 'Sauces',
  gouter: 'Goûters',
  dessert: 'Desserts',
  boisson: 'Boissons',
  aperitif: 'Apéros dînatoires',
  repas_fete: 'Repas de fête',
  sur_le_pouce: 'Sur le pouce',
  tradition: 'Tradition',
};

export const CATEGORY_SINGULAR: Record<RecipeCategory, string> = {
  petit_dejeuner: 'petit déjeuner',
  salade: 'salade',
  plat: 'plat',
  sauce: 'sauce',
  gouter: 'goûter',
  dessert: 'dessert',
  boisson: 'boisson',
  aperitif: 'apéro dînatoire',
  repas_fete: 'repas de fête',
  sur_le_pouce: 'sur le pouce',
  tradition: 'tradition',
};

// Ordre par défaut côté admin / liste — l'ordre des onglets côté
// /recettes (utilisatrice) est défini dans RecettesOngletsView.
export const CATEGORY_ORDER: RecipeCategory[] = [
  'petit_dejeuner',
  'salade',
  'plat',
  'sauce',
  'gouter',
  'dessert',
  'boisson',
  'aperitif',
  'repas_fete',
  'sur_le_pouce',
  'tradition',
];

export const CATEGORY_SLUG: Record<RecipeCategory, string> = {
  petit_dejeuner: 'petits-dejeuners',
  salade: 'salades',
  plat: 'plats',
  sauce: 'sauces',
  gouter: 'gouters',
  dessert: 'desserts',
  boisson: 'boissons',
  aperitif: 'aperos-dinatoires',
  repas_fete: 'repas-de-fete',
  sur_le_pouce: 'sur-le-pouce',
  tradition: 'tradition',
};
