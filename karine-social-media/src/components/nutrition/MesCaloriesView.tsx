'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { MyInfoModal } from './MyInfoModal';
import {
  CaloriesRepartition,
  WeekEvolutionChart,
  EncouragementBanner,
} from './CaloriesSections';
import {
  KcalBurnedEditor,
  type DayState,
} from './CalorieCounterSheetV2';

/**
 * MesCaloriesView — refonte from-scratch 2026-06-10 + responsive 2026-06-10.
 *
 * Layout PIXEL-PERFECT issu du POC /editor-test/calories-poc, converti
 * en UNITES RELATIVES (% du wrapper) pour s'adapter a TOUS les devices.
 *
 * Reference : 390×910 px (le POC mobile). Au runtime :
 *  - wrapper width = min(100%, 390px) → scale horizontal selon viewport
 *  - wrapper height = width × (910/390) via aspect-ratio → scale vertical proportionnel
 *  - chaque position/taille px du POC → % du wrapper via pctX/pctY
 *
 * Resultat : sur viewport 320, 360, 390, 412+ → tout scale uniformement,
 *  pas de bias gauche/droite, contenu visuellement centre sur tous les devices.
 */

const REF_W = 390;
const REF_H = 910;
const pctX = (px: number) => `${(px / REF_W) * 100}%`;
const pctY = (px: number) => `${(px / REF_H) * 100}%`;
const rem = (px: number) => `${px / 16}rem`;

type Metrics = {
  kcalBurned: number;
};

