import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { planKindFromPriceId } from '@/lib/stripe/client';
import type { SubscriptionStatus } from '@/data/plans';
import type { Subscriber } from '@/data/subscribers';

/**
 * Retourne tous les utilisateurs qui ont (eu) un abo Stripe, joints avec leur
 * profil. On inclut les statuts trialing / active / past_due / paused mais
 * aussi canceled (historique).
 */
export async function getAllSubscribers(): Promise<Subscriber[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('subscriptions')
    .select(
      'user_id, status, price_id, current_period_end, cancel_at_period_end, created_at, profile:profiles!subscriptions_user_id_fkey(email, full_name)',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;

  const now = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((row) => {
    const exp = row.current_period_end as string | null;
    const days = exp
      ? Math.ceil((new Date(exp).getTime() - now) / (1000 * 60 * 60 * 24))
      : null;
    return {
      userId: row.user_id,
      email: row.profile?.email ?? '',
      fullName: row.profile?.full_name ?? null,
      status: (row.status as SubscriptionStatus) ?? null,
      planKind: planKindFromPriceId(row.price_id),
      currentPeriodEnd: exp,
      cancelAtPeriodEnd: !!row.cancel_at_period_end,
      createdAt: row.created_at ?? null,
      daysUntilRenewal: days,
    };
  });
}
