'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  Cake,
  CreditCard,
  Croissant,
  FileText,
  Grape,
  HeartHandshake,
  Home,
  Leaf,
  Lightbulb,
  Martini,
  NotebookText,
  PartyPopper,
  Salad,
  Sandwich,
  Soup,
  Trash2,
  User,
  UtensilsCrossed,
  Zap,
} from 'lucide-react';
import { ALL_ROLES, type AppRole } from '@/data/roles';

export type PermissionRow = {
  path: string;
  label: string;
  allowedRoles: AppRole[];
  hasDbRow: boolean;
  dynamic?: boolean;
  orphan?: boolean;
};

const ROLE_LABELS: Record<AppRole, string> = {
  visitor: 'Visiteur',
  patient: 'Patiente',
  subscriber: 'Abonnée',
  admin: 'Admin',
};

const ROLE_HEADER_HUE: Record<AppRole, string> = {
  visitor: 'text-ink-soft',
  patient: 'text-coral',
  subscriber: 'text-tangerine',
  admin: 'text-admin-primary-dark',
};

/**
 * Métadonnées visuelles par page : icône + couleur de fond.
 * Aide Karine à identifier d'un coup d'œil de quoi parle chaque ligne.
 * Le matching est :
 *   1. Match exact si présent
 *   2. Sinon match ancêtre le plus long (ex. /recettes/abc → entry /recettes)
 *   3. Sinon icône par défaut FileText neutre.
 */
type PageMeta = { icon: typeof Home; bg: string; fg: string };

