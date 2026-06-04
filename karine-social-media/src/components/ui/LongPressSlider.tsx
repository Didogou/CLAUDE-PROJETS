'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Input numérique compact qui s'auto-transforme en mini-slider quand
 * on reste appuyé dessus (long press ≥ 350 ms).
 *
 * - Tap court → focus input normal (clavier numérique sur mobile).
 * - Long press → popover slider centré au-dessus de l'input, gros
 *   slider range natif + valeur visible. Tap dehors / Échap / bouton
 *   OK → ferme et garde la valeur.
 *
 * Utilisé sur les inputs g et Qté de la sheet calorie pour éviter
 * la saisie clavier fastidieuse.
 */
export function LongPressSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  inputClassName,
  ariaLabel,
  onFocusValue,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Texte affiché à droite de la valeur dans le popover (ex "g", "Qté"). */
  suffix?: string;
  /** Classe CSS appliquée à l'input compact. */
  inputClassName?: string;
  /** Pour l'accessibilité. */
  ariaLabel?: string;
  /** Optionnel : déclenché au focus (utile pour auto-sélectionner
   *  un radio candidat dans la sheet). */
  onFocusValue?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number>(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  // Sync draft <- value quand la valeur externe change ET que le popover
  // n'est pas ouvert (sinon ça écrase la saisie de l'utilisateur).
  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function startLongPress() {
    clearLongPress();
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setDraft(value);
      setOpen(true);
      // Blur l'input compact pour éviter que le clavier mobile
      // s'ouvre par-dessus le popover.
      inputRef.current?.blur();
    }, 350);
  }

  function cancelLongPress() {
    clearLongPress();
  }

  function commit() {
    onChange(draft);
    setOpen(false);
  }
  function cancel() {
    setDraft(value);
    setOpen(false);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onFocus={() => onFocusValue?.()}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        // Empêche le tap qui suit un long press d'ouvrir le clavier
        onClick={(e) => {
          if (longPressTriggered.current) {
            e.preventDefault();
            longPressTriggered.current = false;
          }
        }}
        className={inputClassName}
      />

      {open && (
        <LongPressOverlay
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          onCancel={cancel}
          min={min}
          max={max}
          step={step}
          suffix={suffix}
        />
      )}
    </>
  );
}

function LongPressOverlay({
  value,
  onChange,
  onCommit,
  onCancel,
  min,
  max,
  step,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}) {
  // Ferme à Échap.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onCommit();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, onCommit]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm md:items-center"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        // Tap sur le backdrop → cancel (=garde la valeur d'origine)
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm space-y-3 rounded-3xl bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-coral-dark">
            Ajuste la quantité
          </span>
          <span className="text-2xl font-bold text-coral">
            {Number.isInteger(step) ? Math.round(value) : value}
            {suffix && (
              <span className="ml-1 text-base font-normal text-ink-soft">
                {suffix}
              </span>
            )}
          </span>
        </div>

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-coral-soft/40 accent-coral"
          autoFocus
        />

        <div className="flex items-center justify-between text-[0.65rem] text-ink-soft">
          <span>{min}</span>
          <span>{max}</span>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-coral-soft px-4 py-1.5 text-xs font-semibold text-coral"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onCommit}
            className="rounded-full bg-coral px-4 py-1.5 text-xs font-semibold text-white shadow"
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
