import { createClient } from '@/lib/supabase/server';

export type WaterDayState = {
  targetMl: number;
  glassSizeMl: number;
  consumedMl: number;
  glassesCount: number;
  entries: { id: string; loggedAt: string; ml: number }[];
};

const DEFAULT_GLASS_ML = 250;
const DEFAULT_TARGET_ML = 1500;

function todayBounds(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * État complet eau du jour (target + glass_size + consommé +
 * entrées pour pouvoir annuler le dernier).
 */
export async function getWaterDayState(userId: string): Promise<WaterDayState> {
  const supabase = await createClient();

  // 1) Target (sur user_nutrition_targets)
  const { data: targetRow } = await (supabase as any)
    .from('user_nutrition_targets')
    .select('daily_water_ml')
    .eq('user_id', userId)
    .maybeSingle();
  const targetMl = targetRow?.daily_water_ml ?? DEFAULT_TARGET_ML;

  // 2) Glass size
  const { data: settingsRow } = await (supabase as any)
    .from('user_water_settings')
    .select('glass_size_ml')
    .eq('user_id', userId)
    .maybeSingle();
  const glassSizeMl = settingsRow?.glass_size_ml ?? DEFAULT_GLASS_ML;

  // 3) Entrées du jour
  const { start, end } = todayBounds();
  const { data: logRows } = await (supabase as any)
    .from('water_log_entries')
    .select('id, logged_at, ml')
    .eq('user_id', userId)
    .gte('logged_at', start)
    .lt('logged_at', end)
    .order('logged_at', { ascending: false });

  const entries = ((logRows ?? []) as Array<{
    id: string;
    logged_at: string;
    ml: number;
  }>).map((r) => ({
    id: r.id,
    loggedAt: r.logged_at,
    ml: Number(r.ml),
  }));

  const consumedMl = entries.reduce((acc, e) => acc + e.ml, 0);

  return {
    targetMl,
    glassSizeMl,
    consumedMl,
    glassesCount: entries.length,
    entries,
  };
}
