import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { createServiceClient } from '@/lib/supabase/server';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/profile/age-verify
 *
 * Enregistre la date de naissance + le timestamp de verification d'age
 * (>= 15 ans) sur le profile. Appele juste apres signup reussi par
 * SignupForm. Refuse silencieusement si < 15 ans (le client a deja
 * verifie, c'est une defense en profondeur).
 *
 * Body : { birthDate: 'YYYY-MM-DD' }
 */

const MIN_AGE_YEARS = 15;

function isAtLeast15(birthDate: Date): boolean {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age >= MIN_AGE_YEARS;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const raw = typeof body?.birthDate === 'string' ? body.birthDate.trim() : '';
  // Format YYYY-MM-DD strict + parse safe.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: 'Date de naissance invalide' }, { status: 400 });
  }
  const birthDate = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime()) || birthDate > new Date()) {
    return NextResponse.json({ error: 'Date de naissance invalide' }, { status: 400 });
  }
  if (!isAtLeast15(birthDate)) {
    // Defense en profondeur (le client a deja bloque). On NE
    // persiste rien et on renvoie un message neutre.
    return NextResponse.json(
      { error: 'Application réservée aux 15 ans et plus.' },
      { status: 403 },
    );
  }
  const supabase = createServiceClient();
  // service_role bypass le trigger guard_profiles_self_update.
  const { error } = await (supabase as any)
    .from('profiles')
    .update({
      birth_date: raw,
      age_verified_at: new Date().toISOString(),
    })
    .eq('id', user.id);
  if (error) {
    console.error('[api/profile/age-verify]', error.message);
    return NextResponse.json(
      { error: 'Impossible d\'enregistrer la vérification.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
