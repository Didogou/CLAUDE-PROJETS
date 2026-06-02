/* eslint-disable @next/next/no-img-element */
import { Sparkles } from 'lucide-react';

/**
 * Section "Le saviez-vous ?" sur la home — polaroids accrochés à un fil
 * façon labo photo. Karine y poste des photos d'actualité (légumes de
 * saison, événements, anecdotes).
 *
 * V1 : photos stub. Branchement DB + admin upload dans une 2e étape.
 *
 * UX :
 *  - 1 à 4 polaroids (UI flexible : le composant s'adapte au nombre fourni)
 *  - Rotations fixes par index (pas de Math.random pour éviter mismatch SSR)
 *  - Pinces à linge en SVG simple
 *  - Fil horizontal en cordelette (gradient + ombre)
 */

export type SaviezVousItem = {
  id: string;
  imageUrl: string;
  caption?: string | null;
};

// Rotations stables par index — un peu de variété mais pas trop
const ROTATIONS = ['-rotate-3', '-rotate-1', 'rotate-2', '-rotate-2'] as const;
// Décalages verticaux pour accentuer le "naturel" (pinces toutes au même niveau)
const Y_OFFSETS = ['mt-0', 'mt-2', 'mt-1', 'mt-3'] as const;

export function SaviezVousFil({ items }: { items: SaviezVousItem[] }) {
  if (items.length === 0) return null;

  // On limite à 4 (UI flexible mais bornée pour l'esthétique)
  const visible = items.slice(0, 4);

  return (
    <section className="relative rounded-[var(--radius-card)] bg-gradient-to-br from-cream via-blush/40 to-peach/30 px-3 pb-6 pt-4 shadow-sm lg:px-5 lg:pb-7 lg:pt-5">
      <header className="mb-3 flex items-center justify-between px-2">
        <h2 className="flex items-center gap-1.5 font-script text-3xl text-coral lg:text-4xl">
          Le saviez-vous&nbsp;?
        </h2>
        <Sparkles className="h-5 w-5 text-tangerine" aria-hidden />
      </header>

      {/* Le fil + polaroids : on positionne le fil derrière, les polaroids
          accrochés par leur pince. Sur mobile : scroll horizontal si > 2. */}
      <div className="relative">
        {/* Fil horizontal — cordelette beige avec léger sag */}
        <svg
          aria-hidden
          viewBox="0 0 400 30"
          preserveAspectRatio="none"
          className="absolute left-0 right-0 top-3 h-3 w-full"
        >
          <path
            d="M 0 4 Q 100 18 200 12 T 400 8"
            fill="none"
            stroke="#b59ea4"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.5"
          />
          <path
            d="M 0 4 Q 100 18 200 12 T 400 8"
            fill="none"
            stroke="#fff"
            strokeWidth="0.4"
            strokeLinecap="round"
            transform="translate(0,-0.5)"
            opacity="0.6"
          />
        </svg>

        <ul
          className={`relative flex gap-3 overflow-x-auto px-1 pb-2 pt-1 sm:gap-4 sm:overflow-x-visible ${
            visible.length <= 2 ? 'justify-around' : 'justify-around'
          }`}
        >
          {visible.map((item, i) => (
            <li
              key={item.id}
              className={`shrink-0 ${Y_OFFSETS[i % Y_OFFSETS.length]}`}
            >
              <Polaroid
                imageUrl={item.imageUrl}
                caption={item.caption}
                rotationClass={ROTATIONS[i % ROTATIONS.length]}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Polaroid({
  imageUrl,
  caption,
  rotationClass,
}: {
  imageUrl: string;
  caption?: string | null;
  rotationClass: string;
}) {
  return (
    <figure
      className={`relative flex w-[7.5rem] flex-col items-center transition-transform hover:scale-105 hover:rotate-0 sm:w-32 lg:w-36 ${rotationClass}`}
    >
      {/* Pince à linge — centrée au-dessus du polaroid, dépasse sur le fil */}
      <ClothesPin className="absolute -top-2 z-10 h-6 w-3.5" />

      {/* Le polaroid lui-même : bord blanc épais en bas (zone caption) */}
      <div className="block w-full rounded-sm bg-white p-2 pb-7 shadow-[0_8px_18px_-10px_rgba(0,0,0,0.35)] ring-1 ring-ink/5">
        <div className="aspect-square w-full overflow-hidden bg-blush/40">
          <img
            src={imageUrl}
            alt={caption ?? ''}
            draggable={false}
            className="h-full w-full select-none object-cover"
          />
        </div>
        {caption && (
          <figcaption className="mt-1.5 line-clamp-2 px-0.5 text-center font-script text-sm leading-tight text-ink-soft">
            {caption}
          </figcaption>
        )}
      </div>
    </figure>
  );
}

function ClothesPin({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 14 24"
      fill="none"
      aria-hidden
      className={className}
    >
      {/* Tête de pince — gris/beige avec léger gradient */}
      <rect
        x="2"
        y="0"
        width="10"
        height="14"
        rx="2"
        fill="#c4b8a5"
        stroke="#9c8c75"
        strokeWidth="0.4"
      />
      {/* Ombrage central (la pliure du ressort) */}
      <rect x="6.3" y="2" width="1.4" height="10" fill="#9c8c75" opacity="0.6" />
      {/* Pinces basses qui descendent vers le polaroid */}
      <rect
        x="3"
        y="13"
        width="2.2"
        height="9"
        rx="0.5"
        fill="#c4b8a5"
        stroke="#9c8c75"
        strokeWidth="0.3"
      />
      <rect
        x="8.8"
        y="13"
        width="2.2"
        height="9"
        rx="0.5"
        fill="#c4b8a5"
        stroke="#9c8c75"
        strokeWidth="0.3"
      />
    </svg>
  );
}
