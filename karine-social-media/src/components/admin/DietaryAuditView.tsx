'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  Search,
  Shield,
  XCircle,
} from 'lucide-react';

type DietaryAudit = {
  effective: boolean;
  auto: boolean;
  override: boolean | null;
  blockingIngredient: string | null;
  matchedPattern: string | null;
  noIngredients: boolean;
};

type SheetAudit = {
  sheetId: string;
  sheetIndex: number;
  sheetTitle: string | null;
  ingredientsCount: number;
  audit: {
    vegetarian: DietaryAudit;
    glutenFree: DietaryAudit;
    porkFree: DietaryAudit;
  };
};

type RecipeAudit = {
  recipeId: string | number;
  slug: string;
  title: string;
  status: string;
  sheets: SheetAudit[];
};

type Report = {
  generatedAt: string;
  recipesCount: number;
  sheetsCount: number;
  recipes: RecipeAudit[];
};

type TagKind = 'vegetarian' | 'glutenFree' | 'porkFree';

const TAG_META: Record<
  TagKind,
  { label: string; shortLabel: string; activeRing: string; activeBg: string; activeText: string }
> = {
  vegetarian: {
    label: 'Végé',
    shortLabel: 'Végé',
    activeRing: 'ring-emerald-300',
    activeBg: 'bg-emerald-100',
    activeText: 'text-emerald-700',
  },
  glutenFree: {
    label: 'Sans gluten',
    shortLabel: 'Sans Glu',
    activeRing: 'ring-amber-300',
    activeBg: 'bg-amber-100',
    activeText: 'text-amber-700',
  },
  porkFree: {
    label: 'Sans porc',
    shortLabel: 'Sans porc',
    activeRing: 'ring-sky-300',
    activeBg: 'bg-sky-100',
    activeText: 'text-sky-700',
  },
};

