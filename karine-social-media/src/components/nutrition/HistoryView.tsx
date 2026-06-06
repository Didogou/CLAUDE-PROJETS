'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import { Flame, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { CalorieCounterSheetV2 } from './CalorieCounterSheetV2';

type MealCategory = 'breakfast' | 'lunch' | 'snack' | 'dinner';

type Entry = {
  id: string;
  loggedAt: string;
  label: string;
  kcal: number;
  portions: number;
  mealCategory: MealCategory | null;
  photoUrl: string | null;
};

type DayBucket = {
  date: string; // YYYY-MM-DD local
  totalKcal: number;
  entries: Entry[];
};

type HistoryData = {
  days: DayBucket[];
  target: { dailyKcal: number };
};

const MEAL_LABELS: Record<MealCategory, string> = {
  breakfast: "P'tit dej",
  lunch: 'Déjeuner',
  snack: 'Goûter',
  dinner: 'Dîner',
};
const MEAL_ORDER: MealCategory[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const MEAL_BG: Record<MealCategory, string> = {
  breakfast: 'bg-amber-100 text-amber-800',
  lunch: 'bg-coral-soft/40 text-coral-dark',
  snack: 'bg-violet-100 text-violet-800',
  dinner: 'bg-blue-100 text-blue-800',
};

// Ombre douce teintée corail, partagée par les cartes de la page (frames).
const CARD_SHADOW = 'shadow-[0_8px_24px_-10px_rgba(213,110,130,0.35)]';

/** Fallback si jour donné n'a aucune entry pour une catégorie. */
function categoryOf(e: Entry): MealCategory {
  if (e.mealCategory) return e.mealCategory;
  // Fallback heuristique par heure
  const h = new Date(e.loggedAt).getHours();
  if (h < 11) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 18) return 'snack';
  return 'dinner';
}

