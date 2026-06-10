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
 * MesCaloriesView — refonte from-scratch 2026-06-10.
 *
 * Layout pixel-perfect issu du POC /editor-test/calories-poc, converti
 * en UNITES RELATIVES (rem) pour s'adapter a tout type de mobile.
 * Toutes les coordonnees du JSON POC (en px ref 390 wide) sont
 * converties via le helper rem() : `rem(N)` = `${N/16}rem`.
 *
 * Sections rendues :
 *  - Hero (couronne + fee + cercle texte + carte Depensees + branche)
 *  - 3 tuiles macros + 3 icones aquarelle independantes
 *  - Titre + Donut Repartition + tasse aquarelle
 *  - Titre + Histogramme Evolution 7 jours
 *  - Slogan encourageant + fee
 */

/** Helper de conversion px → rem (base 16px = 1rem).
 *  Exemple : rem(390) = '24.375rem'. */
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

  // === Arc de progression coral (superpose sur l'anneau couronne) ===
  // SVG path calcule : demarre EN BAS (6h) et progresse en ANTI-HORAIRE
  // visuel (vers la gauche puis le haut). Convention standard de jauge :
  // 0% = rien, 100% = anneau plein.
  // Animation : interpole de 0 a la vraie valeur en ~1200ms ease-out
  // au mount + a chaque changement (consommation update).
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
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setAnimatedProgress(from + (trueProgress - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trueProgress]);

  const progress = animatedProgress;

  let arcPathD = '';
  if (progress >= 1) {
    // Cercle plein : 2 demi-arcs pour eviter le bug "start = end"
    arcPathD =
      `M ${ARC_CX} ${ARC_CY + ARC_R}` +
      ` A ${ARC_R} ${ARC_R} 0 1 1 ${ARC_CX} ${ARC_CY - ARC_R}` +
      ` A ${ARC_R} ${ARC_R} 0 1 1 ${ARC_CX} ${ARC_CY + ARC_R}`;
  } else if (progress > 0) {
    // Calcule l'angle parcouru depuis le bas (6h) en anti-horaire visuel.
    // En coords SVG (Y vers le bas) : x = cx - r·sin(θ), y = cy + r·cos(θ).
    const angle = progress * 2 * Math.PI;
    const endX = ARC_CX - ARC_R * Math.sin(angle);
    const endY = ARC_CY + ARC_R * Math.cos(angle);
    const largeArc = progress > 0.5 ? 1 : 0;
    // sweep-flag=1 → sens horaire en math SVG = anti-horaire visuel.
    arcPathD = `M ${ARC_CX} ${ARC_CY + ARC_R} A ${ARC_R} ${ARC_R} 0 ${largeArc} 1 ${endX} ${endY}`;
  }

  const macros = day?.totals ?? { kcal: 0, proteinsG: 0, lipidsG: 0, carbsG: 0 };
  const tgt = day?.target ?? null;
  const tCarbs = tgt?.dailyCarbsG ?? null;
  const tProt = tgt?.dailyProteinsG ?? null;
  const tLip = tgt?.dailyLipidsG ?? null;

  return (
    <div
      className="mx-auto w-full"
      style={{ maxWidth: rem(390), marginTop: '-3rem' }}
    >
      {/* Container global absolute. Height calculee en rem (= max y +
          height des elements + marge basse). marginTop negatif sur le
          parent → la couronne remonte dans la zone du AppHeader. */}
      <div
        className="relative"
        style={{ height: rem(910), overflow: 'visible' }}
      >
        {/* ===== HERO ============================================ */}

        {/* Couronne fleurie (object-contain pour respecter ratio natif
            1024×1536, portrait 2:3). */}
        <Image
          src="/images/icons/cal-courone.webp"
          alt=""
          width={485}
          height={401}
          priority
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{ left: rem(-48), top: rem(2), width: rem(485), height: rem(401) }}
        />

        {/* Arc de progression coral superpose sur l'anneau visible
            de la couronne. Position calibree pour matcher l'anneau de
            cal-courone.webp, centre aligne sur le cercle texte
            (cx≈144 = centre cercle text left=55 width=179). */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          className="pointer-events-none absolute"
          style={{
            left: rem(32),
            top: rem(68),
            width: rem(225),
            height: rem(225),
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
          style={{ left: rem(18), top: rem(87), width: rem(110), height: rem(110), zIndex: 5 }}
        />

        {/* Cercle texte (RESTANT + chiffre + target + objectif atteint) */}
        <div
          className="absolute flex flex-col items-center justify-center"
          style={{
            left: rem(55),
            top: rem(99),
            width: rem(179),
            height: rem(163),
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

        {/* Lien "Mes objectifs" au-dessus de la carte Depenses,
            aligne sur sa largeur. Ouvre la modal MyInfoModal. */}
        <button
          type="button"
          onClick={() => setMyInfoOpen(true)}
          className="absolute text-center text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark underline decoration-coral-soft/50 underline-offset-2 hover:decoration-coral"
          style={{ left: rem(270), top: rem(88), width: rem(105) }}
        >
          Mes objectifs
        </button>

        {/* Carte Depensees */}
        <div
          className="absolute flex flex-col items-center overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-coral-soft/20"
          style={{
            left: rem(270),
            top: rem(112),
            width: rem(105),
            height: rem(149),
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

        {/* Branche aquarelle (decoration sous carte Depensees) */}
        <Image
          src="/images/icons/cal-branche.webp"
          alt=""
          width={80}
          height={80}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{ left: rem(325), top: rem(201), width: rem(80), height: rem(80) }}
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

        {/* Icones aquarelle macros (ble→Glucides, feuille→Proteines, olive→Lipides) */}
        <Image
          src="/images/icons/cal-ble.webp"
          alt=""
          width={52}
          height={52}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{ left: rem(45), top: rem(356), width: rem(52), height: rem(52) }}
        />
        <Image
          src="/images/icons/cal-feuille.webp"
          alt=""
          width={52}
          height={52}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{ left: rem(172), top: rem(360), width: rem(52), height: rem(52) }}
        />
        <Image
          src="/images/icons/cal-olive.webp"
          alt=""
          width={52}
          height={52}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{ left: rem(297), top: rem(355), width: rem(52), height: rem(52) }}
        />

        {/* ===== DONUT REPARTITION ============================== */}

        <h2
          className="absolute text-sm font-bold uppercase tracking-wider text-coral-dark"
          style={{ left: rem(22), top: rem(424) }}
        >
          Répartition des calories
        </h2>

        <div
          className="absolute"
          style={{
            left: rem(22),
            top: rem(460),
            width: rem(360),
            height: rem(120),
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

        {/* Tasse aquarelle qui deborde du donut a droite */}
        <Image
          src="/images/icons/cal-tasse.webp"
          alt=""
          width={152}
          height={176}
          aria-hidden
          className="pointer-events-none absolute object-contain"
          style={{
            left: rem(305),
            top: rem(470),
            width: rem(120),
            height: rem(140),
            zIndex: 3,
          }}
        />

        {/* ===== HISTOGRAMME EVOLUTION ========================== */}

        <h2
          className="absolute text-sm font-bold uppercase tracking-wider text-coral-dark"
          style={{ left: rem(22), top: rem(604) }}
        >
          Mon évolution
        </h2>

        <div
          className="absolute"
          style={{
            left: rem(22),
            top: rem(640),
            width: rem(360),
            height: rem(150),
          }}
        >
          <WeekEvolutionChart targetKcal={target} compact />
        </div>

        {/* ===== SLOGAN ENCOURAGEANT ============================ */}

        <div
          className="absolute"
          style={{
            left: rem(20),
            top: rem(810),
            width: rem(360),
            height: rem(80),
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
            left: rem(-3),
            top: rem(805),
            width: rem(90),
            height: rem(90),
            zIndex: 5,
          }}
        />
      </div>

      {/* Modal "Mes infos" (trigger a remettre plus tard). */}
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
 * Tuile macro "plain" — sans illustration aquarelle integree.
 * Les coords (left/top/width/height) sont passees en PX mais converties
 * en REM via le helper rem() au rendu.
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
        left: rem(left),
        top: rem(top),
        width: rem(width),
        height: rem(height),
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