export function DietaryAuditView() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<
    'all' | 'with-overrides' | 'no-ingredients'
  >('all');
  const [expandedRecipes, setExpandedRecipes] = useState<Set<string>>(
    new Set(),
  );

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/recipes-dietary-audit', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const toggleRecipe = (slug: string) => {
    setExpandedRecipes((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  // === Filtrage ===
  const filteredRecipes = (report?.recipes ?? []).filter((r) => {
    if (search.trim()) {
      const q = search
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      const t = r.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      if (!t.includes(q)) return false;
    }
    if (filter === 'with-overrides') {
      const hasOverride = r.sheets.some((s) =>
        Object.values(s.audit).some((a) => a.override !== null),
      );
      if (!hasOverride) return false;
    }
    if (filter === 'no-ingredients') {
      const hasNoIng = r.sheets.some((s) => s.ingredientsCount === 0);
      if (!hasNoIng) return false;
    }
    return true;
  });

  // === Stats globales ===
  const stats = computeStats(report?.recipes ?? []);

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-script text-3xl text-coral-dark">
            Vérification des labels diététiques
          </h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            Contrôle pour chaque fiche détaillée : labels affichés aux
            utilisatrices + raison pour laquelle ils s'appliquent.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchReport}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-coral-dark shadow-sm ring-1 ring-coral-soft/40 hover:bg-coral-soft/30 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          Rafraîchir
        </button>
      </header>

      {/* Stats */}
      {report && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Recettes"
            value={report.recipesCount}
            color="text-ink"
          />
          <StatCard
            label="Fiches détaillées"
            value={report.sheetsCount}
            color="text-ink"
          />
          <StatCard
            label="Overrides admin"
            value={stats.overridesCount}
            color="text-purple-600"
            tooltip="Nb. d'overrides explicites (Karine a forcé un tag)"
          />
          <StatCard
            label="⚠️ Sans ingrédients"
            value={stats.noIngredientsCount}
            color={stats.noIngredientsCount > 0 ? 'text-rose-600' : 'text-ink'}
            tooltip="Fiches sans ingrédients = aucun tag possible"
          />
        </section>
      )}

      {/* Filtres */}
      <section className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une recette…"
            className="w-full rounded-full bg-white py-2 pl-8 pr-3 text-sm shadow-sm ring-1 ring-coral-soft/40 focus:outline-none focus:ring-2 focus:ring-coral"
          />
        </div>
        <FilterChip
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label="Toutes"
        />
        <FilterChip
          active={filter === 'with-overrides'}
          onClick={() => setFilter('with-overrides')}
          label="Avec override admin"
        />
        <FilterChip
          active={filter === 'no-ingredients'}
          onClick={() => setFilter('no-ingredients')}
          label="Sans ingrédients"
        />
      </section>

      {/* Erreur */}
      {error && (
        <div className="rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && !report && (
        <div className="flex items-center justify-center p-10 text-ink-soft">
          <Loader2 className="mr-2 size-5 animate-spin" />
          Chargement de l'audit…
        </div>
      )}

      {/* Liste des recettes */}
      {report && (
        <section className="space-y-2">
          {filteredRecipes.length === 0 && (
            <p className="rounded-lg bg-cream p-4 text-center text-sm text-ink-soft">
              Aucune recette ne correspond aux filtres.
            </p>
          )}
          {filteredRecipes.map((recipe) => (
            <RecipeBlock
              key={recipe.slug}
              recipe={recipe}
              expanded={expandedRecipes.has(recipe.slug)}
              onToggle={() => toggleRecipe(recipe.slug)}
            />
          ))}
        </section>
      )}
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
  tooltip,
}: {
  label: string;
  value: number;
  color: string;
  tooltip?: string;
}) {
  return (
    <div
      title={tooltip}
      className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-coral-soft/30"
    >
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

function RecipeBlock({
  recipe,
  expanded,
  onToggle,
}: {
  recipe: RecipeAudit;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Agrégation au niveau recette : toutes les sheets doivent être OK
  const agg = (kind: TagKind): boolean =>
    recipe.sheets.length > 0 &&
    recipe.sheets.every((s) => s.audit[kind].effective);

  return (
    <article className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-coral-soft/30">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-cream/50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-ink-soft" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-ink-soft" />
          )}
          <span className="truncate font-bold text-ink">{recipe.title}</span>
          <span className="shrink-0 rounded-full bg-cream px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-ink-soft">
            {recipe.sheets.length} fiche{recipe.sheets.length > 1 ? 's' : ''}
          </span>
          {recipe.status !== 'published' && (
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-amber-700">
              {recipe.status}
            </span>
          )}
        </div>
        {/* Mini-pastilles agrégées (toutes sheets confondues) */}
        <div className="flex shrink-0 items-center gap-1">
          <TagPill kind="vegetarian" active={agg('vegetarian')} compact />
          <TagPill kind="glutenFree" active={agg('glutenFree')} compact />
          <TagPill kind="porkFree" active={agg('porkFree')} compact />
        </div>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-cream/80 p-3">
          {recipe.sheets.length === 0 && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              ⚠️ Cette recette n'a aucune fiche détaillée → aucun label
              affichable.
            </p>
          )}
          {recipe.sheets.map((sheet) => (
            <SheetRow key={sheet.sheetId} sheet={sheet} />
          ))}
        </div>
      )}
    </article>
  );
}

