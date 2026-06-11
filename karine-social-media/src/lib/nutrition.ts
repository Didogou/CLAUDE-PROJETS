import { createClient } from '@/lib/supabase/server';

export type NutritionTarget = {
  dailyKcal: number;
  dailyWaterMl: number;
  dailyProteinsG: number | null;
  dailyLipidsG: number | null;
  dailyCarbsG: number | null;
  updatedAt: string;
};

export type MealCategory = 'breakfast' | 'lunch' | 'snack' | 'dinner';

export type FoodLogEntry = {
  id: string;
  loggedAt: string;
  source: 'ciqual' | 'recipe' | 'menu' | 'free';
  sourceRefId: string | null;
  label: string;
  kcal: number;
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
  portions: number;
  /** Catégorie de repas. Null pour les entrées d'avant la migration
   *  meal_category — le front déduit alors la catégorie depuis
   *  loggedAt. */
  mealCategory: MealCategory | null;
  /** URL de la photo Supabase Storage. Seule la 1ère entry d'un
   *  batch créé depuis une photo l'a (les suivantes du même batch
   *  sont null pour éviter le doublon de vignette). */
  photoUrl: string | null;
};

export type NutritionDayState = {
  target: NutritionTarget;
  entries: FoodLogEntry[];
  totals: {
    kcal: number;
    proteinsG: number;
    lipidsG: number;
    carbsG: number;
  };
  /** Vrai si le profil nutritionnel est rempli (sexe + age + poids
   *  + taille + activité + objectif). Sinon les besoins macros
   *  sont null. */
  profileComplete: boolean;
};

const DEFAULT_TARGET: NutritionTarget = {
  dailyKcal: 2000,
  dailyWaterMl: 1500,
  dailyProteinsG: null,
  dailyLipidsG: null,
  dailyCarbsG: null,
  updatedAt: new Date(0).toISOString(),
};

