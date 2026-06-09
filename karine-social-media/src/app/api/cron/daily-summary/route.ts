import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { callMistralJson } from '@/lib/mistral';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Cron Vercel : declenche toutes les heures (vercel.json), filtre
 * les utilisatrices dont summary_hour correspond a l heure
 * courante Europe/Paris, et genere un bilan Mistral pour chacune.
 *
 * Securite :
 *   - Vercel envoie un header `Authorization: Bearer ${CRON_SECRET}`
 *     sur les invocations cron.
 *   - On refuse les requetes sans ce header (sauf en dev local).
 *
 * Doc Vercel Cron : https://vercel.com/docs/cron-jobs
 */
export async function GET(request: NextRequest) {
  // Auth cron — FAIL CLOSED : si CRON_SECRET est absent en prod,
  // on refuse tout. Sinon un attaquant ferait tourner Mistral en
  // boucle sur tous les abonnes a chaque hit.
  const authHeader = request.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[cron/daily-summary] CRON_SECRET manquant en production — refus');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    // En dev local : on accepte pour les tests manuels mais on log.
    console.warn('[cron/daily-summary] CRON_SECRET absent en dev — endpoint ouvert (DEV ONLY)');
  } else if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Heure courante Europe/Paris (l app cible des abonnees FR).
  const nowParis = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }),
  );
  const currentHour = nowParis.getHours();
  const dateStr = `${nowParis.getFullYear()}-${String(nowParis.getMonth() + 1).padStart(2, '0')}-${String(nowParis.getDate()).padStart(2, '0')}`;

  const supabase = createServiceClient();

  // 1) Trouve toutes les abonnees avec un profil renseigne.
  // Plan Hobby Vercel = 1 cron / jour. On a fixe 19h UTC (21h Paris ete /
  // 20h Paris hiver) et on traite tout le monde dans la meme passe. Le
  // champ summary_hour est conserve pour un upgrade Pro futur (cron
  // horaire avec filtre par heure).
  const { data: targets, error: tErr } = await (supabase as any)
    .from('user_nutrition_targets')
    .select(
      'user_id, daily_kcal, daily_proteins_g, daily_lipids_g, daily_carbs_g, summary_hour, sex',
    )
    .not('daily_kcal', 'is', null);

  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }
  if (!targets || targets.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, hour: currentHour });
  }

  let processed = 0;
  let errors = 0;

  for (const t of targets) {
    try {
      const ok = await processUserSummary(supabase, t, dateStr);
      if (ok) processed++;
    } catch (e) {
      console.error('[cron daily-summary] user', t.user_id, e);
      errors++;
    }
  }

  return NextResponse.json({ ok: true, processed, errors, hour: currentHour });
}

type TargetRow = {
  user_id: string;
  daily_kcal: number;
  daily_proteins_g: number | null;
  daily_lipids_g: number | null;
  daily_carbs_g: number | null;
  sex: 'male' | 'female' | null;
};

const SYSTEM_PROMPT = `Tu es Karine, dietéticienne bienveillante. Tu écris à une abonnée un bilan de fin de journée.

Règles strictes :
- Ton chaleureux, encourageant, jamais culpabilisant.
- 1 ou 2 phrases courtes en français, max 200 caractères.
- Tutoiement (on tutoie l abonnée).
- Si l ecart à l objectif est < 10% : felicite.
- Si l ecart est 10-25% : encourage doucement à corriger demain.
- Si l ecart est > 25% : reste douce mais nomme la chose, propose une piste concrete.
- Mentionne UN macro problematique max (le plus important).
- Pas de pavé, pas de liste, pas de markdown.
- Termine par un emoji doux (🌸 / 💗 / ✨ / 🌿) — pas tous, juste un.

Reponds en JSON pur : { "summary": "texte court" }`;

async function processUserSummary(
  supabase: ReturnType<typeof createServiceClient>,
  target: TargetRow,
  dateStr: string,
): Promise<boolean> {
  // Skip si bilan deja genere aujourd hui
  const { data: existing } = await (supabase as any)
    .from('daily_metrics')
    .select('summary_text, kcal_burned')
    .eq('user_id', target.user_id)
    .eq('date', dateStr)
    .maybeSingle();

  if (existing?.summary_text) {
    return false; // deja fait
  }

  // Recupere les entries du jour
  const startOfDay = `${dateStr}T00:00:00Z`;
  const endOfDay = `${dateStr}T23:59:59Z`;
  const { data: entries } = await (supabase as any)
    .from('food_log_entries')
    .select('kcal, proteins_g, lipids_g, carbs_g, portions')
    .eq('user_id', target.user_id)
    .gte('logged_at', startOfDay)
    .lte('logged_at', endOfDay);

  const rows = (entries ?? []) as Array<{
    kcal: number;
    proteins_g: number | null;
    lipids_g: number | null;
    carbs_g: number | null;
    portions: number;
  }>;

  const totals = rows.reduce(
    (acc, e) => ({
      kcal: acc.kcal + Number(e.kcal) * Number(e.portions),
      proteinsG: acc.proteinsG + Number(e.proteins_g ?? 0) * Number(e.portions),
      lipidsG: acc.lipidsG + Number(e.lipids_g ?? 0) * Number(e.portions),
      carbsG: acc.carbsG + Number(e.carbs_g ?? 0) * Number(e.portions),
    }),
    { kcal: 0, proteinsG: 0, lipidsG: 0, carbsG: 0 },
  );

  const kcalBurned = Number(existing?.kcal_burned ?? 0);
  const netKcal = totals.kcal - kcalBurned;

  const userPrompt = buildUserPrompt(target, totals, kcalBurned, netKcal);

  let summary = '';
  try {
    const result = await callMistralJson(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 200,
      timeoutMs: 15_000,
    });
    const parsed = JSON.parse(result.content) as { summary?: string };
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      summary = parsed.summary.trim().slice(0, 300);
    }
  } catch (e) {
    console.error('[cron] Mistral fail user', target.user_id, e);
    return false;
  }

  if (!summary) return false;

  // Upsert dans daily_metrics
  const { error: upErr } = await (supabase as any)
    .from('daily_metrics')
    .upsert(
      {
        user_id: target.user_id,
        date: dateStr,
        summary_text: summary,
        summary_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,date' },
    );
  return !upErr;
}

function buildUserPrompt(
  t: TargetRow,
  totals: { kcal: number; proteinsG: number; lipidsG: number; carbsG: number },
  kcalBurned: number,
  netKcal: number,
): string {
  const sexLabel = t.sex === 'male' ? 'masculin' : 'féminin';
  return `Profil : ${sexLabel}.
Objectifs du jour : ${t.daily_kcal} kcal, ${t.daily_proteins_g ?? '?'} g protéines, ${t.daily_lipids_g ?? '?'} g lipides, ${t.daily_carbs_g ?? '?'} g glucides.
Apports : ${Math.round(totals.kcal)} kcal, ${Math.round(totals.proteinsG)} g prot, ${Math.round(totals.lipidsG)} g lip, ${Math.round(totals.carbsG)} g gluc.
Dépense sport : ${kcalBurned} kcal.
Bilan net : ${Math.round(netKcal)} kcal ingérées net.

Génère le bilan bienveillant.`;
}
