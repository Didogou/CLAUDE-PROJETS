/* eslint-disable @next/next/no-img-element */
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Heart, ImagePlus, Trash2 } from 'lucide-react';
import type { FeaturedPhoto } from '@/data/featured-photos';

export function FeaturedPhotosView({ initial }: { initial: FeaturedPhoto[] }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<FeaturedPhoto[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (captionDraft.trim()) fd.append('caption', captionDraft.trim());
      const res = await fetch('/api/admin/featured-photos', {
        method: 'POST',
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Upload échoué');
      setPhotos((prev) => [j.photo as FeaturedPhoto, ...prev]);
      setCaptionDraft('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function patch(id: number, payload: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/admin/featured-photos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: number) {
    if (!window.confirm('Supprimer cette photo ?')) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/featured-photos?id=${id}`,
        { method: 'DELETE' },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec');
      setPhotos((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusyId(null);
    }
  }

  function togglePublish(p: FeaturedPhoto) {
    const next = !p.published;
    setPhotos((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, published: next } : x)),
    );
    patch(p.id, { published: next });
  }

  function commitCaption(p: FeaturedPhoto, newCaption: string) {
    if (newCaption === (p.caption ?? '')) return;
    setPhotos((prev) =>
      prev.map((x) =>
        x.id === p.id ? { ...x, caption: newCaption || null } : x,
      ),
    );
    patch(p.id, { caption: newCaption });
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Zone upload */}
      <section className="space-y-3 rounded-2xl border border-dashed border-admin-primary/40 bg-admin-surface p-5 shadow-sm">
        <p className="font-semibold text-admin-ink">Ajouter une photo</p>
        <input
          type="text"
          value={captionDraft}
          onChange={(e) => setCaptionDraft(e.target.value)}
          maxLength={200}
          placeholder="Titre / légende (optionnel) — ex. La courgette : 18 kcal / 100 g"
          className="w-full rounded-xl border border-admin-primary/30 bg-white px-3 py-2 text-sm shadow-sm focus:border-admin-primary focus:outline-none focus:ring-2 focus:ring-admin-primary/30"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
          className="block w-full text-sm text-admin-ink file:mr-3 file:rounded-full file:border-0 file:bg-admin-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-admin-primary-dark"
        />
        <p className="text-xs text-admin-ink-soft">
          {uploading ? 'Upload en cours…' : 'Format image (jpg, png, webp), max 5 MB.'}
        </p>
      </section>

      {/* Liste */}
      {photos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
          Aucune photo pour l&apos;instant. Ajoute la première ci-dessus.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => (
            <li
              key={p.id}
              className={`relative flex flex-col rounded-2xl bg-admin-surface p-3 shadow-sm transition ${
                p.published ? '' : 'opacity-60'
              }`}
            >
              <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-blush/40">
                <img
                  src={p.imageUrl}
                  alt={p.caption ?? ''}
                  className="h-full w-full object-cover"
                />
                {!p.published && (
                  <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[0.6rem] font-bold uppercase text-white">
                    Brouillon
                  </span>
                )}
                {p.likesCount > 0 && (
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-bold text-coral shadow-sm">
                    <Heart className="h-3 w-3 fill-coral" strokeWidth={0} />
                    {p.likesCount}
                  </span>
                )}
              </div>

              <input
                type="text"
                defaultValue={p.caption ?? ''}
                onBlur={(e) => commitCaption(p, e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                disabled={busyId === p.id}
                maxLength={200}
                placeholder="Titre / légende"
                className="mt-2 w-full rounded-lg border border-admin-primary/30 bg-white px-2 py-1.5 text-sm text-admin-ink shadow-sm focus:border-admin-primary focus:outline-none"
              />

              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => togglePublish(p)}
                  disabled={busyId === p.id}
                  aria-label={p.published ? 'Cacher' : 'Publier'}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    p.published
                      ? 'bg-sage/15 text-sage hover:bg-sage/25'
                      : 'bg-admin-soft text-admin-ink-soft hover:bg-admin-soft/80'
                  }`}
                >
                  {p.published ? (
                    <>
                      <Eye className="h-3.5 w-3.5" /> Publiée
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3.5 w-3.5" /> Cachée
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  disabled={busyId === p.id}
                  aria-label="Supprimer"
                  className="grid h-8 w-8 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-center gap-1.5 text-xs text-admin-ink-soft">
        <ImagePlus className="h-3.5 w-3.5" />
        {photos.length} photo{photos.length > 1 ? 's' : ''} (publiée
        {photos.filter((p) => p.published).length > 1 ? 's' : ''}&nbsp;:{' '}
        {photos.filter((p) => p.published).length}).
      </p>
    </div>
  );
}
