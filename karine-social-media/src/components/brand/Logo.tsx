import { Leaf } from 'lucide-react';

/**
 * Logo Karine — "Karine 🌿 Diététique" sur une ligne, mais avec un wrap
 * propre sur très petits écrans (< 360 px) pour éviter le débordement.
 */
export function Logo({
  className = '',
  slogan = false,
}: {
  className?: string;
  slogan?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center leading-none ${className}`}>
      <div className="flex max-w-full flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0 sm:gap-x-2 lg:gap-x-3">
        <span className="font-script text-5xl font-bold text-coral-dark sm:text-6xl lg:text-7xl">
          Karine
        </span>
        <Leaf
          className="h-6 w-6 -translate-y-0.5 -rotate-12 self-center text-sage sm:h-7 sm:w-7 lg:h-8 lg:w-8"
          strokeWidth={2.5}
        />
        <span className="text-xs font-bold uppercase tracking-[0.3em] text-ink-soft sm:text-base sm:tracking-[0.35em] lg:text-lg">
          Diététique
        </span>
      </div>
      {slogan && (
        <span className="mt-1 font-script text-2xl text-coral">prenons soin de vous !</span>
      )}
    </div>
  );
}
