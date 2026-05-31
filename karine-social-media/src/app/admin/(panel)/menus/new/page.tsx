import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { MenuForm } from '@/components/admin/MenuForm';
import { getAllRecipesAdmin } from '@/lib/recipes';

export const dynamic = 'force-dynamic';

export default async function NewMenuPage() {
  const recipes = await getAllRecipesAdmin();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/menus"
          aria-label="Retour aux menus"
          className="grid h-10 w-10 place-items-center rounded-full bg-admin-surface text-admin-ink-soft transition hover:bg-admin-soft/50"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
            Nouveau menu
          </p>
          <h2 className="font-script text-3xl text-admin-primary-dark">Composer la semaine</h2>
        </header>
      </div>

      <MenuForm recipeOptions={recipes.map((r) => ({ slug: r.id, title: r.title }))} />
    </div>
  );
}
