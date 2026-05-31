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

export type WeeklyMenu = {
  id: string;
  weekStart: string; // YYYY-MM-DD (lundi)
  title: string | null;
  coverImageUrl: string;        // image "Main_week" (menu de la semaine)
  shoppingListImageUrl: string; // image "Liste_course_week" (liste de courses)
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
