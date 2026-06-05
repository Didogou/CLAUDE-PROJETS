'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { CircularProgress } from '@/components/ui/CircularProgress';

type WaterState = {
  glassesCount: number;
  targetMl: number;
  glassSizeMl: number;
};

/**
 * Section "Eau" pour la sheet calorie V2.
 *
 *  - Une rangée de verres : les remplis à gauche, un vide juste à
 *    côté (cliquable pour boire). Quand on clique le vide, il y a
 *    une petite "explosion d'eau" + il se transforme en plein, et
 *    un nouveau vide apparaît à droite.
 *  - Slider vertical (0.5 L → 2 L) à droite pour régler l'objectif.
 *  - Barre de progression bleue sous les verres.
 *
 * Toute la persistance passe par les APIs existantes :
 *  - GET /api/water/today
 *  - POST /api/water/log  (+ 1 verre)
 *  - PATCH /api/water/settings (objectif quotidien)
 */
export function WaterSection() {
  const [state, setState] = useState<WaterState | null>(null);
  // Index du verre qui vient d'être rempli — déclenche le burst
  // animation pendant 600 ms.
  const [bursting, setBursting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetDraft, setTargetDraft] = useState<number | null>(null);
  // Ref pour auto-scroller la rangée de verres vers la droite.
  // DÉCLARÉ AVANT tout early return pour respecter les Rules of Hooks.
  const glassesScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refresh();
    function onChange() {
      void refresh();
    }
    window.addEventListener('water-log-updated', onChange);
    return () => window.removeEventListener('water-log-updated', onChange);
  }, []);

  // Auto-scroll vers le verre vide à droite à chaque ajout. Déclaré
  // ici (avant early return) pour ne jamais changer l'ordre des
  // hooks entre renders.
  const filledCount = state?.glassesCount ?? 0;
  useEffect(() => {
    const el = glassesScrollRef.current;
    if (el) {
      el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
    }
  }, [filledCount]);

  async function refresh() {
    try {
      const res = await fetch('/api/water/today', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setState({
        glassesCount: Number(data.glassesCount) || 0,
        targetMl: Number(data.targetMl) || 1500,
        glassSizeMl: Number(data.glassSizeMl) || 250,
      });
    } catch {
      // silencieux
    }
  }

  async function addGlass(idx: number) {
    if (busy || !state) return;
    setBusy(true);
    setBursting(idx);
    window.setTimeout(() => setBursting(null), 600);
    // optimistic update
    setState((s) => (s ? { ...s, glassesCount: s.glassesCount + 1 } : s));
    try {
      await fetch('/api/water/log', { method: 'POST' });
      window.dispatchEvent(new CustomEvent('water-log-updated'));
    } catch {
      // rollback
      setState((s) =>
        s ? { ...s, glassesCount: Math.max(0, s.glassesCount - 1) } : s,
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveTarget(nextMl: number) {
    if (!state) return;
    setState((s) => (s ? { ...s, targetMl: nextMl } : s));
    try {
      await fetch('/api/water/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dailyWaterMl: nextMl }),
      });
    } catch {
      // rollback handled by next refresh
    }
  }

  if (!state) {
    return (
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
        <p className="text-xs italic text-ink-soft">Chargement…</p>
      </section>
    );
  }

  const filled = state.glassesCount;
  const targetGlasses = Math.max(1, Math.round(state.targetMl / state.glassSizeMl));
  // TOUJOURS afficher un verre vide cliquable APRÈS les remplis,
  // même si l'objectif est dépassé. Karine peut continuer à boire.
  const visibleCount = filled + 1;

  const totalMl = filled * state.glassSizeMl;
  const targetMl = state.targetMl;

  // Affichage du target en cours (slider en live + save au release)
  const displayedTargetMl = targetDraft ?? targetMl;

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-coral-soft/30">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-blue-700">
          Eau
        </h3>
        <span className="text-xs font-semibold text-ink-soft">
          {Math.round(totalMl / 100) / 10} L / {(displayedTargetMl / 1000).toFixed(2)} L
        </span>
      </div>

      <div className="flex items-stretch gap-3">
        {/* Verres — grands, scroll horizontal qui suit toujours le
            dernier verre vide à droite. */}
        <div
          ref={glassesScrollRef}
          className="flex flex-1 items-end gap-1.5 overflow-x-auto pb-1"
        >
          {Array.from({ length: visibleCount }, (_, i) => {
            const isFilled = i < filled;
            const isBurstingThis = bursting === i;
            return (
              <button
                key={i}
                type="button"
                onClick={isFilled ? undefined : () => addGlass(i)}
                disabled={isFilled || busy}
                aria-label={isFilled ? 'Verre bu' : `Boire un verre (${i + 1})`}
                className={`relative grid size-16 shrink-0 place-items-center transition ${
                  isFilled ? 'cursor-default' : 'hover:-translate-y-0.5 active:scale-95'
                }`}
              >
                <img
                  src={isFilled ? '/icons/water/full.png' : '/icons/water/empty.png'}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className="size-16 object-contain"
                />
                {/* Burst : 8 gouttes qui partent en étoile depuis le verre */}
                {isBurstingThis && (
                  <span className="pointer-events-none absolute inset-0" aria-hidden>
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                      <span
                        key={angle}
                        className="water-burst-drop absolute left-1/2 top-1/2 block size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]"
                        style={{
                          transform: `rotate(${angle}deg) translateY(-0.25rem)`,
                        }}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Slider vertical d'objectif (0.5 L → 2 L, step 0.25 L).
            Wrapper avec hauteur fixe — l'input range est tourné via
            transform pour un rendu fluide et cross-browser. Le 2L
            est en haut, 0.5L en bas (slider qui monte = boire plus). */}
        <div className="flex flex-col items-center gap-1 rounded-xl bg-blue-50 px-2 py-2 ring-1 ring-blue-100">
          <span className="text-[0.55rem] font-bold uppercase tracking-wider text-blue-700">
            2L
          </span>
          <div className="relative h-20 w-7">
            <input
              type="range"
              min={500}
              max={2000}
              step={250}
              value={displayedTargetMl}
              onChange={(e) => setTargetDraft(Number(e.target.value))}
              onMouseUp={() => {
                if (targetDraft !== null) {
                  void saveTarget(targetDraft);
                  setTargetDraft(null);
                }
              }}
              onTouchEnd={() => {
                if (targetDraft !== null) {
                  void saveTarget(targetDraft);
                  setTargetDraft(null);
                }
              }}
              aria-label="Objectif eau quotidien"
              className="water-target-slider absolute left-1/2 top-1/2 h-7 w-20 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer accent-blue-500"
            />
          </div>
          <span className="text-[0.55rem] font-bold uppercase tracking-wider text-blue-700">
            0,5L
          </span>
          <span className="text-[0.6rem] font-bold text-blue-700">
            {(displayedTargetMl / 1000).toFixed(2)}L
          </span>
        </div>
      </div>

      {/* Cercle bleu centré avec le nombre de verres bus au centre.
          Remplace la barre de progression : plus lisible d'un coup
          d'œil + affordance verres / objectif (X / Y). */}
      <div className="mt-3 flex items-center justify-center">
        <CircularProgress
          value={filled}
          max={targetGlasses}
          size="5.5rem"
          strokeWidth="0.55rem"
          trackClassName="stroke-blue-100"
          arcClassName="stroke-blue-500"
        >
          <span className="text-2xl font-extrabold leading-none text-blue-700">
            {filled}
          </span>
          <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-blue-700/80">
            / {targetGlasses} verres
          </span>
        </CircularProgress>
      </div>

      <style>{`
        @keyframes water-burst {
          0%   { opacity: 1; transform: rotate(var(--angle, 0deg)) translateY(-0.1rem) scale(0.5); }
          60%  { opacity: 1; transform: rotate(var(--angle, 0deg)) translateY(-2rem) scale(1); }
          100% { opacity: 0; transform: rotate(var(--angle, 0deg)) translateY(-2.4rem) scale(0.6); }
        }
        .water-burst-drop {
          animation: water-burst 600ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          transform-origin: center;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .water-burst-drop { animation: none; opacity: 0; }
        }
        /* Slider tourné -90deg : input horizontal qui devient vertical.
           Cross-browser, plus fluide que writing-mode + direction. */
        .water-target-slider::-webkit-slider-runnable-track {
          height: 0.35rem;
          background: linear-gradient(to right, #93c5fd, #2563eb);
          border-radius: 999px;
        }
        .water-target-slider::-moz-range-track {
          height: 0.35rem;
          background: linear-gradient(to right, #93c5fd, #2563eb);
          border-radius: 999px;
        }
        .water-target-slider::-webkit-slider-thumb {
          appearance: none;
          height: 1.1rem;
          width: 1.1rem;
          margin-top: -0.4rem;
          background: #2563eb;
          border-radius: 999px;
          border: 2px solid white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
          cursor: pointer;
        }
        .water-target-slider::-moz-range-thumb {
          height: 1.1rem;
          width: 1.1rem;
          background: #2563eb;
          border-radius: 999px;
          border: 2px solid white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
          cursor: pointer;
        }
      `}</style>
    </section>
  );
}
