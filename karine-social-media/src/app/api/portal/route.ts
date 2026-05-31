import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureStripeConfigured, stripe } from '@/lib/stripe/client';
import { getStripeCustomerId } from '@/lib/subscriptions';

/**
 * Crée une session du Stripe Billing Portal et retourne l'URL.
 * Le portail permet à l'utilisateur de gérer sa CB, télécharger ses factures,
 * changer de plan, annuler son abonnement (selon la config Stripe dashboard).
 */
export async function POST(request: NextRequest) {
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

    const customerId = await getStripeCustomerId(user.id);
    if (!customerId) {
      return NextResponse.json(
        { error: 'Aucun abonnement Stripe trouvé pour ce compte' },
        { status: 400 },
      );
    }

    const origin = new URL(request.url).origin;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/mon-plan`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
