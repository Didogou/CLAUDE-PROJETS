import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/nutrition/balance?range=7d|30d|90d
 *
 * Calcule la répartition kcal entre Glucides / Lipides / Protéines
 * sur la période demandée à partir des food_log_entries.
 *
 * Formule (système des Atwater) :
 *  - 1 g protéines = 4 kcal
 *  - 1 g glucides  = 4 kcal
 *  - 1 g lipides   = 9 kcal
 *
 * % macro = kcal_macro / kcal_total × 100
 *
 * On retourne aussi :
 *  - kcalTotal : total absolu sur la période (informatif)
 *  - score : 0-100 d'équilibre vs cible (45/30/25)
 *  - emoji : feedback visuel selon le score
 */

const TARGET_PERCENT = {
  carbs: 45,
  lipids: 30,
  proteins: 25,
} as const;

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
  since.setDate(since.getDate() - days);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('food_log_entries')
    .select('kcal, proteins_g, lipids_g, carbs_g, portions, logged_at')
    .eq('user_id', user.id)
    .gte('logged_at', since.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Agrège les macros (en grammes) sur la période, pondérées par
  // les portions.
  let totalProteinsG = 0;
  let totalLipidsG = 0;
  let totalCarbsG = 0;
  let totalKcalRaw = 0;
  let entriesWithMacros = 0;
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const portions = typeof row.portions === 'number' ? row.portions : 1;
    const kcal = typeof row.kcal === 'number' ? row.kcal : 0;
    const prot = typeof row.proteins_g === 'number' ? row.proteins_g : null;
    const lip = typeof row.lipids_g === 'number' ? row.lipids_g : null;
    const carb = typeof row.carbs_g === 'number' ? row.carbs_g : null;
    totalKcalRaw += kcal * portions;
    if (prot != null && lip != null && carb != null) {
      totalProteinsG += prot * portions;
      totalLipidsG += lip * portions;
      totalCarbsG += carb * portions;
      entriesWithMacros += 1;
    }
  }

  // kcal calculé via Atwater (cohérent avec les % retournés).
  const kcalFromProteins = totalProteinsG * 4;
  const kcalFromLipids = totalLipidsG * 9;
  const kcalFromCarbs = totalCarbsG * 4;
  const kcalMacrosTotal =
    kcalFromProteins + kcalFromLipids + kcalFromCarbs;

  let percentCarbs: number | null = null;
  let percentLipids: number | null = null;
  let percentProteins: number | null = null;
  if (kcalMacrosTotal > 0) {
    percentCarbs = Math.round((kcalFromCarbs / kcalMacrosTotal) * 100);
    percentLipids = Math.round((kcalFromLipids / kcalMacrosTotal) * 100);
    percentProteins = Math.round((kcalFromProteins / kcalMacrosTotal) * 100);
  }

  // Score d'équilibre : 100 − somme des écarts absolus × 2, plafonné
  // à 0. Plus l'écart aux cibles 45/30/25 est faible, plus le score
  // monte. Ex : 46/28/26 → écart total 4 → score 92.
  let score: number | null = null;
  if (
    percentCarbs !== null &&
    percentLipids !== null &&
    percentProteins !== null
  ) {
    const ecart =
      Math.abs(percentCarbs - TARGET_PERCENT.carbs) +
      Math.abs(percentLipids - TARGET_PERCENT.lipids) +
      Math.abs(percentProteins - TARGET_PERCENT.proteins);
    score = Math.max(0, 100 - ecart * 2);
  }

  const emoji =
    score === null
      ? null
      : score >= 90
        ? '😊'
        : score >= 70
          ? '🙂'
          : score >= 50
            ? '😐'
            : '😟';

  return NextResponse.json({
    range,
    days,
    entriesCount: (data ?? []).length,
    entriesWithMacros,
    totalKcalRaw: Math.round(totalKcalRaw),
    kcalMacrosTotal: Math.round(kcalMacrosTotal),
    targets: TARGET_PERCENT,
    percent: {
      carbs: percentCarbs,
      lipids: percentLipids,
      proteins: percentProteins,
    },
    score,
    emoji,
  });
}
