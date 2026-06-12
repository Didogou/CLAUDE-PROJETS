'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Drum picker iOS-style générique.
 *
 * Liste verticale scrollable avec scroll-snap : l'item central est
 * mis en évidence. Au release, on snappe + on lit la valeur centrale.
 *
 * Utilisé pour :
 *  - objectif eau (WaterTargetPicker)
 *  - nombre de verres bus (WaterCountPicker)
 *  - grammes / quantité d'un aliment (sheet calorie V2)
 *  - n'importe quelle valeur numérique discrète à choisir dans une
 *    liste plutôt qu'à saisir.
 */
export function DrumPicker<T extends string | number>({
  title,
  options,
  current,
  formatLabel,
  accent = 'coral',
  onClose,
  onPick,
}: {
  title: string;
  options: T[];
  current: T;
  /** Comment afficher chaque option. Par défaut : String(option). */
  formatLabel?: (option: T) => string;
  /** Couleur du highlight + bouton Valider. */
  accent?: 'coral' | 'blue';
  onClose: () => void;
  onPick: (value: T) => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const ITEM_HEIGHT_PX = 56;
  const safeFormat = formatLabel ?? ((o: T) => String(o));
  // Trouve l'index du current. Si pas trouvé, prend celui le plus
  // proche (utile pour les valeurs en dehors de la liste).
  const initialIdx = (() => {
    const exact = options.findIndex((o) => o === current);
    if (exact >= 0) return exact;
    if (typeof current === 'number') {
      let bestIdx = 0;
      let bestDiff = Infinity;
      options.forEach((o, i) => {
        if (typeof o === 'number') {
          const d = Math.abs(o - current);
          if (d < bestDiff) {
            bestDiff = d;
            bestIdx = i;
          }
        }
      });
      return bestIdx;
    }
    return 0;
  })();
  const [selectedIdx, setSelectedIdx] = useState<number>(initialIdx);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: initialIdx * ITEM_HEIGHT_PX, behavior: 'auto' });
    // exhaustive-deps : init uniquement au mount, current peut bouger
    // pendant le picker reste ouvert (callback async)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / ITEM_HEIGHT_PX);
    const clamped = Math.max(0, Math.min(options.length - 1, idx));
    if (clamped !== selectedIdx) setSelectedIdx(clamped);
  }

  // Tap sur un item = scroll-snap dessus + validation immédiate.
  // Pattern iOS Forms : on n'a pas besoin de bouton Valider — taper
  // une valeur EST l'action de validation.
  function onItemTap(idx: number) {
    const el = listRef.current;
    if (el) el.scrollTo({ top: idx * ITEM_HEIGHT_PX, behavior: 'smooth' });
    onPick(options[idx]);
  }

  const highlightColor =
    accent === 'blue'
      ? 'border-blue-400/40 bg-blue-50/40'
      : 'border-coral/40 bg-coral-soft/30';
  const titleColor =
    accent === 'blue' ? 'text-blue-900' : 'text-coral-dark';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="anim-fade-in fixed inset-0 z-[80] flex items-end justify-center bg-black/40 backdrop-blur-sm md:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="anim-slide-up w-full max-w-sm space-y-3 rounded-t-3xl bg-white p-4 shadow-2xl md:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h4 className={`font-bold ${titleColor}`}>{title}</h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-8 place-items-center rounded-full bg-ink-soft/10 text-ink-soft hover:bg-ink-soft/20"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="relative">
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 top-1/2 z-10 h-14 -translate-y-1/2 rounded-xl border-2 ${highlightColor}`}
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
              // touch-action: pan-y interdit au navigateur d'interpréter
              // un swipe horizontal comme un scroll. Sans ça, sur iOS,
              // un drag latéral pendant qu'on scrolle verticalement fait
              // bouger les chiffres horizontalement → impression de bug.
              touchAction: 'pan-y',
              // overscrollBehavior contain : le scroll dans le drum ne
              // remonte pas au parent (sheet) si on dépasse le bord.
              overscrollBehavior: 'contain',
            }}
          >
            {options.map((opt, idx) => {
              const isSelected = idx === selectedIdx;
              return (
                <li
                  key={String(opt)}
                  onClick={() => onItemTap(idx)}
                  style={{
                    height: `${ITEM_HEIGHT_PX}px`,
                    scrollSnapAlign: 'center',
                  }}
                  className={`flex cursor-pointer items-center justify-center text-xl font-bold transition-all ${
                    isSelected
                      ? accent === 'blue'
                        ? 'scale-110 text-blue-700'
                        : 'scale-110 text-coral-dark'
                      : 'text-ink-soft/60'
                  }`}
                >
                  {safeFormat(opt)}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
