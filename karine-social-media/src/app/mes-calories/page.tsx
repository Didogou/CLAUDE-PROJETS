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
      <FloralBackground />
      <AppHeader />
      <main className="relative mx-auto w-full max-w-lg flex-1">
        <MesCaloriesPageClient />
      </main>
      <BottomNav />
    </div>
  );
}
