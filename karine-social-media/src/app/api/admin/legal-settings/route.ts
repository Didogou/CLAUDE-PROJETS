import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { updateLegalSettings } from '@/lib/legal-settings';
import type { LegalSettings } from '@/data/legal-settings';

export const runtime = 'nodejs';

const ALLOWED_KEYS: (keyof LegalSettings)[] = [
  'companyName', 'legalForm', 'capitalSocial', 'siegeSocial',
  'rcsCity', 'rcsNumber', 'siret', 'vatNumber',
  'directorName', 'directorFunction', 'contactEmail',
  'mediatorName', 'mediatorUrl', 'courtJurisdiction',
  'bankHolderName', 'bankIban', 'bankBic', 'bankName',
];

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id || !user.isAdmin) {
    return NextResponse.json({ error: 'Réservé à l’admin' }, { status: 403 });
  }

  let payload: Partial<Record<keyof LegalSettings, unknown>>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const patch: Partial<LegalSettings> = {};
  for (const key of ALLOWED_KEYS) {
    if (!(key in payload)) continue;
    const v = payload[key];
    if (v === null || v === '') {
      patch[key] = null;
    } else if (typeof v === 'string') {
      patch[key] = v.trim().slice(0, 1000);
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const r = await updateLegalSettings({ patch, adminId: user.id });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
  return NextResponse.json({ ok: true });
}
