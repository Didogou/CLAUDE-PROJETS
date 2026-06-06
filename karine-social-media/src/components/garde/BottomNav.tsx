'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  Heart,
  Home,
  ShoppingCart,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

type NavItem = { href: string; label: string; icon: LucideIcon };

// 5 items : Accueil / Courses / Recettes / Menu / Favoris.
// Profil et notifications sont accessibles en haut à droite via AppHeader.
const ITEMS: NavItem[] = [
  { href: '/', label: 'Accueil', icon: Home },
  { href: '/courses', label: 'Courses', icon: ShoppingCart },
  { href: '/recettes', label: 'Recettes', icon: UtensilsCrossed },
  { href: '/menus', label: 'Menu', icon: CalendarDays },
  { href: '/favoris', label: 'Favoris', icon: Heart },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      // Fixed permanent : la barre est TOUJOURS visible quel que soit
      // le scroll. C'est l'ancre de navigation principale → on suit le
      // pattern des apps natives (Instagram, Spotify, Apple Mail).
      // Padding safe-area pour respecter le home indicator iPhone.
      // Le padding-bottom global sur body (sur-h-bottom-nav) garantit
      // que le contenu n'est jamais masqué par cette barre fixée.
      className="fixed inset-x-0 bottom-0 z-30 border-t border-coral-soft/40 bg-white/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-md items-center justify-between px-4 py-2">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[0.65rem] font-semibold transition ${
                  active ? 'text-coral' : 'text-ink-soft hover:text-coral'
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.6 : 2} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
