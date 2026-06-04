// Type client-safe (pas d'imports server-only ici).

export type AppSettings = {
  patientRelanceCooldownDays: number;
  /** Si false, masque les kcal/100g dans la sheet calorie cote
   *  abonnee (mode focus aliments, anti-stress chiffres). */
  showCaloriesInCounter: boolean;
  /** Si false, le FAB Calorie est masqué pour les abonnées. Les
   *  admins gardent l'accès pour pouvoir tester. */
  calorieTrackerEnabled: boolean;
  /** Si false, le FAB Eau est masqué pour les abonnées. Les admins
   *  gardent l'accès pour pouvoir tester. */
  waterTrackerEnabled: boolean;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  patientRelanceCooldownDays: 3,
  showCaloriesInCounter: true,
  calorieTrackerEnabled: true,
  waterTrackerEnabled: true,
};
