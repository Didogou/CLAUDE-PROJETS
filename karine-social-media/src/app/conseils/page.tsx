import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { AdviceGrid } from '@/components/conseils/AdviceGrid';
import { AdviceFireworkBurst } from '@/components/conseils/AdviceFireworkBurst';
import { getPublishedAdvice } from '@/lib/advice';
import { getCurrentUser } from '@/lib/current-user';
import { getUserFavorites } from '@/lib/favorites';
import { userHasPlanAccess } from '@/lib/user-access';

export const dynamic = 'force-dynamic';

export default async function ConseilsPage() {
  const user = await getCurrentUser();
  const [items, favRows, userHasPlan] = await Promise.all([
    getPublishedAdvice(),
    user.id ? getUserFavorites(user.id) : Promise.resolve([]),
    userHasPlanAccess(),
  ]);
  const favoritedSlugs = new Set(
    favRows.filter((r) => r.targetType === 'advice').map((r) => r.targetId),
  );

  return (
    <div className="relative flex min-h-screen flex-col print:hidden">
      {/* AppHeader DOIT être enfant direct du flex parent (sinon le
          wrapper scope son sticky et il décolle au scroll). Le parent
          a déjà print:hidden au niveau racine donc tout est masqué
          à l'impression. */}
      <FloralBackground variant="conseils" />
      <AppHeader pageTitle="Conseils santé" backHref="/" />
      <main className="relative mx-auto w-full max-w-md flex-1 overflow-x-clip px-2 pb-8 sm:max-w-2xl sm:px-4 md:max-w-4xl md:px-6 lg:max-w-7xl lg:px-10 print:hidden">
        <div className="relative">
          <p className="mb-3 text-center text-xs italic text-ink-soft lg:text-sm">
            Mieux comprendre votre santé, jour après jour
          </p>
          <AdviceFireworkBurst />
        </div>
        <AdviceGrid
          items={items}
          isAuthenticated={user.isAuthenticated}
          favoritedSlugs={favoritedSlugs}
          userHasPlan={userHasPlan}
        />
      </main>
      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
