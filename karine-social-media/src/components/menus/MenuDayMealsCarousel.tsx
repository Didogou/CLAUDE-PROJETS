'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Ban,
  Bookmark,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Heart,
  Lock,
  Printer,
  Share2,
  ShoppingCart,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import type { MenuMealSheet } from '@/data/menus';
import type { RecipeIngredient } from '@/data/recipes';
import { DAYS_LABELS, formatWeekTitle } from '@/data/menus';
import { AddCaloriesButton } from '@/components/nutrition/AddCaloriesButton';
import { PortionsStepper } from '@/components/recettes/PortionsStepper';
import { scaleIngredients } from '@/lib/recipe-portions';
import { pulseBottomNav } from '@/lib/bottom-nav-pulse';
import { computeSheetDietaryTags } from '@/lib/dietary-tags';
import { RecipeNutriScorePanel } from '@/components/recettes/RecipeNutriScorePanel';
import type { CiqualFoodLite } from '@/lib/nutriscore-aggregate';

type Props = {
  menuTitle: string | null;
  weekStart: string;
  defaultDayIndex: number;
  mealSheetsByDay: Record<
    number,
    { lunch: MenuMealSheet | null; dinner: MenuMealSheet | null }
  >;
  isSubscriber: boolean;
  isAuthenticated: boolean;
  /** Ids de menu_meal_sheets déjà favorisées par l'utilisatrice.
   *  Pré-chargé server-side pour pré-cocher les bookmark icons. */
  favoritedMealSheetIds?: string[];
  /** Nutri-Score : liens Ciqual + poids de portion de toutes les fiches
   *  repas du menu (réutilise les composants recette). */
  ciqualByIdEntries?: Array<[number, CiqualFoodLite]>;
  portionWeightEntries?: Array<[string, number]>;
};

/**
 * Carousel des fiches recettes (lunch + dinner) du jour courant d'un
 * menu hebdomadaire.
 *
 * UX (Karine 2026-06-04) :
 *  - Navigation jour-par-jour via chevrons gauche/droite (cyclique).
 *  - 2 fiches affichées en flux (lunch puis dinner) — chaque MealCard
 *    a son propre PortionsStepper + "Mes courses" + +kcal + Share +
 *    Print + liste d'ingrédients scalée.
 *  - Plus de bandeau "Ajouter tout à mes courses" / "Voir la liste"
 *    en haut : ces actions se font depuis la page main /menus avec
 *    le PortionsStepper global.
 *
 * Accès :
 *  - Abonné : tout le carousel + boutons d'action.
 *  - Visiteur : message d'incitation à s'abonner.
 */
