import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getLast7DaysKcal } from '@/lib/nutrition';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nutrition/week-history
 *
 * Retourne les kcal cumulees par jour sur les 7 derniers jours
 * (J-6 → J0 inclus). Utilise par l'histogramme "Mon evolution"
 * sur la page /mes-calories.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const days = await getLast7DaysKcal(user.id);
  return NextResponse.json({ days });
}
