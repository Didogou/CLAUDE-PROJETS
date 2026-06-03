import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MenusPagerView } from '@/components/menus/MenusPagerView';
import { getPublishedMenus } from '@/lib/menus';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function MenusPage() {
  const [menus, user] = await Promise.all([
    getPublishedMenus(),
    getCurrentUser(),
  ]);
  // Tuile image de la liste cachée pour les abonnés (la liste passe
  // par le bouton "Voir la liste" dans la page jour).
  const isSubscriber =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';

  return (
    <div className="relative flex min-h-screen flex-col print:bg-white">
      <div className="print:hidden">
        <FloralBackground />
      </div>
      <div className="print:hidden">
        <AppHeader />
      </div>
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-md xl:max-w-lg print:m-0 print:max-w-none print:p-0">
        <h1 className="mb-3 font-script text-4xl text-coral lg:mb-2 lg:text-3xl print:hidden">
          Mes menus
        </h1>
        <MenusPagerView menus={menus} hideShoppingListTile={isSubscriber} />
      </main>
      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
