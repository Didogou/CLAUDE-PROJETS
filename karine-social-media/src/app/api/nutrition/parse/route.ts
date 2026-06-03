import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { callMistralJson } from '@/lib/mistral';
import { searchCiqualFoods } from '@/lib/ciqual';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/nutrition/parse
 * Body : { text: string }
 *
 * Pipeline 2 étapes :
 *  1) Mistral extrait les aliments {search_query, portions, approx_grams}.
 *  2) Pour chaque item :
 *     a. searchCiqualFoods(query, 15) → pool de candidats classés.
 *     b. Si 0 candidat → match=null (free entry).
 *     c. Si 1 seul ou score parfait du top1 → top1.
 *     d. Sinon → 2e appel Mistral pour CHOISIR parmi les 15 candidats
 *        en tenant compte de la phrase originale ("contexte").
 *  3) Calcule kcal pour 1 portion = kcal_per_100g × approx_grams/100.
 *  4) Retourne preview pour confirmation UI (PAS d'insert).
 */

type MistralItem = {
  /** @deprecated v1, garde la rétrocompat */
  search_query?: string;
  /** v2 : plusieurs variantes essayées en cascade. */
  search_queries?: string[];
  portions?: number;
  approx_grams?: number;
};

type CiqualCandidatePublic = {
  ciqualId: number;
  alimCode: number;
  name: string;
  kcalPer100g: number | null;
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
};

type ParsedItem = {
  label: string;
  searchQuery: string;
  portions: number;
  approxGrams: number;
  match: CiqualCandidatePublic | null;
  // Kcal pour 1 portion (à multiplier par portions côté UI).
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
  // Si match=null mais qu'on a quand même trouvé des candidats Ciqual
  // proches : on les remonte pour que l'UI propose à l'utilisatrice
  // de choisir manuellement.
  fallbackCandidates?: CiqualCandidatePublic[];
};

const SYSTEM_PROMPT = `Tu es un assistant nutritionnel français. L'utilisatrice décrit en français ce qu'elle a mangé. Extrais les aliments mentionnés.

SORTIE OBLIGATOIRE (JSON pur sans markdown) :
{
  "items": [
    { "search_queries": ["yaourt nature", "yaourt"], "portions": 1, "approx_grams": 125 }
  ]
}

Règles strictes :
- search_queries : LISTE de 1 à 4 termes à essayer en cascade dans la base ANSES Ciqual. On essaie la 1ère, si zéro résultat on passe à la 2ème, etc. Mets toujours en 1er le terme le plus précis, puis dégrade vers du plus générique.

Exemples :
  "j'ai mangé une côte de bœuf crue"
    → ["côte de bœuf cru", "faux-filet bœuf", "entrecôte bœuf", "bœuf cru"]
  "j'ai mangé du saumon fumé"
    → ["saumon fumé", "saumon"]
  "j'ai mangé de l'aligot"
    → ["aligot"]
  "j'ai mangé une pomme"
    → ["pomme crue", "pomme"]
  "j'ai mangé des lasagnes"
    → ["lasagnes", "lasagne bolognaise"]

- **NE DÉCOMPOSE PAS LES PLATS COMPOSÉS** en mot unique. Ciqual contient les plats préparés français (aligot, ratatouille, paella, choucroute, hachis parmentier, lasagnes, tartiflette, couscous, quiche lorraine, tiramisu…). Mets le plat tel quel comme 1ère search_query.

- Décompose en plusieurs items UNIQUEMENT si l'utilisatrice liste explicitement plusieurs aliments distincts avec "et" / "puis" / "," :
    "une pomme et un yaourt" = 2 items
    "des pâtes et une salade" = 2 items

- Pour les viandes, fournis toujours 2-3 variantes (la coupe précise + un nom de coupe Ciqual + le nom de l'animal). Ciqual liste les coupes officielles (faux-filet, entrecôte, paleron, jarret, rumsteck…), pas les appellations bouchères ("côte de bœuf").

- Pour les poissons, fournis 1-2 variantes (poisson + préparation).

- portions : nombre mentionné (1 yaourt=1, 2 pommes=2, "demi"=0.5).
- approx_grams : masse en grammes pour UNE portion :
    pomme≈150, yaourt≈125, tranche pain≈30, sandwich≈200, bol pâtes/riz cuites≈250, assiette plat principal≈300, plat composé≈250, viande crue/cuite≈150, poisson≈130.
- Si masse précise donnée ("500g de pâtes") : portions=1, approx_grams=500.

- Si vraiment vague ("un repas", "des trucs") : IGNORE.
- Maximum 10 items. JSON valide obligatoire (items vide si rien d'identifiable).`;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (text.length < 3) {
    return NextResponse.json(
      { error: 'Texte trop court (3 caractères min)' },
      { status: 400 },
    );
  }
  if (text.length > 500) {
    return NextResponse.json(
      { error: 'Texte trop long (500 caractères max)' },
      { status: 400 },
    );
  }

  let parsed: { items?: MistralItem[] };
  try {
    const result = await callMistralJson(SYSTEM_PROMPT, text, { maxTokens: 800 });
    parsed = JSON.parse(result.content) as { items?: MistralItem[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur Mistral';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 10) : [];
  if (items.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const out: ParsedItem[] = [];
  for (const it of items) {
    // Build cascade : V2 search_queries[] sinon fallback V1 search_query.
    const cascade: string[] = [];
    if (Array.isArray(it.search_queries)) {
      for (const q of it.search_queries) {
        if (typeof q === 'string' && q.trim()) cascade.push(q.trim());
      }
    } else if (typeof it.search_query === 'string') {
      const q = it.search_query.trim();
      if (q) cascade.push(q);
    }
    if (cascade.length === 0) continue;

    const portions =
      typeof it.portions === 'number' && Number.isFinite(it.portions) && it.portions > 0
        ? it.portions
        : 1;
    const grams =
      typeof it.approx_grams === 'number' &&
      Number.isFinite(it.approx_grams) &&
      it.approx_grams > 0
        ? it.approx_grams
        : 100;

    // Étape 2a : essayer chaque variante jusqu'à trouver des candidats
    let candidates: Awaited<ReturnType<typeof searchCiqualFoods>> = [];
    let usedQuery = cascade[0];
    for (const variant of cascade) {
      const found = await searchCiqualFoods(variant, 15);
      if (found.length > 0) {
        candidates = found;
        usedQuery = variant;
        break;
      }
    }

    type Picked = (typeof candidates)[number] | null;
    let picked: Picked = candidates[0] ?? null;

    // Étape 2d : si plusieurs candidats et pas de match évident, on
    // demande à Mistral de choisir avec le contexte de la phrase.
    if (candidates.length > 1 && !isObviousMatch(usedQuery, candidates[0].name)) {
      const better = await pickBestCandidate(text, usedQuery, candidates);
      if (better) {
        picked = better;
      } else {
        picked = null;
      }
    }
    const query = usedQuery;

    const factor = grams / 100;
    const kcalPerPortion =
      picked && picked.kcal_per_100g !== null
        ? round1(picked.kcal_per_100g * factor)
        : null;
    const proteinsPerPortion =
      picked && picked.proteins_g !== null ? round1(picked.proteins_g * factor) : null;
    const lipidsPerPortion =
      picked && picked.lipids_g !== null ? round1(picked.lipids_g * factor) : null;
    const carbsPerPortion =
      picked && picked.carbs_g !== null ? round1(picked.carbs_g * factor) : null;

    const toPublic = (c: typeof candidates[number]): CiqualCandidatePublic => ({
      ciqualId: c.id,
      alimCode: c.alim_code,
      name: c.name,
      kcalPer100g: c.kcal_per_100g,
      proteinsG: c.proteins_g,
      lipidsG: c.lipids_g,
      carbsG: c.carbs_g,
    });

    out.push({
      label: picked ? picked.name : query,
      searchQuery: query,
      portions,
      approxGrams: grams,
      match: picked ? toPublic(picked) : null,
      kcalPerPortion,
      proteinsPerPortion,
      lipidsPerPortion,
      carbsPerPortion,
      // Si Mistral a rejeté tous les candidats mais qu'on en avait,
      // on les remonte au front pour que l'utilisatrice choisisse.
      fallbackCandidates:
        !picked && candidates.length > 0
          ? candidates.slice(0, 8).map(toPublic)
          : undefined,
    });
  }

  return NextResponse.json({ items: out });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Si le nom Ciqual commence par la query (ex: query="pomme",
 * name="Pomme, chair et peau, crue") → match évident, skip l'appel
 * Mistral. Économise un appel API quand la recherche est triviale.
 */
function isObviousMatch(query: string, name: string): boolean {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (n === q) return true;
  if (n.startsWith(q + ',') || n.startsWith(q + ' ')) return true;
  return false;
}

const PICK_PROMPT = `Tu es un assistant nutritionnel. Choisis dans une liste de candidats Ciqual ANSES celui qui correspond le mieux à un aliment mentionné dans une phrase.

SORTIE OBLIGATOIRE (JSON pur) :
{ "alim_code": <int|null>, "reason": "<courte explication>" }

- alim_code : code numérique du candidat retenu, OU null si aucun ne correspond raisonnablement.
- reason : 1 phrase ("plat préparé identique", "ingrédient principal", "aucun match correct").
- Préfère le candidat le plus PROCHE du plat décrit (pas un ingrédient si c'est un plat composé).
- Si plusieurs candidats sont équivalents, prends le plus court / le plus générique.
- Si tu n'es pas sûr → null.`;

type CiqualCandidate = Awaited<
  ReturnType<typeof searchCiqualFoods>
>[number];

async function pickBestCandidate(
  originalText: string,
  searchQuery: string,
  candidates: CiqualCandidate[],
): Promise<CiqualCandidate | null> {
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. alim_code=${c.alim_code} — "${c.name}"${
          c.kcal_per_100g !== null ? ` (${c.kcal_per_100g} kcal/100g)` : ''
        }`,
    )
    .join('\n');
  const userPrompt = `Phrase originale: "${originalText}"
Aliment recherché: "${searchQuery}"

Candidats Ciqual :
${list}`;
  try {
    const result = await callMistralJson(PICK_PROMPT, userPrompt, {
      maxTokens: 200,
      timeoutMs: 12_000,
    });
    const parsed = JSON.parse(result.content) as {
      alim_code?: number | null;
      reason?: string;
    };
    if (
      typeof parsed.alim_code !== 'number' ||
      !Number.isFinite(parsed.alim_code)
    )
      return null;
    return candidates.find((c) => c.alim_code === parsed.alim_code) ?? null;
  } catch {
    // Si Mistral plante, fallback sur le top 1 du scoring.
    return candidates[0] ?? null;
  }
}
