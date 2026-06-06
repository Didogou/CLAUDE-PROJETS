import Image from 'next/image';
import {
  CalendarDays,
  Heart,
  Home,
  ShoppingCart,
  UtensilsCrossed,
} from 'lucide-react';

/**
 * Background floral mocké pour les POC client-side. Le vrai
 * FloralBackground est un Server Component (lit Supabase), donc
 * importable uniquement depuis du code server. Ici on simule
 * juste le gradient blush + un voile fleuri générique pour
 * l'illusion visuelle.
 */
export function MockFloralBackground() {
  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 -z-10"
        style={{
          background:
            'linear-gradient(180deg, var(--color-blush) 0%, var(--color-blush-deep) 100%)',
        }}
      />
      <div
        aria-hidden
        className="fixed inset-0 -z-10 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 30%, var(--color-coral-soft) 0%, transparent 35%), radial-gradient(circle at 80% 70%, var(--color-petal) 0%, transparent 40%), radial-gradient(circle at 50% 90%, var(--color-peach) 0%, transparent 30%)',
        }}
      />
    </>
  );
}

/**
 * Contenu de page d'accueil mocké, sans authentification ni état réel.
 * Utilisé par les 3 POC d'épuration du header. Les tuiles sont
 * cliquables uniquement vers leurs href réels (au cas où on veut
 * naviguer), mais aucune capability/rôle n'est vérifié.
 */
const MOCK_TILES = [
  {
    title: 'Menu de la semaine',
    subtitle: 'Des repas équilibrés\nchaque jour',
    bgClass: 'bg-peach',
    iconImage: '/images/icons/ms.webp',
  },
  {
    title: 'Idées recettes',
    subtitle: 'Inspiration saine\net gourmande',
    bgClass: 'bg-cream',
    iconImage: '/images/icons/ir.webp',
  },
  {
    title: 'Conseils santé',
    subtitle: 'Mieux comprendre\nvotre santé',
    bgClass: 'bg-mint',
    iconImage: '/images/icons/cs.webp',
  },
  {
    title: 'Astuces diététiques',
    subtitle: 'Des astuces simples\nau quotidien',
    bgClass: 'bg-lavender',
    iconImage: '/images/icons/ad.webp',
  },
];

/**
 * Grille de tuiles mockée + BottomNav statique.
 * À placer DANS la <main> de chaque POC, sous le header alternatif.
 */
export function MockHomeContent() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6 lg:max-w-7xl lg:px-10 lg:pb-4">
      <div className="grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-4">
        {MOCK_TILES.map((tile) => (
          <div
            key={tile.title}
            className={`relative flex flex-col gap-2 overflow-hidden rounded-tile p-4 shadow-sm ${tile.bgClass}`}
          >
            <div className="absolute right-2 top-2 h-16 w-16 opacity-90">
              <Image
                src={tile.iconImage}
                alt=""
                width={64}
                height={64}
                className="h-full w-full object-contain"
              />
            </div>
            <div className="mt-12">
              <h3 className="text-sm font-bold text-ink lg:text-base">
                {tile.title}
              </h3>
              <p className="mt-1 whitespace-pre-line text-xs text-ink-soft">
                {tile.subtitle}
              </p>
            </div>
            <div className="mt-auto flex justify-end">
              <span className="grid size-7 place-items-center rounded-full bg-coral text-white">
                →
              </span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

/**
 * BottomNav statique (non-fonctionnelle) reproduisant le vrai design.
 * "Accueil" actif par défaut. Pas de navigation.
 */
export function MockBottomNav({
  withFlameBadge = false,
  withBellTab = false,
}: {
  /** Option 3 : badge calorique sur l'onglet Accueil. */
  withFlameBadge?: boolean;
  /** Option 3 : Bell remplace Favoris en tant qu'onglet dédié. */
  withBellTab?: boolean;
}) {
  const items = withBellTab
    ? [
        { label: 'Accueil', icon: Home, active: true },
        { label: 'Courses', icon: ShoppingCart, active: false },
        { label: 'Recettes', icon: UtensilsCrossed, active: false },
        { label: 'Menu', icon: CalendarDays, active: false },
        { label: 'Alertes', icon: BellIcon, active: false },
      ]
    : [
        { label: 'Accueil', icon: Home, active: true },
        { label: 'Courses', icon: ShoppingCart, active: false },
        { label: 'Recettes', icon: UtensilsCrossed, active: false },
        { label: 'Menu', icon: CalendarDays, active: false },
        { label: 'Favoris', icon: Heart, active: false },
      ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-coral-soft/40 bg-white/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-md items-center justify-between px-4 py-2">
        {items.map(({ label, icon: Icon, active }) => (
          <li key={label}>
            <div
              className={`relative flex flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[0.65rem] font-semibold transition ${
                active ? 'text-coral' : 'text-ink-soft'
              }`}
            >
              {/* Badge flamme calorique sur Accueil (Option 3) */}
              {withFlameBadge && label === 'Accueil' && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[0.55rem] font-bold text-white ring-2 ring-white">
                  🔥
                </span>
              )}
              <Icon className="h-5 w-5" strokeWidth={active ? 2.6 : 2} />
              {label}
            </div>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BellIcon({
  className,
  strokeWidth,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
