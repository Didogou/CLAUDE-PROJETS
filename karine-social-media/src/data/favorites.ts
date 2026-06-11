export const FAVORITE_TYPES = ['recipe', 'menu', 'tip', 'advice', 'featured', 'meal_sheet'] as const;
export type FavoriteType = (typeof FAVORITE_TYPES)[number];

export type FavoriteRow = {
  targetType: FavoriteType;
  targetId: string;
  createdAt: string;
};

/** Item enrichi avec les méta-données du contenu (titre, image…). */
export type FavoriteItem = {
  targetType: FavoriteType;
  targetId: string;
  label: string;
  imageUrl: string | null;
  href: string;
  createdAt: string;
};

export const FAVORITE_LABELS: Record<FavoriteType, string> = {
  recipe: 'Recette',
  menu: 'Menu de la semaine',
  tip: 'Astuce',
  advice: 'Conseil santé',
  featured: 'Le saviez-vous',
  meal_sheet: 'Repas de menu',
};

export const FAVORITE_GROUP_LABELS: Record<FavoriteType, string> = {
  recipe: 'Recettes',
  menu: 'Menus de la semaine',
  tip: 'Astuces',
  advice: 'Conseils santé',
  featured: 'Le saviez-vous ?',
  meal_sheet: 'Repas de menu',
};
