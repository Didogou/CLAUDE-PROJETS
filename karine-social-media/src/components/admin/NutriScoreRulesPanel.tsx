'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
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
        <header className="mb-3">
          <h3 className="text-base font-bold text-coral-dark">
            🧪 Tester des valeurs (par 100&nbsp;g du plat fini)
          </h3>
          <p className="mt-1 text-xs text-ink-soft">
            Bac à sable : saisis les 7 valeurs nutritionnelles d&apos;un plat
            et compare le grade obtenu avec un outil externe (Open Food Facts,
            Yuka…). Permet de valider que notre algorithme calcule
            correctement.
          </p>
        </header>
        {/* Grid 2 colonnes sur PC large, 1 colonne sinon → labels et
            inputs jamais coupes. Label TOUJOURS au-dessus de l'input
            pour que le nom du champ reste lisible quelle que soit la
            largeur dispo. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <NumberRow label="Énergie (kcal)" value={v.kcal} onChange={set('kcal')} step={1} />
          <NumberRow label="Sucres (g)" value={v.sugars} onChange={set('sugars')} />
          <NumberRow label="AGS — Acides gras saturés (g)" value={v.saturatedFat} onChange={set('saturatedFat')} />
          <NumberRow label="Sodium (mg)" value={v.sodiumMg} onChange={set('sodiumMg')} step={1} />
          <NumberRow label="Fibres (g)" value={v.fibers} onChange={set('fibers')} />
          <NumberRow label="Protéines (g)" value={v.proteins} onChange={set('proteins')} />
          <NumberRow
            label="% Fruits / Légumes / Légumineuses"
            value={v.fruitsVegLegumesPct}
            onChange={set('fruitsVegLegumesPct')}
            step={1}
            max={100}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 shadow-sm">
          <div className="min-w-0">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-3">
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
  // Layout vertical (label au-dessus de l'input) : meme quand le
  // panneau est etroit, le nom du champ reste visible en entier.
  // Inputs en w-full pour utiliser toute la largeur dispo.
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      <input
        type="number"
        step={step}
        min={0}
        max={max}
        value={value}
        onChange={onChange}
        className="w-full rounded border border-coral-soft/40 bg-white px-2 py-1.5 text-sm font-mono"
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
  const [copied, setCopied] = useState(false);

  // TSV pour copie : header + une ligne par seuil. Format que les
  // calculateurs externes / Excel acceptent comme "coller" direct.
  function copyTsv() {
    const tsv = ['≥ valeur\tpoints', ...rows.map(([t, p]) => `${t}\t${p}`)].join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className="overflow-hidden rounded-lg bg-white ring-1 ring-coral-soft/30">
      <div className="flex items-center justify-between gap-2 border-b border-coral-soft/20 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-ink">{title}</p>
          {help && <p className="text-[0.65rem] italic text-ink-soft">{help}</p>}
        </div>
        <button
          type="button"
          onClick={copyTsv}
          aria-label={`Copier la table ${title}`}
          className="flex shrink-0 items-center gap-1 rounded-full bg-coral-soft/30 px-2 py-1 text-[0.65rem] font-semibold text-coral-dark transition hover:bg-coral-soft/50"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copié' : 'TSV'}
        </button>
      </div>
      {/* Vrai <table> HTML → selection/copie native plus simple.
          Pas de max-h ni overflow → toutes les valeurs sont visibles
          d'un coup, plus de scroll interne qui cache la fin. */}
      <table className="w-full select-text text-xs font-mono">
        <thead className="bg-coral-soft/5 text-[0.65rem] text-ink-soft">
          <tr>
            <th className="px-3 py-1.5 text-left font-semibold">≥ valeur</th>
            <th className="px-3 py-1.5 text-right font-semibold">points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([t, p], i) => (
            <tr
              key={i}
              className={i % 2 === 0 ? 'bg-white' : 'bg-coral-soft/5'}
            >
              <td className="px-3 py-1 text-ink">{t}</td>
              <td className="px-3 py-1 text-right font-bold text-coral-dark">{p}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
