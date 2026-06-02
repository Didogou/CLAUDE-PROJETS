import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { TipsGrid } from '@/components/astuces/TipsGrid';
import { TipsFireworkBurst } from '@/components/astuces/TipsFireworkBurst';
import { getPublishedTips } from '@/lib/tips';
import { getTipCommentCounts } from '@/lib/comments';
import { getCurrentUser } from '@/lib/current-user';
import { getUserFavorites } from '@/lib/favorites';

export const dynamic = 'force-dynamic';

export default async function AstucesPage() {
  const user = await getCurrentUser();
  const tips = await getPublishedTips();
  const [commentCounts, favRows] = await Promise.all([
    getTipCommentCounts(tips.map((t) => t.id)),
    user.id ? getUserFavorites(user.id) : Promise.resolve([]),
  ]);
  const favoritedSlugs = new Set(
    favRows.filter((r) => r.targetType === 'tip').map((r) => r.targetId),
  );
  return (
    <div className="relative flex min-h-screen flex-col print:hidden">
      <div className="print:hidden">
        <FloralBackground variant="astuces" />
      </div>
      <div className="print:hidden">
        <AppHeader />
      </div>
      <main className="relative mx-auto w-full max-w-md flex-1 overflow-x-clip px-2 pb-8 sm:max-w-2xl sm:px-4 md:max-w-4xl md:px-6 lg:max-w-7xl lg:px-10 print:hidden">
        <div className="relative">
          <h1 className="mb-2 text-center font-script text-4xl text-coral lg:text-5xl">Astuces</h1>
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
        />
      </main>
      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
