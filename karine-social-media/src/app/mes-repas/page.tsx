import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { HistoryView } from '@/components/nutrition/HistoryView';
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
      <AppHeader pageTitle="Mes repas" />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-24">
        <HistoryView />
      </main>
      <BottomNav />
    </div>
  );
}
