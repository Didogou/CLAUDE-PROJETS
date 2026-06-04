import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { callMistralJson } from '@/lib/mistral';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/nutrition/karine-tip
 *
 * Génère un conseil bienveillant de Karine (1-2 phrases) à partir
 * du profil + état du jour. Persiste dans daily_metrics.karine_tip
 * et retourne le texte généré.
 *
 * Style : Karine Piffaretti, diététicienne bienveillante. Jamais
 * de jugement, jamais d'injonction culpabilisante. Pratique,
 * concret, chaleureux. Tutoiement.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  // 1) Profil + cible kcal/macros
  const { data: prof } = await (supabase as any)
    .from('user_nutrition_targets')
    .select(
      'sex, age_years, weight_kg, height_cm, activity_level, weight_loss_kg, daily_kcal, daily_proteins_g, daily_lipids_g, daily_carbs_g',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  // 2) Entries du jour (résumées par catégorie)
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
  const { data: rows } = await (supabase as any)
    .from('food_log_entries')
    .select('label, kcal, proteins_g, lipids_g, carbs_g, portions, meal_category, logged_at')
    .eq('user_id', user.id)
    .gte('logged_at', startOfDay)
    .lt('logged_at', endOfDay)
    .order('logged_at', { ascending: true });

  const entries = Array.isArray(rows) ? rows : [];
  const totals = entries.reduce(
    (acc, e) => {
      const p = Number(e.portions ?? 1);
      return {
        kcal: acc.kcal + Number(e.kcal ?? 0) * p,
        proteins: acc.proteins + Number(e.proteins_g ?? 0) * p,
        lipids: acc.lipids + Number(e.lipids_g ?? 0) * p,
        carbs: acc.carbs + Number(e.carbs_g ?? 0) * p,
      };
    },
    { kcal: 0, proteins: 0, lipids: 0, carbs: 0 },
  );

  // Résumé compact par catégorie de repas
  const byCat: Record<string, string[]> = {
    breakfast: [],
    lunch: [],
    snack: [],
    dinner: [],
    none: [],
  };
  for (const e of entries) {
    const cat = (e.meal_category as string) || 'none';
    const bucket = byCat[cat] ?? byCat.none;
    bucket.push(`${e.label} (${Math.round(Number(e.kcal ?? 0) * Number(e.portions ?? 1))} kcal)`);
  }

  // 3) Prompt Mistral
  const system = `Tu es Karine Piffaretti, diététicienne bienveillante française. Tu accompagnes une abonnée dans son suivi calorique quotidien.

RÈGLES ABSOLUES :
- Tutoiement, ton chaleureux, jamais de jugement, jamais culpabilisant.
- Pas d'injonctions, pas d'interdits. Tu suggères, tu encourages, tu rassures.
- Pratique et concret : 1 piste actionnable max, pas de liste.
- 1 à 2 phrases courtes (max 30 mots au total).
- Pas d'émoji, pas de markdown, pas de citation entre guillemets.
- Pas de salutation ni de signature.

RÉPONDS UNIQUEMENT EN JSON :
{ "tip": "le conseil ici" }`;

  const ratioKcal =
    prof?.daily_kcal && prof.daily_kcal > 0
      ? Math.round((totals.kcal / Number(prof.daily_kcal)) * 100)
      : null;

  const user_prompt = `CONTEXTE ABONNÉE :
- Sexe : ${prof?.sex ?? 'inconnu'}
- Âge : ${prof?.age_years ?? '?'} ans, poids ${prof?.weight_kg ?? '?'} kg, taille ${prof?.height_cm ?? '?'} cm
- Activité : ${prof?.activity_level ?? '?'}
- Objectif : ${
    prof?.weight_loss_kg
      ? `perdre ${prof.weight_loss_kg} kg en 3 mois`
      : 'maintenir son poids'
  }
- Cible kcal/jour : ${prof?.daily_kcal ?? '?'} kcal (P:${prof?.daily_proteins_g ?? '?'}g / L:${prof?.daily_lipids_g ?? '?'}g / G:${prof?.daily_carbs_g ?? '?'}g)

CONSOMMÉ AUJOURD'HUI :
- Total : ${Math.round(totals.kcal)} kcal${ratioKcal !== null ? ` (${ratioKcal}% de l'objectif)` : ''}
- Macros : P:${Math.round(totals.proteins)}g, L:${Math.round(totals.lipids)}g, G:${Math.round(totals.carbs)}g
- Pti dej : ${byCat.breakfast.join(', ') || '—'}
- Déjeuner : ${byCat.lunch.join(', ') || '—'}
- Goûter : ${byCat.snack.join(', ') || '—'}
- Dîner : ${byCat.dinner.join(', ') || '—'}

Écris un conseil court, bienveillant, qui s'appuie sur ce qu'elle a déjà mangé et la guide pour la suite de la journée (si elle est en avance, en retard, ou équilibrée). Si elle n'a quasi rien mangé, encourage. Si elle dépasse, rassure et propose un ajustement doux pour la suite.`;

  let tip: string;
  try {
    const result = await callMistralJson(system, user_prompt, {
      maxTokens: 200,
      timeoutMs: 15_000,
    });
    const parsed = JSON.parse(result.content) as { tip?: string };
    tip = typeof parsed.tip === 'string' ? parsed.tip.trim() : '';
    if (!tip) throw new Error('Tip vide');
    // Garde-fou : longueur raisonnable
    if (tip.length > 300) tip = tip.slice(0, 300).trim();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Mistral indisponible' },
      { status: 502 },
    );
  }

  // 4) Persiste dans daily_metrics
  const { error } = await (supabase as any).from('daily_metrics').upsert(
    {
      user_id: user.id,
      date: dateStr,
      karine_tip: tip,
      karine_tip_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,date' },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tip });
}
