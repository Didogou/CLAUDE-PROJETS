'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Heart, Sparkles } from 'lucide-react';
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

export function SaviezVousFil({
  items,
  isAuthenticated = false,
  favoritedIds = new Set<string>(),
}: {
  items: SaviezVousItem[];
  isAuthenticated?: boolean;
  favoritedIds?: Set<string>;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  // Index du polaroid actuellement le plus proche du centre du scroller
  // — sert à afficher son caption en grand sous le titre de la section.
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Chevrons gauche/droite : visibles uniquement si on peut scroller
  // dans la direction concernée (sinon overlay inutile sur les bords).
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Détecte quel polaroid est centré dans la viewport scrollable +
  // recalcule la visibilité des chevrons. Approche : à chaque scroll,
  // distance au centre de chaque <li>, le plus proche gagne. Pas
  // d'IntersectionObserver car on veut LE plus proche, pas tous ceux
  // qui débordent.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const scrollerRect = el.getBoundingClientRect();
      const centerX = scrollerRect.left + scrollerRect.width / 2;
      const lis = el.querySelectorAll('li');
      let closestIdx = 0;
      let closestDist = Infinity;
      lis.forEach((li, i) => {
        const r = (li as HTMLElement).getBoundingClientRect();
        const dist = Math.abs(r.left + r.width / 2 - centerX);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      });
      setActiveIdx(closestIdx);
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(
        el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [items.length]);

  // Scroll programmatique de ~70 % de la largeur visible → expose
  // 1-2 polaroids supplémentaires par clic. scrollTo (absolu) + clamp
  // pour snap propre au début/fin même avec smooth scroll en cours.
  function scrollBy(direction: 'left' | 'right') {
    const el = scrollerRef.current;
    if (!el) return;
    const delta = el.clientWidth * 0.7;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const target =
      direction === 'left'
        ? Math.max(0, el.scrollLeft - delta)
        : Math.min(maxScroll, el.scrollLeft + delta);
    el.scrollTo({ left: target, behavior: 'smooth' });
  }

  if (items.length === 0) return null;

  // Items normalisés pour la lightbox (caption typé string | null)
  const lightboxItems = items.map((it) => ({
    id: it.id,
    imageUrl: it.imageUrl,
    caption: it.caption ?? null,
  }));

  return (
    <>
      <section className="relative rounded-[var(--radius-card)] bg-gradient-to-br from-cream via-blush/40 to-peach/30 px-3 pb-6 pt-4 shadow-sm lg:px-5 lg:pb-7 lg:pt-5">
        <header className="mb-1 flex items-center justify-between px-2">
          <h2 className="flex items-center gap-1.5 font-script text-3xl text-coral lg:text-4xl">
            Le saviez-vous&nbsp;?
          </h2>
          <Sparkles className="h-5 w-5 text-tangerine" aria-hidden />
        </header>

        {/* Caption du polaroid actuellement centré dans le scroller.
            Permet de lire le sujet en grand AVANT de cliquer pour
            ouvrir la lightbox. Hauteur réservée (min-h-6) pour éviter
            le saut de layout quand un item n'a pas de caption. */}
        <p
          aria-live="polite"
          className="mb-3 min-h-[1.5rem] px-2 text-center font-script text-xl text-coral-dark lg:text-2xl"
        >
          {items[activeIdx]?.caption ?? ''}
        </p>

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

          {/* Chevron GAUCHE — apparaît seulement si on peut scroller à
              gauche. z-20 pour passer au-dessus du fil et des pinces. */}
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scrollBy('left')}
              aria-label="Polaroids précédents"
              className="pointer-events-auto absolute left-1 top-1/2 z-20 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-coral-dark shadow-md ring-1 ring-coral-soft/50 backdrop-blur-sm transition hover:bg-white"
            >
              <ChevronLeft className="size-4" strokeWidth={2.5} />
            </button>
          )}
          {/* Chevron DROITE — apparaît seulement s'il reste à voir. */}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollBy('right')}
              aria-label="Polaroids suivants"
              className="pointer-events-auto absolute right-1 top-1/2 z-20 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-coral-dark shadow-md ring-1 ring-coral-soft/50 backdrop-blur-sm transition hover:bg-white"
            >
              <ChevronRight className="size-4" strokeWidth={2.5} />
            </button>
          )}

          {/* Polaroids — scrollable horizontal si overflow.
              justify-start sur mobile (sinon le 1er polaroid est tronqué).
              sm:justify-center pour centrer quand pas d'overflow.
              ref={scrollerRef} : nécessaire pour calculer le polaroid
              le plus proche du centre (cf. useEffect au mount). */}
          <div ref={scrollerRef} className="-mx-3 overflow-x-auto lg:-mx-5">
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

      {openIdx !== null && (
        <SaviezVousLightbox
          items={lightboxItems}
          startIndex={openIdx}
          onClose={() => setOpenIdx(null)}
          isAuthenticated={isAuthenticated}
          favoritedIds={favoritedIds}
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
      className={`relative flex w-24 flex-col items-center transition-transform duration-200 sm:w-28 lg:w-32 ${rotationClass} hover:-translate-y-1 hover:rotate-0`}
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

      {/* Polaroid : bord blanc épais en bas (zone caption). Image servie
          en versions responsive par next/image (sizes 96-128 px selon
          breakpoint, plus pixel ratio mobile). Au lieu d'envoyer la
          version 1254×1254 à tout le monde, on envoie une 160×160 à
          la plupart des appareils. Gain ~95% sur cette zone. */}
      <div className="block w-full rounded-sm bg-white p-1.5 pb-5 shadow-[0_6px_14px_-8px_rgba(0,0,0,0.35)] ring-1 ring-ink/5">
        <div className="relative aspect-square w-full overflow-hidden bg-blush/40">
          <Image
            src={imageUrl}
            alt={caption ?? ''}
            fill
            sizes="(min-width: 1024px) 128px, (min-width: 640px) 112px, 96px"
            draggable={false}
            className="select-none object-cover"
          />
        </div>
        {/* Caption sous le polaroid, dans la marge blanche du papier
            photo. Doublé volontairement avec le caption en grand au-
            dessus de la rangée — ici c'est l'étiquette manuscrite type
            "photo de famille", là-haut c'est le focus sur l'élément
            centré. */}
        {caption && (
          <figcaption className="mt-1 line-clamp-2 px-0.5 text-center text-[0.75rem] font-semibold leading-tight text-ink">
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
