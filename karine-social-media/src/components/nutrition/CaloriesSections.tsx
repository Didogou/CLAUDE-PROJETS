'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Lightbulb } from 'lucide-react';

/**
 * 3 sections supplementaires de la page /mes-calories :
 *   - CaloriesRepartition : donut SVG % glucides/proteines/lipides + tasse aquarelle
 *   - WeekEvolutionChart  : histogramme 7 jours + cible pointillee + moyenne hebdo
 *   - EncouragementBanner : phrase dynamique selon etat + ampoule + fee aquarelle
 */

const CARBS_KCAL_PER_G = 4;
const PROTEINS_KCAL_PER_G = 4;
const LIPIDS_KCAL_PER_G = 9;

// =====================================================================
// 1. REPARTITION DES CALORIES (donut)
// =====================================================================

export function CaloriesRepartition({
  carbsG,
  proteinsG,
  lipidsG,
  targetKcal,
  compact = false,
}: {
  carbsG: number;
  proteinsG: number;
  lipidsG: number;
  targetKcal: number;
  /** Mode compact = pas de h2 externe, carte prend h-full w-full du parent.
   *  Utilise dans le layout absolute pixel-perfect de /mes-calories. */
  compact?: boolean;
}) {
  const carbsKcal = carbsG * CARBS_KCAL_PER_G;
  const proteinsKcal = proteinsG * PROTEINS_KCAL_PER_G;
  const lipidsKcal = lipidsG * LIPIDS_KCAL_PER_G;
  const totalKcal = carbsKcal + proteinsKcal + lipidsKcal;
  const targetPct =
    targetKcal > 0 ? Math.min(100, Math.round((totalKcal / targetKcal) * 100)) : 0;

  // Pour le donut : on calcule les % relatifs aux totals ingerés.
  const safeTotal = totalKcal > 0 ? totalKcal : 1;
  const carbsPct = Math.round((carbsKcal / safeTotal) * 100);
  const proteinsPct = Math.round((proteinsKcal / safeTotal) * 100);
  const lipidsPct = Math.round((lipidsKcal / safeTotal) * 100);

  // Donut SVG : circonference 2π·r, dasharray (segment, gap).
  const r = 40;
  const c = 2 * Math.PI * r;
  const carbsLen = (carbsPct / 100) * c;
  const proteinsLen = (proteinsPct / 100) * c;
  const lipidsLen = (lipidsPct / 100) * c;

  const cardInner = (
    <div className="relative flex h-full w-full items-center overflow-hidden rounded-2xl bg-white/95 px-4 py-2 shadow-sm">
      {!compact && (
        <Image
          src="/images/icons/cal-tasse.webp"
          alt=""
          width={300}
          height={400}
          aria-hidden
          className="pointer-events-none absolute -bottom-2 -right-2 size-32 object-contain opacity-95"
        />
      )}
        <div className="relative z-10 flex items-center gap-4">
          {/* Donut SVG */}
          <div className="relative shrink-0">
            <svg viewBox="0 0 100 100" className="size-24">
              {/* Track gris clair */}
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke="#F0E4DC"
                strokeWidth="14"
              />
              {/* Glucides — miel/dore */}
              {carbsPct > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke="#E8A33D"
                  strokeWidth="14"
                  strokeDasharray={`${carbsLen} ${c}`}
                  strokeDashoffset="0"
                  transform="rotate(-90 50 50)"
                />
              )}
              {/* Proteines — terracotta */}
              {proteinsPct > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke="#C76B4A"
                  strokeWidth="14"
                  strokeDasharray={`${proteinsLen} ${c}`}
                  strokeDashoffset={-carbsLen}
                  transform="rotate(-90 50 50)"
                />
              )}
              {/* Lipides — olive */}
              {lipidsPct > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke="#9CAE6B"
                  strokeWidth="14"
                  strokeDasharray={`${lipidsLen} ${c}`}
                  strokeDashoffset={-(carbsLen + proteinsLen)}
                  transform="rotate(-90 50 50)"
                />
              )}
            </svg>
            {/* % au centre */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-base font-bold leading-none" style={{ color: '#3D2820' }}>
                {targetPct}%
              </span>
              <span className="text-[0.5rem] leading-tight text-ink-soft">
                de l&apos;objectif
                <br />
                atteint
              </span>
            </div>
          </div>

          {/* Legende — pastilles en versions pastel des couleurs charte. */}
          <div className="flex-1 space-y-1 text-xs">
            <LegendItem color="#F5D8A8" label="Glucides" kcal={carbsKcal} pct={carbsPct} />
            <LegendItem color="#ECB5A0" label="Protéines" kcal={proteinsKcal} pct={proteinsPct} />
            <LegendItem color="#D4DEB1" label="Lipides" kcal={lipidsKcal} pct={lipidsPct} />
          </div>
        </div>
      </div>
  );

  if (compact) return cardInner;
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-coral-dark">
        Répartition des calories
      </h2>
      {cardInner}
    </section>
  );
}

