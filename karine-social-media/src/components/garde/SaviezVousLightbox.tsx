'use client';

import { useEffect, useState } from 'react';
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

export type SaviezVousLightboxItem = {
  id: string;
  imageUrl: string;
  caption: string | null;
};

/**
 * Lightbox plein écran pour les photos "Le saviez-vous ?".
 *  - Pinch-to-zoom / double-tap / Ctrl+wheel via ZoomableImage
 *  - Navigation entre photos via flèches + swipe + touches clavier ←/→
 *  - Partager, Imprimer, Liker (état local V1)
 *  - Fermer (X, Escape)
 */
export function SaviezVousLightbox({
  items,
  startIndex,
  onClose,
}: {
  items: SaviezVousLightboxItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(startIndex);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [shareToast, setShareToast] = useState<string | null>(null);
  const { phase, requestClose } = useLightboxAnim(onClose);

  const total = items.length;
  const current = items[index];
  const multi = total > 1;

  useEffect(() => setMounted(true), []);

  // Lock scroll body
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Navigation clavier
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
    if (!current) return;
    const shareData = {
      title: 'Karine Diététique',
      text: current.caption ?? 'Le saviez-vous ?',
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
      setShareToast('Impossible de copier');
      setTimeout(() => setShareToast(null), 2000);
    }
  }

  function handlePrint() {
    window.print();
  }

  if (!mounted || !current) return null;

  const isLiked = liked[current.id] ?? false;

  return createPortal(
    <div
      className={`saviez-vous-lightbox fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm print:bg-white print:backdrop-blur-none ${
        phase === 'exit' ? 'ie-lightbox-out' : 'ie-lightbox-in'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={current.caption ?? 'Photo agrandie'}
    >
      {/* Image plein écran. key=index → la transition se rejoue à chaque
          changement de photo (effet doux pendant la navigation). */}
      <div
        key={current.id}
        className={`absolute inset-0 ${
          phase === 'exit' ? 'ie-lightbox-content-out' : 'ie-lightbox-content-in'
        }`}
      >
        <ZoomableImage
          src={current.imageUrl}
          alt={current.caption ?? ''}
          className="absolute inset-0 px-4 pb-24 pt-16 sm:px-12"
          imgClassName="max-h-full max-w-full"
          onSwipeLeft={multi ? next : undefined}
          onSwipeRight={multi ? prev : undefined}
        />
      </div>

      {/* Header : caption + compteur + bouton fermer */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-3 bg-gradient-to-b from-black/55 to-transparent px-4 py-3 sm:px-6 sm:py-4 print:hidden">
        <p className="pointer-events-auto flex-1 truncate font-script text-2xl text-white sm:text-3xl">
          {current.caption ?? ' '}
        </p>
        {multi && (
          <span className="pointer-events-auto shrink-0 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm">
            {index + 1} / {total}
          </span>
        )}
        <button
          type="button"
          onClick={requestClose}
          aria-label="Fermer"
          className="pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-ink shadow-lg ring-2 ring-white/30 transition hover:scale-105"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Flèches navigation latérales (visible mobile + desktop) */}
      {multi && (
        <button
          type="button"
          onClick={prev}
          aria-label="Précédente"
          className="absolute left-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105 sm:left-3 sm:h-12 sm:w-12 print:hidden"
        >
          <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
        </button>
      )}
      {multi && (
        <button
          type="button"
          onClick={next}
          aria-label="Suivante"
          className="absolute right-2 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105 sm:right-3 sm:h-12 sm:w-12 print:hidden"
        >
          <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
        </button>
      )}

      {/* Footer : actions (partager / imprimer / liker) */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-3 bg-gradient-to-t from-black/55 to-transparent px-4 pb-6 pt-4 sm:gap-4 sm:px-6 print:hidden">
        <ActionButton
          icon={Share2}
          label="Partager"
          onClick={handleShare}
        />
        <ActionButton
          icon={Printer}
          label="Imprimer"
          onClick={handlePrint}
        />
        <ActionButton
          icon={Heart}
          label={isLiked ? 'Liké' : 'J’aime'}
          onClick={() =>
            setLiked((m) => ({ ...m, [current.id]: !m[current.id] }))
          }
          active={isLiked}
        />
      </footer>

      {shareToast && (
        <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink shadow-lg print:hidden">
          {shareToast}
        </div>
      )}

      {/* CSS print : on cache tout sauf l'image (et son centrage). */}
      <style>{`
        @media print {
          @page { margin: 0.5cm; size: auto; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          body > *:not(.saviez-vous-lightbox) { display: none !important; }
          .saviez-vous-lightbox { position: static !important; background: #fff !important; }
          .saviez-vous-lightbox img {
            max-width: 100% !important;
            max-height: 95vh !important;
            margin: 0 auto !important;
            display: block !important;
          }
        }
      `}</style>
    </div>,
    document.body,
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
      className={`pointer-events-auto flex flex-col items-center gap-1 rounded-full px-3 py-2 text-white shadow-lg ring-2 ring-white/30 transition hover:scale-105 ${
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
