/* eslint-disable @next/next/no-img-element */
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2, Shield, Trash2, User } from 'lucide-react';
import { compressImage } from '@/lib/compress-image';

/**
 * Bouton d'upload + retrait de la photo de profil utilisatrice.
 *
 * UX (2026-06-11) :
 *  - Caméra en bas-DROITE de l'avatar = changer/uploader
 *  - Trash en bas-GAUCHE de l'avatar = retirer (symétrique)
 *  - Modal custom (no window.confirm — règle projet)
 *  - Bandeau d'info RGPD discret sous le bouton
 *
 * Conformité CNIL / RGPD :
 *  - Auth requise pour upload + delete (vérifié côté API)
 *  - Suppression purge la fois la DB ET les fichiers Storage
 *    (Art. 17 droit à l'effacement)
 *  - Magic bytes verification anti-spoofing (cf. checkImageUpload)
 *  - WebP conversion + resize 512px max (limite l'exposition)
 *  - Bucket `avatars` public mais path UUID+timestamp non devinable
 *  - Info utilisatrice transparente sur l'usage public
 */
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
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  async function handleUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      // Compression client AVANT upload : conversion HEIC iPhone +
      // resize 512 max (avatar = icon, pas besoin de plus). Sans ça,
      // sharp côté server peut planter sur HEIC sans libheif.
      const compressed = await compressImage(file, {
        maxDim: 512,
        quality: 0.85,
        skipBelowKB: 100,
      });
      const fd = new FormData();
      fd.append('file', compressed);
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
    setBusy(true);
    setError(null);
    setConfirmRemoveOpen(false);
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

        {/* Trash BAS-GAUCHE (symétrique au caméra). Visible uniquement
            si une photo est uploadée — sinon n'a pas de sens. */}
        {url && (
          <button
            type="button"
            onClick={() => setConfirmRemoveOpen(true)}
            disabled={busy}
            aria-label="Retirer ma photo"
            title="Retirer ma photo"
            className="absolute -bottom-1 -left-1 grid h-9 w-9 place-items-center rounded-full bg-white text-coral-dark shadow-lg ring-2 ring-white transition hover:scale-110 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.2} />
          </button>
        )}

        {/* Caméra BAS-DROITE = upload nouvelle photo. */}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          aria-label={url ? 'Changer ma photo' : 'Ajouter une photo'}
          title={url ? 'Changer ma photo' : 'Ajouter une photo'}
          className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full bg-coral text-white shadow-lg ring-2 ring-white transition hover:scale-110 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
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

      {/* Petit bandeau RGPD discret : informe que la photo peut
          apparaître dans les commentaires publics et qu'elle peut
          être retirée à tout moment. */}
      <p className="mt-1 flex max-w-[18rem] items-start gap-1 text-center text-[0.65rem] leading-tight text-ink-soft">
        <Shield className="mt-0.5 h-3 w-3 shrink-0 text-coral-dark/70" />
        <span>
          Ta photo apparaît dans tes commentaires publics. Retire-la quand
          tu veux — elle sera supprimée de nos serveurs.
        </span>
      </p>

      {busy && <p className="text-xs text-ink-soft">Envoi…</p>}
      {error && (
        <p className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}

      {/* Modal de confirmation custom (no window.confirm).
          RÈGLE PROJET 2026-06-11 : PAS de fermeture au clic backdrop —
          l'utilisatrice doit choisir explicitement Annuler ou Retirer. */}
      {confirmRemoveOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 md:items-center md:p-4"
        >
          <div className="w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl md:rounded-3xl">
            <h3 className="font-script text-2xl text-coral-dark">
              Retirer ta photo ?
            </h3>
            <p className="mt-2 text-sm text-ink-soft">
              Elle sera supprimée immédiatement de nos serveurs (Art. 17
              RGPD). Tu pourras en remettre une nouvelle à tout moment.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemoveOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink ring-1 ring-coral-soft/40 hover:bg-coral-soft/30"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" /> Retirer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
