'use client';

import { useState } from 'react';
import {
  computeNutriscore,
  NUTRISCORE_COLORS,
  type NutriscoreInput,
} from '@/lib/nutriscore';
import { NutriScoreBadge } from '@/components/recettes/NutriScoreBadge';

/**
 * Panneau "Règles de calcul" — documentation + bac à sable.
 *
 *  - Tables officielles des points négatifs/positifs (Nutri-Score 2024)
 *  - Seuils A à E
 *  - Mini éditeur "Tester des valeurs" pour vérifier le calcul sur des
 *    inputs arbitraires (recommandé pour valider l'algo contre un outil
 *    tiers comme calculernutriscore.com).
 */
export function NutriScoreRulesPanel({
  forUser = false,
}: {
  /** Mode utilisateur : masque le mini éditeur "Tester des valeurs"
   *  et l'encart de vérification externe. Affiche seulement la doc. */
  forUser?: boolean;
} = {}) {
  // Valeurs par défaut typiques d'un plat équilibré (poulet riz légumes).
  const [v, setV] = useState<NutriscoreInput>({
    kcal: 165,
    sugars: 1.2,
    saturatedFat: 1.5,
    sodiumMg: 280,
    fibers: 3,
    proteins: 14,
    fruitsVegLegumesPct: 30,
  });
  const result = computeNutriscore(v, 'GENERIC');

  const set = (key: keyof NutriscoreInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [key]: Number(e.target.value) || 0 });

  return (
    <div className="space-y-6">
      <header className="border-b border-coral-soft/30 pb-3">
        <h2 className="text-xl font-bold text-ink">Règles de calcul Nutri-Score 2024</h2>
        <p className="text-sm text-ink-soft">
          Algorithme officiel Santé publique France, en vigueur depuis le 1er janvier 2024.
          Calcul basé sur les valeurs nutritionnelles par 100&nbsp;g du plat fini.
        </p>
      </header>

      {/* Mini éditeur de test — admin only */}
      {!forUser && (
      <section className="rounded-xl bg-coral-soft/10 p-4 ring-1 ring-coral-soft/30">
        <h3 className="mb-3 text-base font-bold text-coral-dark">
          🧪 Tester des valeurs (par 100&nbsp;g du plat)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberRow label="Énergie (kcal)" value={v.kcal} onChange={set('kcal')} step={1} />
          <NumberRow label="Sucres (g)" value={v.sugars} onChange={set('sugars')} />
          <NumberRow label="AGS (g)" value={v.saturatedFat} onChange={set('saturatedFat')} />
          <NumberRow label="Sodium (mg)" value={v.sodiumMg} onChange={set('sodiumMg')} step={1} />
          <NumberRow label="Fibres (g)" value={v.fibers} onChange={set('fibers')} />
          <NumberRow label="Protéines (g)" value={v.proteins} onChange={set('proteins')} />
          <NumberRow
            label="% Fruits/Légumes/Légumineuses"
            value={v.fruitsVegLegumesPct}
            onChange={set('fruitsVegLegumesPct')}
            step={1}
            max={100}
          />
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-white p-3 shadow-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-soft">Score brut</p>
            <p className="text-2xl font-bold text-ink">{result.points} points</p>
            <p className="text-[0.7rem] italic text-ink-soft">
              Négatifs : {result.breakdown.negativePoints} · Positifs : {result.breakdown.positivePoints}
            </p>
          </div>
          <NutriScoreBadge grade={result.grade} size="sm" withLabel={false} />
        </div>
      </section>
      )}

      {/* Tables de points négatifs */}
      <section>
        <h3 className="mb-2 text-base font-bold text-ink">Points négatifs (max 40)</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <PointsTable
            title="Énergie (kJ/100 g)"
            help="1 kcal = 4,184 kJ. Convertie automatiquement."
            rows={[
              [0, 0], [336, 1], [672, 2], [1008, 3], [1344, 4],
              [1680, 5], [2010, 6], [2350, 7], [2690, 8], [3030, 9], [3370, 10],
            ]}
          />
          <PointsTable
            title="Sucres (g/100 g)"
            rows={[
              [0, 0], [3.4, 1], [6.8, 2], [10, 3], [14, 4], [17, 5], [20, 6],
              [24, 7], [27, 8], [31, 9], [34, 10], [37, 11], [41, 12],
              [44, 13], [48, 14], [51, 15],
            ]}
          />
          <PointsTable
            title="AGS — Acides gras saturés (g/100 g)"
            rows={[
              [0, 0], [1, 1], [2, 2], [3, 3], [4, 4],
              [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10],
            ]}
          />
          <PointsTable
            title="Sodium (mg/100 g)"
            help="Sel × 400 ≈ sodium. 1 g de sel ≈ 400 mg de Na."
            rows={[
              [0, 0], [80, 1], [160, 2], [240, 3], [320, 4], [400, 5],
              [500, 6], [600, 7], [700, 8], [800, 9], [900, 10],
              [1000, 11], [1200, 13], [1400, 15], [1600, 17],
              [1800, 19], [1900, 20],
            ]}
          />
        </div>
      </section>

      {/* Tables de points positifs */}
      <section>
        <h3 className="mb-2 text-base font-bold text-ink">Points positifs (max 17)</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <PointsTable
            title="Fibres (g/100 g)"
            help="Méthode AOAC depuis 2024."
            rows={[
              [0, 0], [3, 1], [4.1, 2], [5.2, 3], [6.3, 4], [7.4, 5],
            ]}
          />
          <PointsTable
            title="Protéines (g/100 g)"
            rows={[
              [0, 0], [2.4, 1], [4.8, 2], [7.2, 3], [9.6, 4],
              [12, 5], [14, 6], [17, 7],
            ]}
          />
          <PointsTable
            title="% Fruits / Légumes / Légumineuses"
            rows={[
              [0, 0], [40, 1], [60, 2], [80, 5],
            ]}
          />
        </div>
      </section>

      {/* Règle spéciale */}
      <section className="rounded-xl border border-tangerine/40 bg-tangerine/5 p-4">
        <h3 className="mb-2 text-sm font-bold text-tangerine">⚠ Règle anti-charcuterie 2024</h3>
        <p className="text-xs text-ink-soft">
          Si <strong>points négatifs ≥ 11</strong> ET <strong>FVL &lt; 5 pts</strong>, les points
          « protéines » ne sont pas comptés. Empêche que des aliments très gras/salés
          (fromages affinés, charcuteries) soient artificiellement remontés par leur
          forte teneur en protéines.
        </p>
      </section>

      {/* Seuils */}
      <section>
        <h3 className="mb-2 text-base font-bold text-ink">Seuils A → E (aliments solides)</h3>
        <div className="overflow-hidden rounded-lg ring-1 ring-coral-soft/40">
          <table className="w-full text-sm">
            <thead className="bg-coral-soft/10">
              <tr>
                <th className="p-2 text-left">Grade</th>
                <th className="p-2 text-left">Score (P − N)</th>
                <th className="p-2 text-left">Couleur officielle</th>
              </tr>
            </thead>
            <tbody>
              {(['A', 'B', 'C', 'D', 'E'] as const).map((g, i) => (
                <tr
                  key={g}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-coral-soft/5'}
                >
                  <td className="p-2">
                    <span
                      className="grid h-6 w-6 place-items-center rounded text-xs font-extrabold text-white"
                      style={{ backgroundColor: NUTRISCORE_COLORS[g].bg, color: NUTRISCORE_COLORS[g].text }}
                    >
                      {g}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {g === 'A' && '≤ 0'}
                    {g === 'B' && '1 à 2'}
                    {g === 'C' && '3 à 10'}
                    {g === 'D' && '11 à 18'}
                    {g === 'E' && '≥ 19'}
                  </td>
                  <td className="p-2 font-mono text-xs">{NUTRISCORE_COLORS[g].bg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[0.7rem] italic text-ink-soft">
          Pour les boissons, seuils différents (B = 0-1, C = 2-5, D = 6-9, E = ≥ 10).
          L&apos;eau est toujours A.
        </p>
      </section>

      {/* Outil de vérification externe — admin only */}
      {!forUser && (
      <section className="rounded-xl bg-sage/10 p-4">
        <h3 className="mb-2 text-sm font-bold text-sage">✓ Vérifier le calcul</h3>
        <p className="text-xs text-ink-soft">
          Pour valider qu&apos;on calcule la même chose que les outils officiels,
          tu peux comparer avec{' '}
          <a
            href="https://www.calculernutriscore.com/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-coral underline hover:text-coral-dark"
          >
            calculernutriscore.com
          </a>{' '}
          ou l&apos;app Open Food Facts. Saisis les mêmes 7 valeurs ci-dessus et tu
          dois obtenir le même grade.
        </p>
      </section>
      )}
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  step = 0.1,
  max,
}: {
  label: string;
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  step?: number;
  max?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="min-w-[10rem] text-xs text-ink-soft">{label}</span>
      <input
        type="number"
        step={step}
        min={0}
        max={max}
        value={value}
        onChange={onChange}
        className="flex-1 rounded border border-coral-soft/40 bg-white px-2 py-1 text-sm"
      />
    </label>
  );
}

function PointsTable({
  title,
  help,
  rows,
}: {
  title: string;
  help?: string;
  rows: ReadonlyArray<readonly [number, number]>;
}) {
  return (
    <div className="rounded-lg bg-white ring-1 ring-coral-soft/30">
      <div className="border-b border-coral-soft/20 px-3 py-2">
        <p className="text-xs font-bold text-ink">{title}</p>
        {help && <p className="text-[0.65rem] italic text-ink-soft">{help}</p>}
      </div>
      <div className="grid max-h-48 grid-cols-2 gap-x-2 overflow-y-auto px-3 py-2 text-[0.7rem] font-mono">
        <p className="text-ink-soft">≥ valeur</p>
        <p className="text-ink-soft">points</p>
        {rows.map(([t, p], i) => (
          // On utilise une div wrapper avec key au lieu d'un Fragment
          // pour éviter la warning React "Each child needs a key" qui
          // ne marche pas sur les Fragment courts. display:contents
          // garde le layout grid intact (les enfants restent direct
          // children du parent grid).
          <div key={i} className="contents">
            <p className="text-ink">{t}</p>
            <p className="font-bold text-coral-dark">{p}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
