import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { RecipesShell } from '@/components/recettes/RecipesShell';
import { getCategoryDecks, getPublishedRecipes } from '@/lib/recipes';

export const dynamic = 'force-dynamic';

export default async function RecettesPage() {
  const [recipes, decks] = await Promise.all([getPublishedRecipes(), getCategoryDecks()]);

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <RecipesShell appHeader={<AppHeader withSlogan />} recipes={recipes} decks={decks} />
      <BottomNav />
    </div>
  );
}
