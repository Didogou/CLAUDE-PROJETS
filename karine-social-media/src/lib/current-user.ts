import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AppRole } from '@/data/roles';

export type CurrentUser = {
  id: string | null;
  email: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  /** Rôle "effectif" : résout patient expiré → visitor, sub canceled → visitor, etc. */
  effectiveRole: AppRole;
};

/**
 * Récupère l'utilisateur connecté + son rôle effectif.
 *  - Pas de session   → visitor
 *  - role=admin       → admin
 *  - role=patient     → patient si patient_access_expires_at > now, sinon visitor
 *  - role=subscriber  → subscriber si abo actif (trialing/active), sinon visitor
 *  - autre            → visitor
 *
 * Renvoie un objet avec valeurs par défaut si non connecté ou erreur.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const def: CurrentUser = {
    id: null,
    email: null,
    isAuthenticated: false,
    isAdmin: false,
    effectiveRole: 'visitor',
  };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return def;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('role, patient_access_expires_at')
      .eq('id', user.id)
      .maybeSingle();

    const role = (profile?.role as string | undefined) ?? 'visitor';

    let effective: AppRole = 'visitor';
    if (role === 'admin') {
      effective = 'admin';
    } else if (role === 'patient') {
      const exp = profile?.patient_access_expires_at as string | null | undefined;
      effective = exp && new Date(exp) > new Date() ? 'patient' : 'visitor';
    } else if (role === 'subscriber') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: sub } = await (supabase as any)
        .from('subscriptions')
        .select('status, current_period_end')
        .eq('user_id', user.id)
        .in('status', ['trialing', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sub) {
        const end = sub.current_period_end as string | null;
        if (!end || new Date(end) > new Date()) effective = 'subscriber';
      }
    }

    return {
      id: user.id,
      email: user.email ?? null,
      isAuthenticated: true,
      isAdmin: role === 'admin',
      effectiveRole: effective,
    };
  } catch {
    return def;
  }
}