function SheetRow({ sheet }: { sheet: SheetAudit }) {
  return (
    <div className="rounded-lg bg-cream/60 p-2.5">
      <header className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">
          Fiche #{sheet.sheetIndex + 1}
          {sheet.sheetTitle && (
            <span className="ml-1 text-ink-soft">— {sheet.sheetTitle}</span>
          )}
        </p>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold uppercase ${
            sheet.ingredientsCount === 0
              ? 'bg-rose-100 text-rose-700'
              : 'bg-white text-ink-soft'
          }`}
        >
          {sheet.ingredientsCount} ingrédient
          {sheet.ingredientsCount > 1 ? 's' : ''}
        </span>
      </header>
      <div className="grid gap-2 sm:grid-cols-3">
        <TagAuditCard kind="vegetarian" audit={sheet.audit.vegetarian} />
        <TagAuditCard kind="glutenFree" audit={sheet.audit.glutenFree} />
        <TagAuditCard kind="porkFree" audit={sheet.audit.porkFree} />
      </div>
    </div>
  );
}

function TagPill({
  kind,
  active,
  compact = false,
}: {
  kind: TagKind;
  active: boolean;
  compact?: boolean;
}) {
  const meta = TAG_META[kind];
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-tight ring-1 transition ${
        active
          ? `${meta.activeBg} ${meta.activeText} ${meta.activeRing}`
          : 'bg-white/60 text-ink-soft/50 ring-coral-soft/30'
      }`}
      title={active ? `${meta.label} OK` : `Pas ${meta.label.toLowerCase()}`}
    >
      {!active && <Ban className="size-2 shrink-0 opacity-50" strokeWidth={2.5} />}
      {compact ? meta.shortLabel : meta.label}
    </span>
  );
}

function TagAuditCard({ kind, audit }: { kind: TagKind; audit: DietaryAudit }) {
  const meta = TAG_META[kind];
  const baseClass = audit.effective
    ? `${meta.activeBg} ${meta.activeText} ${meta.activeRing}`
    : 'bg-white text-ink-soft ring-rose-200';
  const Icon = audit.effective ? CheckCircle2 : XCircle;
  const iconClass = audit.effective ? meta.activeText : 'text-rose-500';

  return (
    <div className={`rounded-lg p-2 ring-1 ${baseClass}`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`size-4 shrink-0 ${iconClass}`} />
        <p className="text-xs font-bold uppercase tracking-wide">
          {meta.label}
        </p>
      </div>
      <div className="mt-1.5 space-y-1 text-[0.7rem] leading-snug">
        {/* Cas 1 : override admin */}
        {audit.override !== null && (
          <p className="flex items-start gap-1">
            <Shield className="mt-0.5 size-3 shrink-0 text-purple-600" />
            <span>
              <strong>Override admin :</strong> forcé{' '}
              {audit.override ? 'à OUI' : 'à NON'}
              {audit.auto !== audit.override && (
                <span className="ml-0.5 text-purple-700">
                  {' '}
                  (auto-détection aurait dit{' '}
                  <em>{audit.auto ? 'oui' : 'non'}</em>)
                </span>
              )}
            </span>
          </p>
        )}

        {/* Cas 2 : pas d'ingrédients */}
        {audit.noIngredients && (
          <p className="flex items-start gap-1 text-rose-700">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>
              <strong>Aucun ingrédient</strong> sur cette fiche → impossible de
              détecter automatiquement.
            </span>
          </p>
        )}

        {/* Cas 3 : ingrédient bloquant (auto false) */}
        {!audit.noIngredients && !audit.auto && audit.blockingIngredient && (
          <p className="text-rose-700">
            <strong>Bloqué par&nbsp;:</strong>{' '}
            <code className="rounded bg-white/70 px-1 py-0.5 text-[0.65rem]">
              {audit.blockingIngredient}
            </code>
            {audit.matchedPattern && (
              <span className="ml-1 text-[0.6rem] opacity-60">
                (motif <code>{audit.matchedPattern}</code>)
              </span>
            )}
          </p>
        )}

        {/* Cas 4 : auto OK */}
        {!audit.noIngredients && audit.auto && audit.override === null && (
          <p>
            ✓ Aucun ingrédient incompatible détecté automatiquement.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// HELPERS
// ============================================================

function computeStats(recipes: RecipeAudit[]) {
  let overridesCount = 0;
  let noIngredientsCount = 0;
  for (const r of recipes) {
    for (const s of r.sheets) {
      if (s.ingredientsCount === 0) noIngredientsCount++;
      for (const k of ['vegetarian', 'glutenFree', 'porkFree'] as const) {
        if (s.audit[k].override !== null) overridesCount++;
      }
    }
  }
  return { overridesCount, noIngredientsCount };
}
