import { NextResponse, type NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

/** Marque TOUTES les notifs non lues du user comme lues. */
export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const service = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
