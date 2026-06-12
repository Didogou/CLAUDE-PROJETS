/**
 * Données MOCK pour le POC "cuisine guidée".
 *
 * À terme, ces données viendront des fiches (recipe_sheets) :
 *   - utensils  → catalogue public.utensils (slug + image)
 *   - ingredients → recipe_sheets.ingredients
 *   - steps     → recipe_sheets.preparation_steps
 *
 * Pour le POC on mock une recette complète afin d'itérer sur l'UI sans
 * dépendre de la migration / de l'extraction. Les images d'ustensiles
 * n'existant pas encore, on utilise un emoji de repli.
 */

export type CookUtensil = {
  slug: string;
  label: string;
  /** Repli visuel tant que le catalogue n'a pas d'image associée. */
  emoji: string;
  imageUrl?: string | null;
};

export type CookIngredient = {
  label: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  /** Repli visuel tant que la vignette ciqual (aquarelle) n'est pas branchée. */
  emoji?: string;
  imageUrl?: string | null;
};

export type CookStep = {
  title: string;
  /** Ustensiles mobilisés à cette étape (affichés en photo en haut). */
  utensils: CookUtensil[];
  /** Ingrédients mobilisés à cette étape (révélés un à un). */
  ingredients: CookIngredient[];
  /** L'action principale, mise en avant. */
  action: string;
  /** Détail / astuce optionnelle sous l'action. */
  detail?: string;
};

export type CookRecipe = {
  title: string;
  servings: number;
  steps: CookStep[];
};

const U = {
  planche: { slug: 'planche', label: 'Planche', emoji: '🪵' },
  couteau: { slug: 'couteau', label: 'Couteau', emoji: '🔪' },
  saladier: { slug: 'saladier', label: 'Saladier', emoji: '🥣' },
  casserole: { slug: 'casserole', label: 'Casserole', emoji: '🥘' },
  cuillere: { slug: 'cuillere', label: 'Cuillère', emoji: '🥄' },
  four: { slug: 'four', label: 'Four', emoji: '🔥' },
  plat: { slug: 'plat', label: 'Plat à four', emoji: '🍽️' },
} satisfies Record<string, CookUtensil>;

export const MOCK_RECIPE: CookRecipe = {
  title: 'Poivrons farcis thon, tomates & feta',
  servings: 4,
  steps: [
    {
      title: 'Préparer les ingrédients',
      utensils: [U.planche, U.couteau, U.saladier],
      // Seulement les ingrédients de CETTE étape (pas toute la recette) :
      // une personne qui cuisine doit tout voir sans scroller.
      ingredients: [
        { label: 'poivrons rouges', quantity: 4, unit: null, note: null, emoji: '🫑' },
        { label: 'tomates cerises', quantity: 250, unit: 'g', note: null, emoji: '🍅' },
      ],
      action: 'Découper les poivrons en deux et les évider',
      detail: 'Coupe aussi les tomates cerises en deux.',
    },
    {
      title: 'Cuire le boulgour',
      utensils: [U.casserole],
      ingredients: [
        { label: 'boulgour', quantity: 150, unit: 'g', note: null, emoji: '🌾' },
        { label: 'eau', quantity: 30, unit: 'cl', note: null, emoji: '💧' },
      ],
      action: 'Cuire le boulgour 10 min à frémissement',
      detail: 'Couvre et laisse gonfler hors du feu 2 min.',
    },
    {
      title: 'Préparer la farce',
      utensils: [U.saladier, U.cuillere],
      ingredients: [
        { label: 'thon', quantity: 120, unit: 'g', note: null, emoji: '🐟' },
        { label: 'tomates cerises', quantity: 250, unit: 'g', note: 'coupées', emoji: '🍅' },
        { label: 'boulgour cuit', quantity: null, unit: null, note: null, emoji: '🌾' },
        { label: 'feta émiettée', quantity: 60, unit: 'g', note: null, emoji: '🧀' },
      ],
      action: 'Mélanger le tout dans le saladier',
    },
    {
      title: 'Garnir & enfourner',
      utensils: [U.plat, U.four],
      ingredients: [
        { label: 'poivrons', quantity: 4, unit: null, note: null, emoji: '🫑' },
        { label: 'feta', quantity: 40, unit: 'g', note: 'pour le dessus', emoji: '🧀' },
      ],
      action: 'Enfourner 20 min à 180 °C',
      detail: 'Parsème le reste de feta sur le dessus avant cuisson.',
    },
    {
      title: 'Dressage',
      utensils: [],
      ingredients: [],
      action: 'Servir tiède, arroser d’un filet d’huile d’olive',
      detail: 'Une pincée de poivre du moulin et c’est prêt !',
    },
  ],
};
