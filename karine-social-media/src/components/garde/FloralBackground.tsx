// Fond floral partagé (mobile portrait / desktop paysage), calques fixes iOS-safe.
// Variants :
//   'default' — fond global (toutes pages sans variant dédié)
//   'astuces' — page Astuces
//   'salade'  — page catégorie Salades
const VARIANTS = {
  default: {
    portrait: '/images/fond-portrait.webp',
    paysage: '/images/fond-paysage.webp',
  },
  astuces: {
    portrait: '/images/fond-astuces-portrait.webp',
    paysage: '/images/fond-astuces-paysage.webp',
  },
  salade: {
    portrait: '/images/fond-salade-portrait.webp',
    paysage: '/images/fond-salade-paysage.webp',
  },
  dessert: {
    portrait: '/images/fond-dessert-portrait.webp',
    paysage: '/images/fond-dessert-paysage.webp',
  },
  conseils: {
    portrait: '/images/fond-conseils-portrait.webp',
    paysage: '/images/fond-conseils-paysage.webp',
  },
} as const;

export type BackgroundVariant = keyof typeof VARIANTS;

export function FloralBackground({ variant = 'default' }: { variant?: BackgroundVariant }) {
  const { portrait, paysage } = VARIANTS[variant];
  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat lg:hidden"
        style={{ backgroundImage: `url('${portrait}')` }}
      />
      <div
        aria-hidden
        className="fixed inset-0 -z-10 hidden bg-cover bg-center bg-no-repeat lg:block"
        style={{ backgroundImage: `url('${paysage}')` }}
      />
    </>
  );
}
