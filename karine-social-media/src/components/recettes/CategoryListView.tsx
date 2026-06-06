'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, Heart, Search } from 'lucide-react';
import {
  CATEGORY_LABELS,
  CATEGORY_SINGULAR,
  type Recipe,
  type RecipeCategory,
} from '@/data/recipes';
import { RecipeCard } from './RecipeCard';

function matches(recipe: Recipe, q: string) {
  if (!q) return true;
  const haystack = [recipe.title, ...recipe.tags, ...recipe.aliments].join(' ').toLowerCase();
  return haystack.includes(q);
}

export function CategoryListView({
  category,
  recipes,
  userHasPlan,
}: {
  category: RecipeCategory;
  recipes: Recipe[];
  userHasPlan: boolean;
}) {
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => recipes.filter((r) => matches(r, q)), [recipes, q]);

  const toggleFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/recettes"
          aria-label="Retour aux catégories"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink transition hover:bg-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex items-center gap-2 font-script text-4xl text-coral">
          {CATEGORY_LABELS[category]}
          <Heart className="h-5 w-5 fill-coral/30 text-coral" />
        </h1>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-soft" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Rechercher un${CATEGORY_SINGULAR[category].startsWith('e') ? 'e' : ''} ${CATEGORY_SINGULAR[category]}…`}
          className="w-full rounded-full border border-coral-soft/60 bg-white py-3 pl-12 pr-4 text-sm text-ink shadow-sm outline-none placeholder:text-ink-soft focus:border-coral"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-[var(--radius-tile)] border border-dashed border-coral-soft/60 bg-white/40 px-4 py-10 text-center text-sm text-ink-soft">
          {q ? `Aucun résultat pour « ${q} »` : 'Bientôt de nouvelles recettes'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              isFavorite={favorites.has(recipe.id)}
              onToggleFavorite={toggleFavorite}
              userHasPlan={userHasPlan}
            />
          ))}
        </div>
      )}
    </div>
  );
}
