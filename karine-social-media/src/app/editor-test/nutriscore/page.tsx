/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState } from 'react';
import { computeNutriscore, type NutriscoreInput } from '@/lib/nutriscore';
import { NutriScoreBadge } from '@/components/recettes/NutriScoreBadge';

/**
 * Page de test isolée pour valider visuellement le Nutri-Score
 * sur des recettes mock (Palier 1 — pas de BDD touchée).
 *
 * Donnees nutritionnelles par 100g chiffrees par moi-meme depuis
 * Ciqual et tables nutritionnelles standards. Les valeurs sont
 * approximatives mais coherentes avec ce qu'on aurait sur la vraie
 * recette une fois agregee depuis Ciqual.
 *
 * À supprimer ou rendre admin-only après validation.
 */

type MockRecipe = {
  name: string;
  emoji: string;
  description: string;
  values: NutriscoreInput;
};

const RECIPES: MockRecipe[] = [
  {
    name: 'Salade de quinoa, pois chiches et légumes',
    emoji: '🥗',
    description: 'Riche en fibres, protéines végétales, peu de sel',
    values: {
      kcal: 130,
      sugars: 3.5,
      saturatedFat: 0.8,
      sodiumMg: 180,
      fibers: 5.5,
      proteins: 6.5,
      fruitsVegLegumesPct: 65,
    },
  },
  {
    name: 'Poulet rôti aux herbes, riz complet, brocolis',
    emoji: '🍗',
    description: 'Plat équilibré classique, protéines + féculents + légumes',
    values: {
      kcal: 165,
      sugars: 1.2,
      saturatedFat: 1.5,
      sodiumMg: 280,
      fibers: 3,
      proteins: 14,
      fruitsVegLegumesPct: 30,
    },
  },
  {
    name: 'Tarte aux pommes maison',
    emoji: '🥧',
    description: 'Pâte brisée + pommes + sucre, dessert traditionnel',
    values: {
      kcal: 240,
      sugars: 24,
      saturatedFat: 7.5,
      sodiumMg: 160,
      fibers: 2.5,
      proteins: 3.5,
      fruitsVegLegumesPct: 35,
    },
  },
  {
    name: 'Salade chèvre noix miel',
    emoji: '🧀',
    description: 'Salade composée — le Nutri-Score 2024 pénalise les AGS du fromage',
    values: {
      kcal: 220,
      sugars: 6,
      saturatedFat: 6.5,
      sodiumMg: 380,
      fibers: 3,
      proteins: 11,
      fruitsVegLegumesPct: 45,
    },
  },
  {
    name: 'Pizza maison 4 fromages',
    emoji: '🍕',
    description: 'Comfort food, beaucoup de fromage = beaucoup d\'AGS et de sel',
    values: {
      kcal: 280,
      sugars: 3.5,
      saturatedFat: 9,
      sodiumMg: 720,
      fibers: 2,
      proteins: 13,
      fruitsVegLegumesPct: 8,
    },
  },
  {
    name: 'Eau citronnée maison',
    emoji: '💧',
    description: 'Boisson : eau + jus de citron + 1 cuillère de miel',
    values: {
      kcal: 18,
      sugars: 4,
      saturatedFat: 0,
      sodiumMg: 5,
      fibers: 0.2,
      proteins: 0.1,
      fruitsVegLegumesPct: 8,
    },
  },
  {
    name: 'Soupe de potimarron, lentilles corail',
    emoji: '🥣',
    description: 'Velouté ultra healthy, fibres et protéines végétales',
    values: {
      kcal: 75,
      sugars: 4,
      saturatedFat: 0.3,
      sodiumMg: 200,
      fibers: 4.5,
      proteins: 4.5,
      fruitsVegLegumesPct: 75,
    },
  },
  {
    name: 'Cookies pépites chocolat',
    emoji: '🍪',
    description: 'Goûter maison sucré, peu de fibres',
    values: {
      kcal: 460,
      sugars: 32,
      saturatedFat: 11,
      sodiumMg: 280,
      fibers: 2.5,
      proteins: 5.5,
      fruitsVegLegumesPct: 0,
    },
  },
];

