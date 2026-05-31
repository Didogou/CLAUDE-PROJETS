import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

const ACCESS_WEEKS = 6;

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: req } = await (supabase as any)
      .from('patient_requests')
      .select('id, user_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!req) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
    if (req.status !== 'pending')
      return NextResponse.json({ error: 'Demande déjà traitée' }, { status: 400 });

    const expiresAt = new Date(Date.now() + ACCESS_WEEKS * 7 * 24 * 3600 * 1000);

    // Promote user to patient + set expiry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('profiles')
      .update({
        role: 'patient',
        patient_access_expires_at: expiresAt.toISOString(),
      })
      .eq('id', req.user_id);
    if (upErr) throw upErr;

    // Mark request approved
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: reqErr } = await (supabase as any)
      .from('patient_requests')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', id);
    if (reqErr) throw reqErr;

    return NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
