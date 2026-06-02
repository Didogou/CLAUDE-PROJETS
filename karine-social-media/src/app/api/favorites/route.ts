import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import {
  addFavorite,
  removeFavorite,
} from '@/lib/favorites';
import { FAVORITE_TYPES, type FavoriteType } from '@/data/favorites';

export const runtime = 'nodejs';

function isFavType(v: unknown): v is FavoriteType {
  return typeof v === 'string' && (FAVORITE_TYPES as readonly string[]).includes(v);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }
  let payload: { targetType?: string; targetId?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }
  if (!isFavType(payload.targetType)) {
    return NextResponse.json({ error: 'targetType invalide' }, { status: 400 });
  }
  const tid = typeof payload.targetId === 'string' ? payload.targetId.trim() : '';
  if (!tid || tid.length > 200) {
    return NextResponse.json({ error: 'targetId invalide' }, { status: 400 });
  }
  const r = await addFavorite(user.id, payload.targetType, tid);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }
  const url = new URL(req.url);
  const type = url.searchParams.get('targetType');
  const id = url.searchParams.get('targetId');
  if (!isFavType(type)) {
    return NextResponse.json({ error: 'targetType invalide' }, { status: 400 });
  }
  if (!id || id.length > 200) {
    return NextResponse.json({ error: 'targetId invalide' }, { status: 400 });
  }
  const r = await removeFavorite(user.id, type, id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
  return NextResponse.json({ ok: true });
}
