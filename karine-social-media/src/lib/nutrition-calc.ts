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
/** Legacy. On utilise weightLossKg pour le calcul désormais. */
export type Goal = 'lose' | 'maintain' | 'gain';

/** Objectif de perte sur 3 mois fixes. 1-9 kg ou null = maintenance. */
// Range élargi : 3 mois max 9, 6 mois max 15, 12 mois max 30.
export type WeightLossKg =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  | 10 | 11 | 12 | 13 | 14 | 15
  | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;

export type TargetHorizonMonths = 3 | 6 | 12;

export type NutritionProfile = {
  sex: Sex;
  ageYears: number;
  weightKg: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  /** Legacy — toujours présent mais ignoré au calcul si weightLossKg est posé. */
  goal: Goal;
  /** Horizon (en mois) sur lequel l'objectif est planifié. */
  targetHorizonMonths?: TargetHorizonMonths;
  /** Objectif de perte sur l'horizon. Null = maintenance.
   *  Fourchette : 0..9 (3m), 0..15 (6m), 0..30 (12m). */
  weightLossKg?: WeightLossKg | null;
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
 * Constante diététique : 1 kg de tissu adipeux ≈ 7700 kcal.
 * Source : ANSES, EFSA, NIH — moyenne consensuelle pour estimer le
 * déficit calorique nécessaire à une perte de poids.
 */
const KCAL_PER_KG_FAT = 7700;
/** Période fixe (en jours) sur laquelle on cible la perte. */
const WEIGHT_LOSS_WINDOW_DAYS = 90;
/** Déficit maximal autorisé (sécurité diététique : pas de famine). */
const MAX_DAILY_DEFICIT_KCAL = 800;
/** Plancher kcal absolu (en dessous, danger métabolique). */
const FLOOR_DAILY_KCAL = 1200;

/**
 * Calcule les besoins nutritionnels complets à partir du profil.
 *
 * Si profile.weightLossKg est posé (1-9), le déficit kcal/jour est
 * calculé silencieusement : kg × 7700 / 90 jours, capé à 800 kcal/j
 * et borné à un plancher de 1200 kcal/j (sécurité).
 *
 * Sinon (legacy), on retombe sur l'ajustement % par goal.
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

  let dailyKcal: number;
  if (typeof profile.weightLossKg === 'number' && profile.weightLossKg > 0) {
    // Fenêtre = horizon réel × 30 jours (3, 6 ou 12 mois). Default
    // 90j (3 mois) pour rétro-compat. La cohérence santé est garantie
    // par le cap MAX_DAILY_DEFICIT_KCAL — perdre 9 kg en 3 mois donne
    // déjà 770 kcal/j de déficit, pas viable de pousser plus.
    const horizonDays = (profile.targetHorizonMonths ?? 3) * 30;
    const windowDays = horizonDays > 0 ? horizonDays : WEIGHT_LOSS_WINDOW_DAYS;
    const rawDeficit = (profile.weightLossKg * KCAL_PER_KG_FAT) / windowDays;
    const cappedDeficit = Math.min(rawDeficit, MAX_DAILY_DEFICIT_KCAL);
    dailyKcal = Math.max(FLOOR_DAILY_KCAL, Math.round(tdee - cappedDeficit));
  } else {
    dailyKcal = Math.round(tdee * (1 + GOAL_ADJUSTMENT[profile.goal]));
  }

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
 *
 * Note : goal est legacy, on accepte 'lose' par défaut si
 * weightLossKg est posé pour rester rétro-compatible avec l'API.
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
