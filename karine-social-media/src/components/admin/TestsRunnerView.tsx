'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  PlayCircle,
  RotateCcw,
  TimerReset,
  XCircle,
  SkipForward,
} from 'lucide-react';

type Status = {
  status: 'running' | 'done' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  stderr?: string;
} | null;

type PlaywrightTest = {
  title: string;
  results?: Array<{
    status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
    duration: number;
    error?: { message?: string };
  }>;
};

type PlaywrightSuite = {
  title: string;
  file?: string;
  specs?: Array<{
    title: string;
    tests?: PlaywrightTest[];
  }>;
  suites?: PlaywrightSuite[];
};

type PlaywrightReport = {
  suites?: PlaywrightSuite[];
  stats?: {
    expected?: number;
    unexpected?: number;
    flaky?: number;
    skipped?: number;
    startTime?: string;
    duration?: number;
  };
};

/** Flatten les specs (Playwright groupe en suites/sub-suites). */
function collectSpecs(
  suite: PlaywrightSuite,
  acc: Array<{ file: string; describe: string; spec: PlaywrightTest }>,
  parentDescribe = '',
): void {
  const describe = parentDescribe || suite.title;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      acc.push({
        file: suite.file ?? describe,
        describe: spec.title,
        spec: t,
      });
    }
  }
  for (const sub of suite.suites ?? []) {
    collectSpecs(sub, acc, describe);
  }
}

function fmtDuration(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function TestsRunnerView() {
  const [status, setStatus] = useState<Status>(null);
  const [report, setReport] = useState<PlaywrightReport | null>(null);
  const [polling, setPolling] = useState(false);

  const [authError, setAuthError] = useState(false);
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/tests/status', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (r.status === 401 || r.status === 403) {
        setAuthError(true);
        return;
      }
      if (!r.ok) return;
      setAuthError(false);
      const j = await r.json();
      setStatus(j.status);
      setReport(j.result);
    } catch {
      /* silent */
    }
  }, []);

  // Premier load
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling toutes les 2 s pendant un run. Stoppe si auth perdue
  // pour ne pas spammer la console d'erreurs 401.
  useEffect(() => {
    if (status?.status !== 'running' || authError) {
      setPolling(false);
      return;
    }
    setPolling(true);
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [status?.status, fetchStatus, authError]);

  const isRunning = status?.status === 'running';

  async function startRun() {
    setStatus({ status: 'running', startedAt: new Date().toISOString() });
    setReport(null);
    try {
      const res = await fetch('/api/admin/tests/run', {
        method: 'POST',
        credentials: 'same-origin',
      });
      // 409 = un autre run est déjà en cours — affiche le message du
      // serveur pour que l'admin sache quoi faire (attendre ou Reset).
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        setStatus({
          status: 'failed',
          finishedAt: new Date().toISOString(),
          stderr: j?.error || 'Un run est déjà en cours.',
        });
        return;
      }
      // Le run est detaché, on poll pour les résultats
    } catch {
      /* silent — le poll affichera l'erreur */
    }
  }

  async function resetRun() {
    try {
      await fetch('/api/admin/tests/reset', {
        method: 'POST',
        credentials: 'same-origin',
      });
      setStatus(null);
      setReport(null);
    } catch {
      /* silent */
    }
  }

  // Aggrégation des stats
  const allSpecs: Array<{
    file: string;
    describe: string;
    spec: PlaywrightTest;
  }> = [];
  for (const s of report?.suites ?? []) collectSpecs(s, allSpecs);
  const total = allSpecs.length;
  const passed = allSpecs.filter(
    (s) => s.spec.results?.[0]?.status === 'passed',
  ).length;
  const failed = allSpecs.filter(
    (s) =>
      s.spec.results?.[0]?.status === 'failed' ||
      s.spec.results?.[0]?.status === 'timedOut',
  ).length;
  const skipped = allSpecs.filter(
    (s) => s.spec.results?.[0]?.status === 'skipped',
  ).length;
  const totalDuration = report?.stats?.duration ?? 0;

  return (
    <div className="space-y-4">
      {/* Bandeau contrôle */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-admin-surface p-4 shadow-sm ring-1 ring-admin-border">
        <div>
          <h3 className="text-sm font-bold text-admin-ink">
            Suite Playwright (chromium)
          </h3>
          <p className="mt-0.5 text-xs text-admin-ink-soft">
            {isRunning
              ? `Run en cours… (démarré à ${new Date(status?.startedAt ?? '').toLocaleTimeString('fr-FR')})`
              : status?.finishedAt
                ? `Dernier run : ${new Date(status.finishedAt).toLocaleString('fr-FR')}`
                : 'Aucun run enregistré'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchStatus}
            disabled={isRunning}
            className="grid h-9 w-9 place-items-center rounded-full text-admin-ink-soft transition hover:bg-admin-soft disabled:opacity-50"
            title="Rafraîchir"
          >
            <RotateCcw className="size-4" />
          </button>
          {/* Bouton Reset : utile si un run reste figé en "running"
              à cause d'un crash spawn ou dev server (état fantôme). */}
          {status?.status === 'running' && (
            <button
              type="button"
              onClick={resetRun}
              className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 ring-1 ring-rose-300 hover:bg-rose-100"
              title="Forcer le reset de l'état (utile si bloqué)"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={startRun}
            disabled={isRunning}
            className="inline-flex items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50"
          >
            {isRunning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlayCircle className="size-4" />
            )}
            {isRunning ? 'Run en cours…' : 'Lancer les tests'}
          </button>
        </div>
      </section>

      {/* Stats */}
      {report && total > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<CheckCircle2 className="size-5" />}
            label="Passés"
            value={passed}
            total={total}
            color="emerald"
          />
          <StatCard
            icon={<XCircle className="size-5" />}
            label="Échecs"
            value={failed}
            total={total}
            color={failed > 0 ? 'rose' : 'slate'}
          />
          <StatCard
            icon={<SkipForward className="size-5" />}
            label="Skippés"
            value={skipped}
            total={total}
            color="amber"
          />
          <StatCard
            icon={<TimerReset className="size-5" />}
            label="Durée"
            value={fmtDuration(totalDuration)}
            color="sky"
          />
        </section>
      )}

      {/* Liste des tests par fichier */}
      {report && total > 0 && (
        <section className="space-y-2">
          {Object.entries(groupByFile(allSpecs)).map(([file, specs]) => (
            <FileGroup key={file} file={file} specs={specs} />
          ))}
        </section>
      )}

      {/* Session admin expirée : on demande à recharger */}
      {authError && (
        <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <h4 className="text-sm font-bold text-amber-800">
            Session admin expirée
          </h4>
          <p className="mt-1 text-xs text-amber-700">
            Le serveur ne reconnaît plus ta session (HTTP 401). Recharge la
            page (Ctrl+R) ou reconnecte-toi sur <code>/login</code>.
          </p>
        </section>
      )}

      {/* Erreur stderr si run failed */}
      {status?.status === 'failed' && status.stderr && (
        <section className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
          <h4 className="text-sm font-bold text-rose-700">
            Erreur du dernier run
          </h4>
          <pre className="mt-2 max-h-48 overflow-auto text-xs text-rose-700">
            {status.stderr}
          </pre>
        </section>
      )}

      {/* État vide */}
      {!report && !isRunning && (
        <section className="rounded-2xl bg-admin-surface p-8 text-center shadow-sm ring-1 ring-admin-border">
          <PlayCircle className="mx-auto size-10 text-admin-primary" />
          <p className="mt-3 text-sm font-semibold text-admin-ink">
            Aucun run n&apos;a été effectué
          </p>
          <p className="mt-1 text-xs text-admin-ink-soft">
            Clique sur « Lancer les tests » pour démarrer la suite.
          </p>
        </section>
      )}

      <p className="text-[0.65rem] italic text-admin-ink-soft">
        {polling && <Loader2 className="mr-1 inline size-3 animate-spin" />}
        Polling auto toutes les 2 s pendant un run.
      </p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  total,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  total?: number;
  color: 'emerald' | 'rose' | 'amber' | 'sky' | 'slate';
}) {
  const palette: Record<typeof color, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    slate: 'bg-slate-50 text-slate-700 ring-slate-200',
  };
  return (
    <div className={`rounded-2xl p-4 shadow-sm ring-1 ${palette[color]}`}>
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-[0.65rem] font-bold uppercase tracking-wider">
          {label}
        </p>
      </div>
      <p className="mt-1 text-2xl font-extrabold">
        {value}
        {typeof value === 'number' && total !== undefined && (
          <span className="text-sm font-semibold opacity-60"> / {total}</span>
        )}
      </p>
    </div>
  );
}

