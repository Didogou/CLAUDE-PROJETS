'use client';

import { useEffect, useMemo, useState } from 'react';

type Range = '7d' | '30d' | '90d';
const RANGE_LABEL: Record<Range, string> = {
  '7d': '7 j',
  '30d': '1 mois',
  '90d': '3 mois',
};

type BalanceResponse = {
  range: Range;
  days: number;
  entriesCount: number;
  entriesWithMacros: number;
  totalKcalRaw: number;
  kcalMacrosTotal: number;
  targets: { carbs: number; lipids: number; proteins: number };
  percent: {
    carbs: number | null;
    lipids: number | null;
    proteins: number | null;
  };
  score: number | null;
  emoji: string | null;
};

/** Hook simple : anime un nombre vers `target` en `durationMs`. */
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
 * Section "Équilibre alimentaire" :
 *  - Sélecteur 7j / 1 mois / 3 mois
 *  - 3 anneaux Apple-style (Glucides / Lipides / Protéines)
 *    chaque anneau = % atteint vs cible (45/30/25)
 *  - Score global d'équilibre (0-100) + emoji
 *
 * Calcule les valeurs côté API (/api/nutrition/balance), affiche
 * un placeholder si pas assez de données.
 */
export function MacroBalanceSection() {
  const [range, setRange] = useState<Range>('7d');
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/nutrition/balance?range=${range}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const j = (await res.json()) as BalanceResponse;
      setData(j);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/nutrition/balance?range=${range}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const j = (await res.json()) as BalanceResponse;
        if (!cancelled) setData(j);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  /**
   * Démo : insère ~90 repas fictifs sur la période la plus large
   * (3 mois) pour permettre à la patiente / Karine de tester
   * l'équilibre alimentaire sans saisir 90 entrées à la main.
   * `reset: true` purge les anciens seeds 'free' pour éviter les
   * doublons quand on clique plusieurs fois.
   */
  async function seedDemo() {
    if (seeding) return;
    setSeeding(true);
    try {
      const res = await fetch('/api/nutrition/foodlog/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 90, reset: true }),
      });
      if (res.ok) await reload();
    } finally {
      setSeeding(false);
    }
  }

  const hasData =
    data !== null &&
    data.percent.carbs !== null &&
    data.percent.lipids !== null &&
    data.percent.proteins !== null;

  return (
    <div className="space-y-3">
      {/* Segmented control période + bouton Démo. */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-full bg-coral-soft/30 p-0.5">
          {(['7d', '30d', '90d'] as Range[]).map((r) => {
            const active = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
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
        {/* Bouton démo — génère ~90 repas fictifs sur 90 jours pour
            visualiser les anneaux sans saisir manuellement. */}
        <button
          type="button"
          onClick={seedDemo}
          disabled={seeding}
          title="Générer 90 jours de repas démo (remplace les anciens seeds)"
          className="rounded-full border border-coral-soft px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-coral-dark transition hover:bg-coral-soft/30 disabled:opacity-50"
        >
          {seeding ? 'Génération…' : 'Démo'}
        </button>
      </div>

      {loading && !data ? (
        <p className="rounded-xl bg-coral-soft/15 px-4 py-6 text-center text-xs italic text-ink-soft">
          Chargement…
        </p>
      ) : !hasData ? (
        <p className="rounded-xl bg-coral-soft/15 px-4 py-6 text-center text-xs italic text-ink-soft">
          Pas encore assez de repas enregistrés avec leurs macros sur la
          période sélectionnée. Continue à saisir tes plats pour voir ton
          équilibre apparaitre ici.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-around gap-2">
            <MacroRing
              label="GLU"
              percent={data!.percent.carbs!}
              target={data!.targets.carbs}
              color="#e11d48"
            />
            <MacroRing
              label="LIP"
              percent={data!.percent.lipids!}
              target={data!.targets.lipids}
              color="#f59e0b"
            />
            <MacroRing
              label="PROT"
              percent={data!.percent.proteins!}
              target={data!.targets.proteins}
              color="#10b981"
            />
          </div>

          <ScoreBlock score={data!.score!} emoji={data!.emoji!} />

          <p className="text-center text-[0.65rem] italic text-ink-soft">
            Cibles équilibre : 45 % glucides · 30 % lipides · 25 % protéines
            <br />
            Calcul sur {data!.entriesWithMacros} repas avec macros sur{' '}
            {data!.days} j
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Anneau de progression Apple-style :
 *  - Arrière-plan : cercle gris clair
 *  - Premier-plan : arc coloré allant de 0 à percent (capé visuellement
 *    à un peu plus que target pour qu'on voie le dépassement)
 *  - Au centre : valeur en % (animée)
 *  - Sous l'anneau : label + cible
 *
 * Si l'utilisatrice est PILE sur la cible, le cercle est plein.
 * Si elle déborde (ex: 55 % au lieu de 45 %), on remplit à 100 % +
 * un petit indicateur de dépassement.
 */
function MacroRing({
  label,
  percent,
  target,
  color,
}: {
  label: string;
  percent: number;
  target: number;
  color: string;
}) {
  // L'anneau est rempli à 100 % quand on atteint EXACTEMENT la cible.
  // En-dessous : ratio percent/target. Au-dessus : 100 % + on annote.
  const ratio = Math.min(1, percent / target);
  const radius = 32;
  const stroke = 8;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);
  const animatedPercent = useCountUp(percent);
  const overshoot = percent > target;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <svg
          width={radius * 2 + stroke * 2}
          height={radius * 2 + stroke * 2}
          className="-rotate-90"
        >
          {/* Cercle arrière-plan */}
          <circle
            cx={radius + stroke}
            cy={radius + stroke}
            r={radius}
            fill="none"
            stroke="#f3e8eb"
            strokeWidth={stroke}
          />
          {/* Arc premier plan */}
          <circle
            cx={radius + stroke}
            cy={radius + stroke}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{
              transition: 'stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </svg>
        {/* % au centre */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-lg font-extrabold tabular-nums"
            style={{ color }}
          >
            {animatedPercent}%
          </span>
        </div>
        {overshoot && (
          <span
            title={`Dépassement : tu es à ${percent} % (cible ${target} %)`}
            className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-amber-400 text-[0.55rem] font-bold text-amber-950 shadow"
          >
            !
          </span>
        )}
      </div>
      <div className="text-center">
        <p className="text-[0.65rem] font-bold uppercase tracking-wider text-ink">
          {label}
        </p>
        <p className="text-[0.6rem] text-ink-soft">cible {target}%</p>
      </div>
    </div>
  );
}

/** Bloc score global avec emoji + barre de progression. */
function ScoreBlock({ score, emoji }: { score: number; emoji: string }) {
  const animatedScore = useCountUp(score);
  // Couleur du bandeau selon le score (vert / jaune / orange / rouge).
  const color = useMemo(() => {
    if (score >= 90) return '#10b981'; // emerald
    if (score >= 70) return '#84cc16'; // lime
    if (score >= 50) return '#f59e0b'; // amber
    return '#ef4444'; // red
  }, [score]);

  return (
    <div className="rounded-2xl bg-gradient-to-r from-coral-soft/40 to-coral-soft/20 p-3 text-center">
      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-ink-soft">
        Équilibre global
      </p>
      <p className="mt-1 flex items-center justify-center gap-2">
        <span
          className="text-3xl font-extrabold tabular-nums"
          style={{ color }}
        >
          {animatedScore}
          <span className="ml-1 text-base font-semibold text-ink-soft">
            /100
          </span>
        </span>
        <span className="text-3xl">{emoji}</span>
      </p>
      {/* Mini-barre de progression sous le score. */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${animatedScore}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
