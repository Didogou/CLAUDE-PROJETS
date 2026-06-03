'use client';

/**
 * Tige avec fleur qui monte selon la progression d'un macro.
 *
 * Métaphore : la tige verte représente le besoin journalier
 * (objectif), la fleur démarre au sol et monte vers le sommet
 * à mesure que l'abonnée enregistre ses repas.
 *
 * Quand l'objectif est atteint (ou dépassé), la fleur reste au
 * sommet (couleur change subtilement).
 *
 * Couleurs par macro (cohérent avec convention nutrition) :
 *  - Protéines : rose-corail
 *  - Glucides  : jaune-ambre
 *  - Lipides   : violet-lavande
 */

type MacroKey = 'protein' | 'carbs' | 'lipid';

const PALETTE: Record<MacroKey, { stem: string; flower: string; pot: string; bg: string }> = {
  protein: {
    stem: '#5fb56b', // tige verte commune
    flower: '#e2788d',
    pot: '#c98860',
    bg: 'rgba(95, 181, 107, 0.12)',
  },
  carbs: {
    stem: '#5fb56b',
    flower: '#f5b941',
    pot: '#c98860',
    bg: 'rgba(95, 181, 107, 0.12)',
  },
  lipid: {
    stem: '#5fb56b',
    flower: '#a78bfa',
    pot: '#c98860',
    bg: 'rgba(95, 181, 107, 0.12)',
  },
};

const LABELS: Record<MacroKey, string> = {
  protein: 'Protéines',
  carbs: 'Glucides',
  lipid: 'Lipides',
};

type Props = {
  kind: MacroKey;
  /** Quantité consommée aujourd'hui (g) */
  current: number;
  /** Besoin journalier (g) — null si profil non renseigné */
  target: number | null;
};

export function MacroStem({ kind, current, target }: Props) {
  const palette = PALETTE[kind];
  const label = LABELS[kind];
  const hasTarget = target !== null && target > 0;
  const percent = hasTarget
    ? Math.min(100, Math.max(0, (current / (target as number)) * 100))
    : 0;
  const reached = hasTarget && current >= (target as number);

  return (
    <div
      className="flex flex-col items-center gap-1 rounded-xl px-1.5 py-2"
      style={{ background: palette.bg }}
    >
      {/* Zone tige + fleur — hauteur fixe en rem */}
      <div className="relative h-24 w-8">
        {/* Tige verte au centre */}
        <span
          aria-hidden
          className="absolute left-1/2 top-2 h-[calc(100%-1.5rem)] w-1 -translate-x-1/2 rounded-full"
          style={{ background: palette.stem, opacity: 0.85 }}
        />
        {/* Quelques feuilles décoratives */}
        <span
          aria-hidden
          className="absolute h-2 w-2 rounded-full"
          style={{
            background: palette.stem,
            left: 'calc(50% - 0.65rem)',
            bottom: '40%',
            transform: 'rotate(-30deg) scale(1.2,0.5)',
          }}
        />
        <span
          aria-hidden
          className="absolute h-2 w-2 rounded-full"
          style={{
            background: palette.stem,
            right: 'calc(50% - 0.65rem)',
            bottom: '55%',
            transform: 'rotate(30deg) scale(1.2,0.5)',
          }}
        />

        {/* Fleur qui monte */}
        <div
          className="absolute left-1/2 -translate-x-1/2 transition-all duration-700 ease-out"
          style={{ bottom: `calc(${percent}% - 0.4rem)` }}
          aria-label={`${Math.round(current)} sur ${target ?? '?'} grammes`}
        >
          <Flower color={palette.flower} bloomed={reached} />
        </div>

        {/* Pot en bas */}
        <span
          aria-hidden
          className="absolute bottom-0 left-1/2 h-4 w-6 -translate-x-1/2 rounded-b-md"
          style={{
            background: palette.pot,
            borderTop: `2px solid ${palette.pot}`,
            clipPath: 'polygon(15% 0, 85% 0, 100% 100%, 0 100%)',
          }}
        />
      </div>

      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-ink-soft">
        {label}
      </p>
      <p className="text-xs font-semibold text-ink">
        {hasTarget ? (
          <>
            {Math.round(current)}
            <span className="text-ink-soft">/{target}g</span>
          </>
        ) : (
          <span className="text-ink-soft">—</span>
        )}
      </p>
    </div>
  );
}

/** Petite fleur 5 pétales en SVG inline. */
function Flower({ color, bloomed }: { color: string; bloomed: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      style={{ filter: bloomed ? 'drop-shadow(0 0 3px rgba(255,255,255,0.6))' : undefined }}
      aria-hidden
    >
      {/* 5 pétales */}
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse
          key={angle}
          cx="12"
          cy="6"
          rx="3.2"
          ry="4.5"
          fill={color}
          opacity={0.9}
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      {/* Cœur jaune */}
      <circle cx="12" cy="12" r="2.5" fill="#fcd34d" />
    </svg>
  );
}