export function MesCaloriesView() {
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

  // === Donnees derivees ============================================
  const totals = day?.totals.kcal ?? 0;
  const target = day?.target.dailyKcal ?? 2000;
  const burned = metrics?.kcalBurned ?? 0;
  const net = Math.max(0, totals - burned);
  const remaining = Math.max(0, target - net);

  const macros = day?.totals ?? { kcal: 0, proteinsG: 0, lipidsG: 0, carbsG: 0 };
  const tgt = day?.target ?? null;
  const tCarbs = tgt?.dailyCarbsG ?? null;
  const tProt = tgt?.dailyProteinsG ?? null;
  const tLip = tgt?.dailyLipidsG ?? null;

  // === Arc de progression (animation ease-out 1.2s) ===
  const ARC_R = 36;
  const ARC_CX = 50;
  const ARC_CY = 50;
  const trueProgress = target > 0 ? Math.min(1, net / target) : 0;

  const [animatedProgress, setAnimatedProgress] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 1200;
    const from = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedProgress(from + (trueProgress - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trueProgress]);

  const progress = animatedProgress;

  let arcPathD = '';
  if (progress >= 1) {
    arcPathD =
      `M ${ARC_CX} ${ARC_CY + ARC_R}` +
      ` A ${ARC_R} ${ARC_R} 0 1 1 ${ARC_CX} ${ARC_CY - ARC_R}` +
      ` A ${ARC_R} ${ARC_R} 0 1 1 ${ARC_CX} ${ARC_CY + ARC_R}`;
  } else if (progress > 0) {
    const angle = progress * 2 * Math.PI;
    const endX = ARC_CX - ARC_R * Math.sin(angle);
    const endY = ARC_CY + ARC_R * Math.cos(angle);
    const largeArc = progress > 0.5 ? 1 : 0;
    arcPathD = `M ${ARC_CX} ${ARC_CY + ARC_R} A ${ARC_R} ${ARC_R} 0 ${largeArc} 1 ${endX} ${endY}`;
  }

  return (
    <div
      className="mx-auto w-full"
      style={{ maxWidth: rem(REF_W), marginTop: '-3rem' }}
    >
      {/* Container avec aspect-ratio = scale uniforme sur tous devices.
          Toutes les positions/tailles internes sont en % de ce
          container → ratio preserve sur 320, 360, 390, 412+. */}
      <div
        className="relative"
        style={{
          width: '100%',
          aspectRatio: `${REF_W} / ${REF_H}`,
          overflow: 'visible',
        }}
      >
        {/* ===== HERO ============================================ */}

        {/* Couronne fleurie (object-contain → ratio natif 1024×1536) */}
        <Image
          src="/images/icons/cal-courone.webp"
          alt=""
          width={485}
          height={401}
          priority
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{
            left: pctX(-48),
            top: pctY(2),
            width: pctX(485),
            height: pctY(401),
          }}
        />

        {/* Arc de progression coral pastel superpose sur l'anneau de
            la couronne. left=35 → centre arc x=147.5, decale fortement
            a gauche pour s'aligner sur le cercle dessine dans la webp. */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          className="pointer-events-none absolute"
          style={{
            left: pctX(35),
            top: pctY(70),
            width: pctX(225),
            height: pctY(225),
            zIndex: 3,
          }}
          aria-hidden
        >
          {arcPathD && (
            <path
              d={arcPathD}
              fill="none"
              stroke="#E879B5"
              strokeOpacity="0.75"
              strokeWidth="7"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Fee gauche */}
        <Image
          src="/images/icons/fee-logo.webp"
          alt=""
          width={110}
          height={110}
          aria-hidden
          className="anim-pulse-soft pointer-events-none absolute object-contain"
          style={{
            left: pctX(18),
            top: pctY(87),
            width: pctX(110),
            height: pctY(110),
            zIndex: 5,
          }}
        />

        {/* Cercle texte (RESTANT + chiffre + target + objectif atteint) */}
        <div
          className="absolute flex flex-col items-center justify-center"
          style={{
            left: pctX(55),
            top: pctY(99),
            width: pctX(179),
            height: pctY(163),
            zIndex: 4,
          }}
        >
          <span
            className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-widest"
            style={{ color: '#8A6B5E' }}
          >
            <span className="text-coral">♡</span>
            Restant
          </span>
          <span
            className="font-bold leading-none"
            style={{ fontSize: '2.5rem', color: '#C76B4A' }}
          >
            {Math.round(Math.max(0, remaining))}
          </span>
          <span className="text-[0.7rem]" style={{ color: '#8A6B5E' }}>
            / {target} kcal
          </span>
          {remaining <= 0 && (
            <span
              className="mt-2 text-[0.7rem] font-semibold"
              style={{ color: '#E8704F' }}
            >
              Objectif atteint ♡
            </span>
          )}
        </div>

        {/* Lien "Mes objectifs" au-dessus de la carte Depenses. */}
        <button
          type="button"
          onClick={() => setMyInfoOpen(true)}
          className="absolute text-center text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark underline decoration-coral-soft/50 underline-offset-2 hover:decoration-coral"
          style={{ left: pctX(270), top: pctY(88), width: pctX(105) }}
        >
          Mes objectifs
        </button>

        {/* Carte Depenses */}
        <div
          className="absolute flex flex-col items-center overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-coral-soft/20"
          style={{
            left: pctX(270),
            top: pctY(112),
            width: pctX(105),
            height: pctY(149),
          }}
        >
          <div className="relative z-10 flex h-full w-full flex-col items-center px-1.5 pb-2 pt-6 text-center">
            <KcalBurnedEditor
              value={metrics?.kcalBurned ?? 0}
              onSaved={(n) => {
                setMetrics((m) =>
                  m ? { ...m, kcalBurned: n } : { kcalBurned: n },
                );
              }}
            />
          </div>
        </div>

        {/* Branche aquarelle (decoration sous carte Depenses) */}
        <Image
          src="/images/icons/cal-branche.webp"
          alt=""
          width={80}
          height={80}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{
            left: pctX(325),
            top: pctY(201),
            width: pctX(80),
            height: pctY(80),
          }}
        />

        {/* ===== MACROS ========================================== */}

        <MacroTilePlain
          left={18}
          top={300}
          width={110}
          height={100}
          label="Glucides"
          consumed={macros.carbsG}
          target={tCarbs}
          accent="#A56B12"
          bg="#FDF6E8"
          barColor="#E8A33D"
        />
        <MacroTilePlain
          left={142}
          top={300}
          width={110}
          height={100}
          label="Protéines"
          consumed={macros.proteinsG}
          target={tProt}
          accent="#8A3F26"
          bg="#FBEDE5"
          barColor="#C76B4A"
        />
        <MacroTilePlain
          left={266}
          top={301}
          width={110}
          height={100}
          label="Lipides"
          consumed={macros.lipidsG}
          target={tLip}
          accent="#5E6E2F"
          bg="#F4F6EA"
          barColor="#9CAE6B"
        />

        {/* Icones aquarelle macros */}
        <Image
          src="/images/icons/cal-ble.webp"
          alt=""
          width={52}
          height={52}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{
            left: pctX(45),
            top: pctY(356),
            width: pctX(52),
            height: pctY(52),
          }}
        />
        <Image
          src="/images/icons/cal-feuille.webp"
          alt=""
          width={52}
          height={52}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{
            left: pctX(172),
            top: pctY(360),
            width: pctX(52),
            height: pctY(52),
          }}
        />
        <Image
          src="/images/icons/cal-olive.webp"
          alt=""
          width={52}
          height={52}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{
            left: pctX(297),
            top: pctY(355),
            width: pctX(52),
            height: pctY(52),
          }}
        />

        {/* ===== DONUT REPARTITION ============================== */}

        <h2
          className="absolute text-sm font-bold uppercase tracking-wider text-coral-dark"
          style={{ left: pctX(22), top: pctY(424) }}
        >
          Répartition des calories
        </h2>

        <div
          className="absolute"
          style={{
            left: pctX(22),
            top: pctY(460),
            width: pctX(360),
            height: pctY(120),
            zIndex: 1,
          }}
        >
          <CaloriesRepartition
            carbsG={macros.carbsG}
            proteinsG={macros.proteinsG}
            lipidsG={macros.lipidsG}
            targetKcal={target}
            compact
          />
        </div>

        {/* Tasse aquarelle — repositionnee en bas-droite de la carte
            donut pour ne PAS chevaucher la legende (textes kcal/%).
            Agrandie 110×130, decalee a droite (left=305). */}
        <Image
          src="/images/icons/cal-tasse.webp"
          alt=""
          width={152}
          height={176}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{
            left: pctX(305),
            top: pctY(490),
            width: pctX(110),
            height: pctY(130),
            zIndex: 3,
          }}
        />

        {/* ===== HISTOGRAMME EVOLUTION ========================== */}

        <h2
          className="absolute text-sm font-bold uppercase tracking-wider text-coral-dark"
          style={{ left: pctX(22), top: pctY(604) }}
        >
          Mon évolution
        </h2>

        <div
          className="absolute"
          style={{
            left: pctX(22),
            top: pctY(640),
            width: pctX(360),
            height: pctY(150),
          }}
        >
          <WeekEvolutionChart targetKcal={target} compact />
        </div>

        {/* ===== SLOGAN ENCOURAGEANT ============================ */}

        <div
          className="absolute"
          style={{
            left: pctX(20),
            top: pctY(810),
            width: pctX(360),
            height: pctY(80),
            zIndex: 1,
          }}
        >
          <EncouragementBanner
            consumed={macros.kcal}
            target={target}
            compact
          />
        </div>

        {/* Fee slogan */}
        <Image
          src="/images/icons/fee-logo.webp"
          alt=""
          width={90}
          height={90}
          aria-hidden
          className="anim-pulse-soft pointer-events-none absolute object-contain"
          style={{
            left: pctX(-3),
            top: pctY(805),
            width: pctX(90),
            height: pctY(90),
            zIndex: 5,
          }}
        />
      </div>

      {/* Modal "Mes objectifs" */}
      <MyInfoModal
        open={myInfoOpen}
        onClose={() => setMyInfoOpen(false)}
        onSaved={() => {
          setMyInfoOpen(false);
          void fetchToday();
        }}
        onError={() => {
          /* fail-soft */
        }}
        profileComplete={day?.profileComplete ?? false}
      />
    </div>
  );
}

