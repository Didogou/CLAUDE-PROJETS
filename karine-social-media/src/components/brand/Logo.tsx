import { Leaf } from 'lucide-react';

export function Logo({ className = '', slogan = false }: { className?: string; slogan?: boolean }) {
  return (
    <div className={`flex flex-col items-center leading-none ${className}`}>
      <div className="flex items-baseline gap-2 lg:gap-3">
        <span className="font-script text-5xl font-bold text-coral-dark lg:text-6xl">Karine</span>
        <Leaf
          className="h-6 w-6 -translate-y-1 -rotate-12 self-center text-sage lg:h-7 lg:w-7"
          strokeWidth={2.5}
        />
        <span className="text-sm font-bold uppercase tracking-[0.35em] text-ink-soft lg:text-base">
          Diététique
        </span>
      </div>
      {slogan && (
        <span className="mt-1 font-script text-xl text-coral">prenons soin de vous !</span>
      )}
    </div>
  );
}
