'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react';
import type { Tip } from '@/data/tips';

/**
 * Modal plein écran qui présente les slides de l'astuce en grand.
 * Contraintes :
 *  - L'image courante doit être visible sans scroll (mobile et PC).
 *  - Si plusieurs slides : flèches gauche/droite + dots + swipe tactile + flèches clavier.
 */
export function TipDetailModal({ tip, onClose }: { tip: Tip | null; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset l'index dès qu'on ouvre une astuce différente
  useEffect(() => {
    if (tip) setIndex(0);
  }, [tip]);

  useEffect(() => {
    if (!tip) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const slides = tip.slides;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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
  }, [tip, onClose]);

  if (!mounted || !tip) return null;

  const slides = tip.slides;
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
            <img src={src} alt={`${tip.label} — ${i + 1}/${slides.length}`} />
          </div>
        ))}
      </div>

      {/* ============== VUE ÉCRAN ============== */}
      <div
        className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-sm print:hidden"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={tip.label}
      >
        {/* Header : label + index + print + close */}
        <header className="flex shrink-0 items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="min-w-0 flex-1 truncate font-script text-2xl text-white sm:text-3xl">
            {tip.label}
          </h2>
          {multi && (
            <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white">
              {index + 1}/{slides.length}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.print();
            }}
            aria-label="Imprimer"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/30"
          >
            <Printer className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/30"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

      {/* Zone image : tout le reste, image en contain */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-2 sm:px-12"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchStartX === null || !multi) return;
          const dx = e.changedTouches[0].clientX - touchStartX;
          if (Math.abs(dx) > 50) {
            if (dx < 0) next();
            else prev();
          }
          setTouchStartX(null);
        }}
      >
        {multi && (
          <button
            type="button"
            onClick={prev}
            aria-label="Slide précédente"
            className="absolute left-2 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/30 sm:grid"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={index}
          src={slides[index]}
          alt={`${tip.label} — slide ${index + 1}`}
          className="block max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
        {multi && (
          <button
            type="button"
            onClick={next}
            aria-label="Slide suivante"
            className="absolute right-2 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/30 sm:grid"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

        {/* Footer : dots + tags */}
        <footer
          className="shrink-0 space-y-3 px-4 pb-5 pt-3 sm:px-6"
          onClick={(e) => e.stopPropagation()}
        >
          {multi && (
            <div className="flex justify-center gap-1.5">
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
          {tip.tags.length > 0 && (
            <ul className="flex flex-wrap justify-center gap-2">
              {tip.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white"
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
