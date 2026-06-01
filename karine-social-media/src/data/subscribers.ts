// Type client-safe (pas d'imports server-only).
import type { PlanKind, SubscriptionStatus } from './plans';

export type Subscriber = {
  userId: string;
  email: string;
  fullName: string | null;
  status: SubscriptionStatus | null;
  planKind: PlanKind | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string | null;
  daysUntilRenewal: number | null;
};
