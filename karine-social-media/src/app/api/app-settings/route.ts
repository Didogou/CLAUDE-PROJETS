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
    // Whitelist explicite : on n expose QUE ce qui est cote public.
    return NextResponse.json({
      showCaloriesInCounter: settings.showCaloriesInCounter,
    });
  } catch {
    return NextResponse.json({ showCaloriesInCounter: true });
  }
}
