'use client';

import { useMemo, useState } from 'react';
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
  /** Nb de likes initiaux. */
  likesCountInitial?: number;
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
  likesCountInitial = 0,
}: Props) {
  const [active, setActive] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(likesCountInitial);

  if (sheets.length === 0) return null;
  const sheet = sheets[active];
  const total = sheets.length;

  function toggleLike() {
    setLiked((prev) => {
      const next = !prev;
      setLikes((c) => Math.max(0, c + (next ? 1 : -1)));
      return next;
    });
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
    <section className="space-y-4 rounded-2xl bg-white/95 p-4 shadow-sm lg:p-6">
      {/* En-tête : badge fiche X/N */}
      <header className="flex items-center justify-center gap-2">
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
      </header>

      {/* Image principale de la fiche + flèches + bouton favoris overlay.
          Les fiches Karine sont carrées (illustrations recette pleine) →
          aspect-square pour ne PAS rogner l'image. max-w-2xl pour ne pas
          écraser le reste sur grand écran. */}
      {sheet.coverImageUrl && (
        <div className="relative mx-auto w-full max-w-2xl">
          <img
            src={sheet.coverImageUrl}
            alt={sheet.title ?? ''}
            className="aspect-square w-full rounded-2xl object-cover shadow-md"
          />

          {/* Bouton "Ajouter aux favoris" en overlay top-right */}
          <div className="absolute right-3 top-3 z-10">
            <FavoriteButton
              targetType="recipe"
              targetId={recipeId}
              initialFavorited={favoritedInitial}
              isAuthenticated={isAuthenticated}
              size="sm"
              showLabel
            />
          </div>

          {/* Flèches de navigation GRANDES (visibles si >= 2 sheets) */}
          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => setActive((i) => (i - 1 + total) % total)}
                aria-label="Fiche précédente"
                className="absolute left-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-coral shadow-lg ring-2 ring-white transition hover:scale-110 hover:bg-coral-soft/30 lg:h-14 lg:w-14"
              >
                <ChevronLeft className="h-6 w-6 lg:h-7 lg:w-7" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={() => setActive((i) => (i + 1) % total)}
                aria-label="Fiche suivante"
                className="absolute right-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-coral shadow-lg ring-2 ring-white transition hover:scale-110 hover:bg-coral-soft/30 lg:h-14 lg:w-14"
              >
                <ChevronRight className="h-6 w-6 lg:h-7 lg:w-7" strokeWidth={2.5} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Titre variante */}
      {sheet.title && (
        <h2 className="text-center font-script text-3xl text-coral-dark lg:text-4xl">
          {sheet.title}
        </h2>
      )}

      {/* Stats rapides */}
      <div className="mx-auto grid max-w-2xl grid-cols-4 gap-2">
        <Stat icon={Users} label="Pers" value={sheet.servings} />
        <Stat icon={Flame} label="kcal" value={sheet.calories} suffix="/pers" />
        <Stat icon={Clock} label="Prep" value={sheet.prepTimeMin} suffix="min" />
        <Stat icon={Clock} label="Cuis" value={sheet.cookTimeMin} suffix="min" />
      </div>

      {/* Bouton "Ajouter à ma liste" + actions à côté (Partager/Like/Print) */}
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2">
        {isAuthenticated && (
          <div className="min-w-0 flex-1 sm:flex-initial">
            <AddSheetToListButton
              sheetId={sheet.id}
              hasIngredients={sheet.ingredients.length > 0}
            />
          </div>
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

      {/* Tags + aliments */}
      {(sheet.tags.length > 0 || sheet.aliments.length > 0) && (
        <div className="flex flex-wrap justify-center gap-1.5 pt-2">
          {sheet.tags.map((t) => (
            <span
              key={`tag-${t}`}
              className="rounded-full bg-coral-soft/30 px-2.5 py-0.5 text-xs font-semibold text-coral-dark"
            >
              {t}
            </span>
          ))}
          {sheet.aliments.map((a) => (
            <span
              key={`al-${a}`}
              className="rounded-full bg-sage/30 px-2.5 py-0.5 text-xs font-semibold text-ink"
            >
              {a}
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
