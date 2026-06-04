import { NextResponse } from 'next/server';
import { getAppSettings } from '@/lib/app-settings';

/**
 * GET /api/app-settings
 *
 * Retourne les settings globaux exposables cote public (pas de
 * donnees admin sensibles). Utilise par la sheet calorie pour
 * savoir si elle doit cacher les kcal/100g.
 */
export async function GET() {
  try {
    const settings = await getAppSettings();
    // Log debug temporaire : pour identifier pourquoi les kcal/100g
    // ne s'affichent parfois pas cote abonnee malgre le toggle ON
    // dans /admin/parametres.
    console.log(
      '[app-settings GET] showCaloriesInCounter =',
      settings.showCaloriesInCounter,
    );
    // Whitelist explicite : on n expose QUE ce qui est cote public.
    return NextResponse.json({
      showCaloriesInCounter: settings.showCaloriesInCounter,
    });
  } catch (e) {
    console.warn('[app-settings GET] erreur', e);
    return NextResponse.json({ showCaloriesInCounter: true });
  }
}
