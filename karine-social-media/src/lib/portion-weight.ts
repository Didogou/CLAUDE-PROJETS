import 'server-only';
import { callMistralJson } from '@/lib/mistral';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeLabelKey } from '@/lib/nutriscore-aggregate';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Résout le POIDS D'UNE PORTION à partir du libellé d'ingrédient tel
 * qu'écrit dans la recette (« 1 gousse d'ail » → 5 g, « 1 tranche de
 * jambon blanc » → 40 g, « 1 grosse tomate » → 180 g).
 *
 * Pipeline :
 *   1. Lookup cache `ingredient_portion_weights` (clé = label normalisé)
 *   2. Si absent → Mistral (poids d'1 unité telle qu'écrite), persist
 *
 * Le poids dépend de la FORMULATION (mot d'unité + adjectif), pas de
 * l'aliment Ciqual : c'est pourquoi on clé sur le label, pas l'alim_code.
 * Mistral renvoie null pour les ingrédients qui se mesurent en poids/
 * volume (liquides, poudres, fromage râpé) → grams NULL en base, ignoré
 * du calcul. Throttle Mistral 1 req/s strict.
 */

const SYSTEM_PROMPT = `Tu es expert en cuisine et nutrition françaises.

On te donne un ingrédient TEL QU'ÉCRIT dans une recette. Donne le poids
moyen en grammes d'UNE portion/unité de cet ingrédient.

Règles strictes :
- Réponds UNIQUEMENT en JSON : { "grams": <nombre> | null }
- Renvoie null si l'ingrédient se mesure naturellement en poids ou en
  volume et PAS en pièce : liquides (huile, vinaigre, lait, eau, crème),
  poudres (farine, sucre, sel, épices), riz/pâtes/céréales en vrac,
  fromage râpé.
- Sinon, le poids d'UNE unité telle qu'on la compte en cuisine. Tiens
  compte du MOT D'UNITÉ et de l'ADJECTIF DE TAILLE présents :
    "gousse d'ail" → 5, "tranche de jambon blanc" → 40,
    "grosse tomate" → 180, "tomate" → 120, "tomate cerise" → 15,
    "oeuf" → 60, "concombre" → 300, "steak haché" → 110,
    "yaourt nature" → 125, "pâte brisée" → 230, "carotte" → 120,
    "oignon" → 120, "filet de poulet" → 150, "feuille de basilic" → 1.
- Sois conservatif (poids moyen courant en supermarché français).`;

async function fetchFromMistral(label: string): Promise<number | null> {
  try {
    const res = await callMistralJson(
      SYSTEM_PROMPT,
      `Ingrédient (tel qu'écrit) : "${label}"\n\nPoids moyen en grammes d'UNE portion ?`,
      { maxTokens: 64, timeoutMs: 12_000 },
    );
    const json = JSON.parse(res.content) as { grams?: number | null };
    const w = json.grams;
    return typeof w === 'number' && w > 0 && w <= 5_000 ? w : null;
  } catch (e) {
    console.warn('[portion-weight] Mistral failed', label, (e as Error).message);
    return null;
  }
}

/**
 * Résout les poids de portion d'une liste de labels bruts. Dédupe par
 * label normalisé. Retourne Map<labelKey, grams> (exclut les null =
 * « pas une pièce »).
 */
export async function resolvePortionWeights(
  rawLabels: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // Dédupe par clé normalisée, en gardant un label brut représentatif.
  const exampleByKey = new Map<string, string>();
  for (const l of rawLabels) {
    const k = normalizeLabelKey(l);
    if (k && !exampleByKey.has(k)) exampleByKey.set(k, l.trim());
  }
  const keys = [...exampleByKey.keys()];
  if (keys.length === 0) return out;

  const supa = createServiceClient() as any;

  // 1) Bulk lookup cache.
  const known = new Set<string>();
  for (let i = 0; i < keys.length; i += 300) {
    const { data } = await supa
      .from('ingredient_portion_weights')
      .select('label_key, grams')
      .in('label_key', keys.slice(i, i + 300));
    for (const r of (data ?? []) as Array<{ label_key: string; grams: number | null }>) {
      known.add(r.label_key);
      if (r.grams != null && Number(r.grams) > 0) out.set(r.label_key, Number(r.grams));
    }
  }

  // 2) Mistral séquentiel pour les manquants (1 req/s strict).
  const missing = keys.filter((k) => !known.has(k));
  for (let i = 0; i < missing.length; i++) {
    const key = missing[i];
    const example = exampleByKey.get(key)!;
    const grams = await fetchFromMistral(example);
    await supa.from('ingredient_portion_weights').upsert({
      label_key: key,
      grams,
      example_label: example,
      source: 'mistral',
      updated_at: new Date().toISOString(),
    });
    if (typeof grams === 'number' && grams > 0) out.set(key, grams);
    if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 1100));
  }

  return out;
}
