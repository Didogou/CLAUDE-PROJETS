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
  search_query?: string;
  portions?: number;
  approx_grams?: number;
};

type ParsedItem = {
  label: string;
  searchQuery: string;
  portions: number;
  approxGrams: number;
  match: {
    ciqualId: number;
    alimCode: number;
    name: string;
    kcalPer100g: number | null;
    proteinsG: number | null;
    lipidsG: number | null;
    carbsG: number | null;
  } | null;
  // Kcal pour 1 portion (à multiplier par portions côté UI).
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
};

const SYSTEM_PROMPT = `Tu es un assistant nutritionnel français. L'utilisatrice décrit en français ce qu'elle a mangé. Extrais les aliments mentionnés.

SORTIE OBLIGATOIRE (JSON pur sans markdown) :
{
  "items": [
    { "search_query": "yaourt nature", "portions": 1, "approx_grams": 125 }
  ]
}

Règles strictes :
- search_query : nom à chercher dans la base ANSES Ciqual (qui contient ~3500 aliments ET plats préparés courants).
- **NE DÉCOMPOSE PAS LES PLATS COMPOSÉS** en mot unique. Ciqual contient les plats préparés français :
    "aligot" → search_query="aligot" (PAS "pomme de terre, tomme, ail")
    "ratatouille" → "ratatouille"
    "paella" → "paella"
    "choucroute" → "choucroute"
    "hachis parmentier" → "hachis parmentier"
    "lasagnes" → "lasagnes"
    "tartiflette" → "tartiflette"
    "couscous" → "couscous"
    "quiche lorraine" → "quiche lorraine"
    "tiramisu" → "tiramisu"
- Décompose UNIQUEMENT si l'utilisatrice liste explicitement plusieurs aliments distincts avec "et" / "puis" / "," :
    "une pomme et un yaourt" = 2 items
    "des pâtes et une salade" = 2 items
- Préfère le nom courant ("pomme" pas "pomme golden bio").
- portions : nombre de portions standard mentionné (1 yaourt = 1, 2 pommes = 2, "demi sandwich" = 0.5).
- approx_grams : masse en grammes pour UNE portion :
    pomme≈150, yaourt≈125, tranche pain≈30, sandwich≈200, bol pâtes/riz cuites≈250, assiette plat principal≈300, plat composé (aligot, lasagnes, paella…)≈250.
- Si masse précise donnée ("500g de pâtes") : portions=1, approx_grams=500.
- En cas de doute sur un nom unique : RENVOIE-LE TEL QUEL en search_query — Ciqual fera le match ou pas.
- Si vraiment vague ("un repas", "des trucs", "pas grand chose") : IGNORE l'item.
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
    const query =
      typeof it.search_query === 'string' ? it.search_query.trim() : '';
    if (!query) continue;
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

    // Étape 2a : large pool de candidats Ciqual
    const candidates = await searchCiqualFoods(query, 15);
    type Picked = (typeof candidates)[number] | null;
    let picked: Picked = candidates[0] ?? null;

    // Étape 2d : si plusieurs candidats et pas de match évident, on
    // demande à Mistral de choisir avec le contexte de la phrase.
    if (candidates.length > 1 && !isObviousMatch(query, candidates[0].name)) {
      const better = await pickBestCandidate(text, query, candidates);
      if (better) {
        picked = better;
      } else {
        // Mistral dit "aucun pertinent" → on traite comme free entry.
        picked = null;
      }
    }

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

    out.push({
      label: picked ? picked.name : query,
      searchQuery: query,
      portions,
      approxGrams: grams,
      match: picked
        ? {
            ciqualId: picked.id,
            alimCode: picked.alim_code,
            name: picked.name,
            kcalPer100g: picked.kcal_per_100g,
            proteinsG: picked.proteins_g,
            lipidsG: picked.lipids_g,
            carbsG: picked.carbs_g,
          }
        : null,
      kcalPerPortion,
      proteinsPerPortion,
      lipidsPerPortion,
      carbsPerPortion,
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