/** Récupère (ou crée implicitement par défaut) la cible d'une user. */
export async function getNutritionTarget(userId: string): Promise<NutritionTarget> {
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from('user_nutrition_targets')
    .select(
      'daily_kcal, daily_water_ml, daily_proteins_g, daily_lipids_g, daily_carbs_g, updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_TARGET };
  return {
    dailyKcal: Number(data.daily_kcal) || DEFAULT_TARGET.dailyKcal,
    dailyWaterMl: Number(data.daily_water_ml) || DEFAULT_TARGET.dailyWaterMl,
    dailyProteinsG:
      data.daily_proteins_g === null ? null : Number(data.daily_proteins_g),
    dailyLipidsG:
      data.daily_lipids_g === null ? null : Number(data.daily_lipids_g),
    dailyCarbsG:
      data.daily_carbs_g === null ? null : Number(data.daily_carbs_g),
    updatedAt: data.updated_at,
  };
}

/** Bornes [start, end) des 7 derniers jours (jour courant inclus,
 *  total 7 entrees). Retourne aussi les bornes de chaque jour pour
 *  pouvoir grouper les entries. */
export async function getLast7DaysKcal(
  userId: string,
): Promise<Array<{ date: string; kcal: number; dayLabel: string }>> {
  const supabase = await createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // J-6 → J0 (inclus), 7 entrees
  const start = new Date(today);
  start.setDate(start.getDate() - 6);
  const end = new Date(today);
  end.setDate(end.getDate() + 1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('food_log_entries')
    .select('logged_at, kcal, portions')
    .eq('user_id', userId)
    .gte('logged_at', start.toISOString())
    .lt('logged_at', end.toISOString());

  // Initialise les 7 jours a 0
  const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const days: Array<{ date: string; kcal: number; dayLabel: string }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push({
      date: d.toISOString().slice(0, 10),
      kcal: 0,
      dayLabel: DAY_LABELS[d.getDay()],
    });
  }

  if (error || !data) return days;

  // Cumule les kcal × portions par jour
  for (const r of data as Array<{ logged_at: string; kcal: number; portions: number }>) {
    const d = r.logged_at.slice(0, 10);
    const day = days.find((x) => x.date === d);
    if (day) day.kcal += Number(r.kcal) * Number(r.portions);
  }

  return days;
}

/**
 * Bornes [start, end) UTC d'une journée locale Europe/Paris.
 *
 * Fix 2026-06-11 : sur Vercel le server tourne en UTC. Sans correction
 * timezone, à minuit Paris (= 22h ou 23h UTC selon DST), la journée
 * courante "reset" 1-2h en retard et les nouvelles entrées des 00h
 * Paris sont attribuées à la veille. → totaux à 0 au passage de minuit.
 *
 * On calcule maintenant l'offset Paris vs UTC via Intl.DateTimeFormat
 * (gère DST automatiquement).
 */
function todayBounds(): { start: string; end: string } {
  const PARIS_TZ = 'Europe/Paris';
  const now = new Date();
  // "now" en composantes Paris
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
  // Date "à minuit Paris" représentée comme un Date UTC : on utilise
  // l'astuce du toISOString en construisant un wall-clock string que
  // l'on parse en tant qu'instant Paris, puis on calcule l'offset.
  const parisMidnightAsIfUtc = new Date(
    `${parts.year}-${parts.month}-${parts.day}T00:00:00Z`,
  );
  // Offset Paris = différence entre l'heure "wall clock Paris" et UTC
  // au moment de "now".
  const wallClockParisNowAsIfUtc = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
  );
  const offsetMs = wallClockParisNowAsIfUtc.getTime() - now.getTime();
  // start UTC = minuit Paris - offset
  const start = new Date(parisMidnightAsIfUtc.getTime() - offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Toutes les entrées d'aujourd'hui + totaux + target. */
export async function getNutritionDayState(userId: string): Promise<NutritionDayState> {
  const supabase = await createClient();
  const target = await getNutritionTarget(userId);
  const { start, end } = todayBounds();

  // Profil complet = on a calculé daily_kcal via Mifflin (donc on a
  // forcément aussi les 3 macros target).
  const profileComplete =
    target.dailyProteinsG !== null &&
    target.dailyLipidsG !== null &&
    target.dailyCarbsG !== null;

  const { data, error } = await (supabase as any)
    .from('food_log_entries')
    .select('id, logged_at, source, source_ref_id, label, kcal, proteins_g, lipids_g, carbs_g, portions, meal_category, photo_url')
    .eq('user_id', userId)
    .gte('logged_at', start)
    .lt('logged_at', end)
    .order('logged_at', { ascending: false });

  const rows = !error && data ? (data as Array<Record<string, unknown>>) : [];

  // Joindre les images Ciqual : pour toutes les entries source='ciqual'
  // avec un source_ref_id numerique, on lookup ciqual_foods.image_url
  // en 1 query batch pour ne pas faire N requetes.
  const ciqualIds = new Set<number>();
  for (const r of rows) {
    if (r.source === 'ciqual' && r.source_ref_id) {
      const n = Number(r.source_ref_id);
      if (Number.isFinite(n)) ciqualIds.add(n);
    }
  }
  const ciqualImageById = new Map<number, string | null>();
  const ciqualWeightById = new Map<number, number | null>();
  if (ciqualIds.size > 0) {
    const { data: imgs } = await (supabase as any)
      .from('ciqual_foods')
      .select('id, image_url, avg_unit_weight_g')
      .in('id', [...ciqualIds]);
    for (const row of ((imgs ?? []) as Array<{ id: number; image_url: string | null; avg_unit_weight_g: number | null }>)) {
      ciqualImageById.set(Number(row.id), row.image_url ?? null);
      // Sentinel 0.0001 = "1 unite n'a pas de sens" (huile, sel) → null
      const w = row.avg_unit_weight_g;
      ciqualWeightById.set(
        Number(row.id),
        typeof w === 'number' && w > 0.01 ? Number(w) : null,
      );
    }
  }

  const entries: FoodLogEntry[] = rows.map((r) => {
    const isCiqual = r.source === 'ciqual';
    const refId = isCiqual && r.source_ref_id ? Number(r.source_ref_id) : null;
    return {
      id: String(r.id),
      loggedAt: String(r.logged_at),
      source: r.source as FoodLogEntry['source'],
      sourceRefId: (r.source_ref_id as string | null) ?? null,
      label: String(r.label),
      kcal: Number(r.kcal),
      proteinsG: r.proteins_g === null ? null : Number(r.proteins_g),
      lipidsG: r.lipids_g === null ? null : Number(r.lipids_g),
      carbsG: r.carbs_g === null ? null : Number(r.carbs_g),
      portions: Number(r.portions),
      mealCategory: (r.meal_category as MealCategory | null) ?? null,
      photoUrl: (r.photo_url as string | null) ?? null,
      ciqualImageUrl: refId !== null ? ciqualImageById.get(refId) ?? null : null,
      unitWeightG: refId !== null ? ciqualWeightById.get(refId) ?? null : null,
    };
  });

  const totals = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal * e.portions,
      proteinsG: acc.proteinsG + (e.proteinsG ?? 0) * e.portions,
      lipidsG: acc.lipidsG + (e.lipidsG ?? 0) * e.portions,
      carbsG: acc.carbsG + (e.carbsG ?? 0) * e.portions,
    }),
    { kcal: 0, proteinsG: 0, lipidsG: 0, carbsG: 0 },
  );

  return { target, entries, totals, profileComplete };
}
