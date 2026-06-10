import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { HistoryView } from '@/components/nutrition/HistoryView';
import { AddMealButton } from '@/components/nutrition/AddMealButton';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function MesRepasPage() {
  const user = await getCurrentUser();

  if (!user.isAuthenticated || !user.id) {
    redirect('/login?next=/mes-repas');
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      {/* Layout aligne sur /recettes : fleche back (pas de burger),
          padding identique. AddMealButton sous le header pour
          declencher l'ajout d'un repas (modale 4 choix). */}
      <AppHeader pageTitle="Mes repas" backHref="/" />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-24 sm:max-w-2xl sm:px-6">
        <div className="mb-4">
          <AddMealButton />
        </div>
        <HistoryView />
      </main>
      <BottomNav />
    </div>
  );
}
