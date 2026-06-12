import { NextResponse, type NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email';
import { getAdminEmail, getRelanceCooldownDays } from '@/lib/patients';

/**
 * Création d'une demande d'accès patient par l'utilisateur connecté.
 *
 * 3 cas selon l'état :
 *  - Patient actif (expires_at > now) → refuse
 *  - Demande pending existe → on n'en crée PAS de nouvelle : on incrémente
 *    reminder_count + on notifie Karine. UX patiente : message "Karine a
 *    été notifiée, elle te répondra bientôt"
 *  - Sinon → nouvelle demande pending créée
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const json = await request.json().catch(() => ({}));
    const message = String(json?.message ?? '').trim().slice(0, 1000);

    const service = createServiceClient();

    // Cas 1 : déjà patient actif
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (service as any)
      .from('profiles')
      .select('role, patient_access_expires_at, full_name, email')
      .eq('id', user.id)
      .maybeSingle();
    if (
      profile?.role === 'patient' &&
      profile.patient_access_expires_at &&
      new Date(profile.patient_access_expires_at as string) > new Date()
    ) {
      return NextResponse.json(
        { error: 'Vous avez déjà un accès patiente actif' },
        { status: 400 },
      );
    }

    // Cas 2 : demande pending existe → check cooldown + incrément reminder + notif Karine
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (service as any)
      .from('patient_requests')
      .select('id, reminder_count, created_at, last_reminder_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Check cooldown : on prend max(created_at, last_reminder_at) comme
      // dernière action et on vérifie qu'il s'est écoulé au moins N jours.
      const cooldownDays = await getRelanceCooldownDays();
      if (cooldownDays > 0) {
        const created = new Date(existing.created_at as string);
        const lastRem = existing.last_reminder_at
          ? new Date(existing.last_reminder_at as string)
          : null;
        const lastAction = lastRem && lastRem > created ? lastRem : created;
        const elapsedMs = Date.now() - lastAction.getTime();
        const remainingMs = cooldownDays * 24 * 3600 * 1000 - elapsedMs;
        if (remainingMs > 0) {
          const remainingDays = Math.ceil(remainingMs / (24 * 3600 * 1000));
          return NextResponse.json(
            {
              error: `Tu pourras relancer Karine dans ${remainingDays} jour${remainingDays > 1 ? 's' : ''}.`,
              cooldownRemainingDays: remainingDays,
            },
            { status: 429 },
          );
        }
      }

      const nextCount = (existing.reminder_count ?? 0) + 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any)
        .from('patient_requests')
        .update({
          reminder_count: nextCount,
          last_reminder_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      // Notif Karine (best effort, on ne bloque pas la réponse)
      const userName =
        (profile?.full_name as string | null) ||
        user.email ||
        'Une patiente';
      const userEmail = user.email ?? (profile?.email as string | null) ?? '';
      await sendEmail({
        to: getAdminEmail(),
        subject: `Relance demande patiente — ${userName}`,
        html: `<p><strong>${userName}</strong> (${userEmail}) a relancé sa demande d'accès patiente. C'est sa ${nextCount}<sup>e</sup> relance.</p><p>Va sur l'admin pour valider ou refuser : <a href="${appUrl(request)}/admin/patientes">/admin/patientes</a></p>${message ? `<p>Message ajouté : « ${escapeForEmail(message)} »</p>` : ''}`,
        text: `${userName} (${userEmail}) a relancé sa demande d'accès patiente. C'est sa ${nextCount}e relance.\n\nVa sur l'admin : ${appUrl(request)}/admin/patientes${message ? `\n\nMessage ajouté : « ${message} »` : ''}`,
      });

      return NextResponse.json({
        ok: true,
        reminder: true,
        message:
          'Une demande est déjà en attente. Karine vient d\'être notifiée à nouveau, elle te répondra bientôt.',
      });
    }

    // Cas 3 : nouvelle demande
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from('patient_requests')
      .insert({ user_id: user.id, message, status: 'pending' });
    if (error) throw error;

    // Notif Karine pour la nouvelle demande (best effort)
    const userName =
      (profile?.full_name as string | null) || user.email || 'Une patiente';
    const userEmail = user.email ?? (profile?.email as string | null) ?? '';
    await sendEmail({
      to: getAdminEmail(),
      subject: `Nouvelle demande patiente — ${userName}`,
      html: `<p><strong>${userName}</strong> (${userEmail}) demande un accès patiente.</p>${message ? `<p>Message : « ${escapeForEmail(message)} »</p>` : ''}<p>Valide ou refuse depuis l'admin : <a href="${appUrl(request)}/admin/patientes">/admin/patientes</a></p>`,
      text: `${userName} (${userEmail}) demande un accès patiente.${message ? `\n\nMessage : « ${message} »` : ''}\n\nValide ou refuse depuis l'admin : ${appUrl(request)}/admin/patientes`,
    });

    return NextResponse.json({ ok: true, reminder: false });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function appUrl(request: NextRequest): string {
  return new URL(request.url).origin;
}

function escapeForEmail(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
