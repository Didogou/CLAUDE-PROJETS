import { CalendarDays, Droplet, UtensilsCrossed } from 'lucide-react';

// Données statiques (mock) — le tracking réel viendra plus tard.
const HYDRATION_CURRENT = 0.8;
const HYDRATION_GOAL = 1.5;

export function MaJourneeCard() {
  const pct = Math.round((HYDRATION_CURRENT / HYDRATION_GOAL) * 100);

  return (
    <section className="mx-5 rounded-[var(--radius-card)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-script text-2xl text-coral">Ma journée</h2>
        <CalendarDays className="h-5 w-5 text-ink-soft" />
      </div>

      <ul className="space-y-3">
        <li className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-coral-soft text-coral-dark">
            <Droplet className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-ink-soft">Objectif du jour</p>
            <p className="text-sm font-semibold text-ink">Boire 1,5 L d&apos;eau</p>
          </div>
        </li>

        <li className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-peach text-tangerine">
            <UtensilsCrossed className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-ink-soft">Prochain repas</p>
            <p className="text-sm font-semibold text-ink">Déjeuner équilibré</p>
          </div>
        </li>

        <li>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-ink-soft">Hydratation</span>
            <span className="font-semibold text-ink">
              {HYDRATION_CURRENT.toLocaleString('fr-FR')} L / {HYDRATION_GOAL.toLocaleString('fr-FR')} L
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-blush-deep">
              <div className="h-full rounded-full bg-coral" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-bold text-coral">{pct}%</span>
          </div>
        </li>
      </ul>
    </section>
  );
}
