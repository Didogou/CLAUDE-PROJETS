'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import {
  Flame,
  Plus,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { DrumPicker } from '@/components/ui/DrumPicker';

type WeightRange = '3m' | '6m' | '1y';
const RANGE_DAYS: Record<WeightRange, number> = {
  '3m': 90,
  '6m': 180,
  '1y': 365,
};
const RANGE_LABEL: Record<WeightRange, string> = {
  '3m': '3 mois',
  '6m': '6 mois',
  '1y': '1 an',
};

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

type WeightEntry = {
  id: string;
  weighedAt: string;
  weightKg: number;
};
type WeightData = {
  entries: WeightEntry[];
  profile: { initialKg: number | null; targetKg: number | null };
};

// Options drum picker poids : 35 → 200 kg par pas de 0.1
const WEIGHT_OPTIONS: number[] = (() => {
  const arr: number[] = [];
  for (let v = 350; v <= 2000; v++) arr.push(v / 10);
  return arr;
})();

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
  const [weight, setWeight] = useState<WeightData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [weightPickerOpen, setWeightPickerOpen] = useState(false);
  const [weightRange, setWeightRange] = useState<WeightRange>('3m');

  useEffect(() => {
    void load();
    const onChange = () => {
      load();
      loadWeight();
    };
    window.addEventListener('nutrition-log-updated', onChange);
    return () =>
      window.removeEventListener('nutrition-log-updated', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recharge la courbe quand la période change
  useEffect(() => {
    void loadWeight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightRange]);

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

  async function loadWeight() {
    try {
      const res = await fetch(
        `/api/nutrition/weight?days=${RANGE_DAYS[weightRange]}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      setWeight(await res.json());
    } catch {
      // silencieux : la courbe ne s'affiche pas si fetch rate
    }
  }

  async function addWeight(kg: number) {
    try {
      const res = await fetch('/api/nutrition/weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weightKg: kg }),
      });
      if (res.ok) await loadWeight();
    } catch {
      // silencieux
    }
  }

  const [seeding, setSeeding] = useState(false);
  async function seedDemo() {
    if (seeding) return;
    setSeeding(true);
    try {
      const res = await fetch('/api/nutrition/weight/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: 6, reset: true }),
      });
      if (res.ok) await loadWeight();
    } finally {
      setSeeding(false);
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
    return (
      <div className="space-y-3 rounded-2xl bg-white/85 p-6 text-center shadow-sm">
        <Flame className="mx-auto size-10 text-coral" />
        <p className="text-sm text-ink">
          Pas encore de repas enregistré. Utilise le bouton flottant
          🔥 pour ajouter ton premier plat&nbsp;!
        </p>
      </div>
    );
  }

  const currentWeight =
    weight && weight.entries.length > 0
      ? weight.entries[weight.entries.length - 1].weightKg
      : weight?.profile.initialKg ?? 70;

  return (
    <div className="space-y-5">
      <WeightChart
        entries={weight?.entries ?? []}
        targetKg={weight?.profile.targetKg ?? null}
        initialKg={weight?.profile.initialKg ?? null}
        range={weightRange}
        onChangeRange={setWeightRange}
        onAddPesee={() => setWeightPickerOpen(true)}
        onSeedDemo={seedDemo}
        seeding={seeding}
      />

      <DaysList days={data.days} onShowPhoto={setLightboxUrl} />

      {weightPickerOpen && (
        <DrumPicker<number>
          title="Quel est ton poids aujourd'hui ?"
          options={WEIGHT_OPTIONS}
          current={currentWeight}
          formatLabel={(v) => `${v.toFixed(1).replace('.', ',')} kg`}
          accent="coral"
          onClose={() => setWeightPickerOpen(false)}
          onPick={(v) => {
            void addWeight(v);
            setWeightPickerOpen(false);
          }}
        />
      )}

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
 * Mini-courbe du POIDS au fil des jours + ligne d'objectif.
 * SVG simple, pas de lib externe. Bouton "+ Pesée" en haut à droite.
 *
 * - Si pas encore de pesée : CTA "Saisir ta première pesée".
 * - Si ≥ 1 pesée : courbe avec objectif (issu du profil) en pointillés.
 */
function WeightChart({
  entries,
  targetKg,
  initialKg,
  range,
  onChangeRange,
  onAddPesee,
  onSeedDemo,
  seeding,
}: {
  entries: WeightEntry[];
  targetKg: number | null;
  initialKg: number | null;
  range: WeightRange;
  onChangeRange: (r: WeightRange) => void;
  onAddPesee: () => void;
  onSeedDemo: () => void;
  seeding: boolean;
}) {
  const sorted = [...entries].sort((a, b) =>
    a.weighedAt.localeCompare(b.weighedAt),
  );
  const currentKg =
    sorted.length > 0 ? sorted[sorted.length - 1].weightKg : null;
  const delta =
    currentKg !== null && initialKg !== null
      ? Math.round((currentKg - initialKg) * 10) / 10
      : null;
  // Index du point sous le curseur (drag/tap). Null = pas de curseur.
  const [cursorIdx, setCursorIdx] = useState<number | null>(null);

  if (sorted.length === 0) {
    return (
      <section className="rounded-2xl bg-white/90 p-5 text-center shadow-sm ring-1 ring-coral-soft/30">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-coral-dark">
          Mon poids
        </h2>
        {initialKg !== null ? (
          <p className="mb-1 text-sm text-ink">
            Ton poids enregistré dans{' '}
            <span className="font-semibold">Mes infos</span>&nbsp;:{' '}
            <span className="font-bold text-coral-dark">
              {initialKg.toFixed(1).replace('.', ',')} kg
            </span>
          </p>
        ) : null}
        <p className="mb-3 text-sm italic text-ink-soft">
          Saisis ta première pesée pour démarrer ton historique.
        </p>
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onAddPesee}
            className="inline-flex items-center gap-2 rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:scale-105 active:scale-95"
          >
            <Plus className="size-4" />
            Saisir ma pesée
          </button>
          <button
            type="button"
            onClick={onSeedDemo}
            disabled={seeding}
            className="text-xs italic text-ink-soft underline decoration-coral-soft underline-offset-2 hover:text-coral disabled:opacity-50"
          >
            {seeding ? 'Génération…' : 'Générer un historique de démo (6 mois)'}
          </button>
        </div>
      </section>
    );
  }

  // Bornes Y : min - 2 kg, max + 2 kg (inclut objectif si fourni)
  const allValues = [
    ...sorted.map((e) => e.weightKg),
    ...(targetKg !== null ? [targetKg] : []),
    ...(initialKg !== null ? [initialKg] : []),
  ];
  const minVal = Math.floor(Math.min(...allValues) - 1);
  const maxVal = Math.ceil(Math.max(...allValues) + 1);
  const yRange = Math.max(2, maxVal - minVal);

  const W = 320;
  const H = 130;
  const PAD_LEFT = 28;
  const PAD_RIGHT = 8;
  const PAD_TOP = 14;
  const PAD_BOT = 22;
  const innerW = W - PAD_LEFT - PAD_RIGHT;
  const innerH = H - PAD_TOP - PAD_BOT;

  const x = (i: number) =>
    PAD_LEFT +
    (sorted.length <= 1 ? innerW / 2 : (i / (sorted.length - 1)) * innerW);
  const y = (kg: number) =>
    PAD_TOP + innerH - ((kg - minVal) / yRange) * innerH;

  const path = sorted
    .map(
      (e, i) =>
        `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(e.weightKg).toFixed(1)}`,
    )
    .join(' ');
  const areaPath = `${path} L ${x(sorted.length - 1).toFixed(1)} ${(H - PAD_BOT).toFixed(1)} L ${x(0).toFixed(1)} ${(H - PAD_BOT).toFixed(1)} Z`;

  // Handler curseur : convertit la position pointeur en index
  function onPointerEvent(e: React.PointerEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const xInVB = ratio * W;
    if (xInVB < PAD_LEFT || xInVB > W - PAD_RIGHT) {
      setCursorIdx(null);
      return;
    }
    const t = (xInVB - PAD_LEFT) / innerW; // 0..1
    const idx = Math.round(t * (sorted.length - 1));
    setCursorIdx(Math.max(0, Math.min(sorted.length - 1, idx)));
  }

  const cursorEntry = cursorIdx !== null ? sorted[cursorIdx] : null;

  return (
    <section className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-coral-soft/30">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-coral-dark">
            Mon poids
          </h2>
          {currentKg !== null && (
            <p className="mt-0.5 text-xs text-ink-soft">
              <span className="text-base font-bold text-ink">
                {currentKg.toFixed(1).replace('.', ',')} kg
              </span>
              {delta !== null && delta !== 0 && (
                <span
                  className={`ml-2 font-semibold ${
                    delta < 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {delta > 0 ? '+' : ''}
                  {delta.toFixed(1).replace('.', ',')} kg
                </span>
              )}
              {targetKg !== null && (
                <span className="ml-2">
                  objectif {targetKg.toFixed(1).replace('.', ',')} kg
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSeedDemo}
            disabled={seeding}
            className="rounded-full border border-coral-soft px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-coral-dark transition hover:bg-coral-soft/30 disabled:opacity-50"
            title="Regénérer un historique de démo (6 mois)"
          >
            {seeding ? '…' : 'Démo'}
          </button>
          <button
            type="button"
            onClick={onAddPesee}
            aria-label="Ajouter une pesée"
            className="grid size-9 place-items-center rounded-full bg-coral text-white shadow-md transition hover:scale-105 active:scale-95"
          >
            <Plus className="size-4" strokeWidth={3} />
          </button>
        </div>
      </div>

      {/* Sélecteur de période : segmented control */}
      <div className="mb-2 inline-flex rounded-full bg-coral-soft/30 p-0.5">
        {(['3m', '6m', '1y'] as WeightRange[]).map((r) => {
          const active = r === range;
          return (
            <button
              key={r}
              type="button"
              onClick={() => onChangeRange(r)}
              className={`rounded-full px-3 py-1 text-[0.7rem] font-semibold transition ${
                active
                  ? 'bg-coral text-white shadow'
                  : 'text-coral-dark hover:bg-white/40'
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          );
        })}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-32 w-full touch-none"
        preserveAspectRatio="none"
        aria-hidden
        onPointerDown={onPointerEvent}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pointerType !== 'touch') return;
          onPointerEvent(e);
        }}
        onPointerLeave={() => setCursorIdx(null)}
      >
        <defs>
          <linearGradient id="weight-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e2788d" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#e2788d" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {/* Ligne objectif si défini */}
        {targetKg !== null && (
          <>
            <line
              x1={PAD_LEFT}
              x2={W - PAD_RIGHT}
              y1={y(targetKg)}
              y2={y(targetKg)}
              stroke="#0ea5e9"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={W - PAD_RIGHT}
              y={y(targetKg) - 4}
              textAnchor="end"
              className="fill-sky-600"
              style={{ fontSize: 9, fontWeight: 600 }}
            >
              objectif
            </text>
          </>
        )}
        {/* Aire */}
        <path d={areaPath} fill="url(#weight-fill)" />
        {/* Ligne */}
        <path d={path} fill="none" stroke="#e2788d" strokeWidth={2} />
        {/* Points (max 30 pour pas surcharger) */}
        {sorted.slice(-30).map((e, i) => {
          const idx = sorted.length - Math.min(sorted.length, 30) + i;
          return (
            <circle
              key={e.id}
              cx={x(idx)}
              cy={y(e.weightKg)}
              r={2.5}
              className="fill-coral"
            />
          );
        })}
        {/* Labels début / fin */}
        <text
          x={PAD_LEFT}
          y={H - 6}
          className="fill-ink-soft"
          style={{ fontSize: 9 }}
        >
          {sorted[0]
            ? new Date(sorted[0].weighedAt).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'short',
              })
            : ''}
        </text>
        <text
          x={W - PAD_RIGHT}
          y={H - 6}
          textAnchor="end"
          className="fill-ink-soft"
          style={{ fontSize: 9 }}
        >
          {sorted.length > 0
            ? new Date(
                sorted[sorted.length - 1].weighedAt,
              ).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
            : ''}
        </text>

        {/* Curseur interactif : ligne verticale + cercle highlight */}
        {cursorEntry && cursorIdx !== null && (
          <>
            <line
              x1={x(cursorIdx)}
              x2={x(cursorIdx)}
              y1={PAD_TOP}
              y2={H - PAD_BOT}
              stroke="#e2788d"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle
              cx={x(cursorIdx)}
              cy={y(cursorEntry.weightKg)}
              r={4}
              className="fill-white"
              stroke="#e2788d"
              strokeWidth={2}
            />
          </>
        )}
      </svg>

      {/* Tooltip date + poids du curseur (sous la courbe pour lisibilité) */}
      {cursorEntry ? (
        <div className="mt-1 flex items-baseline justify-between text-xs">
          <span className="text-ink-soft">
            {new Date(cursorEntry.weighedAt).toLocaleDateString('fr-FR', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </span>
          <span className="font-bold text-coral-dark">
            {cursorEntry.weightKg.toFixed(1).replace('.', ',')} kg
          </span>
        </div>
      ) : (
        <p className="mt-1 text-center text-[0.65rem] italic text-ink-soft">
          Touche la courbe pour voir un jour précis
        </p>
      )}
    </section>
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
      <div className="flex items-center justify-between gap-2 rounded-2xl bg-white/90 px-3 py-2 shadow-sm ring-1 ring-coral-soft/30">
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
        <div className="rounded-2xl bg-white/80 p-6 text-center text-sm italic text-ink-soft shadow-sm">
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
    <li className="overflow-hidden rounded-2xl bg-white/90 shadow-sm ring-1 ring-coral-soft/30">
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
