'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
/* eslint-disable @next/next/no-img-element */
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Lock,
  Printer,
  Share2,
  ShoppingCart,
} from 'lucide-react';
import type { WeeklyMenu, ShoppingListItem } from '@/data/menus';
import { formatWeekTitle } from '@/data/menus';
import type { RecipeIngredient } from '@/data/recipes';
import { FireworkBurst } from '@/components/recettes/FireworkBurst';
import { PortionsStepper } from '@/components/recettes/PortionsStepper';
import { scaleIngredients } from '@/lib/recipe-portions';

/**
 * Page principale /menus.
 *
 * Pour CHAQUE semaine (navigation gauche/droite) :
 *  - Image cover du menu en grand, centrée, cliquable → page jour
 *  - Liste des ingrédients de TOUTE la semaine (issue de
 *    weekly_menus.shopping_list_items), groupée par catégorie
 *  - PortionsStepper qui scale les ingrédients (display) ET passe
 *    en portionsOverride au bouton "Ajouter au menu" (mes courses)
 *  - Pas de calories, pas d'éphémère "Voir la liste" séparé
 *
 * Si on navigue à une autre semaine, la liste change (state local
 * du composant suit l'index).
 *
 * Le bouton "Ajouter au menu" est réservé aux abonnés/patients/admins ;
 * les visiteurs voient un placeholder "S'abonner".
 */
