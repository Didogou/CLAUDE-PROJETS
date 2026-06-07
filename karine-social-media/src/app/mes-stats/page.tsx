import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MesStatsView } from '@/components/nutrition/MesStatsView';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

/**
 * Page "Mes Stats" — vue d'ensemble nutritionnelle de la patiente :
 *  - Mes infos (sexe, âge, poids, taille, activité, objectif, eau)
 *  - Mon poids (graphe + ligne objectif)
 *  - Équilibre alimentaire (3 anneaux G / L / P sur 7j / 30j / 90j)
 *
 * Réservée aux utilisatrices connectées. Visiteuses → /login direct.
 */
export default async function MesStatsPage() {
  const user = await getCurrentUser();
  if (!user.isAuthenticated) {
    redirect('/login?next=/mes-stats');
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader pageTitle="Mes stats" />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-2xl">
        <MesStatsView />
      </main>
      <BottomNav />
    </div>
  );
}
