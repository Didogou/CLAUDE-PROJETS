'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';

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

  useEffect(() => {
    void refresh();
    function onChange() {
      void refresh();
    }
    window.addEventListener('water-log-updated', onChange);
    return () => window.removeEventListener('water-log-updated', onChange);
  }, []);

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
  // Affiche les verres remplis + 1 vide cliquable, ou tout l'objectif
  // si déjà atteint.
  const visibleCount = Math.min(filled + 1, targetGlasses);
  const pct = Math.min(100, Math.round((filled / targetGlasses) * 100));

  const totalMl = filled * state.glassSizeMl;
  const targetMl = state.targetMl;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-blue-700">
          Eau
        </h3>
        <span className="text-xs font-semibold text-ink-soft">
          {Math.round(totalMl / 100) / 10} L / {Math.round(targetMl / 100) / 10} L
        </span>
      </div>

      <div className="flex items-stretch gap-3">
        {/* Verres */}
        <div className="flex flex-1 flex-wrap items-end gap-1.5">
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
                className={`relative grid size-12 place-items-center rounded-lg transition ${
                  isFilled ? 'cursor-default' : 'hover:-translate-y-0.5 active:scale-95'
                }`}
              >
                <img
                  src={isFilled ? '/icons/water/full.png' : '/icons/water/empty.png'}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className="size-12 object-contain"
                />
                {/* Burst : 8 gouttes qui partent en étoile */}
                {isBurstingThis && (
                  <span className="pointer-events-none absolute inset-0" aria-hidden>
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                      <span
                        key={angle}
                        className="water-burst-drop absolute left-1/2 top-1/2 block size-1.5 rounded-full bg-cyan-400"
                        style={{
                          transform: `rotate(${angle}deg) translateY(-0.25rem)`,
                          animationDelay: `${angle / 720}s`,
                        }}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Slider vertical d'objectif (0.5 L → 2 L, step 0.25 L) */}
        <div className="flex flex-col items-center justify-between rounded-lg bg-blue-50/70 px-2 py-2 ring-1 ring-blue-100">
          <span className="text-[0.55rem] font-bold uppercase tracking-wider text-blue-700">
            2 L
          </span>
          <input
            type="range"
            min={500}
            max={2000}
            step={250}
            value={targetDraft ?? targetMl}
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
            className="water-target-slider my-1.5 h-20 w-1 cursor-pointer accent-blue-500"
            style={{ writingMode: 'vertical-lr' as const, direction: 'rtl' }}
          />
          <span className="text-[0.55rem] font-bold uppercase tracking-wider text-blue-700">
            0,5 L
          </span>
        </div>
      </div>

      {/* Barre de progression bleue */}
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-blue-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-400 to-blue-500 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <style>{`
        @keyframes water-burst {
          0%   { opacity: 1; transform: rotate(var(--angle, 0deg)) translateY(-0.1rem) scale(0.5); }
          60%  { opacity: 1; transform: rotate(var(--angle, 0deg)) translateY(-1.8rem) scale(1); }
          100% { opacity: 0; transform: rotate(var(--angle, 0deg)) translateY(-2.2rem) scale(0.6); }
        }
        .water-burst-drop {
          animation: water-burst 600ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          transform-origin: center;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .water-burst-drop { animation: none; opacity: 0; }
        }
        /* Slider vertical : largeur du track plus visible */
        .water-target-slider::-webkit-slider-runnable-track {
          width: 0.35rem;
          background: linear-gradient(to top, #93c5fd, #2563eb);
          border-radius: 999px;
        }
        .water-target-slider::-moz-range-track {
          width: 0.35rem;
          background: linear-gradient(to top, #93c5fd, #2563eb);
          border-radius: 999px;
        }
      `}</style>
    </section>
  );
}
