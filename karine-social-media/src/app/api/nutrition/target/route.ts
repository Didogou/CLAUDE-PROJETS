import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * PATCH /api/nutrition/target
 * Body : { dailyKcal?: number, dailyWaterMl?: number }
 *
 * Met à jour l'objectif quotidien de l'abonnée connectée.
 * Crée la ligne user_nutrition_targets si absente (upsert).
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const dailyKcal =
    typeof body?.dailyKcal === 'number' && Number.isFinite(body.dailyKcal)
      ? Math.round(body.dailyKcal)
      : null;
  const dailyWaterMl =
    typeof body?.dailyWaterMl === 'number' && Number.isFinite(body.dailyWaterMl)
      ? Math.round(body.dailyWaterMl)
      : null;

  if (dailyKcal === null && dailyWaterMl === null) {
    return NextResponse.json(
      { error: 'Au moins un champ requis (dailyKcal, dailyWaterMl)' },
      { status: 400 },
    );
  }
  if (dailyKcal !== null && (dailyKcal <= 0 || dailyKcal > 10000)) {
    return NextResponse.json({ error: 'dailyKcal hors bornes (1-10000)' }, { status: 400 });
  }
  if (dailyWaterMl !== null && (dailyWaterMl <= 0 || dailyWaterMl > 10000)) {
    return NextResponse.json(
      { error: 'dailyWaterMl hors bornes (1-10000)' },
      { status: 400 },
    );
  }

  const payload: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };
  if (dailyKcal !== null) payload.daily_kcal = dailyKcal;
  if (dailyWaterMl !== null) payload.daily_water_ml = dailyWaterMl;

  const { error } = await (supabase as any)
    .from('user_nutrition_targets')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
