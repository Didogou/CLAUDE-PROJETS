import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { createClient } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/subscriptions';
import { MonPlanView } from '@/components/mon-plan/MonPlanView';
import type { PlanKind } from '@/data/plans';

export const dynamic = 'force-dynamic';

/**
 * /mon-plan est accessible aux VISITEURS (pas de redirect login).
 * Le visiteur peut comparer les plans librement ; la pop-up auth ne s'ouvre
 * que s'il clique sur un bouton de souscription.
 *
 * ⚠️ Sécurité : le checkout passe par /api/checkout qui requireAuth().
 * Un visiteur qui contourne l'UI client recevra 401 Non authentifié.
 */
export default async function MonPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; plan?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const params = await searchParams;

  // Plan à auto-déclencher après auth (cf. flow Stripe : visiteur clique plan
  // → s'inscrit/se connecte → revient ici avec ?plan=monthly → auto-checkout).
  // On filtre pour ne garder qu'un PlanKind valide, jamais quoi que ce soit
  // d'autre venant de la query string.
  const requestedPlan: PlanKind | null =
    params.plan === 'monthly' || params.plan === 'yearly'
      ? (params.plan as PlanKind)
      : null;

  if (!user) {
    return (
      <div className="relative flex min-h-screen flex-col">
        <FloralBackground />
        <AppHeader />
        <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-3xl lg:px-10">
          <MonPlanView
            email=""
            role="visitor"
            patientExpiresAt={null}
            subscription={null}
            checkoutStatus={params.checkout ?? null}
            requestedPlan={null}
          />
        </main>
        <BottomNav />
      </div>
    );
  }

  // Cast à la volée car patient_access_expires_at pas dans les types Supabase générés
  const { data: profileRaw } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('profiles' as any)
    .select('role, patient_access_expires_at, full_name, email')
    .eq('id', user.id)
    .maybeSingle();

  const profile = (profileRaw ?? null) as {
    role?: string;
    patient_access_expires_at?: string | null;
    full_name?: string | null;
    email?: string | null;
  } | null;

  const subscription = await getUserSubscription(user.id);

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-3xl lg:px-10">
        <MonPlanView
          email={user.email ?? profile?.email ?? ''}
          role={profile?.role ?? 'visitor'}
          patientExpiresAt={profile?.patient_access_expires_at ?? null}
          subscription={subscription}
          checkoutStatus={params.checkout ?? null}
          requestedPlan={requestedPlan}
        />
      </main>
      <BottomNav />
    </div>
  );
}
