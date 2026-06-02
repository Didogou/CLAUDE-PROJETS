/* eslint-disable @next/next/no-img-element */
'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Moon,
  Printer,
  Share2,
  Sun,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import type { WeeklyMenu, WeeklyMenuDay } from '@/data/menus';
import { DAYS_LABELS } from '@/data/menus';
import type { Recipe } from '@/data/recipes';
import { RecipeCard } from '@/components/recettes/RecipeCard';
import { FireworkBurst } from '@/components/recettes/FireworkBurst';

export function DayPagerView({
  menu,
  defaultDayIndex,
  recipesBySlug,
}: {
  menu: WeeklyMenu;
  defaultDayIndex: number;
  recipesBySlug: Record<string, Recipe>;
}) {
  const [idx, setIdx] = useState(defaultDayIndex);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [floatingHearts, setFloatingHearts] = useState<number[]>([]);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const day = menu.days.find((d) => d.dayIndex === idx);

  const toggleFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function toggleLike() {
    const heartId = Date.now() + Math.random();
    setFloatingHearts((arr) => [...arr, heartId]);
    setTimeout(() => setFloatingHearts((arr) => arr.filter((x) => x !== heartId)), 1100);
    if (liked) {
      setLiked(false);
      setLikes((n) => Math.max(0, n - 1));
    } else {
      setLiked(true);
      setLikes((n) => n + 1);
    }
  }

  async function handleShare() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: `${DAYS_LABELS[idx]} — ${menu.weekStart}`, url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* annulé */
    }
  }

  // Image à imprimer pour chaque repas : priorité = recette cover, sinon image upload du jour
  const lunchPrintImg =
    (day?.lunchRecipeSlug && recipesBySlug[day.lunchRecipeSlug]?.coverImage) ||
    day?.lunchImageUrl ||
    '';
  const dinnerPrintImg =
    (day?.dinnerRecipeSlug && recipesBySlug[day.dinnerRecipeSlug]?.coverImage) ||
    day?.dinnerImageUrl ||
    '';

  return (
    <>
    {/* ============== VUE IMPRESSION : 2 pages plein écran ============== */}
    {day && (
      <div className="hidden print:block">
        {lunchPrintImg && (
          <div className="print-page">
            <img src={lunchPrintImg} alt={`Déjeuner ${DAYS_LABELS[idx]}`} />
          </div>
        )}
        {dinnerPrintImg && (
          <div className="print-page print-page-last">
            <img src={dinnerPrintImg} alt={`Dîner ${DAYS_LABELS[idx]}`} />
          </div>
        )}
      </div>
    )}

    {/* ============== VUE ÉCRAN ============== */}
    <div className="space-y-5 print:hidden">
      {/* Slider jours — barre fine */}
      <div className="flex items-center justify-between gap-2 rounded-full bg-white/85 px-2 py-1 shadow-sm">
        <button
          type="button"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          aria-label="Jour précédent"
          className="grid h-7 w-7 place-items-center rounded-full bg-coral-soft/60 text-coral-dark transition hover:bg-coral-soft disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="font-script text-xl text-coral">{DAYS_LABELS[idx]}</p>
        <button
          type="button"
          onClick={() => setIdx((i) => Math.min(6, i + 1))}
          disabled={idx === 6}
          aria-label="Jour suivant"
          className="grid h-7 w-7 place-items-center rounded-full bg-coral-soft/60 text-coral-dark transition hover:bg-coral-soft disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {day ? (
        // Re-monte le bloc à chaque changement de jour → re-spawn des feux d'artifice
        <div key={idx} className="space-y-4">
          {day.coverImageUrl && (
            <div className="mx-auto max-w-md overflow-hidden rounded-[var(--radius-card)] shadow-md">
              <span
                aria-hidden
                className="block aspect-[4/3] w-full bg-cover bg-center"
                style={{ backgroundImage: `url(${day.coverImageUrl})` }}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:gap-6">
            <MealTile
              kind="lunch"
              day={day}
              recipe={day.lunchRecipeSlug ? recipesBySlug[day.lunchRecipeSlug] : undefined}
              isFavorite={day.lunchRecipeSlug ? favorites.has(day.lunchRecipeSlug) : false}
              onToggleFavorite={toggleFavorite}
              onZoom={(src) => setZoomImage(src)}
            />
            <MealTile
              kind="dinner"
              day={day}
              recipe={day.dinnerRecipeSlug ? recipesBySlug[day.dinnerRecipeSlug] : undefined}
              isFavorite={day.dinnerRecipeSlug ? favorites.has(day.dinnerRecipeSlug) : false}
              onToggleFavorite={toggleFavorite}
              onZoom={(src) => setZoomImage(src)}
            />
          </div>

          {/* Pellicule "En vrai dans la cuisine" */}
          {day.prepPhotos.length > 0 && (
            <section className="space-y-2 pt-1">
              <h3 className="font-script text-xl text-coral">En vrai dans la cuisine</h3>
              <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2">
                {day.prepPhotos.map((src, i) => (
                  <button
                    key={src + i}
                    type="button"
                    onClick={() => setZoomImage(src)}
                    className="block w-28 shrink-0 snap-start transition hover:-translate-y-0.5 sm:w-32"
                    aria-label={`Agrandir la photo ${i + 1}`}
                  >
                    <span
                      aria-hidden
                      className="block aspect-square w-full rounded-xl bg-cover bg-center shadow-sm ring-1 ring-coral-soft/40"
                      style={{ backgroundImage: `url(${src})` }}
                    />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Barre d'actions */}
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleShare}
              aria-label="Partager"
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 hover:bg-coral-soft/40"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={toggleLike}
                aria-pressed={liked}
                aria-label={liked ? 'Je n’aime plus' : 'J’aime'}
                className="flex items-center gap-1 rounded-full bg-white py-0.5 pl-0.5 pr-2.5 shadow-sm transition hover:scale-105"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full">
                  <Heart
                    className={`h-4 w-4 ${liked ? 'fill-coral text-coral' : 'text-coral'}`}
                    strokeWidth={2}
                  />
                </span>
                <span className="text-xs font-semibold text-coral-dark">{likes}</span>
              </button>
              {floatingHearts.map((id) => (
                <img
                  key={id}
                  src="/images/effects/coeur.webp"
                  alt=""
                  aria-hidden
                  draggable={false}
                  className="floating-heart pointer-events-none absolute left-2 top-0 h-7 w-auto select-none"
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              aria-label="Imprimer"
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 hover:bg-coral-soft/40"
            >
              <Printer className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <p className="rounded-xl bg-white/40 px-3 py-2 text-center text-xs text-ink-soft">
          Pas de plat renseigné pour {DAYS_LABELS[idx]}.
        </p>
      )}

      {/* Zoom plein écran image meal / prep */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setZoomImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={zoomImage}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-auto rounded-[var(--radius-card)] shadow-2xl"
          />
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setZoomImage(null)}
            className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-white/90 text-ink transition hover:bg-white"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      )}

      {/* Animation cœur flottant */}
      <style>{`
        @keyframes float-heart {
          0%   { transform: translate(-50%, 10px) scale(0.5); opacity: 0; }
          15%  { transform: translate(-50%, -6px) scale(1.25); opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translate(-50%, -90px) scale(0.95); opacity: 0; }
        }
        .floating-heart {
          animation: float-heart 1.1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .floating-heart { animation: none; opacity: 0; }
        }
        /* Vue impression : 1 page par tuile, image en pleine page centrée */
        @media print {
          @page { margin: 0.5cm; size: auto; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .print-page {
            width: 100vw;
            height: 100vh;
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            page-break-after: always;
            break-after: page;
            overflow: hidden;
          }
          .print-page-last {
            page-break-after: auto;
            break-after: auto;
          }
          .print-page img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
          }
        }
      `}</style>
    </div>
    </>
  );
}

function MealTile({
  kind,
  day,
  recipe,
  isFavorite,
  onToggleFavorite,
  onZoom,
}: {
  kind: 'lunch' | 'dinner';
  day: WeeklyMenuDay;
  recipe?: Recipe;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onZoom: (src: string) => void;
}) {
  const isLunch = kind === 'lunch';
  const label = isLunch ? day.lunchLabel : day.dinnerLabel;
  const imageUrl = isLunch ? day.lunchImageUrl : day.dinnerImageUrl;
  const title = isLunch ? 'Déjeuner' : 'Dîner';
  const Icon = isLunch ? Sun : Moon;
  const burstCat = isLunch ? 'plat' : 'entree';

  return (
    <div className="space-y-1.5">
      <p className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wide text-coral-dark">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <div className="relative overflow-visible">
        <FireworkBurst category={burstCat} count={6} />
        {recipe ? (
          <RecipeCard recipe={recipe} isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-tile)] bg-white/85 shadow-sm">
            {imageUrl ? (
              <button
                type="button"
                onClick={() => onZoom(imageUrl)}
                className="block w-full"
                aria-label={`Agrandir ${title.toLowerCase()}`}
              >
                <span
                  aria-hidden
                  className="block aspect-square w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${imageUrl})` }}
                />
              </button>
            ) : (
              <span
                aria-hidden
                className="block aspect-square w-full"
                style={{ backgroundColor: 'var(--color-coral-soft)' }}
              />
            )}
            <p className="px-3 py-2 text-center text-base font-semibold italic leading-tight text-coral-dark">
              {label || '—'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Export retained for compat
export { UtensilsCrossed };
