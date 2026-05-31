'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2, ExternalLink } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

export type AdminComment = {
  id: string;
  recipeSlug: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export function CommentsModeration({ comments }: { comments: AdminComment[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<AdminComment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function performDelete() {
    if (!target) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/comments/${target.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Erreur');
      }
      setTarget(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setDeleting(false);
    }
  }

  if (comments.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
        Aucun avis pour l&apos;instant.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {comments.map((c) => (
          <li
            key={c.id}
            className="flex flex-col gap-2 rounded-2xl bg-admin-surface p-3 shadow-sm sm:flex-row sm:items-start"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-admin-soft text-sm font-bold text-admin-primary-dark">
              {c.authorName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-admin-ink">{c.authorName}</p>
                <span className="text-[0.65rem] text-admin-ink-soft">
                  {new Date(c.createdAt).toLocaleString('fr-FR')}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-sm text-admin-ink-soft">{c.body}</p>
              <Link
                href={`/recettes/${c.recipeSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[0.7rem] font-semibold text-admin-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> {c.recipeSlug}
              </Link>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setTarget(c);
              }}
              aria-label="Supprimer cet avis"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 transition hover:bg-red-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <ConfirmModal
        open={!!target}
        variant="danger"
        loading={deleting}
        title="Supprimer cet avis ?"
        confirmLabel="Supprimer"
        message={
          target ? (
            <>
              <p className="font-semibold text-admin-ink">{target.authorName}</p>
              <p className="mt-1 text-xs text-admin-ink-soft">«&nbsp;{target.body}&nbsp;»</p>
              <p className="mt-2 text-xs">Cette action est irréversible.</p>
              {error && (
                <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  {error}
                </p>
              )}
            </>
          ) : null
        }
        onConfirm={performDelete}
        onCancel={() => {
          if (!deleting) {
            setTarget(null);
            setError(null);
          }
        }}
      />
    </>
  );
}
