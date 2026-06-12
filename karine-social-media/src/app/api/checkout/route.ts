import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureStripeConfigured, stripe, STRIPE_PRICES } from '@/lib/stripe/client';
import { getStripeCustomerId, getUserSubscription } from '@/lib/subscriptions';
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

    // GARDE-FOU CRITIQUE : si l'utilisatrice a déjà un abonnement actif
    // (statut trialing/active/past_due/paused), on REFUSE de creer une
    // nouvelle session checkout — sinon elle paierait 2x. Le frontend
    // affiche normalement le bloc 'abo actif' a la place des plans, mais
    // on protege au cas où (replay de l'URL, race condition, etc.).
    const currentSub = await getUserSubscription(user.id);
    if (
      currentSub &&
      ['trialing', 'active', 'past_due', 'paused'].includes(currentSub.status)
    ) {
      return NextResponse.json(
        {
          error:
            'Tu as déjà un abonnement actif. Pour changer de plan, utilise le portail Stripe depuis ton espace.',
          alreadySubscribed: true,
        },
        { status: 409 },
      );
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

    // IdempotencyKey : evite que 2 clics rapides creent 2 sessions
    // Stripe. Cle = (user, plan, jour) → un clic dans le meme bucket
    // de jour reutilise la meme session.
    const dayBucket = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `checkout-${user.id}-${plan}-${dayBucket}`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        ...(existingCustomerId
          ? { customer: existingCustomerId }
          : { customer_email: user.email ?? undefined }),
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/mon-plan?checkout=success`,
        cancel_url: `${origin}/mon-plan?checkout=cancel`,
        metadata: { user_id: user.id, plan },
        subscription_data: {
          metadata: { user_id: user.id, plan },
        },
        allow_promotion_codes: true,
      },
      { idempotencyKey },
    );

    if (!session.url) {
      return NextResponse.json({ error: 'Session sans URL' }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
