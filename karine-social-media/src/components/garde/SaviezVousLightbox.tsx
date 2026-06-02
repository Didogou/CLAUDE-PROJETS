'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Heart,
  Printer,
  Share2,
  X,
} from 'lucide-react';
import { ZoomableImage } from '@/components/ui/ZoomableImage';

/**
 * Lightbox plein écran pour les photos de la section "Le saviez-vous ?".
 *  - Pinch-to-zoom / double-tap / Ctrl+wheel via ZoomableImage
 *  - Partager (Web Share API + fallback copie URL)
 *  - Imprimer (window.print + CSS print qui masque tout sauf l'image)
 *  - Liker (état local V1 — DB plus tard)
 *  - Fermer (X, Escape, ou clic backdrop)
 */
export function SaviezVousLightbox({
  imageUrl,
  caption,
  onClose,
}: {
  imageUrl: string;
  caption: string | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [liked, setLiked] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function handleShare() {
    const shareData = {
      title: 'Karine Diététique',
      text: caption ?? 'Le saviez-vous ?',
      url: typeof window !== 'undefined' ? window.location.href : '',
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // L'utilisateur a annulé le share natif — pas une vraie erreur
      return;
    }
    // Fallback : copier l'URL au clipboard
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

  if (!mounted) return null;

  return createPortal(
    <div
      className="saviez-vous-lightbox fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm print:bg-white print:backdrop-blur-none"
      role="dialog"
      aria-modal="true"
      aria-label={caption ?? 'Photo agrandie'}
    >
      {/* Image plein écran avec marges pour les contrôles */}
      <ZoomableImage
        src={imageUrl}
        alt={caption ?? ''}
        className="absolute inset-0 px-4 pb-24 pt-16 sm:px-12"
        imgClassName="max-h-full max-w-full"
      />

      {/* Header : caption + bouton fermer */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-3 bg-gradient-to-b from-black/55 to-transparent px-4 py-3 sm:px-6 sm:py-4 print:hidden">
        {caption && (
          <p className="pointer-events-auto flex-1 truncate font-script text-2xl text-white sm:text-3xl">
            {caption}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-ink shadow-lg ring-2 ring-white/30 transition hover:scale-105"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

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
          label={liked ? 'Liké' : 'J’aime'}
          onClick={() => setLiked((v) => !v)}
          active={liked}
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
