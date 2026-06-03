import Link from 'next/link';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/current-user';
import {
  getMyLatestPatientRequest,
  getRelanceCooldownDays,
} from '@/lib/patients';
import { getUserSubscription } from '@/lib/subscriptions';
import { PatientRequestStatusBlock } from '@/components/profil/PatientRequestStatusBlock';
import { MyPlanCard } from '@/components/profil/MyPlanCard';
import { AvatarUploader } from '@/components/profil/AvatarUploader';
import { HouseholdSizeCard } from '@/components/profil/HouseholdSizeCard';

export const dynamic = 'force-dynamic';

export default async function ProfilPage() {
  const user = await getCurrentUser();

  // Side fetches en parallèle pour limiter la latence cumulée
  const [latestRequest, cooldownDays, subscription, profileExtra] =
    await Promise.all([
      user.isAuthenticated && user.id
        ? getMyLatestPatientRequest(user.id)
        : Promise.resolve(null),
      getRelanceCooldownDays(),
      user.isAuthenticated && user.id
        ? getUserSubscription(user.id)
        : Promise.resolve(null),
      user.isAuthenticated && user.id
        ? (async () => {
            const supabase = await createClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data } = await (supabase as any)
              .from('profiles')
              .select('role, patient_access_expires_at, avatar_url, full_name, household_size')
              .eq('id', user.id)
              .maybeSingle();
            return data as {
              role?: string;
              patient_access_expires_at?: string | null;
              avatar_url?: string | null;
              full_name?: string | null;
              household_size?: number | null;
            } | null;
          })()
        : Promise.resolve(null),
    ]);

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-md xl:max-w-lg">
        <h1 className="mb-5 font-script text-4xl text-coral lg:text-5xl">Profil</h1>

        {user.isAuthenticated ? (
          <div className="space-y-4">
            <div className="space-y-4 rounded-2xl bg-white/85 p-6 shadow-sm">
              <div className="flex flex-col items-center gap-3">
                <AvatarUploader
                  initialUrl={profileExtra?.avatar_url ?? null}
                  displayName={
                    profileExtra?.full_name?.trim() || user.email?.split('@')[0] || '?'
                  }
                />
                {profileExtra?.full_name && (
                  <p className="text-center text-base font-bold text-ink">
                    {profileExtra.full_name}
                  </p>
                )}
              </div>
              <p className="text-center text-sm text-ink-soft">
                <span className="font-semibold">{user.email}</span>
              </p>
              {user.isAdmin && (
                <Link
                  href="/admin"
                  className="block rounded-full bg-coral px-4 py-2 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark"
                >
                  Espace admin
                </Link>
              )}
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="block w-full rounded-full border border-coral-soft bg-white px-4 py-2 text-center text-sm font-semibold text-coral-dark transition hover:bg-coral-soft/40"
                >
                  Se déconnecter
                </button>
              </form>
            </div>

            <HouseholdSizeCard initialSize={profileExtra?.household_size ?? 4} />

            <MyPlanCard
              role={profileExtra?.role ?? 'visitor'}
              patientExpiresAt={profileExtra?.patient_access_expires_at ?? null}
              subscription={subscription}
            />

            {/* Bloc demande patiente : visible seulement si la dernière demande
                est pending ou rejected (= statut intéressant pour l'utilisatrice). */}
            {latestRequest &&
              (latestRequest.status === 'pending' ||
                latestRequest.status === 'rejected') && (
                <PatientRequestStatusBlock
                  request={latestRequest}
                  cooldownDays={cooldownDays}
                />
              )}
          </div>
        ) : (
          <div className="space-y-4 rounded-2xl bg-white/85 p-6 shadow-sm">
            <p className="text-sm text-ink-soft">Vous n&apos;êtes pas encore connectée.</p>
            <Link
              href="/login"
              className="block rounded-full bg-coral px-4 py-2 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark"
            >
              Se connecter
            </Link>
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
