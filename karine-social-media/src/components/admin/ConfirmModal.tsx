'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

type Variant = 'default' | 'danger';

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Fermeture sur touche Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-admin-primary hover:bg-admin-primary-dark';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm animate-[fadeIn_0.18s_ease-out]"
      onClick={() => !loading && onCancel()}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-2xl bg-admin-surface p-6 shadow-2xl ring-1 ring-admin-border animate-[popIn_0.22s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id="confirm-modal-title" className="text-base font-bold text-admin-ink">
            {title}
          </h3>
          <button
            type="button"
            onClick={() => !loading && onCancel()}
            aria-label="Fermer"
            disabled={loading}
            className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-full text-admin-ink-soft transition hover:bg-admin-soft/40 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="text-sm text-admin-ink-soft">{message}</div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-full border border-admin-border bg-white px-4 py-2 text-sm font-semibold text-admin-ink transition hover:bg-admin-soft/40 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60 ${confirmClass}`}
          >
            {loading ? '…' : confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn { from { opacity: 0; transform: scale(0.95) translateY(-6px) } to { opacity: 1; transform: scale(1) translateY(0) } }
      `}</style>
    </div>
  );
}