/**
 * Tuile macro "plain" — coords en px ref (390×910) convertis en %.
 */
function MacroTilePlain({
  left,
  top,
  width,
  height,
  label,
  consumed,
  target,
  accent,
  bg,
  barColor,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  consumed: number;
  target: number | null;
  accent: string;
  bg: string;
  barColor: string;
}) {
  const pct =
    target && target > 0
      ? Math.min(100, Math.round((consumed / target) * 100))
      : 0;
  return (
    <div
      className="absolute overflow-hidden rounded-2xl px-3 py-2 shadow-md ring-1"
      style={{
        left: pctX(left),
        top: pctY(top),
        width: pctX(width),
        height: pctY(height),
        background: `linear-gradient(180deg, #FFFFFF 0%, ${bg} 100%)`,
        // @ts-expect-error CSS custom property
        '--tw-ring-color': '#F0E4DC',
      }}
    >
      <p
        className="text-[0.6rem] font-bold uppercase tracking-wider"
        style={{ color: accent }}
      >
        {label}
      </p>
      <p
        className="mt-1 text-xl font-extrabold"
        style={{ color: accent, lineHeight: 1 }}
      >
        {Math.round(consumed)}
        <span className="text-xs font-semibold text-ink-soft">
          {target !== null ? `/${Math.round(target)}` : ''}g
        </span>
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-soft/15">
        <div
          className="h-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}
