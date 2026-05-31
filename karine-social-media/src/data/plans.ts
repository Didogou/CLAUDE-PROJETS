// Types et constantes plans (client-safe — ne pas importer Stripe ici).

export type PlanKind = 'monthly' | 'yearly';

export type PlanConfig = {
  kind: PlanKind;
  label: string;
  priceEUR: number;
  period: string;
  perMonthLabel: string;
  savingLabel?: string;
};

export const PLANS: Record<PlanKind, PlanConfig> = {
  monthly: {
    kind: 'monthly',
    label: 'Mensuel',
    priceEUR: 8,
    period: '/ mois',
    perMonthLabel: '8 € par mois',
  },
  yearly: {
    kind: 'yearly',
    label: 'Annuel',
    priceEUR: 80,
    period: '/ an',
    perMonthLabel: '6,67 € par mois',
    savingLabel: '−17 % vs mensuel',
  },
};

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

export type UserSubscription = {
  id: number;
  status: SubscriptionStatus;
  priceId: string | null;
  planKind: PlanKind | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
};
