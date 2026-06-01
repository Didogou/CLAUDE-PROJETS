'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { CheckCircle2, HeartHandshake, Lock, Sparkles, X } from 'lucide-react';

/**
 * Modal de paywall affichée quand un visiteur ou un utilisateur non-abonné
 * clique sur une tuile dont la page est restreinte par page_permissions.
 *
 * ⚠️ Cette modal est UNIQUEMENT UX. La VRAIE sécurité est dans le proxy/middleware
 * (`src/lib/supabase/middleware.ts`) qui bloque l'accès direct à l'URL si l'user
 * n'a pas le rôle requis. Cette modal évite seulement à l'utilisatrice de se
 * retrouver sur /login?reason=forbidden de manière confuse.
 */
export function LockedTileModal({
  open,
  onClose,
  tileTitle,
  isAuthenticated,
}: {
  open: boolean;
  onClose: () => void;
  tileTitle: string;
  isAuthenticated: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock scroll body + Escape
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const content = (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Contenu réservé : ${tileTitle}`}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="mb-4 flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-coral-soft/50 text-coral-dark">
            <Lock className="h-6 w-6" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-coral">
              Contenu réservé
            </p>
            <h2 className="mt-0.5 font-script text-2xl text-coral-dark">
              {tileTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-coral-soft/40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Contenu selon l'état auth */}
        {isAuthenticated ? (
          <ConnectedNoSubBlock onClose={onClose} />
        ) : (
          <VisitorBlock onClose={onClose} />
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function VisitorBlock({ onClose }: { onClose: () => void }) {
  return (
    <>
      <p className="text-sm text-ink">
        Cette section est réservée aux <span className="font-semibold">abonnées</span>{' '}
        et aux <span className="font-semibold">patientes de Karine</span>.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
          Toutes les recettes, menus et conseils
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
          Astuces diététiques et accompagnement
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
          Annulation à tout moment
        </li>
      </ul>

      <div className="mt-5 space-y-2">
        <Link
          href="/mon-plan"
          className="flex items-center justify-center gap-2 rounded-full bg-coral py-3 text-sm font-bold text-white shadow-[0_6px_18px_-8px_rgba(226,120,141,0.8)] transition hover:bg-coral-dark"
        >
          <Sparkles className="h-4 w-4" />
          Voir les abonnements
        </Link>
        <Link
          href="/login"
          className="flex items-center justify-center gap-2 rounded-full border border-coral-soft bg-white py-3 text-sm font-semibold text-coral-dark transition hover:bg-coral-soft/30"
        >
          J&apos;ai déjà un compte — Se connecter
        </Link>
        <Link
          href="/signup"
          className="flex items-center justify-center gap-2 rounded-full py-2 text-xs font-semibold text-coral transition hover:text-coral-dark hover:underline"
        >
          <HeartHandshake className="h-3.5 w-3.5" />
          Je suis patiente de Karine
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="block w-full py-2 text-center text-xs text-ink-soft hover:text-ink"
        >
          Annuler
        </button>
      </div>
    </>
  );
}

function ConnectedNoSubBlock({ onClose }: { onClose: () => void }) {
  return (
    <>
      <p className="text-sm text-ink">
        Tu es connectée, mais cette section est réservée aux{' '}
        <span className="font-semibold">abonnées</span>. Choisis un plan pour accéder
        à tout le contenu de Karine.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
          <span>
            <span className="font-semibold text-ink">Mensuel 8 €</span> — sans engagement
          </span>
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
          <span>
            <span className="font-semibold text-ink">Annuel 80 €</span> — économise
            16 €/an
          </span>
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
          Annulation à tout moment depuis ton espace
        </li>
      </ul>

      <div className="mt-5 space-y-2">
        <Link
          href="/mon-plan"
          className="flex items-center justify-center gap-2 rounded-full bg-coral py-3 text-sm font-bold text-white shadow-[0_6px_18px_-8px_rgba(226,120,141,0.8)] transition hover:bg-coral-dark"
        >
          <Sparkles className="h-4 w-4" />
          Voir les abonnements
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="block w-full py-2 text-center text-xs text-ink-soft hover:text-ink"
        >
          Annuler
        </button>
      </div>
    </>
  );
}
