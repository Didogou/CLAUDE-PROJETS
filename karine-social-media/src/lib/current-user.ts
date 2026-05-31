import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type CurrentUser = {
  id: string | null;
  email: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
};

/**
 * Récupère l'utilisateur connecté + son rôle (admin si profiles.role = 'admin').
 * Renvoie un objet avec valeurs par défaut si non connecté ou erreur.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const def: CurrentUser = { id: null, email: null, isAuthenticated: false, isAdmin: false };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return def;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    return {
      id: user.id,
      email: user.email ?? null,
      isAuthenticated: true,
      isAdmin: profile?.role === 'admin',
    };
  } catch {
    return def;
  }
}
