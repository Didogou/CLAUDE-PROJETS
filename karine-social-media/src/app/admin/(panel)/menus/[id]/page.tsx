import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { MenuForm } from '@/components/admin/MenuForm';
import { getMenuAdminById } from '@/lib/menus';
import { getAllRecipesAdmin } from '@/lib/recipes';

export const dynamic = 'force-dynamic';

export default async function EditMenuPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [menu, recipes] = await Promise.all([getMenuAdminById(id), getAllRecipesAdmin()]);
  if (!menu) notFound();

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
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">Édition</p>
          <h2 className="font-script text-3xl text-admin-primary-dark">{menu.title || menu.weekStart}</h2>
        </header>
      </div>

      <MenuForm
        menu={menu}
        recipeOptions={recipes.map((r) => ({ slug: r.id, title: r.title }))}
      />
    </div>
  );
}
