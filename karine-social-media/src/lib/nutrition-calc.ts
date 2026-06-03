/**
 * Calcul des besoins nutritionnels — Mifflin-St Jeor + facteur
 * d'activité + ajustement objectif.
 *
 * Formules officielles ANSES/EFSA :
 *   BMR homme : 10P + 6.25T - 5A + 5
 *   BMR femme : 10P + 6.25T - 5A - 161
 *   TDEE = BMR × facteur activité
 *   daily_kcal = TDEE × (1 + ajustement objectif)
 *
 * Répartition macros :
 *   Protéines : 1.0 g/kg (sédentaire) → 1.6 g/kg (très actif)
 *   Lipides : 32% des kcal (1g = 9 kcal)
 *   Glucides : le reste (1g = 4 kcal)
 */

export type Sex = 'male' | 'female';
export type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active';
export type Goal = 'lose' | 'maintain' | 'gain';

export type NutritionProfile = {
  sex: Sex;
  ageYears: number;
  weightKg: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  goal: Goal;
};

export type NutritionTargets = {
  /** Métabolisme de base (kcal/j au repos) */
  bmr: number;
  /** Dépense énergétique totale (kcal/j avec activité) */
  tdee: number;
  /** Objectif kcal journalier (TDEE ajusté selon goal) */
  dailyKcal: number;
  /** Protéines cible (g/j) */
  proteinsG: number;
  /** Lipides cible (g/j) */
  lipidsG: number;
  /** Glucides cible (g/j) */
  carbsG: number;
};

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sédentaire (peu ou pas d\'exercice)',
  light: 'Légère (1 à 3 séances/sem)',
  moderate: 'Modérée (3 à 5 séances/sem)',
  active: 'Active (6 à 7 séances/sem)',
  very_active: 'Très active (travail physique, sport intense)',
};

export const GOAL_LABELS: Record<Goal, string> = {
  lose: 'Perdre du poids (-15%)',
  maintain: 'Maintenir mon poids',
  gain: 'Prendre du poids (+10%)',
};

const GOAL_ADJUSTMENT: Record<Goal, number> = {
  lose: -0.15,
  maintain: 0,
  gain: 0.1,
};

const PROTEIN_PER_KG: Record<ActivityLevel, number> = {
  sedentary: 1.0,
  light: 1.1,
  moderate: 1.3,
  active: 1.5,
  very_active: 1.6,
};

/**
 * Calcule les besoins nutritionnels complets à partir du profil.
 */
export function calculateNutritionTargets(
  profile: NutritionProfile,
): NutritionTargets {
  const baseBmr =
    10 * profile.weightKg +
    6.25 * profile.heightCm -
    5 * profile.ageYears;
  const bmr = Math.round(profile.sex === 'male' ? baseBmr + 5 : baseBmr - 161);

  const tdee = Math.round(bmr * ACTIVITY_FACTORS[profile.activityLevel]);
  const dailyKcal = Math.round(tdee * (1 + GOAL_ADJUSTMENT[profile.goal]));

  // Protéines : multiplicateur selon activité
  const proteinsG = Math.round(
    profile.weightKg * PROTEIN_PER_KG[profile.activityLevel],
  );

  // Lipides : 32% des kcal
  const lipidsG = Math.round((dailyKcal * 0.32) / 9);

  // Glucides : le reste, plancher 50g (sécurité métabolique)
  const kcalFromProtein = proteinsG * 4;
  const kcalFromLipids = lipidsG * 9;
  const kcalFromCarbs = Math.max(0, dailyKcal - kcalFromProtein - kcalFromLipids);
  const carbsG = Math.max(50, Math.round(kcalFromCarbs / 4));

  return { bmr, tdee, dailyKcal, proteinsG, lipidsG, carbsG };
}

/**
 * Vérifie si le profil est complet (tous les champs requis).
 */
export function isProfileComplete(
  p: Partial<NutritionProfile>,
): p is NutritionProfile {
  return (
    (p.sex === 'male' || p.sex === 'female') &&
    typeof p.ageYears === 'number' &&
    p.ageYears > 0 &&
    typeof p.weightKg === 'number' &&
    p.weightKg > 0 &&
    typeof p.heightCm === 'number' &&
    p.heightCm > 0 &&
    typeof p.activityLevel === 'string' &&
    p.activityLevel in ACTIVITY_FACTORS &&
    typeof p.goal === 'string' &&
    p.goal in GOAL_ADJUSTMENT
  );
}
