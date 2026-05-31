import Link from 'next/link';
import { Heart, Flame } from 'lucide-react';
import type { Recipe, RecipeCategory } from '@/data/recipes';
import { CATEGORY_LABELS, CATEGORY_SLUG } from '@/data/recipes';
import { SeasonChip } from './SeasonChip';
import { RealBadge } from './RealBadge';

type Props = {
  category: RecipeCategory;
  featured: Recipe | null;
  stack: Recipe[]; // jusqu'à 3, par ordre d'apparition (le 1er = devant)
  totalCount: number;
};

export function CategoryDeck({ category, featured, stack }: Props) {
  const href = `/recettes/${CATEGORY_SLUG[category]}`;

  return (
    <section className="space-y-3">
      {/* Titre centré (cliquable, mène à la grille complète) */}
      <Link
        href={href}
        className="mx-auto flex w-fit items-center justify-center gap-2 font-script text-3xl text-coral"
      >
        {CATEGORY_LABELS[category]}
        <Heart className="h-5 w-5 fill-coral/30 text-coral" />
      </Link>

      {featured ? (
        <Link
          href={href}
          aria-label={`Voir toutes les ${CATEGORY_LABELS[category].toLowerCase()}`}
          className="relative mx-auto block aspect-square w-full max-w-[16rem] pt-3"
        >
          {/* Cartes empilées derrière, décalages plus marqués */}
          {stack.slice(0, 3).map((r, i) => (
            <span
              key={r.id}
              aria-hidden
              className="absolute inset-0 rounded-[var(--radius-tile)] bg-cover bg-center shadow-md ring-1 ring-coral-soft/40"
              style={{
                backgroundImage: `url(${r.coverImage})`,
                transform: deckTransform(i + 1),
                zIndex: 3 - i,
              }}
            />
          ))}

          {/* Carte à la une, devant */}
          <span
            aria-hidden
            className="absolute inset-0 overflow-hidden rounded-[var(--radius-tile)] bg-cover bg-center shadow-lg ring-1 ring-white"
            style={{
              backgroundImage: `url(${featured.coverImage})`,
              transform: deckTransform(0),
              zIndex: 10,
            }}
          />

          {/* Badges (calories + À la une) sur la carte avant */}
          <span
            className="pointer-events-none absolute bottom-2 left-2 z-20 flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-coral-dark shadow-sm"
            style={{ transform: deckTransform(0) }}
          >
            <Flame className="h-3.5 w-3.5" />
            {featured.calories ?? '—'} kcal
          </span>
          <span
            className="pointer-events-none absolute right-2 top-2 z-20 rounded-full bg-white/90 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-coral shadow-sm"
            style={{ transform: deckTransform(0) }}
          >
            À la une
          </span>

          {/* Étiquette "Légumes de saison" en coin haut-gauche, débordante */}
          {/* z-20 (pas z-30) pour rester SOUS le sticky header de la page recettes */}
          {featured.isSeasonal && (
            <span
              className="pointer-events-none absolute -left-3 -top-5 z-20"
              style={{ transform: deckTransform(0) }}
            >
              <SeasonChip />
            </span>
          )}

          {/* Badge "Réel" si la recette a des photos de prépa */}
          {featured.prepPhotos.length > 0 && (
            <span
              className="pointer-events-none absolute bottom-2 right-2 z-20"
              style={{ transform: deckTransform(0) }}
            >
              <RealBadge />
            </span>
          )}
        </Link>
      ) : (
        <div className="rounded-[var(--radius-tile)] border border-dashed border-coral-soft/60 bg-white/40 px-4 py-10 text-center text-sm text-ink-soft">
          Bientôt de nouvelles {CATEGORY_LABELS[category].toLowerCase()}
        </div>
      )}

      {featured && (
        <>
          <p className="text-center text-sm font-bold leading-tight text-ink">{featured.title}</p>
          <p className="flex items-center justify-center gap-1 text-xs font-semibold text-coral-dark">
            <Heart className="h-3.5 w-3.5 fill-coral text-coral" />
            {featured.likesCount}
          </p>
        </>
      )}
    </section>
  );
}

// 0 = devant (centrée), 1..3 = cartes derrière avec rotation + offset croissants.
// Valeurs ajustées pour que les cartes du dessous soient bien visibles.
function deckTransform(layer: number): string {
  if (layer === 0) return 'rotate(0deg) translate(0, 0)';
  const rotations = [-8, 7, -5]; // °
  const offsets = [
    { x: -18, y: 12 },
    { x: 22, y: 18 },
    { x: -10, y: 26 },
  ];
  const r = rotations[layer - 1] ?? 0;
  const o = offsets[layer - 1] ?? { x: 0, y: 0 };
  return `rotate(${r}deg) translate(${o.x}px, ${o.y}px) scale(0.93)`;
}
