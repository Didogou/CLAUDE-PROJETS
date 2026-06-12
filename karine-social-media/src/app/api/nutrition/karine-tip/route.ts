import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
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

  // Résumé compact par catégorie de repas avec timestamp court
  const byCat: Record<string, Array<{ label: string; kcal: number; hhmm: string }>> = {
    breakfast: [],
    lunch: [],
    snack: [],
    dinner: [],
    none: [],
  };
  for (const e of entries) {
    const cat = (e.meal_category as string) || 'none';
    const bucket = byCat[cat] ?? byCat.none;
    const d = new Date(e.logged_at);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
    bucket.push({
      label: String(e.label),
      kcal: Math.round(Number(e.kcal ?? 0) * Number(e.portions ?? 1)),
      hhmm,
    });
  }
  const formatBucket = (
    arr: Array<{ label: string; kcal: number; hhmm: string }>,
  ) =>
    arr.length === 0
      ? 'rien'
      : arr.map((x) => `${x.label} ${x.kcal} kcal à ${x.hhmm}`).join(', ');

  // Heure + phase de la journée + prochain repas attendu.
  //
  // Cas particulier : si l'abonnée a déjà saisi un dîner, c'est le
  // dernier repas de la journée. nextMeal devient `null` et le
  // prompt système doit alors clore la journée (mot d'encouragement,
  // pas de suggestion de repas suivant).
  const hh = today.getHours();
  const mm = today.getMinutes();
  const nowStr = `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}`;
  const minuteOfDay = hh * 60 + mm;
  let phase: string;
  let nextMeal: string | null;
  if (byCat.dinner.length > 0) {
    phase = 'soirée — journée terminée côté repas';
    nextMeal = null;
  } else if (minuteOfDay < 11 * 60 + 45) {
    phase = 'matinée';
    nextMeal = byCat.breakfast.length === 0 ? 'petit-déjeuner' : 'déjeuner';
  } else if (minuteOfDay < 15 * 60 + 30) {
    phase = 'midi / début après-midi';
    nextMeal = byCat.lunch.length === 0 ? 'déjeuner' : 'goûter';
  } else if (minuteOfDay < 19 * 60) {
    phase = 'après-midi / fin de journée';
    nextMeal = byCat.snack.length === 0 ? 'goûter' : 'dîner';
  } else {
    phase = 'soirée';
    nextMeal = 'dîner';
  }

  // Recettes Karine de catégorie 'plat' publiées avec leur kcal —
  // injectées dans le prompt UNIQUEMENT pour aider Mistral à nommer
  // une recette précise quand le prochain repas est un dîner.
  //
  // Service-role obligatoire : la RLS de recipes exige une
  // souscription active pour les non-admins. Or le conseil Karine
  // doit fonctionner même en période d'essai / compte de test. On
  // se limite ici aux champs PUBLICS (title + calories), aucun
  // contenu premium n'est exposé.
  const serviceSupabase = createServiceClient();
  const { data: recipeRows } = await (serviceSupabase as any)
    .from('recipes')
    .select('slug, title, calories, cover_image_url')
    .eq('status', 'published')
    .eq('category', 'plat')
    .not('calories', 'is', null)
    .order('calories', { ascending: true })
    .limit(30);
  const recipes: Array<{
    slug: string;
    title: string;
    calories: number;
    cover_image_url: string | null;
  }> = Array.isArray(recipeRows)
    ? recipeRows
        .filter(
          (r) =>
            typeof r.slug === 'string' &&
            typeof r.title === 'string' &&
            typeof r.calories === 'number',
        )
        .map((r) => ({
          slug: r.slug,
          title: r.title,
          calories: r.calories,
          cover_image_url: (r.cover_image_url as string | null) ?? null,
        }))
    : [];

  // Reste à consommer pour atteindre l'objectif sans dépasser
  const remainingKcal =
    prof?.daily_kcal ? Math.round(Number(prof.daily_kcal) - totals.kcal) : null;
  const remainingProteins =
    prof?.daily_proteins_g
      ? Math.round(Number(prof.daily_proteins_g) - totals.proteins)
      : null;
  const remainingLipids =
    prof?.daily_lipids_g
      ? Math.round(Number(prof.daily_lipids_g) - totals.lipids)
      : null;
  const remainingCarbs =
    prof?.daily_carbs_g
      ? Math.round(Number(prof.daily_carbs_g) - totals.carbs)
      : null;

  const ratioKcal =
    prof?.daily_kcal && prof.daily_kcal > 0
      ? Math.round((totals.kcal / Number(prof.daily_kcal)) * 100)
      : null;

  // 3) Prompt Mistral
  const system = `Tu es Karine Piffaretti, diététicienne bienveillante française. Tu accompagnes une abonnée dans son suivi calorique quotidien.

RÈGLES ABSOLUES :
- Tutoiement, ton chaleureux, jamais de jugement, jamais culpabilisant.
- Pas d'injonctions, pas d'interdits. Tu suggères, tu encourages, tu rassures.
- 1 à 2 phrases courtes (max 35 mots au total).
- Le conseil doit s'appuyer sur CE QU'ELLE A DÉJÀ MANGÉ et — si un prochain repas est encore à venir — l'orienter en cohérence avec son OBJECTIF (perte de poids s'il y en a un) et les macros qu'il lui reste à atteindre.
- Si elle a déjà bien mangé, propose un repas léger ou équilibré pour le suivant.
- Si elle est en retard sur les kcal/macros, propose une idée précise (ex: "ce midi, une assiette avec du poulet et des légumes").
- Si elle a déjà dépassé, rassure et propose une fin de journée légère (eau, tisane, soupe).
- Évite la généralité : nomme un type d'aliment ou un plat concret pour le prochain repas si possible.
- Pas de markdown, pas de citation entre guillemets, pas de salutation ni de signature.

CAS PARTICULIER — DÎNER DÉJÀ SAISI :
Si le contexte indique "Prochain repas attendu : aucun (dîner déjà saisi, journée terminée)", c'est le DERNIER repas de la journée. NE PROPOSE AUCUN repas suivant. Au lieu de ça : félicite, rassure, encourage pour le lendemain, ou commente la cohérence de la journée. Tournures type : "Belle journée ! Repose-toi bien 🌸" / "Bilan harmonieux ce soir 💚 à demain pour repartir du bon pied".

RECETTES DE KARINE — RÈGLES STRICTES :
- Une liste de mes recettes (titre + kcal) peut être fournie ci-dessous.
- Tu peux nommer UNE recette précise UNIQUEMENT si le prochain repas est un DÎNER (et donc pas encore saisi). Choisis-la dans la liste, en privilégiant celle qui colle le mieux aux kcal restantes à atteindre (sans dépasser).
  Tournure : "ce soir, n'hésite pas à piquer ma recette de [TITRE] (≈ X kcal)" ou variante similaire.
- Si le prochain repas n'est PAS un dîner (petit-déjeuner, déjeuner, goûter) OU s'il n'y a PAS de prochain repas (dîner déjà saisi), tu ne nommes AUCUNE recette précise.
- Pour le déjeuner / goûter, tu peux évoquer "une de mes recettes à environ X kcal" de manière générique si c'est pertinent, sans titre.
- Si aucune recette ne convient (liste vide ou kcal incompatibles), n'en mentionne pas.

STYLE KARINE — EMOJIS ENCOURAGEANTS :
Ajoute 1 à 3 petits émojis chaleureux pour ponctuer ton conseil (cœurs, fleurs, soleil, plantes…). Bannis tout émoji froid, sarcastique ou alimentaire (👍 ❌ 🍔 🍰). Privilégie cette palette : 🌸 🌷 🌺 🌻 🌹 🌼 💐 🌿 🌱 🌳 ❤️ 💛 💚 💖 💕 ✨ ☀️ 💪. Place-les en fin de phrase ou en respiration, jamais en début de phrase. Pas de surcharge : maximum 3 émojis sur tout le message.

RÉPONDS UNIQUEMENT EN JSON :
{
  "tip": "le conseil ici 🌸",
  "recipe_title": "Titre exact de la recette citée OU null si tu n'en cites aucune"
}

Important : si tu mentionnes une recette par son titre dans le tip, recopie ce titre EXACTEMENT tel qu'il apparaît dans la liste fournie ci-dessous (mêmes accents, mêmes majuscules, mêmes mots) dans le champ recipe_title. Sinon, recipe_title doit valoir null.`;

  const user_prompt = `CONTEXTE ABONNÉE :
- Sexe : ${prof?.sex ?? 'inconnu'}
- Âge : ${prof?.age_years ?? '?'} ans, poids ${prof?.weight_kg ?? '?'} kg, taille ${prof?.height_cm ?? '?'} cm
- Activité : ${prof?.activity_level ?? '?'}
- Objectif : ${
    prof?.weight_loss_kg
      ? `perdre ${prof.weight_loss_kg} kg en 3 mois (déficit calorique calculé)`
      : 'maintenir son poids'
  }
- Cible journalière : ${prof?.daily_kcal ?? '?'} kcal | Protéines ${prof?.daily_proteins_g ?? '?'}g | Lipides ${prof?.daily_lipids_g ?? '?'}g | Glucides ${prof?.daily_carbs_g ?? '?'}g

MOMENT ACTUEL :
- Il est ${nowStr} (phase : ${phase})
- Prochain repas attendu : ${nextMeal ?? 'aucun (dîner déjà saisi, journée terminée)'}

DÉJÀ MANGÉ AUJOURD'HUI :
- Petit-déjeuner : ${formatBucket(byCat.breakfast)}
- Déjeuner : ${formatBucket(byCat.lunch)}
- Goûter : ${formatBucket(byCat.snack)}
- Dîner : ${formatBucket(byCat.dinner)}
- Total : ${Math.round(totals.kcal)} kcal${ratioKcal !== null ? ` (${ratioKcal}% de l'objectif journalier)` : ''} | P:${Math.round(totals.proteins)}g, L:${Math.round(totals.lipids)}g, G:${Math.round(totals.carbs)}g

RESTE À CONSOMMER POUR ATTEINDRE L'OBJECTIF :
${remainingKcal !== null ? `- Kcal restantes : ${remainingKcal}${remainingKcal < 0 ? ' (déjà au-dessus)' : ''}` : ''}
${remainingProteins !== null ? `- Protéines restantes : ${remainingProteins}g` : ''}
${remainingLipids !== null ? `- Lipides restants : ${remainingLipids}g` : ''}
${remainingCarbs !== null ? `- Glucides restants : ${remainingCarbs}g` : ''}

MES RECETTES DISPONIBLES (titre — kcal) — utilisables UNIQUEMENT si le prochain repas est un DÎNER :
${recipes.length === 0 ? '(aucune)' : recipes.map((r) => `- ${r.title} — ${r.calories} kcal`).join('\n')}

${
  nextMeal
    ? `Écris un conseil concret qui oriente son ${nextMeal} en fonction de tout ça.`
    : `La journée est terminée côté repas. Écris un mot de clôture chaleureux qui célèbre ou rassure sur la journée, sans proposer de prochain repas.`
}`;

  let tip: string;
  let recipeTitleRaw: string | null = null;
  try {
    const result = await callMistralJson(system, user_prompt, {
      maxTokens: 250,
      timeoutMs: 15_000,
    });
    const parsed = JSON.parse(result.content) as {
      tip?: string;
      recipe_title?: string | null;
    };
    tip = typeof parsed.tip === 'string' ? parsed.tip.trim() : '';
    if (!tip) throw new Error('Tip vide');
    if (tip.length > 300) tip = tip.slice(0, 300).trim();
    recipeTitleRaw =
      typeof parsed.recipe_title === 'string' && parsed.recipe_title.trim()
        ? parsed.recipe_title.trim()
        : null;
  } catch (e) {
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 502 },
    );
  }

  // Résolution sûre : on n'expose une recette que si Mistral a cité
  // un titre qui matche EXACTEMENT (case-insensitive, accents
  // normalisés) un de ceux qu'on lui a fournis. Sinon, on ignore
  // pour éviter une hallucination de titre.
  function normalize(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }
  let recipe:
    | { slug: string; title: string; calories: number; coverImageUrl: string | null }
    | null = null;
  if (recipeTitleRaw) {
    const needle = normalize(recipeTitleRaw);
    const found = recipes.find((r) => normalize(r.title) === needle);
    if (found) {
      recipe = {
        slug: found.slug,
        title: found.title,
        calories: found.calories,
        coverImageUrl: found.cover_image_url,
      };
    }
  }

  // 4) Persiste dans daily_metrics (slug recette si applicable)
  const { error } = await (supabase as any).from('daily_metrics').upsert(
    {
      user_id: user.id,
      date: dateStr,
      karine_tip: tip,
      karine_tip_at: new Date().toISOString(),
      karine_tip_recipe_slug: recipe?.slug ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,date' },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tip, recipe });
}
