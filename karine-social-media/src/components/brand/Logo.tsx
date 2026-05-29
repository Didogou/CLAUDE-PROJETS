import { Leaf } from 'lucide-react';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center leading-none ${className}`}>
      <div className="flex items-center gap-1">
        <span className="font-script text-3xl text-coral-dark">Karine</span>
        <Leaf className="h-4 w-4 text-sage -rotate-12" strokeWidth={2.5} />
      </div>
      <span className="text-[0.6rem] font-semibold tracking-[0.35em] text-ink-soft uppercase">
        Diététique
      </span>
    </div>
  );
}
