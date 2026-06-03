'use client';

import { useState } from 'react';
import { Flame, Check, Loader2 } from 'lucide-react';

type Source = 'recipe' | 'menu' | 'free';

type Props = {
  source: Source;
  sourceRefId?: string | null;
  label: string;
  kcal: number | null;
  proteinsG?: number | null;
  lipidsG?: number | null;
  carbsG?: number | null;
  className?: string;
  /** Petit (icône seule) ou normal (icône + texte). */
  compact?: boolean;
};

/**
 * Bouton "+kcal" à coller sur les fiches recettes, menus, plats.
 *
 * Click → POST /api/nutrition/log (1 entrée, 1 portion).
 *   - Confirmé : icône check 1.5s puis revient à la flamme.
 *   - Si pas de kcal connues : désactivé.
 *   - Dispatch 'nutrition-log-updated' pour rafraîchir le FAB.
 */
export function AddCaloriesButton({
  source,
  sourceRefId,
  label,
  kcal,
  proteinsG,
  lipidsG,
  carbsG,
  className,
  compact,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const disabled = kcal === null || !Number.isFinite(kcal) || busy;

  async function handleClick() {
    if (disabled || kcal === null) return;
    setBusy(true);
    try {
      const res = await fetch('/api/nutrition/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [
            {
              source,
              sourceRefId: sourceRefId ?? null,
              label,
              kcal,
              proteinsG: proteinsG ?? null,
              lipidsG: lipidsG ?? null,
              carbsG: carbsG ?? null,
              portions: 1,
            },
          ],
        }),
      });
      if (res.ok) {
        setDone(true);
        window.dispatchEvent(new CustomEvent('nutrition-log-updated'));
        setTimeout(() => setDone(false), 1500);
      }
    } finally {
      setBusy(false);
    }
  }

  const base =
    'inline-flex items-center gap-1 rounded-full border border-coral/30 bg-white text-coral transition-colors hover:bg-coral hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-coral';
  const sizing = compact ? 'px-1.5 py-1 text-xs' : 'px-2.5 py-1 text-xs font-semibold';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={kcal !== null ? `Ajouter ${kcal} kcal au compteur` : 'Calories inconnues'}
      title={
        kcal === null
          ? 'Calories inconnues'
          : done
            ? 'Ajouté !'
            : `+${Math.round(kcal)} kcal au compteur`
      }
      className={`${base} ${sizing} ${className ?? ''}`}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : done ? (
        <Check className="size-3.5" />
      ) : (
        <Flame className="size-3.5" />
      )}
      {!compact && (
        <span>{done ? 'Ajouté' : kcal !== null ? `+${Math.round(kcal)} kcal` : 'kcal ?'}</span>
      )}
    </button>
  );
}
