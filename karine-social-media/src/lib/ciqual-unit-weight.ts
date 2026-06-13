import 'server-only';
import { callMistralJson } from '@/lib/mistral';
import { createServiceClient } from '@/lib/supabase/server';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Récupère le poids moyen d'UNE unité d'un aliment Ciqual.
 *
 * Pipeline :
 *   1. Lookup BDD (`ciqual_foods.avg_unit_weight_g`)
 *   2. Si null → appel Mistral, persist le résultat, retourne
 *
 * Une fois qu'un Ciqual a son poids unitaire connu, toutes les
 * recettes futures qui le lient profitent du lookup BDD direct
 * (gratuit, instantané).
 *
 * Mistral peut renvoyer null pour les aliments où "1 unité" n'a
 * pas de sens (huile, sel, farine…). Dans ce cas on persiste
 * 0.0001 en BDD pour éviter de re-questionner Mistral à chaque
 * fois, et le code appelant ignore cette valeur (≈ pas calculable).
 *
 * Throttle Mistral : 1 req/s strict (mémoire projet).
 */

const NULL_SENTINEL = 0.0001;

const supa = () => createServiceClient() as any;

const SYSTEM_PROMPT = `Tu es expert en nutrition française.

Tu dois donner le poids moyen en grammes d'UNE unité de l'aliment fourni.

Règles strictes :
- Réponds UNIQUEMENT en JSON: { "grams_per_unit": <nombre> | null }
- Renvoie null si "1 unité" n'a aucun sens pour cet aliment :
  liquides (huile, vinaigre, lait, eau), poudres (farine, sel,
  sucre, épices), pâtes/riz/céréales vrac, fromages râpés/coupés.
- Renvoie un nombre pour les aliments en pièce : 1 tomate, 1 œuf,
  1 carotte, 1 pomme, 1 yaourt, 1 tranche de pain, 1 morceau de sucre…
- Sois conservatif : poids moyen courant en supermarché français.
  Ex : "Tomate cerise, crue" → 15, "Œuf, cru" → 60, "Pomme, crue" → 150.
- N'invente jamais d'unités absurdes (ex: "1 tranche de tomate").`;

async function fetchFromMistral(ciqualName: string): Promise<number | null> {
  try {
    const userPrompt = `Aliment : "${ciqualName}"\n\nQuel est le poids moyen en grammes d'UNE unité de cet aliment ?`;
    const res = await callMistralJson(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 64,
      timeoutMs: 12_000,
    });
    const json = JSON.parse(res.content) as { grams_per_unit?: number | null };
    const w = json.grams_per_unit;
    if (typeof w !== 'number' || w <= 0 || w > 10_000) return null;
    return w;
  } catch (e) {
    console.warn('[ciqual-unit-weight] Mistral failed', ciqualName, (e as Error).message);
    return null;
  }
}

/**
 * Lookup + fallback Mistral + persist. Retourne null si Mistral
 * décide que "1 unité" n'a pas de sens (huile, etc.).
 */
export async function resolveUnitWeight(
  alimCode: number,
  ciqualName: string,
): Promise<number | null> {
  // 1. Lookup BDD (clé = alim_code STABLE)
  const { data } = await supa()
    .from('ciqual_foods')
    .select('avg_unit_weight_g')
    .eq('alim_code', alimCode)
    .single();
  const stored = data?.avg_unit_weight_g as number | null | undefined;
  if (typeof stored === 'number') {
    return stored === NULL_SENTINEL ? null : stored;
  }
  // 2. Mistral
  const fromMistral = await fetchFromMistral(ciqualName);
  // 3. Persist (toujours, même si null → sentinel pour ne pas re-questionner)
  await supa()
    .from('ciqual_foods')
    .update({
      avg_unit_weight_g: fromMistral ?? NULL_SENTINEL,
      avg_unit_weight_source: 'mistral',
      avg_unit_weight_updated_at: new Date().toISOString(),
    })
    .eq('alim_code', alimCode);
  return fromMistral;
}

/**
 * Variante batch : résout tous les poids manquants d'une liste de
 * (alim_code, name). Respecte le throttle Mistral 1 req/s strict
 * (séquentiel pur, pas de Promise.all).
 *
 * Retourne une Map<alim_code, grams> des poids RÉSOLUS (exclut les
 * null sentinel : si Mistral a dit "1 unité n'a pas de sens",
 * l'entrée n'apparaît pas dans la Map).
 */
export async function resolveUnitWeights(
  items: Array<{ alimCode: number; ciqualName: string }>,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();

  // Dédupe par alim_code pour ne pas re-questionner si plusieurs
  // ingrédients pointent vers le même Ciqual.
  const uniqueByCode = new Map<number, string>();
  for (const it of items) {
    if (!uniqueByCode.has(it.alimCode)) uniqueByCode.set(it.alimCode, it.ciqualName);
  }

  // 1) BULK lookup BDD en 1 query (au lieu de N selects séquentiels).
  // Fix perf 2026-06-12 : avant cette optim, on faisait sleep(1100) entre
  // CHAQUE ingrédient même quand le poids était en cache → ~11s pour
  // 10 ingrédients connus, tous gratuits. Maintenant : 0s sur cache hits.
  const codes = [...uniqueByCode.keys()];
  const { data } = await supa()
    .from('ciqual_foods')
    .select('alim_code, avg_unit_weight_g')
    .in('alim_code', codes);
  const cachedByCode = new Map<number, number | null>();
  for (const row of (data ?? []) as Array<{
    alim_code: number;
    avg_unit_weight_g: number | null;
  }>) {
    const w = row.avg_unit_weight_g;
    if (typeof w === 'number') {
      cachedByCode.set(Number(row.alim_code), w === NULL_SENTINEL ? null : w);
    }
  }
  for (const [code, value] of cachedByCode) {
    if (value !== null) out.set(code, value);
  }

  // 2) Pour ce qui n'est pas en cache : appel Mistral séquentiel avec
  // sleep 1100ms entre 2 appels uniquement (free tier 1 req/s strict).
  const unknownCodes = codes.filter((code) => !cachedByCode.has(code));
  for (let i = 0; i < unknownCodes.length; i++) {
    const code = unknownCodes[i];
    const name = uniqueByCode.get(code)!;
    const w = await resolveUnitWeight(code, name);
    if (typeof w === 'number') out.set(code, w);
    if (i < unknownCodes.length - 1) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }
  return out;
}