/** "samedi 25 juin" (lowercase) */
function formatDateFr(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function HistoryView() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    void load();
    const onChange = () => {
      load();
    };
    window.addEventListener('nutrition-log-updated', onChange);
    return () =>
      window.removeEventListener('nutrition-log-updated', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/nutrition/history?days=30', {
        cache: 'no-store',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const d = (await res.json()) as HistoryData;
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-2xl bg-white/80 p-6 text-center text-sm italic text-ink-soft shadow-sm">
        Chargement de l&apos;historique…
      </div>
    );
  }
  if (data.days.length === 0) {
    // Empty state. La pastille reproduit visuellement la TrackingPill
    // du header (bg-white + ring-coral + flame remplie) en plus gros
    // pour servir de CTA. Le clic — sur la pastille comme sur le mot
    // "Mes calories" dans le texte — ouvre la même sheet calorie
    // V2 que la pastille du header. Pas d'import de TrackingPill : ce
    // composant a une taille fixe h-8 w-8 et un comportement variable
    // (sheet/plan/login) qu'on n'a pas besoin ici (on est connectée
    // sur /mes-repas, donc forcément 'sheet').
    return (
      <>
        <div
          className={`space-y-3 rounded-2xl bg-white/85 p-6 text-center ${CARD_SHADOW}`}
        >
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="Ouvrir Mes calories pour ajouter un repas"
            className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-coral shadow-md ring-2 ring-coral transition hover:scale-105 active:scale-95"
          >
            <Flame className="h-7 w-7 fill-coral" strokeWidth={2} />
          </button>
          <p className="text-sm text-ink">
            Pas encore de repas enregistré. Ouvre{' '}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="font-semibold text-coral underline hover:text-coral-dark"
            >
              Mes calories
            </button>{' '}
            pour ajouter ton premier plat&nbsp;!
          </p>
        </div>
        {sheetOpen && (
          <CalorieCounterSheetV2
            onClose={() => setSheetOpen(false)}
            onChanged={load}
            canEdit
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <DaysList days={data.days} onShowPhoto={setLightboxUrl} />

      {/* Lightbox plein écran */}
      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Photo du plat"
            className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain shadow-2xl"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label="Fermer"
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/90 text-ink shadow-lg hover:bg-white"
          >
            <X className="size-5" strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Liste d'historique des repas avec sélecteur de jour :
 *   ← flèche · "Aujourd'hui" / nom du jour · flèche →
 *   raccourcis "Hier" / "Aujourd'hui"
 *
 * Affiche le détail UNIQUEMENT pour le jour sélectionné. Si le jour
 * n'a aucune entry, affiche un message "Pas de repas ce jour".
 */
function DaysList({
  days,
  onShowPhoto,
}: {
  days: DayBucket[];
  onShowPhoto: (url: string) => void;
}) {
  // YYYY-MM-DD local d'aujourd'hui
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const yesterdayKey = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const [selected, setSelected] = useState<string>(() => {
    // Jour le plus récent qui a des entries, sinon aujourd'hui
    return days[0]?.date ?? todayKey;
  });

  function shiftDay(delta: number) {
    const [y, m, d] = selected.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + delta);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    setSelected(key);
  }

  const day = days.find((d) => d.date === selected);
  const isToday = selected === todayKey;
  const isYesterday = selected === yesterdayKey;

  return (
    <section className="space-y-3">
      {/* Sélecteur jour : flèches + nom centré */}
      <div className={`flex items-center justify-between gap-2 rounded-2xl bg-white/90 px-3 py-2 ${CARD_SHADOW} ring-1 ring-coral-soft/30`}>
        <button
          type="button"
          onClick={() => shiftDay(-1)}
          aria-label="Jour précédent"
          className="grid size-9 place-items-center rounded-full text-coral-dark transition hover:bg-coral-soft/30 active:scale-95"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <span className="font-script text-lg leading-none text-coral">
            {isToday
              ? "Aujourd'hui"
              : isYesterday
                ? 'Hier'
                : formatDateFr(selected).split(' ').slice(0, 1).join(' ') /* jour seul (samedi…) */}
          </span>
          <span className="text-[0.7rem] capitalize text-ink-soft">
            {formatDateFr(selected)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => shiftDay(1)}
          aria-label="Jour suivant"
          disabled={selected >= todayKey}
          className="grid size-9 place-items-center rounded-full text-coral-dark transition hover:bg-coral-soft/30 active:scale-95 disabled:opacity-30"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* Raccourcis Hier / Aujourd'hui */}
      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={() => setSelected(yesterdayKey)}
          disabled={isYesterday}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
            isYesterday
              ? 'bg-coral text-white shadow'
              : 'bg-white/80 text-coral-dark ring-1 ring-coral-soft/40 hover:bg-coral-soft/30'
          }`}
        >
          Hier
        </button>
        <button
          type="button"
          onClick={() => setSelected(todayKey)}
          disabled={isToday}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
            isToday
              ? 'bg-coral text-white shadow'
              : 'bg-white/80 text-coral-dark ring-1 ring-coral-soft/40 hover:bg-coral-soft/30'
          }`}
        >
          Aujourd&apos;hui
        </button>
      </div>

      {/* Détail du jour sélectionné */}
      {day ? (
        <DayCard day={day} onShowPhoto={onShowPhoto} />
      ) : (
        <div className={`rounded-2xl bg-white/80 p-6 text-center text-sm italic text-ink-soft ${CARD_SHADOW}`}>
          Aucun repas enregistré ce jour-là.
        </div>
      )}
    </section>
  );
}

/** Carte d'un jour : date + sections par catégorie de repas. */
function DayCard({
  day,
  onShowPhoto,
}: {
  day: DayBucket;
  onShowPhoto: (url: string) => void;
}) {
  // Groupe les entries par catégorie
  const byCat: Record<MealCategory, Entry[]> = {
    breakfast: [],
    lunch: [],
    snack: [],
    dinner: [],
  };
  for (const e of day.entries) byCat[categoryOf(e)].push(e);

  // Récolte les URLs uniques (déduplication par batch photo)
  const photoUrls = new Set<string>();

  return (
    <li className={`overflow-hidden rounded-2xl bg-white/90 ${CARD_SHADOW} ring-1 ring-coral-soft/30`}>
      {/* Header date */}
      <div className="flex items-baseline justify-between border-b border-coral-soft/20 bg-coral-soft/20 px-4 py-2.5">
        <h3 className="font-script text-xl capitalize text-coral-dark">
          {formatDateFr(day.date)}
        </h3>
        <span className="text-xs font-bold text-coral-dark">
          {Math.round(day.totalKcal)} kcal
        </span>
      </div>

      <div className="space-y-2.5 p-3">
        {MEAL_ORDER.map((cat) => {
          const items = byCat[cat];
          if (items.length === 0) return null;
          const sumKcal = items.reduce((s, e) => s + e.kcal * e.portions, 0);
          // Photos uniques de cette catégorie pour ce jour
          const catPhotos: string[] = [];
          for (const e of items) {
            if (e.photoUrl && !photoUrls.has(e.photoUrl)) {
              photoUrls.add(e.photoUrl);
              catPhotos.push(e.photoUrl);
            }
          }
          return (
            <section key={cat} className="rounded-xl bg-cream/40 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider ${MEAL_BG[cat]}`}
                >
                  {MEAL_LABELS[cat]}
                </span>
                <span className="text-xs font-semibold text-ink-soft">
                  {Math.round(sumKcal)} kcal
                </span>
              </div>
              <ul className="space-y-0.5 text-sm">
                {items.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-2 truncate"
                  >
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {e.label}
                    </span>
                    <span className="shrink-0 text-xs text-ink-soft">
                      {Math.round(e.kcal * e.portions)} kcal
                    </span>
                  </li>
                ))}
              </ul>
              {catPhotos.length > 0 && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {catPhotos.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => onShowPhoto(u)}
                      aria-label="Voir la photo"
                      className="overflow-hidden rounded-lg shadow ring-1 ring-coral-soft/40 transition hover:scale-105 active:scale-95"
                    >
                      <img
                        src={u}
                        alt=""
                        aria-hidden
                        draggable={false}
                        className="h-16 w-16 object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </li>
  );
}
