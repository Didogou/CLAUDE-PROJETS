// Type client-safe (pas d'imports server-only ici).

export type EncouragementCategory =
  | 'debut-journee'
  | 'bonne-route'
  | 'objectif-atteint';

export type CalorieEncouragements = Record<EncouragementCategory, string[]>;

export type AppSettings = {
  patientRelanceCooldownDays: number;
  showCaloriesInCounter: boolean;
  calorieTrackerEnabled: boolean;
  waterTrackerEnabled: boolean;
  /** Phrases d'encouragement affichees sur /mes-calories selon
   *  l'etat d'avancement. Editees par Karine via /admin/parametres. */
  calorieEncouragements: CalorieEncouragements;
};

export const DEFAULT_ENCOURAGEMENTS: CalorieEncouragements = {
  'debut-journee': [
    'Chaque petit choix compte, soyez fière de vous ♡',
    'Une journée commence bien quand on prend soin de soi ♡',
    'Petit à petit, vous y arrivez ♡',
  ],
  'bonne-route': [
    "Continuez sur votre lancée, c'est top ♡",
    "Vous avancez bien, restez à l'écoute de votre corps ♡",
    "Belle régularité, c'est ça qui fait la différence ♡",
  ],
  'objectif-atteint': [
    'Objectif atteint, soyez fière de vous ♡',
    "Bravo ! Vous avez écouté votre corps aujourd'hui ♡",
    'Magnifique journée nutrition, félicitations ♡',
  ],
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  patientRelanceCooldownDays: 3,
  showCaloriesInCounter: true,
  calorieTrackerEnabled: true,
  waterTrackerEnabled: true,
  calorieEncouragements: DEFAULT_ENCOURAGEMENTS,
};
