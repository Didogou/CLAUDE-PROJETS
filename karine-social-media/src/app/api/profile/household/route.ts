import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * PATCH /api/profile/household
 * Body : { householdSize: number }
 *
 * Met à jour la taille du foyer de l'user (1 à 20). Utilisé pour
 * calibrer la liste de courses à chaque ajout de recette / menu.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const raw = body?.householdSize;
    const value =
      typeof raw === 'number' && Number.isFinite(raw)
        ? Math.round(raw)
        : typeof raw === 'string' && Number.isFinite(Number(raw))
          ? Math.round(Number(raw))
          : null;
    if (value === null || value < 1 || value > 20) {
      return NextResponse.json(
        { error: 'Taille de foyer invalide (1 à 20).' },
        { status: 400 },
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('profiles')
      .update({ household_size: value })
      .eq('id', user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true, householdSize: value });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