export function MenusPagerView({
  menus,
  isSubscriber,
}: {
  menus: WeeklyMenu[];
  isSubscriber: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [floatingHearts, setFloatingHearts] = useState<number[]>([]);

  if (menus.length === 0) {
    return (
      <p className="rounded-[var(--radius-tile)] border border-dashed border-coral-soft/60 bg-white/40 px-4 py-10 text-center text-sm text-ink-soft">
        Pas encore de menu publié — reviens vite&nbsp;!
      </p>
    );
  }

  const current = menus[idx];
  const isFirst = idx === menus.length - 1; // semaine la plus ancienne
  const isLast = idx === 0; // semaine la plus récente

  // Portions de référence pour la liste (réglée au moment de
  // l'extraction par Karine — fallback 4 si null).
  const basePortions = current.shoppingListPortions ?? 4;

  function navWeek(direction: -1 | 1) {
    setIdx((i) => {
      const next = i + direction;
      if (next < 0 || next >= menus.length) return i;
      return next;
    });
  }

  function toggleLike() {
    const heartId = Date.now() + Math.random();
    setFloatingHearts((arr) => [...arr, heartId]);
    setTimeout(() => setFloatingHearts((arr) => arr.filter((x) => x !== heartId)), 1100);
    if (liked) {
      setLiked(false);
      setLikes((n) => Math.max(0, n - 1));
    } else {
      setLiked(true);
      setLikes((n) => n + 1);
    }
  }

  async function handleShare() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const title = current.title || formatWeekTitle(current.weekStart);
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* annulé */
    }
  }

  return (
    <>
      {/* ============== VUE IMPRESSION : cover + liste image ============== */}
      <div className="hidden print:block">
        <div className="print-page">
          <img src={current.coverImageUrl} alt="Menu de la semaine" />
        </div>
        {current.shoppingListImageUrl && (
          <div className="print-page print-page-last">
            <img src={current.shoppingListImageUrl} alt="Liste de courses" />
          </div>
        )}
      </div>

      {/* ============== VUE ÉCRAN ============== */}
      <div className="space-y-5 print:hidden">
        {/* Navigation semaine */}
        <div className="flex items-center justify-between gap-2 rounded-full bg-white/85 px-2 py-1 shadow-sm">
          <button
            type="button"
            onClick={() => navWeek(1)}
            disabled={isFirst}
            aria-label="Semaine précédente"
            className="grid h-7 w-7 place-items-center rounded-full bg-coral-soft/60 text-coral-dark transition hover:bg-coral-soft disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="min-w-0 truncate text-center text-xs font-bold text-coral-dark">
            {current.title || formatWeekTitle(current.weekStart)}
          </p>
          <button
            type="button"
            onClick={() => navWeek(-1)}
            disabled={isLast}
            aria-label="Semaine suivante"
            className="grid h-7 w-7 place-items-center rounded-full bg-coral-soft/60 text-coral-dark transition hover:bg-coral-soft disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Image cover du menu — centrée, agrandie, cliquable.
            Click → ouvre la page jour (comportement déjà attendu). */}
        <div className="relative mx-auto w-full max-w-md">
          <FireworkBurst category="plat" count={8} />
          <Link
            href={`/menus/${current.id}/jour`}
            aria-label="Voir le détail du jour"
            className="group relative block overflow-hidden rounded-[var(--radius-card)] shadow-lg ring-1 ring-white transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <img
              src={current.coverImageUrl}
              alt={current.title || 'Menu de la semaine'}
              className="block w-full object-contain"
            />
          </Link>
          <p className="mt-2 text-center font-script text-base text-coral">
            Menu de la semaine
          </p>
        </div>

        {/* Bouton "Ajouter au menu" + PortionsStepper, comme pour les
            fiches recettes. Seul l'abonné/patient/admin peut ajouter.
            Le `key` force le remount au change de semaine pour reset
            le PortionsStepper sur la nouvelle valeur basePortions. */}
        {isSubscriber ? (
          <MenuShoppingActions
            key={current.id}
            menuId={current.id}
            hasItems={
              Array.isArray(current.shoppingListItems) &&
              current.shoppingListItems.length > 0
            }
            basePortions={basePortions}
            items={current.shoppingListItems ?? []}
          />
        ) : (
          <UpsellBlock />
        )}

        <p className="text-center text-xs italic text-ink-soft">
          Tapez sur le menu pour voir le détail du jour
        </p>

        {/* Barre d'actions générales (share / like / print) */}
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleShare}
            aria-label="Partager"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 hover:bg-coral-soft/40"
          >
            <Share2 className="h-4 w-4" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={toggleLike}
              aria-pressed={liked}
              aria-label={liked ? 'Je n’aime plus' : 'J’aime'}
              className="flex items-center gap-1 rounded-full bg-white py-0.5 pl-0.5 pr-2.5 shadow-sm transition hover:scale-105"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full">
                <Heart
                  className={`h-4 w-4 ${liked ? 'fill-coral text-coral' : 'text-coral'}`}
                  strokeWidth={2}
                />
              </span>
              <span className="text-xs font-semibold text-coral-dark">{likes}</span>
            </button>
            {floatingHearts.map((id) => (
              <img
                key={id}
                src="/images/effects/coeur.webp"
                alt=""
                aria-hidden
                draggable={false}
                className="floating-heart pointer-events-none absolute left-2 top-0 h-7 w-auto select-none"
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            aria-label="Imprimer"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 hover:bg-coral-soft/40"
          >
            <Printer className="h-4 w-4" />
          </button>
        </div>

        <style>{`
          @keyframes float-heart {
            0%   { transform: translate(-50%, 10px) scale(0.5); opacity: 0; }
            15%  { transform: translate(-50%, -6px) scale(1.25); opacity: 1; }
            80%  { opacity: 1; }
            100% { transform: translate(-50%, -90px) scale(0.95); opacity: 0; }
          }
          .floating-heart {
            animation: float-heart 1.1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
            will-change: transform, opacity;
          }
          @media (prefers-reduced-motion: reduce) {
            .floating-heart { animation: none; opacity: 0; }
          }
          @media print {
            @page { margin: 0.5cm; size: auto; }
            html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
            .print-page {
              width: 100vw;
              height: 100vh;
              margin: 0;
              padding: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              page-break-after: always;
              break-after: page;
              overflow: hidden;
            }
            .print-page-last {
              page-break-after: auto;
              break-after: auto;
            }
            .print-page img {
              width: 100%;
              height: 100%;
              object-fit: contain;
              display: block;
            }
          }
        `}</style>
      </div>
    </>
  );
}

// ============================================================
// Bandeau abonnement (visiteur non-abonné)
// ============================================================

function UpsellBlock() {
  return (
    <div className="rounded-2xl bg-white/85 p-5 text-center shadow-sm backdrop-blur-sm">
      <Lock className="mx-auto h-6 w-6 text-coral" />
      <p className="mt-2 text-sm text-ink-soft">
        La liste de courses interactive de la semaine est réservée aux
        abonnées.
      </p>
      <Link
        href="/mon-plan"
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-coral-dark"
      >
        S&apos;abonner
      </Link>
    </div>
  );
}

// ============================================================
// MenuShoppingActions : PortionsStepper + bouton "Ajouter au menu"
// + liste des ingrédients groupés et scalés.
// ============================================================

function MenuShoppingActions({
  menuId,
  hasItems,
  basePortions,
  items,
}: {
  menuId: string;
  hasItems: boolean;
  basePortions: number;
  items: ShoppingListItem[];
}) {
  // customPortions est local au menu courant : si on navigue à un
  // autre menu, l'effet de remount (key sur le parent) le réinitialise.
  const [customPortions, setCustomPortions] = useState<number>(basePortions);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  async function addAll() {
    if (busy || !hasItems) return;
    setBusy(true);
    try {
      const res = await fetch('/api/shopping-list/toggle-menu', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          menuId,
          portionsOverride: customPortions,
        }),
      });
      if (!res.ok) throw new Error();
      setAdded(true);
      window.dispatchEvent(new CustomEvent('shopping-list-updated'));
      window.setTimeout(() => setAdded(false), 2200);
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-center gap-2">
        <PortionsStepper
          value={customPortions}
          onChange={setCustomPortions}
        />
        <button
          type="button"
          onClick={addAll}
          disabled={busy || !hasItems}
          className="flex items-center gap-1.5 rounded-full bg-coral px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-40"
        >
          <ShoppingCart className="h-4 w-4" />
          {added ? '✓ Ajouté à mes courses' : 'Ajouter le menu à mes courses'}
        </button>
      </div>

      {hasItems && (
        <IngredientsList
          ingredients={items.map((it) => ({
            category: it.category,
            label: it.label,
            quantity: it.quantity,
            unit: it.unit,
            note: it.note ?? null,
          }))}
          basePortions={basePortions}
          customPortions={customPortions}
        />
      )}
    </div>
  );
}

