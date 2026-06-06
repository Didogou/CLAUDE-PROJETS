'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, History } from 'lucide-react';

type WeightEntry = {
  id: string;
  weightedAt: string;
  weightKg: number;
};

/**
 * Panel "Historique des pesées" — liste lecture seule des pesées
 * de la patiente, du plus récent au plus ancien. Ouvert depuis
 * le lien "Voir l'historique" de la modale Mes infos.
 *
 * Pour le moment c'est purement consultatif (pas de suppression,
 * pas d'édition). Si la patiente veut corriger une erreur, elle
 * doit saisir une nouvelle pesée.
 */
export function WeightHistoryPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<WeightEntry[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        // 365 jours = on récupère tout l'historique large (la table
        // n'est pas censée contenir des décennies de pesées).
        const res = await fetch('/api/nutrition/weight?days=365', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        // Tri décroissant : plus récent en premier.
        const sorted = (data.entries as WeightEntry[]).sort((a, b) =>
          b.weightedAt.localeCompare(a.weightedAt),
        );
        setEntries(sorted);
      } catch {
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="anim-fade-in fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 print:hidden md:items-center md:justify-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Historique des pesées"
    >
      <div className="anim-slide-up flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:h-auto md:max-h-[700px] md:rounded-3xl">
        <header className="flex items-center gap-2 border-b border-coral-soft/30 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Retour"
            className="grid h-9 w-9 place-items-center rounded-full bg-coral-soft/30 text-coral-dark transition hover:bg-coral-soft/50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-coral-dark">
            <History className="size-4" />
            Historique des pesées
          </span>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto p-4"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(226, 120, 141, 0.5) transparent',
            overscrollBehavior: 'contain',
          }}
        >
          {entries === null ? (
            <p className="text-center text-xs italic text-ink-soft">
              Chargement…
            </p>
          ) : entries.length === 0 ? (
            <p className="rounded-xl bg-coral-soft/15 px-4 py-6 text-center text-xs italic text-ink-soft">
              Aucune pesée enregistrée pour le moment.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((e) => {
                const d = new Date(e.weightedAt);
                const dateStr = d.toLocaleDateString('fr-FR', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                });
                return (
                  <li
                    key={e.id}
                    className="flex items-center justify-between rounded-xl bg-coral-soft/10 px-3 py-2"
                  >
                    <span className="text-sm text-ink">{dateStr}</span>
                    <span className="text-sm font-semibold text-coral-dark">
                      {e.weightKg.toFixed(1).replace('.', ',')} kg
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
