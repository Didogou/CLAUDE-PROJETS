import Image from 'next/image';
import { Heart } from 'lucide-react';

export function WelcomeBlock() {
  return (
    <div className="relative px-5 pb-5 pt-1 text-center">
      {/* Petite fee aquarelle a DROITE qui "pointe" vers le titre.
          Positionnement absolu pour ne pas decaler le centrage du
          texte. scale-x-[-1] : l'illustration native a la baguette
          a droite ; on inverse pour qu'elle pointe a gauche (vers
          le titre). Taille augmentee (size-20 mobile, plus en desktop).
          anim-pulse-soft pour donner vie. */}
      <Image
        src="/images/icons/fee-logo.webp"
        alt=""
        width={128}
        height={128}
        aria-hidden
        className="anim-pulse-soft pointer-events-none absolute right-1 top-1/2 size-20 -translate-y-1/2 scale-x-[-1] drop-shadow-sm sm:right-4 sm:size-28 lg:size-32"
        priority
      />

      <p className="flex items-end justify-center gap-2 whitespace-nowrap font-script leading-tight text-coral lg:gap-3">
        <span style={{ fontSize: 'clamp(1.8rem, 9vw, 4rem)' }}>
          Prenons soin de vous
        </span>
        <Heart
          className="mb-2 text-coral lg:mb-3"
          style={{ width: 'clamp(1.1rem, 5vw, 1.75rem)', height: 'clamp(1.1rem, 5vw, 1.75rem)' }}
          strokeWidth={2}
        />
      </p>
    </div>
  );
}
