import { Leaf } from 'lucide-react';

/**
 * Logo Karine.
 *
 * Modes :
 *  - normal (compact=false) : grande typo "Karine 🌿 Diététique" sur
 *    plusieurs lignes possibles, + slogan optionnel.
 *  - compact (compact=true) : une seule ligne basse hauteur. Utilisé
 *    par AppHeader quand l'utilisatrice scroll pour libérer de la
 *    place verticale (pattern iOS Large Title).
 *
 * Toutes les transitions de taille sont en CSS pour un morph fluide
 * entre les deux modes (250 ms ease).
 */
export function Logo({
  className = '',
  slogan = false,
  compact = false,
}: {
  className?: string;
  slogan?: boolean;
  /** Mode condensé sur une ligne (déclenché par le scroll côté header). */
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center leading-none ${className}`}>
      <div className="flex max-w-full flex-nowrap items-baseline justify-center gap-x-1 sm:gap-x-1.5 lg:gap-x-3">
        <span
          className={`font-script font-bold text-coral-dark transition-[font-size] duration-300 ease-out ${
            compact
              ? 'text-2xl'
              : 'text-3xl sm:text-5xl lg:text-7xl'
          }`}
        >
          Karine
        </span>
        <Leaf
          className={`-translate-y-0.5 -rotate-12 self-center text-sage transition-[width,height] duration-300 ease-out ${
            compact ? 'h-4 w-4' : 'h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8'
          }`}
          strokeWidth={2.5}
        />
        <span
          className={`font-bold uppercase tracking-[0.2em] text-ink-soft transition-[font-size] duration-300 ease-out sm:tracking-[0.3em] lg:tracking-[0.35em] ${
            compact
              ? 'text-[0.55rem]'
              : 'text-[0.6rem] sm:text-xs lg:text-lg'
          }`}
        >
          Diététique
        </span>
      </div>
      {/* Slogan visible UNIQUEMENT en mode normal. En mode compact il
          disparait avec une mini fade pour ne pas faire saccade. */}
      {slogan && (
        <span
          className={`mt-1 overflow-hidden font-script text-2xl text-coral transition-all duration-300 ease-out ${
            compact
              ? 'pointer-events-none max-h-0 opacity-0'
              : 'max-h-12 opacity-100'
          }`}
        >
          prenons soin de vous !
        </span>
      )}
    </div>
  );
}
