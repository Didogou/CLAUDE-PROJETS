import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_CONTENT = 20000;

/**
 * PATCH /api/admin/settings/about-page
 *
 * Persiste le contenu de la page /a-propos dans
 * app_settings.about_page_content (singleton row id=1).
 */
export async function PATCH(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let payload: { aboutPageContent?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const raw = payload.aboutPageContent;
  if (typeof raw !== 'string') {
    return NextResponse.json(
      { error: 'aboutPageContent doit être une chaîne' },
      { status: 400 },
    );
  }
  if (raw.length > MAX_CONTENT) {
    return NextResponse.json(
      { error: `Contenu trop long (max ${MAX_CONTENT} caractères)` },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('app_settings')
    .update({ about_page_content: raw })
    .eq('id', 1);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
