import { getCurrentUser } from '@/lib/current-user';
import { getAppSettings } from '@/lib/app-settings';
import { CalorieFAB } from './CalorieFAB';
import { WaterFAB } from './WaterFAB';

/**
 * Wrapper serveur : monte les FAB nutrition (calories + eau)
 * uniquement si :
 *  - l'utilisatrice a un rôle qui le justifie (patiente, abonnée, admin)
 *  - ET le toggle global app_settings.{calorie,water}_tracker_enabled
 *    est ON, OU l'utilisatrice est admin (les admins bypass le toggle
 *    pour pouvoir tester la feature même quand elle est désactivée
 *    en prod).
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

  const isAdmin = user.effectiveRole === 'admin';
  const settings = await getAppSettings();
  const showCalorie = isAdmin || settings.calorieTrackerEnabled;
  const showWater = isAdmin || settings.waterTrackerEnabled;

  return (
    <>
      {showCalorie && <CalorieFAB />}
      {showWater && <WaterFAB />}
    </>
  );
}
