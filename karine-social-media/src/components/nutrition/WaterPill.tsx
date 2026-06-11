'use client';

import { useCallback, useEffect, useState } from 'react';
import { WaterCounterSheet } from './WaterCounterSheet';

/**
 * Bouton rond "Mon verre d'eau" dans le header (à gauche de TrackingPill).
 *
 * Apparence identique pour visiteurs et abonnés (cercle bleu sky avec
 * verre Lucide), seul le comportement au clic change :
 *
 *  - non-auth : redirige vers /login
 *  - auth     : ouvre la WaterCounterSheet slide-up (+1 / -1 / réglages
 *               / historique) — même design que l'ancien Mes calories
 *
 * Sync via event 'water-log-updated' (compatible avec WaterFAB et
 * autres consumers de l'état eau).
 */
export function WaterPill({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [glasses, setGlasses] = useState<number | null>(null);
  const [target, setTarget] = useState<number>(6);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch('/api/water/today', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setGlasses(Number(data.glassesCount) || 0);
      setTarget(
        Math.max(
          1,
          Math.round((data.targetMl ?? 1500) / (data.glassSizeMl ?? 150)),
        ),
      );
    } catch {
      /* silent */
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('water-log-updated', onChange);
    return () => window.removeEventListener('water-log-updated', onChange);
  }, [refresh]);

  const reached = glasses !== null && glasses >= target;
  // Bleu pastel doux (ring sky-300 au lieu de sky-400/500).
  const className = `relative grid h-9 w-9 place-items-center rounded-full bg-white shadow-md ring-2 transition hover:scale-105 active:scale-95 ${
    reached ? 'ring-emerald-300' : 'ring-sky-300'
  }`;
  // Pourcentage de remplissage 0-100 pour le verre.
  const percent =
    glasses === null
      ? 0
      : Math.max(0, Math.min(100, Math.round((glasses / target) * 100)));

  function handleClick() {
    if (!isAuthenticated) {
      window.location.href = `/login?next=${encodeURIComponent('/')}`;
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Mon compteur d'eau"
        title="Mon compteur d'eau"
        className={className}
      >
        <WaterGlassSvg
          percent={percent}
          reached={reached}
          className="h-5 w-5"
        />
        {/* Mini badge en bas-droite avec le compteur si auth */}
        {isAuthenticated && glasses !== null && (
          <span
            className={`absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-0.5 text-[0.55rem] font-extrabold text-white ring-2 ring-white/90 ${
              reached ? 'bg-emerald-400' : 'bg-sky-300'
            }`}
          >
            {glasses}
          </span>
        )}
      </button>

      {open && (
        <WaterCounterSheet
          onClose={() => setOpen(false)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

/**
 * Petit verre SVG avec niveau d'eau qui monte selon `percent` (0-100).
 * Forme verre trapézoïdale, eau en pastel (sky-200 ou emerald-200 si
 * objectif atteint). Le clipPath fait que l'eau ne déborde pas.
 */
function WaterGlassSvg({
  percent,
  reached,
  className,
}: {
  percent: number;
  reached: boolean;
  className?: string;
}) {
  // Coordonnées du verre dans viewBox 24×24 :
  //  - Sommet (gauche/droite) : (6,4) → (18,4)
  //  - Base (gauche/droite) : (8,20) → (16,20)
  // L'eau monte de la base (y=20) vers le sommet (y=4) selon `percent`.
  const waterHeight = (16 * percent) / 100; // 0 à 16
  const waterY = 20 - waterHeight;
  const waterColor = reached ? '#6ee7b7' : '#bae6fd'; // emerald-300 / sky-200
  const strokeColor = reached ? '#10b981' : '#0ea5e9'; // emerald-500 / sky-500
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <clipPath id="water-glass-clip">
          {/* Trapèze intérieur du verre (légèrement plus petit que le contour) */}
          <path d="M 6.5 4.5 L 17.5 4.5 L 16.2 19.5 L 7.8 19.5 Z" />
        </clipPath>
      </defs>
      {/* L'eau (rectangle qui monte), clipée à la forme du verre */}
      <rect
        x="4"
        y={waterY}
        width="16"
        height={waterHeight + 0.2}
        fill={waterColor}
        clipPath="url(#water-glass-clip)"
      />
      {/* Contour du verre */}
      <path
        d="M 6 4 L 18 4 L 16.5 20 L 7.5 20 Z"
        stroke={strokeColor}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Petite bulle/highlight en haut pour l'effet "eau brillante" */}
      {percent > 5 && (
        <line
          x1="9"
          y1={Math.max(waterY + 1, 5.5)}
          x2="11.5"
          y2={Math.max(waterY + 1, 5.5)}
          stroke="white"
          strokeWidth="0.8"
          strokeLinecap="round"
          opacity="0.7"
        />
      )}
    </svg>
  );
}
