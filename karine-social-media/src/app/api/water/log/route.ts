import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/water/log
 * Body : { ml?: number } (optionnel — sinon utilise glass_size_ml de l'user)
 *
 * Insère UN verre. ml snapshot pour ne pas réécrire le passé si la
 * taille change.
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
  let ml: number | null =
    typeof body?.ml === 'number' && Number.isFinite(body.ml) && body.ml > 0
      ? Math.round(body.ml)
      : null;

  if (ml === null) {
    // Lit la taille par défaut de l'user.
    const { data: settings } = await (supabase as any)
      .from('user_water_settings')
      .select('glass_size_ml')
      .eq('user_id', user.id)
      .maybeSingle();
    ml = settings?.glass_size_ml ?? 150;
  }

  if (ml === null || ml <= 0 || ml > 2000) {
    return NextResponse.json({ error: 'ml hors bornes (1-2000)' }, { status: 400 });
  }

  const { error, data } = await (supabase as any)
    .from('water_log_entries')
    .insert({ user_id: user.id, ml })
    .select('id, logged_at, ml')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entry: data });
}
