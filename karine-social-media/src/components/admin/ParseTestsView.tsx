'use client';

import { useState } from 'react';
import { Loader2, Play, AlertCircle, Check } from 'lucide-react';

type ParseResult = {
  phrase: string;
  correctedText?: string;
  items: Array<{
    label: string;
    portions: number;
    approxGrams: number;
    sizeVariability?: 'low' | 'medium' | 'high';
    sizeHint?: 'small' | 'medium' | 'large' | null;
    match: { name: string; alimCode: number; kcalPer100g: number | null } | null;
    kcalPerPortion: number | null;
    proteinsPerPortion: number | null;
    lipidsPerPortion: number | null;
    carbsPerPortion: number | null;
    possibleAccompaniments?: Array<{
      name: string;
      typicalG: number;
      kcalEstimate: number;
    }>;
  }>;
  error?: string;
  durationMs: number;
};

const DEFAULT_PHRASES = `un yaourt nature
deux pommes
un verre de lait
une grosse assiette de frites
un grand bol de céréales avec du lait
une côte de bœuf crue
des spaghetti à la bolognaise
500g de pâtes
une salade de tomates mozzarella
une salade de fruits
j'ai pris un café avec un croissant
une part de tartiflette
un sandwich jambon-beurre
des lasagnes
un verre de vin rouge`;

export function ParseTestsView() {
  const [phrases, setPhrases] = useState(DEFAULT_PHRASES);
  const [results, setResults] = useState<ParseResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function runTests() {
    const lines = phrases
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: lines.length });

    const out: ParseResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      const phrase = lines[i];
      const t0 = performance.now();
      try {
        const res = await fetch('/api/nutrition/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: phrase }),
        });
        const j = await res.json();
        const duration = Math.round(performance.now() - t0);
        out.push({
          phrase,
          correctedText: j.correctedText,
          items: Array.isArray(j.items) ? j.items : [],
          error: !res.ok ? j.error || `Erreur ${res.status}` : undefined,
          durationMs: duration,
        });
      } catch (e) {
        out.push({
          phrase,
          items: [],
          error: e instanceof Error ? e.message : 'Erreur',
          durationMs: Math.round(performance.now() - t0),
        });
      }
      setResults([...out]);
      setProgress({ done: i + 1, total: lines.length });
    }

    setRunning(false);
    setProgress(null);
  }

  const totalKcal = results.reduce(
    (acc, r) =>
      acc +
      r.items.reduce(
        (a, it) => a + (it.kcalPerPortion ?? 0) * it.portions,
        0,
      ),
    0,
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-admin-border bg-white p-4">
        <h3 className="text-sm font-bold text-admin-ink">Phrases à tester</h3>
        <p className="mt-0.5 text-xs text-admin-ink-soft">
          Une par ligne. Lignes vides ignorées.
        </p>
        <textarea
          value={phrases}
          onChange={(e) => setPhrases(e.target.value)}
          rows={10}
          className="mt-2 w-full rounded-lg border border-admin-border bg-admin-soft/20 px-3 py-2 font-mono text-sm"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-admin-ink-soft">
            {phrases.split('\n').filter((l) => l.trim()).length} phrases
          </p>
          <button
            type="button"
            onClick={runTests}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
          >
            {running ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {progress ? `${progress.done}/${progress.total}` : 'Lancement…'}
              </>
            ) : (
              <>
                <Play className="size-4" />
                Lancer les tests
              </>
            )}
          </button>
        </div>
      </section>

      {results.length > 0 && (
        <section className="rounded-2xl border border-admin-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-admin-ink">
              Résultats ({results.length} phrases)
            </h3>
            <p className="text-xs text-admin-ink-soft">
              Total estimé : {Math.round(totalKcal)} kcal
            </p>
          </div>
          <ul className="space-y-3">
            {results.map((r, idx) => (
              <ResultCard key={idx} result={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: ParseResult }) {
  const hasError = !!result.error;
  const totalKcal = result.items.reduce(
    (a, it) => a + (it.kcalPerPortion ?? 0) * it.portions,
    0,
  );
  return (
    <li
      className={`rounded-xl border p-3 ${
        hasError
          ? 'border-rose-300 bg-rose-50'
          : result.items.length === 0
            ? 'border-amber-300 bg-amber-50/60'
            : 'border-emerald-200 bg-emerald-50/40'
      }`}
    >
      <div className="flex items-start gap-2">
        {hasError ? (
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />
        ) : result.items.length === 0 ? (
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        ) : (
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{result.phrase}</p>
          {result.correctedText && result.correctedText !== result.phrase && (
            <p className="text-xs italic text-admin-ink-soft">
              → corrigé : « {result.correctedText} »
            </p>
          )}
          {hasError && (
            <p className="mt-1 text-xs text-rose-700">{result.error}</p>
          )}
        </div>
        <div className="text-right text-[0.65rem] text-admin-ink-soft">
          <p>{result.durationMs} ms</p>
          {result.items.length > 0 && (
            <p className="font-semibold text-emerald-700">
              {Math.round(totalKcal)} kcal
            </p>
          )}
        </div>
      </div>

      {result.items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {result.items.map((it, i) => (
            <li
              key={i}
              className="space-y-1 rounded border border-admin-border bg-white px-2 py-1 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <strong>{it.match ? it.match.name : '—'}</strong>
                  <span className="ml-1 text-admin-ink-soft">
                    ({it.portions} × {it.approxGrams}g
                    {it.sizeHint ? `, ${it.sizeHint}` : ''}
                    {it.sizeVariability ? ` · variability=${it.sizeVariability}` : ''})
                  </span>
                </span>
                {it.kcalPerPortion !== null && (
                  <span className="shrink-0 font-semibold text-coral">
                    {Math.round(it.kcalPerPortion * it.portions)} kcal
                  </span>
                )}
              </div>
              {it.possibleAccompaniments && it.possibleAccompaniments.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50/60 p-1 text-[0.65rem]">
                  <p className="font-semibold text-amber-900">
                    Accompagnements suggérés (triés par kcal ↓) :
                  </p>
                  <ul className="mt-0.5 space-y-0.5">
                    {it.possibleAccompaniments.map((a, k) => (
                      <li key={k} className="flex items-center gap-1 text-amber-800">
                        <span className="flex-1 truncate">
                          {a.name} ({a.typicalG}g)
                        </span>
                        <span className="shrink-0 font-semibold">
                          +{a.kcalEstimate} kcal
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
