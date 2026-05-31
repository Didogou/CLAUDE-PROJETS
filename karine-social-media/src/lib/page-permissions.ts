import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { AppRole, PagePermission } from '@/data/roles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): PagePermission {
  return {
    path: row.path,
    allowedRoles: (row.allowed_roles ?? []) as AppRole[],
    description: row.description ?? null,
    updatedAt: row.updated_at,
  };
}

export async function getAllPagePermissions(): Promise<PagePermission[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('page_permissions')
    .select('*')
    .order('path');
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRow);
}

/**
 * Cherche la règle de permission la PLUS spécifique pour un chemin donné.
 * (variante côté serveur du même algo que dans lib/supabase/middleware.ts)
 */
export async function findPermissionForPath(
  path: string,
): Promise<PagePermission | null> {
  const supabase = createServiceClient();
  const candidates = expandPath(path);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('page_permissions')
    .select('*')
    .in('path', candidates);
  if (error) {
    console.error('[findPermissionForPath]', error);
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data ?? []) as any[]).map(mapRow);
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.path.length - a.path.length);
  return rows[0];
}

function expandPath(path: string): string[] {
  const clean = path.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  const parts = clean.split('/').filter(Boolean);
  const out: string[] = [clean];
  for (let i = parts.length - 1; i >= 1; i--) {
    out.push('/' + parts.slice(0, i).join('/'));
  }
  if (!out.includes('/')) out.push('/');
  return out;
}
