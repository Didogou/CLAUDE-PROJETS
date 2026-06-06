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
      'sex, age_years, weight_kg, height_cm, activity_level, goal, weight_loss_kg, target_horizon_months, summary_hour, daily_kcal, daily_proteins_g, daily_lipids_g, daily_carbs_g, daily_water_ml',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  // Récupère le nom complet du profil (pour la phrase personnalisée
  // dans /mes-stats). Toléré null si pas encore rempli côté signup.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profileRow } = await (supabase as any)
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();
  const fullName =
    typeof profileRow?.full_name === 'string'
      ? profileRow.full_name.trim()
      : null;

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
      weightLossKg:
        typeof data?.weight_loss_kg === 'number' ? data.weight_loss_kg : null,
      targetHorizonMonths:
        data?.target_horizon_months === 6
          ? 6
          : data?.target_horizon_months === 12
            ? 12
            : 3,
      summaryHour:
        typeof data?.summary_hour === 'number' ? data.summary_hour : 21,
      dailyWaterMl:
        typeof data?.daily_water_ml === 'number' ? data.daily_water_ml : null,
    },
    targets: {
      dailyKcal: data?.daily_kcal ?? null,
      proteinsG: data?.daily_proteins_g ?? null,
      lipidsG: data?.daily_lipids_g ?? null,
      carbsG: data?.daily_carbs_g ?? null,
    },
    suggestedSex,
    fullName,
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
  // targetHorizonMonths : 3, 6 ou 12. Default 3 (legacy).
  const horizonRaw = body?.targetHorizonMonths;
  const targetHorizonMonths: 3 | 6 | 12 =
    horizonRaw === 6 ? 6 : horizonRaw === 12 ? 12 : 3;
  // Borne max de weightLossKg selon l'horizon (cohérence santé : perte
  // moyenne saine ~3 kg/mois).
  const maxLossByHorizon: Record<3 | 6 | 12, number> = { 3: 9, 6: 15, 12: 30 };
  const maxLoss = maxLossByHorizon[targetHorizonMonths];
  // weightLossKg : 1..maxLoss ou null. Si fourni, il pilote le calcul
  // du déficit ; sinon on retombe sur l'ancien goal lose/maintain/gain.
  const weightLossKgRaw = body?.weightLossKg;
  const weightLossKg =
    typeof weightLossKgRaw === 'number' &&
    Number.isFinite(weightLossKgRaw) &&
    weightLossKgRaw >= 1 &&
    weightLossKgRaw <= maxLoss
      ? Math.round(weightLossKgRaw)
      : null;

  const profile: Partial<NutritionProfile> = {
    sex: body?.sex,
    ageYears: typeof body?.ageYears === 'number' ? body.ageYears : undefined,
    weightKg: typeof body?.weightKg === 'number' ? body.weightKg : undefined,
    heightCm: typeof body?.heightCm === 'number' ? body.heightCm : undefined,
    activityLevel: body?.activityLevel,
    // Goal devient un dérivé : si on a une perte cible, c'est 'lose',
    // sinon 'maintain'. L'API publique du formulaire ne demande plus
    // ce champ — l'abonnée choisit juste la perte.
    goal: weightLossKg !== null ? 'lose' : body?.goal ?? 'maintain',
    targetHorizonMonths,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    weightLossKg: weightLossKg as any,
  };

  if (!isProfileComplete(profile)) {
    return NextResponse.json(
      { error: 'Profil incomplet (sexe, age, poids, taille, activité tous requis)' },
      { status: 400 },
    );
  }

  const targets = calculateNutritionTargets(profile);

  const payload = {
    user_id: user.id,
    sex: profile.sex,
    age_years: profile.ageYears,
    weight_kg: profile.weightKg,
    height_cm: profile.heightCm,
    activity_level: profile.activityLevel,
    goal: profile.goal,
    weight_loss_kg: weightLossKg,
    target_horizon_months: targetHorizonMonths,
    daily_kcal: targets.dailyKcal,
    daily_proteins_g: targets.proteinsG,
    daily_lipids_g: targets.lipidsG,
    daily_carbs_g: targets.carbsG,
    updated_at: new Date().toISOString(),
  };

  // Récupère l'ancien poids pour décider de la sync : si l'utilisatrice
  // change son poids dans Mes infos, on insère AUSSI une pesée dans
  // weight_log_entries (sinon le graphe ne reflèterait pas le changement
  // tant qu'elle n'ouvre pas Mes repas et ne saisit pas explicitement
  // une pesée). Premier remplissage du profil = 1ʳᵉ pesée auto.
  const { data: existing } = await (supabase as any)
    .from('user_nutrition_targets')
    .select('weight_kg')
    .eq('user_id', user.id)
    .maybeSingle();
  const previousWeightKg =
    typeof existing?.weight_kg === 'number' ? existing.weight_kg : null;

  const { error } = await (supabase as any)
    .from('user_nutrition_targets')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sync vers weight_log_entries :
  //  - Première saisie (previousWeightKg null) → toujours créer la pesée
  //  - Mise à jour avec un poids DIFFÉRENT → créer la pesée
  //  - Même poids → rien (évite les doublons en cas de save répété)
  if (
    typeof profile.weightKg === 'number' &&
    profile.weightKg > 0 &&
    (previousWeightKg === null || previousWeightKg !== profile.weightKg)
  ) {
    // On ignore une erreur d'insert ici : la sauvegarde du profil a
    // déjà réussi, on ne veut pas bloquer le retour sur un sync.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('weight_log_entries').insert({
      user_id: user.id,
      weight_kg: profile.weightKg,
      weighed_at: new Date().toISOString(),
    });
  }
  return NextResponse.json({ ok: true, targets });
}
