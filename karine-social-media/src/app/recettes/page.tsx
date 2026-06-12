import type { Metadata } from 'next';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { RecettesOngletsView } from '@/components/recettes/RecettesOngletsView';
import { getCachedPublishedRecipes } from '@/lib/cached-content';
import { getCurrentUser } from '@/lib/current-user';
import { getUserFavorites } from '@/lib/favorites';

// Page user-aware (favoris) mais le contenu RECETTES est caché 60s
// via unstable_cache + tag 'recipes' (invalidé au save admin).
export const dynamic = 'force-dynamic';

export type RecipeAvgScore = {
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  confidence: number;
};

const POINTS_BY_GRADE: Record<'A' | 'B' | 'C' | 'D' | 'E', number> = {
  A: -1,
  B: 1,
  C: 6,
  D: 14,
  E: 22,
};
const pointsToGrade = (pts: number): 'A' | 'B' | 'C' | 'D' | 'E' =>
  pts <= 0 ? 'A' : pts <= 2 ? 'B' : pts <= 10 ? 'C' : pts <= 18 ? 'D' : 'E';

export const metadata: Metadata = {
  title: 'Recettes · Karine Diététique',
};

/**
 * Page /recettes — vue à onglets horizontaux (11 catégories) avec
 * grille de recettes filtrée par l'onglet actif.
 *
 *   userHasPlan = patient/abonné/admin → accès complet aux recettes.
 *                 Sinon → recettes is_public uniquement, le reste avec
 *                 cadenas + redirect vers /mon-plan au clic.
 */
export default async function RecettesPage() {
  const [recipes, user] = await Promise.all([
    // Lite : exclut ingredients + ingredients_text du payload envoyé au
    // navigateur. Le détail n'est fetché qu'au clic, et seulement si
    // l'utilisatrice a un plan actif (gate dans /recettes/[id]/page.tsx).
    getCachedPublishedRecipes(),
    getCurrentUser(),
  ]);
  const userHasPlan =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';
  // Favoris pré-chargés pour pré-cocher les cœurs. Si non auth → set vide.
  const favoritedRecipeIds: string[] = user.id
    ? (await getUserFavorites(user.id))
        .filter((f) => f.targetType === 'recipe')
        .map((f) => f.targetId)
    : [];

  // Score moyen PAR recette : lit directement les colonnes BDD
  // nutriscore_grade + nutriscore_confidence (persistées par
  // persistNutriscoreForSheet au save admin). Plus aucun fetch Ciqual,
  // plus aucun calcul à la volée → temps de réponse en ms et non plus
  // en secondes.
  const recipeScores: Record<string, RecipeAvgScore> = {};
  for (const r of recipes) {
    const sheetPoints: number[] = [];
    const sheetConfs: number[] = [];
    for (const sheet of r.sheets) {
      if (!sheet.nutriscoreGrade) continue;
      if ((sheet.nutriscoreConfidence ?? 0) < 0.5) continue;
      sheetPoints.push(POINTS_BY_GRADE[sheet.nutriscoreGrade]);
      sheetConfs.push(sheet.nutriscoreConfidence ?? 0);
    }
    if (sheetPoints.length === 0) continue;
    const avgPts = sheetPoints.reduce((s, p) => s + p, 0) / sheetPoints.length;
    const avgConf = sheetConfs.reduce((s, c) => s + c, 0) / sheetConfs.length;
    recipeScores[String(r.id)] = {
      grade: pointsToGrade(avgPts),
      confidence: avgConf,
    };
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Fond dégradé rose Karine. Variant 'recettes' = fond dédié
          /admin/parametres/fonds, défini dans data/background-images. */}
      <FloralBackground variant="recettes" />

      <AppHeader pageTitle="Idées recettes" backHref="/" />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-8 sm:max-w-2xl sm:px-6 lg:max-w-5xl lg:px-8">
        <RecettesOngletsView
          recipes={recipes}
          userHasPlan={userHasPlan}
          recipeScores={recipeScores}
          initialFavoritedIds={favoritedRecipeIds}
          isAuthenticated={user.isAuthenticated}
        />
      </main>
      <BottomNav />
    </div>
  );
}
