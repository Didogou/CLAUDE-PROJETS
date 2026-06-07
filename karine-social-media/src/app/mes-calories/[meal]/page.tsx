import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MesCaloriesMealPageClient } from '@/components/nutrition/MesCaloriesMealPageClient';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

const SLUGS = ['petit-dej', 'dejeuner', 'gouter', 'diner'] as const;
type MealSlug = (typeof SLUGS)[number];

const SLUG_TO_LABEL: Record<MealSlug, string> = {
  'petit-dej': 'Petit-déjeuner',
  dejeuner: 'Déjeuner',
  gouter: 'Goûter',
  diner: 'Dîner',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ meal: string }>;
}): Promise<Metadata> {
  const { meal } = await params;
  const label = SLUG_TO_LABEL[meal as MealSlug] ?? 'Mes calories';
  return {
    title: `${label} · Mes calories · Karine Diététique`,
  };
}

/**
 * Route /mes-calories/[meal] — sub-page d'un repas (Petit-déj / Déjeuner /
 * Goûter / Dîner). Drill-down depuis /mes-calories via les boutons +
 * (ajout, mode default) ou œil (consultation, ajoute `?view`).
 *
 * On rend le même composant `CalorieCounterSheetV2` mais avec
 * `initialMealCategory` set, ce qui le fait démarrer directement sur
 * la sub-page voulue (le drill-down state interne est déjà ouvert au
 * mount).
 */
export default async function MesCaloriesMealPage({
  params,
  searchParams,
}: {
  params: Promise<{ meal: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ meal }, sp] = await Promise.all([params, searchParams]);
  if (!SLUGS.includes(meal as MealSlug)) {
    notFound();
  }

  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    redirect(`/login?next=/mes-calories/${meal}`);
  }

  // Mode : ?view => 'view' (liste "Déjà ajouté" affichée), sinon 'add'.
  const mode: 'add' | 'view' = sp.view !== undefined ? 'view' : 'add';

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader
        pageTitle={SLUG_TO_LABEL[meal as MealSlug] ?? 'Mes calories'}
        backHref="/mes-calories"
      />
      <main className="relative mx-auto w-full max-w-lg flex-1">
        <MesCaloriesMealPageClient slug={meal as MealSlug} mode={mode} />
      </main>
      <BottomNav />
    </div>
  );
}
