'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { Check, ImageOff, Loader2, Trash2 } from 'lucide-react';
import type { Utensil } from '@/lib/utensils';

/**
 * Catalogue d'ustensiles (admin). Liste auto-alimentée : chaque ligne
 * permet de renommer le libellé, coller une URL d'image, ou supprimer.
 * Le slug (clé) reste figé. Sauvegarde au blur (PATCH optimiste).
 */
export function UtensilsCatalogView({ initial }: { initial: Utensil[] }) {
  const [rows, setRows] = useState<Utensil[]>(initial);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(slug: string, body: { label?: string; imageUrl?: string }) {
    setSavingSlug(slug);
    setError(null);
    try {
      const res = await fetch(`/api/admin/utensils/${slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSavingSlug(null);
    }
  }

  async function remove(slug: string) {
    setSavingSlug(slug);
    setError(null);
    try {
      const res = await fetch(`/api/admin/utensils/${slug}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      setRows((prev) => prev.filter((u) => u.slug !== slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSavingSlug(null);
      setConfirmSlug(null);
    }
  }

  function setLocal(slug: string, patchObj: Partial<Utensil>) {
    setRows((prev) =>
      prev.map((u) => (u.slug === slug ? { ...u, ...patchObj } : u)),
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <p className="text-xs text-admin-ink-soft">
        <strong>{rows.length}</strong> ustensile{rows.length > 1 ? 's' : ''} au
        catalogue.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
          Le catalogue est vide. Il se remplira automatiquement quand tu
          extrairas la préparation de fiches recettes / repas.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((u) => (
            <li
              key={u.slug}
              className="flex items-center gap-3 rounded-2xl bg-admin-surface p-3 shadow-sm"
            >
              {/* Vignette image (placeholder si pas encore associée) */}
              <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-admin-soft/50 text-admin-ink-soft">
                {u.imageUrl ? (
                  <img
                    src={u.imageUrl}
                    alt={u.label}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageOff className="h-5 w-5" />
                )}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <input
                  type="text"
                  value={u.label}
                  onChange={(e) => setLocal(u.slug, { label: e.target.value })}
                  onBlur={(e) => patch(u.slug, { label: e.target.value })}
                  className="input h-8 text-sm font-semibold"
                  aria-label={`Libellé de ${u.slug}`}
                />
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={u.imageUrl ?? ''}
                    onChange={(e) => setLocal(u.slug, { imageUrl: e.target.value })}
                    onBlur={(e) => patch(u.slug, { imageUrl: e.target.value })}
                    placeholder="URL de l'image (plus tard)…"
                    className="input h-7 flex-1 text-xs"
                    aria-label={`Image de ${u.slug}`}
                  />
                  <code className="shrink-0 rounded bg-admin-soft/50 px-1.5 py-0.5 text-[0.65rem] text-admin-ink-soft">
                    {u.slug}
                  </code>
                </div>
              </div>

              {savingSlug === u.slug && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-admin-primary" />
              )}

              {confirmSlug === u.slug ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirmSlug(null)}
                    className="rounded-full bg-white px-2.5 py-1 text-[0.65rem] font-semibold text-admin-ink-soft ring-1 ring-admin-border"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(u.slug)}
                    className="flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[0.65rem] font-bold text-white"
                  >
                    <Check className="h-3 w-3" /> Oui
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmSlug(u.slug)}
                  aria-label={`Supprimer ${u.label}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-red-500 transition hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
