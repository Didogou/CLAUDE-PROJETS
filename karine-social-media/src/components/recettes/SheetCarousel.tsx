'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Ban,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Heart,
  Leaf,
  Printer,
  Share2,
  Users,
} from 'lucide-react';
import type { RecipeSheet, RecipeIngredient } from '@/data/recipes';
import { scaleIngredients } from '@/lib/recipe-portions';
import { AddSheetToListButton } from '@/components/courses/AddSheetToListButton';
import { AddCaloriesButton } from '@/components/nutrition/AddCaloriesButton';
import { FavoriteButton } from '@/components/favorites/FavoriteButton';
import { SheetLightbox } from './SheetLightbox';
import { PortionsStepper } from './PortionsStepper';
import { HeartBurst, useHeartBurst } from '@/components/ui/HeartBurst';
import { RecipeNutriScorePanel } from './RecipeNutriScorePanel';
import type { CiqualFoodLite } from '@/lib/nutriscore-aggregate';

type Props = {
  sheets: RecipeSheet[];
  /** Affiche le bouton "Ajouter à ma liste" si user connecté. */
  isAuthenticated: boolean;
  /** ID de la recette mère (pour favori). */
  recipeId: string;
  /** Titre de la recette mère (pour partage). */
  recipeTitle: string;
  /** Si la recette est déjà en favori (côté server). */
  favoritedInitial?: boolean;
  /** @deprecated remplacé par sheet.likesCount par fiche (hydraté côté server). */
  likesCountInitial?: number;
  /** Sheet IDs déjà likés par l'utilisateur (hydratation depuis le serveur). */
  initialLikedSheetIds?: string[];
  /** Liste sérialisable [id, ciqualFood] des Ciqual liés aux ingrédients
   *  de toutes les sheets. Utilisée par la modale "Détail nutritionnel"
   *  pour afficher le breakdown ingrédient × valeurs. */
  ciqualByIdEntries?: Array<[number, CiqualFoodLite]>;
  /** Poids de portion par label normalisé (« 1 gousse d'ail » → 5g),
   *  pour aligner la modale détail sur le calcul serveur. */
  portionWeightEntries?: Array<[string, number]>;
};

/**
 * Carrousel des fiches détaillées d'une recette.
 *
 * Layout :
 *   - Image grande au centre (max ~44rem PC, full mobile)
 *   - Bouton "Ajouter aux favoris" en overlay top-right de l'image
 *   - Flèches de navigation gauche/droite GRANDES, ancrées sur l'image
 *   - Dots de pagination sous l'image
 *   - Stats (pers/kcal/prep/cuisson)
 *   - Bouton "Ajouter à ma liste" + actions Partager/Like/Print côte à côte
 *   - Ingrédients groupés par catégorie
 *   - Tags + aliments en chips
 */
