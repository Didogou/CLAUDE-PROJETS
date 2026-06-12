'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  Image as ImageIcon,
  Loader2,
  Play,
  RotateCcw,
  Search,
  XCircle,
} from 'lucide-react';

type SheetRow = {
  sheetId: string;
  recipeSlug: string;
  recipeTitle: string;
  sheetIndex: number;
  sheetTitle: string | null;
  coverImageUrl: string | null;
  calories: number | null;
  defaultParseText: string;
};

type ParsedItem = {
  label: string;
  searchQuery: string;
  portions: number;
  approxGrams: number;
  baseGramsBeforeSizeHint?: number;
  match: {
    ciqualId: number;
    alimCode: number;
    name: string;
    kcalPer100g: number | null;
    proteinsG: number | null;
    lipidsG: number | null;
    carbsG: number | null;
  } | null;
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
  topCandidates?: Array<{
    ciqualId: number;
    name: string;
    kcalPer100g: number | null;
  }>;
  foodKeyword?: string;
  sizeVariability?: 'low' | 'medium' | 'high';
  sizeHint?: 'small' | 'medium' | 'large' | null;
  possibleAccompaniments?: Array<{
    name: string;
    typicalG: number;
    kcalEstimate: number;
  }>;
};

type ParseResult = {
  correctedText?: string;
  items?: ParsedItem[];
  /** Optional: raw response shape (debug). */
  [k: string]: unknown;
};

type RunState = {
  status: 'idle' | 'fetching-image' | 'describing' | 'parsing' | 'done' | 'error';
  text: string;
  customText?: string;
  /** Description retournée par Claude Vision (étape 1). */
  description?: string;
  /** Résultat parse (étape 2). */
  result?: ParseResult;
  error?: string;
  /** Durée totale pipeline (fetch + Vision + parse). */
  duration?: number;
  /** Détail des durées par étape. */
  timings?: { fetch: number; describe: number; parse: number };
};

