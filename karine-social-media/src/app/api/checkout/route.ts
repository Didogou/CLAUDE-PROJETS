import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureStripeConfigured, stripe, STRIPE_PRICES } from '@/lib/stripe/client';
import { getStripeCustomerId } from '@/lib/subscriptions';
import { PLANS, type PlanKind } from '@/data/plans';

/**
 * Crée une Stripe Checkout Session pour le plan choisi et retourne l'URL.
 * Le client redirige vers cette URL → Stripe gère le paiement → webhook
 * synchronise la table subscriptions.
 *
 * Body : { plan: 'monthly' | 'yearly' }
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

    const json = await request.json().catch(() => ({}));
    const plan = String(json?.plan ?? '') as PlanKind;
    if (!PLANS[plan]) {
      return NextResponse.json({ error: 'Plan invalide' }, { status: 400 });
    }

    const priceId = STRIPE_PRICES[plan];
    if (!priceId) {
      return NextResponse.json(
        { error: `Price ID non configuré pour ${plan}` },
        { status: 500 },
      );
    }

    // Récupère un customer Stripe existant si possible
    const existingCustomerId = await getStripeCustomerId(user.id);

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ...(existingCustomerId
        ? { customer: existingCustomerId }
        : { customer_email: user.email ?? undefined }),
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/mon-plan?checkout=success`,
      cancel_url: `${origin}/mon-plan?checkout=cancel`,
      // Important pour retrouver le user dans le webhook
      metadata: { user_id: user.id, plan },
      subscription_data: {
        metadata: { user_id: user.id, plan },
      },
      allow_promotion_codes: true,
      // Note : l'acceptation explicite des CGV + renonciation au droit
      // de retractation 14j est faite cote /mon-plan AVANT le clic sur
      // le plan (case a cocher obligatoire). Stripe n'a pas besoin de
      // re-demander ici (eviterait la config Dashboard pas encore faite).
    });

    if (!session.url) {
      return NextResponse.json({ error: 'Session sans URL' }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
