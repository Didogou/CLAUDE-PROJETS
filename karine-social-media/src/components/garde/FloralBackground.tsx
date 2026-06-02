// Fond floral partagé (mobile portrait / desktop paysage), calques fixes iOS-safe.
// Variants :
//   'default' — fond global (toutes pages sans variant dédié)
//   'astuces' — page Astuces
//   'salade'  — page catégorie Salades
const VARIANTS = {
  default: {
    portrait: '/images/fond-portrait.png',
    paysage: '/images/fond-paysage.png',
  },
  astuces: {
    portrait: '/images/fond-astuces-portrait.png',
    paysage: '/images/fond-astuces-paysage.png',
  },
  salade: {
    portrait: '/images/fond-salade-portrait.png',
    paysage: '/images/fond-salade-paysage.png',
  },
  dessert: {
    portrait: '/images/fond-dessert-portrait.png',
    paysage: '/images/fond-dessert-paysage.png',
  },
  conseils: {
    portrait: '/images/fond-conseils-portrait.png',
    paysage: '/images/fond-conseils-paysage.png',
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
