/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Send, X } from 'lucide-react';
import { InstaComments, type InstaComment } from '../recettes/InstaComments';

export type TipDrawerComment = {
  id: string | number;
  parentId: string | number | null;
  author: string;
  text: string;
  photos: string[];
  likesCount: number;
  parentAuthor?: string;
};

/**
 * Drawer commentaires qui glisse depuis la droite.
 * Réutilise InstaComments (même rendu que les recettes).
 * Comme MainDrawer : porté dans <body> via createPortal pour échapper
 * au `overflow-x-clip` du wrapper de la grille.
 */
export function TipCommentsDrawer({
  open,
  tipSlug,
  tipLabel,
  onClose,
}: {
  open: boolean;
  tipSlug: string | null;
  tipLabel: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [comments, setComments] = useState<TipDrawerComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftPhotos, setDraftPhotos] = useState<File[]>([]);
  const [replyTo, setReplyTo] = useState<TipDrawerComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Charge les commentaires à chaque ouverture
  useEffect(() => {
    if (!open || !tipSlug) return;
    setLoading(true);
    setError(null);
    fetch(`/api/tips/${tipSlug}/comments-list`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Chargement impossible'))))
      .then((j) => setComments(j.comments ?? []))
      .catch(() => setError('Impossible de charger les avis'))
      .finally(() => setLoading(false));
  }, [open, tipSlug]);

  // Lock scroll du body + ESC
  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  // Reset le draft quand on change de tip
  useEffect(() => {
    setDraft('');
    setDraftPhotos([]);
    setReplyTo(null);
    setError(null);
  }, [tipSlug]);

  async function addComment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tipSlug || !draft.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('body', draft.trim());
      if (replyTo) fd.set('parentId', String(replyTo.id));
      for (const f of draftPhotos) fd.append('photos', f);
      const res = await fetch(`/api/tips/${tipSlug}/comments`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Échec');

      setComments((c) => [
        {
          id: j.id,
          parentId: j.parentId ?? null,
          author: j.authorName,
          text: j.body,
          photos: j.photos ?? [],
          likesCount: j.likesCount ?? 0,
          parentAuthor: replyTo?.author,
        },
        ...c,
      ]);
      setDraft('');
      setDraftPhotos([]);
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  async function likeComment(id: string | number) {
    setComments((c) =>
      c.map((x) => (x.id === id ? { ...x, likesCount: x.likesCount + 1 } : x)),
    );
    try {
      const res = await fetch(`/api/comments/${id}/like`, { method: 'POST' });
      const j = await res.json().catch(() => null);
      if (res.ok && typeof j?.likes === 'number') {
        setComments((c) =>
          c.map((x) => (x.id === id ? { ...x, likesCount: j.likes } : x)),
        );
      }
    } catch {
      /* like reste optimiste */
    }
  }

  if (!mounted) return null;

  const drawer = (
    <div
      className={`fixed inset-0 z-[110] transition-opacity ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={`Commentaires — ${tipLabel}`}
    >
      {/* backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="absolute inset-0 cursor-default bg-black/40"
      />
      {/* panel */}
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-blush shadow-2xl transition-transform duration-300 sm:w-96 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-coral-soft/40 bg-white/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.25em] text-coral">
              Astuce
            </p>
            <h3 className="truncate font-script text-2xl text-coral-dark">{tipLabel}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-coral-dark transition hover:bg-coral hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
          {/* Form */}
          {replyTo && (
            <div className="mb-2 flex items-center justify-between rounded-xl bg-coral-soft/50 px-3 py-1.5 text-xs">
              <span className="truncate text-coral-dark">
                Réponse à <span className="font-bold">{replyTo.author}</span>
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Annuler la réponse"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-coral-dark transition hover:bg-coral hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <form onSubmit={addComment} className="mb-4 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={replyTo ? `Répondre à ${replyTo.author}…` : 'Laissez votre avis…'}
                className="min-w-0 flex-1 rounded-full border border-coral-soft/60 bg-white px-3 py-2 text-sm outline-none placeholder:text-ink-soft focus:border-coral"
              />
              <label
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full bg-white text-coral shadow-sm ring-1 ring-coral-soft/60 transition hover:bg-coral-soft/40"
                aria-label="Ajouter une photo"
                title="Ajouter une photo (max 2)"
              >
                <Camera className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const newFiles = Array.from(e.target.files ?? []) as File[];
                    setDraftPhotos((prev) => [...prev, ...newFiles].slice(0, 2));
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="submit"
                aria-label="Envoyer"
                disabled={submitting || !draft.trim()}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral text-white transition hover:bg-coral-dark disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            {draftPhotos.length > 0 && (
              <div className="flex gap-2">
                {draftPhotos.map((f, i) => (
                  <span key={i} className="relative block h-14 w-14">
                    <img
                      src={URL.createObjectURL(f)}
                      alt=""
                      className="h-full w-full rounded-lg object-cover shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setDraftPhotos((p) => p.filter((_, j) => j !== i))}
                      aria-label="Retirer la photo"
                      className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-white text-coral shadow-sm ring-1 ring-coral-soft hover:bg-coral hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {error && (
              <p className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">
                {error}
              </p>
            )}
          </form>

          {/* Liste */}
          {loading ? (
            <p className="px-1 text-xs text-ink-soft">Chargement…</p>
          ) : comments.length === 0 ? (
            <p className="px-1 text-xs italic text-ink-soft">
              Pas encore d&apos;avis. Sois le premier !
            </p>
          ) : (
            <InstaComments
              comments={comments as InstaComment[]}
              onLike={(id) => likeComment(id)}
              onReply={(ec) => {
                const target = comments.find((c) => c.id === ec.id);
                if (target) setReplyTo(target);
              }}
              onPhotoZoom={(src) => window.open(src, '_blank', 'noopener')}
              maxHeight="none"
            />
          )}
        </div>
      </aside>
    </div>
  );

  return createPortal(drawer, document.body);
}