function LegendItem({
  color,
  label,
  kcal,
  pct,
}: {
  color: string;
  label: string;
  kcal: number;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span
        className="font-semibold"
        style={{ color: '#3D2820', minWidth: '3.5rem' }}
      >
        {label}
      </span>
      <span className="text-ink-soft">
        {Math.round(kcal)} kcal ({pct}%)
      </span>
    </div>
  );
}

// =====================================================================
// 2. MON EVOLUTION — histogramme 7 jours
// =====================================================================

type DayKcal = { date: string; kcal: number; dayLabel: string };

export function WeekEvolutionChart({
  targetKcal,
  compact = false,
}: {
  targetKcal: number;
  compact?: boolean;
}) {
  const [days, setDays] = useState<DayKcal[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/nutrition/week-history')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.days)) setDays(data.days as DayKcal[]);
      })
      .catch(() => {
        /* silent */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Echelles : Y-max = max(target, max consume) avec 10% de marge.
  // Step adaptatif (pattern Withings/MesStats) pour eviter des ticks
  // trop serres quand la plage est large.
  const maxConsumed = days ? Math.max(...days.map((d) => d.kcal), 0) : 0;
  const yMaxRaw = Math.max(targetKcal, maxConsumed) * 1.1;
  const yStep =
    yMaxRaw < 1500 ? 250 : yMaxRaw < 3000 ? 500 : yMaxRaw < 6000 ? 1000 : 2000;
  const yMax = Math.ceil(yMaxRaw / yStep) * yStep || 2500;
  const yTicks: number[] = [];
  for (let y = 0; y <= yMax; y += yStep) yTicks.push(y);

  const avgKcal = days
    ? Math.round(days.reduce((a, d) => a + d.kcal, 0) / days.length)
    : 0;

  // Dimensions SVG (viewBox interne → scale auto sur la box parent)
  const W = 280;
  const H = 160;
  const padL = 40;
  const padR = 8;
  const padT = 22;
  const padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW = (chartW / 7) * 0.4; // 40% au lieu de 60% → barres plus fines
  const gap = chartW / 7;

  const cardInner = (
    <div className="flex h-full w-full items-stretch gap-3 overflow-hidden rounded-2xl bg-white/95 p-3 shadow-sm">
        {/* Graph */}
        <div className="flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            {/* Y-axis ticks + lines */}
            {yTicks.map((y) => {
              const yPx = padT + chartH - (y / yMax) * chartH;
              return (
                <g key={y}>
                  <line
                    x1={padL}
                    y1={yPx}
                    x2={W - padR}
                    y2={yPx}
                    stroke="#F0E4DC"
                    strokeWidth="0.5"
                  />
                  <text
                    x={padL - 4}
                    y={yPx + 3}
                    textAnchor="end"
                    fontSize="9"
                    fill="#8A6B5E"
                  >
                    {y}
                  </text>
                </g>
              );
            })}

            {/* Objectif pointille — VERT pour distinguer du coral
                des barres (couleur "atteint" et "ce qui est bien"). */}
            {targetKcal > 0 && (
              <>
                <line
                  x1={padL}
                  y1={padT + chartH - (targetKcal / yMax) * chartH}
                  x2={W - padR}
                  y2={padT + chartH - (targetKcal / yMax) * chartH}
                  stroke="#7BA05B"
                  strokeWidth="1.2"
                  strokeDasharray="4 3"
                />
                <text
                  x={W - padR - 2}
                  y={padT + chartH - (targetKcal / yMax) * chartH - 3}
                  textAnchor="end"
                  fontSize="9"
                  fill="#7BA05B"
                  fontWeight="600"
                >
                  Objectif : {targetKcal} kcal ♡
                </text>
              </>
            )}

            {/* Barres */}
            {days?.map((d, i) => {
              const barH = (d.kcal / yMax) * chartH;
              const x = padL + i * gap + (gap - barW) / 2;
              const y = padT + chartH - barH;
              return (
                <g key={d.date}>
                  {barH > 0 && (
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={barH}
                      rx="2"
                      fill="#F0A88B"
                      opacity="0.75"
                    />
                  )}
                  <text
                    x={x + barW / 2}
                    y={H - 6}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#8A6B5E"
                  >
                    {d.dayLabel}
                  </text>
                </g>
              );
            })}

            {/* Label kcal en haut gauche */}
            <text x={padL - 2} y={padT - 6} textAnchor="end" fontSize="9" fill="#8A6B5E">
              kcal
            </text>
          </svg>
        </div>

        {/* Moyenne hebdo a droite */}
        <div
          className="flex shrink-0 flex-col items-center justify-center rounded-xl px-3 py-3 text-center"
          style={{ background: '#FFF1EA', minWidth: '5.5rem' }}
        >
          <span className="text-[0.55rem] font-bold uppercase leading-tight tracking-wider" style={{ color: '#8A6B5E' }}>
            Moyenne
            <br />
            hebdomadaire
          </span>
          <span
            className="mt-1 text-2xl font-extrabold leading-none"
            style={{ color: '#C76B4A' }}
          >
            {avgKcal}
          </span>
          <span className="text-[0.6rem] font-semibold" style={{ color: '#8A6B5E' }}>
            kcal
          </span>
        </div>
      </div>
  );

  if (compact) return cardInner;
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-coral-dark">
        Mon évolution
      </h2>
      {cardInner}
    </section>
  );
}

