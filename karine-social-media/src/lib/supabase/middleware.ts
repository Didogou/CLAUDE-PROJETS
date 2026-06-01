import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';

type AppRole = 'visitor' | 'patient' | 'subscriber' | 'admin';

/**
 * Pipeline du proxy Next.js 16 :
 *  1. Refresh session Supabase (cookies).
 *  2. Protection /admin (existant) — exige une session.
 *  3. Check page_permissions (CMS-style configurable depuis /admin/permissions).
 *
 * IMPORTANT : ne PAS modifier la logique entre createServerClient et getUser
 * sinon le refresh token peut casser et déconnecter l'utilisateur.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAdminLogin = pathname === '/admin/login' || pathname.startsWith('/admin/login/');
  const isAdminRoute = pathname.startsWith('/admin');

  if (isAdminRoute && !isAdminLogin && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // === Check page_permissions ===
  // Wrappé en try/catch : aucune erreur de permission ne doit faire planter
  // une page applicative. Skip explicite des routes système.
  try {
    if (shouldCheckPermissions(pathname)) {
      const rule = await findPermissionForPath(supabase, pathname);
      if (rule) {
        const effectiveRole = await computeEffectiveRole(supabase, user?.id ?? null);
        if (!rule.allowedRoles.includes(effectiveRole)) {
          const url = request.nextUrl.clone();
          url.pathname = '/login';
          url.searchParams.set('next', pathname);
          url.searchParams.set('reason', 'forbidden');
          return NextResponse.redirect(url);
        }
      }
    }
  } catch (err) {
    console.error('[proxy permissions] erreur ignorée :', err);
  }

  return supabaseResponse;
}

function shouldCheckPermissions(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/auth/')) return false;
  if (pathname.startsWith('/_next/')) return false;
  // Pages d'auth toujours accessibles publiquement (anti-loop)
  if (pathname === '/login') return false;
  if (pathname === '/signup') return false;
  if (pathname === '/mot-de-passe-oublie') return false;
  if (pathname === '/nouveau-mot-de-passe') return false;
  if (pathname === '/admin/login') return false;
  if (pathname === '/manifest.webmanifest') return false;
  if (pathname === '/sw.js') return false;
  if (pathname === '/favicon.ico') return false;
  if (pathname === '/robots.txt') return false;
  if (pathname === '/sitemap.xml') return false;
  return true;
}

/**
 * Cherche la règle la plus spécifique pour un chemin (match exact ou ancêtre).
 * Ex. pour /recettes/abc on cherche /recettes/abc, /recettes, /
 * et on retourne la règle dont le path est le plus long parmi les matchs.
 */
async function findPermissionForPath(
  supabase: ReturnType<typeof createServerClient<Database>>,
  path: string,
): Promise<{ path: string; allowedRoles: AppRole[] } | null> {
  const candidates = expandPath(path);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('page_permissions')
    .select('path, allowed_roles')
    .in('path', candidates);
  if (error || !data || data.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data as any[]).sort(
    (a, b) => (b.path as string).length - (a.path as string).length,
  );
  return {
    path: rows[0].path as string,
    allowedRoles: (rows[0].allowed_roles ?? []) as AppRole[],
  };
}

function expandPath(path: string): string[] {
  const clean = path.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  const parts = clean.split('/').filter(Boolean);
  const out: string[] = [clean];
  for (let i = parts.length - 1; i >= 1; i--) {
    out.push('/' + parts.slice(0, i).join('/'));
  }
  if (!out.includes('/')) out.push('/');
  return out;
}

/**
 * Rôle "effectif" : résout l'expiration patient + status de l'abonnement.
 *  - Pas de session  → visitor
 *  - role=admin       → admin
 *  - role=patient     → patient si expires_at > now, sinon visitor
 *  - role=subscriber  → subscriber si abo actif, sinon visitor
 *  - autre            → visitor
 */
async function computeEffectiveRole(
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string | null,
): Promise<AppRole> {
  if (!userId) return 'visitor';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from('profiles')
    .select('role, patient_access_expires_at')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return 'visitor';
  if (profile.role === 'admin') return 'admin';

  if (profile.role === 'patient') {
    const exp = profile.patient_access_expires_at as string | null;
    if (exp && new Date(exp) > new Date()) return 'patient';
    return 'visitor';
  }

  if (profile.role === 'subscriber') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sub } = await (supabase as any)
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', userId)
      .in('status', ['trialing', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sub) {
      const end = sub.current_period_end as string | null;
      if (!end || new Date(end) > new Date()) return 'subscriber';
    }
    return 'visitor';
  }

  return 'visitor';
}
