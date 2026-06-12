'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Wrapper standard pour les modales du projet Karine.
 *
 * RÈGLE PROJET ⛔ : la fermeture au clic backdrop est INTERDITE.
 *   Karine peut être en train de saisir un avis, un poids, un objectif —
 *   un tap accidentel ne doit jamais détruire la saisie. Les seules
 *   manières de fermer une modale sont :
 *     1. Bouton X en haut à droite (toujours visible)
 *     2. Touche Escape
 *     3. Bouton "Annuler" / action métier (au choix de la modale)
 *
 * Implémente aussi :
 *   - Focus trap (Tab reste dans la modale, pas de leak sur le contenu derrière)
 *   - Lock body scroll (anti scroll bleeding mobile)
 *   - aria-modal + role dialog (a11y screen readers)
 *   - Portal vers document.body (z-index isolation)
 *
 * Usage minimal :
 *   <KModal open={isOpen} onClose={() => setOpen(false)} title="Mes objectifs">
 *     <p>Contenu…</p>
 *   </KModal>
 *
 * Avec footer custom (pas de wrapper auto) :
 *   <KModal open={isOpen} onClose={…} title="…" footer={<button>OK</button>}>
 *     <Form />
 *   </KModal>
 */
export function KModal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnEscape = true,
  /** Aria-label de la modale (par défaut: title). */
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnEscape?: boolean;
  ariaLabel?: string;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Escape pour fermer (sauf si désactivé).
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, closeOnEscape, onClose]);

  // Lock body scroll quand ouverte (anti scroll bleeding mobile).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Focus trap basique : mémorise le focus précédent, focus la modale
  // à l'ouverture, restaure à la fermeture. Tab keeps focus dans la modale.
  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    const el = dialogRef.current;
    if (el) {
      // Focus le premier élément focusable ou le dialog lui-même.
      const focusables = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusables[0] ?? el;
      first.focus();
    }
    function onTab(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !el) return;
      const focusables = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onTab, true);
    return () => {
      document.removeEventListener('keydown', onTab, true);
      // Restaure le focus sur l'élément précédent
      if (lastFocusedRef.current && document.contains(lastFocusedRef.current)) {
        lastFocusedRef.current.focus();
      }
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  }[size];

  // ⚠️ NOTE : le backdrop a aria-hidden + pas de onClick. C'est volontaire.
  // Si un dev tente d'ajouter onClick={onClose} ici → la PR doit être refusée.
  return createPortal(
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 md:items-center md:p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          ariaLabel ?? (typeof title === 'string' ? title : 'Boîte de dialogue')
        }
        tabIndex={-1}
        className={`relative max-h-[90vh] w-full overflow-hidden rounded-t-3xl bg-cream shadow-2xl outline-none md:rounded-3xl ${sizeClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (titre + bouton X) — sticky pour rester visible si scroll */}
        {(title || true) && (
          <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-coral-soft/30 bg-cream px-5 py-3">
            <div className="min-w-0 flex-1">
              {typeof title === 'string' ? (
                <h2 className="truncate font-script text-2xl text-coral-dark">
                  {title}
                </h2>
              ) : (
                title
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-coral-dark transition hover:bg-coral-soft/40"
            >
              <X className="size-5" />
            </button>
          </header>
        )}

        {/* Body scrollable */}
        <div className="overflow-y-auto px-5 py-4">{children}</div>

        {/* Footer sticky si fourni */}
        {footer && (
          <footer className="sticky bottom-0 border-t border-coral-soft/30 bg-cream px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