// =====================================================================
// 3. ENCOURAGEMENT BANNER — phrase dynamique selon etat
// =====================================================================

type EncouragementCategory = 'debut-journee' | 'bonne-route' | 'objectif-atteint';
type EncMap = Record<EncouragementCategory, string[]>;

const FALLBACK_ENCOURAGEMENTS: EncMap = {
  'debut-journee': [
    'Chaque petit choix compte, soyez fière de vous ♡',
  ],
  'bonne-route': [
    'Continuez sur votre lancée, c\'est top ♡',
  ],
  'objectif-atteint': [
    'Objectif atteint, soyez fière de vous ♡',
  ],
};

function pickEncouragement(
  encouragements: EncMap,
  consumed: number,
  target: number,
): string {
  let category: EncouragementCategory = 'debut-journee';
  if (target > 0) {
    const pct = (consumed / target) * 100;
    if (pct >= 100) category = 'objectif-atteint';
    else if (pct >= 30) category = 'bonne-route';
  }
  const phrases = encouragements[category]?.length
    ? encouragements[category]
    : FALLBACK_ENCOURAGEMENTS[category];
  // Pseudo-aleatoire stable par jour (memes phrases sur 24h)
  const dayHash = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  return phrases[dayHash % phrases.length];
}

export function EncouragementBanner({
  consumed,
  target,
  compact = false,
}: {
  consumed: number;
  target: number;
  /** Mode compact = sans fée externe, prend h-full w-full du parent.
   *  La fée slogan est positionnee separement dans le layout absolute. */
  compact?: boolean;
}) {
  // Charge les phrases de l'admin (avec fallback). Pas d'auth requise.
  const [encouragements, setEncouragements] = useState<EncMap>(FALLBACK_ENCOURAGEMENTS);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/nutrition/encouragements')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.encouragements) setEncouragements(data.encouragements as EncMap);
      })
      .catch(() => {
        /* fallback silent */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const phrase = pickEncouragement(encouragements, consumed, target);
  return (
    <section
      className={
        compact
          ? 'relative flex h-full w-full items-center overflow-hidden rounded-2xl bg-white/95 px-3 shadow-sm'
          : 'relative overflow-hidden rounded-2xl bg-white/95 px-4 py-4 shadow-sm'
      }
    >
      {/* Fee aquarelle a droite — masquee en compact (placee separement
          en absolute dans le parent layout). */}
      {!compact && (
        <Image
          src="/images/icons/fee-logo.webp"
          alt=""
          width={120}
          height={120}
          aria-hidden
          className="anim-pulse-soft pointer-events-none absolute -bottom-1 right-1 size-20 opacity-95"
        />
      )}
      <div className={compact ? 'relative z-10 flex w-full items-center gap-3' : 'relative z-10 flex items-center gap-3 pr-20'}>
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-amber-400 shadow ring-1 ring-coral-soft/40"
        >
          <Lightbulb className="size-5 fill-amber-400" strokeWidth={2.2} />
        </span>
        <p
          className="whitespace-pre-line font-script text-xl leading-snug"
          style={{ color: '#3D2820' }}
        >
          {phrase}
        </p>
      </div>
    </section>
  );
}
