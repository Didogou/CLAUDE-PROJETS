import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type MealCategory = 'breakfast' | 'lunch' | 'snack' | 'dinner';
const MEAL_CATEGORIES: MealCategory[] = ['breakfast', 'lunch', 'snack', 'dinner'];

type IncomingEntry = {
  source: 'ciqual' | 'recipe' | 'menu' | 'free';
  sourceRefId?: string | null;
  label: string;
  kcal: number;
  proteinsG?: number | null;
  lipidsG?: number | null;
  carbsG?: number | null;
  portions?: number;
  mealCategory?: MealCategory | null;
};

/**
 * POST /api/nutrition/log
 * Body : { entries: IncomingEntry[] }
 *
 * Insère N entrées d'un coup dans food_log_entries. Utilisé par
 * la saisie naturelle après confirmation, et par le bouton +kcal
 * (1 seule entrée).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const entries: IncomingEntry[] = Array.isArray(body?.entries) ? body.entries : [];
  if (entries.length === 0) {
    return NextResponse.json({ error: 'entries vide' }, { status: 400 });
  }
  if (entries.length > 20) {
    return NextResponse.json({ error: 'Max 20 entrées par requête' }, { status: 400 });
  }

  // Catégorie globale optionnelle au niveau du body (s'applique à
  // tous les items du parse). Chaque entry peut overrider.
  const bodyMeal: MealCategory | null = MEAL_CATEGORIES.includes(body?.mealCategory)
    ? body.mealCategory
    : null;

  // Photo URL optionnelle : si fournie, on l'attache UNIQUEMENT à
  // la 1ère entry insérée. Au retour, le front retrouvera la photo
  // sur cette entry et la rendra en mini-vignette dans "Déjà ajouté".
  const photoUrl: string | null =
    typeof body?.photoUrl === 'string' && body.photoUrl.trim()
      ? body.photoUrl.trim()
      : null;

  const now = new Date().toISOString();
  const rows = entries
    .map((e, idx) =>
      sanitizeEntry(
        { ...e, mealCategory: e.mealCategory ?? bodyMeal },
        user.id,
        now,
        idx === 0 ? photoUrl : null,
      ),
    )
    .filter(Boolean);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Aucune entrée valide' }, { status: 400 });
  }

  const { error, data } = await (supabase as any)
    .from('food_log_entries')
    .insert(rows)
    .select('id');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ inserted: data?.length ?? 0 });
}

function sanitizeEntry(
  e: IncomingEntry,
  userId: string,
  now: string,
  photoUrl: string | null,
): Record<string, unknown> | null {
  if (!e || typeof e.label !== 'string' || !e.label.trim()) return null;
  if (typeof e.kcal !== 'number' || !Number.isFinite(e.kcal) || e.kcal < 0) return null;
  if (!['ciqual', 'recipe', 'menu', 'free'].includes(e.source)) return null;
  const portions =
    typeof e.portions === 'number' && Number.isFinite(e.portions) && e.portions > 0
      ? Math.min(e.portions, 100)
      : 1;
  return {
    user_id: userId,
    logged_at: now,
    source: e.source,
    source_ref_id: e.sourceRefId ?? null,
    label: e.label.trim().slice(0, 200),
    kcal: Math.min(Math.round(e.kcal), 9999),
    proteins_g:
      typeof e.proteinsG === 'number' && Number.isFinite(e.proteinsG) ? e.proteinsG : null,
    lipids_g:
      typeof e.lipidsG === 'number' && Number.isFinite(e.lipidsG) ? e.lipidsG : null,
    carbs_g: typeof e.carbsG === 'number' && Number.isFinite(e.carbsG) ? e.carbsG : null,
    portions,
    meal_category: MEAL_CATEGORIES.includes(e.mealCategory as MealCategory)
      ? e.mealCategory
      : null,
    photo_url: photoUrl,
  };
}
