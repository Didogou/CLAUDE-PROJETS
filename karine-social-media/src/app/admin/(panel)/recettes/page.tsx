import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getAllRecipesAdmin } from '@/lib/recipes';
import { RecipesAdminList } from '@/components/admin/RecipesAdminList';

export const dynamic = 'force-dynamic';

export default async function AdminRecettesPage() {
  const recipes = await getAllRecipesAdmin();

  // Score Nutri-Score lu directement depuis les colonnes BDD persistées
  // par persistNutriscoreForSheet (au save admin). Plus de calcul à la
  // volée → temps de chargement quasi instantané.
  const scores: Record<
    string,
    { grade: 'A' | 'B' | 'C' | 'D' | 'E'; confidence: number }
  > = {};
  for (const r of recipes) {
    const sheet = r.sheets[0];
    if (!sheet?.nutriscoreGrade) continue;
    scores[String(r.id)] = {
      grade: sheet.nutriscoreGrade,
      confidence: sheet.nutriscoreConfidence ?? 0,
    };
  }

  // Adapte la forme des recipes pour le composant client (RecipesAdminList
  // ne s'intéresse qu'aux propriétés affichées + filtrables).
  const listRecipes = recipes.map((r) => ({
    id: String(r.id),
    title: r.title,
    category: r.category,
    calories: r.calories,
    coverImage: r.coverImage,
    isPublic: r.isPublic,
    isSeasonal: r.isSeasonal,
    status: r.status,
    slides: r.slides,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
            Contenu
          </p>
          <h2 className="font-script text-4xl text-admin-primary-dark">Recettes</h2>
        </header>
        <Link
          href="/admin/recettes/new"
          className="flex items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark"
        >
          <Plus className="h-4 w-4" /> Nouvelle
        </Link>
      </div>

      <RecipesAdminList recipes={listRecipes} scores={scores} />
    </div>
  );
}
