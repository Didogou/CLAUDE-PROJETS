export type RecipeCategory =
  | 'petit_dejeuner'
  | 'entree'
  | 'salade'
  | 'plat'
  | 'sauce'
  | 'gouter'
  | 'dessert'
  | 'boisson'
  | 'aperitif'
  | 'repas_fete';

/** Structure d'un ingrédient (réutilise la même shape que les items de
 *  liste de courses pour pouvoir agréger sans conversion). */
export type RecipeIngredient = {
  category: string;
  label: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
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
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  aliments: string[];
  ingredients: RecipeIngredient[];
  /** Texte brut éditable (Karine peut le corriger après extraction). */
  ingredientsText: string | null;
  /** Compteur de likes (dénormalisé sur recipe_sheets.likes_count). */
  likesCount: number;
};

export type Recipe = {
  id: string; // slug, utilisé pour l'URL /recettes/[id]
  /** UUID interne (bigint en DB), pour FK vers recipe_sheets. */
  internalId: number;
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
  entree: 'Entrées',
  salade: 'Salades',
  plat: 'Plats',
  sauce: 'Sauces',
  gouter: 'Goûters',
  dessert: 'Desserts',
  boisson: 'Boissons',
  aperitif: 'Apéros dînatoires',
  repas_fete: 'Repas de fête',
};

export const CATEGORY_SINGULAR: Record<RecipeCategory, string> = {
  petit_dejeuner: 'petit déjeuner',
  entree: 'entrée',
  salade: 'salade',
  plat: 'plat',
  sauce: 'sauce',
  gouter: 'goûter',
  dessert: 'dessert',
  boisson: 'boisson',
  aperitif: 'apéro dînatoire',
  repas_fete: 'repas de fête',
};

export const CATEGORY_ORDER: RecipeCategory[] = [
  'petit_dejeuner',
  'entree',
  'salade',
  'plat',
  'sauce',
  'gouter',
  'dessert',
  'boisson',
  'aperitif',
  'repas_fete',
];

export const CATEGORY_SLUG: Record<RecipeCategory, string> = {
  petit_dejeuner: 'petits-dejeuners',
  entree: 'entrees',
  salade: 'salades',
  plat: 'plats',
  sauce: 'sauces',
  gouter: 'gouters',
  dessert: 'desserts',
  boisson: 'boissons',
  aperitif: 'aperos-dinatoires',
  repas_fete: 'repas-de-fete',
};
