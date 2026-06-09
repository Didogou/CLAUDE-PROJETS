'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { MyInfoModal } from './MyInfoModal';
import { WaterSection } from './WaterSection';
import {
  KcalBurnedEditor,
  MacrosTiles,
  MealTileApple,
  MEAL_LABELS,
  MEAL_ORDER,
  MEAL_KCAL_RATIO,
  MEAL_URL_SLUG,
  type DayState,
  type FoodLogEntry,
  type MealCategory,
} from './CalorieCounterSheetV2';

/**
 * MesCaloriesView — rendu PROPRE de la page /mes-calories.
 *
 * Repart du squelette des autres pages (/recettes, /menus) : contenu
 * en flow normal du <main>, sans portail, sans pattern absolute inset-0
 * avec scroll interne. Conséquences :
 *  - Le scroll de la page est le scroll naturel du document → l'AppHeader
 *    se compacte automatiquement comme sur les autres pages.
 *  - Le composant `CalorieCounterSheetV2` reste utilisé uniquement
 *    pour le mode SHEET legacy (CalorieFAB, etc.).
 *
 * Hérite des composants visuels existants (MacrosTiles, MealTileApple,
 * KcalBurnedEditor, WaterSection, CircularProgress, MyInfoModal) qui
 * sont exportés depuis CalorieCounterSheetV2.
 */

type Metrics = {
  kcalBurned: number;
};

function categoryOf(entry: FoodLogEntry): MealCategory {
  if (entry.mealCategory) return entry.mealCategory;
  const h = new Date(entry.loggedAt).getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 19) return 'snack';
  return 'dinner';
}

export function MesCaloriesView() {
  const router = useRouter();
  const [day, setDay] = useState<DayState | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [myInfoOpen, setMyInfoOpen] = useState(false);

  const fetchToday = useCallback(async () => {
    try {
      const res = await fetch('/api/nutrition/today', { cache: 'no-store' });
      if (res.ok) setDay(await res.json());
    } catch {
      /* fail-soft */
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/nutrition/metrics', { cache: 'no-store' });
      if (res.ok) setMetrics(await res.json());
    } catch {
      /* fail-soft */
    }
  }, []);

  useEffect(() => {
    void fetchToday();
    void fetchMetrics();
  }, [fetchToday, fetchMetrics]);

  // Calculs dérivés
  const totals = day?.totals.kcal ?? 0;
  const target = day?.target.dailyKcal ?? 2000;
  const burned = metrics?.kcalBurned ?? 0;
  const net = Math.max(0, totals - burned);
  const remaining = Math.max(0, target - net);
  const overshoot = Math.max(0, net - target);

  // Regroupe les entries par catégorie pour les compteurs de tuiles
  const entriesByCat: Record<MealCategory, FoodLogEntry[]> = {
    breakfast: [],
    lunch: [],
    snack: [],
    dinner: [],
  };
  if (day) {
    for (const e of day.entries) entriesByCat[categoryOf(e)].push(e);
  }
  const totalsForCat = (cat: MealCategory) =>
    entriesByCat[cat].reduce((a, e) => a + e.kcal * e.portions, 0);

  return (
    <div className="space-y-6">
      {/* Pill "Mes infos" alignée à droite (lien visible mais discret). */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setMyInfoOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-sm font-semibold text-coral-dark shadow-sm ring-1 ring-coral-soft/40 backdrop-blur-sm transition hover:bg-white"
        >
          {day?.profileComplete && (
            <Check className="size-4 text-sage" strokeWidth={3} />
          )}
          Mes infos
        </button>
      </div>

      {/* === HERO : cercle Restant + carte Dépensées =========== */}
      <section className="rounded-3xl bg-gradient-to-b from-coral/35 via-coral/25 to-coral/10 px-4 py-6 shadow-sm">
        <div className="flex items-center justify-center gap-4">
          <CircularProgress
            value={Math.max(0, net)}
            max={target}
            size="12rem"
            strokeWidth="0.9rem"
            trackClassName="stroke-white/40"
            arcClassName={overshoot > 0 ? 'stroke-rose-300' : 'stroke-white'}
          >
            <span className="text-[0.7rem] font-semibold uppercase tracking-widest text-coral-dark">
              Restant
            </span>
            <span className="font-bold leading-none text-coral-dark" style={{ fontSize: '2.5rem' }}>
              {Math.round(Math.max(0, remaining))}
            </span>
            <span className="text-[0.7rem] text-coral-dark/80">/ {target} kcal</span>
          </CircularProgress>

          <div
            className="flex shrink-0 flex-col items-stretch justify-center rounded-2xl bg-white px-4 py-5 text-emerald-900 shadow-xl ring-2 ring-white/60"
            style={{ minHeight: '11rem' }}
          >
            <KcalBurnedEditor
              value={metrics?.kcalBurned ?? 0}
              onSaved={(n) => {
                setMetrics((m) =>
                  m
                    ? { ...m, kcalBurned: n }
                    : { kcalBurned: n },
                );
              }}
            />
          </div>
        </div>

        {/* Macros intégrées dans le hero, sous le cercle. */}
        <div className="mt-5">
          <MacrosTiles
            consumed={day?.totals ?? { kcal: 0, proteinsG: 0, lipidsG: 0, carbsG: 0 }}
            target={day?.target ?? null}
          />
        </div>
      </section>

      {/* === REPAS DU JOUR ============================ */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-coral-dark">
          Repas du jour
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {MEAL_ORDER.map((cat) => {
            const entries = entriesByCat[cat];
            const dailyTarget = day?.target.dailyKcal ?? 0;
            const ratio = MEAL_KCAL_RATIO[cat];
            const mealTarget = Math.round(dailyTarget * ratio);
            return (
              <MealTileApple
                key={cat}
                category={cat}
                count={entries.length}
                totalKcal={totalsForCat(cat)}
                mealTargetKcal={mealTarget}
                onAdd={() => router.push(`/mes-calories/${MEAL_URL_SLUG[cat]}?focus=add`)}
                onView={() => router.push(`/mes-calories/${MEAL_URL_SLUG[cat]}`)}
              />
            );
          })}
        </div>
      </section>

      {/* === SECTION EAU =============================== */}
      <section className="rounded-3xl bg-gradient-to-b from-sky-50/60 to-blue-50/70 px-4 py-4 shadow-sm">
        <WaterSection />
      </section>

      {/* Modal "Mes infos" — saisie/édition profil nutritionnel. */}
      <MyInfoModal
        open={myInfoOpen}
        onClose={() => setMyInfoOpen(false)}
        onSaved={() => {
          setMyInfoOpen(false);
          void fetchToday();
        }}
        onError={() => {
          /* fail-soft : la modal affiche le message d'erreur en interne */
        }}
        profileComplete={day?.profileComplete ?? false}
      />
    </div>
  );
}
