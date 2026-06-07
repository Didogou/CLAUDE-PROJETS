'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCcw, Trash2, Wand2 } from 'lucide-react';

type Candidate = {
  ciqualId: number;
  name: string;
  kcalPer100g: number | null;
  groupName: string | null;
};

type Conflict = {
  alias: string;
  candidates: Candidate[];
};

type Payload = {
  conflicts: Conflict[];
  totalAliases: number;
  totalConflicts: number;
  totalResolved: number;
  totalRejected: number;
};

/**
 * Vue de résolution des conflits d'aliases Ciqual.
 *
 * Un conflit = un alias (texte normalisé, ex. "côte de porc") qui pointe
 * vers plusieurs entrées Ciqual en status='pending'. L'admin choisit
 * l'entrée à garder, les autres passent en 'rejected'.
 *
 * Actions par conflit :
 *  - "Garder" sur un candidat → ce candidat passe 'resolved', les autres 'rejected'
 *  - "Tout rejeter" → tous les candidats passent 'rejected'
 *
 * Après chaque résolution on refetch la liste pour avoir l'état à jour
 * (un alias peut disparaître de la liste s'il n'a plus qu'un seul
 * candidat pending — il n'est plus en conflit).
 */
export function CiqualAliasesConflictView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // alias en cours d'action
  const [autoResolveBusy, setAutoResolveBusy] = useState(false);
  const [autoResolveResult, setAutoResolveResult] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/admin/ciqual-aliases/conflicts', {
        cache: 'no-store',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      setData((await res.json()) as Payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runAutoResolve() {
    setAutoResolveBusy(true);
    setAutoResolveResult(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/ciqual-aliases/auto-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as {
        processed: number;
        rejected: number;
        conflictsAddressed: number;
        byNeutralAlias: number;
        byRawAlias: number;
      };
      setAutoResolveResult(
        `✨ ${j.conflictsAddressed} conflits traités · ${j.rejected} aliases rejetés. ` +
          `Détail : ${j.byNeutralAlias} alias neutres → versions crues écartées, ` +
          `${j.byRawAlias} alias « cru » → versions cuites écartées.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setAutoResolveBusy(false);
    }
  }

  async function resolve(
    alias: string,
    keepCiqualId: number | null,
    rejectCiqualIds: number[],
  ) {
    setBusy(alias);
    try {
      const res = await fetch('/api/admin/ciqual-aliases/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias, keepCiqualId, rejectCiqualIds }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {error}
        <button
          type="button"
          onClick={load}
          className="ml-3 inline-flex items-center gap-1 rounded-full bg-rose-200 px-3 py-1 text-xs font-semibold text-rose-900 hover:bg-rose-300"
        >
          <RefreshCcw className="h-3 w-3" /> Réessayer
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-white/70 px-4 py-6 text-sm italic text-admin-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des conflits…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats globales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pending total" value={data.totalAliases} tone="default" />
        <Stat label="Conflits" value={data.totalConflicts} tone="warning" />
        <Stat label="Resolved" value={data.totalResolved} tone="success" />
        <Stat label="Rejected" value={data.totalRejected} tone="muted" />
      </div>

      {/* Bouton "Auto-résoudre cuit/cru" : pour chaque conflit où
          l'alias ne mentionne pas explicitement "cru", on rejette
          automatiquement les versions crues si une version cuite existe
          aussi parmi les candidats. Aligné sur la règle métier de
          /api/nutrition/parse qui privilégie le cuit par défaut. */}
      <div className="rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-admin-ink">
              ⚡ Auto-résoudre cuit vs cru
            </p>
            <p className="mt-0.5 text-xs text-admin-ink-soft">
              Pour chaque conflit qui oppose une version <strong>cuite</strong>
              {' '}et une version <strong>crue</strong> :<br />
              · alias <strong>neutre</strong> («&nbsp;côte de bœuf&nbsp;») →
              on garde le cuit, on rejette le cru.<br />
              · alias <strong>cru</strong> («&nbsp;tartare de bœuf cru&nbsp;») →
              on garde le cru, on rejette le cuit.
            </p>
          </div>
          <button
            type="button"
            onClick={runAutoResolve}
            disabled={autoResolveBusy}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-admin-primary-dark disabled:opacity-50"
          >
            {autoResolveBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            {autoResolveBusy ? 'En cours…' : 'Lancer'}
          </button>
        </div>
        {autoResolveResult && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
            {autoResolveResult}
          </p>
        )}
      </div>

      {/* Liste des conflits */}
      {data.conflicts.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-900">
          🎉 Aucun conflit à résoudre. Tous les aliases pending sont
          uniques par alimentaire.
        </div>
      ) : (
        <ul className="space-y-3">
          {data.conflicts.map((c) => (
            <ConflictCard
              key={c.alias}
              conflict={c}
              busy={busy === c.alias}
              onKeep={(keepId) =>
                resolve(
                  c.alias,
                  keepId,
                  c.candidates.filter((x) => x.ciqualId !== keepId).map((x) => x.ciqualId),
                )
              }
              onRejectAll={() =>
                resolve(c.alias, null, c.candidates.map((x) => x.ciqualId))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'default' | 'warning' | 'success' | 'muted';
}) {
  const palette = {
    default: 'bg-white text-admin-ink',
    warning: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
    success: 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200',
    muted: 'bg-stone-50 text-stone-700 ring-1 ring-stone-200',
  }[tone];
  return (
    <div className={`rounded-2xl px-4 py-3 ${palette}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">
        {label}
      </p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function ConflictCard({
  conflict,
  busy,
  onKeep,
  onRejectAll,
}: {
  conflict: Conflict;
  busy: boolean;
  onKeep: (ciqualId: number) => void;
  onRejectAll: () => void;
}) {
  return (
    <li className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
            Alias en conflit
          </p>
          <p className="font-script text-2xl text-admin-primary-dark">
            « {conflict.alias} »
          </p>
          <p className="text-xs text-admin-ink-soft">
            {conflict.candidates.length} candidats Ciqual
          </p>
        </div>
        <button
          type="button"
          onClick={onRejectAll}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 disabled:opacity-50"
          title="Marque cet alias comme inutilisable pour tous les candidats"
        >
          <Trash2 className="h-3 w-3" /> Tout rejeter
        </button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {conflict.candidates.map((cand) => (
          <li
            key={cand.ciqualId}
            className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-admin-ink">
                {cand.name}
              </p>
              <p className="mt-0.5 text-xs text-admin-ink-soft">
                {cand.kcalPer100g !== null
                  ? `${cand.kcalPer100g} kcal / 100 g`
                  : 'kcal inconnue'}
                {cand.groupName ? ` · ${cand.groupName}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onKeep(cand.ciqualId)}
              disabled={busy}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Garder
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}
