'use client';

import { useEffect, useRef, useState } from 'react';
import { Heart, Printer, Share2 } from 'lucide-react';

const LIKED_KEY_PREFIX = 'karine.advice.liked.';

/**
 * Actions sur un polaroid de la grille Conseils santé.
 * Identique à PolaroidActions (astuces) mais SANS le bouton commentaires
 * (V1 — pas d'endpoint commentaires pour les conseils).
 */
export function PolaroidActionsAdvice({
  slug,
  label,
  initialLikes,
  onPrint,
}: {
  slug: string;
  label: string;
  initialLikes: number;
  onPrint: () => void;
}) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(initialLikes);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(LIKED_KEY_PREFIX + slug) === '1') setLiked(true);
    } catch { /* localStorage indisponible */ }
    hydrated.current = true;
  }, [slug]);

  async function toggleLike(e: React.MouseEvent) {
    e.stopPropagation();
    if (liked) return;
    setLiked(true);
    setLikes((n) => n + 1);
    try {
      localStorage.setItem(LIKED_KEY_PREFIX + slug, '1');
    } catch { /* localStorage indisponible */ }
    try {
      const res = await fetch(`/api/advice/${slug}/like`, { method: 'POST' });
      if (res.ok) {
        const j = await res.json();
        if (typeof j.likes === 'number') setLikes(j.likes);
      }
    } catch { /* erreur réseau ignorée */ }
  }

  async function handleShare(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const url = `${window.location.origin}/conseils`;
      if (navigator.share) {
        await navigator.share({ title: `Conseil — ${label}`, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch { /* user a annulé le partage */ }
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
        className="grid h-7 w-7 place-items-center rounded-full bg-sage/15 text-sage transition hover:scale-110 hover:bg-sage/25 sm:h-8 sm:w-8"
      >
        <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </button>
      <button
        type="button"
        onClick={handlePrint}
        aria-label="Imprimer"
        className="grid h-7 w-7 place-items-center rounded-full bg-sage/15 text-sage transition hover:scale-110 hover:bg-sage/25 sm:h-8 sm:w-8"
      >
        <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </button>
      <button
        type="button"
        onClick={toggleLike}
        aria-pressed={liked}
        aria-label={liked ? 'Je n’aime plus' : 'J’aime'}
        className="flex items-center gap-1 rounded-full bg-sage/15 px-2 py-0.5 transition hover:scale-105 hover:bg-sage/25 sm:py-1"
      >
        <Heart
          className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${
            liked ? 'fill-coral text-coral' : 'text-sage'
          }`}
          strokeWidth={2.2}
        />
        <span className="text-[0.65rem] font-bold text-sage sm:text-xs">{likes}</span>
      </button>
    </div>
  );
}
