import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { Logo } from '@/components/brand/Logo';
import { DayPagerView } from '@/components/menus/DayPagerView';
import { MenuDayMealsCarousel } from '@/components/menus/MenuDayMealsCarousel';
import { getPublishedMenuById, getMenuMealSheets } from '@/lib/menus';
import { getRecipeBySlug } from '@/lib/recipes';
import { getCurrentUser } from '@/lib/current-user';
import { dayIndexFromDate, formatWeekTitle } from '@/data/menus';
import type { Recipe } from '@/data/recipes';

export const dynamic = 'force-dynamic';

export default async function MenuDayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [menu, user] = await Promise.all([
    getPublishedMenuById(id),
    getCurrentUser(),
  ]);
  if (!menu) notFound();

  const today = dayIndexFromDate(new Date());

  // L'accès aux fiches recettes du menu (meal sheets) est réservé aux
  // abonnés (subscriber + patient + admin). Les visiteurs voient
  // uniquement les jours/repas sans ingrédients.
  const isSubscriber =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';

  // Charge les meal sheets (un jour x lunch/dinner par sheet) si abonné.
  const mealSheetsMap = isSubscriber
    ? await getMenuMealSheets(menu.id)
    : new Map();
  const mealSheetsByDay: Record<
    number,
    { lunch: import('@/data/menus').MenuMealSheet | null; dinner: import('@/data/menus').MenuMealSheet | null }
  > = {};
  for (const [k, v] of mealSheetsMap) mealSheetsByDay[k] = v;

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

        {/* Carrousel des fiches recettes du jour (lunch + dinner) +
            actions liste de courses globale du menu. Réservé aux
            abonnés. Pour les visiteurs : message d'incitation. */}
        <MenuDayMealsCarousel
          menuId={menu.id}
          menuTitle={menu.title}
          weekStart={menu.weekStart}
          defaultDayIndex={today}
          mealSheetsByDay={mealSheetsByDay}
          shoppingListImageUrl={menu.shoppingListImageUrl}
          shoppingListItemsCount={menu.shoppingListItems?.length ?? 0}
          isSubscriber={isSubscriber}
          isAuthenticated={user.isAuthenticated}
        />

        <DayPagerView menu={menu} defaultDayIndex={today} recipesBySlug={recipesBySlug} />
      </main>

      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
