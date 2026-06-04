import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  calculateNutritionTargets,
  isProfileComplete,
  type NutritionProfile,
  type Sex,
  type ActivityLevel,
  type Goal,
} from '@/lib/nutrition-calc';

/**
 * GET /api/nutrition/profile
 *
 * Retourne le profil nutritionnel courant + valeurs OAuth
 * pré-suggérées si disponibles (user_metadata.gender de Facebook
 * notamment — Google n'expose plus le genre depuis 2019).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const { data } = await (supabase as any)
    .from('user_nutrition_targets')
    .select(
      'sex, age_years, weight_kg, height_cm, activity_level, goal, summary_hour, daily_kcal, daily_proteins_g, daily_lipids_g, daily_carbs_g',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  // Hint OAuth : si l'utilisateur a un gender dans son user_metadata
  // (Facebook, anciens comptes Google), on suggère cette valeur côté
  // UI pour pré-cocher le radio.
  const meta = user.user_metadata ?? {};
  const oauthGender =
    typeof meta.gender === 'string'
      ? meta.gender.toLowerCase()
      : null;
  const suggestedSex: Sex | null =
    oauthGender === 'male' || oauthGender === 'm' || oauthGender === 'homme'
      ? 'male'
      : oauthGender === 'female' || oauthGender === 'f' || oauthGender === 'femme'
        ? 'female'
        : null;

  return NextResponse.json({
    profile: {
      sex: (data?.sex as Sex) ?? null,
      ageYears: data?.age_years ?? null,
      weightKg: data?.weight_kg !== null && data?.weight_kg !== undefined
        ? Number(data.weight_kg)
        : null,
      heightCm: data?.height_cm ?? null,
      activityLevel: (data?.activity_level as ActivityLevel) ?? null,
      goal: (data?.goal as Goal) ?? null,
      summaryHour:
        typeof data?.summary_hour === 'number' ? data.summary_hour : 21,
    },
    targets: {
      dailyKcal: data?.daily_kcal ?? null,
      proteinsG: data?.daily_proteins_g ?? null,
      lipidsG: data?.daily_lipids_g ?? null,
      carbsG: data?.daily_carbs_g ?? null,
    },
    suggestedSex,
  });
}

/**
 * PATCH /api/nutrition/profile
 * Body : { sex, ageYears, weightKg, heightCm, activityLevel, goal }
 *
 * Sauvegarde le profil ET recalcule daily_kcal + macros via
 * Mifflin-St Jeor.
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
  const profile: Partial<NutritionProfile> = {
    sex: body?.sex,
    ageYears: typeof body?.ageYears === 'number' ? body.ageYears : undefined,
    weightKg: typeof body?.weightKg === 'number' ? body.weightKg : undefined,
    heightCm: typeof body?.heightCm === 'number' ? body.heightCm : undefined,
    activityLevel: body?.activityLevel,
    goal: body?.goal,
  };

  if (!isProfileComplete(profile)) {
    return NextResponse.json(
      { error: 'Profil incomplet (sexe, age, poids, taille, activité, objectif tous requis)' },
      { status: 400 },
    );
  }

  const targets = calculateNutritionTargets(profile);

  const summaryHourRaw = body?.summaryHour;
  const summaryHour =
    typeof summaryHourRaw === 'number' &&
    Number.isFinite(summaryHourRaw) &&
    summaryHourRaw >= 0 &&
    summaryHourRaw <= 23
      ? Math.round(summaryHourRaw)
      : 21;

  const payload = {
    user_id: user.id,
    sex: profile.sex,
    age_years: profile.ageYears,
    weight_kg: profile.weightKg,
    height_cm: profile.heightCm,
    activity_level: profile.activityLevel,
    goal: profile.goal,
    summary_hour: summaryHour,
    daily_kcal: targets.dailyKcal,
    daily_proteins_g: targets.proteinsG,
    daily_lipids_g: targets.lipidsG,
    daily_carbs_g: targets.carbsG,
    updated_at: new Date().toISOString(),
  };

  const { error } = await (supabase as any)
    .from('user_nutrition_targets')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, targets });
}
