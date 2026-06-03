import { getCurrentUser } from '@/lib/current-user';
import { CalorieFAB } from './CalorieFAB';
import { WaterFAB } from './WaterFAB';

/**
 * Wrapper serveur : monte les FAB nutrition (calories + eau)
 * uniquement si l'utilisatrice connectée a un rôle qui le justifie
 * (patiente, abonnée ou admin pour tester).
 *
 * Inclus dans le RootLayout pour apparaître automatiquement sur
 * toutes les pages user. Les FAB se masquent eux-mêmes sur /admin/*.
 */
export async function SubscriberFloatingTools() {
  const user = await getCurrentUser();
  const allowed =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';
  if (!allowed) return null;
  return (
    <>
      <CalorieFAB />
      <WaterFAB />
    </>
  );
}
