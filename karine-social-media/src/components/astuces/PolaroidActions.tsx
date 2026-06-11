'use client';

import { useEffect, useRef, useState } from 'react';
import { Heart, MessageCircle, Printer, Share2 } from 'lucide-react';

const LIKED_KEY_PREFIX = 'karine.tip.liked.';

export function PolaroidActions({
  slug,
  label,
  initialLikes,
  initialComments,
  onOpenComments,
  onPrint,
}: {
  slug: string;
  label: string;
  initialLikes: number;
  initialComments: number;
  onOpenComments: () => void;
  onPrint: () => void;
}) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(initialLikes);
  const hydrated = useRef(false);

  // Restaure l'état "déjà liké" depuis localStorage (anti double-like V1)
  useEffect(() => {
    try {
      if (localStorage.getItem(LIKED_KEY_PREFIX + slug) === '1') setLiked(true);
    } catch {
      /* localStorage indisponible */
    }
    hydrated.current = true;
  }, [slug]);

  async function toggleLike(e: React.MouseEvent) {
    e.stopPropagation();
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikes((n) => (wasLiked ? Math.max(0, n - 1) : n + 1));
    try {
      if (wasLiked) localStorage.removeItem(LIKED_KEY_PREFIX + slug);
      else localStorage.setItem(LIKED_KEY_PREFIX + slug, '1');
    } catch {
      /* localStorage indisponible */
    }
    try {
      const res = await fetch(`/api/tips/${slug}/like`, {
        method: wasLiked ? 'DELETE' : 'POST',
      });
      if (res.ok) {
        const j = await res.json();
        if (typeof j.likes === 'number') setLikes(j.likes);
      }
    } catch {
      /* erreur réseau ignorée — le toggle reste optimiste */
    }
  }

  async function handleShare(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const url = `${window.location.origin}/astuces`;
      if (navigator.share) {
        await navigator.share({ title: `Astuce — ${label}`, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* user a annulé le partage */
    }
  }

  function handleOpenComments(e: React.MouseEvent) {
    e.stopPropagation();
    onOpenComments();
  }

  function handlePrint(e: React.MouseEvent) {
    e.stopPropagation();
    onPrint();
  }

  return (
    <div className="mt-1.5 flex items-center justify-center gap-1.5 px-1 sm:mt-2 sm:gap-2">
      <button
        type="button"
        onClick={handleShare}
        aria-label="Partager"
        className="grid h-7 w-7 place-items-center rounded-full bg-coral-soft/40 text-coral-dark transition hover:scale-110 hover:bg-coral-soft sm:h-8 sm:w-8"
      >
        <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </button>
      <button
        type="button"
        onClick={handlePrint}
        aria-label="Imprimer"
        className="grid h-7 w-7 place-items-center rounded-full bg-coral-soft/40 text-coral-dark transition hover:scale-110 hover:bg-coral-soft sm:h-8 sm:w-8"
      >
        <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </button>
      <button
        type="button"
        onClick={toggleLike}
        aria-pressed={liked}
        aria-label={liked ? 'Je n’aime plus' : 'J’aime'}
        className="flex items-center gap-1 rounded-full bg-coral-soft/40 px-2 py-0.5 transition hover:scale-105 hover:bg-coral-soft sm:py-1"
      >
        <Heart
          className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${
            liked ? 'fill-coral text-coral' : 'text-coral-dark'
          }`}
          strokeWidth={2.2}
        />
        <span className="text-[0.65rem] font-bold text-coral-dark sm:text-xs">{likes}</span>
      </button>
      <button
        type="button"
        onClick={handleOpenComments}
        aria-label="Voir les commentaires"
        className="flex items-center gap-1 rounded-full bg-coral-soft/40 px-2 py-0.5 transition hover:scale-105 hover:bg-coral-soft sm:py-1"
      >
        <MessageCircle className="h-3.5 w-3.5 text-coral-dark sm:h-4 sm:w-4" strokeWidth={2.2} />
        <span className="text-[0.65rem] font-bold text-coral-dark sm:text-xs">{initialComments}</span>
      </button>
    </div>
  );
}
