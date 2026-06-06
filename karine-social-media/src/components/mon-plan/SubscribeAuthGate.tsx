'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Sparkles, X } from 'lucide-react';
import { PLANS, type PlanKind } from '@/data/plans';

/**
 * Modal qui s'ouvre quand un visiteur clique sur un bouton de plan sur /mon-plan.
 * Propose : Se connecter ou Créer un compte. Le plan choisi est conservé dans
 * l'URL via `?plan=monthly|yearly` pour qu'au retour après auth on auto-déclenche
 * le checkout Stripe sans qu'elle ait à recliquer.
 *
 * ⚠️ Modal UX uniquement. La SÉCURITÉ est dans /api/checkout qui requireAuth().
 * Un visiteur qui contournerait cette modal (ex. JS) appellerait l'API et
 * recevrait 401 → pas de payement possible sans compte.
 */
export function SubscribeAuthGate({
  plan,
  onClose,
}: {
  plan: PlanKind | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!plan) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [plan, onClose]);

  if (!mounted || !plan) return null;

  const cfg = PLANS[plan];
  // L'URL de retour après auth contient le plan : MonPlanView le détecte et
  // déclenche automatiquement le checkout Stripe pour réduire la friction.
  const nextUrl = `/mon-plan?plan=${plan}`;
  const next = encodeURIComponent(nextUrl);

  const content = (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Souscription — ${cfg.label}`}
    >
      {/* ⚠️ Pas de onClick sur le backdrop : la modal ne se ferme QUE via
          le bouton ✕, le bouton « Annuler » ou la touche Échap. Évite la
          perte accidentelle quand on clique à côté en saisissant. */}
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <header className="mb-4 flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-coral-soft/50 text-coral-dark">
            <Sparkles className="h-6 w-6" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-coral">
              Presque fini
            </p>
            <h2 className="mt-0.5 font-script text-2xl text-coral-dark">
              Plan {cfg.label.toLowerCase()} — {cfg.priceEUR} € {cfg.period}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-coral-soft/40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <p className="text-sm text-ink">
          Pour finaliser ton abonnement, crée un compte ou connecte-toi.
          Tu seras ensuite redirigée vers le paiement sécurisé Stripe.
        </p>

        <div className="mt-5 space-y-2">
          {/* CTA principal : créer un compte. Agrandi (text-base, py-3.5)
              pour rester cohérent avec /login et la modale de tuile verrouillée. */}
          <Link
            href={`/signup?next=${next}`}
            className="block w-full rounded-full bg-coral py-3.5 text-center text-base font-bold text-white shadow-[0_6px_18px_-8px_rgba(226,120,141,0.8)] transition hover:bg-coral-dark active:scale-[0.98]"
          >
            Créer mon compte 🌸
          </Link>
          <Link
            href={`/login?next=${next}`}
            className="block w-full rounded-full border border-coral-soft bg-white py-3 text-center text-sm font-semibold text-coral-dark transition hover:bg-coral-soft/30"
          >
            J&apos;ai déjà un compte — Se connecter
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="block w-full py-2 text-center text-xs text-ink-soft hover:text-ink"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
