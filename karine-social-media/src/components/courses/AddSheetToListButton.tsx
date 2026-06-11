'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { MyShoppingListOverlay } from './MyShoppingListOverlay';
import { showToast } from '@/lib/toast';
import { pulseBottomNav } from '@/lib/bottom-nav-pulse';

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
  // Dernieres portions synchronisees avec le serveur. Permet de
  // detecter quand le stepper PERS a bouge ET que la recette est
  // deja liee → on doit re-sync la liste avec les nouvelles
  // quantites.
  const lastSyncedPortionsRef = useRef<number | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Si la fiche est déjà liée, on suppose que les contribs
      // actuelles correspondent aux portionsOverride courantes (ou à
      // l'absence d'override). Le watcher detectera tout changement
      // futur du stepper.
      lastSyncedPortionsRef.current = inList
        ? portionsOverride ?? null
        : null;
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
    const wasLinked = linked;
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
      const nowLinked =
        Array.isArray(j.list?.linkedRecipes) &&
        j.list.linkedRecipes.some(
          (r: { sheetId: string }) => r.sheetId === sheetId,
        );
      setLinked(nowLinked);
      // Mémorise les portions courantes pour le watcher de sync.
      lastSyncedPortionsRef.current = nowLinked
        ? portionsOverride ?? null
        : null;
      // Notifie les autres instances pour qu'elles se mettent à jour.
      window.dispatchEvent(new CustomEvent(SHOPPING_LIST_EVENT));
      // Pulse BottomNav courses + "+1" floating si on vient d'AJOUTER
      // (pas si on a retiré).
      if (nowLinked && !wasLinked) {
        pulseBottomNav('courses');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setState('ready');
    }
  }

  // Watcher : si la recette est deja liee ET que le stepper PERS a
  // bouge, on synchronise la liste avec les nouvelles quantites
  // (debounce 500ms pour eviter le spam si l user clique +1 plusieurs
  // fois rapidement).
  useEffect(() => {
    if (state !== 'ready' || !linked) return;
    if (typeof portionsOverride !== 'number' || portionsOverride <= 0) return;
    if (lastSyncedPortionsRef.current === portionsOverride) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/shopping-list/sync-sheet', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sheetId, portionsOverride }),
        });
        if (!res.ok) return;
        lastSyncedPortionsRef.current = portionsOverride;
        showToast('Ta liste de courses a été mise à jour', 'success');
        window.dispatchEvent(new CustomEvent(SHOPPING_LIST_EVENT));
      } catch {
        // silencieux : si le sync échoue, on garde l ancien état UI
      }
    }, 500);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [portionsOverride, linked, state, sheetId]);

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
      {/* Bouton icône compact. Le lien "Voir mes courses" est
          positionné en absolu sous le bouton pour ne pas décaler
          la ligne d'actions. */}
      <div className="relative">
        <button
          type="button"
          onClick={toggle}
          disabled={state !== 'ready'}
          aria-label={linked ? 'Retirer de mes courses' : 'Ajouter à mes courses'}
          className={`flex h-9 items-center gap-1 rounded-full px-2.5 text-[0.65rem] font-bold whitespace-nowrap shadow-sm transition disabled:opacity-50 ${
            linked
              ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-200'
              : 'bg-coral text-white hover:bg-coral-dark'
          }`}
        >
          {state === 'busy' || state === 'loading' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : linked ? (
            <Check className="h-3 w-3" strokeWidth={3} />
          ) : (
            <Plus className="h-3 w-3" strokeWidth={3} />
          )}
          {linked ? 'Dans mes courses' : 'Mes courses'}
        </button>
        {/* Lien discret en absolute sous le bouton — ouvre la liste
            de courses en overlay sans pousser la ligne. */}
        <button
          type="button"
          onClick={() => setOverlayOpen(true)}
          className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[0.6rem] font-semibold text-coral-dark underline-offset-2 transition hover:underline"
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
