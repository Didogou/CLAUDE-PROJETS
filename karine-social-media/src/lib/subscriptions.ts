import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { planKindFromPriceId } from '@/lib/stripe/client';
import type { SubscriptionStatus, UserSubscription } from '@/data/plans';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): UserSubscription {
  return {
    id: row.id,
    status: row.status as SubscriptionStatus,
    priceId: row.price_id ?? null,
    planKind: planKindFromPriceId(row.price_id),
    currentPeriodStart: row.current_period_start ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
    trialEnd: row.trial_end ?? null,
  };
}

/**
 * Retourne l'abonnement actif ou le plus récent pour un user.
 * Si plusieurs abos historiques, on prend en priorité un actif/trialing,
 * sinon le dernier en date.
 */
export async function getUserSubscription(userId: string): Promise<UserSubscription | null> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: active } = await (supabase as any)
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['trialing', 'active', 'past_due', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (active) return mapRow(active);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: last } = await (supabase as any)
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return last ? mapRow(last) : null;
}

/**
 * Récupère le stripe_customer_id pour un user, ou null si aucun.
 */
export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .not('stripe_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.stripe_customer_id ?? null;
}
