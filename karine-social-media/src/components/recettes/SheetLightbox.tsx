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
import { PortionsStepper } from './PortionsStepper';
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
/** Event dispatché par toute instance qui toggle le like d'UNE fiche
 *  précise. detail = { sheetId, liked }. Les autres instances (Sheet
 *  Carousel) ne mettent à jour QUE cette fiche-là. */
const SHEET_LIKE_EVENT = 'sheet-like-toggled';

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
  /** Like PAR fiche détaillée (chaque sheet est une recette à part
   *  entière). Indexé par sheet.id. */
  const [likedBySheet, setLikedBySheet] = useState<Record<string, boolean>>({});
  /** Nb de personnes choisi (par sheet, pour s'adapter à la sheet active). */
  const [portionsBySheet, setPortionsBySheet] = useState<Record<string, number>>({});
  const { phase, requestClose } = useLightboxAnim(onClose);

  // Sync inter-instances : on n'update QUE la sheet ciblée par l'event.
  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent<{ sheetId: string; liked: boolean }>).detail;
      if (!detail || typeof detail.sheetId !== 'string' || typeof detail.liked !== 'boolean') return;
      setLikedBySheet((prev) =>
        prev[detail.sheetId] === detail.liked ? prev : { ...prev, [detail.sheetId]: detail.liked },
      );
    };
    window.addEventListener(SHEET_LIKE_EVENT, onSync);
    return () => window.removeEventListener(SHEET_LIKE_EVENT, onSync);
  }, []);

  function toggleLike() {
    const sheetId = sheet.id;
    const next = !likedBySheet[sheetId];
    setLikedBySheet((prev) => ({ ...prev, [sheetId]: next }));
    window.dispatchEvent(
      new CustomEvent(SHEET_LIKE_EVENT, { detail: { sheetId, liked: next } }),
    );
  }

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

  /**
   * Imprime la fiche : ouvre une nouvelle fenêtre avec un HTML dédié
   * (image + ingrédients) et lance la print dès que l'image est chargée.
   * Plus fiable que window.print sur la lightbox actuelle (problèmes
   * de display/visibility quand on est dans un portail react).
   */
  function handlePrintCurrent() {
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) return;
    const ingredientsHtml = renderIngredientsHtml(sheet.ingredients);
    const title = (sheet.title ?? recipeTitle).replace(/[<>]/g, '');
    w.document.write(`<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: A4 portrait; margin: 1.2cm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2937; margin: 0; padding: 0; }
  h1 { font-size: 1.5rem; text-align: center; margin: 0 0 0.6cm; color: #b91c1c; }
  .img-wrap { text-align: center; margin-bottom: 0.6cm; }
  .img-wrap img { max-width: 100%; max-height: 12cm; object-fit: contain; border-radius: 0.4cm; }
  h2 { font-size: 1.1rem; color: #b91c1c; margin: 0.4cm 0 0.2cm; }
  .cat { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #b91c1c; margin: 0.3cm 0 0.1cm; }
  ul { margin: 0; padding-left: 1.2em; }
  li { font-size: 0.95rem; line-height: 1.5; }
  .empty { font-style: italic; color: #6b7280; }
</style>
</head><body>
  <h1>${title}</h1>
  <div class="img-wrap"><img src="${sheet.coverImageUrl}" alt="" /></div>
  <h2>Ingrédients</h2>
  ${ingredientsHtml}
</body></html>`);
    w.document.close();
    w.focus();
    // Attendre que l'image soit chargée avant d'imprimer (sinon page blanche)
    const img = w.document.querySelector('img');
    if (img && !img.complete) {
      img.addEventListener('load', () => w.print(), { once: true });
      img.addEventListener('error', () => w.print(), { once: true });
    } else {
      // Image déjà cachée / instantanée
      setTimeout(() => w.print(), 100);
    }
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
      className={`sheet-lightbox fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm print:bg-white print:backdrop-blur-none ${
        phase === 'exit' ? 'ie-lightbox-out' : 'ie-lightbox-in'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={sheet.title ?? 'Fiche recette agrandie'}
    >
      {/* Header : titre fiche + compteur + bouton fermer.
          Titre autorisé à passer sur 2 lignes en mobile pour ne pas être
          tronqué (UX demandée 2026-06-03). */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-start gap-3 bg-gradient-to-b from-black/55 to-transparent px-4 py-3 sm:px-6 sm:py-4 print:hidden">
        <p className="line-clamp-2 flex-1 font-script text-xl leading-tight text-white sm:text-3xl">
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

      {/* Body : image + panneau ingrédients.
          Mobile : empilés verticalement, image flex-1 prend tout l espace
                   restant, panneau cale en bas (max-h-[40vh]).
          PC : alignés horizontalement, centrés (justify-center), marge
               agréable entre image et panneau (lg:gap-6). */}
      <div
        key={sheet.id}
        className={`absolute inset-0 flex flex-col gap-3 px-4 pb-24 pt-16 sm:px-8 sm:pt-20 lg:flex-row lg:items-center lg:justify-center lg:gap-6 lg:px-4 ${
          phase === 'exit' ? 'ie-lightbox-content-out' : 'ie-lightbox-content-in'
        }`}
      >
        {/* Image — pinch-to-zoom + swipe inter-fiche.
            Mobile : flex-1 prend tout l'espace vertical disponible.
            PC : carré fixe via h/w simples (Tailwind peut mal parser
            min() avec virgule dans arbitrary values). aspect-square +
            max-h-[85vh] s'assure que l'image reste dans le viewport
            même sur petits écrans PC. */}
        <div className="relative min-h-0 flex-1 self-stretch lg:aspect-square lg:flex-none lg:h-[32rem] lg:w-[32rem] lg:max-h-[85vh] lg:max-w-[85vh] lg:self-auto xl:h-[38rem] xl:w-[38rem]">
          <ZoomableImage
            src={sheet.coverImageUrl}
            alt={sheet.title ?? ''}
            className="absolute inset-0"
            imgClassName="max-h-full max-w-full rounded-2xl shadow-2xl"
            onSwipeLeft={multi ? next : undefined}
            onSwipeRight={multi ? prev : undefined}
          />
        </div>

        {/* Panneau ingrédients + actions — sous l'image en mobile,
            collé à droite de l'image en PC. bg-white/80 + backdrop-blur
            pour un fond doucement transparent (laisse percevoir l image
            zoomée derriere). */}
        <aside className="mx-auto flex max-h-[40vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-2xl bg-white/80 p-4 shadow-2xl backdrop-blur-md lg:mx-0 lg:max-h-[85vh] lg:w-[22rem] lg:p-5 print:hidden">
          <IngredientsPanel ingredients={sheet.ingredients} />

          {isAuthenticated && (
            <div className="flex items-end gap-3 border-t border-cream pt-3">
              <PortionsStepper
                value={portionsBySheet[sheet.id] ?? sheet.servings}
                onChange={(v) =>
                  setPortionsBySheet((prev) => ({ ...prev, [sheet.id]: v }))
                }
              />
              <div className="min-w-0 flex-1">
                <AddSheetToListButton
                  sheetId={sheet.id}
                  hasIngredients={sheet.ingredients.length > 0}
                  portionsOverride={
                    portionsBySheet[sheet.id] ?? sheet.servings
                  }
                />
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Flèches latérales — proches de l'image+panneau (pas aux bords).
          Sur PC : positionnées à ~10vw du bord (collées au container
          image+panneau qui fait ~50rem au centre). Mobile : aux bords. */}
      {multi && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Précédente"
            className="absolute left-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105 sm:left-4 sm:h-12 sm:w-12 lg:left-[8vw] xl:left-[12vw] print:hidden"
          >
            <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Suivante"
            className="absolute right-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105 sm:right-4 sm:h-12 sm:w-12 lg:right-[8vw] xl:right-[12vw] print:hidden"
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
          onClick={handlePrintCurrent}
        />
        <ActionButton
          icon={Heart}
          label={likedBySheet[sheet.id] ? 'Liké' : 'J’aime'}
          onClick={toggleLike}
          active={!!likedBySheet[sheet.id]}
        />
      </footer>

      {shareToast && (
        <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink shadow-lg print:hidden">
          {shareToast}
        </div>
      )}

      {/* CSS print : 1 seule page A4 portrait avec image en haut et
          panneau ingrédients en bas.
          On utilise visibility (pas display:none) car createPortal injecte
          la lightbox comme enfant de body et display:none sur le body
          casse tout. visibility:hidden sur le body + visible sur la
          lightbox isole correctement. */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 1cm; }
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            visibility: hidden !important;
          }
          .sheet-lightbox,
          .sheet-lightbox * {
            visibility: visible !important;
          }
          .sheet-lightbox {
            position: absolute !important;
            inset: 0 !important;
            background: #fff !important;
            backdrop-filter: none !important;
          }
          .sheet-lightbox > .ie-lightbox-content-in,
          .sheet-lightbox > .ie-lightbox-content-out,
          .sheet-lightbox > div[class*="lightbox-content"] {
            position: static !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            gap: 0.5cm !important;
            padding: 0 !important;
          }
          .sheet-lightbox img {
            max-width: 100% !important;
            max-height: 14cm !important;
            object-fit: contain !important;
            margin: 0 auto !important;
            display: block !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .sheet-lightbox aside {
            background: #fff !important;
            box-shadow: none !important;
            max-height: none !important;
            overflow: visible !important;
            page-break-inside: avoid !important;
            width: 100% !important;
            max-width: 100% !important;
          }
        }
      `}</style>
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
      title={label}
      className={`grid h-12 w-12 place-items-center rounded-full text-white shadow-lg ring-2 ring-white/30 transition hover:scale-110 ${
        active ? 'bg-coral' : 'bg-white/20 backdrop-blur-sm hover:bg-white/30'
      }`}
    >
      <Icon
        className={`h-5 w-5 ${active ? 'fill-current' : ''}`}
        strokeWidth={2.2}
      />
    </button>
  );
}

/** Génère le HTML de la liste d'ingrédients pour la fenêtre d'impression. */
function renderIngredientsHtml(ingredients: RecipeIngredient[]): string {
  if (ingredients.length === 0) {
    return '<p class="empty">Ingrédients non extraits pour cette fiche.</p>';
  }
  const map = new Map<string, RecipeIngredient[]>();
  for (const it of ingredients) {
    if (!map.has(it.category)) map.set(it.category, []);
    map.get(it.category)!.push(it);
  }
  const parts: string[] = [];
  for (const [cat, items] of map) {
    parts.push(`<p class="cat">${escapeHtml(cat)}</p><ul>`);
    for (const it of items) {
      parts.push(`<li>${escapeHtml(formatIngredient(it))}</li>`);
    }
    parts.push('</ul>');
  }
  return parts.join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
