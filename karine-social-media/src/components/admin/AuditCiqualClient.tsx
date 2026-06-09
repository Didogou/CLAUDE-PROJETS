'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X, HelpCircle, Loader2, Play, Pause, RefreshCw, Filter } from 'lucide-react';
import type { AuditItem } from '@/app/api/admin/audit-ciqual/list/route';

/**
 * Tableau d'audit du matching Ciqual via Mistral.
 *
 * Workflow :
 *  1. Au mount, on charge la liste complète des ingrédients matchés
 *  2. Bouton "Lancer l'audit" déclenche la boucle séquentielle :
 *     pour chaque item, on appelle POST /judge (Mistral) avec un
 *     throttle de 1.1s minimum entre chaque appel (free tier
 *     1 req/s strict, cf. memory feedback_mistral_rate_limit).
 *  3. Au fur et à mesure, on met à jour le state pour rendre les
 *     verdicts ligne par ligne. Bouton Pause possible.
 *
 * Tri : recette ASC (déjà fait côté serveur). Filtre client :
 * checkbox "Uniquement les incohérents".
 */

type Verdict = 'coherent' | 'incoherent' | 'unsure';
type Status = 'pending' | 'judging' | 'done' | 'error';

type Row = AuditItem & {
  status: Status;
  verdict?: Verdict;
  reason?: string;
  errorMsg?: string;
};

const THROTTLE_MS = 1100; // 1.1s : marge sur la limite Mistral 1 req/s