export function SheetCarousel({
  sheets,
  isAuthenticated,
  recipeId,
  recipeTitle,
  favoritedInitial = false,
  initialLikedSheetIds,
  ciqualByIdEntries,
  portionWeightEntries,
}: Props) {
  const [active, setActive] = useState(0);
  /** Likes PAR sheet (pas par recette mère) : la fiche n°1 et la fiche
   *  n°2 sont 2 recettes différentes, chacune avec son propre like.
   *  Hydratation depuis initialLikedSheetIds (server-side fetch). */
  const [likedBySheet, setLikedBySheet] = useState<Record<string, boolean>>(
    () => {
      const out: Record<string, boolean> = {};
      for (const id of initialLikedSheetIds ?? []) out[id] = true;
      return out;
    },
  );
  /** Compteurs initialisés depuis sheet.likesCount (déjà sur la DB). */
  const [likesBySheet, setLikesBySheet] = useState<Record<string, number>>(
    () => {
      const out: Record<string, number> = {};
      for (const s of sheets) out[s.id] = s.likesCount;
      return out;
    },
  );
  const [zoomOpen, setZoomOpen] = useState(false);
  /** Nb de personnes choisi par l'utilisatrice — par défaut le servings
   *  de la sheet active. Override le ratio standard au moment d'ajouter
   *  à la liste. */
  const [customPortions, setCustomPortions] = useState(sheets[0]?.servings ?? 4);

  // Sync portions quand on change de fiche (chaque sheet a son servings).
  useEffect(() => {
    if (sheets[active]) setCustomPortions(sheets[active].servings);
  }, [active, sheets]);

  // Sync inter-instance du like par sheet : si la lightbox toggle la
  // fiche X, on met à jour notre state UNIQUEMENT pour la fiche X.
  // L'event porte le likesCount serveur pour rester aligné avec la DB.
  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (
        e as CustomEvent<{ sheetId: string; liked: boolean; likesCount?: number }>
      ).detail;
      if (!detail || typeof detail.sheetId !== 'string' || typeof detail.liked !== 'boolean') return;
      setLikedBySheet((prev) =>
        prev[detail.sheetId] === detail.liked
          ? prev
          : { ...prev, [detail.sheetId]: detail.liked },
      );
      if (typeof detail.likesCount === 'number') {
        setLikesBySheet((c) => ({ ...c, [detail.sheetId]: detail.likesCount! }));
      }
    };
    window.addEventListener('sheet-like-toggled', onSync);
    return () => window.removeEventListener('sheet-like-toggled', onSync);
  }, []);

  if (sheets.length === 0) return null;
  const sheet = sheets[active];
  const total = sheets.length;
  const liked = !!likedBySheet[sheet.id];
  const likes = likesBySheet[sheet.id] ?? 0;

  // Explosion de cœurs déclenchée à chaque like (UX feedback)
  const [likeBursts, fireLikeBurst] = useHeartBurst();
  const router = useRouter();
  // Chemin courant (/recettes/<slug>) → on dérive l'URL de la page cuisine.
  const pathname = usePathname();

  async function toggleLike() {
    // Optimistic update : on change le state immédiatement, on rollback
    // si l'API échoue.
    const prevLiked = liked;
    const prevCount = likes;
    const optimisticLiked = !prevLiked;
    // Explosion de cœurs UNIQUEMENT quand on AJOUTE un like (pas au retrait).
    if (optimisticLiked) fireLikeBurst();
    setLikedBySheet((s) => ({ ...s, [sheet.id]: optimisticLiked }));
    setLikesBySheet((c) => ({
      ...c,
      [sheet.id]: Math.max(0, (c[sheet.id] ?? 0) + (optimisticLiked ? 1 : -1)),
    }));
    try {
      const res = await fetch(`/api/sheets/${sheet.id}/like`, { method: 'POST' });
      if (res.status === 401) {
        // Non connecté : rollback de l'optimistic + redirection vers
        // /login avec next pour revenir ici après auth. Avant on faisait
        // un rollback silencieux → le cœur s'animait puis disparaissait
        // sans aucun feedback, donnant l'impression d'un bug.
        setLikedBySheet((s) => ({ ...s, [sheet.id]: prevLiked }));
        setLikesBySheet((c) => ({ ...c, [sheet.id]: prevCount }));
        if (typeof window !== 'undefined') {
          const here = window.location.pathname + window.location.search;
          router.push(`/login?next=${encodeURIComponent(here)}`);
        }
        return;
      }
      if (!res.ok) throw new Error();
      const j = await res.json();
      // Source de vérité = réponse serveur.
      setLikedBySheet((s) => ({ ...s, [sheet.id]: !!j.liked }));
      setLikesBySheet((c) => ({
        ...c,
        [sheet.id]: typeof j.likesCount === 'number' ? j.likesCount : c[sheet.id] ?? 0,
      }));
      window.dispatchEvent(
        new CustomEvent('sheet-like-toggled', {
          detail: { sheetId: sheet.id, liked: !!j.liked, likesCount: j.likesCount },
        }),
      );
    } catch {
      // Rollback en cas d'erreur réseau.
      setLikedBySheet((s) => ({ ...s, [sheet.id]: prevLiked }));
      setLikesBySheet((c) => ({ ...c, [sheet.id]: prevCount }));
    }
  }

  async function handleShare() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: recipeTitle, url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* user annulé */
    }
  }

  // === Swipe gauche/droite pour naviguer entre fiches (mobile/tablet/touch).
  // Tolerance Y < 40px pour ne pas voler le scroll vertical. Threshold X
  // 60px pour ne pas trigger sur un simple tap. Pas de e.preventDefault =>
  // les boutons interieurs (qty, bouton Mes courses) restent cliquables.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    if (total <= 1) return;
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!swipeStart.current || total <= 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.abs(dx) < 60) return; // pas un swipe
    if (Math.abs(dy) > 40) return; // scroll vertical, on ignore
    if (dx < 0) setActive((i) => (i + 1) % total);
    else setActive((i) => (i - 1 + total) % total);
  }

  return (
    <section
      className="space-y-4 rounded-2xl bg-white/70 p-4 shadow-sm backdrop-blur-sm lg:p-6"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* En-tête : badge fiche X/N + dots + bouton favoris.
          Le bouton favoris est ici (dans la bande blanche), PAS en
          overlay sur l'image (UX demandée 2026-06-03). */}
      <header className="flex items-center justify-between gap-2">
        <span className="shrink-0 rounded-full bg-coral-soft/40 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-coral-dark">
          {active + 1}/{total}
        </span>
        {/* Tags diététiques DE LA FICHE COURANTE — recalculés à chaque
            navigation entre fiches. Inclut Sans porc cette fois (vs la
            card mère où c'est englobé par Végé). */}
        <SheetDietaryTags dietary={sheet.dietary} />
        <FavoriteButton
          targetType="recipe"
          targetId={recipeId}
          initialFavorited={favoritedInitial}
          isAuthenticated={isAuthenticated}
          size="sm"
          showLabel
          labelShort
        />
      </header>

      {/* Bouton pastel : lance la recette guidée (page cuisine) pour la
          fiche actuellement affichée. Halo qui pulse en continu pour
          attirer l'œil de Karine dès l'arrivée sur la page recette. */}
      <Link
        href={`${pathname}/cuisiner?sheet=${active}`}
        className="cook-start-pulse mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-coral-soft px-6 py-3 text-base font-bold text-coral-dark shadow-sm transition hover:bg-coral-soft/80 active:scale-[0.98]"
      >
        <ChefHat className="h-5 w-5" />
        Commencer la recette
      </Link>

      {/* Image + chevrons HORS DE L'IMAGE, dans les marges blanches de la
          carte. Layout flex 3 colonnes : chevron G / image / chevron D.
          Au click sur l'image → ouvre la lightbox plein écran (réutilise
          SaviezVousLightbox déjà dev). */}
      {sheet.coverImageUrl && (
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          {total > 1 ? (
            <button
              type="button"
              onClick={() => setActive((i) => (i - 1 + total) % total)}
              aria-label="Fiche précédente"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-coral-soft/30 text-coral transition hover:scale-110 hover:bg-coral-soft/60 lg:h-14 lg:w-14"
            >
              <ChevronLeft className="h-6 w-6 lg:h-7 lg:w-7" strokeWidth={2.5} />
            </button>
          ) : (
            <span aria-hidden className="h-12 w-12 shrink-0 lg:h-14 lg:w-14" />
          )}

          <button
            type="button"
            onClick={() => setZoomOpen(true)}
            aria-label="Agrandir la fiche"
            className="group relative block w-full max-w-md cursor-zoom-in transition hover:-translate-y-0.5 sm:max-w-[min(36rem,55vh)]"
          >
            <img
              src={sheet.coverImageUrl}
              alt={sheet.title ?? ''}
              className="aspect-square w-full rounded-2xl object-cover shadow-md transition group-hover:brightness-95"
            />
          </button>

          {total > 1 ? (
            <button
              type="button"
              onClick={() => setActive((i) => (i + 1) % total)}
              aria-label="Fiche suivante"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-coral-soft/30 text-coral transition hover:scale-110 hover:bg-coral-soft/60 lg:h-14 lg:w-14"
            >
              <ChevronRight className="h-6 w-6 lg:h-7 lg:w-7" strokeWidth={2.5} />
            </button>
          ) : (
            <span aria-hidden className="h-12 w-12 shrink-0 lg:h-14 lg:w-14" />
          )}
        </div>
      )}

      {/* Lightbox plein écran dédiée recettes : image + ingrédients +
          bouton "Ajouter à ma liste" sur le côté.
          On lui passe likedBySheet pour qu elle parte avec le bon etat
          de like (sinon elle demarrait a vide et l user voyait Like
          alors qu il avait deja like dans la vue detail). */}
      {zoomOpen && (
        <SheetLightbox
          sheets={sheets}
          startIndex={active}
          isAuthenticated={isAuthenticated}
          recipeTitle={recipeTitle}
          initialLikedBySheet={likedBySheet}
          onClose={() => setZoomOpen(false)}
        />
      )}

      {/* Bandeau Nutri-Score : suit la sheet active (pas la sheet 0).
          Quand l'utilisatrice slide entre les fiches d'une recette comme
          "4 Salades de Pâtes", le grade s'adapte à chaque variante.
          Visible si la confiance persistée en BDD ≥ 0.5. */}
      {sheet.nutriscoreGrade && (sheet.nutriscoreConfidence ?? 0) >= 0.5 && (
        <RecipeNutriScorePanel
          grade={sheet.nutriscoreGrade}
          ingredients={sheet.ingredients}
          ciqualByIdEntries={ciqualByIdEntries ?? []}
          portionWeightEntries={portionWeightEntries ?? []}
        />
      )}

      {/* Actions DIRECTEMENT sous l'image (UX mobile demandee Didier 2026-
          06-03 : footer remonte en tete pour eviter le scroll). Layout
          compact : items-start aligne en haut pour que "Voir mes courses"
          (lien sous Mes courses) ne decale pas les autres boutons. */}
      <div className="mx-auto flex w-full max-w-2xl items-center justify-center gap-2">
        {isAuthenticated && (
          <AddSheetToListButton
            sheetId={sheet.id}
            hasIngredients={sheet.ingredients.length > 0}
            portionsOverride={customPortions}
          />
        )}
        {isAuthenticated && (
          <AddCaloriesButton
            source="recipe"
            sourceRefId={sheet.id}
            label={sheet.title || recipeTitle || 'Recette'}
            kcal={sheet.calories}
            proteinsG={sheet.proteinsG}
            lipidsG={sheet.lipidsG}
            carbsG={sheet.carbsG}
          />
        )}
        <ActionIconButton icon={Share2} label="Partager" onClick={handleShare} />
        <span className="relative">
          <HeartBurst bursts={likeBursts} />
          <ActionIconButton
            icon={Heart}
            label={liked ? 'Liké' : 'J\'aime'}
            onClick={toggleLike}
            active={liked}
            badge={likes > 0 ? String(likes) : undefined}
          />
        </span>
        <ActionIconButton
          icon={Printer}
          label="Imprimer"
          onClick={() => window.print()}
        />
      </div>

      {/* Titre variante — mt-4 pour laisser de l'espace au lien
          "Voir mes courses →" qui flotte en absolute sous le bouton
          d'action courses (sinon le titre vient se coller dessus). */}
      {sheet.title && (
        <h2 className="mt-10 text-center font-script text-2xl text-coral-dark sm:text-3xl lg:text-4xl">
          {sheet.title}
        </h2>
      )}

      {/* Stats rapides. Pers est éditable (stepper +/-) — au toggle
          "Mes courses", on multiplie les ingrédients pour atteindre
          ce nombre. */}
      <div className="mx-auto grid max-w-2xl grid-cols-4 gap-2">
        <PortionsStepper
          value={customPortions}
          onChange={setCustomPortions}
        />
        <Stat icon={Flame} label="kcal" value={sheet.calories} suffix="/pers" />
        <Stat icon={Clock} label="Prep" value={sheet.prepTimeMin} suffix="min" />
        <Stat icon={Clock} label="Cuis" value={sheet.cookTimeMin} suffix="min" />
      </div>

      {/* Ingrédients groupés */}
      {sheet.ingredients.length > 0 && (
        <IngredientsList
          ingredients={sheet.ingredients}
          baseServings={sheet.servings}
          customPortions={customPortions}
        />
      )}

      {/* Tags uniquement (les aliments sont retires : redondant avec la
          liste d ingrédients juste au-dessus). */}
      {sheet.tags.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 pt-2">
          {sheet.tags.map((t) => (
            <span
              key={`tag-${t}`}
              className="rounded-full bg-coral-soft/30 px-2.5 py-0.5 text-xs font-semibold text-coral-dark"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: typeof Users;
  label: string;
  value: number | null;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg bg-cream/40 p-1 text-center sm:p-2">
      <Icon className="mx-auto h-3 w-3 text-coral sm:h-4 sm:w-4" />
      <p className="mt-0.5 text-sm font-bold text-coral-dark sm:text-base">
        {value ?? '—'}
      </p>
      <p className="text-[0.55rem] font-semibold uppercase tracking-wider text-ink-soft sm:text-[0.6rem]">
        {label}
        {suffix && ` ${suffix}`}
      </p>
    </div>
  );
}

function ActionIconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  badge,
}: {
  icon: typeof Heart;
  label: string;
  onClick: () => void;
  active?: boolean;
  badge?: string;
}) {
  // Icône seule, taille fixe h-9 w-9 (cohérence avec les autres
  // boutons de la barre actions). Le badge éventuel se rend en
  // petit pastille en haut-droite.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`relative flex h-9 w-9 items-center justify-center rounded-full shadow-sm transition hover:scale-105 ${
        active
          ? 'bg-coral text-white'
          : 'bg-white text-coral ring-1 ring-coral-soft/40 hover:bg-coral-soft/30'
      }`}
    >
      <Icon
        className={`h-4 w-4 ${active ? 'fill-current' : ''}`}
        strokeWidth={2.2}
      />
      {badge && (
        <span
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[0.55rem] font-bold text-white"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

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
      <h3 className="font-script text-xl text-coral">Ingrédients</h3>
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

/** Tags diététiques d'une fiche détaillée individuelle. À la différence
 *  de la card recette mère, on inclut Sans porc ici (info utile au
 *  détail). Affichés en pillules compactes au-dessus de l'image. */
function SheetDietaryTags({
  dietary,
}: {
  dietary: {
    isVegetarian: boolean;
    isGlutenFree: boolean;
    isPorkFree: boolean;
  };
}) {
  if (
    !dietary.isVegetarian &&
    !dietary.isGlutenFree &&
    !dietary.isPorkFree
  ) {
    return null;
  }
  return (
    <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-center gap-1 overflow-hidden">
      {dietary.isVegetarian && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-1 py-0.5 text-[0.5rem] font-bold uppercase tracking-tight text-emerald-700 ring-1 ring-emerald-300"
          title="Cette fiche ne contient ni viande, ni poisson, ni œufs"
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
          title="Cette fiche ne contient pas de gluten"
        >
          <Ban className="size-2 shrink-0" strokeWidth={2.5} />
          Sans Glu
        </span>
      )}
      {dietary.isPorkFree && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sky-100 px-1 py-0.5 text-[0.5rem] font-bold uppercase tracking-tight text-sky-700 ring-1 ring-sky-300"
          title="Cette fiche ne contient pas de porc"
        >
          <Ban className="size-2 shrink-0" strokeWidth={2.5} />
          Sans porc
        </span>
      )}
    </div>
  );
}
