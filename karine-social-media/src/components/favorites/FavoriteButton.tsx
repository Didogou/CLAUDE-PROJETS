'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import type { FavoriteType } from '@/data/favorites';

/**
 * Bouton cœur réutilisable : ajoute/retire un favori (optimistic UI).
 * À placer en coin top-right d'une carte ou fiche.
 *
 * Si l'utilisatrice n'est pas connectée : clic redirige vers /login?next=...
 */
export function FavoriteButton({
  targetType,
  targetId,
  initialFavorited,
  isAuthenticated,
  className = '',
  size = 'md',
}: {
  targetType: FavoriteType;
  targetId: string;
  initialFavorited: boolean;
  isAuthenticated: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [busy, setBusy] = useState(false);

  const sizeMap = {
    sm: { btn: 'h-7 w-7', icon: 'h-3.5 w-3.5' },
    md: { btn: 'h-9 w-9', icon: 'h-4.5 w-4.5' },
    lg: { btn: 'h-11 w-11', icon: 'h-5 w-5' },
  } as const;
  const sizes = sizeMap[size];

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!isAuthenticated) {
      const here = typeof window !== 'undefined' ? window.location.pathname : '/';
      router.push(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    setBusy(true);
    const next = !favorited;
    setFavorited(next); // optimiste
    try {
      if (next) {
        const res = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType, targetId }),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch(
          `/api/favorites?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error();
      }
    } catch {
      setFavorited(!next); // rollback
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={favorited}
      aria-label={favorited ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      disabled={busy}
      className={`${sizes.btn} grid place-items-center rounded-full bg-white/95 shadow-sm ring-1 ring-coral-soft/40 transition hover:scale-110 disabled:opacity-50 ${className}`}
    >
      <Heart
        className={`${sizes.icon} transition-colors ${
          favorited ? 'fill-coral text-coral' : 'text-coral-dark'
        }`}
        strokeWidth={2.2}
      />
    </button>
  );
}
