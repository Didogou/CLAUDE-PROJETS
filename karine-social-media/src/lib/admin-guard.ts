import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Vérifie que la session courante est un admin.
 * À appeler au début de chaque route handler /api/admin/*.
 * Retourne une NextResponse 401/403 si refusé, sinon null.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé (admin requis)' }, { status: 403 });
  }
  return null;
}
