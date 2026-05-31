import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MenusPagerView } from '@/components/menus/MenusPagerView';
import { getPublishedMenus } from '@/lib/menus';

export const dynamic = 'force-dynamic';

export default async function MenusPage() {
  const menus = await getPublishedMenus(); // déjà triés du + récent au + ancien

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
        <MenusPagerView menus={menus} />
      </main>
      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
