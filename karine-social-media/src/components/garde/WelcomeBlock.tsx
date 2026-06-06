import { Heart } from 'lucide-react';

export function WelcomeBlock() {
  return (
    <div
      // pb-5 (20px) crée de l'air entre le slogan "Prenons soin de
      // vous" et la première rangée de tuiles. pt-1 garde le slogan
      // proche du header.
      //
      // ⚠ Ancien comportement supprimé : "lg:absolute lg:inset-y-0
      // lg:left-28 lg:flex lg:flex-col lg:justify-center lg:p-0
      // lg:text-left" plaçait le slogan en absolute centré
      // verticalement dans la page (vu l'absence de wrapper relative
      // depuis le refacto sticky), ce qui le faisait chevaucher le
      // SaviezVousFil. Sur PC, le slogan est maintenant simplement
      // centré sous le header — même comportement que mobile.
      className="px-5 pb-5 pt-1 text-center"
    >
      <p className="flex items-end justify-center gap-2 whitespace-nowrap font-script leading-tight text-coral lg:gap-3">
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
