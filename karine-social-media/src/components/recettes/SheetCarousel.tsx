'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Heart,
  Printer,
  Share2,
  Users,
} from 'lucide-react';
import type { RecipeSheet, RecipeIngredient } from '@/data/recipes';
import { AddSheetToListButton } from '@/components/courses/AddSheetToListButton';
import { FavoriteButton } from '@/components/favorites/FavoriteButton';
import { SheetLightbox } from './SheetLightbox';
import { PortionsStepper } from './PortionsStepper';

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

  async function toggleLike() {
    // Optimistic update : on change le state immédiatement, on rollback
    // si l'API échoue.
    const prevLiked = liked;
    const prevCount = likes;
    const optimisticLiked = !prevLiked;
    setLikedBySheet((s) => ({ ...s, [sheet.id]: optimisticLiked }));
    setLikesBySheet((c) => ({
      ...c,
      [sheet.id]: Math.max(0, (c[sheet.id] ?? 0) + (optimisticLiked ? 1 : -1)),
    }));
    try {
      const res = await fetch(`/api/sheets/${sheet.id}/like`, { method: 'POST' });
      if (res.status === 401) {
        // Non connecté : rollback silencieux (le like est réservé aux users).
        setLikedBySheet((s) => ({ ...s, [sheet.id]: prevLiked }));
        setLikesBySheet((c) => ({ ...c, [sheet.id]: prevCount }));
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

  return (
    <section className="space-y-4 rounded-2xl bg-white/70 p-4 shadow-sm backdrop-blur-sm lg:p-6">
      {/* En-tête : badge fiche X/N + dots + bouton favoris.
          Le bouton favoris est ici (dans la bande blanche), PAS en
          overlay sur l'image (UX demandée 2026-06-03). */}
      <header className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-coral-soft/40 px-3 py-1 text-xs font-bold uppercase tracking-wider text-coral-dark">
          Fiche {active + 1}/{total}
        </span>
        {total > 1 && (
          <div className="flex items-center gap-1.5">
            {sheets.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Voir fiche ${i + 1}`}
                className={`h-1.5 rounded-full transition ${
                  i === active ? 'w-6 bg-coral' : 'w-1.5 bg-coral-soft'
                }`}
              />
            ))}
          </div>
        )}
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
          bouton "Ajouter à ma liste" sur le côté. */}
      {zoomOpen && (
        <SheetLightbox
          sheets={sheets}
          startIndex={active}
          isAuthenticated={isAuthenticated}
          recipeTitle={recipeTitle}
          onClose={() => setZoomOpen(false)}
        />
      )}

      {/* Titre variante */}
      {sheet.title && (
        <h2 className="text-center font-script text-3xl text-coral-dark lg:text-4xl">
          {sheet.title}
        </h2>
      )}

      {/* Stats rapides. Pers est éditable (stepper +/-) — au toggle
          "Ajouter à ma liste", on multiplie les ingrédients pour atteindre
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

      {/* Bouton "+ Mes courses" + actions cote a cote (Partager/Like/Print)
          sur 1 SEULE ligne, mobile comme PC. Le label court permet au
          bouton de rester compact meme quand le like a un badge. */}
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2">
        {isAuthenticated && (
          <AddSheetToListButton
            sheetId={sheet.id}
            hasIngredients={sheet.ingredients.length > 0}
            portionsOverride={customPortions}
          />
        )}
        <ActionIconButton icon={Share2} label="Partager" onClick={handleShare} />
        <ActionIconButton
          icon={Heart}
          label={liked ? 'Liké' : 'J\'aime'}
          onClick={toggleLike}
          active={liked}
          badge={likes > 0 ? String(likes) : undefined}
        />
        <ActionIconButton
          icon={Printer}
          label="Imprimer"
          onClick={() => window.print()}
        />
      </div>

      {/* Ingrédients groupés */}
      {sheet.ingredients.length > 0 && (
        <IngredientsList ingredients={sheet.ingredients} />
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
    <div className="rounded-lg bg-cream/40 p-2 text-center">
      <Icon className="mx-auto h-4 w-4 text-coral" />
      <p className="mt-0.5 text-base font-bold text-coral-dark">{value ?? '—'}</p>
      <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-ink-soft">
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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow-sm transition hover:scale-105 ${
        active
          ? 'bg-coral text-white'
          : 'bg-white text-coral ring-1 ring-coral-soft/40 hover:bg-coral-soft/30'
      }`}
    >
      <Icon
        className={`h-4 w-4 ${active ? 'fill-current' : ''}`}
        strokeWidth={2.2}
      />
      <span className="hidden sm:inline">{label}</span>
      {badge && <span className="text-xs font-bold">{badge}</span>}
    </button>
  );
}

function IngredientsList({ ingredients }: { ingredients: RecipeIngredient[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, RecipeIngredient[]>();
    for (const it of ingredients) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return [...map.entries()];
  }, [ingredients]);

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
