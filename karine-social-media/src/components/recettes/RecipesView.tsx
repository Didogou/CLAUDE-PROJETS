'use client';

import { useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import { CATEGORY_ORDER, CATEGORY_LABELS, type Recipe, type RecipeCategory } from '@/data/recipes';
import { RecipeCard } from './RecipeCard';
import { CategoryDeck } from './CategoryDeck';
import type { CategoryDeckData } from '@/lib/recipes';

function matches(recipe: Recipe, q: string) {
  if (!q) return true;
  const haystack = [recipe.title, ...recipe.tags, ...recipe.aliments].join(' ').toLowerCase();
  return haystack.includes(q);
}

export function RecipesView({
  recipes,
  decks,
  query,
  userHasPlan,
}: {
  recipes: Recipe[];
  decks: Record<RecipeCategory, CategoryDeckData>;
  query: string;
  /** Threading depuis le Server Component parent. Si false, les
   *  recettes non is_public seront affichées avec un cadenas et
   *  un clic qui redirige vers /mon-plan. */
  userHasPlan: boolean;
}) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const toggleFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? recipes.filter((r) => matches(r, q)) : []), [recipes, q]);

  if (q) {
    return (
      <SearchResults
        q={q}
        filtered={filtered}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
        userHasPlan={userHasPlan}
      />
    );
  }
  return (
    <div className="space-y-10 lg:grid lg:grid-cols-3 lg:gap-8 lg:space-y-0">
      {CATEGORY_ORDER.map((cat) => (
        <CategoryDeck
          key={cat}
          category={cat}
          featured={decks[cat].featured}
          stack={decks[cat].stack}
          totalCount={decks[cat].totalCount}
        />
      ))}
    </div>
  );
}

function SearchResults({
  q,
  filtered,
  favorites,
  onToggleFavorite,
  userHasPlan,
}: {
  q: string;
  filtered: Recipe[];
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  userHasPlan: boolean;
}) {
  if (filtered.length === 0) {
    return (
      <p className="rounded-[var(--radius-tile)] border border-dashed border-coral-soft/60 bg-white/40 px-4 py-8 text-center text-sm text-ink-soft">
        Aucun résultat pour «&nbsp;{q}&nbsp;»
      </p>
    );
  }
  return (
    <div className="space-y-8">
      {CATEGORY_ORDER.map((cat) => {
        const items = filtered.filter((r) => r.category === cat);
        if (items.length === 0) return null;
        return (
          <section key={cat}>
            <h2 className="mb-4 flex items-center gap-2 font-script text-2xl text-coral">
              {CATEGORY_LABELS[cat]}
              <Heart className="h-4 w-4 fill-coral/30 text-coral" />
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  isFavorite={favorites.has(recipe.id)}
                  onToggleFavorite={onToggleFavorite}
                  userHasPlan={userHasPlan}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
