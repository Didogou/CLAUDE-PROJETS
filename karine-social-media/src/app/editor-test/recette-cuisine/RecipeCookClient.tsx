'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChefHat,
  Heart,
  PartyPopper,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { MOCK_RECIPE, type CookIngredient, type CookStep } from './mock-recipe';

/**
 * POC "cuisine guidée" — un écran par étape.
 *   intro (Commencer) → étapes → fin.
 * Données MOCK (cf. mock-recipe.ts). Maquette de référence : ustensiles
 * en illustration, titre script, ingrédients en carte, instruction, Suivant.
 */
export function RecipeCookClient() {
  const recipe = MOCK_RECIPE;
  const total = recipe.steps.length;
  // -1 = intro · 0..total-1 = étapes · total = fin
  const [idx, setIdx] = useState(-1);
  const go = (next: number) => setIdx(Math.max(-1, Math.min(total, next)));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-gradient-to-b from-blush to-cream">
      <RevealKeyframes />
      {idx === -1 && <IntroScreen recipe={recipe} onStart={() => go(0)} />}
      {idx >= 0 && idx < total && (
        <StepScreen
          step={recipe.steps[idx]}
          index={idx}
          total={total}
          onPrev={() => go(idx - 1)}
          onNext={() => go(idx + 1)}
        />
      )}
      {idx === total && (
        <DoneScreen
          recipeTitle={recipe.title}
          onRestart={() => go(0)}
          onClose={() => go(-1)}
        />
      )}
    </main>
  );
}

/* ============================== Intro ============================== */

function IntroScreen({
  recipe,
  onStart,
}: {
  recipe: typeof MOCK_RECIPE;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <span className="grid h-20 w-20 place-items-center rounded-full bg-coral-soft/50 text-coral-dark shadow-sm">
        <ChefHat className="h-10 w-10" />
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-coral">
          Recette guidée
        </p>
        <h1 className="mt-1 font-script text-4xl leading-tight text-coral-dark">
          {recipe.title}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          {recipe.steps.length} étapes · pour {recipe.servings} personnes
        </p>
      </div>
      <button
        type="button"
        onClick={onStart}
        className="flex items-center gap-2 rounded-full bg-coral px-8 py-3.5 text-base font-bold text-white shadow-[0_10px_24px_-10px_rgba(226,120,141,0.9)] transition hover:bg-coral-dark active:scale-95"
      >
        Commencer
        <ArrowRight className="h-5 w-5" />
      </button>
      <p className="text-xs italic text-ink-soft">
        On avance étape par étape, à ton rythme 🌸
      </p>
    </div>
  );
}

/* ============================== Étape ============================== */

