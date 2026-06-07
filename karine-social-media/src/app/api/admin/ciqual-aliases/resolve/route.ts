import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/admin/ciqual-aliases/resolve
 *
 * Body :
 *   {
 *     alias: "côte de porc",
 *     keepCiqualId: 123 | null,   // null = on rejette TOUS les candidats
 *     rejectCiqualIds: number[],  // les autres candidats du conflit
 *   }
 *
 * Sémantique :
 *  - Pour `keepCiqualId` : passe la ligne (alias, ciqualId, status='pending')
 *    en `status='resolved'`. C'est cette ligne qui participera au scoring.
 *  - Pour chaque `rejectCiqualIds` : passe la ligne (alias, ciqualId,
 *    status='pending') en `status='rejected'`. Ces lignes restent en BDD
 *    pour historique mais ne servent plus.
 *
 * Idempotent : on n'écrase pas les lignes déjà resolved/rejected.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const alias = typeof body?.alias === 'string' ? body.alias.trim() : '';
  const keepCiqualId =
    typeof body?.keepCiqualId === 'number' ? body.keepCiqualId : null;
  const rejectCiqualIds = Array.isArray(body?.rejectCiqualIds)
    ? body.rejectCiqualIds.filter((x: unknown): x is number => typeof x === 'number')
    : [];

  if (!alias) {
    return NextResponse.json({ error: 'alias requis' }, { status: 400 });
  }
  if (keepCiqualId === null && rejectCiqualIds.length === 0) {
    return NextResponse.json(
      { error: 'Au moins un keep ou un reject requis' },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // Update KEEP en resolved
  if (keepCiqualId !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('ciqual_aliases')
      .update({ status: 'resolved' })
      .eq('alias', alias)
      .eq('ciqual_id', keepCiqualId)
      .eq('status', 'pending');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update REJECTS en rejected
  if (rejectCiqualIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('ciqual_aliases')
      .update({ status: 'rejected' })
      .eq('alias', alias)
      .in('ciqual_id', rejectCiqualIds)
      .eq('status', 'pending');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
