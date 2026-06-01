import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { createIdea } from '@/lib/ideas';
import { sendEmail, ideaSubmissionEmailForAdmin } from '@/lib/email';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const VALID_TYPES = ['recette', 'astuce', 'question'] as const;
type Type = (typeof VALID_TYPES)[number];

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    return NextResponse.json(
      { error: 'Authentification requise' },
      { status: 401 },
    );
  }

  let payload: { type?: string; title?: string; body?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'JSON invalide' },
      { status: 400 },
    );
  }

  const type = payload.type as Type | undefined;
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: 'Type invalide (recette, astuce, question)' },
      { status: 400 },
    );
  }
  if (title.length < 1 || title.length > 160) {
    return NextResponse.json(
      { error: 'Le titre doit faire entre 1 et 160 caractères' },
      { status: 400 },
    );
  }
  if (body.length < 1 || body.length > 4000) {
    return NextResponse.json(
      { error: 'Le contenu doit faire entre 1 et 4000 caractères' },
      { status: 400 },
    );
  }

  const created = await createIdea({
    userId: user.id,
    type,
    title,
    body,
  });
  if (!created.ok) {
    return NextResponse.json(
      { error: created.reason },
      { status: 500 },
    );
  }

  // Email à Karine (best-effort). On ne bloque pas la réponse si Resend down.
  const adminTo = process.env.EMAIL_TO_ADMIN;
  if (adminTo) {
    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('email, full_name')
      .eq('id', user.id)
      .maybeSingle();
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? 'https://karine-social-media.vercel.app';
    const mail = ideaSubmissionEmailForAdmin({
      authorEmail: profile?.email ?? user.email ?? 'inconnue',
      authorName: profile?.full_name ?? null,
      type,
      title,
      body,
      appUrl,
    });
    sendEmail({
      to: adminTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }).catch((err) => {
      console.warn('[ideas] email admin échec:', err);
    });
  }

  return NextResponse.json({ ok: true, idea: created.idea });
}
