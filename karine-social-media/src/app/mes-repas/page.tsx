import { Flame } from 'lucide-react';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { HistoryView } from '@/components/nutrition/HistoryView';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function MesRepasPage() {
  const user = await getCurrentUser();

  if (!user.isAuthenticated || !user.id) {
    return (
      <div className="relative flex min-h-screen flex-col">
        <FloralBackground />
        <AppHeader />
        <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8">
          <h1 className="mb-5 font-script text-4xl text-coral lg:text-5xl">
            Mes repas
          </h1>
          <div className="space-y-4 rounded-2xl bg-white/85 p-6 shadow-sm">
            <Flame className="mx-auto h-10 w-10 text-coral" />
            <p className="text-center text-sm text-ink">
              Connecte-toi pour retrouver l&apos;historique de tes repas,
              leurs photos et tes apports caloriques au fil des jours.
            </p>
          </div>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-24">
        <h1 className="mb-5 font-script text-4xl text-coral lg:text-5xl">
          Mes repas
        </h1>
        <HistoryView />
      </main>
      <BottomNav />
    </div>
  );
}
