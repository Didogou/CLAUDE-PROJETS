import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/nutrition/metrics
 *
 * Retourne les daily_metrics du jour de l'utilisatrice (kcal_burned,
 * weight_kg, summary_text si déjà généré).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const { data } = await (supabase as any)
    .from('daily_metrics')
    .select('kcal_burned, weight_kg, karine_tip, karine_tip_at')
    .eq('user_id', user.id)
    .eq('date', dateStr)
    .maybeSingle();

  return NextResponse.json({
    metrics: {
      kcalBurned: Number(data?.kcal_burned ?? 0),
      weightKg: data?.weight_kg !== null && data?.weight_kg !== undefined
        ? Number(data.weight_kg)
        : null,
      karineTip: data?.karine_tip ?? null,
      karineTipAt: data?.karine_tip_at ?? null,
    },
  });
}

/**
 * PATCH /api/nutrition/metrics
 * Body : { kcalBurned?: number, weightKg?: number }
 *
 * Upsert daily_metrics du jour.
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
  const kcalBurned =
    typeof body?.kcalBurned === 'number' && Number.isFinite(body.kcalBurned)
      ? Math.max(0, Math.min(10000, Math.round(body.kcalBurned)))
      : null;
  const weightKg =
    typeof body?.weightKg === 'number' && Number.isFinite(body.weightKg)
      ? Math.max(0.1, Math.min(500, body.weightKg))
      : null;

  if (kcalBurned === null && weightKg === null) {
    return NextResponse.json({ error: 'Aucun champ fourni' }, { status: 400 });
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const payload: Record<string, unknown> = {
    user_id: user.id,
    date: dateStr,
    updated_at: new Date().toISOString(),
  };
  if (kcalBurned !== null) payload.kcal_burned = kcalBurned;
  if (weightKg !== null) payload.weight_kg = weightKg;

  const { error } = await (supabase as any)
    .from('daily_metrics')
    .upsert(payload, { onConflict: 'user_id,date' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