export function RecipesMealTestView() {
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'untested' | 'errors'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [runs, setRuns] = useState<Map<string, RunState>>(new Map());

  const fetchSheets = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const r = await fetch('/api/admin/recipes-meal-test', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (r.status === 401 || r.status === 403) {
        throw new Error(
          'Session admin expirée — recharge la page ou reconnecte-toi.',
        );
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setSheets(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur de chargement';
      console.error('[recipes-meal-test] fetch failed', e);
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSheets();
  }, [fetchSheets]);

  /**
   * Pipeline complet (comme l'utilisatrice avec photo) :
   *   1. fetch l'image de la fiche depuis Supabase Storage
   *   2. POST /api/nutrition/describe-meal (Claude Vision) → description
   *   3. POST /api/nutrition/parse (Mistral + Ciqual) → items
   *
   * Si `parseTextOverride` est fourni, on saute les étapes 1+2 et on
   * relance UNIQUEMENT le parse avec ce texte. Économise les quotas
   * Vision (5/min/user) quand l'admin veut tester des variations.
   */
  async function runTest(sheet: SheetRow, parseTextOverride?: string) {
    const t0 = performance.now();
    const setRunState = (patch: Partial<RunState>) => {
      setRuns((prev) => {
        const next = new Map(prev);
        const existing = next.get(sheet.sheetId) ?? {
          status: 'idle' as const,
          text: '',
        };
        next.set(sheet.sheetId, { ...existing, ...patch });
        return next;
      });
    };

    // === MODE : relance parse uniquement (texte custom) ===
    if (parseTextOverride) {
      const txt = parseTextOverride.trim();
      if (!txt) return;
      setRunState({
        status: 'parsing',
        text: txt,
        customText: parseTextOverride,
      });
      try {
        const r = await fetch('/api/nutrition/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ text: txt }),
        });
        const data = (await r.json()) as ParseResult;
        const duration = Math.round(performance.now() - t0);
        if (!r.ok) {
          setRunState({
            status: 'error',
            error:
              r.status === 429
                ? 'Rate-limit Mistral atteint (10 parses/min). Attends ~1 min.'
                : (data as { error?: string })?.error || `HTTP ${r.status}`,
            duration,
          });
          return;
        }
        setRunState({ status: 'done', result: data, duration });
      } catch (e) {
        setRunState({
          status: 'error',
          error: e instanceof Error ? e.message : 'Erreur réseau',
          duration: Math.round(performance.now() - t0),
        });
      }
      return;
    }

    // === MODE COMPLET : image → Vision → parse ===
    if (!sheet.coverImageUrl) {
      setRunState({
        status: 'error',
        text: '',
        error: 'Pas d\'image principale pour cette fiche.',
      });
      return;
    }
    setRunState({ status: 'fetching-image', text: '' });

    // Étape 1 — Fetch l'image depuis Supabase Storage (public bucket)
    const fetchStart = performance.now();
    let blob: Blob;
    try {
      const r = await fetch(sheet.coverImageUrl, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status} sur image`);
      blob = await r.blob();
    } catch (e) {
      setRunState({
        status: 'error',
        error: `Téléchargement image impossible : ${e instanceof Error ? e.message : 'erreur'}`,
        duration: Math.round(performance.now() - t0),
      });
      return;
    }
    const fetchMs = Math.round(performance.now() - fetchStart);

    // Étape 2 — Claude Vision (describe-meal)
    setRunState({ status: 'describing' });
    const describeStart = performance.now();
    let description: string;
    try {
      const fd = new FormData();
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      fd.append('photo', blob, `sheet-${sheet.sheetId}.${ext}`);
      const r = await fetch('/api/nutrition/describe-meal', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) {
        setRunState({
          status: 'error',
          error:
            r.status === 429
              ? 'Rate-limit Vision atteint (5/min). Attends 1 min.'
              : data?.error || `HTTP ${r.status} sur Vision`,
          duration: Math.round(performance.now() - t0),
        });
        return;
      }
      description = (data?.description as string) || '';
    } catch (e) {
      setRunState({
        status: 'error',
        error: `Vision : ${e instanceof Error ? e.message : 'erreur'}`,
        duration: Math.round(performance.now() - t0),
      });
      return;
    }
    const describeMs = Math.round(performance.now() - describeStart);
    if (!description.trim()) {
      setRunState({
        status: 'error',
        description,
        error: 'Vision a renvoyé une description vide.',
        duration: Math.round(performance.now() - t0),
      });
      return;
    }

    // Étape 3 — Parse Mistral + Ciqual
    setRunState({
      status: 'parsing',
      description,
      text: description,
    });
    const parseStart = performance.now();
    try {
      const r = await fetch('/api/nutrition/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: description }),
      });
      const data = (await r.json()) as ParseResult;
      const parseMs = Math.round(performance.now() - parseStart);
      const duration = Math.round(performance.now() - t0);
      if (!r.ok) {
        setRunState({
          status: 'error',
          description,
          error:
            r.status === 429
              ? 'Rate-limit Mistral atteint (10 parses/min). Attends ~1 min.'
              : (data as { error?: string })?.error || `HTTP ${r.status}`,
          duration,
          timings: { fetch: fetchMs, describe: describeMs, parse: parseMs },
        });
        return;
      }
      setRunState({
        status: 'done',
        description,
        result: data,
        duration,
        timings: { fetch: fetchMs, describe: describeMs, parse: parseMs },
      });
    } catch (e) {
      setRunState({
        status: 'error',
        description,
        error: e instanceof Error ? e.message : 'Erreur réseau parse',
        duration: Math.round(performance.now() - t0),
      });
    }
  }

  function toggleRow(sheetId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sheetId)) next.delete(sheetId);
      else next.add(sheetId);
      return next;
    });
  }

  // Filtrage
  const filtered = useMemo(() => {
    let list = sheets;
    if (search.trim()) {
      // Combining diacritical marks via \u-escapes (portabilité encoding,
      // cf. règle projet feedback_no_powershell_set_content_source).
      const stripDiacritics = (s: string) =>
        s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
      const q = stripDiacritics(search.trim().toLowerCase());
      list = list.filter((s) => {
        const txt = stripDiacritics(
          `${s.recipeTitle ?? ''} ${s.sheetTitle ?? ''}`.toLowerCase(),
        );
        return txt.includes(q);
      });
    }
    if (filter === 'untested') {
      list = list.filter((s) => !runs.has(s.sheetId));
    }
    if (filter === 'errors') {
      list = list.filter((s) => {
        const r = runs.get(s.sheetId);
        if (!r) return false;
        if (r.status === 'error') return true;
        if (r.status === 'done') {
          const items = r.result?.items ?? [];
          if (items.length === 0) return true;
          if (items.some((it) => !it.match)) return true;
        }
        return false;
      });
    }
    return list;
  }, [sheets, search, filter, runs]);

  // Stats globales
  const stats = useMemo(() => {
    let tested = 0;
    let withErrors = 0;
    let withUnmatched = 0;
    for (const s of sheets) {
      const r = runs.get(s.sheetId);
      if (!r) continue;
      tested++;
      if (r.status === 'error') {
        withErrors++;
      } else if (r.status === 'done') {
        const items = r.result?.items ?? [];
        if (items.some((it) => !it.match)) withUnmatched++;
      }
    }
    return { tested, withErrors, withUnmatched };
  }, [sheets, runs]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-script text-3xl text-coral-dark">
            Test analyse des recettes
          </h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            Pour chaque fiche, lance l&apos;analyse comme si on
            l&apos;ajoutait à un repas (via la même logique que la photo).
          </p>
        </div>
        <button
          type="button"
          onClick={fetchSheets}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-coral-dark shadow-sm ring-1 ring-coral-soft/40 hover:bg-coral-soft/30 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          Recharger
        </button>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Fiches totales" value={sheets.length} color="text-ink" />
        <StatCard
          label="Testées"
          value={stats.tested}
          color="text-coral-dark"
        />
        <StatCard
          label="❌ Erreurs"
          value={stats.withErrors}
          color={stats.withErrors > 0 ? 'text-rose-600' : 'text-ink'}
        />
        <StatCard
          label="⚠️ Non matchés"
          value={stats.withUnmatched}
          color={stats.withUnmatched > 0 ? 'text-amber-600' : 'text-ink'}
        />
      </section>

      {/* Filtres */}
      <section className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="w-full rounded-full bg-white py-2 pl-8 pr-3 text-sm shadow-sm ring-1 ring-coral-soft/40 focus:outline-none focus:ring-2 focus:ring-coral"
          />
        </div>
        <FilterChip
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label="Toutes"
        />
        <FilterChip
          active={filter === 'untested'}
          onClick={() => setFilter('untested')}
          label="Non testées"
        />
        <FilterChip
          active={filter === 'errors'}
          onClick={() => setFilter('errors')}
          label="Erreurs / non matchés"
        />
      </section>

      {/* Erreur de chargement (401 session expirée, 500, etc.) */}
      {fetchError && (
        <div className="rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
          <p className="text-sm font-bold text-rose-700">{fetchError}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center p-10 text-ink-soft">
          <Loader2 className="mr-2 size-5 animate-spin" /> Chargement…
        </div>
      )}

      {/* Liste */}
      <section className="space-y-2">
        {filtered.length === 0 && !loading && (
          <p className="rounded-lg bg-cream p-4 text-center text-sm text-ink-soft">
            Aucune fiche ne correspond aux filtres.
          </p>
        )}
        {filtered.map((sheet) => (
          <SheetRowCard
            key={sheet.sheetId}
            sheet={sheet}
            run={runs.get(sheet.sheetId)}
            expanded={expanded.has(sheet.sheetId)}
            onToggle={() => toggleRow(sheet.sheetId)}
            onRun={(customText) => runTest(sheet, customText)}
          />
        ))}
      </section>
    </div>
  );
}

// ============================================================
// SOUS-COMPOSANTS
// ============================================================

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-coral-soft/30">
      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-ink-soft">
        {label}
      </p>
      <p className={`mt-0.5 text-2xl font-extrabold ${color}`}>{value}</p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? 'bg-coral text-white shadow-sm'
          : 'bg-white text-coral-dark ring-1 ring-coral-soft/40 hover:bg-coral-soft/30'
      }`}
    >
      {label}
    </button>
  );
}

