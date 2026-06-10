'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  Home,
  ShoppingCart,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { CameraFAB } from './CameraFAB';
import { IdeasFloatingButton } from '@/components/ideas/IdeasFloatingButton';

type NavItem = { href: string; label: string; icon: LucideIcon };

// 4 items REPARTIS SYMETRIQUEMENT autour du FAB camera central :
//   [Accueil] [Courses] | [FAB] | [Recettes] [Menu]
// (Favoris retire pour centrer parfaitement le FAB — 2 a gauche, 2 a
// droite. Acces favoris reste possible via le coeur sur les cartes.)
const ITEMS_LEFT: NavItem[] = [
  { href: '/', label: 'Accueil', icon: Home },
  { href: '/courses', label: 'Courses', icon: ShoppingCart },
];
const ITEMS_RIGHT: NavItem[] = [
  { href: '/recettes', label: 'Recettes', icon: UtensilsCrossed },
  { href: '/menus', label: 'Menu', icon: CalendarDays },
];

export function BottomNav() {
  const pathname = usePathname();
  const isHome = pathname === '/';

  // === Variante HOME : uniquement le FAB camera centre, sans barre.
  // La home a deja ses 4 tuiles d'acces (Menu, Recettes, Sante,
  // Astuces) → BottomNav serait redondant. On garde juste le raccourci
  // photo, action principale qu'on veut faire vite depuis n'importe ou.
  if (isHome) {
    // Variante HOME : 3 boutons centres en bas → [Courses 40px]
    // [FAB Camera 48px] [Ampoule 40px]. Padding safe-area pour iOS.
    return (
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <div className="pointer-events-auto flex items-center gap-3">
          {/* Courses : icone Lucide ShoppingCart (panier), style
              discret sans anneau coral ni pulse. Clic → /courses. */}
          <Link
            href="/courses"
            aria-label="Liste de courses"
            className="grid size-10 place-items-center rounded-full bg-white text-coral shadow-md transition hover:scale-105 active:scale-95"
          >
            <ShoppingCart className="h-6 w-6" strokeWidth={2.2} />
          </Link>
          {/* FAB photo central : reste a sa taille (48px) */}
          <CameraFAB homeMode />
          {/* Ampoule "Une idee" a droite : meme taille que Courses (40px) */}
          <IdeasFloatingButton variant="inline-small" />
        </div>
      </div>
    );
  }

  function renderItem({ href, label, icon: Icon }: NavItem) {
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[0.65rem] font-semibold transition ${
          active ? 'text-coral' : 'text-ink-soft hover:text-coral'
        }`}
      >
        <Icon className="h-5 w-5" strokeWidth={active ? 2.6 : 2} />
        {label}
      </Link>
    );
  }

  return (
    <nav
      // Fixed permanent : la barre est TOUJOURS visible quel que soit
      // le scroll. Padding safe-area pour respecter le home indicator
      // iPhone.
      className="fixed inset-x-0 bottom-0 z-30 border-t border-coral-soft/40 bg-white/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Layout : 2 items a gauche + spacer central (taille du FAB) +
          2 items a droite. FAB en ABSOLU au centre exact (left:50% +
          translate-x:-50%) pour ne pas dependre des largeurs des
          labels. Pas de <ul>/<li> imbrique : div flex direct. */}
      <div className="relative mx-auto flex max-w-md items-center justify-between px-2 py-2">
        {/* Sur /courses, on remplace l'item "Courses" (redondant) par
            "Menu" (acces a /menus). Si on est ailleurs, ITEMS_LEFT
            classique [Accueil, Courses]. */}
        <div className="flex flex-1 justify-around">
          {(pathname === '/courses'
            ? [
                ITEMS_LEFT[0], // Accueil reste
                { href: '/menus', label: 'Menu', icon: CalendarDays },
              ]
            : ITEMS_LEFT
          ).map(renderItem)}
        </div>
        {/* Spacer pour reserver l'espace du FAB centre absolu. */}
        <div aria-hidden className="w-16 shrink-0" />
        <div className="flex flex-1 justify-around">
          {ITEMS_RIGHT.map(renderItem)}
        </div>
        {/* FAB Camera : ABSOLU au centre, depasse vers le haut grace au
            negative margin dans CameraFAB. */}
        <div className="absolute left-1/2 top-0 -translate-x-1/2">
          <CameraFAB />
        </div>
      </div>
    </nav>
  );
}
