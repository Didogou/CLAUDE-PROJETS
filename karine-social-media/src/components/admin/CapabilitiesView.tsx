'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Lightbulb,
  Leaf,
  NotebookText,
  Sparkles,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { Capability, CapabilityKey } from '@/data/capabilities';

const GROUP_META: Record<
  string,
  { icon: LucideIcon; bg: string; fg: string }
> = {
  recipes: {
    icon: UtensilsCrossed,
    bg: 'bg-coral-soft/40',
    fg: 'text-coral-dark',
  },
  weekly_menu: {
    icon: NotebookText,
    bg: 'bg-tangerine/15',
    fg: 'text-tangerine',
  },
  tips: {
    icon: Lightbulb,
    bg: 'bg-tangerine/15',
    fg: 'text-tangerine',
  },
  advice: {
    icon: Leaf,
    bg: 'bg-sage/15',
    fg: 'text-sage',
  },
  ideas: {
    icon: Sparkles,
    bg: 'bg-coral-soft/40',
    fg: 'text-coral-dark',
  },
  notifications: {
    icon: Bell,
    bg: 'bg-coral-soft/40',
    fg: 'text-coral-dark',
  },
};

export function CapabilitiesView({ initial }: { initial: Capability[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Capability[]>(initial);
  const [busy, setBusy] = useState<CapabilityKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, { groupLabel: string; items: Capability[] }>();
    for (const c of items) {
      const g = map.get(c.groupKey);
      if (g) g.items.push(c);
      else map.set(c.groupKey, { groupLabel: c.groupLabel, items: [c] });
    }
    return Array.from(map.entries()).map(([groupKey, { groupLabel, items }]) => ({
      groupKey,
      groupLabel,
      items: items.slice().sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }, [items]);

  async function toggle(key: CapabilityKey, next: boolean) {
    setBusy(key);
    setError(null);
    // Optimiste
    setItems((prev) =>
      prev.map((c) => (c.key === key ? { ...c, allowedWithoutPlan: next } : c)),
    );
    try {
      const res = await fetch('/api/admin/capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, allowed: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? 'Échec sauvegarde');
      }
    } catch (err) {
      // Rollback
      setItems((prev) =>
        prev.map((c) =>
          c.key === key ? { ...c, allowedWithoutPlan: !next } : c,
        ),
      );
      setError(err instanceof Error ? err.message : 'Erreur');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
          Aucune capacit&eacute; configur&eacute;e. Lancez la migration{' '}
          <code className="font-mono text-xs">20260602100000_capabilities.sql</code>.
        </p>
      ) : (
        groups.map(({ groupKey, groupLabel, items }) => {
          const meta = GROUP_META[groupKey] ?? GROUP_META.recipes;
          const Icon = meta.icon;
          return (
            <section
              key={groupKey}
              className="overflow-hidden rounded-2xl bg-admin-surface shadow-sm"
            >
              <header className="flex items-center gap-3 border-b border-admin-border bg-admin-soft/40 px-4 py-3">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta.bg} ${meta.fg} shadow-sm`}
                  aria-hidden
                >
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                </span>
                <h3 className="text-base font-semibold text-admin-ink">
                  {groupLabel}
                </h3>
              </header>

              <ul className="divide-y divide-admin-border">
                {items.map((c) => (
                  <li
                    key={c.key}
                    className="flex items-start gap-4 px-4 py-3 transition hover:bg-admin-soft/20"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-admin-ink">
                        {c.label}
                      </p>
                      {c.description && (
                        <p className="mt-0.5 text-xs text-admin-ink-soft">
                          {c.description}
                        </p>
                      )}
                    </div>

                    {/* Toggle iOS-style — plus parlant que checkbox */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={c.allowedWithoutPlan}
                      aria-label={`${c.label} sans plan`}
                      disabled={busy === c.key}
                      onClick={() => toggle(c.key, !c.allowedWithoutPlan)}
                      className={`relative grid h-7 w-12 shrink-0 place-items-start rounded-full px-0.5 py-0.5 transition disabled:opacity-50 ${
                        c.allowedWithoutPlan
                          ? 'bg-sage'
                          : 'bg-admin-ink-soft/30'
                      }`}
                    >
                      <span
                        className={`h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                          c.allowedWithoutPlan ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <p className="text-xs text-admin-ink-soft">
        Vert = ouvert &agrave; tout le monde. Gris = r&eacute;serv&eacute; aux
        abonn&eacute;es. Sauvegarde automatique.
      </p>
    </div>
  );
}
