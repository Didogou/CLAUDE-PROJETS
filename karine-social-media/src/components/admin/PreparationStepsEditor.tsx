'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';

/**
 * Éditeur d'étapes de préparation ordonnées (partagé recettes + repas
 * de menu). 1 textarea par étape, réordonnable (↑/↓), suppression, ajout.
 * L'ordre du tableau = l'ordre d'affichage (haut → bas de la fiche).
 *
 * `readOnly` : affichage seul (vue d'une fiche déjà persistée).
 */
export function PreparationStepsEditor({
  steps,
  onChange,
  readOnly = false,
}: {
  steps: string[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
}) {
  function update(i: number, val: string) {
    const next = [...steps];
    next[i] = val;
    onChange(next);
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div>
      <span className="block text-[0.6rem] font-semibold uppercase tracking-wider text-admin-ink-soft">
        Préparation (étapes ordonnées)
      </span>
      {steps.length === 0 && (
        <p className="mt-1 text-[0.7rem] italic text-admin-ink-soft">
          Aucune étape extraite.
        </p>
      )}
      <ol className="mt-1 space-y-1.5">
        {steps.map((step, i) => (
          // index key : OK ici, la valeur est contrôlée et la liste est
          // courte/éditée par une seule personne (pas de remount visible).
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-2 w-5 shrink-0 text-center text-xs font-bold text-admin-primary">
              {i + 1}.
            </span>
            <textarea
              value={step}
              onChange={(e) => update(i, e.target.value)}
              rows={2}
              readOnly={readOnly}
              className="input min-h-[2.25rem] flex-1 px-2 py-1 text-xs"
            />
            {!readOnly && (
              <>
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Monter l'étape"
                    className="grid h-4 w-5 place-items-center text-admin-ink-soft transition hover:text-admin-ink disabled:opacity-30"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === steps.length - 1}
                    aria-label="Descendre l'étape"
                    className="grid h-4 w-5 place-items-center text-admin-ink-soft transition hover:text-admin-ink disabled:opacity-30"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
                  aria-label="Supprimer l'étape"
                  className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded text-red-500 transition hover:bg-red-50"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <button
          type="button"
          onClick={() => onChange([...steps, ''])}
          className="mt-1.5 flex items-center gap-1 rounded-full border border-admin-border bg-white px-3 py-1 text-[0.7rem] font-semibold text-admin-ink-soft transition hover:bg-admin-soft/40"
        >
          <Plus className="h-3 w-3" /> Ajouter une étape
        </button>
      )}
    </div>
  );
}
