import { NextResponse, type NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

/**
 * Création d'une demande d'accès patient par l'utilisateur connecté.
 * - Requiert une session (signup préalable).
 * - Refuse si l'utilisateur est déjà patient actif ou a déjà une demande en attente.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const json = await request.json().catch(() => ({}));
    const message = String(json?.message ?? '').trim().slice(0, 1000);

    const service = createServiceClient();

    // Si déjà patient actif → on refuse (Karine renouvelle, ne réapprouve pas)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (service as any)
      .from('profiles')
      .select('role, patient_access_expires_at')
      .eq('id', user.id)
      .maybeSingle();
    if (
      profile?.role === 'patient' &&
      profile.patient_access_expires_at &&
      new Date(profile.patient_access_expires_at as string) > new Date()
    ) {
      return NextResponse.json(
        { error: 'Vous avez déjà un accès patiente actif' },
        { status: 400 },
      );
    }

    // Refuse les doublons en attente
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (service as any)
      .from('patient_requests')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: 'Une demande est déjà en attente' },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from('patient_requests')
      .insert({ user_id: user.id, message, status: 'pending' });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
