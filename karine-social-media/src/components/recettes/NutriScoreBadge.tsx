import { NUTRISCORE_COLORS, type NutriscoreGrade } from '@/lib/nutriscore';

/**
 * Badge Nutri-Score — 2 variantes :
 *
 *   - `headerVariant='official'` : look proche du logo SPF réglementaire
 *      (bandeau noir + 5 cases serrées + médaillon blanc sur la lettre
 *      active). Utilisé côté admin pour rappeler le pictogramme officiel.
 *
 *   - `headerVariant='karine'` : version douce alignée charte Karine
 *      (pas de bandeau, 5 pastilles arrondies espacées, lettre active
 *      légèrement scalée + halo blanc + ring coral, inactives voilées
 *      à 40%). Plus discret, intégré aux fiches recette aquarelle.
 */

const GRADES: NutriscoreGrade[] = ['A', 'B', 'C', 'D', 'E'];

export function NutriScoreBadge({
  grade,
  size = 'md',
  withLabel = true,
  headerVariant = 'official',
}: {
  grade: NutriscoreGrade;
  /** sm = compact (tuiles recettes en grille). md = fiche recette. */
  size?: 'sm' | 'md';
  /** Bandeau "NUTRI-SCORE" en haut (variant 'official' uniquement).
   *  Ignoré quand variant='karine' : la version Karine n'a pas de
   *  bandeau, juste un petit label script optionnel sous les pastilles. */
  withLabel?: boolean;
  /** 'official' = look réglementaire SPF (admin).
   *  'karine'   = look doux aquarelle (fiche recette). */
  headerVariant?: 'official' | 'karine';
}) {
  if (headerVariant === 'karine') {
    return <KarineBadge grade={grade} size={size} />;
  }
  return <OfficialBadge grade={grade} size={size} withLabel={withLabel} />;
}

/* ------------------------------------------------------------------ */
/* Variante OFFICIELLE — inchangée (utilisée côté admin)              */
/* ------------------------------------------------------------------ */

function OfficialBadge({
  grade,
  size,
  withLabel,
}: {
  grade: NutriscoreGrade;
  size: 'sm' | 'md';
  withLabel: boolean;
}) {
  const dim = size === 'sm'
    ? {
        wrapper: 'rounded-md',
        header: 'px-1.5 py-px text-[0.45rem] tracking-[0.15em]',
        cell: 'h-5 w-5 text-[0.6rem]',
        medallion: 'h-5 w-5 text-[0.7rem]',
      }
    : {
        wrapper: 'rounded-lg',
        header: 'px-2 py-0.5 text-[0.55rem] tracking-[0.18em]',
        cell: 'h-7 w-7 text-sm',
        medallion: 'h-7 w-7 text-base',
      };

  const medallionScale = size === 'sm' ? 'scale-[1.15]' : 'scale-[1.18]';

  return (
    <div
      role="img"
      aria-label={`Nutri-Score ${grade}`}
      className={`inline-flex w-fit flex-col overflow-hidden bg-white shadow-sm ring-1 ring-black/70 ${dim.wrapper}`}
    >
      {withLabel && (
        <div className={`text-center font-bold bg-black text-white ${dim.header}`}>
          NUTRI-SCORE
        </div>
      )}
      <div className="relative flex">
        {GRADES.map((g) => {
          const isActive = g === grade;
          const colors = NUTRISCORE_COLORS[g];
          return (
            <div
              key={g}
              aria-hidden={!isActive}
              className={`relative grid place-items-center ${dim.cell}`}
              style={{ backgroundColor: colors.bg }}
            >
              {!isActive && (
                <span aria-hidden className="absolute inset-0 bg-white/35" />
              )}
              {isActive ? (
                <span
                  className={`relative z-10 grid place-items-center rounded-full bg-white font-extrabold transition ${dim.medallion} ${medallionScale}`}
                  style={{
                    color: colors.bg,
                    boxShadow:
                      '0 0 0 2px white, 0 2px 6px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(0,0,0,0.05)',
                  }}
                >
                  {g}
                </span>
              ) : (
                <span className="relative z-10 font-extrabold text-white">{g}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Variante KARINE — douce, intégrée à la charte aquarelle            */
/* ------------------------------------------------------------------ */

function KarineBadge({
  grade,
  size,
}: {
  grade: NutriscoreGrade;
  size: 'sm' | 'md';
}) {
  // Dimensions très compactes : on vise un badge discret sous l'image
  // de la fiche recette, pas un médaillon réglementaire.
  // gap-1.5 / gap-2 : laisse assez d'air pour que le scale de l'active
  // ne mange pas ses voisines. activeScale modeste (1.18) → suffit à
  // créer une hiérarchie sans transformer l'active en pavé.
  const dim = size === 'sm'
    ? {
        cell: 'h-5 w-5 text-[0.65rem]',
        gap: 'gap-1.5',
        labelText: 'text-[0.7rem]',
        activeScale: 1.15,
      }
    : {
        cell: 'h-6 w-6 text-[0.75rem]',
        gap: 'gap-2',
        labelText: 'text-sm',
        activeScale: 1.18,
      };

  return (
    <div
      role="img"
      aria-label={`Nutri-Score ${grade}`}
      className="inline-flex w-fit flex-col items-center"
    >
      {/* Petit label script-coral, signature Karine */}
      <span
        aria-hidden
        className={`mb-0.5 font-script leading-none text-coral-dark/80 ${dim.labelText}`}
      >
        Nutri-Score
      </span>

      <div className={`flex items-center ${dim.gap}`}>
        {GRADES.map((g) => {
          const isActive = g === grade;
          const colors = NUTRISCORE_COLORS[g];
          if (isActive) {
            // Pastille active : légèrement plus grosse, halo blanc doux
            // + ring coral discret. Pas de "médaillon qui dépasse" — la
            // mise en avant se fait par scale + halo, pas par une bulle.
            return (
              <span
                key={g}
                className={`relative grid shrink-0 place-items-center rounded-md font-extrabold text-white ${dim.cell}`}
                style={{
                  backgroundColor: colors.bg,
                  transform: `scale(${dim.activeScale})`,
                  boxShadow:
                    '0 0 0 1.5px #fff, 0 0 0 2.5px rgba(226,120,141,0.45), 0 2px 5px rgba(0,0,0,0.18)',
                }}
              >
                {g}
              </span>
            );
          }
          // Pastilles inactives : couleur officielle voilée par un inset
          // box-shadow blanc → effet "aquarelle" pastel. Lettre dans la
          // couleur officielle pleine, lisible sur le pastel.
          return (
            <span
              key={g}
              aria-hidden
              className={`relative grid shrink-0 place-items-center rounded-md font-extrabold ${dim.cell}`}
              style={{
                backgroundColor: colors.bg,
                color: colors.bg,
                // Voile blanc semi-transparent → couleur "aquarelle"
                boxShadow: 'inset 0 0 0 999px rgba(255,255,255,0.55)',
                opacity: 0.9,
              }}
            >
              {g}
            </span>
          );
        })}
      </div>
    </div>
  );
}
