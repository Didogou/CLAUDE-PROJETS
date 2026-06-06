import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { CategoryListView } from '@/components/recettes/CategoryListView';
import { getRecipesByCategory } from '@/lib/recipes';
import { userHasPlanAccess } from '@/lib/user-access';

export const dynamic = 'force-dynamic';

export default async function PlatsPage() {
  const [recipes, userHasPlan] = await Promise.all([getRecipesByCategory('plat'), userHasPlanAccess()]);
  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-7xl lg:px-10">
        <CategoryListView category="plat" recipes={recipes} userHasPlan={userHasPlan} />
      </main>
      <BottomNav />
    </div>
  );
}
