'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { MyShoppingListOverlay } from './MyShoppingListOverlay';

type Props = {
  sheetId: string;
  /** true si la sheet a des ingrédients structurés. Sinon bouton désactivé. */
  hasIngredients: boolean;
  /** Si défini, override le nb de personnes du foyer (household_size) au
   *  moment du toggle. Permet à l'utilisatrice d'adapter la liste à un
   *  invité ou un évènement. */
  portionsOverride?: number;
};

/**
 * Bouton "Ajouter à ma liste" pour UNE fiche détaillée précise.
 *
 * Au mount, GET /api/shopping-list pour vérifier si la sheet est déjà
 * dans la liste active → toggle visible.
 *
 * Non connecté → renvoie 401, on cache simplement (incentive ailleurs).
 */
/**
 * Nom de l'event dispatché sur `window` à chaque modification de la
 * liste de courses (toggle, ajout, suppression). Permet aux autres
 * instances de AddSheetToListButton (et tout consumer intéressé) de
 * se synchroniser en re-fetchant la liste.
 */
const SHOPPING_LIST_EVENT = 'shopping-list-updated';

export function AddSheetToListButton({
  sheetId,
  hasIngredients,
  portionsOverride,
}: Props) {
  const [state, setState] = useState<'loading' | 'unauth' | 'ready' | 'busy'>(
    'loading',
  );
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  // Hydrate l'état linked depuis la liste courante.
  async function hydrate(signal?: { cancelled: boolean }) {
    try {
      const res = await fetch('/api/shopping-list');
      if (res.status === 401) {
        if (!signal?.cancelled) setState('unauth');
        return;
      }
      if (!res.ok) throw new Error();
      const j = await res.json();
      if (signal?.cancelled) return;
      const inList =
        Array.isArray(j.list?.linkedRecipes) &&
        j.list.linkedRecipes.some(
          (r: { sheetId: string }) => r.sheetId === sheetId,
        );
      setLinked(inList);
      setState('ready');
    } catch {
      if (!signal?.cancelled) setState('ready');
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    hydrate(signal);
    // Sync entre instances : si UNE instance modifie la liste (ex: la
    // copie dans la lightbox), les AUTRES copies re-fetchent leur état.
    const onUpdate = () => hydrate();
    window.addEventListener(SHOPPING_LIST_EVENT, onUpdate);
    return () => {
      signal.cancelled = true;
      window.removeEventListener(SHOPPING_LIST_EVENT, onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  async function toggle() {
    setError(null);
    setState('busy');
    try {
      const res = await fetch('/api/shopping-list/toggle-sheet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sheetId,
          portionsOverride:
            typeof portionsOverride === 'number' && portionsOverride > 0
              ? portionsOverride
              : undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      setLinked(
        Array.isArray(j.list?.linkedRecipes) &&
          j.list.linkedRecipes.some(
            (r: { sheetId: string }) => r.sheetId === sheetId,
          ),
      );
      // Notifie les autres instances pour qu'elles se mettent à jour.
      window.dispatchEvent(new CustomEvent(SHOPPING_LIST_EVENT));
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
      {/* Bouton compact + lien Voir mes courses en dessous.
          Hauteur du bouton alignée avec ActionIconButton (h-9). */}
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={toggle}
          disabled={state !== 'ready'}
          className={`flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-bold shadow-sm transition disabled:opacity-50 ${
            linked
              ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-200'
              : 'bg-coral text-white hover:bg-coral-dark'
          }`}
        >
          {state === 'busy' || state === 'loading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : linked ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Plus className="h-3.5 w-3.5" strokeWidth={3} />
          )}
          {linked ? 'Dans mes courses' : 'Mes courses'}
        </button>
        {/* Lien discret sous le bouton : ouvre la liste de courses
            en overlay (consultation rapide sans quitter la page). */}
        <button
          type="button"
          onClick={() => setOverlayOpen(true)}
          className="text-[0.65rem] font-semibold text-coral-dark underline-offset-2 transition hover:underline"
        >
          Voir mes courses →
        </button>
      </div>
      {error && <p className="mt-1 text-center text-xs text-red-600">{error}</p>}
      {overlayOpen && (
        <MyShoppingListOverlay onClose={() => setOverlayOpen(false)} />
      )}
    </>
  );
}
