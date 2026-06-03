'use client';

/**
 * Anneau de progression SVG autour d'un FAB.
 * - Trait gris en arrière-plan (anneau plein)
 * - Trait coloré au-dessus, longueur proportionnelle au percent
 *
 * Le bouton parent doit avoir position:relative pour que ce SVG
 * absolute se cale autour.
 */
export function RingProgress({
  percent,
  color = 'white',
  trackOpacity = 0.25,
  strokeWidth = 6,
}: {
  percent: number;
  color?: string;
  trackOpacity?: number;
  strokeWidth?: number;
}) {
  const r = 50 - strokeWidth / 2;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <svg
      className="pointer-events-none absolute inset-0 -rotate-90"
      viewBox="0 0 100 100"
      aria-hidden
    >
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={color}
        strokeOpacity={trackOpacity}
        strokeWidth={strokeWidth}
      />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={C}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.4s ease-out' }}
      />
    </svg>
  );
}
