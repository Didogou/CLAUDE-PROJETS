import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MesCaloriesPageClient } from '@/components/nutrition/MesCaloriesPageClient';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mes calories · Karine Diététique',
};

/**
 * Route /mes-calories — tracker calorique en PAGE PLEIN ÉCRAN au lieu
 * de la sheet modale `CalorieCounterSheetV2`.
 *
 * Pourquoi : sur iPhone Safari/Chrome (WebKit), la sheet en
 * `createPortal(fixed inset-0)` rencontre des bugs WebKit (containing
 * block parasite, zoom horizontal, débordement). On a tenté 4 fixes
 * CSS infructueux. La solution structurelle : utiliser une vraie page
 * Next.js (URL change, viewport natif), zéro portail / zéro fixed.
 *
 * Effets bénéfiques :
 *  - URL `/mes-calories` partageable, bookmarkable
 *  - Bouton back navigateur fonctionne
 *  - Plus aucun bug iOS WebKit lié à `position: fixed`
 *  - Code plus simple à maintenir
 *
 * Le composant `CalorieCounterSheetV2` accepte une prop `asPage` qui
 * désactive le portail et le wrapper sheet. Cf. ce composant ligne 195+.
 */
export default async function MesCaloriesPage() {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    redirect('/login?next=/mes-calories');
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Fond identique a la page d'accueil (variant 'accueil') pour
          cohérence visuelle — le tracker calorie est l'extension
          naturelle de l'experience home. Plus de degrade bleu superpose. */}
      <FloralBackground variant="accueil" />

      {/* AppHeader meme pattern que /recettes, /menus, /astuces :
          pageTitle + backHref (fleche retour, pas de burger). C'est le
          titre script-coral sous le wordmark "Karine Dietetique" qui
          fait office de titre de page — pas besoin d'en mettre un autre
          dans le contenu. */}
      <AppHeader pageTitle="Mes calories" backHref="/" hideTracking />
      {/* Layout standard /recettes /menus /astuces : main avec
          flex-1 pour respecter le pattern, contenu en flow normal
          (le scroll du document declenche le mode compact du
          AppHeader sticky automatiquement). */}
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-8 sm:max-w-2xl sm:px-6">
        <MesCaloriesPageClient />
      </main>
      <BottomNav />
    </div>
  );
}
