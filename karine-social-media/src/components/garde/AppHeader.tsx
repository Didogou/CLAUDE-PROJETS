import { getAppSettings } from '@/lib/app-settings';
import { getCurrentUser } from '@/lib/current-user';
import { getMyUnreadCount } from '@/lib/notifications';
import { AppHeaderInner } from './AppHeaderInner';

/**
 * AppHeader (Server Component) — fait les fetches user/notifications/
 * settings puis délègue le rendu à AppHeaderInner (client) qui gère
 * la détection scroll et le collapse du titre.
 *
 * Props :
 *  - withSlogan : affiche "prenons soin de vous !" sous le logo (au
 *    repos uniquement, masqué quand scrolled).
 *  - withIdeas  : affiche le bouton "Une idée ?" sur la 2e ligne.
 *    Réservé à la page d'accueil. Sur les autres pages, on ne propose
 *    pas cette action (sinon redondant avec les CTA dédiés).
 *
 * L'icône Flame de suivi calorique est TOUJOURS visible dès lors que
 * la feature est activée globalement (settings.calorieTrackerEnabled
 * ou admin). Le comportement au clic s'adapte au statut :
 *  - 'sheet' : abonnée/patiente/admin → ouvre la sheet calorie
 *  - 'plan'  : connectée sans abonnement → /mon-plan
 *  - 'login' : visiteuse non connectée → /login
 *  - undefined → icône cachée (feature OFF globalement)
 */
export async function AppHeader({
  withSlogan = false,
  withIdeas = false,
}: {
  withSlogan?: boolean;
  withIdeas?: boolean;
}) {
  const user = await getCurrentUser();
  const unreadCount =
    user.isAuthenticated && user.id ? await getMyUnreadCount(user.id) : 0;

  const isAdmin = user.effectiveRole === 'admin';
  const allowedTracking =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    isAdmin;

  // On lit toujours les settings : même les visitor doivent voir
  // l'icône calorie si Karine a activé la feature globalement.
  const settings = await getAppSettings();
  const featureEnabledGlobal = isAdmin || settings?.calorieTrackerEnabled;

  // Toute utilisatrice authentifiée peut OUVRIR la sheet calorie
  // (mode découverte). Les actions d'ajout de repas / eau seront
  // ensuite bloquées dans la sheet elle-même via le prop `canEdit`
  // (cf. CalorieCounterSheetV2). Visiteuse non connectée → /login.
  let trackingBehavior: 'sheet' | 'plan' | 'login' | null = null;
  if (featureEnabledGlobal) {
    if (user.isAuthenticated) trackingBehavior = 'sheet';
    else trackingBehavior = 'login';
  }

  return (
    <AppHeaderInner
      isAuthenticated={user.isAuthenticated}
      isAdmin={user.isAdmin}
      unreadCount={unreadCount}
      trackingBehavior={trackingBehavior}
      // canEditTracking : seul un patient/abonné/admin peut ajouter
      // un repas ou de l'eau. Les autres voient la sheet en lecture
      // seule avec un CTA "S'abonner" en place du bouton Envoyer.
      canEditTracking={allowedTracking}
      withSlogan={withSlogan}
      withIdeas={withIdeas}
    />
  );
}
