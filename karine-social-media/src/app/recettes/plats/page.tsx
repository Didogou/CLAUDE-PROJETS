import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { CategoryListView } from '@/components/recettes/CategoryListView';
import { getRecipesByCategory } from '@/lib/recipes';

export const dynamic = 'force-dynamic';

export default async function PlatsPage() {
  const recipes = await getRecipesByCategory('plat');
  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-7xl lg:px-10">
        <CategoryListView category="plat" recipes={recipes} />
      </main>
      <BottomNav />
    </div>
  );
}
