import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/nutrition/history?days=30
 *
 * Retourne l'historique nutritionnel des N derniers jours :
 *   - liste des jours avec leurs entries groupées par catégorie
 *   - objectif kcal quotidien (pour la courbe en tête de page)
 *
 * RLS garantit que l'abonnée ne voit que ses propres entries.
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
  const daysRaw = Number(url.searchParams.get('days') ?? '30');
  const days = Math.max(1, Math.min(90, Math.round(daysRaw)));

  // Récupère les objectifs (pour la courbe ref)
  const { data: targetRow } = await (supabase as any)
    .from('user_nutrition_targets')
    .select('daily_kcal')
    .eq('user_id', user.id)
    .maybeSingle();
  const dailyKcal = targetRow?.daily_kcal ?? 2000;

  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  since.setHours(0, 0, 0, 0);

  const { data, error } = await (supabase as any)
    .from('food_log_entries')
    .select(
      'id, logged_at, source, label, kcal, proteins_g, lipids_g, carbs_g, portions, meal_category, photo_url',
    )
    .eq('user_id', user.id)
    .gte('logged_at', since.toISOString())
    .order('logged_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Groupe par jour (clé YYYY-MM-DD en heure locale) puis par catégorie
  type Entry = {
    id: string;
    loggedAt: string;
    label: string;
    kcal: number;
    proteinsG: number | null;
    lipidsG: number | null;
    carbsG: number | null;
    portions: number;
    mealCategory: string | null;
    photoUrl: string | null;
  };
  type DayBucket = {
    date: string; // YYYY-MM-DD local
    totalKcal: number;
    entries: Entry[];
  };
  const byDay = new Map<string, DayBucket>();

  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const loggedAt = String(r.logged_at);
    const local = new Date(loggedAt);
    const dateKey = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    const entry: Entry = {
      id: String(r.id),
      loggedAt,
      label: String(r.label),
      kcal: Number(r.kcal),
      proteinsG: r.proteins_g === null ? null : Number(r.proteins_g),
      lipidsG: r.lipids_g === null ? null : Number(r.lipids_g),
      carbsG: r.carbs_g === null ? null : Number(r.carbs_g),
      portions: Number(r.portions),
      mealCategory: (r.meal_category as string | null) ?? null,
      photoUrl: (r.photo_url as string | null) ?? null,
    };
    const bucket = byDay.get(dateKey) ?? {
      date: dateKey,
      totalKcal: 0,
      entries: [],
    };
    bucket.totalKcal += entry.kcal * entry.portions;
    bucket.entries.push(entry);
    byDay.set(dateKey, bucket);
  }

  const result = Array.from(byDay.values()).sort((a, b) =>
    b.date.localeCompare(a.date),
  ); // jour le plus récent en 1er

  return NextResponse.json({
    days: result,
    target: { dailyKcal },
  });
}
