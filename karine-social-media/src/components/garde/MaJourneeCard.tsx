import { CalendarDays, Droplet, Droplets, UtensilsCrossed } from 'lucide-react';

// Données statiques (mock) — le tracking réel viendra plus tard.
const HYDRATION_CURRENT = 0.8;
const HYDRATION_GOAL = 1.5;

const RING_R = 15.5;
const RING_C = 2 * Math.PI * RING_R;

export function MaJourneeCard() {
  const pct = Math.round((HYDRATION_CURRENT / HYDRATION_GOAL) * 100);

  return (
    <section className="rounded-[var(--radius-card)] bg-white p-5 shadow-sm lg:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-script text-3xl text-coral lg:text-4xl">Ma journée</h2>
        <CalendarDays className="h-6 w-6 text-ink-soft" />
      </div>

      <ul className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-10">
        <li className="flex items-center gap-3 lg:flex-1">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-coral-soft text-coral-dark">
            <Droplet className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-ink-soft">Objectif du jour</p>
            <p className="text-base font-semibold text-ink">Boire 1,5 L d&apos;eau</p>
          </div>
        </li>

        <li className="flex items-center gap-3 lg:flex-1">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-peach text-tangerine">
            <UtensilsCrossed className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-ink-soft">Prochain repas</p>
            <p className="text-base font-semibold text-ink">Déjeuner équilibré</p>
          </div>
        </li>

        <li className="flex items-center gap-3 lg:flex-1">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-coral-soft text-coral-dark">
            <Droplets className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-soft">Hydratation</p>
            <p className="text-base font-semibold text-ink">
              {HYDRATION_CURRENT.toLocaleString('fr-FR')} L / {HYDRATION_GOAL.toLocaleString('fr-FR')} L
            </p>
          </div>
          <div className="relative h-16 w-16 shrink-0">
            <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
              <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--color-blush-deep)" strokeWidth="3.5" />
              <circle
                cx="18"
                cy="18"
                r={RING_R}
                fill="none"
                stroke="var(--color-coral)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - pct / 100)}
              />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-xs font-bold text-coral">
              {pct}%
            </span>
          </div>
        </li>
      </ul>
    </section>
  );
}
