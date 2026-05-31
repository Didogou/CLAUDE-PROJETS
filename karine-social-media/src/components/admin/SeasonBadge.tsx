import { Leaf } from 'lucide-react';

export function SeasonBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title="Recette de saison"
      aria-label="De saison"
      className={
        compact
          ? 'inline-flex items-center gap-1 rounded-full bg-sage/15 px-1.5 py-0.5 text-[0.6rem] font-semibold text-sage'
          : 'inline-flex items-center gap-1 rounded-full bg-sage/15 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-sage'
      }
    >
      <Leaf className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {compact ? 'Saison' : 'De saison'}
    </span>
  );
}
