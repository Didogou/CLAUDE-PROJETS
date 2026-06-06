import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/nutrition/foodlog/seed
 * Body : { days?: number, reset?: boolean }
 *
 * Génère un historique fictif de repas pour permettre à la patiente
 * de visualiser les graphes / l'équilibre alimentaire sans avoir à
 * saisir 30+ entrées à la main.
 *
 * Distribution :
 *  - `days` jours (default 30, max 180)
 *  - 3 à 4 repas / jour (breakfast / lunch / [snack] / dinner)
 *  - Chaque repas a un total kcal aléatoire dans une fourchette
 *    réaliste (200-800 selon catégorie)
 *  - Les macros sont distribuées autour des cibles 45 / 30 / 25
 *    avec ±5 % de bruit pour donner une courbe "vivante"
 *  - Source = 'free' (pas de ref Ciqual)
 *
 * Pas de Math.random() / Date.now() interdits ici (runtime route,
 * pas workflow).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const days = Math.min(
    180,
    Math.max(1, Number.isFinite(Number(body?.days)) ? Number(body.days) : 30),
  );
  const reset = body?.reset === true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Si reset → on supprime d'abord les entrées 'free' de la patiente
  // sur la période (= ce qui a probablement été inséré par un seed
  // précédent). On ne touche pas aux entrées Ciqual/recipe/menu pour
  // ne pas effacer du contenu réel saisi à la main.
  if (reset) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    await sb
      .from('food_log_entries')
      .delete()
      .eq('user_id', user.id)
      .eq('source', 'free')
      .gte('logged_at', since.toISOString());
  }

  // Helpers numériques (Math.random est autorisé en runtime route).
  const rand = (min: number, max: number) => min + Math.random() * (max - min);
  const randInt = (min: number, max: number) =>
    Math.floor(rand(min, max + 1));

  /** Tire des kcal cibles selon le repas. */
  const KCAL_PROFILE: Record<string, [number, number]> = {
    breakfast: [250, 450],
    lunch: [500, 800],
    snack: [100, 250],
    dinner: [400, 700],
  };

  /** Convertit kcal/macro en grammes via Atwater. */
  const gramsFor = (kcal: number, kcalPerG: number) =>
    Math.round((kcal / kcalPerG) * 10) / 10;

  /** Distribue les kcal en macros avec cibles 45/30/25 ± bruit. */
  function macrosFor(totalKcal: number) {
    const pctCarbs = rand(40, 50); // cible 45
    const pctLipids = rand(25, 35); // cible 30
    const pctProteins = Math.max(0, 100 - pctCarbs - pctLipids);
    const kcalCarbs = (totalKcal * pctCarbs) / 100;
    const kcalLipids = (totalKcal * pctLipids) / 100;
    const kcalProteins = (totalKcal * pctProteins) / 100;
    return {
      carbsG: gramsFor(kcalCarbs, 4),
      lipidsG: gramsFor(kcalLipids, 9),
      proteinsG: gramsFor(kcalProteins, 4),
    };
  }

  const LABELS_BY_MEAL: Record<string, string[]> = {
    breakfast: [
      'Yaourt + muesli + fruit',
      'Tartines + confiture + café',
      'Bowl de flocons d’avoine',
      'Œufs + pain complet',
    ],
    lunch: [
      'Salade composée',
      'Poulet riz légumes',
      'Pâtes au pesto',
      'Saumon vapeur + quinoa',
      'Soupe + tartine fromage',
    ],
    snack: ['Pomme + amandes', 'Yaourt nature', 'Carré chocolat noir'],
    dinner: [
      'Poisson + légumes vapeur',
      'Omelette + salade',
      'Wok de légumes + riz',
      'Soupe + tranche pain',
    ],
  };

  const meals: Array<{
    user_id: string;
    logged_at: string;
    source: 'free';
    source_ref_id: null;
    label: string;
    kcal: number;
    proteins_g: number;
    lipids_g: number;
    carbs_g: number;
    portions: number;
    meal_category: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  }> = [];

  const today = new Date();
  for (let d = 0; d < days; d++) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);
    day.setHours(0, 0, 0, 0);

    const cats: Array<keyof typeof KCAL_PROFILE> = ['breakfast', 'lunch', 'dinner'];
    // ~50 % des jours ont un snack en plus
    if (Math.random() < 0.5) cats.push('snack');

    for (const cat of cats) {
      const [lo, hi] = KCAL_PROFILE[cat];
      const kcalTotal = Math.round(rand(lo, hi));
      const m = macrosFor(kcalTotal);
      // Heure approximative par catégorie (juste pour timeline propre)
      const hour =
        cat === 'breakfast'
          ? 8
          : cat === 'lunch'
            ? 13
            : cat === 'snack'
              ? 16
              : 20;
      const ts = new Date(day);
      ts.setHours(hour, randInt(0, 59), 0, 0);
      const labels = LABELS_BY_MEAL[cat];
      meals.push({
        user_id: user.id,
        logged_at: ts.toISOString(),
        source: 'free',
        source_ref_id: null,
        label: labels[randInt(0, labels.length - 1)],
        kcal: kcalTotal,
        proteins_g: m.proteinsG,
        lipids_g: m.lipidsG,
        carbs_g: m.carbsG,
        portions: 1,
        meal_category: cat as 'breakfast' | 'lunch' | 'snack' | 'dinner',
      });
    }
  }

  // Insertion en chunks de 500 pour pas dépasser les limites Supabase.
  let inserted = 0;
  for (let i = 0; i < meals.length; i += 500) {
    const chunk = meals.slice(i, i + 500);
    const { error } = await sb.from('food_log_entries').insert(chunk);
    if (error) {
      return NextResponse.json(
        { error: error.message, insertedBeforeError: inserted },
        { status: 500 },
      );
    }
    inserted += chunk.length;
  }

  return NextResponse.json({ ok: true, inserted, days });
}
