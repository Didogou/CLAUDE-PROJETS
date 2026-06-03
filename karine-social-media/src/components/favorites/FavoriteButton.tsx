'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { FAVORITE_LABELS, type FavoriteType } from '@/data/favorites';

/**
 * Bouton cœur réutilisable avec feedback visuel marqué :
 *  - Explosion de petits cœurs au clic d'ajout
 *  - Toast bottom qui gonfle puis revient à taille normale
 *  - Label texte optionnel ("Ajouter aux favoris")
 *  - Optimistic UI + rollback en cas d'erreur
 *  - Visiteur → redirige vers /login?next=
 */
export function FavoriteButton({
  targetType,
  targetId,
  initialFavorited,
  isAuthenticated,
  className = '',
  size = 'md',
  showLabel = false,
  labelShort = false,
}: {
  targetType: FavoriteType;
  targetId: string;
  initialFavorited: boolean;
  isAuthenticated: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  /** Si true, affiche un texte court "Favoris" / "Favori" au lieu de
   *  la formulation longue "Ajouter aux favoris" / "Dans tes favoris". */
  labelShort?: boolean;
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [busy, setBusy] = useState(false);
  const [bursts, setBursts] = useState<number[]>([]);
  const [toast, setToast] = useState<{ message: string; added: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const sizeMap = {
    sm: { btn: 'h-8 w-8', icon: 'h-4 w-4', label: 'text-xs' },
    md: { btn: 'h-10 w-10', icon: 'h-5 w-5', label: 'text-sm' },
    lg: { btn: 'h-12 w-12', icon: 'h-6 w-6', label: 'text-base' },
  } as const;
  const sizes = sizeMap[size];

  function fireBurst() {
    const baseId = Date.now();
    const ids = Array.from({ length: 7 }, (_, i) => baseId + i);
    setBursts((prev) => [...prev, ...ids]);
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((id) => !ids.includes(id)));
    }, 1300);
  }

  function fireToast(message: string, added: boolean) {
    setToast({ message, added });
    window.setTimeout(() => setToast(null), 2000);
  }

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!isAuthenticated) {
      const here =
        typeof window !== 'undefined'
          ? window.location.pathname + window.location.search
          : '/';
      router.push(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    setBusy(true);
    const next = !favorited;
    setFavorited(next);
    if (next) {
      fireBurst();
      fireToast(`${FAVORITE_LABELS[targetType]} ajoutée à tes favoris ❤️`, true);
    } else {
      fireToast(`${FAVORITE_LABELS[targetType]} retirée de tes favoris`, false);
    }
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
      setFavorited(!next);
      setToast({ message: 'Une erreur est survenue', added: false });
      window.setTimeout(() => setToast(null), 2000);
    } finally {
      setBusy(false);
    }
  }

  const labelText = showLabel
    ? favorited
      ? labelShort
        ? 'Favori'
        : 'Dans tes favoris'
      : labelShort
        ? 'Favoris'
        : 'Ajouter aux favoris'
    : null;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={favorited}
        aria-label={favorited ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        disabled={busy}
        className={`relative ${
          showLabel
            ? 'inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 shadow-md ring-1 ring-coral-soft/40'
            : `${sizes.btn} grid place-items-center rounded-full bg-white/95 shadow-sm ring-1 ring-coral-soft/40`
        } transition hover:scale-110 disabled:opacity-50 ${className}`}
      >
        <Heart
          className={`${sizes.icon} transition-all ${
            favorited ? 'fill-coral text-coral' : 'text-coral-dark'
          }`}
          strokeWidth={2.2}
        />
        {labelText && (
          <span
            className={`${sizes.label} font-semibold ${
              favorited ? 'text-coral' : 'text-coral-dark'
            }`}
          >
            {labelText}
          </span>
        )}

        {/* Explosion de petits cœurs au clic d'ajout */}
        {bursts.map((id, i) => {
          const angle = -90 + (i - 3) * 18;
          const distance = 50 + (i % 3) * 14;
          const dx = Math.cos((angle * Math.PI) / 180) * distance;
          const dy = Math.sin((angle * Math.PI) / 180) * distance;
          return (
            <span
              key={id}
              aria-hidden
              className="fav-burst pointer-events-none absolute left-1/2 top-1/2"
              style={
                {
                  '--dx': `${dx}px`,
                  '--dy': `${dy}px`,
                  animationDelay: `${i * 30}ms`,
                } as React.CSSProperties
              }
            >
              <Heart className="h-3 w-3 fill-coral text-coral" strokeWidth={0} />
            </span>
          );
        })}
      </button>

      <style>{`
        @keyframes fav-burst-fly {
          0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1); opacity: 0; }
        }
        .fav-burst {
          animation: fav-burst-fly 1.1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .fav-burst { animation: none; opacity: 0; }
        }
      `}</style>

      {/* Toast en portail, au-dessus du BottomNav. */}
      {mounted && toast
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              className="fixed bottom-20 left-1/2 z-[200] -translate-x-1/2 print:hidden"
            >
              <div className="fav-toast flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink shadow-2xl ring-2 ring-coral-soft/60">
                <Heart
                  className={`h-4 w-4 ${
                    toast.added ? 'fill-coral text-coral' : 'text-ink-soft'
                  }`}
                  strokeWidth={2.2}
                />
                {toast.message}
              </div>
              <style>{`
                @keyframes fav-toast-in {
                  0%   { transform: translateY(8px) scale(0.7); opacity: 0; }
                  40%  { transform: translateY(0) scale(1.15); opacity: 1; }
                  60%  { transform: translateY(0) scale(0.95); }
                  100% { transform: translateY(0) scale(1); opacity: 1; }
                }
                @keyframes fav-toast-out {
                  to { transform: translateY(4px); opacity: 0; }
                }
                .fav-toast {
                  animation:
                    fav-toast-in 350ms cubic-bezier(0.22, 1, 0.36, 1) forwards,
                    fav-toast-out 220ms ease-in forwards 1.78s;
                  will-change: transform, opacity;
                }
              `}</style>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
