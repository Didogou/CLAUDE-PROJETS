'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Lock, type LucideIcon } from 'lucide-react';
import { LockedTileModal } from './LockedTileModal';

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
  /** Si true → tuile en mode "réservé" : grisée, cadenas, ouverture modal au clic. */
  locked?: boolean;
  /** Pour personnaliser le contenu de la modal (visiteur vs connecté sans abo). */
  isAuthenticated?: boolean;
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
  locked = false,
  isAuthenticated = false,
}: FeatureTileProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const innerContent = (
    <>
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

      {/* Cadenas en haut-gauche si tuile locked */}
      {locked && (
        <span
          aria-hidden
          className="absolute left-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full bg-white/95 text-coral shadow-sm ring-1 ring-coral-soft"
        >
          <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
      )}

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

      <span className="mt-2 w-full px-1 text-center">
        <span className="block text-base font-bold leading-tight text-ink">{title}</span>
        <span className="mt-1 block whitespace-pre-line text-xs leading-snug text-ink-soft">
          {subtitle}
        </span>
      </span>

      <span className="absolute bottom-3 right-3 z-10 grid h-7 w-7 place-items-center rounded-full bg-coral text-white">
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </span>
    </>
  );

  const baseClass = `group relative flex h-full flex-col items-center rounded-[var(--radius-tile)] p-4 pb-9 shadow-sm transition ${bgClass} ${className}`;
  const lockedClass = locked
    ? 'opacity-65 saturate-75 hover:opacity-80 hover:shadow-md'
    : 'hover:-translate-y-0.5 hover:shadow-md';

  if (locked) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`${baseClass} ${lockedClass} cursor-pointer text-left`}
        >
          {innerContent}
        </button>
        <LockedTileModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          tileTitle={title}
          isAuthenticated={isAuthenticated}
        />
      </>
    );
  }

  return (
    <Link href={href} className={`${baseClass} ${lockedClass}`}>
      {innerContent}
    </Link>
  );
}
