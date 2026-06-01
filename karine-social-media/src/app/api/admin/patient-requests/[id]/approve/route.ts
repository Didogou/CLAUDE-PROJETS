import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { sendEmail, welcomeEmailForPatient } from '@/lib/email';

const ACCESS_WEEKS = 6;

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
    if (!req) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
    // On autorise approve depuis pending OU rejected (Karine peut changer d'avis)
    if (req.status === 'approved')
      return NextResponse.json({ error: 'Déjà validée' }, { status: 400 });

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

    // Mark request approved + commentaire
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: reqErr } = await (supabase as any)
      .from('patient_requests')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewer_comment: comment || null,
      })
      .eq('id', id);
    if (reqErr) throw reqErr;

    // Récup infos profil pour le mail bienvenue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('email, full_name')
      .eq('id', req.user_id)
      .maybeSingle();

    if (profile?.email) {
      const tpl = welcomeEmailForPatient({
        fullName: profile.full_name ?? null,
        expiresAt,
        appUrl: new URL(request.url).origin,
      });
      // Best effort : ne pas bloquer si l'email échoue
      await sendEmail({
        to: profile.email as string,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    }

    return NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
