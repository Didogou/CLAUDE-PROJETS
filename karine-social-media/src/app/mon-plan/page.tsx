import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { createClient } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/subscriptions';
import { MonPlanView } from '@/components/mon-plan/MonPlanView';

export const dynamic = 'force-dynamic';

export default async function MonPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/mon-plan');

  // Cast à la volée car patient_access_expires_at n'est pas encore dans les
  // types Supabase générés (à régénérer avec `supabase gen types`).
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
  const params = await searchParams;

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
        />
      </main>
      <BottomNav />
    </div>
  );
}
