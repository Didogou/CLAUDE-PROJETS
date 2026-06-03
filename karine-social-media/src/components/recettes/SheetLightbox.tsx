'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Printer,
  Share2,
  X,
} from 'lucide-react';
import { ZoomableImage } from '@/components/ui/ZoomableImage';
import { useLightboxAnim } from '@/lib/use-lightbox-anim';
import { AddSheetToListButton } from '@/components/courses/AddSheetToListButton';
import type { RecipeSheet, RecipeIngredient } from '@/data/recipes';

type Props = {
  sheets: RecipeSheet[];
  startIndex: number;
  isAuthenticated: boolean;
  recipeTitle: string;
  onClose: () => void;
};

/**
 * Lightbox plein écran dédiée aux fiches recettes.
 *
 * Layout :
 *   - PC : image gauche (ZoomableImage) / panneau droit (titre +
 *     ingrédients + bouton "Ajouter à ma liste")
 *   - Mobile : image en haut, panneau ingrédients en bas (scroll)
 *
 * Inspiré de SaviezVousLightbox (createPortal + useLightboxAnim) mais
 * avec un panneau d'infos exploitable plutôt que juste un caption.
 */
export function SheetLightbox({
  sheets,
  startIndex,
  isAuthenticated,
  recipeTitle,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(startIndex);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const { phase, requestClose } = useLightboxAnim(onClose);

  const total = sheets.length;
  const sheet = sheets[index];
  const multi = total > 1;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    if (!multi) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + total) % total);
      else if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multi, total]);

  function next() {
    if (multi) setIndex((i) => (i + 1) % total);
  }
  function prev() {
    if (multi) setIndex((i) => (i - 1 + total) % total);
  }

  async function handleShare() {
    const shareData = {
      title: `${recipeTitle}${sheet.title ? ` — ${sheet.title}` : ''}`,
      url: typeof window !== 'undefined' ? window.location.href : '',
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareData.url);
      setShareToast('Lien copié');
      setTimeout(() => setShareToast(null), 2000);
    } catch {
      /* ignore */
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm print:bg-white print:backdrop-blur-none ${
        phase === 'exit' ? 'ie-lightbox-out' : 'ie-lightbox-in'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={sheet.title ?? 'Fiche recette agrandie'}
    >
      {/* Header : titre fiche + compteur + bouton fermer */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-start gap-3 bg-gradient-to-b from-black/55 to-transparent px-4 py-3 sm:px-6 sm:py-4 print:hidden">
        <p className="flex-1 truncate font-script text-2xl text-white sm:text-3xl">
          {sheet.title ?? recipeTitle}
        </p>
        {multi && (
          <span className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm">
            {index + 1} / {total}
          </span>
        )}
        <button
          type="button"
          onClick={requestClose}
          aria-label="Fermer"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-ink shadow-lg ring-2 ring-white/30 transition hover:scale-105"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Body : image (gauche/haut) + panneau ingrédients (droite/bas) */}
      <div
        key={sheet.id}
        className={`absolute inset-0 flex flex-col gap-3 px-4 pb-24 pt-16 sm:gap-4 sm:px-8 sm:pt-20 lg:flex-row lg:gap-6 lg:px-12 ${
          phase === 'exit' ? 'ie-lightbox-content-out' : 'ie-lightbox-content-in'
        }`}
      >
        {/* Image — pinch-to-zoom + swipe inter-fiche */}
        <div className="relative min-h-0 flex-1 lg:flex-[1.4]">
          <ZoomableImage
            src={sheet.coverImageUrl}
            alt={sheet.title ?? ''}
            className="absolute inset-0"
            imgClassName="max-h-full max-w-full rounded-2xl shadow-2xl"
            onSwipeLeft={multi ? next : undefined}
            onSwipeRight={multi ? prev : undefined}
          />
        </div>

        {/* Panneau ingrédients + actions */}
        <aside className="flex max-h-[40vh] flex-col gap-3 overflow-y-auto rounded-2xl bg-white/95 p-4 shadow-2xl lg:max-h-none lg:w-[22rem] lg:p-5 print:hidden">
          <IngredientsPanel ingredients={sheet.ingredients} />

          {isAuthenticated && (
            <div className="border-t border-cream pt-3">
              <AddSheetToListButton
                sheetId={sheet.id}
                hasIngredients={sheet.ingredients.length > 0}
              />
            </div>
          )}
        </aside>
      </div>

      {/* Flèches latérales — entre l'image et les bords */}
      {multi && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Précédente"
            className="absolute left-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105 sm:left-3 sm:h-12 sm:w-12 print:hidden"
          >
            <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Suivante"
            className="absolute right-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105 sm:right-3 sm:h-12 sm:w-12 print:hidden"
          >
            <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
          </button>
        </>
      )}

      {/* Footer : actions (Partager / Imprimer / J'aime local) */}
      <footer className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-3 bg-gradient-to-t from-black/55 to-transparent px-4 pb-6 pt-4 sm:gap-4 sm:px-6 print:hidden">
        <ActionButton icon={Share2} label="Partager" onClick={handleShare} />
        <ActionButton
          icon={Printer}
          label="Imprimer"
          onClick={() => window.print()}
        />
        <ActionButton
          icon={Heart}
          label={liked[sheet.id] ? 'Liké' : 'J’aime'}
          onClick={() => setLiked((m) => ({ ...m, [sheet.id]: !m[sheet.id] }))}
          active={!!liked[sheet.id]}
        />
      </footer>

      {shareToast && (
        <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink shadow-lg print:hidden">
          {shareToast}
        </div>
      )}
    </div>,
    document.body,
  );
}

function IngredientsPanel({ ingredients }: { ingredients: RecipeIngredient[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, RecipeIngredient[]>();
    for (const it of ingredients) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return [...map.entries()];
  }, [ingredients]);

  if (ingredients.length === 0) {
    return (
      <p className="rounded-lg bg-cream/60 px-3 py-2 text-sm italic text-ink-soft">
        Ingrédients non extraits pour cette fiche.
      </p>
    );
  }

  return (
    <div>
      <h3 className="mb-2 font-script text-xl text-coral">Ingrédients</h3>
      <div className="space-y-2 text-sm text-ink">
        {grouped.map(([cat, items]) => (
          <div key={cat}>
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
              {cat}
            </p>
            <ul>
              {items.map((it, idx) => (
                <li key={idx}>• {formatIngredient(it)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: typeof Heart;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex flex-col items-center gap-1 rounded-full px-3 py-2 text-white shadow-lg ring-2 ring-white/30 transition hover:scale-105 ${
        active ? 'bg-coral' : 'bg-white/20 backdrop-blur-sm hover:bg-white/30'
      }`}
    >
      <Icon
        className={`h-5 w-5 ${active ? 'fill-current' : ''}`}
        strokeWidth={2.2}
      />
      <span className="text-[0.65rem] font-semibold uppercase tracking-wider">
        {label}
      </span>
    </button>
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
