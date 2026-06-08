import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MenusPagerView } from '@/components/menus/MenusPagerView';
import { getPublishedMenusLite } from '@/lib/menus';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function MenusPage() {
  const [menus, user] = await Promise.all([
    // Lite : exclut shopping_list_items du payload envoyé au navigateur.
    // Un non-abonné voit les vignettes des menus mais pas la liste de
    // courses détaillée. Elle est chargée uniquement au clic, et seulement
    // si l'utilisatrice a un plan actif (gate /menus/[id]/liste-courses).
    getPublishedMenusLite(),
    getCurrentUser(),
  ]);
  // Tuile image de la liste cachée pour les abonnés (la liste passe
  // par le bouton "Voir la liste" dans la page jour).
  const isSubscriber =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';

  return (
    <div className="relative flex min-h-screen flex-col print:bg-white">
      {/* Pas de wrapper print:hidden ici : il scoperait le sticky du
          AppHeader et le ferait disparaître dès qu'on scroll au-delà
          de sa propre hauteur. FloralBackground et BottomNav ont déjà
          leur propre print:hidden via classes directes plus loin. */}
      <FloralBackground />
      <AppHeader pageTitle="Mes menus" backHref="/" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-8 print:m-0 print:max-w-none print:p-0">
        <MenusPagerView
          menus={menus}
          isSubscriber={isSubscriber}
        />
      </main>
      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
