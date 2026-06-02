/* eslint-disable @next/next/no-img-element */
'use client';

import { useState } from 'react';
import { Heart, Sparkles } from 'lucide-react';
import { SaviezVousLightbox } from './SaviezVousLightbox';

/**
 * Section "Le saviez-vous ?" sur la home — polaroids accrochés à un fil
 * façon labo photo. Karine y poste des photos d'actualité (légumes de
 * saison, événements, anecdotes).
 *
 * UX :
 *  - Nombre d'images illimité (scroll horizontal si ça déborde)
 *  - Toutes les images mêmes dimensions
 *  - Rotations stables par index pour effet "à la main"
 *  - Fil courbé en U traversant de bord à bord
 *  - Clic sur un polaroid → lightbox avec zoom (pinch/double-tap),
 *    partager, imprimer, liker
 */

export type SaviezVousItem = {
  id: string;
  imageUrl: string;
  caption?: string | null;
  likesCount?: number;
};

const ROTATIONS = [
  '-rotate-2',
  'rotate-1',
  '-rotate-1',
  'rotate-2',
  '-rotate-1',
  'rotate-1',
] as const;

export function SaviezVousFil({ items }: { items: SaviezVousItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (items.length === 0) return null;

  const openItem = openIdx !== null ? items[openIdx] : null;

  return (
    <>
      <section className="relative rounded-[var(--radius-card)] bg-gradient-to-br from-cream via-blush/40 to-peach/30 px-3 pb-6 pt-4 shadow-sm lg:px-5 lg:pb-7 lg:pt-5">
        <header className="mb-3 flex items-center justify-between px-2">
          <h2 className="flex items-center gap-1.5 font-script text-3xl text-coral lg:text-4xl">
            Le saviez-vous&nbsp;?
          </h2>
          <Sparkles className="h-5 w-5 text-tangerine" aria-hidden />
        </header>

        {/* Wrapper relatif qui ancre le fil au niveau des pinces. */}
        <div className="relative">
          {/* Fil tendu d'un bord à l'autre — passe PILE au niveau des pinces.
              Calcul : la pince a -top-2 (-8px) du polaroid + h-5 (20px),
              et le polaroid commence à pt-1 (4px) du wrapper.
              Donc centre vertical de la pince = 4 - 8 + 10 = 6px.
              Le SVG est positionné en top-[3px] avec h-[6px] et path
              centré sur y=3 → fil traverse les pinces à 6px du wrapper. */}
          <svg
            aria-hidden
            viewBox="0 0 100 4"
            preserveAspectRatio="none"
            className="pointer-events-none absolute -inset-x-3 top-[3px] h-[6px] lg:-inset-x-5"
          >
            <path
              d="M 0 1.5 Q 50 2.5 100 1.5"
              fill="none"
              stroke="#5e4f3c"
              strokeWidth="2.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M 0 1.5 Q 50 2.5 100 1.5"
              fill="none"
              stroke="#fff"
              strokeWidth="0.8"
              strokeLinecap="round"
              strokeOpacity="0.45"
              vectorEffect="non-scaling-stroke"
              transform="translate(0,-0.4)"
            />
          </svg>

          {/* Polaroids — scrollable horizontal si overflow.
              justify-start sur mobile (sinon le 1er polaroid est tronqué).
              sm:justify-center pour centrer quand pas d'overflow. */}
          <div className="-mx-3 overflow-x-auto lg:-mx-5">
            <ul className="flex items-start justify-start gap-3 px-3 pb-2 pt-1 sm:justify-center sm:gap-4 lg:px-5">
              {items.map((item, i) => (
                <li key={item.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpenIdx(i)}
                    aria-label={`Agrandir : ${item.caption ?? 'photo'}`}
                    className="block"
                  >
                    <Polaroid
                      imageUrl={item.imageUrl}
                      caption={item.caption}
                      likesCount={item.likesCount}
                      rotationClass={ROTATIONS[i % ROTATIONS.length]}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {openItem && (
        <SaviezVousLightbox
          imageUrl={openItem.imageUrl}
          caption={openItem.caption ?? null}
          onClose={() => setOpenIdx(null)}
        />
      )}
    </>
  );
}

function Polaroid({
  imageUrl,
  caption,
  likesCount,
  rotationClass,
}: {
  imageUrl: string;
  caption?: string | null;
  likesCount?: number;
  rotationClass: string;
}) {
  return (
    <figure
      className={`relative flex w-20 flex-col items-center transition-transform duration-200 sm:w-24 lg:w-28 ${rotationClass} hover:-translate-y-1 hover:rotate-0`}
    >
      {/* Pince — centrée au-dessus du polaroid, dépasse sur le fil */}
      <ClothesPin className="absolute -top-2 z-10 h-5 w-3" />

      {/* Badge nombre de likes — bas-droit du polaroid, sur la photo. */}
      {typeof likesCount === 'number' && likesCount > 0 && (
        <span className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-0.5 text-[0.6rem] font-bold text-coral shadow-sm ring-1 ring-coral-soft/40">
          <Heart className="h-2.5 w-2.5 fill-coral" strokeWidth={0} />
          {likesCount}
        </span>
      )}

      {/* Polaroid : bord blanc épais en bas (zone caption) */}
      <div className="block w-full rounded-sm bg-white p-1.5 pb-5 shadow-[0_6px_14px_-8px_rgba(0,0,0,0.35)] ring-1 ring-ink/5">
        <div className="aspect-square w-full overflow-hidden bg-blush/40">
          <img
            src={imageUrl}
            alt={caption ?? ''}
            draggable={false}
            className="h-full w-full select-none object-cover"
          />
        </div>
        {caption && (
          <figcaption className="mt-1 line-clamp-2 px-0.5 text-center font-script text-[0.7rem] leading-tight text-ink-soft">
            {caption}
          </figcaption>
        )}
      </div>
    </figure>
  );
}

function ClothesPin({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 24" fill="none" aria-hidden className={className}>
      <rect x="2" y="0" width="10" height="14" rx="2" fill="#c4b8a5" stroke="#9c8c75" strokeWidth="0.4" />
      <rect x="6.3" y="2" width="1.4" height="10" fill="#9c8c75" opacity="0.6" />
      <rect x="3" y="13" width="2.2" height="9" rx="0.5" fill="#c4b8a5" stroke="#9c8c75" strokeWidth="0.3" />
      <rect x="8.8" y="13" width="2.2" height="9" rx="0.5" fill="#c4b8a5" stroke="#9c8c75" strokeWidth="0.3" />
    </svg>
  );
}
