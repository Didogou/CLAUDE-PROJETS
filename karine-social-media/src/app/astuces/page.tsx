import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { TipsGrid } from '@/components/astuces/TipsGrid';
import { TipsFireworkBurst } from '@/components/astuces/TipsFireworkBurst';
import { getCachedPublishedTips } from '@/lib/cached-content';
import { getTipCommentCounts } from '@/lib/comments';
import { getCurrentUser } from '@/lib/current-user';
import { getUserFavorites } from '@/lib/favorites';
import { userHasPlanAccess } from '@/lib/user-access';

export const dynamic = 'force-dynamic';

export default async function AstucesPage() {
  const user = await getCurrentUser();
  const tips = await getCachedPublishedTips();
  const [commentCounts, favRows, userHasPlan] = await Promise.all([
    getTipCommentCounts(tips.map((t) => t.id)),
    user.id ? getUserFavorites(user.id) : Promise.resolve([]),
    userHasPlanAccess(),
  ]);
  const favoritedSlugs = new Set(
    favRows.filter((r) => r.targetType === 'tip').map((r) => r.targetId),
  );
  return (
    <div className="relative flex min-h-screen flex-col print:hidden">
      {/* AppHeader DOIT être enfant direct du flex parent (sinon le
          wrapper scope son sticky et il décolle au scroll). Le parent
          a déjà print:hidden au niveau racine. */}
      <FloralBackground variant="astuces" />
      <AppHeader pageTitle="Astuces" backHref="/" />
      <main className="relative mx-auto w-full max-w-md flex-1 overflow-x-clip px-2 pb-8 sm:max-w-2xl sm:px-4 md:max-w-4xl md:px-6 lg:max-w-7xl lg:px-10 print:hidden">
        <div className="relative">
          <p className="mb-3 text-center text-xs italic text-ink-soft lg:text-sm">
            Les bons réflexes malins de Karine
          </p>
          <TipsFireworkBurst />
        </div>
        <TipsGrid
          tips={tips}
          commentCounts={commentCounts}
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
