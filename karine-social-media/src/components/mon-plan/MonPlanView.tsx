'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  HeartHandshake,
  Lock,
  Pause,
  Play,
  Sparkles,
} from 'lucide-react';
import { PLANS, type PlanKind, type UserSubscription } from '@/data/plans';
import { SubscribeAuthGate } from './SubscribeAuthGate';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function MonPlanView({
  email,
  role,
  patientExpiresAt,
  subscription,
  checkoutStatus,
  requestedPlan,
  forbiddenNext,
}: {
  email: string;
  role: string;
  patientExpiresAt: string | null;
  subscription: UserSubscription | null;
  checkoutStatus: string | null;
  /** Plan demandé via ?plan= dans l'URL — sert à l'auto-trigger après auth. */
  requestedPlan: PlanKind | null;
  /** Page restreinte d'origine si l'utilisatrice a été redirigée par le proxy. */
  forbiddenNext: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Plan choisi par un visiteur (non connecté) → ouvre la modal auth gate. */
  const [pendingPlan, setPendingPlan] = useState<PlanKind | null>(null);
  /** Plan actuellement selectionne (ring coral autour de la carte). */
  const [selectedPlan, setSelectedPlan] = useState<PlanKind | null>(null);
  /** Case CGV/Confidentialité cochée. Obligatoire avant 'Continuer'. */
  const [acceptedTos, setAcceptedTos] = useState(false);
  /** Indique si l'utilisateur est connecté. Si email vide → visiteur. */
  const isAuthenticated = email !== '';

  // Patientes de Karine : accès gratuit, on n'affiche pas les plans
  const patientActive =
    role === 'patient' &&
    patientExpiresAt &&
    new Date(patientExpiresAt) > new Date();

  // 'paused' = Stripe l'a mis en pause (mode pause de la sub) — le user a toujours
  // un abonnement, juste suspendu temporairement. On affiche la carte sub.
  const hasActiveSub =
    subscription &&
    ['trialing', 'active', 'past_due', 'paused'].includes(subscription.status);

  async function startCheckout(plan: PlanKind) {
    setBusy(`checkout-${plan}`);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const j = await res.json().catch(() => ({}));
      // 409 alreadySubscribed : utilisatrice qui a deja un abo actif.
      // On ne redirige PAS vers Stripe (double paiement). On rafraichit
      // la page pour afficher le bloc abo actif.
      if (res.status === 409 && j?.alreadySubscribed) {
        setError(
          'Tu as déjà un abonnement actif. Gère-le depuis le portail Stripe.',
        );
        router.refresh();
        setBusy(null);
        return;
      }
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      window.location.href = j.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setBusy(null);
    }
  }

  /**
   * Étape 1 : clic sur une carte de plan → on marque le plan comme
   *           selectionne (visuel ring coral), on scrolle vers la case
   *           CGV. Aucune action irreversible a ce stade.
   */
  function onChoosePlan(plan: PlanKind) {
    setSelectedPlan(plan);
    setError(null);
    window.setTimeout(() => {
      document.getElementById('tos-checkbox')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 50);
  }

  /**
   * Étape 2 : clic sur 'Continuer vers le paiement' → exige la case CGV
   *           cochee. Si visiteur, on ouvre le gate auth. Sinon checkout.
   */
  function onContinueToPayment() {
    if (!selectedPlan) return;
    if (!acceptedTos) {
      setError(
        'Pour continuer, accepte d’abord les Conditions générales de vente.',
      );
      return;
    }
    if (!isAuthenticated) {
      setPendingPlan(selectedPlan);
      return;
    }
    startCheckout(selectedPlan);
  }

  // === AUTO-TRIGGER STRIPE après auth ===
  // Si l'URL contient ?plan=monthly|yearly ET que l'user est connecté
  // ET qu'il n'a ni patient actif ni abo actif → on lance le checkout
  // automatiquement. Évite le double clic après signup/login.
  // On déclenche au plus une fois grâce au ref.
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoTriggeredRef.current) return;
    if (!requestedPlan) return;
    if (!isAuthenticated) return;
    if (patientActive) return;
    if (hasActiveSub) return;
    autoTriggeredRef.current = true;
    startCheckout(requestedPlan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPlan, isAuthenticated, patientActive, hasActiveSub]);

  async function openPortal() {
    setBusy('portal');
    setError(null);
    try {
      const res = await fetch('/api/portal', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      window.location.href = j.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setBusy(null);
    }
  }

  async function cancelSub() {
    setBusy('cancel');
    setError(null);
    try {
      const res = await fetch('/api/subscription/cancel', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Erreur');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  async function resumeSub() {
    setBusy('resume');
    setError(null);
    try {
      const res = await fetch('/api/subscription/resume', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Erreur');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-coral">
          Mon compte
        </p>
        <h1 className="font-script text-5xl text-coral-dark">Mon plan</h1>
        <p className="mt-1 text-sm text-ink-soft">{email}</p>
      </header>

      {forbiddenNext && !hasActiveSub && !patientActive && (
        <div className="flex items-start gap-3 rounded-2xl border border-coral-soft bg-coral-soft/30 px-4 py-3 text-sm text-ink shadow-sm">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-coral-dark" />
          <p>
            La page <span className="font-semibold">{forbiddenNext}</span> est
            réservée aux abonnées et aux patientes de Karine. Choisis un plan
            ci-dessous pour y accéder.
          </p>
        </div>
      )}

      {checkoutStatus === 'success' && (
        <div className="flex items-center gap-3 rounded-2xl border border-sage/40 bg-sage/15 px-4 py-3 text-sm text-ink">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-sage" />
          <span>
            Paiement confirmé ! Ton abonnement est actif. Bienvenue.
          </span>
        </div>
      )}
      {checkoutStatus === 'cancel' && (
        <div className="rounded-2xl border border-coral-soft bg-white/80 px-4 py-3 text-sm text-ink-soft">
          Paiement annulé. Tu peux choisir un autre plan plus bas.
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* === BLOC PATIENTE === */}
      {patientActive && (
        <section className="rounded-3xl border border-coral-soft bg-white/85 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <HeartHandshake className="h-7 w-7 shrink-0 text-coral" />
            <div className="min-w-0 flex-1">
              <h2 className="font-script text-2xl text-coral-dark">
                Accès patiente de Karine
              </h2>
              <p className="mt-1 text-sm text-ink">
                Tu profites d&apos;un accès gratuit jusqu&apos;au{' '}
                <span className="font-semibold">{formatDate(patientExpiresAt)}</span>.
                Karine renouvelle ton accès si nécessaire.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* === BLOC ABONNEMENT ACTIF === */}
      {hasActiveSub && subscription && (
        <section className="rounded-3xl border border-coral-soft bg-white/85 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Sparkles className="h-7 w-7 shrink-0 text-coral" />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h2 className="font-script text-2xl text-coral-dark">
                  {subscription.planKind
                    ? `Abonnement ${PLANS[subscription.planKind].label.toLowerCase()}`
                    : 'Abonnement actif'}
                </h2>
                <p className="mt-0.5 text-sm text-ink-soft">
                  Statut : <span className="font-semibold text-ink">{subscription.status}</span>
                </p>
              </div>

              {subscription.cancelAtPeriodEnd ? (
                <div className="rounded-xl bg-tangerine/10 px-3 py-2 text-sm text-ink ring-1 ring-tangerine/40">
                  <AlertTriangle className="-mt-0.5 mr-1.5 inline h-4 w-4 text-tangerine" />
                  Annulation programmée. Accès jusqu&apos;au{' '}
                  <span className="font-semibold">
                    {formatDate(subscription.currentPeriodEnd)}
                  </span>
                  .
                </div>
              ) : (
                <p className="text-sm text-ink-soft">
                  Prochaine échéance :{' '}
                  <span className="font-semibold text-ink">
                    {formatDate(subscription.currentPeriodEnd)}
                  </span>
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openPortal}
                  disabled={busy === 'portal'}
                  className="inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
                >
                  <CreditCard className="h-4 w-4" /> Gérer la facturation
                </button>
                {subscription.cancelAtPeriodEnd ? (
                  <button
                    type="button"
                    onClick={resumeSub}
                    disabled={busy === 'resume'}
                    className="inline-flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sage/90 disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" /> Réactiver mon abonnement
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={cancelSub}
                    disabled={busy === 'cancel'}
                    className="inline-flex items-center gap-2 rounded-full border border-coral-soft bg-white px-4 py-2 text-sm font-semibold text-coral-dark shadow-sm transition hover:bg-coral-soft/30 disabled:opacity-50"
                  >
                    <Pause className="h-4 w-4" /> Annuler à la fin de la période
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* === BLOC PLANS (visiteur OU sans abo actif) === */}
      {!hasActiveSub && !patientActive && (
        <section className="space-y-3">
          <p className="text-center text-sm text-ink-soft">
            Choisis un plan pour accéder à toutes les recettes, menus et conseils.
          </p>

          <div className="grid gap-3 lg:grid-cols-2">
            <PlanCard
              plan="monthly"
              onChoose={() => onChoosePlan('monthly')}
              busy={busy === 'checkout-monthly'}
              selected={selectedPlan === 'monthly'}
            />
            <PlanCard
              plan="yearly"
              onChoose={() => onChoosePlan('yearly')}
              busy={busy === 'checkout-yearly'}
              highlighted
              selected={selectedPlan === 'yearly'}
            />
          </div>

          {/* Acceptation CGV + Confidentialité obligatoire avant paiement.
              Conformite Code de la consommation. Si decoche → clic sur
              plan est bloqué avec un message. */}
          <label
            id="tos-checkbox"
            className="flex cursor-pointer items-start gap-3 rounded-2xl border border-coral-soft bg-white/90 p-4 text-sm text-ink shadow-sm"
          >
            <input
              type="checkbox"
              checked={acceptedTos}
              onChange={(e) => {
                setAcceptedTos(e.target.checked);
                if (e.target.checked) setError(null);
              }}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-coral"
            />
            <span>
              J&apos;accepte les{' '}
              <a
                href="/cgv"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-coral underline hover:text-coral-dark"
              >
                Conditions générales de vente
              </a>{' '}
              et la{' '}
              <a
                href="/confidentialite"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-coral underline hover:text-coral-dark"
              >
                Politique de confidentialité
              </a>
              . Je demande à bénéficier immédiatement du service et renonce à
              mon droit de rétractation de 14 jours (service numérique à
              exécution immédiate).
            </span>
          </label>

          {/* Bouton 'Continuer vers le paiement' — apparait si un plan a
              ete selectionne. Le contour vert+sage indique que c'est l'etape
              finale. Disabled si CGV pas cochee. */}
          {selectedPlan && (
            <button
              type="button"
              onClick={onContinueToPayment}
              disabled={!acceptedTos || !!busy}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-coral py-3 text-sm font-bold text-white shadow-lg ring-2 ring-coral-soft/40 transition hover:bg-coral-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? 'Redirection vers le paiement…'
                : `Continuer avec le plan ${
                    selectedPlan === 'monthly' ? 'Mensuel — 8 €/mois' : 'Annuel — 80 €/an'
                  }`}
            </button>
          )}

          {!isAuthenticated && (
            <p className="text-center text-xs text-ink-soft">
              Patiente de Karine ?{' '}
              <a href="/signup" className="font-semibold text-coral underline">
                Crée un compte avec l&apos;option « patiente »
              </a>{' '}
              pour demander un accès gratuit.
            </p>
          )}
        </section>
      )}

      {/* Modal auth gate (visiteur qui clique sur un plan) */}
      <SubscribeAuthGate
        plan={pendingPlan}
        onClose={() => setPendingPlan(null)}
      />
    </div>
  );
}

function PlanCard({
  plan,
  onChoose,
  busy,
  highlighted = false,
  selected = false,
}: {
  plan: PlanKind;
  onChoose: () => void;
  busy: boolean;
  highlighted?: boolean;
  selected?: boolean;
}) {
  const cfg = PLANS[plan];
  return (
    <div
      className={`relative rounded-3xl bg-white/85 p-5 shadow-sm transition ${
        selected
          ? 'border-4 border-coral ring-4 ring-coral/40 shadow-lg'
          : highlighted
            ? 'border-2 border-coral ring-2 ring-coral/20'
            : 'border border-coral-soft'
      }`}
    >
      {highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-coral px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow">
          Économies
        </span>
      )}
      <p className="font-script text-3xl text-coral-dark">{cfg.label}</p>
      <p className="mt-1 text-3xl font-bold text-ink">
        {cfg.priceEUR} €<span className="text-base font-normal text-ink-soft"> {cfg.period}</span>
      </p>
      <p className="text-xs text-ink-soft">{cfg.perMonthLabel}</p>
      {cfg.savingLabel && (
        <p className="mt-1 text-xs font-bold text-coral-dark">{cfg.savingLabel}</p>
      )}
      <ul className="my-4 space-y-1.5 text-sm text-ink">
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
          Toutes les recettes et menus
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
          Astuces et conseils diététiques
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
          Annulation à tout moment
        </li>
      </ul>
      <button
        type="button"
        onClick={onChoose}
        disabled={busy}
        className={`w-full rounded-full py-3 text-sm font-semibold shadow-sm transition disabled:opacity-50 ${
          highlighted
            ? 'bg-coral text-white hover:bg-coral-dark'
            : 'border border-coral bg-white text-coral-dark hover:bg-coral-soft/30'
        }`}
      >
        {selected
          ? `✓ Plan ${cfg.label.toLowerCase()} sélectionné`
          : busy
            ? 'Redirection…'
            : `Choisir le ${cfg.label.toLowerCase()}`}
      </button>
    </div>
  );
}
