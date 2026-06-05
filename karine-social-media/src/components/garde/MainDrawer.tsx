'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Menu,
  X,
  Home,
  UtensilsCrossed,
  Leaf,
  NotebookText,
  Sparkles,
  User,
  Heart,
  Shield,
  LogIn,
  LogOut,
  Flame,
} from 'lucide-react';
import { RecentViewsList } from './RecentViewsList';

type Section = { href: string; label: string; icon: typeof Home };

const SECTIONS: Section[] = [
  { href: '/', label: 'Accueil', icon: Home },
  { href: '/recettes', label: 'Recettes', icon: UtensilsCrossed },
  { href: '/menus', label: 'Les menus de la semaine', icon: NotebookText },
  { href: '/conseils', label: 'Conseils', icon: Leaf },
  { href: '/astuces', label: 'Astuces', icon: Sparkles },
  { href: '/favoris', label: 'Mes favoris', icon: Heart },
  { href: '/mes-repas', label: 'Mes repas', icon: Flame },
  { href: '/profil', label: 'Profil', icon: User },
];

export function MainDrawer({
  isAdmin = false,
  isAuthenticated = false,
}: {
  isAdmin?: boolean;
  isAuthenticated?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Le drawer est porté dans <body> via createPortal — sinon le `backdrop-filter`
  // des parents (ex: sticky header) crée un containing block qui tronque le
  // `position: fixed`.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock du scroll du body quand le drawer est ouvert
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Toujours rendu dans le DOM pour pouvoir animer la fermeture.
  // - Backdrop : transition opacity
  // - Drawer : transition translate-x (slide from left)
  // pointer-events-none quand fermé pour ne pas bloquer les clics sous.
  const drawer = (
    <div
      className={`fixed inset-0 z-[100] flex transition-[background-color] duration-300 ease-out ${
        open
          ? 'pointer-events-auto bg-black/40'
          : 'pointer-events-none bg-transparent'
      }`}
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Menu principal"
      aria-hidden={!open}
    >
      <nav
        className={`flex h-full w-72 max-w-[85vw] flex-col bg-blush p-4 shadow-xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <p className="font-script text-2xl text-coral">Karine Diététique</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fermer le menu"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-ink-soft transition hover:bg-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className="drawer-list flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2"
          style={{ scrollbarColor: 'var(--color-coral) transparent' }}
        >
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-ink transition hover:bg-coral-soft/40"
                >
                  <Icon className="h-5 w-5 text-coral" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="border-t border-coral-soft/40 pt-3">
            <RecentViewsList onItemClick={() => setOpen(false)} />
          </div>
        </div>
        <style>{`
          .drawer-list::-webkit-scrollbar-thumb {
            background: var(--color-coral);
          }
        `}</style>

        {/* Footer : admin space + (connexion OU déconnexion selon état). */}
        <div className="mt-3 shrink-0 space-y-1.5 border-t border-coral-soft/60 pt-3">
          {isAdmin && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl bg-coral-dark/10 px-3 py-2.5 text-sm font-bold text-coral-dark transition hover:bg-coral-dark/20"
            >
              <Shield className="h-5 w-5" />
              Espace admin
            </Link>
          )}
          {isAuthenticated ? (
            // Sign-out = POST sur /auth/signout (un GET ne suffit pas :
            // Supabase exige POST pour invalider la session).
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-soft transition hover:bg-coral-soft/40"
              >
                <LogOut className="h-5 w-5 text-coral" />
                Se déconnecter
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-soft transition hover:bg-coral-soft/40"
            >
              <LogIn className="h-5 w-5 text-coral" />
              Se connecter
            </Link>
          )}
        </div>
      </nav>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le menu"
        className="grid h-10 w-10 place-items-center rounded-full bg-white/50 text-ink backdrop-blur transition hover:bg-white/80"
      >
        <Menu className="h-6 w-6" strokeWidth={2} />
      </button>

      {mounted ? createPortal(drawer, document.body) : null}
    </>
  );
}
