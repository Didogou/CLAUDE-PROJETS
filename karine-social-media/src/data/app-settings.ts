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
  /** Contenu Markdown léger affiché sur /a-propos. Édité par Karine
   *  via /admin/parametres → AboutPageEditor. */
  aboutPageContent: string;
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

export const DEFAULT_ABOUT_PAGE_CONTENT = `# À propos de Karine Diététique

Bienvenue ! Cette application a été pensée pour t'accompagner au quotidien dans tes choix alimentaires, avec bienveillance et sans culpabilité.

## Mon approche

Pas de régime restrictif, juste de l'équilibre, des recettes simples et de l'écoute de ton corps.

## Contact

Pour toute question, tu peux me joindre via le formulaire du menu burger.
`;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  patientRelanceCooldownDays: 3,
  showCaloriesInCounter: true,
  calorieTrackerEnabled: true,
  waterTrackerEnabled: true,
  calorieEncouragements: DEFAULT_ENCOURAGEMENTS,
  aboutPageContent: DEFAULT_ABOUT_PAGE_CONTENT,
};
