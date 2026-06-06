'use client';

import { useEffect, useState } from 'react';
import { Droplets } from 'lucide-react';

type Range = '7d' | '30d' | '90d';
const RANGE_LABEL: Record<Range, string> = {
  '7d': '7 j',
  '30d': '1 mois',
  '90d': '3 mois',
};

type Stats = {
  range: Range;
  days: number;
  avgMlPerDay: number;
  totalMl: number;
  targetMl: number | null;
  glassSizeMl: number;
  percent: number | null;
};

/** Anime un nombre vers `target` en `durationMs` (ease-out). */
function useCountUp(target: number, durationMs = 700): number {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - p) ** 2;
      setV(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return v;
}

/**
 * Section "Objectif Eau" — vase centré + sélecteur 7 j / 1 mois / 3 mois.
 *
 * Le vase représente la **moyenne** sur la période sélectionnée, pas
 * la consommation du jour. Plus parlant pour évaluer une habitude
 * que pour suivre une journée (l'évolution du jour est dans la sheet
 * calorie).
 *
 * Le vase est volontairement central, large, avec une eau bleue
 * qui monte depuis le fond + une vague animée en surface. Quand
 * Karine fournit son image, on swap `<VaseSvg>` pour `<img/>` +
 * overlay masqué.
 */