const PAGE_META: Record<string, PageMeta> = {
  '/': { icon: Home, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/profil': { icon: User, bg: 'bg-sage/15', fg: 'text-sage' },
  '/mon-plan': { icon: CreditCard, bg: 'bg-tangerine/15', fg: 'text-tangerine' },
  '/notifications': { icon: Bell, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/conseils': { icon: Leaf, bg: 'bg-sage/15', fg: 'text-sage' },
  '/astuces': { icon: Lightbulb, bg: 'bg-tangerine/15', fg: 'text-tangerine' },
  '/menus': { icon: NotebookText, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/recettes': { icon: UtensilsCrossed, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/recettes/petits-dejeuners': { icon: Croissant, bg: 'bg-tangerine/15', fg: 'text-tangerine' },
  '/recettes/entrees': { icon: Salad, bg: 'bg-sage/15', fg: 'text-sage' },
  '/recettes/salades': { icon: Salad, bg: 'bg-sage/15', fg: 'text-sage' },
  '/recettes/plats': { icon: UtensilsCrossed, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/recettes/aperos-dinatoires': { icon: Sandwich, bg: 'bg-tangerine/15', fg: 'text-tangerine' },
  '/recettes/desserts': { icon: Cake, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/recettes/gouters': { icon: Cake, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/recettes/boissons': { icon: Martini, bg: 'bg-sage/15', fg: 'text-sage' },
  '/recettes/sauces': { icon: Soup, bg: 'bg-tangerine/15', fg: 'text-tangerine' },
  '/recettes/repas-de-fete': { icon: PartyPopper, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/mon-menu': { icon: NotebookText, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/patientes': { icon: HeartHandshake, bg: 'bg-coral-soft/40', fg: 'text-coral-dark' },
  '/saison': { icon: Grape, bg: 'bg-sage/15', fg: 'text-sage' },
};

const DEFAULT_META: PageMeta = {
  icon: FileText,
  bg: 'bg-admin-soft/60',
  fg: 'text-admin-ink-soft',
};

function getPageMeta(path: string): PageMeta {
  if (PAGE_META[path]) return PAGE_META[path];
  // Match ancêtre le plus long : /recettes/abc → /recettes
  const parts = path.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const candidate = '/' + parts.slice(0, i).join('/');
    if (PAGE_META[candidate]) return PAGE_META[candidate];
  }
  return DEFAULT_META;
}

export function PermissionsView({ initial }: { initial: PermissionRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<PermissionRow[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(path: string, label: string, allowedRoles: AppRole[]) {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch('/api/admin/page-permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          allowedRoles,
          description: label,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Échec sauvegarde');
      }
      setRows((prev) =>
        prev.map((r) =>
          r.path === path ? { ...r, label, allowedRoles, hasDbRow: true } : r,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function removeOrphan(path: string) {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/page-permissions?path=${encodeURIComponent(path)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Échec suppression');
      }
      setRows((prev) => prev.filter((r) => r.path !== path));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  function toggleRole(path: string, role: AppRole) {
    const row = rows.find((r) => r.path === path);
    if (!row) return;
    const next = row.allowedRoles.includes(role)
      ? row.allowedRoles.filter((r) => r !== role)
      : [...row.allowedRoles, role];
    // Optimiste
    setRows((prev) =>
      prev.map((r) => (r.path === path ? { ...r, allowedRoles: next } : r)),
    );
    persist(path, row.label, next);
  }

  function commitLabel(path: string, newLabel: string) {
    const row = rows.find((r) => r.path === path);
    if (!row) return;
    if (newLabel === row.label) return; // no-op si pas de changement
    setRows((prev) =>
      prev.map((r) => (r.path === path ? { ...r, label: newLabel } : r)),
    );
    persist(path, newLabel, row.allowedRoles);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
          Aucune page d&eacute;tect&eacute;e dans <code>src/app</code>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-admin-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-admin-border bg-admin-soft/40 text-left text-xs font-semibold uppercase tracking-wide text-admin-ink-soft">
                <th className="px-4 py-3">Page</th>
                {ALL_ROLES.map((role) => (
                  <th
                    key={role}
                    className={`px-3 py-3 text-center ${ROLE_HEADER_HUE[role]}`}
                  >
                    {ROLE_LABELS[role]}
                  </th>
                ))}
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const meta = getPageMeta(row.path);
                const Icon = meta.icon;
                return (
                <tr key={row.path} className="border-b border-admin-border last:border-0">
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-start gap-3">
                      <span
                        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${meta.bg} ${meta.fg} shadow-sm`}
                        aria-hidden
                      >
                        <Icon className="h-6 w-6" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <input
                          type="text"
                          defaultValue={row.label}
                          onBlur={(e) => commitLabel(row.path, e.target.value.trim())}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          disabled={busy === row.path}
                          placeholder="Nom de la page (visible par Karine)"
                          className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-admin-ink outline-none transition focus:border-admin-primary focus:bg-white"
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-2 px-2">
                          <code className="font-mono text-xs text-admin-ink-soft">{row.path}</code>
                          {row.dynamic && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-coral-soft/40 px-2 py-0.5 text-[0.6rem] font-bold uppercase text-coral-dark">
                              <Zap className="h-3 w-3" />
                              Dynamique
                            </span>
                          )}
                          {row.orphan && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[0.6rem] font-bold uppercase text-red-700 ring-1 ring-red-200">
                              <AlertTriangle className="h-3 w-3" />
                              Orpheline
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  {ALL_ROLES.map((role) => {
                    const checked = row.allowedRoles.includes(role);
                    return (
                      <td key={role} className="px-3 py-3 align-middle text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy === row.path}
                          onChange={() => toggleRole(row.path, role)}
                          className="h-4 w-4 accent-admin-primary"
                          aria-label={`${ROLE_LABELS[role]} sur ${row.path}`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 align-middle text-right">
                    {row.orphan && (
                      <button
                        type="button"
                        onClick={() => removeOrphan(row.path)}
                        disabled={busy === row.path}
                        aria-label="Supprimer cette r&egrave;gle orpheline"
                        className="grid h-8 w-8 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-admin-ink-soft">
        {rows.length} page{rows.length > 1 ? 's' : ''} list&eacute;e
        {rows.length > 1 ? 's' : ''}. Les modifications sont sauvegard&eacute;es
        automatiquement.
      </p>
    </div>
  );
}
