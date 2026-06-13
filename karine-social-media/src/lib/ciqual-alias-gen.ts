import 'server-only';

/**
 * Génération d'alias en langage naturel pour un aliment Ciqual via
 * Mistral. Cœur partagé entre :
 *   - le script CLI scripts/batch-ciqual-aliases.mjs (legacy)
 *   - la route /api/admin/ciqual-aliases/generate (onglet admin)
 *
 * ⚠️ Mistral free = 1 req/s STRICT. Le throttle (1100 ms entre appels)
 * est de la responsabilité de l'APPELANT (la route espace ses appels).
 * Ici on ne gère que le retry/backoff sur 429 / 5xx d'UN appel.
 */

export type GeneratedAlias = { display: string; normalized: string };

export type CiqualFoodForGen = {
  name: string;
  group_name?: string | null;
  subgroup_name?: string | null;
};

/** Normalisation pour le matching : minuscules, sans accents, espaces simples. */
export function normalizeAlias(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .replace(/[’']/g, "'")
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/\s+/g, ' ')
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Appel Mistral avec retry exponentiel sur 429 / 5xx (3 / 7 / 15 s). */
async function mistralCall(
  prompt: string,
  apiKey: string,
  model = 'mistral-small-latest',
): Promise<string> {
  const backoffs = [3000, 7000, 15000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          temperature: 0.4,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = backoffs[attempt];
        if (wait === undefined) throw new Error(`Mistral HTTP ${res.status} (retries épuisés)`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Mistral HTTP ${res.status}: ${txt.slice(0, 160)}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      lastErr = e;
      const wait = backoffs[attempt];
      if (wait === undefined) break;
      await sleep(wait);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('mistralCall: tous les retries épuisés');
}

/**
 * Génère 3-5 alias naturels pour un aliment Ciqual. Prompt identique au
 * script legacy pour ne pas faire diverger la qualité.
 */
export async function generateAliasesForFood(
  food: CiqualFoodForGen,
  apiKey: string,
): Promise<GeneratedAlias[]> {
  const prompt = `Tu es un assistant français qui aide à indexer une base de données alimentaire.

Voici un aliment de la base Ciqual (ANSES) :
- Nom : « ${food.name} »
- Groupe : « ${food.group_name ?? '?'} »
- Sous-groupe : « ${food.subgroup_name ?? '?'} »

Donne-moi entre 3 et 5 façons NATURELLES et UNIQUES de désigner cet aliment en français parlé / écrit, comme le ferait une utilisatrice qui logue son repas.

RÈGLES :
- Privilégie l'ordre naturel des mots (ex : « côte de porc » plutôt que « porc, côte »).
- Inclus quelques synonymes courants si pertinents (« côtelette » pour « côte »).
- Ne mets PAS d'adjectifs de cuisson/présentation spécifiques (pas de « dorée », « poêlée », « rôtie ») — l'entrée Ciqual couvre déjà la cuisson dans son nom.
- Ne mets PAS de quantités (pas de « 100g de »).
- Pas de majuscules sauf noms propres. Pas de ponctuation finale.
- Si l'aliment est déjà évident en l'état (« eau », « sel fin »), retourne juste 1-2 variantes minimales ou un tableau vide.

Réponds UNIQUEMENT en JSON dans ce format strict :
{ "aliases": ["...", "...", "..."] }`;

  const raw = await mistralCall(prompt, apiKey);
  let parsed: { aliases?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`JSON Mistral invalide: ${raw.slice(0, 160)}`);
  }
  const arr = Array.isArray(parsed.aliases) ? parsed.aliases : [];
  return arr
    .filter(
      (a): a is string =>
        typeof a === 'string' && a.trim().length >= 2 && a.trim().length <= 100,
    )
    .map((a) => ({ display: a.trim(), normalized: normalizeAlias(a) }))
    // dédup intra-aliment
    .filter((a, i, all) => all.findIndex((x) => x.normalized === a.normalized) === i);
}
