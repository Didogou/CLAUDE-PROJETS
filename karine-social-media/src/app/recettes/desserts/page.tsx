import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { CategoryListView } from '@/components/recettes/CategoryListView';
import { getRecipesByCategory } from '@/lib/recipes';
import { userHasPlanAccess } from '@/lib/user-access';

export const dynamic = 'force-dynamic';

export default async function DessertsPage() {
  const [recipes, userHasPlan] = await Promise.all([getRecipesByCategory('dessert'), userHasPlanAccess()]);
  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground variant="dessert" />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-7xl lg:px-10">
        <CategoryListView category="dessert" recipes={recipes} userHasPlan={userHasPlan} />
      </main>
      <BottomNav />
    </div>
  );
}
