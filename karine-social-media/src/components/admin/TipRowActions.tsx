'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

export function TipRowActions({ slug, label }: { slug: string; label: string }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirmDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tips/${slug}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Erreur');
      }
      setModalOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={`/admin/astuces/${slug}`}
          aria-label="Modifier"
          className="grid h-9 w-9 place-items-center rounded-full bg-admin-primary text-white transition hover:bg-admin-primary-dark"
        >
          <Pencil className="h-4 w-4" />
        </Link>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          aria-label="Supprimer"
          className="grid h-9 w-9 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 transition hover:bg-red-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <ConfirmModal
        open={modalOpen}
        variant="danger"
        loading={deleting}
        title="Supprimer cette astuce ?"
        confirmLabel="Supprimer"
        message={
          <>
            <p>
              <span className="font-semibold text-admin-ink">«&nbsp;{label}&nbsp;»</span> sera
              supprimée définitivement, ainsi que son image.
            </p>
            <p className="mt-2 text-xs">Cette action est irréversible.</p>
            {error && (
              <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                {error}
              </p>
            )}
          </>
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!deleting) {
            setModalOpen(false);
            setError(null);
          }
        }}
      />
    </>
  );
}
