import type { Metadata } from 'next';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { RecettesOngletsView } from '@/components/recettes/RecettesOngletsView';
import { getPublishedRecipes } from '@/lib/recipes';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

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
    getPublishedRecipes(),
    getCurrentUser(),
  ]);
  const userHasPlan =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Fond dégradé rose Karine. Variant 'recettes' = fond dédié
          /admin/parametres/fonds, défini dans data/background-images. */}
      <FloralBackground variant="recettes" />

      {/* Petite fée en overlay haut-gauche.
          Mobile (< 1024px) : left:10.9vw  top:64px  width:31.3vw
          PC     (≥ 1024px) : left:35.2vw  top:95px  width:12.0vw
          pointer-events-none : laisse passer le clic vers le burger
          menu derrière. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/recettes/fee.webp"
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-[10.9vw] top-[64px] z-[1] w-[31.3vw] lg:left-[35.2vw] lg:top-[95px] lg:w-[12vw]"
      />

      <AppHeader withSlogan />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-8 sm:max-w-2xl sm:px-6 lg:max-w-5xl lg:px-8">
        <RecettesOngletsView recipes={recipes} userHasPlan={userHasPlan} />
      </main>
      <BottomNav />
    </div>
  );
}
