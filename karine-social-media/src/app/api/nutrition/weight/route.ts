import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/nutrition/weight?days=90
 * Retourne l'historique des pesées des N derniers jours + le profil
 * (poids initial + objectif perte de poids pour la courbe ref).
 *
 * POST /api/nutrition/weight
 * Body : { weightKg: number, weighedAt?: string }
 * Insère une nouvelle pesée.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get('days') ?? '90');
  const days = Math.max(7, Math.min(365, Math.round(daysRaw)));

  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  since.setHours(0, 0, 0, 0);

  const [{ data: rows, error }, { data: profile }] = await Promise.all([
    (supabase as any)
      .from('weight_log_entries')
      .select('id, weighed_at, weight_kg')
      .eq('user_id', user.id)
      .gte('weighed_at', since.toISOString())
      .order('weighed_at', { ascending: true }),
    // Bug fix : le profil canonique est dans user_nutrition_targets
    // (table utilisée par /api/nutrition/profile). user_nutrition_profile
    // est une ancienne table vide → targetKg sortait toujours null,
    // donc la ligne objectif n'apparaissait jamais sur le graphe.
    (supabase as any)
      .from('user_nutrition_targets')
      .select('weight_kg, weight_loss_kg')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = ((rows ?? []) as Array<Record<string, unknown>>).map(
    (r) => ({
      id: String(r.id),
      weighedAt: String(r.weighed_at),
      weightKg: Number(r.weight_kg),
    }),
  );

  // Poids de référence : poids initial profil + objectif
  const initialKg =
    profile?.weight_kg !== null && profile?.weight_kg !== undefined
      ? Number(profile.weight_kg)
      : null;
  const lossKg =
    typeof profile?.weight_loss_kg === 'number'
      ? profile.weight_loss_kg
      : null;
  const targetKg =
    initialKg !== null && lossKg !== null && lossKg > 0
      ? initialKg - lossKg
      : null;

  return NextResponse.json({
    entries,
    profile: {
      initialKg,
      targetKg,
    },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const weightKg = Number(body?.weightKg);
  if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
    return NextResponse.json(
      { error: 'weightKg hors bornes (20-300)' },
      { status: 400 },
    );
  }
  const weighedAt =
    typeof body?.weighedAt === 'string'
      ? body.weighedAt
      : new Date().toISOString();

  const { data, error } = await (supabase as any)
    .from('weight_log_entries')
    .insert({
      user_id: user.id,
      weighed_at: weighedAt,
      weight_kg: weightKg,
    })
    .select('id, weighed_at, weight_kg')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    id: String(data.id),
    weighedAt: String(data.weighed_at),
    weightKg: Number(data.weight_kg),
  });
}

/**
 * DELETE /api/nutrition/weight?id=...
 * Supprime une pesée (en cas d'erreur de saisie).
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id requis' }, { status: 400 });
  }
  const { error } = await (supabase as any)
    .from('weight_log_entries')
    .delete()
    .eq('user_id', user.id)
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
