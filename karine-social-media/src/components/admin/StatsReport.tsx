'use client';

import { useRouter } from 'next/navigation';
import { Eye, Users, UserCheck, UserX, TrendingUp } from 'lucide-react';
import type { StatsData, StatsRange, TopItem } from '@/app/admin/(panel)/stats/page';

const RANGE_LABEL: Record<StatsRange, string> = {
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  '90d': '90 derniers jours',
  all: 'Tout',
};

const TYPE_LABEL: Record<string, string> = {
  recipe: 'Recettes',
  menu: 'Menus',
  tip: 'Astuces',
  advice: 'Conseils',
  page: 'Pages',
  '(non typé)': 'Autres',
};

export function StatsReport({ data }: { data: StatsData }) {
  const router = useRouter();

  const setRange = (range: StatsRange) => {
    router.push(`/admin/stats?range=${range}`);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-y-auto p-4">
      <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-script text-2xl text-coral-dark">Trafic & analytics</h1>
            <p className="mt-0.5 text-xs text-ink-soft">
              Données collectées en interne (table page_views). Anonymes inclus.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['7d', '30d', '90d', 'all'] as StatsRange[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  data.range === r
                    ? 'bg-coral text-white shadow-sm'
                    : 'bg-coral-soft/20 text-coral-dark hover:bg-coral-soft/40'
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        {/* Stats globales */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatBox icon={Eye} label="Vues totales" value={data.totalViews.toLocaleString('fr-FR')} color="coral" />
          <StatBox icon={Users} label="Utilisatrices uniques" value={data.uniqueUsers.toLocaleString('fr-FR')} color="sage" />
          <StatBox icon={UserCheck} label="Recettes vues" value={data.uniqueRecipes.toLocaleString('fr-FR')} color="tangerine" />
          <StatBox icon={UserCheck} label="Menus vus" value={data.uniqueMenus.toLocaleString('fr-FR')} color="sage" />
          <StatBox icon={UserX} label="Vues anonymes" value={data.anonymousViews.toLocaleString('fr-FR')} color="coral" />
        </div>
      </header>

      {/* Trafic par jour */}
      {data.daily.length > 0 && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-coral-dark" />
            <h2 className="text-sm font-bold text-coral-dark">Vues par jour</h2>
          </div>
          <DailyChart points={data.daily} />
        </section>
      )}

      {/* Distribution par type */}
      {data.pageDistribution.length > 0 && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
          <h2 className="mb-3 text-sm font-bold text-coral-dark">Distribution par type de page</h2>
          <ul className="space-y-1.5">
            {data.pageDistribution.map((p) => {
              const pct = data.totalViews > 0 ? (p.count / data.totalViews) * 100 : 0;
              return (
                <li key={p.targetType} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-ink">{TYPE_LABEL[p.targetType] ?? p.targetType}</span>
                    <span className="font-mono text-ink-soft">
                      {p.count.toLocaleString('fr-FR')} · {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-coral-soft/20">
                    <div
                      className="h-full bg-coral transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Top recettes / Top menus en 2 colonnes desktop */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopList title="🥗 Top recettes" items={data.topRecipes} hrefBase="/recettes/" emptyLabel="Aucune vue de recette sur la période." />
        <TopList title="📅 Top menus" items={data.topMenus} hrefBase="/menus/" emptyLabel="Aucune vue de menu sur la période." />
      </div>
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  color: 'sage' | 'coral' | 'tangerine';
}) {
  const bg = {
    sage: 'bg-sage/15 text-sage',
    coral: 'bg-coral/15 text-coral-dark',
    tangerine: 'bg-tangerine/15 text-tangerine',
  }[color];
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 ${bg}`}>
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      <div className="min-w-0">
        <p className="text-[0.55rem] font-bold uppercase tracking-wider opacity-80">{label}</p>
        <p className="font-mono text-sm font-bold">{value}</p>
      </div>
    </div>
  );
}

function DailyChart({ points }: { points: Array<{ date: string; total: number }> }) {
  const max = Math.max(1, ...points.map((p) => p.total));
  // Limite à ~60 derniers points pour la lisibilité visuelle
  const visible = points.slice(-60);
  return (
    <div className="flex h-32 items-end gap-px overflow-x-auto rounded-lg bg-coral-soft/5 px-1 py-2">
      {visible.map((p) => {
        const h = Math.max(2, (p.total / max) * 110);
        return (
          <div
            key={p.date}
            className="group relative flex flex-col items-center"
            title={`${p.date} · ${p.total} vues`}
          >
            <div
              className="w-2.5 rounded-t bg-coral/70 transition group-hover:bg-coral-dark"
              style={{ height: `${h}px` }}
            />
            <span className="absolute -bottom-5 hidden text-[0.55rem] font-mono text-ink-soft group-hover:block">
              {p.date.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TopList({
  title,
  items,
  hrefBase,
  emptyLabel,
}: {
  title: string;
  items: TopItem[];
  hrefBase: string;
  emptyLabel: string;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
      <h2 className="mb-3 text-sm font-bold text-coral-dark">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-lg bg-coral-soft/10 p-3 text-center text-xs italic text-ink-soft">
          {emptyLabel}
        </p>
      ) : (
        <ol className="space-y-2">
          {items.map((it, i) => {
            const paidViews = it.bySubscribers + it.byPatients;
            const paidPct =
              it.total > 0 ? Math.round((paidViews / it.total) * 100) : 0;
            return (
              <li
                key={it.targetId}
                className="flex items-center gap-3 rounded-xl border border-coral-soft/25 bg-white p-2.5 hover:bg-coral-soft/10"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-coral-soft/30 text-xs font-bold text-coral-dark">
                  {i + 1}
                </span>
                {it.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.coverImage}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-coral-soft/15" />
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={`${hrefBase}${it.targetId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-semibold text-ink hover:text-coral-dark hover:underline"
                  >
                    {it.title}
                  </a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.6rem] text-ink-soft">
                    <span className="font-mono">{it.total} vues</span>
                    <span>·</span>
                    <span className="rounded-full bg-sage/20 px-1.5 py-0.5 font-semibold text-sage">
                      {paidPct}% payant
                    </span>
                    {it.byAnonymous > 0 && (
                      <span className="rounded-full bg-ink-soft/15 px-1.5 py-0.5 font-semibold text-ink-soft">
                        Anonymes {it.byAnonymous}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
