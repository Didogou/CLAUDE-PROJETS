import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { MenusPagerView } from '@/components/menus/MenusPagerView';
import { getPublishedMenus } from '@/lib/menus';
import { getCachedPublishedMenus } from '@/lib/cached-content';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function MenusPage() {
  // On charge l'utilisateur D'ABORD pour decider quelle version des
  // menus envoyer dans le payload :
  //   - Abonne / admin / patient → version FULL (avec ingredients)
  //     pour qu'ils voient la liste des ingredients de la semaine.
  //   - Non-abonne → version LITE (sans ingredients) : la liste de
  //     courses reste confidentielle, gate /menus/[id]/liste-courses.
  // Cf. commit 40f99b6 qui a introduit cette segmentation pour la
  // securite : sans elle, un visiteur non-abonne pouvait recuperer
  // la liste via DevTools.
  const user = await getCurrentUser();
  const isSubscriber =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';
  // Abonnés : version FULL (avec ingredients) — pas cachée car liée
  // à leur droit d'accès (plus rare → cache moins utile).
  // Visiteurs : version LITE cachée 60s + tag 'menus' → invalidation
  // immédiate à la publication d'un menu côté admin.
  const menus = isSubscriber
    ? await getPublishedMenus()
    : await getCachedPublishedMenus();

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
