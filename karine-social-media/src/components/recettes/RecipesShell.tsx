'use client';

import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { RecipesView } from './RecipesView';
import type { Recipe, RecipeCategory } from '@/data/recipes';
import type { CategoryDeckData } from '@/lib/recipes';

/**
 * Shell client qui rend :
 *  - le header sticky (AppHeader + "Idées recettes" + barre de recherche)
 *  - la zone scrollable des piles / résultats de recherche.
 * Le state `query` vit ici pour que la barre (dans le sticky) et la liste
 * (dans la zone scroll) partagent la même valeur.
 */
export function RecipesShell({
  appHeader,
  recipes,
  decks,
}: {
  appHeader: ReactNode;
  recipes: Recipe[];
  decks: Record<RecipeCategory, CategoryDeckData>;
}) {
  const [query, setQuery] = useState('');

  return (
    <>
      <div className="sticky top-0 z-30 bg-blush/90 backdrop-blur-md">
        {appHeader}
        <div className="mx-auto w-full max-w-md px-5 pb-3 lg:flex lg:max-w-7xl lg:items-center lg:gap-8 lg:px-10">
          <h1 className="mb-3 font-script text-4xl text-coral lg:mb-0 lg:shrink-0 lg:text-5xl">
            Idées recettes
          </h1>
          <div className="relative lg:flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-soft" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une recette, un ingrédient…"
              className="w-full rounded-full border border-coral-soft/60 bg-white py-3 pl-12 pr-4 text-sm text-ink shadow-sm outline-none placeholder:text-ink-soft focus:border-coral"
            />
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 pt-6 lg:max-w-7xl lg:px-10">
        <RecipesView recipes={recipes} decks={decks} query={query} />
      </main>
    </>
  );
}
