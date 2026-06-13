import { notFound, redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MenuDayMealsCarousel } from '@/components/menus/MenuDayMealsCarousel';
import { getPublishedMenuById, getMenuMealSheets } from '@/lib/menus';
import { getCurrentUser } from '@/lib/current-user';
import { getUserFavorites } from '@/lib/favorites';
import { dayIndexFromDate, formatWeekTitle } from '@/data/menus';
import type { MenuMealSheet } from '@/data/menus';
import { createServiceClient } from '@/lib/supabase/server';
import {
  normalizeLabelKey,
  isMassUnit,
  quickMatchCiqual,
  type CiqualFoodLite,
} from '@/lib/nutriscore-aggregate';

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

  // Nutri-Score (badge + modale détail) : on réutilise les composants
  // recette. Collecte des liens Ciqual + poids de portion de toutes les
  // fiches repas du menu, pour alimenter la modale comme côté recette.
  const allMealSheets: MenuMealSheet[] = Object.values(mealSheetsByDay)
    .flatMap((s) => [s.lunch, s.dinner])
    .filter((s): s is MenuMealSheet => s !== null);
  let ciqualByIdEntries: Array<[number, CiqualFoodLite]> = [];
  let portionWeightEntries: Array<[string, number]> = [];
  const CIQUAL_COLS =
    'id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g, fibers_g, sugars_g, salt_g, sodium_mg, avg_unit_weight_g';
  if (allMealSheets.length > 0) {
    const supa = createServiceClient() as any;
    // Liens explicites + détection d'ingrédients NON liés (parité recette).
    const linkedCodes = new Set<number>();
    let hasUnlinked = false;
    for (const sh of allMealSheets) {
      for (const ing of sh.ingredients) {
        if (typeof ing.ciqual_alim_code === 'number') linkedCodes.add(ing.ciqual_alim_code);
        else if (typeof ing.quantity === 'number' && ing.quantity > 0) hasUnlinked = true;
      }
    }

    if (hasUnlinked) {
      // Fetch Ciqual complet (paginé) pour matcher en mémoire les orphelins.
      const ciqualAll: CiqualFoodLite[] = [];
      for (let offset = 0; offset < 10000; offset += 1000) {
        const { data: pageData } = await supa
          .from('ciqual_foods')
          .select(CIQUAL_COLS)
          .order('id', { ascending: true })
          .range(offset, offset + 999);
        const arr = (pageData ?? []) as CiqualFoodLite[];
        if (arr.length === 0) break;
        ciqualAll.push(...arr);
        if (arr.length < 1000) break;
      }
      const collected = new Map<number, CiqualFoodLite>();
      for (const code of linkedCodes) {
        const c = ciqualAll.find((f) => f.alim_code === code);
        if (c) collected.set(code, c);
      }
      for (const sh of allMealSheets) {
        for (const ing of sh.ingredients) {
          if (typeof ing.ciqual_alim_code === 'number') continue;
          if (typeof ing.quantity !== 'number' || ing.quantity <= 0) continue;
          const m = quickMatchCiqual(ing.label, ciqualAll);
          if (m && !collected.has(m.alim_code)) collected.set(m.alim_code, m);
        }
      }
      ciqualByIdEntries = [...collected.entries()];
      // Enrichit les ingrédients en mémoire (alim_code matché) pour que la
      // modale détail + le rendu les résolvent (lecture seule, pas d'écriture).
      const pool = ciqualByIdEntries.map(([, c]) => c);
      for (const sh of allMealSheets) {
        sh.ingredients = sh.ingredients.map((ing) => {
          if (typeof ing.ciqual_alim_code === 'number') return ing;
          if (typeof ing.quantity !== 'number' || ing.quantity <= 0) return ing;
          const m = quickMatchCiqual(ing.label, pool);
          return m ? { ...ing, ciqual_alim_code: m.alim_code } : ing;
        });
      }
    } else if (linkedCodes.size > 0) {
      const { data } = await supa
        .from('ciqual_foods')
        .select(CIQUAL_COLS)
        .in('alim_code', [...linkedCodes]);
      ciqualByIdEntries = ((data ?? []) as CiqualFoodLite[]).map((c) => [c.alim_code, c]);
    }

    // Poids de portion par label (après enrichissement éventuel).
    const labelKeys = new Set<string>();
    for (const sh of allMealSheets) {
      for (const ing of sh.ingredients) {
        if (
          typeof ing.quantity === 'number' &&
          ing.quantity > 0 &&
          !isMassUnit(ing.unit)
        ) {
          const k = normalizeLabelKey(ing.label);
          if (k) labelKeys.add(k);
        }
      }
    }
    if (labelKeys.size > 0) {
      const { data } = await supa
        .from('ingredient_portion_weights')
        .select('label_key, grams')
        .in('label_key', [...labelKeys]);
      portionWeightEntries = ((data ?? []) as Array<{
        label_key: string;
        grams: number | null;
      }>)
        .filter((r) => r.grams != null && Number(r.grams) > 0)
        .map((r) => [r.label_key, Number(r.grams)] as [string, number]);
    }
  }

  // Charge les favoris meal_sheet de l'utilisatrice (V1 anonyme V0
  // sans persist = set vide). Permet de pré-cocher les bookmark icons.
  const favoritedMealSheetIds: string[] = user.id
    ? (await getUserFavorites(user.id))
        .filter((f) => f.targetType === 'meal_sheet')
        .map((f) => f.targetId)
    : [];

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
          favoritedMealSheetIds={favoritedMealSheetIds}
          ciqualByIdEntries={ciqualByIdEntries}
          portionWeightEntries={portionWeightEntries}
        />
      </main>

      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
