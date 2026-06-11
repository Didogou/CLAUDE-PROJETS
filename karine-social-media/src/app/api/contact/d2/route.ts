import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';

const DESTINATION = 'didier.chialva@gmail.com';
const MIN_MESSAGE = 5;
const MAX_MESSAGE = 2000;
const MAX_NAME = 80;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * POST /api/contact/d2
 * Body : { message, fromName? }
 *
 * Envoie un email à didier.chialva@gmail.com depuis le burger menu
 * de l'app. Pré-rempli l'email de l'utilisateur connecté (si auth)
 * dans l'email pour faciliter la réponse.
 *
 * Anti-spam V1 : auth requise (limite déjà les bots).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.email) {
    return NextResponse.json(
      { error: 'Authentification requise pour envoyer un message.' },
      { status: 401 },
    );
  }

  let payload: { message?: string; fromName?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const message =
    typeof payload.message === 'string' ? payload.message.trim() : '';
  if (message.length < MIN_MESSAGE) {
    return NextResponse.json(
      { error: 'Message trop court' },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json(
      { error: `Message trop long (max ${MAX_MESSAGE} caractères)` },
      { status: 400 },
    );
  }
  // Sanitize fromName : trim + cap length + strip CR/LF pour empêcher
  // l'injection d'en-tête email via le subject (RFC 5322).
  const fromName =
    typeof payload.fromName === 'string'
      ? payload.fromName.trim().replace(/[\r\n]+/g, ' ').slice(0, MAX_NAME)
      : '';

  const subject = `[Karine Diététique] Contact D2 — ${fromName || user.email}`;
  const messageHtml = escapeHtml(message).replace(/\n/g, '<br>');
  const html = `
    <p><strong>Nouveau message via le burger menu de l'app Karine.</strong></p>
    <ul>
      <li><strong>Auteur :</strong> ${escapeHtml(fromName || '(anonyme)')}</li>
      <li><strong>Email auth :</strong> ${escapeHtml(user.email)}</li>
      <li><strong>User ID :</strong> ${escapeHtml(user.id ?? '?')}</li>
      <li><strong>Rôle :</strong> ${escapeHtml(user.effectiveRole)}</li>
    </ul>
    <hr>
    <div style="white-space:pre-wrap;font-family:system-ui,sans-serif">${messageHtml}</div>
  `;
  const text = `Nouveau message via burger app Karine\nAuteur: ${fromName || '(anonyme)'}\nEmail: ${user.email}\nUser ID: ${user.id ?? '?'}\nRôle: ${user.effectiveRole}\n\n${message}`;

  const r = await sendEmail({
    to: DESTINATION,
    subject,
    html,
    text,
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.reason ?? 'Envoi échoué' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
