'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';

export type GroupCount = { name: string; count: number };

type ChunkResult = {
  total: number;
  nextOffset: number;
  done: boolean;
  counts: { generated: number; inserted: number; skipped: number; errors: number };
  results: Array<{ id: number; name: string; aliases?: string[]; skipped?: boolean; error?: string }>;
  error?: string;
};

/**
 * Onglet "Génération alias" : Karine choisit des catégories Ciqual et
 * lance un batch Mistral qui génère les alias naturels de chaque
 * aliment (status='pending'). Le linking recettes se fait APRÈS.
 *
 * Le batch est piloté côté client : on appelle la route par petits
 * lots (chunk) en boucle, ce qui respecte la limite Mistral (1 req/s,
 * throttle serveur) et permet une barre de progression + un Stop.
 */
export function CiqualAliasGenPanel({ groups }: { groups: GroupCount[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chunk, setChunk] = useState(6);
  const [force, setForce] = useState(false);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const [progress, setProgress] = useState({ total: 0, done: 0 });
  const [counts, setCounts] = useState({ generated: 0, inserted: 0, skipped: 0, errors: 0 });
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const selectedArr = useMemo(() => [...selected], [selected]);
  const selectedTotal = useMemo(
    () => groups.filter((g) => selected.has(g.name)).reduce((s, g) => s + g.count, 0),
    [groups, selected],
  );
  // ~1.2 s par aliment (appel Mistral + throttle 1,1 s).
  const estMinutes = Math.max(1, Math.ceil((selectedTotal * 1.2) / 60));

  useEffect(() => {
    logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight });
  }, [log]);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function pushLog(line: string) {
    setLog((prev) => [...prev.slice(-300), line]);
  }

  async function run() {
    if (selectedArr.length === 0 || running) return;
    setRunning(true);
    stopRef.current = false;
    setError(null);
    setCounts({ generated: 0, inserted: 0, skipped: 0, errors: 0 });
    setProgress({ total: selectedTotal, done: 0 });
    setLog([]);

    let offset = 0;
    try {
      while (!stopRef.current) {
        const res = await fetch('/api/admin/ciqual-aliases/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groups: selectedArr, offset, chunk, force }),
        });
        const data = (await res.json()) as ChunkResult;
        if (!res.ok || data.error) {
          setError(data.error ?? `Erreur ${res.status}`);
          break;
        }
        offset = data.nextOffset;
        setProgress({ total: data.total, done: Math.min(data.nextOffset, data.total) });
        setCounts((prev) => ({
          generated: prev.generated + data.counts.generated,
          inserted: prev.inserted + data.counts.inserted,
          skipped: prev.skipped + data.counts.skipped,
          errors: prev.errors + data.counts.errors,
        }));
        for (const r of data.results) {
          if (r.skipped) pushLog(`⏭️  ${r.name} — déjà des alias`);
          else if (r.error) pushLog(`❌ ${r.name} — ${r.error}`);
          else pushLog(`✓ ${r.name} → ${r.aliases?.join(', ') || '(aucun)'}`);
        }
        if (data.done) {
          pushLog('— Terminé —');
          break;
        }
      }
      if (stopRef.current) pushLog('— Arrêté —');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function stop() {
    stopRef.current = true;
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Avertissement Mistral */}
      <div className="flex items-start gap-2 rounded-2xl bg-tangerine/10 p-3 text-xs text-tangerine ring-1 ring-tangerine/20">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Mistral free = <strong>1 requête/seconde</strong>. Le batch est séquentiel et
          étalé (~1,2 s par aliment). Tu peux fermer cet onglet uniquement si tu laisses
          la page ouverte — le navigateur pilote la boucle. « Stop » interrompt
          proprement après le lot en cours.
        </p>
      </div>

      {/* Sélection des catégories */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-coral-dark">Catégories à traiter</h2>
          <div className="flex gap-2 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSelected(new Set(groups.map((g) => g.name)))}
              disabled={running}
              className="rounded-full bg-coral-soft/30 px-3 py-1 text-coral-dark hover:bg-coral-soft/50 disabled:opacity-40"
            >
              Tout
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={running}
              className="rounded-full bg-ink-soft/15 px-3 py-1 text-ink-soft hover:bg-ink-soft/25 disabled:opacity-40"
            >
              Aucune
            </button>
          </div>
        </div>
        <div className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => {
            const on = selected.has(g.name);
            return (
              <button
                key={g.name}
                type="button"
                onClick={() => toggle(g.name)}
                disabled={running}
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition disabled:opacity-50 ${
                  on
                    ? 'border-coral bg-coral/10 text-coral-dark'
                    : 'border-coral-soft/30 bg-white text-ink hover:bg-coral-soft/10'
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold ${
                    on ? 'bg-coral text-white' : 'bg-coral-soft/30 text-coral-dark'
                  }`}
                >
                  {g.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Options + lancement */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
        <label className="flex items-center gap-2 text-xs font-semibold text-ink">
          Lot
          <select
            value={chunk}
            onChange={(e) => setChunk(Number(e.target.value))}
            disabled={running}
            className="rounded-full border border-coral-soft/40 bg-white px-2 py-1 text-xs focus:border-coral focus:outline-none disabled:opacity-50"
          >
            {[4, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n} / appel
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-semibold text-ink">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={running}
            className="h-4 w-4 accent-coral"
          />
          Regénérer même ceux qui ont déjà des alias
        </label>

        <div className="ml-auto flex items-center gap-3">
          {selectedTotal > 0 && !running && (
            <span className="text-xs text-ink-soft">
              {selectedTotal.toLocaleString('fr-FR')} aliments · ~{estMinutes} min
            </span>
          )}
          {running ? (
            <button
              type="button"
              onClick={stop}
              className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-600"
            >
              <Square className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              disabled={selectedArr.length === 0}
              className="inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> Lancer la génération
            </button>
          )}
        </div>
      </div>

      {/* Progression + log */}
      {(running || progress.total > 0 || error) && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
          {/* Barre */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-coral-dark">
                {running ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {progress.done} / {progress.total} aliments
              </span>
              <span className="font-mono text-ink-soft">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-coral-soft/20">
              <div
                className="h-full rounded-full bg-coral transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Compteurs */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Counter label="Alias générés" value={counts.generated} color="sage" />
            <Counter label="Insérés" value={counts.inserted} color="coral" />
            <Counter label="Skip (déjà fait)" value={counts.skipped} color="tangerine" />
            <Counter label="Erreurs" value={counts.errors} color={counts.errors > 0 ? 'red' : 'sage'} />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 ring-1 ring-red-200">
              {error}
            </div>
          )}

          {/* Log live */}
          <div
            ref={logBoxRef}
            className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-ink/[0.03] p-3 font-mono text-[0.7rem] leading-relaxed text-ink-soft"
          >
            {log.length === 0 ? (
              <p className="italic">Le journal s'affichera ici…</p>
            ) : (
              log.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'sage' | 'coral' | 'tangerine' | 'red';
}) {
  const bg = {
    sage: 'bg-sage/15 text-sage',
    coral: 'bg-coral/15 text-coral-dark',
    tangerine: 'bg-tangerine/15 text-tangerine',
    red: 'bg-red-100 text-red-600',
  }[color];
  return (
    <div className={`rounded-xl px-3 py-2 ${bg}`}>
      <p className="text-[0.6rem] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="font-mono text-sm font-bold">{value}</p>
    </div>
  );
}
