import Link from 'next/link';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { getCurrentUser } from '@/lib/current-user';
import {
  getMyLatestPatientRequest,
  getRelanceCooldownDays,
} from '@/lib/patients';
import { PatientRequestStatusBlock } from '@/components/profil/PatientRequestStatusBlock';

export const dynamic = 'force-dynamic';

export default async function ProfilPage() {
  const user = await getCurrentUser();

  // Si connecté, on récupère la demande patiente la plus récente pour afficher
  // son statut (pending / rejected) + bouton relancer.
  const latestRequest =
    user.isAuthenticated && user.id
      ? await getMyLatestPatientRequest(user.id)
      : null;
  const cooldownDays = await getRelanceCooldownDays();

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-md xl:max-w-lg">
        <h1 className="mb-5 font-script text-4xl text-coral lg:text-5xl">Profil</h1>

        {user.isAuthenticated ? (
          <div className="space-y-4">
            <div className="space-y-4 rounded-2xl bg-white/85 p-6 shadow-sm">
              <p className="text-sm text-ink">
                Connectée en tant que <span className="font-bold">{user.email}</span>
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
