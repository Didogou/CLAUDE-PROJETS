import Link from 'next/link';
import { ArrowRight, type LucideIcon } from 'lucide-react';

type FeatureTileProps = {
  href: string;
  icon: LucideIcon;
  iconClass: string;
  bgClass: string;
  title: string;
  subtitle: string;
  badge?: string;
  compact?: boolean;
};

export function FeatureTile({
  href,
  icon: Icon,
  iconClass,
  bgClass,
  title,
  subtitle,
  badge,
  compact = false,
}: FeatureTileProps) {
  return (
    <Link
      href={href}
      className={`relative flex flex-col rounded-[var(--radius-tile)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${bgClass}`}
    >
      {badge && (
        <span className="absolute right-3 top-3 rounded-full bg-sage px-2 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-white">
          {badge}
        </span>
      )}

      <span className={`grid h-11 w-11 place-items-center rounded-full bg-white/70 ${iconClass}`}>
        <Icon className="h-6 w-6" strokeWidth={2.2} />
      </span>

      <h2 className={`mt-3 font-bold text-ink ${compact ? 'text-sm' : 'text-base'}`}>{title}</h2>
      <p className="mt-0.5 text-xs leading-snug text-ink-soft">{subtitle}</p>

      <span className="mt-3 grid h-7 w-7 place-items-center self-end rounded-full bg-white/80 text-coral">
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </span>
    </Link>
  );
}
