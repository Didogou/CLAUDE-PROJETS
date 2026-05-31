/* eslint-disable @next/next/no-img-element */
'use client';

import { useMemo } from 'react';
import { Heart, Reply } from 'lucide-react';

export type InstaComment = {
  id: string | number;
  parentId?: string | number | null;
  author: string;
  text: string;
  photos: string[];
  likesCount: number;
  parentAuthor?: string;
};

/**
 * Regroupe les réponses sous leur commentaire parent.
 * Ordre : pour chaque commentaire root (parentId vide), on liste les réponses
 * juste après. Si une réponse n'a pas de parent identifié, elle est traitée
 * comme un root (graceful fallback).
 */
function orderThreaded(comments: InstaComment[]): InstaComment[] {
  const roots = comments.filter((c) => c.parentId == null);
  const replies = comments.filter((c) => c.parentId != null);
  const ordered: InstaComment[] = [];
  const orphans = new Set<string | number>();
  for (const c of replies) orphans.add(c.id);
  for (const r of roots) {
    ordered.push(r);
    for (const reply of replies) {
      if (reply.parentId === r.id) {
        ordered.push(reply);
        orphans.delete(reply.id);
      }
    }
  }
  // Réponses dont le parent n'est pas dans la liste → on les ajoute à la fin
  for (const c of replies) if (orphans.has(c.id)) ordered.push(c);
  return ordered;
}

/**
 * Liste verticale de commentaires façon Instagram :
 *  - Avatar circulaire à gauche
 *  - Bloc "Auteur Texte" en ligne
 *  - Sous le texte : compteur de likes + bouton "J'aime" + bouton "Répondre"
 *  - Photos miniatures cliquables → zoom
 *  - Les réponses (`parentAuthor`) sont indentées avec un préfixe "↳ @parent"
 */
export function InstaComments({
  comments,
  onLike,
  onReply,
  onPhotoZoom,
  maxHeight = '60vh',
}: {
  comments: InstaComment[];
  onLike?: (id: string | number) => void;
  onReply?: (c: InstaComment) => void;
  onPhotoZoom?: (src: string) => void;
  maxHeight?: string;
}) {
  const threaded = useMemo(() => orderThreaded(comments), [comments]);

  if (comments.length === 0) {
    return (
      <p className="rounded-xl bg-white/60 px-3 py-2 text-center text-xs text-ink-soft">
        Pas encore de commentaire — soyez la première !
      </p>
    );
  }

  return (
    <ul
      className="space-y-3 overflow-y-auto pr-1"
      style={{ maxHeight }}
    >
      {threaded.map((c) => {
        const isReply = !!c.parentAuthor;
        return (
          <li
            key={c.id}
            className={`flex gap-2.5 ${isReply ? 'pl-6' : ''}`}
          >
            {/* Avatar circulaire */}
            <span
              className={`grid shrink-0 place-items-center rounded-full bg-coral-soft text-xs font-bold text-coral-dark ${
                isReply ? 'h-7 w-7 text-[0.65rem]' : 'h-9 w-9 text-sm'
              }`}
            >
              {c.author.charAt(0).toUpperCase()}
            </span>

            <div className="min-w-0 flex-1">
              {/* Auteur + texte sur une seule ligne (style Insta) */}
              <p className="text-sm leading-snug text-ink">
                <span className="font-bold">{c.author}</span>
                {isReply && (
                  <span className="ml-1 text-xs text-ink-soft">↳ @{c.parentAuthor}</span>
                )}
                <span className="ml-1.5 break-words text-ink-soft">{c.text}</span>
              </p>

              {/* Photos */}
              {c.photos.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.photos.slice(0, 4).map((src, i) => (
                    <button
                      key={src + i}
                      type="button"
                      onClick={() => onPhotoZoom?.(src)}
                      aria-label={`Agrandir la photo ${i + 1}`}
                      className="block h-14 w-14"
                    >
                      <img
                        src={src}
                        alt=""
                        className="h-full w-full rounded-md object-cover shadow-sm transition hover:opacity-80"
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* Actions sous le commentaire (style Insta) */}
              <div className="mt-1 flex items-center gap-3 text-[0.65rem] font-semibold text-ink-soft">
                {c.likesCount > 0 && (
                  <span>
                    {c.likesCount} {c.likesCount === 1 ? 'mention J’aime' : 'mentions J’aime'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onLike?.(c.id)}
                  className="flex items-center gap-1 hover:text-coral"
                  aria-label="J'aime"
                >
                  <Heart className="h-3 w-3" /> J&apos;aime
                </button>
                <button
                  type="button"
                  onClick={() => onReply?.(c)}
                  className="flex items-center gap-1 hover:text-coral"
                >
                  <Reply className="h-3 w-3" /> Répondre
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
