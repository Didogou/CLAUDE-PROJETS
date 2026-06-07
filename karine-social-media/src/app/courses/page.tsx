import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { ShoppingListPage } from '@/components/courses/ShoppingListPage';
import { getCurrentUser } from '@/lib/current-user';
import { getOrCreateActiveList } from '@/lib/shopping-lists';
import { getPublishedMenus } from '@/lib/menus';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    redirect('/login?next=/courses');
  }

  const [list, menus] = await Promise.all([
    getOrCreateActiveList(user.id),
    getPublishedMenus(),
  ]);

  // Cover du menu de la semaine = le menu publié le plus récent
  const currentMenu = menus[0] ?? null;

  return (
    <div className="relative flex min-h-screen flex-col print:bg-white">
      {/* FloralBackground et AppHeader DOIVENT être enfants directs du
          flex parent pour que `sticky top-0` du header reste actif tout
          au long du scroll. Avant : ils étaient dans un wrapper
          print:hidden qui scopait le sticky → l'header décollait dès
          qu'on dépassait sa propre hauteur (~80 px). On garde le
          print:hidden directement sur chaque enfant. */}
      <FloralBackground />
      <AppHeader pageTitle="Mes courses" />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-2xl print:max-w-none print:px-0 print:pb-0">
        <div className="mb-4 flex items-center justify-end gap-2 print:hidden">
          <Link
            href="/courses/historique"
            className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-coral-dark shadow-sm transition hover:bg-white"
          >
            Historique
          </Link>
        </div>

        <ShoppingListPage initialList={list} currentMenu={currentMenu} />
      </main>
      <div className="print:hidden">
        <BottomNav />
      </div>
      <style>{`
        @media print {
          @page { margin: 1.2cm; }
          html, body { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}
