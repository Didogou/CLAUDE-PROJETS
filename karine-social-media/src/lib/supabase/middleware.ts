import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';
import type { CapabilityKey } from '@/data/capabilities';
import { pathToCapability } from '@/lib/path-to-capability';

/**
 * Pipeline du proxy Next.js 16 :
 *  1. Refresh session Supabase (cookies).
 *  2. Protection /admin (existant) — exige une session.
 *  3. Check capabilities (CMS-style configurable depuis /admin/permissions).
 *
 * Modèle binaire "avec plan / sans plan" :
 *  - Avec plan (patient actif, subscriber actif, admin) → toujours OK.
 *  - Sans plan → autorisé seulement si la capability associée au path
 *    a allowed_without_plan = true en base.
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

  // === Check capabilities ===
  // Wrappé en try/catch : aucune erreur de permission ne doit faire planter
  // une page applicative. Skip explicite des routes système.
  try {
    if (shouldCheckPermissions(pathname)) {
      const capabilityKey = pathToCapability(pathname);
      if (capabilityKey) {
        const hasPlan = await userHasActivePlan(supabase, user?.id ?? null);
        if (!hasPlan) {
          const allowed = await isCapabilityAllowedWithoutPlan(
            supabase,
            capabilityKey,
          );
          if (!allowed) {
            const url = request.nextUrl.clone();
            url.pathname = '/mon-plan';
            url.searchParams.set('next', pathname);
            return NextResponse.redirect(url);
          }
        }
      }
    }
  } catch (err) {
    console.error('[proxy capabilities] erreur ignorée :', err);
  }

  return supabaseResponse;
}

function shouldCheckPermissions(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/auth/')) return false;
  if (pathname.startsWith('/_next/')) return false;
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
  // Section recettes ouverte aux visiteuses pour la découverte :
  //  - /recettes (catégories) → liste visible avec cadenas/badges
  //  - /recettes/[categorie] → grille avec cadenas sur les non-publiques
  //  - /recettes/[slug]      → la page détail redirige elle-même vers
  //    /mon-plan si la recette n'est pas is_public et que l'utilisatrice
  //    n'a pas de plan (gate côté server component, plus précis qu'un
  //    check capability générique).
  if (pathname.startsWith('/recettes')) return false;
  // Section menus : même logique. La liste affiche cadenas/badge sur
  // la cover des menus selon menu.is_public, et /menus/[id]/jour
  // redirige vers /mon-plan si non public + sans plan.
  if (pathname.startsWith('/menus')) return false;
  // Sections astuces et conseils : pareil. Liste avec voile cadenas
  // sur les non-publiques, modale ouvre uniquement si is_public OU
  // utilisatrice avec plan.
  if (pathname.startsWith('/astuces')) return false;
  if (pathname.startsWith('/conseils')) return false;
  return true;
}

/**
 * Lit la valeur allowed_without_plan d'une capability.
 * Défaut sécurisé en cas d'erreur : false (on bloque).
 */
async function isCapabilityAllowedWithoutPlan(
  supabase: ReturnType<typeof createServerClient<Database>>,
  key: CapabilityKey,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('capabilities')
    .select('allowed_without_plan')
    .eq('key', key)
    .maybeSingle();
  if (error || !data) return false;
  return !!data.allowed_without_plan;
}

/**
 * "A un plan actif" : patient.expires_at > now OU subscriber.status in
 * (trialing|active) avec current_period_end ok OU admin.
 */
async function userHasActivePlan(
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from('profiles')
    .select('role, patient_access_expires_at')
    .eq('id', userId)
    .maybeSingle();
  if (!profile) return false;

  if (profile.role === 'admin') return true;

  if (profile.role === 'patient') {
    const exp = profile.patient_access_expires_at as string | null;
    return !!(exp && new Date(exp) > new Date());
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
      if (!end || new Date(end) > new Date()) return true;
    }
  }

  return false;
}