function StepScreen({
  step,
  index,
  total,
  onPrev,
  onNext,
}: {
  step: CookStep;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const isLast = index === total - 1;
  const utensilCount = step.utensils.length;

  return (
    <div className="flex flex-1 flex-col">
      {/* Barre du haut : retour + Étape x/n + points */}
      <header className="sticky top-0 z-10 flex flex-col items-center gap-2 bg-blush/85 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex w-full items-center">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Étape précédente"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/80 text-ink-soft shadow-sm transition hover:bg-white active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <p className="flex-1 text-center text-sm font-bold text-ink">
            Étape {index + 1}/{total}
          </p>
          <span className="h-9 w-9 shrink-0" aria-hidden />
        </div>
        {/* Points de progression */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? 'w-4 bg-coral'
                  : i < index
                    ? 'w-1.5 bg-coral'
                    : 'w-1.5 bg-coral-soft/50'
              }`}
            />
          ))}
        </div>
      </header>

      {/* Contenu — keyé sur l'index pour rejouer le reveal "un à un" */}
      <div key={index} className="flex-1 space-y-6 overflow-y-auto px-5 pb-5 pt-4">
        {/* Ustensiles */}
        {step.utensils.length > 0 && (
          <section>
            <SectionHeading>Ustensiles</SectionHeading>
            <div className="mt-3 flex flex-wrap items-start justify-center gap-5">
              {step.utensils.map((u, i) => (
                <div
                  key={u.slug}
                  className="cook-rise flex w-20 flex-col items-center gap-1.5"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <Thumb src={u.imageUrl} emoji={u.emoji} alt={u.label} size="lg" />
                  <span className="text-center text-[0.7rem] font-semibold leading-tight text-ink">
                    {u.label}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Titre de l'étape (gros script) */}
        <h2 className="cook-rise flex items-center justify-center gap-2 text-center font-script text-4xl leading-tight text-coral">
          {step.title}
          <Heart className="h-5 w-5 shrink-0 text-coral-soft" fill="currentColor" />
        </h2>

        {/* Ingrédients */}
        {step.ingredients.length > 0 && (
          <section>
            <SectionHeading>Ingrédients</SectionHeading>
            <ul className="mt-3 divide-y divide-coral-soft/30 overflow-hidden rounded-3xl bg-white/90 shadow-sm ring-1 ring-coral-soft/30">
              {step.ingredients.map((ing, i) => (
                <li
                  key={`${ing.label}-${i}`}
                  className="cook-rise flex items-center gap-3 px-4 py-3"
                  style={{ animationDelay: `${(utensilCount + 1 + i) * 110}ms` }}
                >
                  <Thumb src={ing.imageUrl} emoji={ing.emoji ?? '🥗'} alt="" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink">{ing.label}</p>
                    {fmtQty(ing) && (
                      <p className="text-xs font-semibold text-coral">
                        {fmtQty(ing)}
                        {ing.note ? ` · ${ing.note}` : ''}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Instruction */}
        <section>
          <SectionHeading>Instruction</SectionHeading>
          <div
            className="cook-rise mt-3 flex items-center gap-3 rounded-3xl bg-white/90 px-4 py-3.5 shadow-sm ring-1 ring-coral-soft/30"
            style={{
              animationDelay: `${(utensilCount + 1 + step.ingredients.length) * 110}ms`,
            }}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-coral text-xs font-bold text-white">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug text-ink">
                {step.action}
              </p>
              {step.detail && (
                <p className="mt-1 text-xs italic text-ink-soft">{step.detail}</p>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Suivant pleine largeur */}
      <footer className="sticky bottom-0 bg-gradient-to-t from-cream to-transparent px-5 pb-5 pt-2">
        <button
          type="button"
          onClick={onNext}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-coral py-4 text-base font-bold text-white shadow-[0_12px_28px_-12px_rgba(226,120,141,0.95)] transition hover:bg-coral-dark active:scale-[0.98]"
        >
          {isLast ? (
            <>
              <Check className="h-5 w-5" /> Terminer
            </>
          ) : (
            <>
              Suivant <ArrowRight className="h-5 w-5" />
            </>
          )}
        </button>
      </footer>
    </div>
  );
}

/* ============================== Fin ============================== */

function DoneScreen({
  recipeTitle,
  onRestart,
  onClose,
}: {
  recipeTitle: string;
  onRestart: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <span className="grid h-20 w-20 place-items-center rounded-full bg-sage/20 text-sage shadow-sm">
        <PartyPopper className="h-10 w-10" />
      </span>
      <div>
        <h1 className="font-script text-4xl text-coral-dark">Bravo&nbsp;!</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {recipeTitle} est prête. Bon appétit 🌸
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="flex items-center gap-2 rounded-full bg-coral px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark active:scale-95"
        >
          <RotateCcw className="h-4 w-4" /> Recommencer
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-2 text-xs font-semibold text-ink-soft transition hover:text-ink"
        >
          Revenir au début
        </button>
      </div>
    </div>
  );
}

/* ============================== Pièces UI ============================== */

/** Titre de section en script + petites fioritures (style maquette). */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 text-coral">
      <Sparkles className="h-3.5 w-3.5 text-coral-soft" />
      <span className="font-script text-2xl leading-none text-coral">
        {children}
      </span>
      <Sparkles className="h-3.5 w-3.5 text-coral-soft" />
    </div>
  );
}

/**
 * Vignette ronde : illustration si dispo (catalogue ustensiles /
 * ciqual aquarelle), sinon emoji de repli.
 */
function Thumb({
  src,
  emoji,
  alt,
  size,
}: {
  src: string | null | undefined;
  emoji: string;
  alt: string;
  size: 'sm' | 'lg';
}) {
  const box = size === 'lg' ? 'h-16 w-16 text-3xl' : 'h-11 w-11 text-xl';
  return (
    <span
      className={`grid ${box} shrink-0 place-items-center overflow-hidden rounded-2xl bg-coral-soft/15`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-contain" />
      ) : (
        <span aria-hidden>{emoji}</span>
      )}
    </span>
  );
}

/* ============================== Helpers ============================== */

const FRACTIONS: Record<number, string> = {
  0.5: '½',
  0.25: '¼',
  0.75: '¾',
  0.33: '⅓',
};

/** Formate quantité + unité d'un ingrédient en libellé court. */
function fmtQty(ing: CookIngredient): string {
  if (ing.quantity == null) return '';
  const q = FRACTIONS[ing.quantity] ?? String(ing.quantity).replace('.', ',');
  return ing.unit ? `${q} ${ing.unit}` : q;
}

/** Keyframes du reveal "un à un" (injectées une fois). */
function RevealKeyframes() {
  return (
    <style>{`
      @keyframes cookRise {
        from { opacity: 0; transform: translateY(0.6rem); }
        to   { opacity: 1; transform: none; }
      }
      .cook-rise { opacity: 0; animation: cookRise 0.42s ease-out forwards; }
      @media (prefers-reduced-motion: reduce) {
        .cook-rise { animation: none; opacity: 1; }
      }
    `}</style>
  );
}
