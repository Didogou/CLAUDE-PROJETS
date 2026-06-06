import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { RecipesShell } from '@/components/recettes/RecipesShell';
import { getCategoryDecks, getPublishedRecipes } from '@/lib/recipes';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function RecettesPage() {
  const [recipes, decks, user] = await Promise.all([
    getPublishedRecipes(),
    getCategoryDecks(),
    getCurrentUser(),
  ]);
  // userHasPlan : utilisatrice avec accès complet aux recettes (toutes
  // catégories). Sinon → seules les recettes is_public sont cliquables,
  // les autres affichent un cadenas qui redirige vers /mon-plan.
  const userHasPlan =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <RecipesShell
        appHeader={<AppHeader withSlogan />}
        recipes={recipes}
        decks={decks}
        userHasPlan={userHasPlan}
      />
      <BottomNav />
    </div>
  );
}
