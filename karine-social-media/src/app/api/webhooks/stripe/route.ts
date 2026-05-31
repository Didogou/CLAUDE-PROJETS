import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe/client';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Webhook Stripe. À configurer dans le dashboard Stripe sur l'URL
 *   POST https://<domaine>/api/webhooks/stripe
 * avec les events :
 *   - checkout.session.completed
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.payment_failed
 *
 * Le STRIPE_WEBHOOK_SECRET (whsec_...) doit être copié depuis le dashboard
 * dans l'env var. Sans lui, la vérif de signature échoue et tout est rejeté.
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET non configuré' },
      { status: 500 },
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Signature manquante' }, { status: 400 });
  }

  // Stripe exige le RAW body pour vérifier la signature
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature invalide';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') break;
        const userId = session.metadata?.user_id;
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (!userId || !customerId || !subscriptionId) break;

        // On va chercher les détails complets pour avoir les périodes
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertSubscription(supabase, userId, customerId, sub);

        // Promote au rôle subscriber UNIQUEMENT si l'user est actuellement
        // visitor. On ne dégrade JAMAIS un admin ou un patient (ils gardent
        // leur rôle + leur abonnement payant en parallèle).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: currentProfile } = await (supabase as any)
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle();
        if (currentProfile?.role === 'visitor') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from('profiles')
            .update({ role: 'subscriber' })
            .eq('id', userId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.user_id;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        if (!userId) break; // pas de user_id metadata → on peut pas raccrocher
        await upsertSubscription(supabase, userId, customerId, sub);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('subscriptions')
          .update({ status: 'canceled' })
          .eq('stripe_subscription_id', sub.id);

        // Si plus aucun abo actif → repasse role visitor (V1 simple)
        const userId = sub.metadata?.user_id;
        if (userId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: stillActive } = await (supabase as any)
            .from('subscriptions')
            .select('id')
            .eq('user_id', userId)
            .in('status', ['trialing', 'active'])
            .limit(1)
            .maybeSingle();
          if (!stillActive) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: profile } = await (supabase as any)
              .from('profiles')
              .select('role')
              .eq('id', userId)
              .maybeSingle();
            // On ne dégrade pas un admin ou un patient — seulement les ex-subscribers
            if (profile?.role === 'subscriber') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase as any)
                .from('profiles')
                .update({ role: 'visitor' })
                .eq('id', userId);
            }
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        // Stripe API 2025+ : invoice.subscription → invoice.parent.subscription_details.subscription
        const subRef = invoice.parent?.subscription_details?.subscription ?? null;
        const subId =
          typeof subRef === 'string' ? subRef : (subRef as Stripe.Subscription | null)?.id;
        if (subId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from('subscriptions')
            .update({ status: 'past_due' })
            .eq('stripe_subscription_id', subId);
        }
        break;
      }

      default:
        // Ignore les autres events silencieusement
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[stripe webhook] erreur:', err);
    return NextResponse.json({ error: 'Erreur traitement webhook' }, { status: 500 });
  }
}

async function upsertSubscription(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  customerId: string,
  sub: Stripe.Subscription,
) {
  const firstItem = sub.items.data[0];
  const priceId = firstItem?.price.id ?? null;
  // Stripe API 2025+ : current_period_start/end ont été déplacés de la
  // Subscription vers les SubscriptionItems. On lit la période depuis l'item.
  const payload = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: priceId,
    current_period_start: toIso(firstItem?.current_period_start ?? null),
    current_period_end: toIso(firstItem?.current_period_end ?? null),
    trial_end: sub.trial_end ? toIso(sub.trial_end) : null,
    cancel_at_period_end: sub.cancel_at_period_end,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('subscriptions')
    .upsert(payload, { onConflict: 'stripe_subscription_id' });
  if (error) throw error;
}

function toIso(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString();
}
