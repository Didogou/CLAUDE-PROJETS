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

export type Recipe = {
  id: string; // slug, utilisé pour l'URL /recettes/[id]
  title: string;
  category: RecipeCategory;
  coverImage: string;
  slides: string[];
  tags: string[];
  calories: number | null;
  aliments: string[];
  isSeasonal: boolean;
  isFeatured: boolean;
  likesCount: number;
  prepPhotos: string[];
  prepTimeMin: number | null;
  cookTimeMin: number | null;
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
