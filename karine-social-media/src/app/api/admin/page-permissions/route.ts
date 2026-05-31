import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { ALL_ROLES } from '@/data/roles';
import { getAllPagePermissions } from '@/lib/page-permissions';

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const permissions = await getAllPagePermissions();
    return NextResponse.json({ permissions });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Upsert (create or update) d'une règle de permission pour un chemin.
 * Body : { path: string, allowedRoles: string[], description?: string }
 */
export async function PUT(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const json = await request.json();
    const path = String(json?.path ?? '').trim();
    const allowedRoles = Array.isArray(json?.allowedRoles) ? json.allowedRoles : [];
    const description = json?.description ? String(json.description).trim() : null;

    if (!path.startsWith('/'))
      return NextResponse.json(
        { error: 'Le chemin doit commencer par /' },
        { status: 400 },
      );

    const valid = (allowedRoles as string[]).every((r) =>
      (ALL_ROLES as readonly string[]).includes(r),
    );
    if (!valid)
      return NextResponse.json({ error: 'Rôle inconnu' }, { status: 400 });

    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('page_permissions')
      .upsert(
        { path, allowed_roles: allowedRoles, description },
        { onConflict: 'path' },
      );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Supprime la règle de permission d'un chemin (revient au défaut ouvert).
 * Body : { path: string }
 */
export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');
    if (!path) return NextResponse.json({ error: 'path requis' }, { status: 400 });

    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('page_permissions')
      .delete()
      .eq('path', path);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
