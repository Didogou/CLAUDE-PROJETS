import 'server-only';
import Stripe from 'stripe';
import type { PlanKind } from '@/data/plans';

/**
 * Instance Stripe singleton côté serveur, en lazy-init via Proxy.
 *
 * Init au top-level cassait l'import de toute la chaîne quand
 * STRIPE_SECRET_KEY n'était pas définie (env dev incomplète) — la
 * simple visite de /profil throwait au module evaluation. Avec ce
 * Proxy, l'init n'arrive que lors d'un accès effectif à une méthode
 * Stripe, et l'erreur "config manquante" est levée avec un message
 * compréhensible plutôt que par Stripe lui-même.
 */
let _stripe: Stripe | null = null;
function getStripeInstance(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY est manquante. Configure-la dans .env.local pour utiliser une fonctionnalité Stripe.',
    );
  }
  _stripe = new Stripe(key, { typescript: true });
  return _stripe;
}
export const stripe = new Proxy({} as Stripe, {
  get(_t, prop) {
    return Reflect.get(getStripeInstance(), prop);
  },
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
