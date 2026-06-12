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
  Info,
  Mail,
  PlayCircle,
  Shield,
  LogIn,
  LogOut,
  Flame,
  PieChart,
} from 'lucide-react';
import { RecentViewsList } from './RecentViewsList';

type Section = { href: string; label: string; icon: typeof Home };

const SECTIONS: Section[] = [
  { href: '/', label: 'Accueil', icon: Home },
  { href: '/recettes', label: 'Recettes', icon: UtensilsCrossed },
  { href: '/menus', label: 'Menus semaine', icon: NotebookText },
  { href: '/conseils', label: 'Conseils santé', icon: Leaf },
  { href: '/astuces', label: 'Astuces', icon: Sparkles },
  { href: '/favoris', label: 'Mes favoris', icon: Heart },
  { href: '/mes-repas', label: 'Mes repas', icon: Flame },
  { href: '/mes-stats', label: 'Mes stats', icon: PieChart },
  { href: '/profil', label: 'Profil', icon: User },
];

// Sections additionnelles sous Profil, séparateur visuel dans le drawer.
// Ajouté 2026-06-11 : Tutos de Karine + À propos (page éditable admin).
const SECONDARY_SECTIONS: Section[] = [
  { href: '/tutos', label: 'Tutos de Karine', icon: PlayCircle },
  { href: '/a-propos', label: 'À propos', icon: Info },
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
            {SECTIONS.map(({ href, label, icon: Icon }) => {
              // La home /app/page.tsx redirige automatiquement les admins
              // vers /admin. Quand un admin clique "Accueil" dans le burger
              // depuis /admin, sans ce bypass il resterait coincé sur /admin.
              // ?as=visitor désactive l'auto-redirect côté page.tsx → l'admin
              // voit la vraie home utilisatrice (ses propres tuiles).
              const effectiveHref =
                href === '/' && isAdmin ? '/?as=visitor' : href;
              return (
                <li key={href}>
                  <Link
                    href={effectiveHref}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-ink transition hover:bg-coral-soft/40"
                  >
                    <Icon className="h-5 w-5 text-coral" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Sections secondaires (Tutos, À propos) sous Profil avec
              séparateur visuel léger. */}
          <ul className="mt-1 flex flex-col gap-0.5 border-t border-coral-soft/30 pt-2">
            {SECONDARY_SECTIONS.map(({ href, label, icon: Icon }) => (
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

          {/* Crédit Développé par D2 + bouton ouvre formulaire contact */}
          <div className="mt-2 border-t border-coral-soft/30 pt-3">
            <ContactD2Trigger onSubmitted={() => setOpen(false)} />
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
        // Taille alignée sur TrackingPill et le bouton Profil (h-8 w-8).
        // Sinon en mode header compact le burger paraissait "trop grand"
        // par rapport aux icones droite, comme s'il changeait de forme.
        className="grid h-8 w-8 place-items-center rounded-full bg-white/50 text-ink backdrop-blur transition hover:bg-white/80"
      >
        <Menu className="h-4 w-4" strokeWidth={2} />
      </button>

      {mounted ? createPortal(drawer, document.body) : null}
    </>
  );
}

/**
 * Crédit "Développé par D2 Contact" + bouton qui ouvre une mini modal
 * de rédaction de message. À l'envoi, POST /api/contact/d2 → email vers
 * didier.chialva@gmail.com. Modal custom sans fermeture backdrop
 * (règle projet).
 */
function ContactD2Trigger({ onSubmitted }: { onSubmitted?: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/contact/d2', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, fromName: name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Envoi échoué');
      setDone(true);
      window.setTimeout(() => {
        setOpen(false);
        setMessage('');
        setName('');
        setDone(false);
        onSubmitted?.();
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-[0.7rem] text-ink-soft transition hover:bg-coral-soft/40 hover:text-coral-dark"
        title="Contacter le développeur de l'app"
      >
        <Mail className="h-3.5 w-3.5" />
        Développé par <span className="font-bold text-coral-dark">D2 Contact</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-0 md:items-center md:p-4"
        >
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl md:rounded-3xl">
            <header className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-script text-2xl text-coral-dark">
                  Contacter D2.
                </h3>
                <p className="mt-0.5 text-[0.7rem] text-ink-soft">
                  Un retour, un bug, une idée de développement d&apos;application ?
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                aria-label="Fermer"
                disabled={sending}
                className="grid h-8 w-8 place-items-center rounded-full text-ink-soft hover:bg-coral-soft/40 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ton prénom (facultatif)"
                maxLength={80}
                className="w-full rounded-full border border-coral-soft/40 bg-white px-3 py-2 text-sm focus:border-coral focus:outline-none"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ton message…"
                rows={5}
                maxLength={2000}
                className="w-full rounded-2xl border border-coral-soft/40 bg-white px-3 py-2 text-sm focus:border-coral focus:outline-none"
              />
              <p className="text-right text-[0.6rem] text-ink-soft">
                {message.length}/2000
              </p>
            </div>

            {error && (
              <p className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                {error}
              </p>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-soft ring-1 ring-coral-soft/40 hover:bg-coral-soft/30 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending || message.trim().length < 5 || done}
                className="inline-flex items-center gap-1 rounded-full bg-coral px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
              >
                <Mail className="h-3.5 w-3.5" />
                {done ? 'Envoyé !' : sending ? 'Envoi…' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
