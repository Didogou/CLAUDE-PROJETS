'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

export function MenuRowActions({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function performDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/menus/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Erreur');
      }
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        <Link
          href={`/admin/menus/${id}`}
          className="rounded-full bg-admin-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-admin-primary-dark"
        >
          Modifier
        </Link>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
          aria-label="Supprimer le menu"
          className="grid h-9 w-9 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 transition hover:bg-red-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        variant="danger"
        loading={deleting}
        title="Supprimer ce menu ?"
        confirmLabel="Supprimer"
        message={
          <>
            <p>
              <span className="font-semibold text-admin-ink">«&nbsp;{title}&nbsp;»</span> sera
              supprimé&nbsp;: menu, jours, ainsi que toutes les images du menu (cover, liste de
              courses, covers/lunch/dîner/pellicule de chaque jour).
            </p>
            <p className="mt-2 text-xs">
              Les images des recettes liées <strong>ne seront pas affectées</strong>.
            </p>
            <p className="mt-2 text-xs">Cette action est irréversible.</p>
            {error && (
              <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                {error}
              </p>
            )}
          </>
        }
        onConfirm={performDelete}
        onCancel={() => {
          if (!deleting) {
            setConfirmOpen(false);
            setError(null);
          }
        }}
      />
    </>
  );
}
