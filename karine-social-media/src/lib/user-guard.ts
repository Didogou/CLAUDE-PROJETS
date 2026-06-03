import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Vérifie qu'un utilisateur est connecté + renvoie son id et son
 * household_size (1 query). Utilisé pour les routes /api/shopping-list/*
 * et autres endpoints user-scoped.
 *
 * Retourne :
 *   - { error: NextResponse } si non authentifié → propager directement
 *   - { user: { id, householdSize } } si OK
 */
export async function requireUserWithHousehold(): Promise<
  | { error: NextResponse }
  | { user: { id: string; householdSize: number } }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }),
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from('profiles')
    .select('household_size')
    .eq('id', user.id)
    .maybeSingle();
  const householdSize =
    typeof profile?.household_size === 'number' && profile.household_size > 0
      ? profile.household_size
      : 4;
  return { user: { id: user.id, householdSize } };
}
