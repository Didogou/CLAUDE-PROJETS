export const DAYS_LABELS = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;

export type MealKind = 'lunch' | 'dinner';

export const MEAL_LABELS: Record<MealKind, string> = {
  lunch: 'Déjeuner',
  dinner: 'Dîner',
};

export type WeeklyMenuDay = {
  dayIndex: number; // 0 = lundi, 6 = dimanche
  coverImageUrl: string | null; // annonce du menu du jour
  lunchLabel: string;
  lunchRecipeSlug: string | null;
  lunchImageUrl: string | null;
  dinnerLabel: string;
  dinnerRecipeSlug: string | null;
  dinnerImageUrl: string | null;
  prepPhotos: string[]; // pellicule "en vrai" pour ce jour
};

/** Un item de la liste de courses structurée. quantity et unit peuvent
 *  être null (cas "Sel, poivre" / "Persil ou basilic frais"). Note libre
 *  pour les précisions ("facultatif", "pour les tartinettes"). */
export type ShoppingListItem = {
  category: string;
  label: string;
  quantity: number | null;
  unit: string | null;
  note?: string | null;
};

/** Repas (lunch/dinner) au sein d'un menu hebdomadaire. */
export type MenuMealSheet = {
  id: string;
  menuId: string;
  dayIndex: number; // 0 = lundi, 6 = dimanche
  mealKind: MealKind;
  title: string | null;
  coverImageUrl: string;
  servings: number;
  calories: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  aliments: string[];
  /** Réutilise le type ShoppingListItem (~ RecipeIngredient) pour
   *  pouvoir agréger directement dans la liste de courses sans
   *  conversion. */
  ingredients: ShoppingListItem[];
  likesCount: number;
};

export type WeeklyMenu = {
  id: string;
  weekStart: string; // YYYY-MM-DD (lundi)
  title: string | null;
  coverImageUrl: string;        // image "Main_week" (menu de la semaine)
  shoppingListImageUrl: string; // image "Liste_course_week" (liste de courses)
  /** Nombre de personnes pour lequel la liste est calibrée (default null). */
  shoppingListPortions: number | null;
  /** Items extraits par Claude Vision puis validés par l'admin. */
  shoppingListItems: ShoppingListItem[] | null;
  status: 'draft' | 'published';
  publishedAt: string | null;
  days: WeeklyMenuDay[];
};

// Formate la date du lundi en lisible : "Semaine du 26 mai 2026"
export function formatWeekTitle(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00');
  return `Semaine du ${d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}`;
}

// Renvoie l'index du jour (0-6) à partir d'un Date.
// Lundi = 0, Dimanche = 6 (au lieu de Date.getDay() qui met dimanche à 0)
export function dayIndexFromDate(d: Date): number {
  const js = d.getDay(); // 0 = dimanche
  return js === 0 ? 6 : js - 1;
}
