import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { setUserMute, unmuteUser } from '@/lib/mutes';

export const runtime = 'nodejs';

/** POST : mute (avec raison + durée optionnelle en jours) */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id || !user.isAdmin) {
    return NextResponse.json({ error: 'Réservé à l’admin' }, { status: 403 });
  }
  let payload: { userId?: string; reason?: string; days?: number };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }
  if (!payload.userId || typeof payload.userId !== 'string') {
    return NextResponse.json({ error: 'userId requis' }, { status: 400 });
  }
  const reason =
    typeof payload.reason === 'string' && payload.reason.trim().length > 0
      ? payload.reason.trim().slice(0, 500)
      : null;
  let until: string | null = null;
  if (typeof payload.days === 'number' && payload.days > 0) {
    const d = new Date();
    d.setDate(d.getDate() + Math.floor(payload.days));
    until = d.toISOString();
  }
  const r = await setUserMute({
    userId: payload.userId,
    mutedBy: user.id,
    reason,
    until,
  });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?userId=... : unmute */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.isAdmin) {
    return NextResponse.json({ error: 'Réservé à l’admin' }, { status: 403 });
  }
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId requis' }, { status: 400 });
  }
  const r = await unmuteUser(userId);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
  return NextResponse.json({ ok: true });
}
