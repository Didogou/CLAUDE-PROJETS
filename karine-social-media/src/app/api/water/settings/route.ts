import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * PATCH /api/water/settings
 * Body : { glassSizeMl?: number, dailyWaterMl?: number }
 *
 * - glassSizeMl → user_water_settings (taille du verre par défaut)
 * - dailyWaterMl → user_nutrition_targets (objectif quotidien)
 *
 * Upsert sur user_id pour les deux tables.
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
  const glassSizeMl =
    typeof body?.glassSizeMl === 'number' && Number.isFinite(body.glassSizeMl)
      ? Math.round(body.glassSizeMl)
      : null;
  const dailyWaterMl =
    typeof body?.dailyWaterMl === 'number' && Number.isFinite(body.dailyWaterMl)
      ? Math.round(body.dailyWaterMl)
      : null;

  if (glassSizeMl === null && dailyWaterMl === null) {
    return NextResponse.json({ error: 'Aucun champ fourni' }, { status: 400 });
  }
  if (glassSizeMl !== null && (glassSizeMl <= 0 || glassSizeMl > 2000)) {
    return NextResponse.json(
      { error: 'glassSizeMl hors bornes (1-2000)' },
      { status: 400 },
    );
  }
  if (dailyWaterMl !== null && (dailyWaterMl <= 0 || dailyWaterMl > 10000)) {
    return NextResponse.json(
      { error: 'dailyWaterMl hors bornes (1-10000)' },
      { status: 400 },
    );
  }

  if (glassSizeMl !== null) {
    const { error } = await (supabase as any)
      .from('user_water_settings')
      .upsert(
        {
          user_id: user.id,
          glass_size_ml: glassSizeMl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (dailyWaterMl !== null) {
    const { error } = await (supabase as any)
      .from('user_nutrition_targets')
      .upsert(
        {
          user_id: user.id,
          daily_water_ml: dailyWaterMl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
