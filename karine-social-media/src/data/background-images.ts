export type BackgroundVariantKey =
  | 'default'
  | 'astuces'
  | 'conseils'
  | 'salade'
  | 'dessert'
  | 'accueil'
  | 'recettes';

export type BackgroundOverride = {
  variant: BackgroundVariantKey;
  portraitUrl: string | null;
  paysageUrl: string | null;
  updatedAt: string | null;
};

export const BACKGROUND_VARIANTS: {
  key: BackgroundVariantKey;
  label: string;
  description: string;
  fallbackPortrait: string;
  fallbackPaysage: string;
}[] = [
  {
    key: 'accueil',
    label: 'Accueil',
    description: 'Page d’accueil principale (tuiles + Le saviez-vous)',
    fallbackPortrait: '/images/fond-accueil-v3.png',
    fallbackPaysage: '/images/fond-accueil-desktop-v3.png',
  },
  {
    key: 'default',
    label: 'Par défaut',
    description: 'Fond global utilisé sur les pages sans variant dédié',
    fallbackPortrait: '/images/fond-portrait.webp',
    fallbackPaysage: '/images/fond-paysage.webp',
  },
  {
    key: 'astuces',
    label: 'Astuces',
    description: 'Page « Astuces diététiques »',
    fallbackPortrait: '/images/fond-astuces-portrait.webp',
    fallbackPaysage: '/images/fond-astuces-paysage.webp',
  },
  {
    key: 'conseils',
    label: 'Conseils santé',
    description: 'Page « Conseils santé »',
    fallbackPortrait: '/images/fond-conseils-portrait.webp',
    fallbackPaysage: '/images/fond-conseils-paysage.webp',
  },
  {
    key: 'salade',
    label: 'Catégorie : Salades',
    description: 'Catégorie de recettes « Salades »',
    fallbackPortrait: '/images/fond-salade-portrait.webp',
    fallbackPaysage: '/images/fond-salade-paysage.webp',
  },
  {
    key: 'dessert',
    label: 'Catégorie : Desserts',
    description: 'Catégorie de recettes « Desserts »',
    fallbackPortrait: '/images/fond-dessert-portrait.webp',
    fallbackPaysage: '/images/fond-dessert-paysage.webp',
  },
  {
    key: 'recettes',
    label: 'Recettes (home)',
    description: 'Page d’accueil « Idées recettes » (dégradé rose Karine)',
    fallbackPortrait: '/images/fond-recettes-portrait.webp',
    fallbackPaysage: '/images/fond-recettes-paysage.webp',
  },
];
