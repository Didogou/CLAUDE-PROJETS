'use client';

import { RingProgress } from './RingProgress';

/**
 * Petit anneau circulaire pour un macro nutriment.
 * - Anneau coloré (corail/ambre/lavande selon macro)
 * - Au centre : initiale + chiffre consommé / cible
 * - Si target=null : tirets
 */

type MacroKey = 'protein' | 'carbs' | 'lipid';

const COLOR: Record<MacroKey, string> = {
  protein: '#e2788d',
  carbs: '#f5b941',
  lipid: '#a78bfa',
};

const INITIAL: Record<MacroKey, string> = {
  protein: 'P',
  carbs: 'G',
  lipid: 'L',
};

type Props = {
  kind: MacroKey;
  current: number;
  target: number | null;
};

export function MacroRing({ kind, current, target }: Props) {
  const hasTarget = target !== null && target > 0;
  const percent = hasTarget
    ? Math.min(100, (current / (target as number)) * 100)
    : 0;
  return (
    <div
      className="relative flex h-14 w-14 flex-col items-center justify-center"
      aria-label={`${INITIAL[kind]} ${Math.round(current)}${hasTarget ? ` sur ${target}` : ''} grammes`}
    >
      <RingProgress
        percent={percent}
        color={COLOR[kind]}
        strokeWidth={6}
        trackOpacity={0.18}
      />
      <span
        className="relative font-bold text-ink-soft"
        style={{ fontSize: '0.55rem', lineHeight: 1 }}
      >
        {INITIAL[kind]}
      </span>
      <span
        className="relative font-bold leading-none text-ink"
        style={{ fontSize: '0.7rem' }}
      >
        {Math.round(current)}
      </span>
      <span
        className="relative font-medium leading-none text-ink-soft"
        style={{ fontSize: '0.55rem' }}
      >
        {hasTarget ? `/${target}` : '—'}
      </span>
    </div>
  );
}
