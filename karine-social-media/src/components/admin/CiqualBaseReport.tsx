'use client';

import { useMemo, useState } from 'react';
import { Search, Sparkles, ImageOff, Tag, AlertCircle } from 'lucide-react';
import type { CiqualBaseEntry } from '@/app/admin/(panel)/recettes/ciqual-base/page';

/**
 * Rapport admin de la base Ciqual EFFECTIVEMENT utilisée par Karine
 * et ses abonnées. Lecture seule pour la V1.
 *
 * Vue par groupe (accordéon) avec stats globales en tête + search.
 * Chaque ligne montre : image, nom, poids unitaire + source, alias,
 * compteurs d'usage (recettes / menus / scans utilisateurs).
 */
export function CiqualBaseReport({
  entries,
  totalCiqual,
}: {
  entries: CiqualBaseEntry[];
  totalCiqual: number;
}) {
  const [q, setQ] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // Stats globales
  const stats = useMemo(() => {
    const withWeight = entries.filter((e) => e.avgUnitWeightG !== null).length;
    const withImage = entries.filter((e) => e.imageUrl).length;
    const withAlias = entries.filter((e) => e.aliases.length > 0).length;
    const mistral = entries.filter((e) => e.avgUnitWeightSource === 'mistral').length;
    const karine = entries.filter((e) => e.avgUnitWeightSource === 'karine').length;
    return { withWeight, withImage, withAlias, mistral, karine };
  }, [entries]);

  // Groupes
  const groups = useMemo(() => {
    const map = new Map<string, CiqualBaseEntry[]>();
    const needle = q.trim().toLowerCase();
    for (const e of entries) {
      if (needle) {
        const hay = (
          e.name +
          ' ' +
          (e.groupName ?? '') +
          ' ' +
          e.aliases.join(' ')
        ).toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      const g = e.groupName ?? '(sans groupe)';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries, q]);

  // Auto-ouverture des groupes quand on recherche
  const isSearching = q.trim().length > 0;
  const groupIsOpen = (g: string) => isSearching || openGroups.has(g);
  const toggleGroup = (g: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4">
      {/* Stats en tête */}
      <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
        <h1 className="font-script text-2xl text-coral-dark">Base Ciqual utilisée</h1>
        <p className="mt-0.5 text-xs text-ink-soft">
          {entries.length} aliments référencés dans tes recettes, menus et scans abonnées
          {' '}(sur {totalCiqual.toLocaleString('fr-FR')} dans Ciqual total).
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatBox label="Avec poids" value={stats.withWeight} total={entries.length} color="sage" />
          <StatBox label="Avec image" value={stats.withImage} total={entries.length} color="coral" />
          <StatBox label="Avec alias" value={stats.withAlias} total={entries.length} color="tangerine" />
          <StatBox label="Poids Mistral" value={stats.mistral} total={entries.length} color="sage" />
          <StatBox label="Poids Karine" value={stats.karine} total={entries.length} color="coral" />
        </div>
      </header>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher par nom, groupe ou alias…"
          className="w-full rounded-full border border-coral-soft/30 bg-white py-2 pl-10 pr-4 text-sm focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral-soft/40"
        />
      </div>

      {/* Groupes */}
      <div className="flex-1 overflow-y-auto rounded-2xl bg-white p-2 shadow-sm ring-1 ring-coral-soft/30">
        {groups.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-soft">
            Aucun aliment ne correspond.
          </div>
        ) : (
          groups.map(([groupName, items]) => (
            <section key={groupName} className="border-b border-coral-soft/15 last:border-b-0">
              <button
                type="button"
                onClick={() => toggleGroup(groupName)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-coral-soft/10"
              >
                <span className="text-sm font-semibold text-coral-dark">
                  {groupName}
                </span>
                <span className="rounded-full bg-coral-soft/30 px-2 py-0.5 text-xs font-bold text-coral-dark">
                  {items.length}
                </span>
              </button>
              {groupIsOpen(groupName) && (
                <ul className="space-y-1.5 px-2 pb-3">
                  {items.map((e) => (
                    <li key={e.id}>
                      <EntryCard entry={e} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: 'sage' | 'coral' | 'tangerine';
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const bg = {
    sage: 'bg-sage/15 text-sage',
    coral: 'bg-coral/15 text-coral-dark',
    tangerine: 'bg-tangerine/15 text-tangerine',
  }[color];
  return (
    <div className={`rounded-xl px-3 py-2 ${bg}`}>
      <p className="text-[0.6rem] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="font-mono text-sm font-bold">
        {value} <span className="text-[0.65rem] opacity-70">({pct}%)</span>
      </p>
    </div>
  );
}

function EntryCard({ entry }: { entry: CiqualBaseEntry }) {
  return (
    <article className="flex gap-3 rounded-xl border border-coral-soft/25 bg-white p-3 hover:bg-coral-soft/10">
      {/* Image */}
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-coral-soft/15">
        {entry.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.imageUrl}
            alt={entry.name}
            className="h-14 w-14 rounded-lg object-cover"
          />
        ) : (
          <ImageOff className="h-6 w-6 text-coral-dark/30" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* Nom + sous-groupe */}
        <p className="text-sm font-semibold text-ink">{entry.name}</p>
        {entry.subgroupName && (
          <p className="text-[0.65rem] italic text-ink-soft">{entry.subgroupName}</p>
        )}

        {/* Badges : poids + aliases */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <WeightBadge entry={entry} />
          {entry.aliases.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-tangerine/15 px-2 py-0.5 text-[0.6rem] font-semibold text-tangerine">
              <Tag className="h-2.5 w-2.5" />
              {entry.aliases.length} alias
            </span>
          )}
        </div>

        {/* Liste des alias quand peu nombreux */}
        {entry.aliases.length > 0 && entry.aliases.length <= 4 && (
          <p className="mt-1 text-[0.65rem] italic text-ink-soft line-clamp-1">
            {entry.aliases.join(' · ')}
          </p>
        )}

        {/* Usage */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.6rem]">
          {entry.usage.recipes > 0 && (
            <UsageBadge label={`Recettes · ${entry.usage.recipes}`} color="coral" />
          )}
          {entry.usage.menus > 0 && (
            <UsageBadge label={`Menus · ${entry.usage.menus}`} color="sage" />
          )}
          {entry.usage.userScans > 0 && (
            <UsageBadge label={`Scans · ${entry.usage.userScans}`} color="tangerine" />
          )}
        </div>
      </div>
    </article>
  );
}

function WeightBadge({ entry }: { entry: CiqualBaseEntry }) {
  if (entry.avgUnitWeightG === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-soft/10 px-2 py-0.5 text-[0.6rem] font-semibold text-ink-soft">
        <AlertCircle className="h-2.5 w-2.5" />
        Sans poids unitaire
      </span>
    );
  }
  const isKarine = entry.avgUnitWeightSource === 'karine';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold ${
        isKarine ? 'bg-coral/15 text-coral-dark' : 'bg-sage/15 text-sage'
      }`}
    >
      <Sparkles className="h-2.5 w-2.5" />
      {entry.avgUnitWeightG} g/unité {isKarine ? '(Karine)' : '(Mistral)'}
    </span>
  );
}

function UsageBadge({
  label,
  color,
}: {
  label: string;
  color: 'sage' | 'coral' | 'tangerine';
}) {
  const bg = {
    sage: 'bg-sage/20 text-sage',
    coral: 'bg-coral/20 text-coral-dark',
    tangerine: 'bg-tangerine/20 text-tangerine',
  }[color];
  return (
    <span className={`rounded-full px-2 py-0.5 font-semibold ${bg}`}>
      {label}
    </span>
  );
}
