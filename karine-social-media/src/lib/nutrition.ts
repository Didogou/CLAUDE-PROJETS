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

/** Bornes [start, end) en UTC d'une journée locale (Europe/Paris). */
function todayBounds(): { start: string; end: string } {
  // On utilise les bornes locales : tout ce qui a logged_at dans la
  // journée locale FR est compté. Pour V1 on simplifie : start =
  // début de la journée du serveur (UTC). Karine + abonnées sont FR
  // → décalage 1-2h. Si problème, brancher Intl.DateTimeFormat plus
  // tard.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
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
