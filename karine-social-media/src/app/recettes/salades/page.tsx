import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { CategoryListView } from '@/components/recettes/CategoryListView';
import { getRecipesByCategory } from '@/lib/recipes';

export const dynamic = 'force-dynamic';

export default async function SaladesPage() {
  const recipes = await getRecipesByCategory('salade');
  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground variant="salade" />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-7xl lg:px-10">
        <CategoryListView category="salade" recipes={recipes} />
      </main>
      <BottomNav />
    </div>
  );
}
