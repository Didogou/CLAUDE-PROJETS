/* eslint-disable @next/next/no-img-element */

const ICON = '/images/ui/desaison.png';

/**
 * Icône "légumes de saison" épinglée sur la recette.
 * - `pin`  : grosse, pour la fiche détail (overlay sur l'image).
 * - `mini` : petite, pour les vignettes en liste.
 * Style « épingle » = légère rotation + drop-shadow douce (effet posé sur l'image).
 */
export function SeasonChip({ variant = 'mini' }: { variant?: 'pin' | 'mini' }) {
  // pin = fiche détail (très visible) ; mini = vignettes liste (étiquette qui déborde du coin)
  const size = variant === 'pin' ? 'h-24 w-24 lg:h-28 lg:w-28' : 'h-16 w-16 sm:h-20 sm:w-20';
  return (
    <img
      src={ICON}
      alt="Légumes de saison"
      title="Préparée avec des légumes de saison"
      className={`${size} -rotate-[14deg] select-none opacity-80 drop-shadow-[0_3px_5px_rgba(0,0,0,0.25)]`}
      draggable={false}
    />
  );
}
