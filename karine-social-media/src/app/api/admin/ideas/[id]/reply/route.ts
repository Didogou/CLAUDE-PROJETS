import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { getIdea, replyToIdea } from '@/lib/ideas';
import { createNotification } from '@/lib/notifications';
import { sendEmail, ideaReplyEmailForUser } from '@/lib/email';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id || !user.isAdmin) {
    return NextResponse.json(
      { error: 'Réservé à l’admin' },
      { status: 403 },
    );
  }

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  let payload: { reply?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }
  const reply = typeof payload.reply === 'string' ? payload.reply.trim() : '';
  if (reply.length < 1 || reply.length > 4000) {
    return NextResponse.json(
      { error: 'La réponse doit faire entre 1 et 4000 caractères' },
      { status: 400 },
    );
  }

  const idea = await getIdea(id);
  if (!idea) {
    return NextResponse.json({ error: 'Idée introuvable' }, { status: 404 });
  }
  if (idea.status === 'replied') {
    return NextResponse.json(
      { error: 'Tu as déjà répondu à cette idée. Recharge la page.' },
      { status: 409 },
    );
  }

  const updated = await replyToIdea({
    ideaId: id,
    adminId: user.id,
    reply,
  });
  if (!updated.ok) {
    return NextResponse.json({ error: updated.reason }, { status: 500 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://karine-social-media.vercel.app';

  // Notification cloche pour l'utilisatrice
  await createNotification({
    userId: idea.userId,
    type: 'idea_reply',
    payload: {
      title: `Karine a répondu : ${idea.title}`,
      body: reply.length > 140 ? reply.slice(0, 137) + '…' : reply,
      href: '/notifications',
    },
  });

  // Email (best-effort)
  if (idea.authorEmail) {
    const mail = ideaReplyEmailForUser({
      fullName: idea.authorName,
      type: idea.type,
      title: idea.title,
      reply,
      appUrl,
    });
    sendEmail({
      to: idea.authorEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }).catch((err) => {
      console.warn('[ideas-reply] email user échec:', err);
    });
  }

  return NextResponse.json({ ok: true });
}