export default function NutriScoreTestPage() {
  const [editing, setEditing] = useState<NutriscoreInput | null>(null);

  return (
    <div className="min-h-screen bg-cream p-4 lg:p-10">
      <header className="mx-auto mb-6 max-w-4xl">
        <h1 className="font-script text-4xl text-coral lg:text-5xl">
          Test Nutri-Score 2024
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Recettes mock pour valider l&apos;algorithme avant branchement BDD.
          Les valeurs sont approximatives — l&apos;agrégation Ciqual réelle viendra au Palier 2.
        </p>
      </header>

      <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
        {RECIPES.map((r) => {
          const isBeverage = r.emoji === '💧';
          const result = computeNutriscore(
            r.values,
            isBeverage ? 'BEVERAGE' : 'GENERIC',
          );
          return (
            <div
              key={r.name}
              className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30"
            >
              <div className="mb-3 flex items-start gap-3">
                <span className="text-3xl">{r.emoji}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold text-ink">{r.name}</h2>
                  <p className="text-xs italic text-ink-soft">{r.description}</p>
                </div>
              </div>

              <div className="mb-3 flex justify-center">
                <NutriScoreBadge grade={result.grade} size="md" />
              </div>

              {/* Détail debug — utile pour valider l'algo */}
              <details className="text-xs text-ink-soft">
                <summary className="cursor-pointer font-semibold">
                  Détail du calcul ({result.points} pts)
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  <div className="rounded bg-coral-soft/15 p-2">
                    <p className="font-bold text-coral-dark">
                      Négatifs : {result.breakdown.negativePoints}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      <li>Énergie : {result.breakdown.negativeDetail.energy}</li>
                      <li>Sucres : {result.breakdown.negativeDetail.sugars}</li>
                      <li>AGS : {result.breakdown.negativeDetail.saturatedFat}</li>
                      <li>Sodium : {result.breakdown.negativeDetail.sodium}</li>
                    </ul>
                  </div>
                  <div className="rounded bg-sage/15 p-2">
                    <p className="font-bold text-sage-dark">
                      Positifs : {result.breakdown.positivePoints}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      <li>Fibres : {result.breakdown.positiveDetail.fibers}</li>
                      <li>Protéines : {result.breakdown.positiveDetail.proteins}</li>
                      <li>FVL : {result.breakdown.positiveDetail.fvl}</li>
                    </ul>
                  </div>
                </div>
              </details>

              <button
                type="button"
                onClick={() => setEditing(r.values)}
                className="mt-3 w-full rounded-full bg-coral-soft/40 px-3 py-1 text-xs font-semibold text-coral-dark hover:bg-coral-soft/60"
              >
                Modifier les valeurs ↗
              </button>
            </div>
          );
        })}
      </div>

      {editing && (
        <Editor input={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function Editor({
  input,
  onClose,
}: {
  input: NutriscoreInput;
  onClose: () => void;
}) {
  const [v, setV] = useState(input);
  const result = computeNutriscore(v, 'GENERIC');
  const update = (key: keyof NutriscoreInput) => (e: any) =>
    setV({ ...v, [key]: Number(e.target.value) });

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <h3 className="mb-3 font-bold text-ink">Tester des valeurs</h3>
        <div className="mb-4 flex justify-center">
          <NutriScoreBadge grade={result.grade} />
        </div>
        <div className="space-y-2 text-sm">
          {(['kcal', 'sugars', 'saturatedFat', 'sodiumMg', 'fibers', 'proteins', 'fruitsVegLegumesPct'] as const).map(
            (k) => (
              <label key={k} className="flex items-center gap-2">
                <span className="w-32 text-xs text-ink-soft">{k}</span>
                <input
                  type="number"
                  step="0.1"
                  value={v[k]}
                  onChange={update(k)}
                  className="flex-1 rounded border border-coral-soft/40 px-2 py-1 text-sm"
                />
              </label>
            ),
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-full bg-coral px-4 py-2 text-sm font-bold text-white"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
