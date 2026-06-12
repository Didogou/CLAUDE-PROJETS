import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { rejectEmailForPatient, sendEmail } from '@/lib/email';

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => ({}));
    const comment = String(json?.comment ?? '').trim().slice(0, 1000);

    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: req } = await (supabase as any)
      .from('patient_requests')
      .select('id, user_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!req)
      return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
    if (req.status === 'rejected')
      return NextResponse.json({ error: 'Déjà refusée' }, { status: 400 });
    if (req.status === 'approved')
      return NextResponse.json(
        { error: 'Demande déjà approuvée — révoque l\'accès à la place' },
        { status: 400 },
      );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('patient_requests')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewer_comment: comment || null,
      })
      .eq('id', id);
    if (error) throw error;

    // Récup infos profil + envoi email refus (best effort)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('email, full_name')
      .eq('id', req.user_id)
      .maybeSingle();

    if (profile?.email) {
      const tpl = rejectEmailForPatient({
        fullName: profile.full_name ?? null,
        comment,
        appUrl: new URL(request.url).origin,
      });
      await sendEmail({
        to: profile.email as string,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
