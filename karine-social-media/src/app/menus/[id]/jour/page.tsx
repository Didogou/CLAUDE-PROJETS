import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { Logo } from '@/components/brand/Logo';
import { DayPagerView } from '@/components/menus/DayPagerView';
import { getPublishedMenuById } from '@/lib/menus';
import { getRecipeBySlug } from '@/lib/recipes';
import { dayIndexFromDate, formatWeekTitle } from '@/data/menus';
import type { Recipe } from '@/data/recipes';

export const dynamic = 'force-dynamic';

export default async function MenuDayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const menu = await getPublishedMenuById(id);
  if (!menu) notFound();

  const today = dayIndexFromDate(new Date());

  // Charge les recettes liées au menu pour pouvoir afficher les tuiles
  // en mode "RecipeCard" (badges, calories, likes…).
  const slugs = new Set<string>();
  for (const d of menu.days) {
    if (d.lunchRecipeSlug) slugs.add(d.lunchRecipeSlug);
    if (d.dinnerRecipeSlug) slugs.add(d.dinnerRecipeSlug);
  }
  const recipeArr = await Promise.all([...slugs].map((s) => getRecipeBySlug(s)));
  const recipesBySlug: Record<string, Recipe> = {};
  for (const r of recipeArr) if (r) recipesBySlug[r.id] = r;

  return (
    <div className="relative flex min-h-screen flex-col print:bg-white">
      <div className="print:hidden">
        <FloralBackground />
      </div>
      <header className="relative flex items-center px-5 py-6 lg:py-8 print:hidden">
        <Link
          href={`/menus`}
          aria-label="Retour aux menus"
          className="z-10 grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink transition hover:bg-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Logo />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-md xl:max-w-lg print:m-0 print:max-w-none print:p-0">
        <h1 className="mb-4 text-center font-script text-3xl text-coral lg:text-4xl print:hidden">
          {menu.title || formatWeekTitle(menu.weekStart)}
        </h1>

        {/* CTA Liste de courses — visible uniquement si la liste interactive
            est disponible (items extraits + validés par Karine). */}
        {menu.shoppingListItems && menu.shoppingListItems.length > 0 && (
          <Link
            href={`/menus/${menu.id}/liste-courses`}
            className="mb-4 flex items-center justify-center gap-2 rounded-full bg-coral px-5 py-3 text-sm font-bold text-white shadow-md transition hover:bg-coral-dark hover:shadow-lg print:hidden"
          >
            <ShoppingCart className="h-4 w-4" />
            Liste de courses ({menu.shoppingListItems.length} ingrédients)
          </Link>
        )}

        <DayPagerView menu={menu} defaultDayIndex={today} recipesBySlug={recipesBySlug} />
      </main>

      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
