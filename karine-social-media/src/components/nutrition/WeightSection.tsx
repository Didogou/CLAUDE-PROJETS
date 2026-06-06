'use client';

import { useEffect, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type WeightRange = '3m' | '6m' | '12m';
const RANGE_DAYS: Record<WeightRange, number> = {
  '3m': 90,
  '6m': 180,
  '12m': 365,
};
const RANGE_LABEL: Record<WeightRange, string> = {
  '3m': '3 mois',
  '6m': '6 mois',
  '12m': '12 mois',
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

/** Y axis adaptatif avec marges + step adaptatif (pattern Withings). */
const Y_MARGIN_KG = 2;
const Y_MIN_RANGE_KG = 4;
function computeYAxis(values: number[]): {
  min: number;
  max: number;
  ticks: number[];
} {
  if (values.length === 0) return { min: 60, max: 80, ticks: [60, 70, 80] };
  const min = Math.min(...values) - Y_MARGIN_KG;
  let max = Math.max(...values) + Y_MARGIN_KG;
  if (max - min < Y_MIN_RANGE_KG) max = min + Y_MIN_RANGE_KG;
  const range = max - min;
  const step = range < 8 ? 1 : range < 20 ? 2 : 5;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax; v += step) ticks.push(v);
  return { min: niceMin, max: niceMax, ticks };
}

/**
 * Section "Mon poids" : graphe + sélecteur période + bouton Mes infos.
 * Version standalone réutilisable dans /mes-stats — extrait de
 * HistoryView (page /mes-repas) pour ne pas dupliquer la logique.
 */
export function WeightSection() {
  const [weight, setWeight] = useState<WeightData | null>(null);
  const [range, setRange] = useState<WeightRange>('3m');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/nutrition/weight?days=${RANGE_DAYS[range]}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled) setWeight(d);
      } catch {
        /* silencieux */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const sorted = (weight?.entries ?? []).slice().sort((a, b) =>
    a.weighedAt.localeCompare(b.weighedAt),
  );
  const targetKg = weight?.profile.targetKg ?? null;
  const initialKg = weight?.profile.initialKg ?? null;

  const allYValues = [
    ...sorted.map((e) => e.weightKg),
    ...(targetKg !== null ? [targetKg] : []),
    ...(initialKg !== null ? [initialKg] : []),
  ];
  const yAxis = computeYAxis(allYValues);

  const chartData = sorted.map((e) => ({
    t: new Date(e.weighedAt).getTime(),
    kg: e.weightKg,
    weighedAt: e.weighedAt,
  }));
  const lastDateMs = chartData[chartData.length - 1]?.t ?? Date.now();
  const windowEnd = lastDateMs;
  const windowStart = windowEnd - RANGE_DAYS[range] * 24 * 3600 * 1000;
  const monthTicks: number[] = [];
  {
    const d = new Date(windowStart);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < windowStart) d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= windowEnd) {
      monthTicks.push(d.getTime());
      d.setMonth(d.getMonth() + 1);
    }
  }
  const formatMonth = (ms: number) =>
    new Date(ms).toLocaleDateString('fr-FR', { month: 'short' });

  return (
    <div className="space-y-3">
      {/* En-tête : sélecteur de période (le bouton « Mes infos » a été retiré,
          redondant avec la section « Mes informations » au-dessus). */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-full bg-coral-soft/30 p-0.5">
          {(['3m', '6m', '12m'] as WeightRange[]).map((r) => {
            const active = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-full px-2.5 py-1 text-[0.7rem] font-semibold transition ${
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
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-xl bg-coral-soft/15 px-4 py-6 text-center text-xs italic text-ink-soft">
          Pas encore de pesée. Renseigne ton poids dans «&nbsp;Mes
          informations&nbsp;» ci-dessus — la 1ʳᵉ pesée se crée
          automatiquement.
        </p>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 8, right: 12, bottom: 4, left: -8 }}
            >
              <defs>
                <linearGradient id="weight-fill-stats" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e2788d" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#e2788d" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#f6c9d3"
                strokeOpacity={0.35}
                vertical={false}
              />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[windowStart, windowEnd]}
                ticks={monthTicks}
                tickFormatter={formatMonth}
                stroke="#a48b94"
                tick={{ fontSize: 10, fill: '#7a6d75' }}
                tickLine={false}
                axisLine={{ stroke: '#f6c9d3' }}
              />
              <YAxis
                type="number"
                domain={[yAxis.min, yAxis.max]}
                ticks={yAxis.ticks}
                stroke="#a48b94"
                tick={{ fontSize: 10, fill: '#7a6d75' }}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              {targetKg !== null && (
                <ReferenceLine
                  y={targetKg}
                  stroke="#0ea5e9"
                  strokeWidth={1.2}
                  strokeDasharray="5 3"
                  label={{
                    value: `objectif ${targetKg
                      .toFixed(1)
                      .replace('.', ',')} kg`,
                    fill: '#0284c7',
                    fontSize: 9,
                    fontWeight: 700,
                    position: 'insideTopRight',
                  }}
                />
              )}
              <Tooltip
                cursor={{
                  stroke: '#e2788d',
                  strokeWidth: 1,
                  strokeDasharray: '2 2',
                }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0]?.payload as
                    | { t: number; kg: number; weighedAt: string }
                    | undefined;
                  if (!p) return null;
                  const dateStr = new Date(p.weighedAt).toLocaleDateString(
                    'fr-FR',
                    { weekday: 'short', day: 'numeric', month: 'short' },
                  );
                  return (
                    <div className="rounded-lg bg-white/95 px-2.5 py-1.5 text-xs shadow-md ring-1 ring-coral-soft">
                      <p className="text-ink-soft">{dateStr}</p>
                      <p className="font-bold text-coral-dark">
                        {p.kg.toFixed(1).replace('.', ',')} kg
                      </p>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="kg"
                stroke="none"
                fill="url(#weight-fill-stats)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="kg"
                stroke="#e2788d"
                strokeWidth={2}
                dot={{ r: 2.5, fill: '#e2788d', strokeWidth: 0 }}
                activeDot={{
                  r: 4,
                  fill: '#fff',
                  stroke: '#e2788d',
                  strokeWidth: 2,
                }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
