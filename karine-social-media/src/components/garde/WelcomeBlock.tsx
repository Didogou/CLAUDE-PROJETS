import { Heart } from 'lucide-react';

export function WelcomeBlock() {
  return (
    <div className="px-5 pb-3 pt-1 text-center lg:absolute lg:inset-y-0 lg:left-28 lg:flex lg:flex-col lg:justify-center lg:p-0 lg:text-left">
      <p className="flex items-end justify-center gap-2 whitespace-nowrap font-script leading-tight text-coral lg:justify-start lg:gap-3">
        {/* `clamp` garantit que la phrase tient toujours sur 1 ligne
            même sur les très petits écrans : la taille s'ajuste entre
            1.8rem (mobile étroit) et 4rem (desktop). */}
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