export function MenuDayMealsCarousel({
  menuTitle,
  weekStart,
  defaultDayIndex,
  mealSheetsByDay,
  isSubscriber,
  isAuthenticated,
  favoritedMealSheetIds = [],
  ciqualByIdEntries = [],
  portionWeightEntries = [],
}: Props) {
  const favSet = useMemo(
    () => new Set(favoritedMealSheetIds),
    [favoritedMealSheetIds],
  );
  const router = useRouter();
  const [dayIndex, setDayIndex] = useState(defaultDayIndex);
  const [toast] = useState<string | null>(null);

  const day = mealSheetsByDay[dayIndex] ?? { lunch: null, dinner: null };
  const meals = useMemo(
    () => [
      { kind: 'lunch' as const, label: 'Déjeuner', sheet: day.lunch },
      { kind: 'dinner' as const, label: 'Dîner', sheet: day.dinner },
    ],
    [day.lunch, day.dinner],
  );

  function nav(direction: -1 | 1) {
    setDayIndex((i) => (i + direction + 7) % 7);
  }

  // === Visiteur non abonné ===
  if (!isSubscriber) {
    return (
      <section className="rounded-2xl bg-white/85 p-6 text-center shadow-sm backdrop-blur-sm">
        <Lock className="mx-auto h-8 w-8 text-coral" />
        <h2 className="mt-2 font-script text-2xl text-coral">
          Réservé aux abonnées
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Découvre les fiches recettes complètes du menu (déjeuner +
          dîner pour chaque jour) avec ingrédients et liste de courses
          interactive.
        </p>
        <Link
          href="/mon-plan"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-coral-dark"
        >
          S&apos;abonner
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {/* Décision Karine 2026-06-04 : on retire le bandeau "Ajouter
          tout à mes courses" + "Voir la liste". L'ajout massif est
          désormais accessible depuis la page main /menus avec le
          PortionsStepper. Ici on se concentre sur le jour. */}

      {toast && (
        <div className="rounded-full bg-coral-soft/40 px-3 py-1.5 text-center text-xs font-semibold text-coral-dark">
          {toast}
        </div>
      )}

      {/* Navigation jour */}
      <div className="flex items-center justify-between gap-2 rounded-full bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur-sm">
        <button
          type="button"
          onClick={() => nav(-1)}
          aria-label="Jour précédent"
          className="grid h-8 w-8 place-items-center rounded-full bg-coral-soft/40 text-coral transition hover:scale-110 hover:bg-coral-soft"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
            {DAYS_LABELS[dayIndex]}
          </p>
          <p className="text-[0.7rem] text-ink-soft">
            {menuTitle || formatWeekTitle(weekStart)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => nav(1)}
          aria-label="Jour suivant"
          className="grid h-8 w-8 place-items-center rounded-full bg-coral-soft/40 text-coral transition hover:scale-110 hover:bg-coral-soft"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 2 fiches du jour (lunch + dinner) */}
      <div className="space-y-3">
        {meals.map(({ kind, label, sheet }) => (
          <MealCard
            key={kind}
            label={label}
            sheet={sheet}
            isAuthenticated={isAuthenticated}
            initialFavorited={sheet ? favSet.has(sheet.id) : false}
            ciqualByIdEntries={ciqualByIdEntries}
            portionWeightEntries={portionWeightEntries}
            onAuthRequired={() =>
              router.push(
                `/login?next=${encodeURIComponent(window.location.pathname)}`,
              )
            }
          />
        ))}
      </div>

    </section>
  );
}

// ============================================================
// MealCard : une fiche repas (lunch ou dinner)
//
// Layout aligné sur SheetCarousel (recette détail) :
//  - Image centrée, object-contain pour rester ENTIÈRE sur PC
//  - Click image → lightbox plein écran
//  - Titre
//  - Bandeau d'actions : PortionsStepper | Mes courses | +kcal | Share | Print
//  - Liste d'ingrédients groupés par catégorie, scalés selon
//    customPortions (défaut = servings de la fiche)
//  - Tags en chips
//
// Pas de stats kcal/prep/cuis dans cet écran (décision Karine).
// Le compteur kcal reste accessible via AddCaloriesButton.
// ============================================================

