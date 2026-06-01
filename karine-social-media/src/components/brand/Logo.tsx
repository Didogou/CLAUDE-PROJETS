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
        <span className="font-script text-4xl font-bold text-coral-dark sm:text-5xl lg:text-6xl">
          Karine
        </span>
        <Leaf
          className="h-5 w-5 -translate-y-0.5 -rotate-12 self-center text-sage sm:h-6 sm:w-6 lg:h-7 lg:w-7"
          strokeWidth={2.5}
        />
        <span className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-ink-soft sm:text-sm sm:tracking-[0.35em] lg:text-base">
          Diététique
        </span>
      </div>
      {slogan && (
        <span className="mt-1 font-script text-xl text-coral">prenons soin de vous !</span>
      )}
    </div>
  );
}