export function AuditCiqualClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);
  const [showOnly, setShowOnly] = useState<'all' | 'incoherent' | 'pending'>(
    'all',
  );
  const [listStats, setListStats] = useState<{
    uniqueCount: number;
    totalOccurrences: number;
  } | null>(null);
  // Ref pour pouvoir stopper la boucle proprement depuis un bouton
  const stopRef = useRef(false);

  // === Chargement initial ====================================
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/audit-ciqual/list');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          items: AuditItem[];
          stats?: { uniqueCount: number; totalOccurrences: number };
        };
        if (cancelled) return;
        setRows(data.items.map((it) => ({ ...it, status: 'pending' })));
        if (data.stats) setListStats(data.stats);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // === Boucle de jugement séquentielle =========================
  async function runAudit(startFrom = 0) {
    stopRef.current = false;
    setRunning(true);
    try {
      for (let i = startFrom; i < rows.length; i++) {
        if (stopRef.current) break;
        setProgressIdx(i);

        const current = rows[i];
        if (current.status === 'done') continue; // skip déjà fait

        setRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: 'judging' } : r)),
        );

        const t0 = Date.now();
        try {
          const res = await fetch('/api/admin/audit-ciqual/judge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ingredient_label: current.ingredient_label,
              ciqual_name: current.ciqual_name,
            }),
          });
          const data = (await res.json()) as {
            verdict?: Verdict;
            reason?: string;
            error?: string;
          };
          if (!res.ok || data.error) {
            setRows((prev) =>
              prev.map((r, idx) =>
                idx === i
                  ? {
                      ...r,
                      status: 'error',
                      errorMsg: data.error ?? `HTTP ${res.status}`,
                    }
                  : r,
              ),
            );
          } else {
            setRows((prev) =>
              prev.map((r, idx) =>
                idx === i
                  ? {
                      ...r,
                      status: 'done',
                      verdict: data.verdict,
                      reason: data.reason,
                    }
                  : r,
              ),
            );
          }
        } catch (e) {
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? {
                    ...r,
                    status: 'error',
                    errorMsg: e instanceof Error ? e.message : String(e),
                  }
                : r,
            ),
          );
        }

        // Throttle 1.1s, mais on déduit le temps déjà passé sur la requête
        const elapsed = Date.now() - t0;
        const wait = Math.max(0, THROTTLE_MS - elapsed);
        if (wait > 0 && i + 1 < rows.length && !stopRef.current) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
    } finally {
      setRunning(false);
    }
  }

  // === Filtre client ==========================================
  const filtered = useMemo(() => {
    if (showOnly === 'all') return rows;
    if (showOnly === 'incoherent') {
      return rows.filter((r) => r.verdict === 'incoherent');
    }
    return rows.filter((r) => r.status === 'pending');
  }, [rows, showOnly]);

  const stats = useMemo(() => {
    const out = { total: rows.length, done: 0, coh: 0, inc: 0, unsure: 0, err: 0 };
    for (const r of rows) {
      if (r.status === 'done') out.done++;
      if (r.verdict === 'coherent') out.coh++;
      if (r.verdict === 'incoherent') out.inc++;
      if (r.verdict === 'unsure') out.unsure++;
      if (r.status === 'error') out.err++;
    }
    return out;
  }, [rows]);

  // === Rendu =================================================
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-coral" />
        <span className="ml-2 text-ink-soft">Chargement des ingredients…</span>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        Erreur chargement : {loadError}
      </div>
    );
  }

  const progressPct = rows.length === 0 ? 0 : Math.round((stats.done / rows.length) * 100);
  const etaSec = running ? Math.max(0, (rows.length - stats.done) * (THROTTLE_MS / 1000)) : 0;

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-2xl font-bold text-ink">Audit Ciqual par IA</h1>
        <p className="text-sm text-ink-soft">
          Pour chaque couple (ingredient → Ciqual) unique, Mistral verifie
          si le match est coherent. Throttle 1.1s/requete (limite free tier).
        </p>
        {listStats && (
          <p className="mt-1 text-xs italic text-ink-soft">
            {listStats.uniqueCount} couples uniques (sur {listStats.totalOccurrences} occurrences
            au total dans les recettes) → economie de {listStats.totalOccurrences - listStats.uniqueCount} requetes Mistral grace au dedoublon.
          </p>
        )}
      </header>

      {/* Barre de controle */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-coral-soft/10 p-3">
        {!running ? (
          <button
            type="button"
            onClick={() => {
              const firstPending = rows.findIndex((r) => r.status !== 'done');
              runAudit(firstPending === -1 ? rows.length : firstPending);
            }}
            disabled={stats.done === rows.length}
            className="flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            <Play className="size-4" />
            {stats.done === 0
              ? "Lancer l'audit"
              : stats.done < rows.length
                ? 'Reprendre'
                : 'Termine'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              stopRef.current = true;
            }}
            className="flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Pause className="size-4" /> Pause
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setRows((prev) =>
              prev.map((r) => ({
                ...r,
                status: 'pending',
                verdict: undefined,
                reason: undefined,
                errorMsg: undefined,
              })),
            );
            setProgressIdx(0);
          }}
          disabled={running}
          className="flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-semibold text-ink-soft ring-1 ring-coral-soft/40 disabled:opacity-40"
        >
          <RefreshCw className="size-3" /> Reset
        </button>

        <div className="ml-auto flex items-center gap-2 text-xs text-ink-soft">
          <Filter className="size-3" />
          <select
            value={showOnly}
            onChange={(e) => setShowOnly(e.target.value as 'all' | 'incoherent' | 'pending')}
            className="rounded border border-coral-soft/40 bg-white px-2 py-1 text-xs"
          >
            <option value="all">Tous ({rows.length})</option>
            <option value="incoherent">Incoherents ({stats.inc})</option>
            <option value="pending">A faire ({rows.length - stats.done})</option>
          </select>
        </div>
      </div>

      {/* Stats + barre progres */}
      <div className="rounded-lg bg-white p-3 ring-1 ring-coral-soft/30">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="font-bold text-ink">
            {stats.done}/{rows.length} ({progressPct}%)
          </span>
          <span className="text-emerald-700">✓ Coherent {stats.coh}</span>
          <span className="text-red-700">✗ Incoherent {stats.inc}</span>
          <span className="text-amber-700">? Incertain {stats.unsure}</span>
          {stats.err > 0 && <span className="text-red-700">⚠ Erreur {stats.err}</span>}
          {running && etaSec > 0 && (
            <span className="ml-auto text-ink-soft">
              ETA ~{Math.ceil(etaSec / 60)} min
            </span>
          )}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-coral-soft/20">
          <div
            className="h-full bg-coral transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Tableau */}
      <div className="overflow-x-auto rounded-lg ring-1 ring-coral-soft/30">
        <table className="w-full select-text text-sm">
          <thead className="bg-coral-soft/10 text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="p-2 text-left">Ingredient (Karine)</th>
              <th className="p-2 text-left">Match Ciqual</th>
              <th className="p-2 text-left">Recettes</th>
              <th className="p-2 text-left">Verdict IA</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const isActive = running && rows[progressIdx]?.key === r.key;
              return (
                <tr
                  key={r.key}
                  className={
                    isActive
                      ? 'bg-amber-50'
                      : r.verdict === 'incoherent'
                        ? 'bg-red-50'
                        : i % 2 === 0
                          ? 'bg-white'
                          : 'bg-coral-soft/5'
                  }
                >
                  <td className="p-2 font-semibold text-ink">
                    {r.ingredient_label}
                  </td>
                  <td className="p-2 text-xs text-ink-soft">
                    <span className="font-mono text-[0.7rem]">#{r.ciqual_id}</span>{' '}
                    {r.ciqual_name}
                  </td>
                  <td className="max-w-[16rem] p-2 text-xs text-ink-soft">
                    <RecipesCell recipes={r.recipes} />
                  </td>
                  <td className="p-2">
                    <VerdictCell row={r} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="p-4 text-center text-sm text-ink-soft">
            Aucun ingredient ne correspond au filtre.
          </p>
        )}
      </div>
    </div>
  );
}

