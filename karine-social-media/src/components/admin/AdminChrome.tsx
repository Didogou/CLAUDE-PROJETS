'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu,
  X,
  LayoutDashboard,
  ChefHat,
  ClipboardList,
  Leaf,
  Sparkles,
  Users,
  Settings,
  LogOut,
  ExternalLink,
  MessageSquare,
  HeartHandshake,
  Lightbulb,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';

type Section = { href: string; label: string; icon: typeof LayoutDashboard };

const SECTIONS: Section[] = [
  { href: '/admin', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/admin/recettes', label: 'Recettes', icon: ChefHat },
  { href: '/admin/menus', label: 'Menus', icon: ClipboardList },
  { href: '/admin/conseils', label: 'Conseils', icon: Leaf },
  { href: '/admin/astuces', label: 'Astuces', icon: Sparkles },
  { href: '/admin/avis', label: 'Avis', icon: MessageSquare },
  { href: '/admin/idees', label: 'Idées', icon: Lightbulb },
  { href: '/admin/patientes', label: 'Patientes', icon: HeartHandshake },
  { href: '/admin/abonnes', label: 'Abonnés', icon: Users },
  { href: '/admin/permissions', label: 'Permissions', icon: Shield },
  { href: '/admin/parametres', label: 'Paramètres', icon: SlidersHorizontal },
  { href: '/admin/compte', label: 'Compte', icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(href + '/');
}

function currentTitle(pathname: string): string {
  const match = SECTIONS.find((s) => isActive(pathname, s.href));
  return match?.label ?? 'Admin';
}

export function AdminChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const [open, setOpen] = useState(false);
  const title = currentTitle(pathname);

  return (
    <div className="min-h-screen bg-admin-bg text-admin-ink">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-admin-border bg-admin-surface/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le menu"
          className="grid h-10 w-10 place-items-center rounded-full text-admin-primary-dark transition hover:bg-admin-soft/50"
        >
          <Menu className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <h1 className="truncate text-base font-bold text-admin-ink-soft">{title}</h1>
        <Link
          href="/admin/compte"
          aria-label="Mon compte"
          className="grid h-9 w-9 place-items-center rounded-full bg-admin-primary text-sm font-bold text-white shadow-sm transition hover:scale-105"
        >
          K
        </Link>
      </header>

      {/* Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-admin-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-admin-border px-4 py-4">
              <div className="leading-none">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-admin-primary">
                  Espace admin
                </p>
                <span className="font-script text-3xl text-admin-primary-dark">Karine</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer le menu"
                className="grid h-9 w-9 place-items-center rounded-full text-admin-ink-soft hover:bg-admin-soft/50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3">
              {SECTIONS.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                      active
                        ? 'bg-admin-primary text-white shadow-sm'
                        : 'text-admin-ink hover:bg-admin-soft/40'
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 ${active ? 'text-white' : 'text-admin-primary'}`}
                      strokeWidth={2.2}
                    />
                    {label}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-admin-border p-3">
              <Link
                href="/?as=visitor"
                onClick={() => setOpen(false)}
                className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-admin-ink-soft transition hover:bg-admin-soft/40"
              >
                <ExternalLink className="h-5 w-5" />
                Voir le site abonné
              </Link>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-admin-ink-soft transition hover:bg-admin-soft/40"
                >
                  <LogOut className="h-5 w-5" />
                  Déconnexion
                </button>
              </form>
            </div>
          </aside>
        </>
      )}

      {/* Contenu */}
      <main className="mx-auto w-full max-w-5xl px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
