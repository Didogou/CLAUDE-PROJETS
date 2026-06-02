'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { compressImage } from '@/lib/compress-image';

export function AdviceForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<{ cover?: string; extra: string[] }>({
    extra: [],
  });
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const formEl = e.currentTarget;
      // Phase 1 : POST texte + cover
      setProgress({ done: 0, total: 0, label: 'Création du conseil…' });
      const phase1 = new FormData();
      for (const el of Array.from(formEl.elements)) {
        const input = el as HTMLInputElement;
        if (!input.name) continue;
        if (input.type === 'file') continue;
        phase1.set(input.name, input.value);
      }
      const coverFile = (formEl.elements.namedItem('cover') as HTMLInputElement | null)
        ?.files?.[0];
      if (!coverFile) throw new Error('Image principale requise');
      try {
        const compressedCover = await compressImage(coverFile, {
          maxDim: 1600,
          quality: 0.8,
        });
        phase1.set('cover', compressedCover);
      } catch {
        phase1.set('cover', coverFile);
      }
      const res1 = await fetch('/api/admin/advice', { method: 'POST', body: phase1 });
      const json1 = await res1.json().catch(() => ({}));
      if (!res1.ok) throw new Error(json1?.error || 'Erreur création conseil');
      const newSlug: string = json1.slug;

      // Phase 2 : upload des slides additionnelles
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
          label: `Envoi de la slide ${k + 2}…`,
        });
        let compressed: File;
        try {
          compressed = await compressImage(f, opts);
        } catch {
          compressed = f;
        }
        const fd = new FormData();
        fd.set('file', compressed);
        const r = await fetch(`/api/admin/advice/${newSlug}/asset`, {
          method: 'POST',
          body: fd,
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error || `Échec slide ${k + 2}`);
        }
        k++;
        setProgress({ done: k, total: extraFiles.length, label: '' });
      }
      setProgress({ done: k, total: extraFiles.length, label: 'Terminé ✓' });

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
        <input
          name="label"
          required
          placeholder="ex. Comprendre l’index glycémique"
          className="input"
        />
      </Field>

      <Field label="Tags (séparés par des virgules)">
        <input name="tags" placeholder="nutrition, glycémie, énergie" className="input" />
      </Field>

      <Field label="Image principale (cover du polaroid)" required>
        <input
          name="cover"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          required
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPreviews((p) => ({
              ...p,
              cover: f ? URL.createObjectURL(f) : undefined,
            }));
          }}
          className="file-input"
        />
        {previews.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previews.cover}
            alt=""
            className="mt-2 h-32 w-32 rounded-lg object-cover shadow-sm"
          />
        )}
      </Field>

      <Field label="Slides additionnelles (optionnel, plusieurs fichiers)">
        <input
          name="extraSlides"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            setPreviews((p) => ({
              ...p,
              extra: files.map((f) => URL.createObjectURL(f)),
            }));
          }}
          className="file-input"
        />
        {previews.extra.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {previews.extra.map((src, i) => (
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
        <p className="mt-1 text-xs text-ink-soft">
          Ces slides s&apos;ouvrent en carrousel après clic sur le polaroid.
        </p>
      </Field>

      <Field label="Statut">
        <select name="status" defaultValue="published" className="input">
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
            : 'Création…'
          : 'Créer le conseil'}
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
