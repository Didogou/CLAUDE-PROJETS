import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { searchCiqualFoods } from '@/lib/ciqual';

/**
 * GET /api/nutrition/search?q=...
 *
 * Recherche libre dans Ciqual depuis l'UI (autocomplete /
 * "chercher autre chose" quand le parsing IA n'a pas trouvé).
 *
 * Retourne top 15 candidats triés par pertinence
 * (cf. searchCiqualFoods).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ items: [] });
  }

  const candidates = await searchCiqualFoods(q, 15);
  const items = candidates.map((c) => ({
    ciqualId: c.id,
    alimCode: c.alim_code,
    name: c.name,
    kcalPer100g: c.kcal_per_100g,
    proteinsG: c.proteins_g,
    lipidsG: c.lipids_g,
    carbsG: c.carbs_g,
  }));
  return NextResponse.json({ items });
}
