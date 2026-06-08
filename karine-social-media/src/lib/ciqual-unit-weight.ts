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
  ciqualId: number,
  ciqualName: string,
): Promise<number | null> {
  // 1. Lookup BDD
  const { data } = await supa()
    .from('ciqual_foods')
    .select('avg_unit_weight_g')
    .eq('id', ciqualId)
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
    .eq('id', ciqualId);
  return fromMistral;
}

/**
 * Variante batch : résout tous les poids manquants d'une liste de
 * (ciqual_id, name). Respecte le throttle Mistral 1 req/s strict
 * (séquentiel pur, pas de Promise.all).
 *
 * Retourne une Map<ciqual_id, grams> des poids RÉSOLUS (exclut les
 * null sentinel : si Mistral a dit "1 unité n'a pas de sens",
 * l'entrée n'apparaît pas dans la Map).
 */
export async function resolveUnitWeights(
  items: Array<{ ciqualId: number; ciqualName: string }>,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();

  // Dédupe par ciqual_id pour ne pas re-questionner si plusieurs
  // ingrédients pointent vers le même Ciqual.
  const uniqueById = new Map<number, string>();
  for (const it of items) {
    if (!uniqueById.has(it.ciqualId)) uniqueById.set(it.ciqualId, it.ciqualName);
  }

  for (const [ciqualId, name] of uniqueById) {
    const w = await resolveUnitWeight(ciqualId, name);
    if (typeof w === 'number') out.set(ciqualId, w);
    // Throttle : 1 req/s strict pour Mistral free tier.
    // Si le lookup BDD a évité Mistral, ce sleep est superflu mais
    // pas mesurable (sleep court).
    await new Promise((r) => setTimeout(r, 1100));
  }
  return out;
}