function RecipesCell({
  recipes,
}: {
  recipes: AuditItem['recipes'];
}) {
  const [open, setOpen] = useState(false);
  if (recipes.length === 0) return <span>—</span>;

  // 1 recette : affichage direct
  if (recipes.length === 1) {
    const r = recipes[0];
    return (
      <span>
        <span className="font-semibold text-ink">{r.title}</span>
        {r.sheet_index > 0 && (
          <span className="ml-1 text-[0.65rem]">· fiche {r.sheet_index}</span>
        )}
      </span>
    );
  }

  // 2-3 recettes : on les affiche toutes inline
  if (recipes.length <= 3) {
    return (
      <span>
        <span className="mr-1 rounded-full bg-coral-soft/40 px-2 py-0.5 text-[0.65rem] font-bold text-coral-dark">
          {recipes.length}
        </span>
        {recipes.map((r) => r.title).join(' · ')}
      </span>
    );
  }

  // 4+ : badge avec compteur + toggle "voir tout"
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-full bg-coral-soft/40 px-2 py-0.5 text-[0.7rem] font-bold text-coral-dark hover:bg-coral-soft/60"
      >
        {recipes.length} recettes {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-2 text-[0.7rem]">
          {recipes.map((r) => (
            <li key={`${r.id}-${r.sheet_index}`} className="text-ink-soft">
              · {r.title}
              {r.sheet_index > 0 && (
                <span className="ml-1 text-[0.6rem] italic">(fiche {r.sheet_index})</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VerdictCell({ row }: { row: Row }) {
  if (row.status === 'pending') {
    return <span className="text-xs text-ink-soft/60">—</span>;
  }
  if (row.status === 'judging') {
    return <Loader2 className="size-4 animate-spin text-amber-600" />;
  }
  if (row.status === 'error') {
    return (
      <span className="text-xs text-red-700" title={row.errorMsg}>
        ⚠ {row.errorMsg?.slice(0, 30) ?? 'Erreur'}
      </span>
    );
  }
  if (row.verdict === 'coherent') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
        <Check className="size-4" /> Coherent
      </span>
    );
  }
  if (row.verdict === 'incoherent') {
    return (
      <div className="text-xs">
        <span className="inline-flex items-center gap-1 font-semibold text-red-700">
          <X className="size-4" /> Incoherent
        </span>
        {row.reason && (
          <p className="mt-0.5 text-[0.7rem] italic text-ink-soft">{row.reason}</p>
        )}
      </div>
    );
  }
  return (
    <div className="text-xs">
      <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
        <HelpCircle className="size-4" /> Incertain
      </span>
      {row.reason && (
        <p className="mt-0.5 text-[0.7rem] italic text-ink-soft">{row.reason}</p>
      )}
    </div>
  );
}
