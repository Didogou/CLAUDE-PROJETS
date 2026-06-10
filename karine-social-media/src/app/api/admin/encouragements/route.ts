/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';
import { getAppSettings } from '@/lib/app-settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/encouragements
 *   Retourne la liste actuelle des phrases d'encouragement
 *   groupees par categorie (debut-journee / bonne-route /
 *   objectif-atteint). Lecture depuis app_settings.
 *
 * PUT /api/admin/encouragements
 *   Body : { encouragements: { 'debut-journee': string[], ... } }
 *   Remplace integralement le JSON. Validation : chaque phrase
 *   non vide < 200 chars, max 20 par categorie.
 */

const CATEGORIES = ['debut-journee', 'bonne-route', 'objectif-atteint'] as const;
type Cat = (typeof CATEGORIES)[number];

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const settings = await getAppSettings();
  return NextResponse.json({ encouragements: settings.calorieEncouragements });
}

export async function PUT(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const enc = body?.encouragements;
  if (!enc || typeof enc !== 'object') {
    return NextResponse.json({ error: 'encouragements requis' }, { status: 400 });
  }
  // Validation par categorie
  const out: Record<Cat, string[]> = {
    'debut-journee': [],
    'bonne-route': [],
    'objectif-atteint': [],
  };
  for (const cat of CATEGORIES) {
    const arr = enc[cat];
    if (!Array.isArray(arr)) continue;
    if (arr.length > 20) {
      return NextResponse.json(
        { error: `Trop de phrases (${cat}, max 20)` },
        { status: 400 },
      );
    }
    for (const s of arr) {
      if (typeof s !== 'string') continue;
      const trim = s.trim();
      if (!trim) continue;
      if (trim.length > 200) {
        return NextResponse.json(
          { error: `Phrase trop longue (>200 chars) dans ${cat}` },
          { status: 400 },
        );
      }
      out[cat].push(trim);
    }
  }
  const supa = createServiceClient() as any;
  const { error } = await supa
    .from('app_settings')
    .update({ calorie_encouragements: out })
    .eq('id', 1);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, encouragements: out });
}
