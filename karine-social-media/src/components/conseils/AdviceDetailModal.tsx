'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react';
import type { Advice } from '@/data/advice';
import { ZoomableImage } from '@/components/ui/ZoomableImage';
import { FavoriteButton } from '@/components/favorites/FavoriteButton';
import { trackView } from '@/lib/recent-views';

/**
 * Modal plein écran qui présente les slides du conseil en grand.
 */
export function AdviceDetailModal({
  advice,
  onClose,
  isAuthenticated = false,
  favoritedSlugs = new Set<string>(),
}: {
  advice: Advice | null;
  onClose: () => void;
  isAuthenticated?: boolean;
  favoritedSlugs?: Set<string>;
}) {
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);
  const [exiting, setExiting] = useState(false);

  // Anim de sortie douce avant unmount
  const requestClose = useCallback(() => {
    setExiting(true);
    window.setTimeout(onClose, 240);
  }, [onClose]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset l'index + reset l'exiting state dès qu'on ouvre un conseil
  // différent. Et on tracke la visite dans l'historique local.
  useEffect(() => {
    if (advice) {
      setIndex(0);
      setExiting(false);
      trackView({
        type: 'advice',
        id: advice.id,
        label: advice.label,
        imageUrl: advice.slides[0] ?? null,
        href: `/conseils?open=${advice.id}`,
      });
    }
  }, [advice]);

  useEffect(() => {
    if (!advice) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const slides = advice.slides;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
      else if (e.key === 'ArrowLeft' && slides.length > 1)
        setIndex((i) => (i - 1 + slides.length) % slides.length);
      else if (e.key === 'ArrowRight' && slides.length > 1)
        setIndex((i) => (i + 1) % slides.length);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [advice, requestClose]);

  if (!mounted || !advice) return null;

  const slides = advice.slides;
  const multi = slides.length > 1;

  function next() {
    setIndex((i) => (i + 1) % slides.length);
  }
  function prev() {
    setIndex((i) => (i - 1 + slides.length) % slides.length);
  }

  const content = (
    <>
      {/* ============== VUE IMPRESSION : 1 page par slide (cover + slides) ============== */}
      <div className="hidden print:block">
        {slides.map((src, i) => (
          <div
            key={src}
            className={`print-page ${i === slides.length - 1 ? 'print-page-last' : ''}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${advice.label} — ${i + 1}/${slides.length}`} />
          </div>
        ))}
      </div>

      {/* ============== VUE ÉCRAN ============== */}
      <div
        className={`fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm print:hidden ${
          exiting ? 'ie-lightbox-out' : 'ie-lightbox-in'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={advice.label}
      >
        {/* ZoomableImage plein écran avec marges. L'image entre en
            scale doux pour eviter l'effet abrupt. */}
        <div
          className={`absolute inset-0 ${
            exiting ? 'ie-lightbox-content-out' : 'ie-lightbox-content-in'
          }`}
        >
          <ZoomableImage
            key={index}
            src={slides[index]}
            alt={`${advice.label} — slide ${index + 1}`}
            className="absolute inset-0 px-4 pb-24 pt-16 sm:px-16"
            imgClassName="max-h-full max-w-full"
            onSwipeLeft={multi ? next : undefined}
            onSwipeRight={multi ? prev : undefined}
          />
        </div>

        {/* Header overlay : label + index + print + close */}
        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/55 to-transparent px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="min-w-0 flex-1 truncate font-script text-2xl text-white sm:text-3xl">
            {advice.label}
          </h2>
          {multi && (
            <span className="pointer-events-auto shrink-0 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm">
              {index + 1}/{slides.length}
            </span>
          )}
          <div className="pointer-events-auto">
            <FavoriteButton
              targetType="advice"
              targetId={advice.id}
              initialFavorited={favoritedSlugs.has(advice.id)}
              isAuthenticated={isAuthenticated}
              size="md"
            />
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            aria-label="Imprimer"
            className="pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/20 text-white shadow-sm backdrop-blur-sm transition hover:bg-white/35"
          >
            <Printer className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Fermer"
            className="pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/20 text-white shadow-sm backdrop-blur-sm transition hover:bg-white/35"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Flèches latérales — visibles mobile ET desktop. Sur mobile elles
            sont legerement plus petites et plus proches du bord pour rester
            confortables au pouce. */}
        {multi && (
          <button
            type="button"
            onClick={prev}
            aria-label="Slide précédente"
            className="absolute left-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105 sm:left-3 sm:h-12 sm:w-12"
          >
            <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
          </button>
        )}
        {multi && (
          <button
            type="button"
            onClick={next}
            aria-label="Slide suivante"
            className="absolute right-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105 sm:right-3 sm:h-12 sm:w-12"
          >
            <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
          </button>
        )}

        {/* Footer overlay : dots + tags. pointer-events-none sur le wrapper
            mais auto sur les boutons/items interactifs. */}
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 space-y-3 bg-gradient-to-t from-black/55 to-transparent px-4 pb-5 pt-3 sm:px-6">
          {/* Nota : swipe inter-slide retiré — conflit avec le pan en zoom.
              La nav passe par les flèches et les dots cliquables. */}
          {multi && (
            <div className="pointer-events-auto flex justify-center gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Aller à la slide ${i + 1}`}
                  className={`h-2 rounded-full transition-all ${
                    i === index ? 'w-6 bg-white' : 'w-2 bg-white/40 hover:bg-white/60'
                  }`}
                />
              ))}
            </div>
          )}
          {advice.tags.length > 0 && (
            <ul className="pointer-events-auto flex flex-wrap justify-center gap-2">
              {advice.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur-sm"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </footer>
      </div>

      <style>{`
        /* Vue impression : 1 page par slide, image en pleine page centrée
           (même réglages que RecipeDetailView pour cohérence) */
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
    </>
  );

  return createPortal(content, document.body);
}
