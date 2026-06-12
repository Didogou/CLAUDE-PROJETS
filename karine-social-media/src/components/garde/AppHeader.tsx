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
  pageTitle,
  backHref,
  hideTracking = false,
  homeExtraTop = false,
}: {
  withSlogan?: boolean;
  withIdeas?: boolean;
  /** Padding-top supplémentaire sur le header. Utilisé uniquement sur
   *  la page d'accueil pour décaler le wordmark vers le bas (UX 2026-06-12). */
  homeExtraTop?: boolean;
  /** Titre de la page courante (Option C — pattern Hybride 2026-06-08).
   *  Quand fourni, le Logo passe automatiquement en mode forceCompact
   *  et le titre s'affiche sous le wordmark (à la place du slogan).
   *  Sert d'orientation à l'utilisatrice (où suis-je ?). */
  pageTitle?: string;
  /** Si fourni, REMPLACE le burger menu par une flèche retour qui
   *  navigue vers cette URL (Option B nav — 2026-06-08).
   *  Toujours préférer un href explicite à router.back() : sur deep-
   *  link WhatsApp, history.length === 1 → router.back() sort de la
   *  PWA. backHref garantit qu'on reste dans l'app. */
  backHref?: string;
  /** Si true, cache l'icone flamme de suivi calorique. Utilise sur
   *  /mes-calories ou on est deja sur cette feature → pas besoin de
   *  redondance dans le header. */
  hideTracking?: boolean;
}) {
  const user = await getCurrentUser();
  const unreadCount =
    user.isAuthenticated && user.id ? await getMyUnreadCount(user.id) : 0;

  // Avatar URL utilisée comme icône du badge profil (en haut à droite).
  // Si présente, on l'affiche à la place de l'icône User Lucide générique.
  let avatarUrl: string | null = null;
  if (user.isAuthenticated && user.id) {
    const { createServiceClient } = await import('@/lib/supabase/server');
    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    if (data?.avatar_url) avatarUrl = data.avatar_url as string;
  }

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
  if (featureEnabledGlobal && !hideTracking) {
    if (user.isAuthenticated) trackingBehavior = 'sheet';
    else trackingBehavior = 'login';
  }

  return (
    <AppHeaderInner
      userId={user.isAuthenticated ? (user.id ?? null) : null}
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
      pageTitle={pageTitle}
      backHref={backHref}
      avatarUrl={avatarUrl}
      homeExtraTop={homeExtraTop}
    />
  );
}
