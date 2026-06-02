/* eslint-disable @next/next/no-img-element */
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Trash2, User } from 'lucide-react';

export function AvatarUploader({
  initialUrl,
  displayName,
}: {
  initialUrl: string | null;
  displayName: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement | null>(null);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Upload échoué');
      setUrl(j.url);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  }

  async function handleRemove() {
    if (!window.confirm('Retirer ta photo de profil ?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/profile/avatar', { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      setUrl(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  // Initiale pour le placeholder
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        {url ? (
          <img
            src={url}
            alt="Photo de profil"
            className="h-24 w-24 rounded-full object-cover shadow-md ring-4 ring-white"
          />
        ) : (
          <span className="grid h-24 w-24 place-items-center rounded-full bg-coral-soft/40 text-3xl font-bold text-coral-dark shadow-md ring-4 ring-white">
            {initial !== '?' ? initial : <User className="h-10 w-10" />}
          </span>
        )}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          aria-label={url ? 'Changer la photo' : 'Ajouter une photo'}
          className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full bg-coral text-white shadow-lg ring-2 ring-white transition hover:scale-110 disabled:opacity-50"
        >
          <Camera className="h-4 w-4" />
        </button>
      </div>

      <input
        ref={ref}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
        }}
        className="hidden"
      />

      {url && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-coral-dark shadow-sm ring-1 ring-coral-soft transition hover:bg-coral-soft/30 disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />
          Retirer
        </button>
      )}

      {busy && (
        <p className="text-xs text-ink-soft">Envoi…</p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}
