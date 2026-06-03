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
 * Pipeline :
 *  1) Mistral extrait les aliments en JSON {items: [{search_query,
 *     portions, approx_grams}, …]}.
 *  2) Pour chaque item, recherche Ciqual (ilike + trigram).
 *  3) Calcule kcal pour 1 portion = kcal_per_100g × approx_grams/100.
 *  4) Retourne preview pour confirmation côté UI (PAS d'insert).
 *
 * Si Ciqual ne trouve rien : item retourné avec source='free' et
 * kcal=null (utilisatrice peut éditer ou supprimer dans la preview).
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
- search_query : nom GÉNÉRIQUE FR pour rechercher dans la base ANSES Ciqual. Préfère le nom courant ("pomme" pas "pomme golden bio"). Si l'aliment est composé en plusieurs ingrédients distincts mentionnés, sépare en items distincts.
- portions : nombre de portions standard mentionné (1 yaourt = 1, 2 pommes = 2, "demi sandwich" = 0.5).
- approx_grams : masse approximative en grammes pour UNE portion (pomme ≈ 150g, yaourt ≈ 125g, tranche de pain ≈ 30g, sandwich ≈ 200g, bol de pâtes cuites ≈ 250g).
- Si une masse précise est donnée ("500g de pâtes") : portions=1 et approx_grams=500.
- N'invente pas. Si vague ("un repas", "des trucs"), IGNORE l'item.
- Maximum 10 items. Toujours répondre en JSON valide même si la phrase est vague (items vide si rien d'identifiable).`;

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

    // Recherche Ciqual : on prend le top 1 par défaut.
    const candidates = await searchCiqualFoods(query, 1);
    const top = candidates[0] ?? null;
    const factor = grams / 100;
    const kcalPerPortion =
      top && top.kcal_per_100g !== null ? round1(top.kcal_per_100g * factor) : null;
    const proteinsPerPortion =
      top && top.proteins_g !== null ? round1(top.proteins_g * factor) : null;
    const lipidsPerPortion =
      top && top.lipids_g !== null ? round1(top.lipids_g * factor) : null;
    const carbsPerPortion =
      top && top.carbs_g !== null ? round1(top.carbs_g * factor) : null;

    out.push({
      label: top ? top.name : query,
      searchQuery: query,
      portions,
      approxGrams: grams,
      match: top
        ? {
            ciqualId: top.id,
            alimCode: top.alim_code,
            name: top.name,
            kcalPer100g: top.kcal_per_100g,
            proteinsG: top.proteins_g,
            lipidsG: top.lipids_g,
            carbsG: top.carbs_g,
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
