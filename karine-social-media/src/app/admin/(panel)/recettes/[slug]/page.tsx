import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getRecipeAdminBySlug } from '@/lib/recipes';
import { EditRecipeForm } from '@/components/admin/EditRecipeForm';
import { RecipeSheetsEditor } from '@/components/admin/RecipeSheetsEditor';

export const dynamic = 'force-dynamic';

export default async function AdminEditRecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const recipe = await getRecipeAdminBySlug(slug);
  if (!recipe) notFound();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/recettes"
          aria-label="Retour"
          className="grid h-10 w-10 place-items-center rounded-full bg-admin-surface text-admin-ink transition hover:bg-admin-soft/40"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">Modifier</p>
          <h2 className="truncate font-script text-3xl text-admin-primary-dark">{recipe.title}</h2>
        </div>
      </div>

      <EditRecipeForm recipe={recipe} />

      <RecipeSheetsEditor recipeSlug={recipe.id} initialSheets={recipe.sheets} />
    </div>
  );
}
