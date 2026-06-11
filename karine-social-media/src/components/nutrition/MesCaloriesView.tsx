'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { HelpCircle, X } from 'lucide-react';
import { MyInfoModal } from './MyInfoModal';
import {
  CaloriesRepartition,
  WeekEvolutionChart,
  EncouragementBanner,
} from './CaloriesSections';
import { type DayState } from './CalorieCounterSheetV2';

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

/**
 * Interpolation linéaire entre 3 couleurs pastels selon le remplissage
 * du cercle kcal :
 *   - 0%     → rose très pâle  #F9D9E8 (début de journée doux)
 *   - 50%    → rose moyen      #F3A3CA (mi-journée)
 *   - 100%   → pourpre pastel  #C77BAE (objectif atteint, signal doux)
 *   - 120%+  → pourpre profond #9B4D8C (dépassement clair, sans agression)
 *
 * Inspirée de Lifesum / MyFitnessPal qui font varier la couleur de
 * l'anneau pour donner un retour visuel immédiat sur l'avancement de
 * la journée sans afficher de chiffres anxiogènes.
 */
function interpolatePastelPurple(progress: number): string {
  // Stops (progress 0..1.2) → [r,g,b]
  const stops: Array<[number, [number, number, number]]> = [
    [0, [249, 217, 232]], // #F9D9E8
    [0.5, [243, 163, 202]], // #F3A3CA
    [1, [199, 123, 174]], // #C77BAE
    [1.2, [155, 77, 140]], // #9B4D8C
  ];
  const p = Math.max(0, Math.min(1.2, progress));
  for (let i = 0; i < stops.length - 1; i++) {
    const [p1, c1] = stops[i];
    const [p2, c2] = stops[i + 1];
    if (p >= p1 && p <= p2) {
      const t = (p - p1) / (p2 - p1 || 1);
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return '#9B4D8C';
}

export function MesCaloriesView() {
  const [day, setDay] = useState<DayState | null>(null);
  const [myInfoOpen, setMyInfoOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const fetchToday = useCallback(async () => {
    try {
      const res = await fetch('/api/nutrition/today', { cache: 'no-store' });
      if (res.ok) setDay(await res.json());
    } catch {
      /* fail-soft */
    }
  }, []);

  useEffect(() => {
    void fetchToday();
  }, [fetchToday]);

  // === Donnees derivees ============================================
  // Décision 2026-06-11 : on RETIRE le concept "kcal brûlées" du
  // dashboard pour éviter le double-comptage avec le facteur d'activité
  // déjà inclus dans le profil (Mifflin × ACTIVITY_FACTORS). L'utilisatrice
  // déclare son niveau dans son profil, ça suffit. Voir bouton "Comment
  // ça marche ?" pour l'explication user-facing.
  const totals = day?.totals.kcal ?? 0;
  const target = day?.target.dailyKcal ?? 2000;
  const net = totals;
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
  // On clamp à 1.2 pour permettre un léger "dépassement" visuel : si
  // l'utilisatrice mange plus que son objectif, l'arc reste plein mais
  // la couleur vire vers pourpre profond pour signaler le dépassement.
  const trueProgress = target > 0 ? Math.min(1.2, net / target) : 0;

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
  // Pour l'affichage du path : on plafonne à 1 (cercle complet).
  const displayProgress = Math.min(1, progress);
  if (displayProgress >= 1) {
    arcPathD =
      `M ${ARC_CX} ${ARC_CY + ARC_R}` +
      ` A ${ARC_R} ${ARC_R} 0 1 1 ${ARC_CX} ${ARC_CY - ARC_R}` +
      ` A ${ARC_R} ${ARC_R} 0 1 1 ${ARC_CX} ${ARC_CY + ARC_R}`;
  } else if (displayProgress > 0) {
    const angle = displayProgress * 2 * Math.PI;
    const endX = ARC_CX - ARC_R * Math.sin(angle);
    const endY = ARC_CY + ARC_R * Math.cos(angle);
    const largeArc = displayProgress > 0.5 ? 1 : 0;
    arcPathD = `M ${ARC_CX} ${ARC_CY + ARC_R} A ${ARC_R} ${ARC_R} 0 ${largeArc} 1 ${endX} ${endY}`;
  }

  // === Couleur pastel évolutive selon le remplissage ===
  // 0%  → rose très pâle  (#F9D9E8)  doux quand on commence à peine
  // 50% → rose moyen      (#F3A3CA)
  // 100%→ pourpre pastel  (#C77BAE)  objectif quasi atteint
  // 120%→ pourpre profond (#9B4D8C)  dépassement signalé
  // On utilise une interpolation linéaire HEX sur 3 segments.
  const arcColor = interpolatePastelPurple(progress);

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
              stroke={arcColor}
              strokeOpacity="0.85"
              strokeWidth="7"
              strokeLinecap="round"
              style={{ transition: 'stroke 0.6s ease' }}
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

        {/* Petit bloc "Tes besoins en calories : Objectif XXXX"
            positionné AU-DESSUS du cercle texte (top=99). Remonté
            à top=40 pour laisser de l'air visuel avec le cercle. */}
        <div
          className="absolute flex flex-col items-center justify-center text-center"
          style={{
            left: pctX(55),
            top: pctY(40),
            width: pctX(179),
            zIndex: 4,
          }}
        >
          <p
            className="text-[0.6rem] font-semibold uppercase tracking-widest"
            style={{ color: '#8A6B5E' }}
          >
            Tes besoins en calories
          </p>
          <p
            className="mt-0.5 text-sm font-extrabold leading-none"
            style={{ color: '#8A6B5E' }}
          >
            Objectif&nbsp;: {target}
          </p>
        </div>

        {/* Cercle texte — convention MyFitnessPal :
              [Restant]
              [GROS CHIFFRE = remaining]
              [kcal]
            Le remplissage du cercle (arc autour) montre la progression
            mangé/objectif. La couleur de l'arc/chiffre vire au pourpre
            plus on s'approche/dépasse l'objectif. */}
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
            className="text-[0.7rem] font-semibold uppercase tracking-widest"
            style={{ color: '#8A6B5E' }}
          >
            Restant
          </span>
          <span
            className="font-bold leading-none"
            style={{
              fontSize: '2.5rem',
              color: arcColor,
              transition: 'color 0.6s ease',
            }}
          >
            {Math.round(Math.max(0, remaining))}
          </span>
          <span
            className="text-[0.7rem] font-semibold uppercase tracking-widest"
            style={{ color: '#8A6B5E' }}
          >
            kcal
          </span>
          {net >= target && (
            <span
              className="mt-2 text-[0.7rem] font-semibold"
              style={{ color: arcColor }}
            >
              {net > target * 1.05 ? 'Dépassement ⚠️' : 'Objectif atteint ♡'}
            </span>
          )}
        </div>

        {/* Bouton "Renseigne tes objectifs" — aligné verticalement
            avec le label "Tes besoins en calories" (top=40). Style
            pastel coral-soft pour rester doux mais clairement
            actionnable. */}
        <button
          type="button"
          onClick={() => setMyInfoOpen(true)}
          className="absolute flex items-center justify-center rounded-full bg-coral-soft px-2 py-1 text-center text-[0.6rem] font-bold uppercase leading-tight tracking-wider text-coral-dark shadow-sm ring-1 ring-coral-soft/60 transition hover:scale-[1.03] hover:bg-coral hover:text-white hover:ring-coral"
          style={{
            left: pctX(265),
            top: pctY(40),
            width: pctX(115),
            zIndex: 5,
          }}
        >
          Renseigne
          <br />
          tes objectifs
        </button>

        {/* Carte "Comment ça marche ?" — remplace l'ancien bloc
            Dépenses (supprimé 2026-06-11 : faisait double-comptage
            avec le facteur d'activité du profil).
            Click → ouvre la modal d'explication simple. */}
        <button
          type="button"
          onClick={() => setHowItWorksOpen(true)}
          aria-label="Comment ça marche ?"
          className="absolute flex flex-col items-center overflow-hidden rounded-2xl bg-white shadow-lg ring-2 ring-coral-soft transition hover:scale-[1.02] hover:shadow-xl hover:ring-coral"
          style={{
            left: pctX(270),
            top: pctY(112),
            width: pctX(105),
            height: pctY(149),
            zIndex: 5,
          }}
        >
          <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 py-3 text-center">
            <HelpCircle className="size-7" style={{ color: '#C77BAE' }} />
            <span
              className="text-[0.65rem] font-bold uppercase tracking-wider"
              style={{ color: '#8A6B5E' }}
            >
              Comment
              <br />
              ça marche&nbsp;?
            </span>
            <span
              className="text-[0.6rem] italic opacity-70"
              style={{ color: '#8A6B5E' }}
            >
              Clique ici ♡
            </span>
          </div>
        </button>

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

      {/* Modal "Comment ça marche ?" — explication simple, sans
          jargon, pour rassurer l'utilisatrice sur la façon dont
          son objectif kcal est calculé et lui donner confiance
          dans le tracking. */}
      {howItWorksOpen && (
        <HowItWorksModal onClose={() => setHowItWorksOpen(false)} />
      )}
    </div>
  );
}

/**
 * Modal "Comment ça marche ?" — pédagogique, ton chaleureux Karine,
 * 0 jargon. Rassure l'utilisatrice sur le fait que son sport est
 * déjà compté dans son objectif (pas besoin de saisir manuellement).
 */
function HowItWorksModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 md:items-center md:p-4"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-cream shadow-2xl md:rounded-3xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-coral-soft/30 bg-cream px-5 py-3">
          <h2 className="font-script text-2xl text-coral-dark">
            Comment ça marche&nbsp;?
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-8 w-8 place-items-center rounded-full text-coral-dark hover:bg-coral-soft/30"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4 text-sm leading-relaxed text-ink">
          <p className="rounded-2xl bg-white p-3 ring-1 ring-coral-soft/40 shadow-sm">
            ♡ Bonjour&nbsp;! Voici comment ton objectif de calories est
            calculé, en toute transparence.
          </p>

          <section>
            <h3 className="font-bold text-coral-dark">
              1. Tes infos personnelles
            </h3>
            <p className="mt-1">
              Quand tu remplis ton profil, tu donnes&nbsp;: ton{' '}
              <strong>genre</strong>, ton <strong>âge</strong>, ton{' '}
              <strong>poids</strong> et ta <strong>taille</strong>. À partir
              de cela, on calcule ce que ton corps brûle naturellement, juste
              en vivant (respirer, digérer, dormir…).
            </p>
          </section>

          <section>
            <h3 className="font-bold text-coral-dark">
              2. Ton niveau d&apos;activité ⚡
            </h3>
            <p className="mt-1">
              Tu nous dis si tu es plutôt <strong>sédentaire</strong>,{' '}
              <strong>modérément active</strong> ou <strong>très active</strong>.
              On ajoute alors les calories que tu dépenses{' '}
              <strong>en moyenne avec ton sport</strong>.
            </p>
            <div className="mt-2 rounded-xl bg-coral-soft/30 p-2.5 text-xs">
              👉 Pas besoin de saisir tes séances chaque jour&nbsp;! Ton sport
              est déjà compté dans ton objectif.
            </div>
          </section>

          <section>
            <h3 className="font-bold text-coral-dark">3. Ton objectif 🌸</h3>
            <p className="mt-1">
              Tu choisis si tu veux <strong>maintenir</strong> ton poids ou{' '}
              <strong>en perdre</strong> sur 3, 6 ou 12 mois. On ajuste alors
              un petit déficit doux et progressif (jamais en dessous d&apos;un
              minimum vital, ta santé d&apos;abord 💕).
            </p>
          </section>

          <section className="rounded-2xl bg-white/70 p-3 ring-1 ring-coral-soft/30">
            <h3 className="font-bold text-coral-dark">
              Ce qu&apos;il te reste à faire 🍴
            </h3>
            <p className="mt-1">
              Juste <strong>noter ce que tu manges</strong>. Le compteur
              baisse au fur et à mesure, et le petit cercle se remplit en
              douceur. Quand il devient pourpre, tu as atteint ton objectif
              du jour 🌷
            </p>
          </section>

          <p className="rounded-xl bg-amber-50 p-3 text-xs italic ring-1 ring-amber-200">
            Cette méthode (formule Mifflin-St Jeor) est utilisée par les
            diététicien·ne·s et reconnue par l&apos;ANSES (l&apos;agence
            française de santé). Tu peux modifier ton profil à tout moment
            via le bouton «&nbsp;Renseigne tes objectifs&nbsp;».
          </p>
        </div>

        <footer className="sticky bottom-0 border-t border-coral-soft/30 bg-cream px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full bg-coral px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-coral-dark"
          >
            J&apos;ai compris ♡
          </button>
        </footer>
      </div>
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
