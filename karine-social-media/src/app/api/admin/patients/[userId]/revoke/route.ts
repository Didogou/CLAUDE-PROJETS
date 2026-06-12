import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

/**
 * Révoque immédiatement l'accès patient : expires_at = now().
 * On conserve le rôle 'patient' pour garder l'historique côté DB ; la
 * patiente perd l'accès via has_active_patient_access() qui devient false.
 */
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { userId } = await ctx.params;
    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('profiles')
      .update({ patient_access_expires_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