// ============================================================
// IngredientsList : liste groupée par catégorie, scalée selon
// customPortions. Repris du même rendu que SheetCarousel et
// MenuDayMealsCarousel pour cohérence visuelle.
// ============================================================

function IngredientsList({
  ingredients,
  basePortions,
  customPortions,
}: {
  ingredients: RecipeIngredient[];
  basePortions: number;
  customPortions: number;
}) {
  const factor =
    basePortions > 0 && customPortions > 0 ? customPortions / basePortions : 1;
  const grouped = useMemo(() => {
    const scaled = scaleIngredients(ingredients, factor);
    const map = new Map<string, RecipeIngredient[]>();
    for (const it of scaled) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return [...map.entries()];
  }, [ingredients, factor]);

  return (
    <div className="mx-auto max-w-2xl space-y-2 rounded-2xl bg-white/70 p-4 shadow-sm backdrop-blur-sm">
      <h4 className="text-center font-script text-2xl text-coral">
        Ingrédients de la semaine
      </h4>
      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
            {cat}
          </p>
          <ul className="text-sm text-ink">
            {items.map((it, idx) => (
              <li key={idx}>• {formatIngredient(it)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function formatIngredient(it: RecipeIngredient): string {
  if (it.quantity == null) return capitalize(it.label);
  if (it.unit) {
    if (/^(boule|sachet|tranche|gousse)/i.test(it.unit)) {
      return `${it.quantity} ${it.unit}${it.quantity > 1 ? 's' : ''} de ${it.label}`;
    }
    return `${it.quantity} ${it.unit} de ${it.label}`;
  }
  return `${it.quantity} ${it.label}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Préservé pour compat éventuelle d'autres callers (non utilisé ici).
export type { ShoppingListItem };