function groupByFile(
  specs: Array<{ file: string; describe: string; spec: PlaywrightTest }>,
): Record<string, Array<{ describe: string; spec: PlaywrightTest }>> {
  const out: Record<string, Array<{ describe: string; spec: PlaywrightTest }>> =
    {};
  for (const s of specs) {
    if (!out[s.file]) out[s.file] = [];
    out[s.file].push({ describe: s.describe, spec: s.spec });
  }
  return out;
}

function FileGroup({
  file,
  specs,
}: {
  file: string;
  specs: Array<{ describe: string; spec: PlaywrightTest }>;
}) {
  const [open, setOpen] = useState(true);
  const fileLabel = file.split(/[\\/]/).pop() ?? file;
  const filePassed = specs.filter(
    (s) => s.spec.results?.[0]?.status === 'passed',
  ).length;
  const fileFailed = specs.filter(
    (s) =>
      s.spec.results?.[0]?.status === 'failed' ||
      s.spec.results?.[0]?.status === 'timedOut',
  ).length;
  return (
    <div className="rounded-2xl bg-admin-surface shadow-sm ring-1 ring-admin-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-admin-soft/50"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`size-4 text-admin-ink-soft transition ${open ? 'rotate-90' : ''}`}
          />
          <h4 className="text-sm font-bold text-admin-ink">{fileLabel}</h4>
          <span className="text-xs text-admin-ink-soft">
            ({specs.length} tests)
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {fileFailed > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-2 py-0.5 font-bold text-rose-700">
              <XCircle className="size-3" /> {fileFailed}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">
            <CheckCircle2 className="size-3" /> {filePassed}
          </span>
        </div>
      </button>
      {open && (
        <ul className="divide-y divide-admin-border">
          {specs.map((s, i) => {
            const result = s.spec.results?.[0];
            const status = result?.status ?? 'skipped';
            return (
              <li
                key={i}
                className="flex items-center justify-between gap-3 px-5 py-2 text-sm"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {status === 'passed' && (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                  )}
                  {(status === 'failed' || status === 'timedOut') && (
                    <XCircle className="size-4 shrink-0 text-rose-600" />
                  )}
                  {status === 'skipped' && (
                    <SkipForward className="size-4 shrink-0 text-amber-600" />
                  )}
                  <span
                    className={`truncate ${status === 'failed' || status === 'timedOut' ? 'font-semibold text-rose-700' : 'text-admin-ink'}`}
                  >
                    {s.describe}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-admin-ink-soft">
                  {fmtDuration(result?.duration)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
