/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState } from 'react';
import { Heart, Reply } from 'lucide-react';

export type EphemeralComment = {
  id: string | number;
  author: string;
  text: string;
  photos: string[];
  likesCount: number;
  parentAuthor?: string;
};

/**
 * Affiche les commentaires UN À UN en fondu : in (300ms) → hold (~3.5s) → out (300ms),
 * puis cycle au suivant. Style "spot bref" qui ne pèse pas dans le layout.
 * Au tap sur la photo : ouvre dans un nouvel onglet (V1).
 * Bouton ♡ : incrémente le compteur via callback.
 * Bouton "Répondre" : enclenche le mode réponse côté parent.
 */
export function EphemeralComments({
  comments,
  intervalMs = 4500,
  onLike,
  onReply,
}: {
  comments: EphemeralComment[];
  intervalMs?: number;
  onLike?: (id: string | number) => void;
  onReply?: (c: EphemeralComment) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (comments.length === 0) return;
    setVisible(true);
    const fadeOut = setTimeout(() => setVisible(false), intervalMs - 350);
    const next = setTimeout(() => setIdx((i) => (i + 1) % comments.length), intervalMs);
    return () => {
      clearTimeout(fadeOut);
      clearTimeout(next);
    };
  }, [idx, comments.length, intervalMs]);

  if (comments.length === 0) {
    return (
      <p className="rounded-xl bg-white/60 px-3 py-2 text-center text-xs text-ink-soft">
        Pas encore de commentaire — soyez la première !
      </p>
    );
  }
  const c = comments[Math.min(idx, comments.length - 1)];

  return (
    <div
      className={`rounded-2xl bg-white/85 px-3 py-2 shadow-sm backdrop-blur transition-opacity duration-300 ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-coral-soft text-xs font-bold text-coral-dark">
          {c.author.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-semibold text-ink">{c.author}</p>
            {c.parentAuthor && (
              <span className="truncate text-[0.65rem] text-ink-soft">
                ↳ @{c.parentAuthor}
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-xs text-ink-soft">{c.text}</p>

          {c.photos.length > 0 && (
            <div className="mt-1 flex gap-1.5">
              {c.photos.slice(0, 2).map((src, i) => (
                <a
                  key={src + i}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-10 w-10"
                >
                  <img
                    src={src}
                    alt={`Photo ${i + 1} de ${c.author}`}
                    className="h-full w-full rounded-md object-cover shadow-sm"
                  />
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => onLike?.(c.id)}
            aria-label="J'aime ce commentaire"
            className="flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[0.65rem] font-bold text-coral-dark shadow-sm transition hover:scale-110"
          >
            <Heart className="h-3 w-3 fill-coral text-coral" />
            {c.likesCount}
          </button>
          <button
            type="button"
            onClick={() => onReply?.(c)}
            aria-label="Répondre à ce commentaire"
            className="flex items-center gap-1 rounded-full bg-coral-soft/60 px-1.5 py-0.5 text-[0.65rem] font-semibold text-coral-dark transition hover:bg-coral-soft"
          >
            <Reply className="h-3 w-3" />
            Répondre
          </button>
        </div>
      </div>

      {/* Indicateur de cycle */}
      <span className="mt-1.5 flex justify-center gap-0.5" aria-hidden>
        {comments.map((_, i) => (
          <span
            key={i}
            className={`h-1 rounded-full transition-all ${
              i === idx ? 'w-3 bg-coral' : 'w-1 bg-coral/30'
            }`}
          />
        ))}
      </span>
    </div>
  );
}
