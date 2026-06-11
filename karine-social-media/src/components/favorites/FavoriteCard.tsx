'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bookmark, Trash2 } from 'lucide-react';
import type { FavoriteItem } from '@/data/favorites';

/**
 * Carte d'un favori avec bouton de retrait intégré (coeur plein
 * en top-right). Clic sur le coeur : suppression immédiate avec
 * animation fade-out. Clic ailleurs : navigation vers le contenu.
 */
export function FavoriteCard({ item }: { item: FavoriteItem }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (removing) return;
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/favorites?targetType=${item.targetType}&targetId=${encodeURIComponent(item.targetId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error();
      // Petit délai pour laisser l'animation de fade-out se jouer
      window.setTimeout(() => router.refresh(), 250);
    } catch {
      setRemoving(false);
    }
  }

  return (
    <Link
      href={item.href}
      className={`group relative flex flex-col gap-2 rounded-2xl bg-white/90 p-2 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        removing ? 'pointer-events-none scale-95 opacity-0' : ''
      }`}
      style={{ transition: 'opacity 240ms, transform 240ms, box-shadow 200ms' }}
    >
      <div
        aria-hidden
        className="aspect-square w-full overflow-hidden rounded-xl bg-blush/40 bg-cover bg-center"
        style={
          item.imageUrl
            ? { backgroundImage: `url(${item.imageUrl})` }
            : undefined
        }
      />
      <p className="line-clamp-2 px-1 text-center text-xs font-semibold text-ink">
        {item.label}
      </p>

      {/* Bookmark coral plein en HAUT GAUCHE pour montrer que l'item
          est favori (convention nouvelle, cohérence avec /recettes
          et /menus). Décoratif (le tap retrait est sur le bouton à
          droite). */}
      <span
        aria-hidden
        className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 shadow-sm ring-1 ring-coral-soft/40"
      >
        <Bookmark className="h-3.5 w-3.5 fill-coral text-coral" strokeWidth={2} />
      </span>

      {/* Bouton retrait EXPLICITE — icône poubelle pour être clair que
          tap = supprimer le favori. Animation fade-out via removing. */}
      <button
        type="button"
        onClick={remove}
        disabled={removing}
        aria-label="Retirer des favoris"
        title="Retirer des favoris"
        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-coral-dark shadow-sm ring-1 ring-coral-soft/40 transition hover:scale-110 hover:bg-rose-50 hover:text-rose-600"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2.2} />
      </button>
    </Link>
  );
}
