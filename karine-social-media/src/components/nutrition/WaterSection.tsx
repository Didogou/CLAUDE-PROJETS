'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { CircularProgress } from '@/components/ui/CircularProgress';

type WaterState = {
  glassesCount: number;
  targetMl: number;
  glassSizeMl: number;
};

/**
 * Section "Eau" pour la sheet calorie V2.
 *
 * Layout :
 *   1. Titre "Ma consommation d'eau aujourd'hui"
 *   2. Sous-titre "Objectif : X L" cliquable → ouvre un picker iOS
 *      style (drum scrollable) pour changer l'objectif.
 *   3. Cercle bleu CENTRÉ au-dessus des verres, avec le nombre de
 *      verres bus en grand au centre.
 *   4. Rangée de verres GROS scrollable horizontalement. Toujours
 *      un verre vide cliquable à droite (même après l'objectif).
 *
 * Plus de fond bg-white sur la section pour que le dégradé du
 * parent (coral → bleu) soit visible.
 */
export function WaterSection() {
  const [state, setState] = useState<WaterState | null>(null);
  // Index du verre qui vient d'être rempli — burst 600 ms.
  const [bursting, setBursting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Ref pour auto-scroller la rangée de verres vers la droite.
  // Déclaré tout en haut (avant tout early return) pour respecter
  // les Rules of Hooks de React.
  const glassesScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refresh();
    function onChange() {
      void refresh();
    }
    window.addEventListener('water-log-updated', onChange);
    return () => window.removeEventListener('water-log-updated', onChange);
  }, []);

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
    setState((s) => (s ? { ...s, glassesCount: s.glassesCount + 1 } : s));
    try {
      await fetch('/api/water/log', { method: 'POST' });
      window.dispatchEvent(new CustomEvent('water-log-updated'));
    } catch {
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
      /* rollback handled by next refresh */
    }
  }

  if (!state) {
    return (
      <section className="rounded-2xl p-4">
        <p className="text-xs italic text-ink-soft">Chargement…</p>
      </section>
    );
  }

  const filled = state.glassesCount;
  const targetGlasses = Math.max(1, Math.round(state.targetMl / state.glassSizeMl));
  const visibleCount = filled + 1;
  const targetL = (state.targetMl / 1000).toFixed(2).replace('.', ',');

  return (
    <section className="space-y-3 rounded-2xl px-1 pb-2 pt-1">
      {/* Titre + objectif cliquable */}
      <div className="space-y-0.5 text-center">
        <h3 className="text-sm font-bold text-blue-900">
          Ma consommation d&apos;eau aujourd&apos;hui
        </h3>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-white"
        >
          Objectif&nbsp;: <span className="font-bold">{targetL} L</span>
          <ChevronDown className="size-3" />
        </button>
      </div>

      {/* Cercle bleu centré au-dessus des verres. Rotation 90° pour
          que le remplissage parte du HAUT et descende dans le sens
          horaire — effet "verre qui se remplit par le haut". */}
      <div className="flex items-center justify-center">
        <CircularProgress
          value={filled}
          max={targetGlasses}
          size="6.5rem"
          strokeWidth="0.65rem"
          trackClassName="stroke-white/70"
          arcClassName="stroke-blue-500"
          rotateClassName="rotate-90"
        >
          <span className="text-3xl font-extrabold leading-none text-blue-700">
            {filled}
          </span>
          <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-blue-700/80">
            / {targetGlasses} verres
          </span>
        </CircularProgress>
      </div>

      {/* Rangée de verres GROS scrollable horizontalement.
          Toujours un verre vide cliquable à droite. */}
      <div
        ref={glassesScrollRef}
        className="flex items-end gap-2 overflow-x-auto px-1 pb-1"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
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
              className={`relative grid size-24 shrink-0 place-items-center transition ${
                isFilled ? 'cursor-default' : 'hover:-translate-y-0.5 active:scale-95'
              }`}
            >
              <img
                src={isFilled ? '/icons/water/full.png' : '/icons/water/empty.png'}
                alt=""
                aria-hidden
                draggable={false}
                className="size-24 object-contain"
              />
              {isBurstingThis && (
                <span className="pointer-events-none absolute inset-0" aria-hidden>
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                    <span
                      key={angle}
                      className="water-burst-drop absolute left-1/2 top-1/2 block size-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
                      style={{
                        transform: `rotate(${angle}deg) translateY(-0.35rem)`,
                      }}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Picker iOS-style pour l'objectif */}
      {pickerOpen && (
        <WaterTargetPicker
          currentMl={state.targetMl}
          onClose={() => setPickerOpen(false)}
          onPick={(ml) => {
            void saveTarget(ml);
            setPickerOpen(false);
          }}
        />
      )}

      <style>{`
        @keyframes water-burst {
          0%   { opacity: 1; transform: rotate(var(--angle, 0deg)) translateY(-0.1rem) scale(0.5); }
          60%  { opacity: 1; transform: rotate(var(--angle, 0deg)) translateY(-2.5rem) scale(1.1); }
          100% { opacity: 0; transform: rotate(var(--angle, 0deg)) translateY(-3rem) scale(0.6); }
        }
        .water-burst-drop {
          animation: water-burst 600ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          transform-origin: center;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .water-burst-drop { animation: none; opacity: 0; }
        }
      `}</style>
    </section>
  );
}

// ============================================================
// WaterTargetPicker : drum picker iOS style pour choisir l'objectif
// ============================================================

const TARGET_OPTIONS_ML = [
  500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 3000,
];

function WaterTargetPicker({
  currentMl,
  onClose,
  onPick,
}: {
  currentMl: number;
  onClose: () => void;
  onPick: (ml: number) => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  // Hauteur de chaque item (en px) — utilisé pour snap + détection
  // de la valeur centrale par scroll position.
  const ITEM_HEIGHT_PX = 56;
  const [selected, setSelected] = useState<number>(currentMl);

  // Centre l'item courant au mount.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const idx = TARGET_OPTIONS_ML.findIndex((v) => v === currentMl);
    const safeIdx = idx >= 0 ? idx : 4; // fallback 1.5L
    // Pas d'animation au mount.
    el.scrollTo({ top: safeIdx * ITEM_HEIGHT_PX, behavior: 'auto' });
  }, [currentMl]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / ITEM_HEIGHT_PX);
    const clamped = Math.max(0, Math.min(TARGET_OPTIONS_ML.length - 1, idx));
    const ml = TARGET_OPTIONS_ML[clamped];
    if (ml !== selected) setSelected(ml);
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 backdrop-blur-sm md:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-t-3xl bg-white p-4 shadow-2xl md:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-blue-900">Objectif quotidien</h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-8 place-items-center rounded-full bg-ink-soft/10 text-ink-soft hover:bg-ink-soft/20"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Drum picker : ul scrollable avec scroll-snap, padding
            haut/bas pour pouvoir centrer le premier/dernier item.
            L'item central est mis en avant. */}
        <div className="relative">
          {/* Highlight central + fades haut/bas. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-14 -translate-y-1/2 rounded-xl border-2 border-blue-400/40 bg-blue-50/40"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-14 bg-gradient-to-b from-white to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-14 bg-gradient-to-t from-white to-transparent"
          />
          <ul
            ref={listRef}
            onScroll={onScroll}
            className="relative h-44 overflow-y-auto py-[5.25rem]"
            style={{
              scrollSnapType: 'y mandatory',
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {TARGET_OPTIONS_ML.map((ml) => {
              const isSelected = ml === selected;
              const label = (ml / 1000).toFixed(2).replace('.', ',') + ' L';
              return (
                <li
                  key={ml}
                  style={{
                    height: `${ITEM_HEIGHT_PX}px`,
                    scrollSnapAlign: 'center',
                  }}
                  className={`flex items-center justify-center text-xl font-bold transition-all ${
                    isSelected ? 'scale-110 text-blue-700' : 'text-ink-soft/60'
                  }`}
                >
                  {label}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-blue-200 px-4 py-1.5 text-xs font-semibold text-blue-700"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onPick(selected)}
            className="rounded-full bg-blue-500 px-5 py-1.5 text-xs font-semibold text-white shadow"
          >
            Valider
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
