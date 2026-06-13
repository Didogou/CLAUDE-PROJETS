'use client';

import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Plus, Trash2 } from 'lucide-react';
import type { PreparationStep } from '@/data/recipes';

/**
 * Éditeur d'étapes de préparation STRUCTURÉES (partagé recettes + repas).
 * Chaque étape : texte (textarea, réordonnable ↑/↓ + suppression) +
 * ingrédients (labels, sous-ensemble de la liste) + ustensiles (slugs),
 * édités en CSV. L'ordre du tableau = l'ordre d'affichage (haut → bas).
 *
 * `readOnly` : affichage seul (fiche déjà persistée).
 */
export function PreparationStepsEditor({
  steps,
  onChange,
  readOnly = false,
}: {
  steps: PreparationStep[];
  onChange: (v: PreparationStep[]) => void;
  readOnly?: boolean;
}) {
  const csv = (v: string): string[] =>
    v.split(',').map((s) => s.trim()).filter(Boolean);

  function patch(i: number, p: Partial<PreparationStep>) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
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
      <ol className="mt-1 space-y-2">
        {steps.map((step, i) => (
          // index key : OK, valeur contrôlée + liste courte éditée par 1 personne.
          <li key={i} className="rounded-xl bg-admin-soft/30 p-2">
            <div className="flex items-start gap-1.5">
              <span className="mt-2 w-5 shrink-0 text-center text-xs font-bold text-admin-primary">
                {i + 1}.
              </span>
              <textarea
                value={step.text}
                onChange={(e) => patch(i, { text: e.target.value })}
                rows={2}
                readOnly={readOnly}
                placeholder="Texte de l'étape"
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
            </div>

            {/* Ingrédients + ustensiles DE CETTE ÉTAPE (CSV) */}
            <div className="mt-1.5 grid gap-1.5 pl-6 sm:grid-cols-2">
              <label className="block">
                <span className="block text-[0.55rem] font-semibold uppercase tracking-wider text-admin-ink-soft">
                  Ingrédients de l&apos;étape
                </span>
                <input
                  type="text"
                  value={step.ingredients.join(', ')}
                  onChange={(e) => patch(i, { ingredients: csv(e.target.value) })}
                  readOnly={readOnly}
                  placeholder="ex: thon, feta"
                  className="input h-7 w-full px-1.5 text-[0.7rem]"
                />
              </label>
              <label className="block">
                <span className="block text-[0.55rem] font-semibold uppercase tracking-wider text-admin-ink-soft">
                  Ustensiles de l&apos;étape
                </span>
                <input
                  type="text"
                  value={step.utensils.join(', ')}
                  onChange={(e) => patch(i, { utensils: csv(e.target.value) })}
                  readOnly={readOnly}
                  placeholder="ex: saladier, fouet"
                  className="input h-7 w-full px-1.5 text-[0.7rem]"
                />
              </label>
            </div>

            {/* Voix ElevenLabs de l'étape (si générée) */}
            {step.audioUrl && <StepAudio src={step.audioUrl} />}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <button
          type="button"
          onClick={() => onChange([...steps, { text: '', ingredients: [], utensils: [] }])}
          className="mt-1.5 flex items-center gap-1 rounded-full border border-admin-border bg-white px-3 py-1 text-[0.7rem] font-semibold text-admin-ink-soft transition hover:bg-admin-soft/40"
        >
          <Plus className="h-3 w-3" /> Ajouter une étape
        </button>
      )}
    </div>
  );
}

/** Bouton « Écouter / Pause » de la voix d'une étape. */
function StepAudio({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      setFailed(false);
      // play() rejette si la source est illisible (URL 404 / bucket privé /
      // mauvais type) → on l'attrape pour éviter le crash runtime Next.
      a.play().catch(() => setFailed(true));
    } else {
      a.pause();
    }
  }

  return (
    <div className="mt-1.5 ml-6 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-[0.7rem] font-semibold text-violet-700 transition hover:bg-violet-200"
      >
        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        {playing ? 'Pause' : 'Écouter la voix'}
      </button>
      {failed && (
        <span className="text-[0.65rem] font-semibold text-red-600">
          Voix illisible — régénère (bucket/URL).
        </span>
      )}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={ref}
        src={src}
        preload="none"
        onError={() => setFailed(true)}
        onPlay={() => {
          setPlaying(true);
          setFailed(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
