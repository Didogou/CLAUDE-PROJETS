'use client';

import { useEffect, useMemo } from 'react';

/**
 * Génère des URL blob pour une liste de fichiers et les révoque
 * automatiquement quand la liste change ou que le composant démonte.
 *
 * Sans cleanup, chaque keystroke dans un input contrôlé qui re-render
 * le parent crée 2 nouvelles object URLs par fichier sans relâcher
 * les précédentes → la mémoire navigateur grimpe (bug observé sur
 * RecipeDetailView et TipCommentsDrawer avant 2026-06-12).
 *
 * Usage :
 *   const previewUrls = useObjectURLs(draftPhotos);
 *   // <img src={previewUrls[i]} />
 *
 * Pour un seul fichier :
 *   const url = useObjectURL(file);
 */
export function useObjectURLs(files: File[]): string[] {
  const urls = useMemo(
    () => files.map((f) => URL.createObjectURL(f)),
    [files],
  );
  useEffect(() => {
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [urls]);
  return urls;
}

/**
 * Variante 1 fichier (ou null). Retourne null si pas de fichier.
 */
export function useObjectURL(file: File | null | undefined): string | null {
  const url = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}
