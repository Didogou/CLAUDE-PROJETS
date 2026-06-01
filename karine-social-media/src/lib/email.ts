import 'server-only';
import { Resend } from 'resend';

/**
 * Helper d'envoi d'emails via Resend.
 *
 * Configuration requise (env vars Vercel + .env.local) :
 *   - RESEND_API_KEY  : clé API Resend (commence par re_...)
 *   - EMAIL_FROM      : adresse expéditrice. En V1 dev tu peux utiliser
 *                       'onboarding@resend.dev' (domaine par défaut Resend,
 *                       fonctionne sans vérification mais limité à ton email
 *                       Resend de test). En prod il faut vérifier ton domaine
 *                       (karine-dietetique.fr) dans le dashboard Resend et
 *                       mettre 'karine@karine-dietetique.fr'.
 *
 * Si la clé n'est pas configurée, on ne bloque PAS : on log un warning et on
 * retourne ok=false. L'appelant peut décider si c'est bloquant ou non.
 */

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

const FROM_DEFAULT = 'onboarding@resend.dev';

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  const resend = getResend();
  if (!resend) {
    console.warn(
      '[email] RESEND_API_KEY absent. Email NON envoyé:',
      JSON.stringify({ to, subject }),
    );
    return { ok: false, reason: 'RESEND_API_KEY non configuré' };
  }

  const from = process.env.EMAIL_FROM ?? FROM_DEFAULT;

  try {
    const res = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
    });
    if (res.error) {
      console.error('[email] erreur Resend:', res.error);
      return { ok: false, reason: res.error.message };
    }
    const id = res.data?.id ?? 'unknown';
    return { ok: true, id };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[email] exception:', err);
    return { ok: false, reason };
  }
}

// ============================================================
// Templates email Karine
// ============================================================

/**
 * Email envoyé à la patiente quand Karine valide sa demande d'accès.
 * Inclut la durée d'accès (6 semaines) et le lien vers l'app.
 */
export function welcomeEmailForPatient(args: {
  fullName: string | null;
  expiresAt: Date;
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const first =
    args.fullName?.split(' ')[0]?.trim() || 'à toi';
  const expDate = args.expiresAt.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const subject = `Karine Diététique — Ton accès patiente est activé 🌸`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #4b4248; background: #fdf2f4; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 16px rgba(226,120,141,0.15);">
    <h1 style="font-family: Georgia, serif; color: #c75a73; font-size: 28px; margin: 0 0 8px;">Bienvenue ${first} 💗</h1>
    <p style="font-size: 16px; line-height: 1.5;">Karine a validé ta demande d'accès patiente. Tu as maintenant un accès <strong>gratuit</strong> à toute l'application :</p>
    <ul style="font-size: 15px; line-height: 1.7; padding-left: 20px;">
      <li>Les recettes et les menus de la semaine</li>
      <li>Les conseils santé et astuces diététiques</li>
      <li>Ton menu personnalisé selon tes besoins</li>
    </ul>
    <p style="font-size: 15px;">Ton accès est valable jusqu'au <strong>${expDate}</strong> (6 semaines). Karine pourra le renouveler si nécessaire.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${args.appUrl}/login" style="display: inline-block; background: #e2788d; color: white; padding: 14px 32px; border-radius: 999px; text-decoration: none; font-weight: bold; font-size: 15px;">Me connecter</a>
    </div>
    <p style="font-size: 13px; color: #b59ea4; margin-top: 32px;">À très vite,<br />Karine 🌿</p>
  </div>
</body>
</html>
`.trim();

  const text = `Bienvenue ${first} !

Karine a validé ta demande d'accès patiente. Tu as maintenant un accès gratuit à toute l'application :
- Les recettes et les menus de la semaine
- Les conseils santé et astuces diététiques
- Ton menu personnalisé

Ton accès est valable jusqu'au ${expDate} (6 semaines).

Connecte-toi ici : ${args.appUrl}/login

À très vite,
Karine`;

  return { subject, html, text };
}

/**
 * Email envoyé à la patiente quand Karine refuse sa demande d'accès.
 * Le message de Karine (raison du refus) est inclus si fourni.
 */
export function rejectEmailForPatient(args: {
  fullName: string | null;
  comment: string;
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const first =
    args.fullName?.split(' ')[0]?.trim() || 'à toi';

  const subject = `Karine Diététique — Réponse à ta demande d'accès`;

  const commentBlock = args.comment.trim()
    ? `<blockquote style="border-left: 3px solid #e2788d; margin: 16px 0; padding: 8px 16px; background: #fdf2f4; color: #4b4248; font-style: italic;">${escapeHtml(args.comment.trim())}</blockquote>`
    : '';
  const commentText = args.comment.trim()
    ? `\n\nMessage de Karine :\n« ${args.comment.trim()} »`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #4b4248; background: #fdf2f4; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 16px rgba(226,120,141,0.15);">
    <h1 style="font-family: Georgia, serif; color: #c75a73; font-size: 26px; margin: 0 0 8px;">Bonjour ${first}</h1>
    <p style="font-size: 16px; line-height: 1.5;">Karine a examiné ta demande d'accès patiente et ne peut pas la valider pour l'instant.</p>
    ${commentBlock}
    <p style="font-size: 15px;">Tu peux toujours t'abonner à l'application pour accéder à tout le contenu :</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${args.appUrl}/mon-plan" style="display: inline-block; background: #e2788d; color: white; padding: 14px 32px; border-radius: 999px; text-decoration: none; font-weight: bold; font-size: 15px;">Voir les abonnements</a>
    </div>
    <p style="font-size: 13px; color: #b59ea4; margin-top: 32px;">Belle journée,<br />Karine 🌿</p>
  </div>
</body>
</html>
`.trim();

  const text = `Bonjour ${first},

Karine a examiné ta demande d'accès patiente et ne peut pas la valider pour l'instant.${commentText}

Tu peux toujours t'abonner à l'application pour accéder à tout le contenu : ${args.appUrl}/mon-plan

Belle journée,
Karine`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
