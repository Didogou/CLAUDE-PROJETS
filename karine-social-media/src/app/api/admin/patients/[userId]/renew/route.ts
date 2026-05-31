import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

const ACCESS_WEEKS = 6;

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { userId } = await ctx.params;
    const supabase = createServiceClient();

    const expiresAt = new Date(Date.now() + ACCESS_WEEKS * 7 * 24 * 3600 * 1000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('profiles')
      .update({
        role: 'patient',
        patient_access_expires_at: expiresAt.toISOString(),
      })
      .eq('id', userId);
    if (error) throw error;

    return NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
