'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, History } from 'lucide-react';
import { NutritionProfileForm } from './NutritionProfileForm';
import { WeightHistoryPanel } from './WeightHistoryPanel';

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
  profileComplete: boolean;
};

/**
 * Pop-up modale "Mes infos" imbriquée par-dessus la sheet calorie.
 * - z-index > sheet
 * - Backdrop semi-opaque MAIS CLIC DEHORS NE FERME PAS (decision UX
 *   Didier : on n'autorise la fermeture qu'avec le bouton X explicite
 *   pour ne pas perdre les modifs profil par erreur).
 * - Lock scroll body (déjà appliqué par la sheet parent, mais on
 *   double pour sécurité).
 */
export function MyInfoModal({
  open,
  onClose,
  onSaved,
  onError,
  profileComplete,
}: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 print:hidden md:items-center md:justify-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Mes objectifs"
    >
      <div className="anim-slide-up flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:h-auto md:max-h-[700px] md:rounded-3xl">
        <header className="flex items-center justify-between border-b border-coral-soft/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-coral-dark">
              {profileComplete && (
                <Check className="size-4 text-emerald-600" strokeWidth={3} />
              )}
              Mes objectifs
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-full p-1.5 hover:bg-coral-soft/30"
          >
            <X className="size-5 text-ink-soft" />
          </button>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto p-4"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(226, 120, 141, 0.5) transparent',
            overscrollBehavior: 'contain',
          }}
        >
          <p className="mb-3 text-xs text-ink-soft">
            Ces informations permettent de calculer tes besoins
            journaliers (calories, protéines, lipides, glucides) selon
            la formule Mifflin-St Jeor.
          </p>

          {/* Lien rapide vers l'historique des pesées — utile dans le
              contexte "Mes repas" pour consulter la trajectoire sans
              fermer cette modale. */}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="mb-4 flex w-full items-center justify-between gap-2 rounded-xl bg-coral-soft/30 px-3 py-2.5 text-sm font-semibold text-coral-dark transition hover:bg-coral-soft/50"
          >
            <span className="flex items-center gap-2">
              <History className="size-4" />
              Historique des pesées
            </span>
            <span aria-hidden className="text-coral-dark/60">
              →
            </span>
          </button>

          <NutritionProfileForm
            onSaved={() => {
              onSaved();
              onClose();
            }}
            onError={onError}
          />
        </div>
      </div>

      <WeightHistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>,
    document.body,
  );
}