function MealCard({
  label,
  sheet,
  isAuthenticated,
  initialFavorited = false,
  ciqualByIdEntries = [],
  portionWeightEntries = [],
  onAuthRequired,
}: {
  label: string;
  sheet: MenuMealSheet | null;
  isAuthenticated: boolean;
  initialFavorited?: boolean;
  ciqualByIdEntries?: Array<[number, CiqualFoodLite]>;
  portionWeightEntries?: Array<[string, number]>;
  onAuthRequired?: () => void;
}) {
  // Hooks d'abord (avant le early return null) — règle React.
  const [customPortions, setCustomPortions] = useState<number>(
    sheet?.servings ?? 4,
  );
  const [zoomOpen, setZoomOpen] = useState(false);
  const [favorited, setFavorited] = useState(initialFavorited);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  // Lazy init pour lire localStorage SYNCHRONE au mount : si l'user
  // a déjà liké et que le compteur DB est désynchronisé (ex. migration
  // likes_count pas encore appliquée), on floor à 1 pour refléter
  // l'action utilisatrice. Sinon on prend la valeur DB.
  const [likes, setLikes] = useState(() => {
    const base = sheet?.likesCount ?? 0;
    if (typeof window === 'undefined' || !sheet) return base;
    try {
      const raw = localStorage.getItem('karine.liked-meals.v1');
      const liked = raw
        ? new Set(JSON.parse(raw) as string[]).has(sheet.id)
        : false;
      return liked ? Math.max(base, 1) : base;
    } catch {
      return base;
    }
  });
  const [hasLiked, setHasLiked] = useState(() => {
    if (typeof window === 'undefined' || !sheet) return false;
    try {
      const raw = localStorage.getItem('karine.liked-meals.v1');
      return raw
        ? new Set(JSON.parse(raw) as string[]).has(sheet.id)
        : false;
    } catch {
      return false;
    }
  });
  // Sync `favorited` avec la prop `initialFavorited` : la page parente
  // recharge les favoris à chaque visite (force-dynamic), et MealCard
  // peut être remountée avec une prop différente (changement de jour
  // ou retour depuis /favoris). useState n'est pris qu'au mount donc
  // sans ce useEffect le bookmark reste vide visuellement.
  useEffect(() => {
    setFavorited(initialFavorited);
  }, [initialFavorited]);
  // Sync `likes` ET `hasLiked` quand la sheet change (= changement de
  // jour). Resynchronise depuis DB + localStorage pour rester cohérent.
  useEffect(() => {
    if (!sheet) return;
    const base = sheet.likesCount ?? 0;
    try {
      const raw = localStorage.getItem('karine.liked-meals.v1');
      const liked = raw
        ? new Set(JSON.parse(raw) as string[]).has(sheet.id)
        : false;
      setHasLiked(liked);
      setLikes(liked ? Math.max(base, 1) : base);
    } catch {
      setHasLiked(false);
      setLikes(base);
    }
  }, [sheet?.id, sheet?.likesCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si servings change (refresh / autre sheet), on resync.
  useEffect(() => {
    if (sheet) setCustomPortions(sheet.servings);
  }, [sheet]);

  if (!sheet) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-coral-soft/40 bg-white/40 px-4 py-6 text-center">
        <p className="text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
          {label}
        </p>
        <p className="mt-1 text-xs italic text-ink-soft">
          Pas encore de fiche pour ce repas.
        </p>
      </div>
    );
  }

  async function toggleFavorite(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!sheet || favoriteBusy) return;
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    const wasFav = favorited;
    setFavorited(!wasFav);
    setFavoriteBusy(true);
    try {
      if (wasFav) {
        const res = await fetch(
          `/api/favorites?targetType=meal_sheet&targetId=${encodeURIComponent(sheet.id)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType: 'meal_sheet', targetId: sheet.id }),
        });
        if (!res.ok) throw new Error();
      }
    } catch {
      setFavorited(wasFav);
    } finally {
      setFavoriteBusy(false);
    }
  }

  async function handleLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!sheet) return;
    const wasLiked = hasLiked;
    // Optimistic toggle
    setLikes((n) => (wasLiked ? Math.max(0, n - 1) : n + 1));
    setHasLiked(!wasLiked);
    // Sync localStorage anti-spam : add ou remove selon état.
    try {
      const raw = localStorage.getItem('karine.liked-meals.v1');
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      const idx = arr.indexOf(sheet.id);
      if (wasLiked) {
        if (idx >= 0) arr.splice(idx, 1);
      } else {
        if (idx < 0) arr.push(sheet.id);
      }
      localStorage.setItem('karine.liked-meals.v1', JSON.stringify(arr));
    } catch {
      /* localStorage indispo */
    }
    try {
      const res = await fetch(`/api/meals/${sheet.id}/like`, {
        method: wasLiked ? 'DELETE' : 'POST',
      });
      if (!res.ok) throw new Error();
    } catch {
      // Pas de rollback visible : si l'API échoue (ex. migration
      // likes_count pas encore appliquée), on garde l'optimistic UI.
      console.warn('[meal-like] API failed (migration manquante ?)');
    }
  }

  async function handleShare() {
    if (!sheet) return;
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const title = sheet.title || `${label} — menu`;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* user annulé */
    }
  }

  return (
    <article className="space-y-4 rounded-2xl bg-white/85 p-4 shadow-sm backdrop-blur-sm lg:p-6">
      <header className="flex items-center justify-center">
        <span className="rounded-full bg-coral-soft/40 px-3 py-1 text-xs font-bold uppercase tracking-wider text-coral-dark">
          {label}
        </span>
      </header>

      {/* Badges diététiques au-dessus de l'image (Sans Glu, Sans porc,
          Végé). Calculés depuis les ingrédients via computeSheetDietaryTags
          (mêmes règles que pour les fiches recettes). */}
      {sheet.coverImageUrl && (() => {
        // ShoppingListItem ≈ RecipeIngredient (mêmes champs) sauf que
        // `note` est `string | null | undefined`. Normalise pour TS.
        const ingredientsForDietary = sheet.ingredients.map((it) => ({
          category: it.category,
          label: it.label,
          quantity: it.quantity,
          unit: it.unit,
          note: it.note ?? null,
        }));
        const dietary = computeSheetDietaryTags(
          ingredientsForDietary,
          sheet.isVegetarianOverride,
          sheet.isGlutenFreeOverride,
          sheet.isPorkFreeOverride,
        );
        if (
          !dietary.isVegetarian &&
          !dietary.isGlutenFree &&
          !dietary.isPorkFree
        )
          return null;
        return (
          <div className="mx-auto flex w-full max-w-md flex-nowrap justify-center gap-1 overflow-hidden">
            {dietary.isVegetarian && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-1 py-0.5 text-[0.5rem] font-bold uppercase tracking-tight text-emerald-700 ring-1 ring-emerald-300"
                title="Sans viande, poisson ni œufs"
              >
                <span
                  aria-hidden
                  className="block size-2 shrink-0 rounded-full bg-emerald-600"
                />
                Végé
              </span>
            )}
            {dietary.isGlutenFree && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1 py-0.5 text-[0.5rem] font-bold uppercase tracking-tight text-amber-700 ring-1 ring-amber-300"
                title="Sans gluten"
              >
                <Ban className="size-2 shrink-0" strokeWidth={2.5} />
                Sans Glu
              </span>
            )}
            {dietary.isPorkFree && !dietary.isVegetarian && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sky-100 px-1 py-0.5 text-[0.5rem] font-bold uppercase tracking-tight text-sky-700 ring-1 ring-sky-300"
                title="Sans porc"
              >
                <Ban className="size-2 shrink-0" strokeWidth={2.5} />
                Sans porc
              </span>
            )}
          </div>
        );
      })()}

      {/* Bouton « Commencer la recette » AU-DESSUS de l'image, identique
          aux fiches recettes (SheetCarousel) → page cuisine guidée du repas.
          Halo qui pulse pour attirer l'œil (cf. .cook-start-pulse global). */}
      <Link
        href={`/menus/${sheet.menuId}/cuisiner/${sheet.id}`}
        className="cook-start-pulse mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-coral-soft px-6 py-3 text-base font-bold text-coral-dark shadow-sm transition hover:bg-coral-soft/80 active:scale-[0.98]"
      >
        <ChefHat className="h-5 w-5" />
        Commencer la recette
      </Link>

      {/* Image entière (object-contain) centrée. Hauteur cappée pour
          rester visible d'un coup sur PC sans scroll. Click → zoom.
          Wrappée dans un div relative pour placer Bookmark (haut gauche)
          et Heart (haut droite) en absolute. */}
      {sheet.coverImageUrl && (
        <div className="relative mx-auto w-full max-w-md">
          <button
            type="button"
            onClick={() => setZoomOpen(true)}
            aria-label="Agrandir la fiche"
            className="group block w-full cursor-zoom-in"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sheet.coverImageUrl}
              alt={sheet.title ?? ''}
              className="mx-auto block max-h-[70vh] w-auto max-w-full rounded-2xl object-contain shadow-md transition group-hover:-translate-y-0.5 group-hover:shadow-lg"
            />
          </button>
          {/* Bookmark = favori privé (haut gauche). */}
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={favoriteBusy}
            aria-label={
              favorited ? 'Retirer des favoris' : 'Ajouter aux favoris'
            }
            aria-pressed={favorited}
            className="absolute left-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-md transition hover:scale-110 disabled:opacity-50"
          >
            <Bookmark
              className={
                favorited
                  ? 'h-4 w-4 fill-coral text-coral'
                  : 'h-4 w-4 text-coral'
              }
              strokeWidth={2}
            />
          </button>
          {/* Heart = like public (haut droite) avec compteur.
              Toggle : tap pour liker, re-tap pour retirer le like. */}
          <button
            type="button"
            onClick={handleLike}
            aria-label={hasLiked ? `Retirer mon j'aime (${likes})` : "J'aime"}
            aria-pressed={hasLiked}
            className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1.5 shadow-md transition hover:scale-110"
          >
            <Heart
              className={
                hasLiked
                  ? 'h-4 w-4 fill-coral text-coral'
                  : 'h-4 w-4 text-coral'
              }
              strokeWidth={2}
            />
            <span className="text-xs font-bold text-coral-dark">{likes}</span>
          </button>
        </div>
      )}

      {sheet.title && (
        <h3 className="text-center font-script text-2xl text-coral-dark sm:text-3xl">
          {sheet.title}
        </h3>
      )}

      {/* Nutri-Score (badge + modale détail) — réutilise le composant
          recette. Affiché si confiance persistée ≥ 0.5 (même règle que
          SheetCarousel côté recette). */}
      {sheet.nutriscoreGrade && (sheet.nutriscoreConfidence ?? 0) >= 0.5 && (
        <RecipeNutriScorePanel
          grade={sheet.nutriscoreGrade}
          ingredients={sheet.ingredients.map((i) => ({ ...i, note: i.note ?? null }))}
          ciqualByIdEntries={ciqualByIdEntries}
          portionWeightEntries={portionWeightEntries}
        />
      )}


      {/* Bandeau d'actions : portions stepper + mes courses + kcal +
          share + print. PortionsStepper à gauche de "Ajouter au menu"
          comme demandé. */}
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2">
        <PortionsStepper
          value={customPortions}
          onChange={setCustomPortions}
        />
        {isAuthenticated && (
          <AddMealSheetButton
            sheetId={sheet.id}
            hasIngredients={sheet.ingredients.length > 0}
            portionsOverride={customPortions}
          />
        )}
        {isAuthenticated && (
          <AddCaloriesButton
            source="menu"
            sourceRefId={sheet.id}
            label={sheet.title || `${label} (menu)`}
            kcal={sheet.calories}
            proteinsG={sheet.proteinsG}
            lipidsG={sheet.lipidsG}
            carbsG={sheet.carbsG}
          />
        )}
        <ActionIconButton icon={Share2} label="Partager" onClick={handleShare} />
        <ActionIconButton
          icon={Printer}
          label="Imprimer"
          onClick={() => window.print()}
        />
      </div>

      {/* Ingrédients groupés par catégorie, scalés selon customPortions.
          On normalise `note` (optionnel sur ShoppingListItem → toujours
          présent sur RecipeIngredient) pour réutiliser le helper. */}
      {sheet.ingredients.length > 0 && (
        <IngredientsList
          ingredients={sheet.ingredients.map((it) => ({
            category: it.category,
            label: it.label,
            quantity: it.quantity,
            unit: it.unit,
            note: it.note ?? null,
          }))}
          baseServings={sheet.servings}
          customPortions={customPortions}
        />
      )}

      {/* Tags chips — déduplication par Set : la source peut contenir
          des doublons (ex. "Plaisir & saveurs" hérité de la recette ET
          ajouté manuellement). Sans dédup, React warne sur les keys
          dupliquées et omet un des spans. Set préserve l'ordre
          d'insertion en JS. */}
      {sheet.tags.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 pt-1">
          {Array.from(new Set(sheet.tags)).map((t) => (
            <span
              key={`t-${t}`}
              className="rounded-full bg-coral-soft/30 px-2.5 py-0.5 text-xs font-semibold text-coral-dark"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Lightbox plein écran sur clic image */}
      {zoomOpen && sheet.coverImageUrl && (
        <MealImageLightbox
          imageUrl={sheet.coverImageUrl}
          alt={sheet.title ?? ''}
          onClose={() => setZoomOpen(false)}
        />
      )}
    </article>
  );
}

// ============================================================
// Bouton + Mes courses (utilise l'API toggle-meal-sheet dédiée
// menu_meal_sheets). Accepte un portionsOverride pour scale la
// liste selon le nb de personnes choisi dans le PortionsStepper.
// ============================================================

function AddMealSheetButton({
  sheetId,
  hasIngredients,
  portionsOverride,
}: {
  sheetId: string;
  hasIngredients: boolean;
  portionsOverride?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  async function add() {
    if (busy || !hasIngredients) return;
    setBusy(true);
    try {
      const res = await fetch('/api/shopping-list/toggle-meal-sheet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mealSheetId: sheetId,
          portionsOverride: portionsOverride,
        }),
      });
      if (!res.ok) throw new Error();
      setAdded(true);
      window.dispatchEvent(new CustomEvent('shopping-list-updated'));
      pulseBottomNav('courses');
      window.setTimeout(() => setAdded(false), 2000);
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={busy || !hasIngredients}
      aria-label={added ? 'Ajouté aux courses' : 'Ajouter à mes courses'}
      title={added ? 'Ajouté aux courses' : 'Ajouter à mes courses'}
      className="grid h-10 w-10 place-items-center rounded-full bg-coral text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-40"
    >
      {added ? <span aria-hidden>✓</span> : <ShoppingCart className="h-4 w-4" />}
    </button>
  );
}

// ============================================================
// ActionIconButton : icône ronde réutilisée pour share / print
// (même style que SheetCarousel — cohérence visuelle).
// ============================================================

function ActionIconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Share2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-coral shadow-sm ring-1 ring-coral-soft/40 transition hover:scale-105 hover:bg-coral-soft/30"
    >
      <Icon className="h-4 w-4" strokeWidth={2.2} />
    </button>
  );
}

// ============================================================
// IngredientsList : liste des ingrédients groupés par catégorie
// (alignée sur le rendu de SheetCarousel). Scale les quantités via
// scaleIngredients selon customPortions / baseServings.
// ============================================================

function IngredientsList({
  ingredients,
  baseServings,
  customPortions,
}: {
  ingredients: RecipeIngredient[];
  baseServings: number;
  customPortions: number;
}) {
  const factor =
    baseServings > 0 && customPortions > 0 ? customPortions / baseServings : 1;
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
    <div className="mx-auto max-w-2xl space-y-2 pt-2">
      <h4 className="font-script text-xl text-coral">Ingrédients</h4>
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

// ============================================================
// Lightbox plein écran de l'image d'une fiche repas (cliquable
// pour zoom). Réutilise le pattern de ShoppingListImageLightbox.
// ============================================================

function MealImageLightbox({
  imageUrl,
  alt,
  onClose,
}: {
  imageUrl: string;
  alt: string;
  onClose: () => void;
}) {
  if (typeof window === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow-lg ring-2 ring-white/30"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-full rounded-2xl object-contain shadow-2xl"
      />
    </div>,
    document.body,
  );
}

