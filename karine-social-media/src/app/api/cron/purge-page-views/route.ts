import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cron RGPD : purge des vues page_views > 13 mois + anonymisation
 * progressive du referrer (apres 30 jours).
 *
 * Doit etre planifie dans vercel.json :
 *   { "path": "/api/cron/purge-page-views", "schedule": "0 3 * * *" }
 *
 * Securite : meme pattern fail-closed que daily-summary — refus si
 * CRON_SECRET absent en production.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[cron/purge-page-views] CRON_SECRET manquant — refus');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    console.warn('[cron/purge-page-views] CRON_SECRET absent (DEV ONLY)');
  } else {
    // Comparaison timing-safe (audit agent A 2026-06-12).
    const provided = Buffer.from(authHeader ?? '', 'utf8');
    const compare = Buffer.from(`Bearer ${expected}`, 'utf8');
    const ok =
      provided.length === compare.length &&
      crypto.timingSafeEqual(provided, compare);
    if (!ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const supa = createServiceClient() as any;
    const { error } = await supa.rpc('purge_old_page_views');
    if (error) {
      console.error('[cron/purge-page-views] rpc error', error.message);
      return NextResponse.json({ error: 'purge failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[cron/purge-page-views] exception', e);
    return NextResponse.json({ error: 'purge failed' }, { status: 500 });
  }
}
