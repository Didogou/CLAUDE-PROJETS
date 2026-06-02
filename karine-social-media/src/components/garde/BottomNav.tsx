'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, Home, User, UtensilsCrossed, type LucideIcon } from 'lucide-react';

type NavItem = { href: string; label: string; icon: LucideIcon };

// V1 espace user : 4 items confortables sur mobile.
// Conseils, Mes menus et Astuces restent accessibles via tuiles home + burger.
const ITEMS: NavItem[] = [
  { href: '/', label: 'Accueil', icon: Home },
  { href: '/recettes', label: 'Recettes', icon: UtensilsCrossed },
  { href: '/favoris', label: 'Favoris', icon: Heart },
  { href: '/profil', label: 'Profil', icon: User },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-20 mt-2 border-t border-coral-soft/40 bg-white/95 backdrop-blur">
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
