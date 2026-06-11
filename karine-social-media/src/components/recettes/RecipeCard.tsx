'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Ban, Bookmark, Heart, Flame, Leaf, Lock, Sparkles } from 'lucide-react';
import type { Recipe } from '@/data/recipes';
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
  /** Si true, applique un ring coral animé pour indiquer à
   *  l'utilisatrice "tu étais ici" au retour depuis la page détail.
   *  L'animation se fait via la classe CSS recipe-card-highlight. */
  highlighted?: boolean;
};

export function RecipeCard({
  recipe,
  isFavorite,
  onToggleFavorite,
  userHasPlan,
  nutriScore,
  highlighted = false,
}: RecipeCardProps) {
  // Like + état "déjà liké" en localStorage (V1 anonyme, anti-spam).
  // Lazy init synchrone au mount pour éviter le flicker + floor à 1
  // si l'user a liké localement mais que la DB ne le reflète pas
  // encore (cas migration).
  const [likes, setLikes] = useState(() => {
    const base = recipe.likesCount ?? 0;
    if (typeof window === 'undefined') return base;
    try {
      const raw = localStorage.getItem('karine.liked-recipes.v1');
      const liked = raw
        ? new Set(JSON.parse(raw) as string[]).has(recipe.id)
        : false;
      return liked ? Math.max(base, 1) : base;
    } catch {
      return base;
    }
  });
  const [hasLiked, setHasLiked] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = localStorage.getItem('karine.liked-recipes.v1');
      return raw
        ? new Set(JSON.parse(raw) as string[]).has(recipe.id)
        : false;
    } catch {
      return false;
    }
  });
  // Sync au changement de recipe (cas navigation entre cards si Recipe
  // est ré-utilisé). Pas critique pour la grille mais cohérent.
  useEffect(() => {
    const base = recipe.likesCount ?? 0;
    try {
      const raw = localStorage.getItem('karine.liked-recipes.v1');
      const liked = raw
        ? new Set(JSON.parse(raw) as string[]).has(recipe.id)
        : false;
      setHasLiked(liked);
      setLikes(liked ? Math.max(base, 1) : base);
    } catch {
      setHasLiked(false);
      setLikes(base);
    }
  }, [recipe.id, recipe.likesCount]);
  async function handleLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const wasLiked = hasLiked;
    // Optimistic toggle
    setLikes((n) => (wasLiked ? Math.max(0, n - 1) : n + 1));
    setHasLiked(!wasLiked);
    // Sync localStorage
    try {
      const raw = localStorage.getItem('karine.liked-recipes.v1');
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      const idx = arr.indexOf(recipe.id);
      if (wasLiked) {
        if (idx >= 0) arr.splice(idx, 1);
      } else {
        if (idx < 0) arr.push(recipe.id);
      }
      localStorage.setItem('karine.liked-recipes.v1', JSON.stringify(arr));
    } catch {
      /* localStorage indispo */
    }
    try {
      const res = await fetch(`/api/recipes/${recipe.id}/like`, {
        method: wasLiked ? 'DELETE' : 'POST',
      });
      if (!res.ok) throw new Error();
    } catch {
      // Pas de rollback visible : garde l'optimistic UI.
      console.warn('[recipe-like] API failed');
    }
  }
  const isAccessible = userHasPlan || recipe.isPublic;
  const showFreeBadge = !userHasPlan && recipe.isPublic;
  const showLock = !isAccessible;

  const href = isAccessible
    ? `/recettes/${recipe.id}`
    : `/mon-plan?next=/recettes/${recipe.id}`;

  // Tags pré-calculés server-side dans buildRecipe (OR sur les sheets).
  const dietary = recipe.dietaryTags;
  // Counts par tag (combien de fiches détaillées correspondent).
  // Utile pour afficher "Végé 2/4" quand seulement une partie des
  // fiches d'une recette mère sont concernées.
  const totalSheets = recipe.sheets.length;
  const vegCount = recipe.sheets.filter((s) => s.dietary?.isVegetarian).length;
  const gfCount = recipe.sheets.filter((s) => s.dietary?.isGlutenFree).length;

  return (
    <div
      className={`group mx-auto w-full max-w-[14rem] ${
        highlighted ? 'recipe-card-highlight' : ''
      }`}
      data-recipe-id={recipe.id}
    >
      {/* Tags compacts au-dessus de l'image. Labels courts pour tenir
          sur 1 ligne (max ~14rem). On affiche maintenant aussi
          "Sans porc" (demande Karine 2026-06-11). */}
      {(recipe.isSeasonal ||
        dietary.isVegetarian ||
        dietary.isGlutenFree ||
        (dietary.isPorkFree && !dietary.isVegetarian)) && (
        <div className="mb-1 flex flex-nowrap justify-center gap-0.5 overflow-hidden">
          {recipe.isSeasonal && (
            <span
              className="inline-flex items-center justify-center rounded-full bg-sage/15 p-1 text-sage ring-1 ring-sage/40"
              title="De saison"
            >
              <Leaf className="size-2.5" strokeWidth={2.5} />
            </span>
          )}
          {dietary.isVegetarian && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-300"
              title={
                totalSheets > 1
                  ? `${vegCount}/${totalSheets} fiches sans viande, poisson ni œufs`
                  : 'Cette recette ne contient ni viande, ni poisson, ni œufs'
              }
            >
              <span
                aria-hidden
                className="block size-2 shrink-0 rounded-full bg-emerald-600"
              />
              Végé
              {totalSheets > 1 && (
                <span className="opacity-70">
                  {' '}
                  {vegCount}/{totalSheets}
                </span>
              )}
            </span>
          )}
          {dietary.isGlutenFree && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1 py-0.5 text-[0.5rem] font-bold uppercase tracking-tight text-amber-700 ring-1 ring-amber-300"
              title={
                totalSheets > 1
                  ? `${gfCount}/${totalSheets} fiches sans gluten`
                  : 'Cette recette ne contient pas de gluten'
              }
            >
              <Ban className="size-2 shrink-0" strokeWidth={2.5} />
              Sans Glu
              {totalSheets > 1 && (
                <span className="opacity-70">
                  {' '}
                  {gfCount}/{totalSheets}
                </span>
              )}
            </span>
          )}
          {/* Sans porc — affiché si la recette en a au moins une fiche
              sans porc ET n'est pas déjà étiquetée Végé (sinon redondant). */}
          {dietary.isPorkFree && !dietary.isVegetarian && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sky-100 px-1 py-0.5 text-[0.5rem] font-bold uppercase tracking-tight text-sky-700 ring-1 ring-sky-300"
              title="Cette recette ne contient pas de porc"
            >
              <Ban className="size-2 shrink-0" strokeWidth={2.5} />
              Sans porc
            </span>
          )}
        </div>
      )}
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

        {/* Favori (bookmark) — HAUT GAUCHE.
            Convention type Instagram : ❤️ = like public, 🔖 = favori privé. */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite(recipe.id);
          }}
          aria-label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          aria-pressed={isFavorite}
          className="absolute left-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-full bg-white/90 shadow-sm transition hover:scale-110"
        >
          <Bookmark
            className={
              isFavorite
                ? 'h-4 w-4 fill-coral text-coral'
                : 'h-4 w-4 text-coral'
            }
            strokeWidth={2}
          />
        </button>

        {/* Like (compteur public) — HAUT DROITE.
            Toggle : tap pour liker, re-tap pour retirer le like. */}
        <button
          type="button"
          onClick={handleLike}
          aria-label={hasLiked ? `Retirer mon j'aime (${likes})` : "J'aime"}
          aria-pressed={hasLiked}
          className="absolute right-2 top-2 z-20 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 shadow-sm transition hover:scale-110"
        >
          <Heart
            className={
              hasLiked
                ? 'h-4 w-4 fill-coral text-coral'
                : 'h-4 w-4 text-coral'
            }
            strokeWidth={2}
          />
          <span className="text-[0.65rem] font-bold text-coral-dark">
            {likes}
          </span>
        </button>
      </div>

      {/* Titre + Nutri-Score moyen + compteur de likes centrés sous la tuile */}
      <p
        className="mt-2 truncate text-center text-sm font-bold leading-tight text-ink"
        title={recipe.title}
      >
        {recipe.title}
      </p>
      {nutriScore && nutriScore.confidence >= 0.5 && (
        <div className="mt-1.5 flex justify-center">
          <NutriScoreBadge
            grade={nutriScore.grade}
            size="sm"
            headerVariant="karine"
          />
        </div>
      )}
    </div>
  );
}
