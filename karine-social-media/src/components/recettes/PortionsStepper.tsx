'use client';

import { Minus, Plus, Users } from 'lucide-react';

/**
 * Sélecteur "Pour X personnes" avec +/- et valeur centrale.
 *
 * Utilisé à 2 endroits :
 *  - SheetCarousel : à la place du Stat statique "PERS"
 *  - SheetLightbox : à côté du bouton "Ajouter à ma liste"
 *
 * Bornes : 1 ≤ value ≤ 20.
 */
export function PortionsStepper({
  value,
  onChange,
  className = '',
  size = 'sm',
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const sizes =
    size === 'md'
      ? {
          wrap: 'p-2',
          btn: 'h-8 w-8',
          icon: 'h-4 w-4',
          value: 'text-xl',
          label: 'text-xs',
        }
      : {
          wrap: 'p-1.5',
          btn: 'h-7 w-7',
          icon: 'h-3 w-3',
          value: 'text-base',
          label: 'text-[0.6rem]',
        };

  function update(next: number) {
    onChange(Math.max(1, Math.min(20, next)));
  }

  return (
    <div
      className={`flex flex-col items-center rounded-lg bg-cream/40 ${sizes.wrap} ${className}`}
    >
      <Users className={`${sizes.icon} text-coral`} />
      <div className="mt-0.5 flex items-center gap-1">
        <button
          type="button"
          onClick={() => update(value - 1)}
          disabled={value <= 1}
          aria-label="Moins"
          className={`grid ${sizes.btn} place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 disabled:opacity-30`}
        >
          <Minus className={sizes.icon} />
        </button>
        <span className={`min-w-[1.5rem] text-center ${sizes.value} font-bold text-coral-dark`}>
          {value}
        </span>
        <button
          type="button"
          onClick={() => update(value + 1)}
          disabled={value >= 20}
          aria-label="Plus"
          className={`grid ${sizes.btn} place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 disabled:opacity-30`}
        >
          <Plus className={sizes.icon} />
        </button>
      </div>
      <p
        className={`mt-0.5 ${sizes.label} font-semibold uppercase tracking-wider text-ink-soft`}
      >
        {value > 1 ? 'Pers' : 'Pers'}
      </p>
    </div>
  );
}
