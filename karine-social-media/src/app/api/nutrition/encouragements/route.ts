import { NextResponse } from 'next/server';
import { getAppSettings } from '@/lib/app-settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nutrition/encouragements
 * Renvoie les 3 listes (debut-journee / bonne-route / objectif-atteint).
 * Pas d'auth requise : ces phrases sont decoratives, pas sensibles.
 */
export async function GET() {
  const settings = await getAppSettings();
  return NextResponse.json({ encouragements: settings.calorieEncouragements });
}
