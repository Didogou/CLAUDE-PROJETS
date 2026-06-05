import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/nutrition/weight/seed
 * Body (tout optionnel) : { startKg, endKg, months, reset }
 *
 * Génère un historique de pesées pour l'abonnée connectée, sur N mois,
 * en interpolant linéairement entre startKg et endKg avec un bruit
 * gaussien (variations naturelles). ~3-4 pesées par semaine.
 *
 * Valeurs par défaut : startKg = profile.weight_kg ou 78,
 *                      endKg   = startKg - profile.weight_loss_kg ou startKg - 3,
 *                      months  = 6,
 *                      reset   = false (supprime l'historique existant si true).
 *
 * Pratique pour démo / test de la courbe de poids.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const { data: profile } = await (supabase as any)
    .from('user_nutrition_profile')
    .select('weight_kg, weight_loss_kg')
    .eq('user_id', user.id)
    .maybeSingle();

  const startKg = Number.isFinite(Number(body?.startKg))
    ? Number(body.startKg)
    : profile?.weight_kg != null
      ? Number(profile.weight_kg)
      : 78;
  const endKg = Number.isFinite(Number(body?.endKg))
    ? Number(body.endKg)
    : profile?.weight_loss_kg != null && profile.weight_loss_kg > 0
      ? startKg - Number(profile.weight_loss_kg)
      : Math.max(20, startKg - 3);
  const months = Number.isFinite(Number(body?.months))
    ? Math.max(1, Math.min(24, Number(body.months)))
    : 6;
  const reset = !!body?.reset;

  if (
    !Number.isFinite(startKg) ||
    startKg < 20 ||
    startKg > 300 ||
    !Number.isFinite(endKg) ||
    endKg < 20 ||
    endKg > 300
  ) {
    return NextResponse.json(
      { error: 'startKg/endKg hors bornes' },
      { status: 400 },
    );
  }

  if (reset) {
    const { error } = await (supabase as any)
      .from('weight_log_entries')
      .delete()
      .eq('user_id', user.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Génération
  const totalDays = months * 30;
  const NOISE_SIGMA = 0.4;
  const FREQ_PER_WEEK = 3.5; // ~3-4 pesées/semaine
  const PROB_PER_DAY = FREQ_PER_WEEK / 7;

  function gaussian(sigma = 1) {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z =
      Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * sigma;
  }

  const rows: Array<{ user_id: string; weighed_at: string; weight_kg: number }> = [];
  const now = new Date();
  for (let dayOffset = totalDays - 1; dayOffset >= 0; dayOffset--) {
    if (Math.random() > PROB_PER_DAY) continue;
    const d = new Date(now);
    d.setDate(d.getDate() - dayOffset);
    d.setHours(7 + Math.floor(Math.random() * 2));
    d.setMinutes(Math.floor(Math.random() * 60));
    d.setSeconds(0);
    d.setMilliseconds(0);
    const t = (totalDays - 1 - dayOffset) / Math.max(1, totalDays - 1);
    const baseKg = startKg + (endKg - startKg) * t;
    const noise = gaussian(NOISE_SIGMA);
    const kg = Math.max(20, Math.min(300, baseKg + noise));
    rows.push({
      user_id: user.id,
      weighed_at: d.toISOString(),
      weight_kg: Math.round(kg * 10) / 10,
    });
  }
  rows.sort((a, b) => a.weighed_at.localeCompare(b.weighed_at));

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  // Insert en chunks de 100
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await (supabase as any)
      .from('weight_log_entries')
      .insert(slice);
    if (error) {
      return NextResponse.json(
        { error: error.message, inserted },
        { status: 500 },
      );
    }
    inserted += slice.length;
  }

  return NextResponse.json({ inserted, startKg, endKg, months });
}
