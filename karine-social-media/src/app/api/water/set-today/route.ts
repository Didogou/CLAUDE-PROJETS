import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getWaterDayState } from '@/lib/water';

/**
 * POST /api/water/set-today
 * Body : { count: number } — nombre de verres bus TOTAL pour aujourd'hui.
 *
 * Reconcilie l'état avec le nombre demandé :
 *  - count > current → insère (count - current) verres avec la taille
 *    par défaut.
 *  - count < current → supprime les (current - count) entries les
 *    PLUS RÉCENTES (sécurise contre la perte d'historique ancien).
 *  - count === current → no-op.
 *
 * Utilisé par le picker du cercle bleu de la sheet calorie V2 pour
 * laisser l'abonnée corriger directement le total de verres bus.
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
  const requested =
    typeof body?.count === 'number' && Number.isFinite(body.count)
      ? Math.round(body.count)
      : null;

  if (requested === null || requested < 0 || requested > 50) {
    return NextResponse.json(
      { error: 'count hors bornes (0-50)' },
      { status: 400 },
    );
  }

  // État courant pour calculer le delta
  const state = await getWaterDayState(user.id);
  const current = state.glassesCount;
  const delta = requested - current;

  if (delta === 0) {
    return NextResponse.json({ ok: true, count: current });
  }

  if (delta > 0) {
    // INSERT delta verres (lit la taille pour snapshot)
    const { data: settings } = await (supabase as any)
      .from('user_water_settings')
      .select('glass_size_ml')
      .eq('user_id', user.id)
      .maybeSingle();
    const ml = settings?.glass_size_ml ?? 150;
    const rows = Array.from({ length: delta }, () => ({
      user_id: user.id,
      ml,
    }));
    const { error } = await (supabase as any)
      .from('water_log_entries')
      .insert(rows);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    // DELETE -delta entries les plus récentes (state.entries est déjà
    // trié desc par logged_at dans getWaterDayState)
    const toDelete = state.entries.slice(0, -delta).map((e) => e.id);
    if (toDelete.length > 0) {
      const { error } = await (supabase as any)
        .from('water_log_entries')
        .delete()
        .eq('user_id', user.id)
        .in('id', toDelete);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true, count: requested });
}