export function WaterGoalSection() {
  const [range, setRange] = useState<Range>('7d');
  const [stats, setStats] = useState<Stats | null>(null);

  async function reload() {
    try {
      const res = await fetch(`/api/water/stats?range=${range}`, {
        cache: 'no-store',
      });
      if (res.ok) setStats(await res.json());
    } catch {
      /* silencieux */
    }
  }

  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener('water-log-updated', onChange);
    return () => window.removeEventListener('water-log-updated', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const ratio = stats?.percent != null ? Math.min(1, stats.percent / 100) : 0;
  const animatedPercent = useCountUp(stats?.percent ?? 0);
  const status =
    stats?.percent == null
      ? null
      : stats.percent >= 100
        ? '🎉'
        : stats.percent >= 75
          ? '😊'
          : stats.percent >= 50
            ? '🙂'
            : stats.percent >= 25
              ? '😐'
              : '💧';

  return (
    <section className="rounded-2xl bg-white/90 p-4 shadow-[0_8px_24px_-10px_rgba(213,110,130,0.35)] ring-1 ring-coral-soft/30">
      <div className="mb-3 flex items-center gap-2">
        <Droplets className="size-5 text-sky-500" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-coral-dark">
          Objectif eau
        </h2>
      </div>

      {/* Sélecteur période */}
      <div className="mb-3 inline-flex rounded-full bg-sky-100 p-0.5">
        {(['7d', '30d', '90d'] as Range[]).map((r) => {
          const active = r === range;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-full px-3 py-1 text-[0.7rem] font-semibold transition ${
                active
                  ? 'bg-sky-500 text-white shadow'
                  : 'text-sky-700 hover:bg-white/40'
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          );
        })}
      </div>

      {stats === null ? (
        <p className="text-xs italic text-ink-soft">Chargement…</p>
      ) : stats.targetMl === null ? (
        <p className="rounded-xl bg-sky-50 px-4 py-6 text-center text-xs italic text-ink-soft">
          Définis ton objectif eau dans la phrase « Mes informations »
          ci-dessus pour voir ta progression ici.
        </p>
      ) : (
        <>
          {/* Vase centré, grand */}
          <div className="flex justify-center py-2">
            <VaseSvg ratio={ratio} />
          </div>

          {/* Pourcentage + emoji centrés sous le vase */}
          <div className="mt-2 flex items-baseline justify-center gap-2">
            <span className="text-4xl font-extrabold tabular-nums text-sky-600">
              {animatedPercent}
              <span className="ml-0.5 text-base font-semibold text-ink-soft">
                %
              </span>
            </span>
            <span className="text-3xl">{status}</span>
          </div>

          {/* Détails sous le score */}
          <p className="mt-1 text-center text-xs text-ink">
            Moyenne :{' '}
            <span className="font-bold text-sky-700">
              {(stats.avgMlPerDay / 1000).toFixed(2).replace('.', ',')} L /
              jour
            </span>
            <span className="text-ink-soft">
              {' '}· objectif{' '}
              <span className="font-semibold text-sky-700">
                {(stats.targetMl / 1000).toFixed(1).replace('.', ',')} L
              </span>
            </span>
          </p>
          <p className="mt-0.5 text-center text-[0.65rem] italic text-ink-soft">
            Sur {stats.days} jours · verre de {stats.glassSizeMl} ml
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Vase SVG large et centré. Forme classique de vase à fleurs (col
 * étroit, panse renflée, base étroite). À remplacer par l'image
 * que Karine fournit — il suffira de swap par <img/> + overlay
 * bleu animé.
 *
 * Composé de :
 *  - Contour gris du vase
 *  - Eau bleue à l'intérieur avec gradient vertical
 *  - Vague animée en surface
 *  - Reflets blancs sur les bords pour donner du volume verre
 */
function VaseSvg({ ratio }: { ratio: number }) {
  // viewBox 100x140, vase centré horizontalement.
  // Niveaux Y : col 0..28, épaule 28..52, panse 52..118, base 118..132.
  const insideTopY = 30;
  const insideBottomY = 130;
  const innerHeight = insideBottomY - insideTopY;
  const waterY = insideBottomY - innerHeight * Math.max(0, Math.min(1, ratio));

  // Forme intérieure du vase (path pour clipper l'eau)
  const insidePath =
    'M 40 30 ' +
    'Q 40 38 35 50 ' +
    'Q 22 70 22 100 ' +
    'Q 22 124 50 132 ' +
    'Q 78 124 78 100 ' +
    'Q 78 70 65 50 ' +
    'Q 60 38 60 30 Z';

  // Contour extérieur (col + panse + base)
  const outlinePath =
    'M 38 6 ' +
    'L 38 12 ' +
    'Q 38 18 35 28 ' +
    'Q 20 56 20 100 ' +
    'Q 20 130 50 138 ' +
    'Q 80 130 80 100 ' +
    'Q 80 56 65 28 ' +
    'Q 62 18 62 12 ' +
    'L 62 6 Z';

  return (
    <svg
      viewBox="0 0 100 144"
      width={160}
      height={230}
      className="drop-shadow-md"
      aria-hidden
    >
      <defs>
        <clipPath id="vase-inside">
          <path d={insidePath} />
        </clipPath>
        <linearGradient id="vase-water-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
        <linearGradient id="vase-glass-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="20%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="80%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Eau à l'intérieur (clippée par la forme du vase) */}
      <g clipPath="url(#vase-inside)">
        <rect
          x="0"
          y={waterY}
          width="100"
          height={insideBottomY - waterY + 6}
          fill="url(#vase-water-grad)"
          style={{ transition: 'y 700ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
        {/* Vague en surface */}
        {ratio > 0.02 && (
          <path
            d={`M 0 ${waterY} Q 25 ${waterY - 3} 50 ${waterY} T 100 ${waterY} L 100 ${waterY + 5} L 0 ${waterY + 5} Z`}
            fill="#0ea5e9"
            opacity="0.55"
            style={{
              transition: 'd 700ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        )}
      </g>

      {/* Reflet verre (overlay) */}
      <path d={outlinePath} fill="url(#vase-glass-grad)" />

      {/* Contour du vase */}
      <path
        d={outlinePath}
        fill="none"
        stroke="#7a6d75"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Bord supérieur (col épais) */}
      <ellipse
        cx="50"
        cy="6"
        rx="12"
        ry="2.5"
        fill="none"
        stroke="#7a6d75"
        strokeWidth="2"
      />
    </svg>
  );
}
