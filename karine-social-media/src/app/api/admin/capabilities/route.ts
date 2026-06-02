import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { setCapabilityValue } from '@/lib/capabilities';
import type { CapabilityKey } from '@/data/capabilities';

export const runtime = 'nodejs';

const VALID_KEYS: ReadonlyArray<CapabilityKey> = [
  'recipes.enter_section',
  'recipes.see_categories',
  'recipes.see_recipes_in_category',
  'recipes.open_recipe_detail',
  'weekly_menu.enter_section',
  'weekly_menu.see_current_cover',
  'weekly_menu.navigate_weeks',
  'weekly_menu.open_detail',
  'tips.enter_section',
  'advice.enter_section',
  'ideas.submit',
  'notifications.access',
];

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id || !user.isAdmin) {
    return NextResponse.json(
      { error: 'Réservé à l’admin' },
      { status: 403 },
    );
  }

  let payload: { key?: string; allowed?: boolean };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const key = payload.key as CapabilityKey | undefined;
  if (!key || !VALID_KEYS.includes(key)) {
    return NextResponse.json(
      { error: 'Clé de capacité invalide' },
      { status: 400 },
    );
  }
  if (typeof payload.allowed !== 'boolean') {
    return NextResponse.json(
      { error: 'allowed doit être un booléen' },
      { status: 400 },
    );
  }

  const result = await setCapabilityValue({
    key,
    allowed: payload.allowed,
    adminId: user.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
