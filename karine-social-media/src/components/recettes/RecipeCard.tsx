'use client';

import Link from 'next/link';
import { Heart, Flame } from 'lucide-react';
import type { Recipe } from '@/data/recipes';
import { SeasonChip } from './SeasonChip';
import { RealBadge } from './RealBadge';

type RecipeCardProps = {
  recipe: Recipe;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
};

export function RecipeCard({ recipe, isFavorite, onToggleFavorite }: RecipeCardProps) {
  return (
    <div className="group mx-auto w-full max-w-[14rem]">
      <div className="relative">
        <Link
          href={`/recettes/${recipe.id}`}
          className="block overflow-hidden rounded-[var(--radius-tile)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span
            aria-hidden
            className="block aspect-square bg-cover bg-center"
            style={{ backgroundImage: `url(${recipe.coverImage})` }}
          />
          <span className="sr-only">{recipe.title}</span>
        </Link>

        {/* Calories */}
        <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-coral-dark shadow-sm">
          <Flame className="h-3.5 w-3.5" />
          {recipe.calories} kcal
        </span>

        {/* Étiquette "Légumes de saison" — débordante en coin haut-gauche */}
        {recipe.isSeasonal && (
          <span className="pointer-events-none absolute -left-3 -top-4 z-20">
            <SeasonChip />
          </span>
        )}

        {/* Badge "Réel" si Karine a publié des photos de prépa */}
        {recipe.prepPhotos.length > 0 && (
          <span className="pointer-events-none absolute bottom-2 right-2 z-10">
            <RealBadge />
          </span>
        )}

        {/* Favori */}
        <button
          type="button"
          onClick={() => onToggleFavorite(recipe.id)}
          aria-label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          aria-pressed={isFavorite}
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 shadow-sm transition hover:scale-110"
        >
          <Heart className={isFavorite ? 'h-4 w-4 fill-coral text-coral' : 'h-4 w-4 text-coral'} strokeWidth={2} />
        </button>
      </div>

      {/* Titre + compteur de likes centrés sous la tuile */}
      <p className="mt-2 text-center text-sm font-bold leading-tight text-ink">{recipe.title}</p>
      <p className="mt-0.5 flex items-center justify-center gap-1 text-xs font-semibold text-coral-dark">
        <Heart className="h-3.5 w-3.5 fill-coral text-coral" />
        {recipe.likesCount}
      </p>
    </div>
  );
}
