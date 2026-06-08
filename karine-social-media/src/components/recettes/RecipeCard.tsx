'use client';

import Link from 'next/link';
import { Heart, Flame, Lock, Sparkles } from 'lucide-react';
import type { Recipe } from '@/data/recipes';
import { SeasonChip } from './SeasonChip';
import { RealBadge } from './RealBadge';
import { NutriScoreBadge } from './NutriScoreBadge';

export type RecipeAvgScore = {
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  confidence: number;
};

type RecipeCardProps = {
  recipe: Recipe;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  /** L'utilisatrice a-t-elle un plan actif (abonnée/patiente/admin) ?
   *  Si oui : accès libre à toutes les recettes. Sinon : seules les
   *  recettes is_public sont accessibles (badge "Aperçu gratuit"),
   *  les autres affichent un cadenas et redirigent vers /mon-plan. */
  userHasPlan: boolean;
  /** Moyenne du Nutri-Score des sheets de la recette. Affiché sous la
   *  tuile au layout emballage (rangée A-E). Optionnel : si null ou
   *  confiance < 50 %, on n'affiche rien. */
  nutriScore?: RecipeAvgScore | null;
};

export function RecipeCard({
  recipe,
  isFavorite,
  onToggleFavorite,
  userHasPlan,
  nutriScore,
}: RecipeCardProps) {
  const isAccessible = userHasPlan || recipe.isPublic;
  const showFreeBadge = !userHasPlan && recipe.isPublic;
  const showLock = !isAccessible;

  const href = isAccessible
    ? `/recettes/${recipe.id}`
    : `/mon-plan?next=/recettes/${recipe.id}`;

  return (
    <div className="group mx-auto w-full max-w-[14rem]">
      <div className="relative">
        <Link
          href={href}
          className="block overflow-hidden rounded-[var(--radius-tile)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span
            aria-hidden
            className={`block aspect-square bg-cover bg-center transition ${
              showLock ? 'opacity-60 saturate-50 group-hover:opacity-75' : ''
            }`}
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

        {/* Badge "Aperçu gratuit" : visible uniquement pour les
            visiteuses/connectées-sans-plan sur une recette is_public.
            Encourage à découvrir avant de s'abonner. */}
        {showFreeBadge && (
          <span className="pointer-events-none absolute left-1.5 top-1 z-10 flex items-center gap-1 rounded-full bg-sage px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-white shadow-sm">
            <Sparkles className="h-3 w-3" strokeWidth={2.4} />
            Aperçu gratuit
          </span>
        )}

        {/* Cadenas central : recette réservée aux abonnées (le clic
            redirige automatiquement vers /mon-plan via href dynamique). */}
        {showLock && (
          <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-coral-dark shadow-md">
              <Lock className="h-5 w-5" strokeWidth={2.4} />
            </span>
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
          className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-full bg-white/90 shadow-sm transition hover:scale-110"
        >
          <Heart className={isFavorite ? 'h-4 w-4 fill-coral text-coral' : 'h-4 w-4 text-coral'} strokeWidth={2} />
        </button>
      </div>

      {/* Titre + Nutri-Score moyen + compteur de likes centrés sous la tuile */}
      <p className="mt-2 text-center text-sm font-bold leading-tight text-ink">{recipe.title}</p>
      {nutriScore && nutriScore.confidence >= 0.5 && (
        <div className="mt-1.5 flex justify-center">
          <NutriScoreBadge
            grade={nutriScore.grade}
            size="sm"
            headerVariant="karine"
          />
        </div>
      )}
      <p className="mt-0.5 flex items-center justify-center gap-1 text-xs font-semibold text-coral-dark">
        <Heart className="h-3.5 w-3.5 fill-coral text-coral" />
        {recipe.likesCount}
      </p>
    </div>
  );
}
