import { notFound, redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MenuDayMealsCarousel } from '@/components/menus/MenuDayMealsCarousel';
import { getPublishedMenuById, getMenuMealSheets } from '@/lib/menus';
import { getCurrentUser } from '@/lib/current-user';
import { dayIndexFromDate, formatWeekTitle } from '@/data/menus';

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

  // L'accès aux fiches recettes du menu (meal sheets) est réservé aux
  // abonnés (subscriber + patient + admin).
  const isSubscriber =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';

  // Gate accès : si le menu n'est PAS public et que l'utilisatrice
  // n'a pas de plan actif → redirect vers /mon-plan avec next préservé.
  // Évite le contournement via URL directe.
  if (!menu.isPublic && !isSubscriber) {
    redirect(`/mon-plan?next=/menus/${menu.id}/jour`);
  }

  const today = dayIndexFromDate(new Date());

  // Charge les meal sheets si abonnée OU si le menu est public
  // (la visiteuse doit pouvoir voir toutes les recettes du menu).
  const canSeeFullMenu = isSubscriber || menu.isPublic;
  const mealSheetsMap = canSeeFullMenu
    ? await getMenuMealSheets(menu.id)
    : new Map();
  const mealSheetsByDay: Record<
    number,
    { lunch: import('@/data/menus').MenuMealSheet | null; dinner: import('@/data/menus').MenuMealSheet | null }
  > = {};
  for (const [k, v] of mealSheetsMap) mealSheetsByDay[k] = v;

  return (
    <div className="relative flex min-h-screen flex-col print:bg-white">
      {/* FloralBackground et MenuDayHeader DOIVENT être enfants directs
          du flex parent pour que `sticky top-0` du header reste actif
          tout au long du scroll. */}
      <FloralBackground />
      {/* backHref préserve la semaine consultée : si l'utilisatrice avait
          navigué vers une semaine ancienne via le pager de /menus, la
          flèche retour la ramène à CETTE semaine et pas à la semaine la
          plus récente (idx=0 par défaut). Cf. MenusPagerView qui lit
          `?w=<weekStart>` au mount. */}
      <AppHeader
        pageTitle={menu.title || formatWeekTitle(menu.weekStart)}
        backHref={`/menus?w=${menu.weekStart}`}
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-md xl:max-w-lg print:m-0 print:max-w-none print:p-0">
        {/* H1 affiché UNIQUEMENT à l'impression (pour avoir le titre
            sur la version papier). À l'écran, c'est l'AppHeader qui
            porte le titre via pageTitle. */}
        <h1 className="mb-4 hidden text-center font-script text-3xl text-coral lg:text-4xl print:block">
          {menu.title || formatWeekTitle(menu.weekStart)}
        </h1>

        {/* Carrousel des fiches recettes du jour (lunch + dinner).
            Accessible aux abonnées OU si menu.isPublic (mode
            découverte) — on passe canSeeFullMenu comme isSubscriber
            au composant pour qu'il affiche les recettes complètes
            plutôt que le placeholder upsell. */}
        <MenuDayMealsCarousel
          menuTitle={menu.title}
          weekStart={menu.weekStart}
          defaultDayIndex={today}
          mealSheetsByDay={mealSheetsByDay}
          isSubscriber={canSeeFullMenu}
          isAuthenticated={user.isAuthenticated}
        />
      </main>

      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
