import { getCurrentUser } from '@/lib/current-user';
import { CalorieFAB } from './CalorieFAB';

/**
 * Wrapper serveur : monte le FAB calories (et plus tard le verre
 * d'eau) uniquement si l'utilisatrice connectée a un rôle qui le
 * justifie (patiente, abonnée ou admin pour qu'elle puisse tester).
 *
 * Inclus dans le RootLayout pour apparaître automatiquement sur
 * toutes les pages user. Le FAB lui-même se masque sur /admin/*.
 */
export async function SubscriberFloatingTools() {
  const user = await getCurrentUser();
  const allowed =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';
  if (!allowed) return null;
  return <CalorieFAB />;
}
