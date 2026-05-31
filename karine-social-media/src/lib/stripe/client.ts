import 'server-only';
import Stripe from 'stripe';
import type { PlanKind } from '@/data/plans';

/**
 * Instance Stripe singleton côté serveur. Importée par les routes API,
 * le webhook et le portail client.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  // On laisse Stripe choisir la version par défaut du SDK pour éviter
  // les mismatches au pin manuel (le typage du SDK la résout).
  typescript: true,
});

/** Mapping kind → price ID Stripe (configuré dans le dashboard). */
export const STRIPE_PRICES: Record<PlanKind, string> = {
  monthly: process.env.STRIPE_PRICE_MONTHLY ?? '',
  yearly: process.env.STRIPE_PRICE_YEARLY ?? '',
};

/** Inverse : price ID → kind, pour déduire le plan à partir d'une subscription. */
export function planKindFromPriceId(priceId: string | null | undefined): PlanKind | null {
  if (!priceId) return null;
  if (priceId === STRIPE_PRICES.monthly) return 'monthly';
  if (priceId === STRIPE_PRICES.yearly) return 'yearly';
  return null;
}

/**
 * Garde-fou : à appeler dans les routes qui consomment Stripe pour
 * échouer joliment si les env vars ne sont pas configurées.
 */
export function ensureStripeConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!process.env.STRIPE_PRICE_MONTHLY) missing.push('STRIPE_PRICE_MONTHLY');
  if (!process.env.STRIPE_PRICE_YEARLY) missing.push('STRIPE_PRICE_YEARLY');
  return { ok: missing.length === 0, missing };
}
