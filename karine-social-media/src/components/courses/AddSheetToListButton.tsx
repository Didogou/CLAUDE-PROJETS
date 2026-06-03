'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, ShoppingCart } from 'lucide-react';

type Props = {
  sheetId: string;
  /** true si la sheet a des ingrédients structurés. Sinon bouton désactivé. */
  hasIngredients: boolean;
};

/**
 * Bouton "Ajouter à ma liste" pour UNE fiche détaillée précise.
 *
 * Au mount, GET /api/shopping-list pour vérifier si la sheet est déjà
 * dans la liste active → toggle visible.
 *
 * Non connecté → renvoie 401, on cache simplement (incentive ailleurs).
 */
export function AddSheetToListButton({ sheetId, hasIngredients }: Props) {
  const [state, setState] = useState<'loading' | 'unauth' | 'ready' | 'busy'>(
    'loading',
  );
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/shopping-list');
        if (res.status === 401) {
          if (!cancelled) setState('unauth');
          return;
        }
        if (!res.ok) throw new Error();
        const j = await res.json();
        if (cancelled) return;
        const inList =
          Array.isArray(j.list?.linkedRecipes) &&
          j.list.linkedRecipes.some(
            (r: { sheetId: string }) => r.sheetId === sheetId,
          );
        setLinked(inList);
        setState('ready');
      } catch {
        if (!cancelled) setState('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheetId]);

  async function toggle() {
    setError(null);
    setState('busy');
    try {
      const res = await fetch('/api/shopping-list/toggle-sheet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sheetId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      setLinked(
        Array.isArray(j.list?.linkedRecipes) &&
          j.list.linkedRecipes.some(
            (r: { sheetId: string }) => r.sheetId === sheetId,
          ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setState('ready');
    }
  }

  if (state === 'unauth') return null;
  if (!hasIngredients) {
    return (
      <div className="rounded-full bg-cream/60 px-4 py-2 text-center text-xs italic text-ink-soft">
        Les ingrédients de cette fiche ne sont pas encore extraits.
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={state !== 'ready'}
        className={`flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold shadow-sm transition disabled:opacity-50 ${
          linked
            ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-200'
            : 'bg-coral text-white hover:bg-coral-dark'
        }`}
      >
        {state === 'busy' || state === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : linked ? (
          <Check className="h-4 w-4" />
        ) : (
          <ShoppingCart className="h-4 w-4" />
        )}
        {linked ? 'Dans ma liste' : 'Ajouter à ma liste'}
      </button>
      {error && <p className="mt-1 text-center text-xs text-red-600">{error}</p>}
    </>
  );
}
