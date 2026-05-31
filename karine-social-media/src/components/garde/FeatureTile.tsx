import Link from 'next/link';
import { ArrowRight, type LucideIcon } from 'lucide-react';

type FeatureTileProps = {
  href: string;
  title: string;
  subtitle: string;
  /** Couleur de fond de la tuile (ex. bg-peach). */
  bgClass: string;
  /** Illustration en fond transparent, placée dans le cercle blanc (prioritaire). */
  iconImage?: string;
  /** Repli icône lucide si pas d'illustration. */
  icon?: LucideIcon;
  iconClass?: string;
  badge?: string;
  /** Décoration PNG en coin haut-droit (ex. étincelles). */
  accentImage?: string;
  className?: string;
};

export function FeatureTile({
  href,
  title,
  subtitle,
  bgClass,
  iconImage,
  icon: Icon,
  iconClass = '',
  badge,
  accentImage,
  className = '',
}: FeatureTileProps) {
  return (
    <Link
      href={href}
      className={`group relative flex h-full flex-col items-center rounded-[var(--radius-tile)] p-4 pb-9 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${bgClass} ${className}`}
    >
      {badge && (
        <span
          className={`absolute top-3 z-10 rounded-full bg-sage px-2 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-white ${
            accentImage ? 'left-3' : 'right-3'
          }`}
        >
          {badge}
        </span>
      )}

      {accentImage && (
        <span
          aria-hidden
          className="absolute -right-3 -top-3 z-10 h-28 w-28 bg-contain bg-right-top bg-no-repeat"
          style={{ backgroundImage: `url(${accentImage})` }}
        />
      )}

      {/* Icône en haut (alignées car toutes en tête de tuile) */}
      {iconImage ? (
        <span
          aria-hidden
          className="h-24 w-24 bg-contain bg-center bg-no-repeat lg:h-28 lg:w-28"
          style={{ backgroundImage: `url(${iconImage})` }}
        />
      ) : (
        Icon && (
          <span className="grid h-20 w-20 place-items-center rounded-full bg-white shadow-sm">
            <Icon className={`h-10 w-10 ${iconClass}`} strokeWidth={2} />
          </span>
        )
      )}

      {/* Texte sous l'icône */}
      <span className="mt-2 w-full px-1 text-center">
        <span className="block text-base font-bold leading-tight text-ink">{title}</span>
        <span className="mt-1 block whitespace-pre-line text-xs leading-snug text-ink-soft">
          {subtitle}
        </span>
      </span>

      <span className="absolute bottom-3 right-3 z-10 grid h-7 w-7 place-items-center rounded-full bg-coral text-white">
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </span>
    </Link>
  );
}
