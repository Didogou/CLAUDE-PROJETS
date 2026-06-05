'use client';

/**
 * Cercle de progression SVG simple (sans dépendance).
 *
 * Usage : compteur de calories restantes dans la sheet calorie.
 *  - track gris derrière
 *  - arc coloré qui se remplit selon `value / max`
 *  - children rendus au centre (libre : valeur, sous-texte…)
 *
 * Tout en `rem` / `%` — aucun pixel.
 */
export function CircularProgress({
  value,
  max,
  size = '11rem',
  strokeWidth = '0.85rem',
  trackClassName = 'stroke-white/40',
  arcClassName = 'stroke-white',
  /**
   * Sens de rotation du SVG.
   *  - `'-rotate-90'` (par défaut) : départ en haut, arc qui tourne
   *    dans le sens horaire (cas calorie).
   *  - `'rotate-90'` : départ en bas, arc qui se remplit en montant
   *    (effet "verre qui se remplit" pour la jauge eau).
   */
  rotateClassName = '-rotate-90',
  children,
}: {
  value: number;
  max: number;
  /** Diamètre du cercle (rem ou %). */
  size?: string;
  /** Épaisseur du trait. */
  strokeWidth?: string;
  /** Classe CSS pour le track gris. */
  trackClassName?: string;
  /** Classe CSS pour l'arc rempli. */
  arcClassName?: string;
  /** Classe Tailwind rotate-* pour orienter le départ de l'arc. */
  rotateClassName?: string;
  /** Rendu au centre du cercle (valeur, sous-texte…). */
  children?: React.ReactNode;
}) {
  // ViewBox unitaire 100×100 → tout est ratio interne, indépendant
  // de la taille rendue. La circonférence du cercle de rayon 45 est
  // 2πr ≈ 282.74. On utilise stroke-dasharray + dashoffset pour
  // animer le remplissage.
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  const dashoffset = circumference * (1 - ratio);

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        className={`absolute inset-0 h-full w-full overflow-visible ${rotateClassName}`}
        aria-hidden
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={trackClassName}
          style={{ strokeWidth }}
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          className={`${arcClassName} transition-[stroke-dashoffset] duration-500`}
          style={{ strokeWidth }}
        />
      </svg>
      <div className="relative z-10 grid place-items-center text-center">
        {children}
      </div>
    </div>
  );
}
