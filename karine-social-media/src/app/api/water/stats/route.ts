import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/water/stats?range=7d|30d|90d
 *
 * Renvoie la consommation moyenne d'eau / jour sur la période, en ml,
 * comparée à l'objectif `daily_water_ml`. Sert à la vue Mes Stats
 * pour afficher un vase qui représente la moyenne (et pas juste
 * aujourd'hui).
 */
const RANGE_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const url = new URL(request.url);
  const range = url.searchParams.get('range') ?? '7d';
  const days = RANGE_DAYS[range] ?? 7;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [{ data: entries }, { data: target }, { data: settings }] =
    await Promise.all([
      sb
        .from('water_log_entries')
        .select('ml, logged_at')
        .eq('user_id', user.id)
        .gte('logged_at', since.toISOString()),
      sb
        .from('user_nutrition_targets')
        .select('daily_water_ml')
        .eq('user_id', user.id)
        .maybeSingle(),
      sb
        .from('user_water_settings')
        .select('glass_size_ml')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

  const targetMl =
    typeof target?.daily_water_ml === 'number'
      ? target.daily_water_ml
      : null;
  const glassSizeMl =
    typeof settings?.glass_size_ml === 'number'
      ? settings.glass_size_ml
      : 250;

  // Total ml sur la période. On divise par le nombre de jours (et
  // pas par le nombre de jours avec log) pour pénaliser les jours
  // sans aucun verre — sinon la moyenne serait gonflée artificiellement.
  let totalMl = 0;
  for (const e of (entries ?? []) as Array<{ ml: number }>) {
    totalMl += typeof e.ml === 'number' ? e.ml : 0;
  }
  const avgMlPerDay = Math.round(totalMl / days);
  const percent =
    targetMl && targetMl > 0
      ? Math.min(200, Math.round((avgMlPerDay / targetMl) * 100))
      : null;

  return NextResponse.json({
    range,
    days,
    avgMlPerDay,
    totalMl,
    targetMl,
    glassSizeMl,
    percent,
  });
}