function SheetRowCard({
  sheet,
  run,
  expanded,
  onToggle,
  onRun,
}: {
  sheet: SheetRow;
  run: RunState | undefined;
  expanded: boolean;
  onToggle: () => void;
  onRun: (customText?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(
    run?.customText ?? sheet.defaultParseText,
  );

  const status = run?.status ?? 'idle';
  const hasErrors =
    status === 'error' ||
    (status === 'done' &&
      (run?.result?.items?.length === 0 ||
        run?.result?.items?.some((it) => !it.match)));

  return (
    <article
      className={`overflow-hidden rounded-xl bg-white shadow-sm ring-1 transition ${
        hasErrors
          ? 'ring-rose-200'
          : status === 'done'
            ? 'ring-emerald-200'
            : 'ring-coral-soft/30'
      }`}
    >
      <div className="flex items-center gap-3 p-3">
        {sheet.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sheet.coverImageUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-cream">
            <ImageIcon className="size-5 text-ink-soft" />
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-ink-soft" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-ink-soft" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-ink">
              {sheet.sheetTitle || sheet.recipeTitle}
            </p>
            <p className="truncate text-xs text-ink-soft">
              {sheet.recipeTitle} · Fiche #{sheet.sheetIndex + 1}
              {sheet.calories ? ` · ${sheet.calories} kcal` : ''}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1">
          {status === 'idle' && (
            <button
              type="button"
              onClick={() => onRun()}
              disabled={!sheet.coverImageUrl}
              title={
                sheet.coverImageUrl
                  ? 'Analyser l\'image (Vision + parse)'
                  : 'Pas d\'image principale'
              }
              className="inline-flex items-center gap-1 rounded-full bg-coral px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-coral-dark disabled:opacity-40"
            >
              <Play className="size-3" /> Tester
            </button>
          )}
          {status === 'fetching-image' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1.5 text-xs font-bold text-blue-700">
              <Loader2 className="size-3 animate-spin" /> Téléchargement…
            </span>
          )}
          {status === 'describing' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-3 py-1.5 text-xs font-bold text-purple-700">
              <Loader2 className="size-3 animate-spin" /> Vision…
            </span>
          )}
          {status === 'parsing' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-700">
              <Loader2 className="size-3 animate-spin" /> Parse…
            </span>
          )}
          {status === 'done' && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${
                hasErrors
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {hasErrors ? (
                <AlertTriangle className="size-3" />
              ) : (
                <CheckCircle2 className="size-3" />
              )}
              {run?.duration ? `${run.duration}ms` : 'OK'}
            </span>
          )}
          {status === 'error' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-700">
              <XCircle className="size-3" /> Erreur
            </span>
          )}
          {(status === 'done' || status === 'error') && (
            <button
              type="button"
              onClick={() => onRun(editing ? draftText : run?.customText)}
              title="Relancer le test"
              className="grid h-7 w-7 place-items-center rounded-full text-ink-soft hover:bg-cream"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-cream/80 p-3">
          {/* Image principale qui sera analysée */}
          {sheet.coverImageUrl && (
            <div className="overflow-hidden rounded-lg ring-1 ring-coral-soft/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sheet.coverImageUrl}
                alt="Image principale de la fiche"
                className="block max-h-48 w-full object-cover"
              />
            </div>
          )}

          {/* Étape 1 — Description Vision (lecture seule) */}
          {run?.description !== undefined && (
            <div className="rounded-lg bg-purple-50 p-2.5 ring-1 ring-purple-200">
              <header className="mb-1.5 flex items-center justify-between">
                <span className="text-[0.65rem] font-bold uppercase tracking-wider text-purple-700">
                  Description Claude Vision
                  {run.timings?.describe && (
                    <span className="ml-1 text-[0.6rem] opacity-70">
                      ({run.timings.describe}ms)
                    </span>
                  )}
                </span>
              </header>
              <p className="text-sm italic text-purple-900">
                « {run.description} »
              </p>
            </div>
          )}

          {/* Étape 2 — Texte parsé (éditable pour re-tester) */}
          {(run?.text || status !== 'idle') && (
            <div className="rounded-lg bg-cream/60 p-2.5">
              <header className="mb-1.5 flex items-center justify-between">
                <span className="text-[0.65rem] font-bold uppercase tracking-wider text-ink-soft">
                  Texte passé au parse
                  {run?.timings?.parse && (
                    <span className="ml-1 text-[0.6rem] opacity-70">
                      ({run.timings.parse}ms)
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="inline-flex items-center gap-1 text-[0.65rem] font-bold text-coral-dark hover:underline"
                >
                  <Edit3 className="size-3" />
                  {editing ? 'Annuler' : 'Modifier + relancer parse seul'}
                </button>
              </header>
              {editing ? (
                <div className="space-y-1.5">
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg bg-white px-2 py-1.5 text-sm ring-1 ring-coral-soft/40 focus:outline-none focus:ring-2 focus:ring-coral"
                  />
                  <p className="text-[0.65rem] italic text-ink-soft">
                    Économise les quotas Vision : ne refait QUE le parse.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      onRun(draftText);
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-coral px-3 py-1 text-xs font-bold text-white hover:bg-coral-dark"
                  >
                    <Play className="size-3" /> Relancer parse seul
                  </button>
                </div>
              ) : (
                <p className="text-sm text-ink">
                  {run?.text || '(Vision pas encore lancée)'}
                </p>
              )}
            </div>
          )}

          {/* Total timings */}
          {run?.timings && (
            <p className="text-[0.65rem] text-ink-soft">
              ⏱ Total {run.duration}ms — fetch {run.timings.fetch}ms · vision{' '}
              {run.timings.describe}ms · parse {run.timings.parse}ms
            </p>
          )}

          {/* Erreur */}
          {status === 'error' && (
            <div className="rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
              <p className="text-sm font-bold text-rose-700">
                Erreur : {run?.error}
              </p>
            </div>
          )}

          {/* Aliments détectés */}
          {status === 'done' && run?.result && (
            <ParseResultView result={run.result} />
          )}
        </div>
      )}
    </article>
  );
}

function ParseResultView({ result }: { result: ParseResult }) {
  const items = result.items ?? [];
  const corrected = result.correctedText;

  return (
    <div className="space-y-2">
      {corrected && (
        <div className="rounded-lg bg-amber-50 p-2 text-xs ring-1 ring-amber-200">
          <span className="font-bold text-amber-700">Texte corrigé&nbsp;:</span>{' '}
          <span className="text-amber-900">{corrected}</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
          <p className="text-sm text-rose-700">
            ⚠️ Aucun aliment détecté dans ce texte.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <ItemCard key={i} item={item} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, index }: { item: ParsedItem; index: number }) {
  const [showCandidates, setShowCandidates] = useState(false);
  const hasMatch = !!item.match;

  return (
    <div
      className={`rounded-lg p-2.5 ring-1 ${
        hasMatch
          ? 'bg-emerald-50/50 ring-emerald-200'
          : 'bg-rose-50/50 ring-rose-200'
      }`}
    >
      <header className="flex items-start gap-2">
        <span
          className={`grid size-5 shrink-0 place-items-center rounded-full text-[0.6rem] font-bold ${
            hasMatch
              ? 'bg-emerald-500 text-white'
              : 'bg-rose-500 text-white'
          }`}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">{item.label}</p>
          <p className="text-[0.7rem] text-ink-soft">
            {item.portions}×{' '}
            <code className="rounded bg-white/70 px-1">{item.searchQuery}</code>{' '}
            ≈ {Math.round(item.approxGrams)} g
            {item.sizeHint && (
              <span className="ml-1 rounded bg-coral-soft/40 px-1 font-bold text-coral-dark">
                {item.sizeHint}
              </span>
            )}
          </p>
        </div>
      </header>

      {/* Match Ciqual */}
      <div className="mt-2 pl-7">
        {hasMatch ? (
          <div className="rounded bg-white p-2 text-xs ring-1 ring-emerald-200">
            <p className="flex items-center gap-1 font-bold text-emerald-700">
              <CheckCircle2 className="size-3" /> Match Ciqual
            </p>
            <p className="mt-0.5 text-ink">{item.match!.name}</p>
            <p className="mt-1 grid grid-cols-4 gap-1 text-[0.65rem] text-ink-soft">
              <span>
                <strong className="text-coral-dark">
                  {item.kcalPerPortion ?? '?'}
                </strong>{' '}
                kcal
              </span>
              <span>
                <strong>{item.proteinsPerPortion ?? '?'}</strong> g prot.
              </span>
              <span>
                <strong>{item.lipidsPerPortion ?? '?'}</strong> g lip.
              </span>
              <span>
                <strong>{item.carbsPerPortion ?? '?'}</strong> g glu.
              </span>
            </p>
          </div>
        ) : (
          <div className="rounded bg-white p-2 text-xs ring-1 ring-rose-200">
            <p className="flex items-center gap-1 font-bold text-rose-700">
              <XCircle className="size-3" /> Aucun match Ciqual
            </p>
            {item.topCandidates && item.topCandidates.length > 0 && (
              <p className="mt-1 text-ink-soft">
                {item.topCandidates.length} candidats potentiels — cliquer
                pour voir.
              </p>
            )}
          </div>
        )}

        {/* Candidats Ciqual alternatifs */}
        {item.topCandidates && item.topCandidates.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setShowCandidates((v) => !v)}
              className="text-[0.65rem] font-bold text-coral-dark hover:underline"
            >
              {showCandidates ? 'Masquer' : 'Voir'} les {item.topCandidates.length}{' '}
              candidats Ciqual
            </button>
            {showCandidates && (
              <ul className="mt-1 space-y-0.5 rounded bg-white/50 p-1.5 text-[0.7rem]">
                {item.topCandidates.map((c, ci) => (
                  <li
                    key={c.ciqualId}
                    className={`flex items-center gap-1 ${
                      ci === 0 && hasMatch
                        ? 'font-bold text-emerald-700'
                        : 'text-ink'
                    }`}
                  >
                    <span className="font-mono opacity-50">
                      #{c.ciqualId}
                    </span>{' '}
                    {c.name}
                    {c.kcalPer100g !== null && (
                      <span className="ml-auto text-[0.65rem] text-ink-soft">
                        {c.kcalPer100g} kcal/100g
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Accompagnements suggérés */}
        {item.possibleAccompaniments &&
          item.possibleAccompaniments.length > 0 && (
            <div className="mt-1.5 rounded bg-amber-50 p-1.5 text-[0.7rem] ring-1 ring-amber-200">
              <p className="font-bold text-amber-700">
                Accompagnements possibles&nbsp;:
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {item.possibleAccompaniments.map((a, ai) => (
                  <li key={ai} className="text-amber-900">
                    {a.name} — {a.typicalG} g, ≈{a.kcalEstimate} kcal
                  </li>
                ))}
              </ul>
            </div>
          )}

        {/* Variabilité de taille */}
        {item.sizeVariability && item.sizeVariability !== 'low' && (
          <p className="mt-1 text-[0.65rem] text-ink-soft">
            Taille variable&nbsp;: {item.sizeVariability}
            {item.foodKeyword && (
              <span className="ml-1 opacity-70">({item.foodKeyword})</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
