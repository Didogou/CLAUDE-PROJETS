'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { compressImage } from '@/lib/compress-image';
import type { Advice } from '@/data/advice';

export function EditAdviceForm({ advice }: { advice: Advice }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keptSlides, setKeptSlides] = useState<string[]>(advice.slides);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const formEl = e.currentTarget;
      setProgress({ done: 0, total: 0, label: 'Mise à jour…' });
      const fd = new FormData();
      for (const el of Array.from(formEl.elements)) {
        const input = el as HTMLInputElement;
        if (!input.name) continue;
        if (input.type === 'file') continue;
        fd.set(input.name, input.value);
      }
      fd.set('existingSlides', JSON.stringify(keptSlides));

      const res = await fetch(`/api/admin/advice/${advice.id}`, {
        method: 'PATCH',
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Erreur mise à jour');

      const extraFiles = Array.from(
        (formEl.elements.namedItem('extraSlides') as HTMLInputElement | null)?.files ?? [],
      );
      setProgress({ done: 0, total: extraFiles.length, label: '' });
      const opts = { maxDim: 1600, quality: 0.8, skipBelowKB: 150 };
      let k = 0;
      for (const f of extraFiles) {
        setProgress({
          done: k,
          total: extraFiles.length,
          label: `Envoi de la slide ${k + 1}…`,
        });
        let compressed: File;
        try {
          compressed = await compressImage(f, opts);
        } catch {
          compressed = f;
        }
        const asset = new FormData();
        asset.set('file', compressed);
        const r = await fetch(`/api/admin/advice/${advice.id}/asset`, {
          method: 'POST',
          body: asset,
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error || `Échec slide ${k + 1}`);
        }
        k++;
        setProgress({ done: k, total: extraFiles.length, label: '' });
      }

      router.push('/admin/conseils');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white/85 p-6 shadow-sm">
      <Field label="Label" required>
        <input name="label" required defaultValue={advice.label} className="input" />
      </Field>

      <Field label="Tags (séparés par des virgules)">
        <input name="tags" defaultValue={advice.tags.join(', ')} className="input" />
      </Field>

      <Field label={`Slides (${keptSlides.length})`}>
        {keptSlides.length === 0 ? (
          <p className="rounded-lg border border-dashed border-coral-soft bg-coral-soft/10 px-3 py-3 text-xs text-ink-soft">
            Aucune slide. Ajoute-en au moins une ci-dessous.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {keptSlides.map((src, i) => (
              <div key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  className="h-24 w-24 rounded-lg object-cover shadow-sm ring-1 ring-coral-soft"
                />
                <button
                  type="button"
                  onClick={() => setKeptSlides((s) => s.filter((_, j) => j !== i))}
                  aria-label="Retirer cette slide"
                  className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-white shadow ring-2 ring-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {i === 0 && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-coral px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-white shadow">
                    cover
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="mt-1 text-xs text-ink-soft">
          La 1ʳᵉ slide sert de cover sur le polaroid. Retire avec la croix.
        </p>
      </Field>

      <Field label="Ajouter des slides">
        <input
          name="extraSlides"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            setNewPreviews(files.map((f) => URL.createObjectURL(f)));
          }}
          className="file-input"
        />
        {newPreviews.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {newPreviews.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt=""
                className="h-20 w-20 rounded-lg object-cover shadow-sm"
              />
            ))}
          </div>
        )}
      </Field>

      <Field label="Statut">
        <select name="status" defaultValue={advice.status} className="input">
          <option value="draft">Brouillon</option>
          <option value="published">Publié</option>
        </select>
      </Field>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {progress.label && (
        <div className="rounded-lg border border-coral-soft bg-coral-soft/20 px-3 py-2 text-sm text-coral-dark">
          <p className="font-semibold">{progress.label}</p>
          {progress.total > 0 && (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-coral transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-coral py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-60"
      >
        {submitting
          ? progress.total > 0
            ? `Envoi… ${progress.done}/${progress.total}`
            : 'Mise à jour…'
          : 'Enregistrer'}
      </button>

      <style>{`
        .input { width: 100%; border-radius: 9999px; border: 1px solid rgba(226,120,141,0.4); background: #fff; padding: 0.5rem 0.875rem; font-size: 0.875rem; color: #4b4248; outline: none; }
        .input:focus { border-color: #e2788d; }
        .file-input { width: 100%; font-size: 0.875rem; color: #4b4248; }
        .file-input::file-selector-button { margin-right: 0.75rem; padding: 0.4rem 0.875rem; border-radius: 9999px; border: 0; background: #f6c9d3; color: #c75a73; font-weight: 600; cursor: pointer; }
      `}</style>
    </form>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {required && <span className="ml-1 text-coral">*</span>}
      </span>
      {children}
    </label>
  );
}
