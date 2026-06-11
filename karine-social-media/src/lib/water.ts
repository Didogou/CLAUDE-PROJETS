import { createClient } from '@/lib/supabase/server';

export type WaterDayState = {
  targetMl: number;
  glassSizeMl: number;
  consumedMl: number;
  glassesCount: number;
  entries: { id: string; loggedAt: string; ml: number }[];
};

// Décision Karine 2026-06-12 : un "verre" français standard = 150 ml
// (verre à eau classique de table, ajusté de 125 → 150 ml).
// Affecte uniquement les utilisatrices qui n'ont jamais réglé leur taille
// (les autres gardent leur valeur custom en user_water_settings).
const DEFAULT_GLASS_ML = 150;
const DEFAULT_TARGET_ML = 1500;

/**
 * Bornes [start, end) UTC d'une journée locale Europe/Paris.
 * Voir `lib/nutrition.ts` pour le contexte (fix DST/timezone Vercel).
 */
function todayBounds(): { start: string; end: string } {
  const PARIS_TZ = 'Europe/Paris';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const parisMidnightAsIfUtc = new Date(
    `${parts.year}-${parts.month}-${parts.day}T00:00:00Z`,
  );
  const wallClockParisNowAsIfUtc = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
  );
  const offsetMs = wallClockParisNowAsIfUtc.getTime() - now.getTime();
  const start = new Date(parisMidnightAsIfUtc.getTime() - offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * État complet eau du jour (target + glass_size + consommé +
 * entrées pour pouvoir annuler le dernier).
 */
export async function getWaterDayState(userId: string): Promise<WaterDayState> {
  const supabase = await createClient();
  const { start, end } = todayBounds();

  // Les 3 queries sont INDÉPENDANTES → parallélisation Promise.all
  // pour diviser la latence par ~3 (était : 500-900ms en séquentiel).
  const [
    { data: targetRow },
    { data: settingsRow },
    { data: logRows },
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('user_nutrition_targets')
      .select('daily_water_ml')
      .eq('user_id', userId)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('user_water_settings')
      .select('glass_size_ml')
      .eq('user_id', userId)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('water_log_entries')
      .select('id, logged_at, ml')
      .eq('user_id', userId)
      .gte('logged_at', start)
      .lt('logged_at', end)
      .order('logged_at', { ascending: false }),
  ]);
  const targetMl = targetRow?.daily_water_ml ?? DEFAULT_TARGET_ML;
  const glassSizeMl = settingsRow?.glass_size_ml ?? DEFAULT_GLASS_ML;

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
