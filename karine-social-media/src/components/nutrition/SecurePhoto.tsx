'use client';

import { useEffect, useState } from 'react';

/**
 * SecurePhoto — Affiche une photo repas en gérant transparemment :
 *  - Le nouveau format (path Storage type "user_uuid/photo_uuid.jpg")
 *    → fetch /api/nutrition/photo/[photoId] pour obtenir une signed URL 1h
 *  - L'ancien format (URL publique complète, legacy)
 *    → affiche directement (compatibilité retro pendant transition)
 *
 * Cache la signed URL pendant 50 min (TTL serveur 60 min, marge 10 min)
 * en mémoire (Map module-scope) pour éviter de re-fetch à chaque mount.
 *
 * @example
 *   <SecurePhoto src={entry.photoUrl} alt="Repas" className="size-12" />
 */

type SignedCacheEntry = {
  url: string;
  fetchedAt: number;
};

// Cache simple en mémoire — partagé entre tous les composants SecurePhoto.
// Clé = path Storage (jamais URL legacy). TTL effectif 50 min.
const SIGNED_CACHE = new Map<string, SignedCacheEntry>();
const CACHE_TTL_MS = 50 * 60 * 1000;

/** Test : est-ce une URL HTTP complète (legacy bucket public) ? */
function isFullUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

/** Extrait l'UUID photo depuis un path "user_uuid/photo_uuid.jpg". */
function extractPhotoId(path: string): string | null {
  // path = "{user_uuid}/{photo_uuid}.jpg"
  const m = path.match(/^[0-9a-f-]+\/([0-9a-f-]+)\.(?:jpg|jpeg|png|webp)$/i);
  return m ? m[1] : null;
}

export function SecurePhoto({
  src,
  alt,
  className,
  onClick,
  loading = 'lazy',
}: {
  /** path Storage (nouveau) OU URL complète (legacy). null/undefined → pas d'image */
  src: string | null | undefined;
  alt: string;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLImageElement>) => void;
  loading?: 'lazy' | 'eager';
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setResolvedUrl(null);
      return;
    }

    // Cas legacy : URL complète → utiliser direct
    if (isFullUrl(src)) {
      setResolvedUrl(src);
      return;
    }

    // Cas nouveau : path Storage → fetch signed URL
    const cached = SIGNED_CACHE.get(src);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setResolvedUrl(cached.url);
      return;
    }

    const photoId = extractPhotoId(src);
    if (!photoId) {
      // Format invalide → on n'affiche rien plutôt que générer une 404
      setResolvedUrl(null);
      return;
    }

    let cancelled = false;
    fetch(`/api/nutrition/photo/${photoId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { signedUrl?: string } | null) => {
        if (cancelled || !data?.signedUrl) {
          setResolvedUrl(null);
          return;
        }
        SIGNED_CACHE.set(src, {
          url: data.signedUrl,
          fetchedAt: Date.now(),
        });
        setResolvedUrl(data.signedUrl);
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!resolvedUrl) return null;

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={resolvedUrl}
      alt={alt}
      className={className}
      onClick={onClick}
      loading={loading}
    />
  );
}

/** Helper pour les composants qui ont besoin de la signed URL en string
 *  (par ex. lightbox qui prend une URL en prop). */
export function useSignedPhotoUrl(src: string | null | undefined): string | null {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setResolvedUrl(null);
      return;
    }
    if (isFullUrl(src)) {
      setResolvedUrl(src);
      return;
    }
    const cached = SIGNED_CACHE.get(src);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setResolvedUrl(cached.url);
      return;
    }
    const photoId = extractPhotoId(src);
    if (!photoId) {
      setResolvedUrl(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/nutrition/photo/${photoId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { signedUrl?: string } | null) => {
        if (cancelled || !data?.signedUrl) {
          setResolvedUrl(null);
          return;
        }
        SIGNED_CACHE.set(src, {
          url: data.signedUrl,
          fetchedAt: Date.now(),
        });
        setResolvedUrl(data.signedUrl);
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolvedUrl;
}
