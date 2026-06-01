import Link from 'next/link';
import {
  AlertTriangle,
  CreditCard,
  HeartHandshake,
  Sparkles,
} from 'lucide-react';
import { PLANS, type UserSubscription } from '@/data/plans';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Carte « Mon plan » affichée sur /profil. Adapte son contenu selon l'état :
 *  - Patient actif (rôle patient + expiry > now) → carte rose + date d'expiration
 *  - Abonné actif (sub trialing/active/past_due/paused) → carte coral + plan + échéance
 *  - Aucun des deux → CTA discret « Voir les abonnements »
 */
export function MyPlanCard({
  role,
  patientExpiresAt,
  subscription,
}: {
  role: string;
  patientExpiresAt: string | null;
  subscription: UserSubscription | null;
}) {
  const patientActive =
    role === 'patient' &&
    patientExpiresAt &&
    new Date(patientExpiresAt) > new Date();

  const hasActiveSub =
    subscription &&
    ['trialing', 'active', 'past_due', 'paused'].includes(subscription.status);

  // === CAS 1 : Patiente active ===
  if (patientActive) {
    return (
      <section className="rounded-2xl border border-coral-soft bg-white/85 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-coral-dark">
            <HeartHandshake className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-coral">
              Mon plan
            </p>
            <h2 className="mt-0.5 font-script text-2xl text-coral-dark">
              Accès patiente gratuit
            </h2>
            <p className="mt-1 text-sm text-ink">
              Tu profites d&apos;un accès patiente jusqu&apos;au{' '}
              <span className="font-semibold">{formatDate(patientExpiresAt)}</span>.
            </p>
            <Link
              href="/mon-plan"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-coral hover:text-coral-dark hover:underline"
            >
              Voir mon plan en détail →
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // === CAS 2 : Abonnement actif ===
  if (hasActiveSub && subscription) {
    return (
      <section className="rounded-2xl border border-coral-soft bg-white/85 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-coral-dark">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-coral">
              Mon plan
            </p>
            <h2 className="font-script text-2xl text-coral-dark">
              {subscription.planKind
                ? `Abonnement ${PLANS[subscription.planKind].label.toLowerCase()}`
                : 'Abonnement actif'}
            </h2>
            {subscription.cancelAtPeriodEnd ? (
              <p className="flex items-start gap-1.5 text-xs text-tangerine">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Annulation programmée — accès jusqu&apos;au{' '}
                <span className="font-semibold">
                  {formatDate(subscription.currentPeriodEnd)}
                </span>
              </p>
            ) : (
              <p className="text-xs text-ink-soft">
                Prochaine échéance :{' '}
                <span className="font-semibold text-ink">
                  {formatDate(subscription.currentPeriodEnd)}
                </span>
              </p>
            )}
            <Link
              href="/mon-plan"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-coral-dark"
            >
              <CreditCard className="h-3.5 w-3.5" />
              Gérer mon abonnement
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // === CAS 3 : Visiteur connecté sans abo ===
  return (
    <section className="rounded-2xl border border-dashed border-coral-soft bg-white/85 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-coral-dark">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-coral">
            Mon plan
          </p>
          <h2 className="mt-0.5 font-script text-2xl text-coral-dark">
            Aucun abonnement
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Souscris à un plan pour accéder à toutes les recettes, menus et
            conseils de Karine.
          </p>
          <Link
            href="/mon-plan"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark"
          >
            <Sparkles className="h-4 w-4" />
            Voir les abonnements
          </Link>
        </div>
      </div>
    </section>
  );
}
