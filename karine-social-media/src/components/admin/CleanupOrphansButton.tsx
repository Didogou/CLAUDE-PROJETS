'use client';

import { useState } from 'react';
import { Brush, Loader2 } from 'lucide-react';

type Report = {
  favoritesPurged: number;
  shoppingListsTouched: number;
  recipeRefsRemoved: number;
  sheetRefsRemoved: number;
};

export function CleanupOrphansButton() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setReport(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/cleanup-orphans', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Erreur ${res.status}`);
        return;
      }
      setReport(data.report as Report);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau');
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
      <header className="mb-2">
        <h3 className="text-base font-bold uppercase tracking-wider text-coral-dark">
          Nettoyage des références orphelines
        </h3>
        <p className="text-xs italic text-ink-soft">
          Supprime des favoris et listes de courses les références vers des
          recettes qui n&apos;existent plus. Utile pour purger les incohérences
          historiques (le trigger AFTER DELETE évite que ça se reproduise).
        </p>
      </header>

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
      >
        {running ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Brush className="size-4" />
        )}
        {running ? 'Nettoyage en cours…' : 'Lancer le nettoyage'}
      </button>

      {error && (
        <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {report && (
        <div className="mt-3 space-y-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          <p className="font-semibold">✓ Nettoyage terminé</p>
          <ul className="text-xs">
            <li>
              Favoris supprimés : <strong>{report.favoritesPurged}</strong>
            </li>
            <li>
              Listes de courses touchées :{' '}
              <strong>{report.shoppingListsTouched}</strong>
            </li>
            <li>
              Références recettes retirées :{' '}
              <strong>{report.recipeRefsRemoved}</strong>
            </li>
            <li>
              Références fiches retirées :{' '}
              <strong>{report.sheetRefsRemoved}</strong>
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}
