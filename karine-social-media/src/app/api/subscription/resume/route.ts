import { NextResponse, type NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { ensureStripeConfigured, stripe } from '@/lib/stripe/client';

/**
 * Annule l'annulation programmée : l'abonnement continuera normalement
 * à la prochaine échéance. Possible UNIQUEMENT tant que la période n'est pas
 * terminée (sinon il faut souscrire à nouveau).
 */
export async function POST(_request: NextRequest) {
  const cfg = ensureStripeConfigured();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: `Stripe non configuré (manque: ${cfg.missing.join(', ')})` },
      { status: 500 },
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const service = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (service as any)
      .from('subscriptions')
      .select('stripe_subscription_id, cancel_at_period_end')
      .eq('user_id', user.id)
      .in('status', ['trialing', 'active', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row?.stripe_subscription_id) {
      return NextResponse.json(
        { error: 'Aucun abonnement à réactiver' },
        { status: 400 },
      );
    }
    if (!row.cancel_at_period_end) {
      return NextResponse.json(
        { error: 'Cet abonnement n\'est pas en cours d\'annulation' },
        { status: 400 },
      );
    }

    await stripe.subscriptions.update(row.stripe_subscription_id as string, {
      cancel_at_period_end: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any)
      .from('subscriptions')
      .update({ cancel_at_period_end: false })
      .eq('stripe_subscription_id', row.stripe_subscription_id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
