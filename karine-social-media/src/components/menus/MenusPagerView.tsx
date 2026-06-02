'use client';

import Link from 'next/link';
import { useState } from 'react';
/* eslint-disable @next/next/no-img-element */
import { ChevronLeft, ChevronRight, Heart, Printer, Share2, X } from 'lucide-react';
import type { WeeklyMenu } from '@/data/menus';
import { formatWeekTitle } from '@/data/menus';
import { FireworkBurst } from '@/components/recettes/FireworkBurst';

/**
 * Carousel des menus de la semaine (le plus récent en premier).
 * - Slider en haut : navigation entre semaines
 * - Menu et Liste de courses côte à côte (même taille, centrés)
 * - Barre d'actions : Partager / Like / Imprimer
 */
export function MenusPagerView({ menus }: { menus: WeeklyMenu[] }) {
  const [idx, setIdx] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [floatingHearts, setFloatingHearts] = useState<number[]>([]);
  const [shoppingZoom, setShoppingZoom] = useState(false);

  if (menus.length === 0) {
    return (
      <p className="rounded-[var(--radius-tile)] border border-dashed border-coral-soft/60 bg-white/40 px-4 py-10 text-center text-sm text-ink-soft">
        Pas encore de menu publié — reviens vite&nbsp;!
      </p>
    );
  }

  const current = menus[idx];
  const isFirst = idx === menus.length - 1; // semaine la plus ancienne
  const isLast = idx === 0; // semaine la plus récente
  // Jusqu'à 3 menus précédents derrière (effet pile)
  const stack = menus.slice(idx + 1, idx + 4);
  // La liste interactive (cochable + multiplication) est disponible dès
  // que Karine a fait passer l'image dans Claude Vision et validé les items.
  const hasInteractiveList =
    Array.isArray(current.shoppingListItems) && current.shoppingListItems.length > 0;

  function toggleLike() {
    // Spawn d'un cœur flottant à chaque tap (même répétés)
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
    const title = current.title || formatWeekTitle(current.weekStart);
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* annulé */
    }
  }

  return (
    <>
    {/* ============== VUE IMPRESSION : 2 pages plein écran ============== */}
    <div className="hidden print:block">
      <div className="print-page">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.coverImageUrl} alt="Menu de la semaine" />
      </div>
      {current.shoppingListImageUrl && (
        <div className="print-page print-page-last">
          <img src={current.shoppingListImageUrl} alt="Liste de courses" />
        </div>
      )}
    </div>

    {/* ============== VUE ÉCRAN ============== */}
    <div className="space-y-5 print:hidden">
      {/* Slider de semaines — barre fine */}
      <div className="flex items-center justify-between gap-2 rounded-full bg-white/85 px-2 py-1 shadow-sm">
        <button
          type="button"
          onClick={() => setIdx((i) => i + 1)}
          disabled={isFirst}
          aria-label="Semaine précédente"
          className="grid h-7 w-7 place-items-center rounded-full bg-coral-soft/60 text-coral-dark transition hover:bg-coral-soft disabled:opacity-30 print:hidden"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-0 truncate text-center text-xs font-bold text-coral-dark">
          {current.title || formatWeekTitle(current.weekStart)}
        </p>
        <button
          type="button"
          onClick={() => setIdx((i) => i - 1)}
          disabled={isLast}
          aria-label="Semaine suivante"
          className="grid h-7 w-7 place-items-center rounded-full bg-coral-soft/60 text-coral-dark transition hover:bg-coral-soft disabled:opacity-30 print:hidden"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Menu + Liste de courses côte à côte (PC) / empilés (mobile) */}
      <div className="mx-auto grid w-full grid-cols-1 justify-items-center gap-6 sm:grid-cols-2 lg:gap-8">
        {/* Menu de la semaine avec pile de cartes des semaines précédentes derrière */}
        <div className="flex w-full max-w-sm flex-col items-center gap-1.5">
          <div className="relative aspect-[3/4] w-full overflow-visible pt-4">
            {/* Feu d'artifice au montage */}
            <FireworkBurst category="plat" count={8} />

            {/* Cartes empilées derrière (3 menus précédents si dispo) */}
            {stack.map((m, i) => (
              <span
                key={m.id}
                aria-hidden
                className="absolute inset-0 rounded-[var(--radius-card)] bg-cover bg-center shadow-md ring-1 ring-coral-soft/40"
                style={{
                  backgroundImage: `url(${m.coverImageUrl})`,
                  transform: deckTransform(i + 1),
                  zIndex: 3 - i,
                }}
              />
            ))}

            {/* Carte du menu actuel (devant) */}
            <Link
              href={`/menus/${current.id}/jour`}
              aria-label="Voir le détail du jour"
              className="absolute inset-0 z-10 block overflow-hidden rounded-[var(--radius-card)] shadow-lg ring-1 ring-white transition hover:-translate-y-0.5 hover:shadow-xl"
            >
              <span
                aria-hidden
                className="block h-full w-full bg-cover bg-center"
                style={{
                  backgroundImage: `url(${current.coverImageUrl})`,
                  backgroundColor: 'var(--color-coral-soft)',
                }}
              />
            </Link>
          </div>
          <p className="text-center font-script text-base text-coral">Menu de la semaine</p>
        </div>

        {/* Liste de courses : si liste interactive disponible → page dédiée
            (cochage + multiplication par nb de personnes). Sinon, zoom de
            l'image legacy. Si rien → placeholder. */}
        <div className="flex w-full max-w-sm flex-col items-center gap-1.5">
          <div className="relative w-full overflow-visible">
            <FireworkBurst category="entree" count={8} />
            {hasInteractiveList ? (
              <Link
                href={`/menus/${current.id}/liste-courses`}
                aria-label="Ouvrir la liste de courses interactive"
                className="group relative block w-full overflow-hidden rounded-[var(--radius-card)] shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
              >
                {current.shoppingListImageUrl ? (
                  <img
                    src={current.shoppingListImageUrl}
                    alt="Liste de courses"
                    className="block aspect-[3/4] w-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="block aspect-[3/4] w-full bg-cream"
                  />
                )}
                {/* Badge "interactive" en haut */}
                <span className="absolute right-2 top-2 rounded-full bg-coral px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-white shadow-sm">
                  Cochable
                </span>
              </Link>
            ) : current.shoppingListImageUrl ? (
              <button
                type="button"
                onClick={() => setShoppingZoom(true)}
                aria-label="Agrandir la liste de courses"
                className="block w-full overflow-hidden rounded-[var(--radius-card)] shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
              >
                <img
                  src={current.shoppingListImageUrl}
                  alt="Liste de courses"
                  className="block aspect-[3/4] w-full object-cover"
                />
              </button>
            ) : (
              <span
                aria-hidden
                className="block aspect-[3/4] w-full rounded-[var(--radius-card)] bg-white/60 shadow-md ring-1 ring-coral-soft/40"
              />
            )}
          </div>
          <p className="text-center font-script text-base text-coral">Liste de courses</p>
        </div>
      </div>

      <p className="text-center text-xs italic text-ink-soft print:hidden">
        Tapez sur le menu pour voir le détail du jour
      </p>

      {/* Barre d'actions — icônes compactes */}
      <div className="flex items-center justify-center gap-2 print:hidden">
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
          {/* Cœurs flottants au tap */}
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

      {/* Zoom plein écran de la liste de courses */}
      {shoppingZoom && current.shoppingListImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm print:hidden"
          onClick={() => setShoppingZoom(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Liste de courses agrandie"
        >
          <img
            src={current.shoppingListImageUrl}
            alt="Liste de courses"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-auto rounded-[var(--radius-card)] shadow-2xl"
          />
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setShoppingZoom(false)}
            className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-white/90 text-ink transition hover:bg-white"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      )}

      {/* Animation cœur flottant (déclenchée au tap sur le like) */}
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

// 0 = devant (centrée), 1..3 = cartes derrière avec rotation + offset croissants.
// Inspiré de CategoryDeck (page recettes).
function deckTransform(layer: number): string {
  if (layer === 0) return 'rotate(0deg) translate(0, 0)';
  const rotations = [-8, 7, -5];
  const offsets = [
    { x: -18, y: 12 },
    { x: 22, y: 18 },
    { x: -10, y: 26 },
  ];
  const r = rotations[layer - 1] ?? 0;
  const o = offsets[layer - 1] ?? { x: 0, y: 0 };
  return `rotate(${r}deg) translate(${o.x}px, ${o.y}px) scale(0.93)`;
}
