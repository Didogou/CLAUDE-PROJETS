'use client';

import { AlertTriangle, CheckCircle2, Pause, XCircle } from 'lucide-react';
import { PLANS } from '@/data/plans';
import type { Subscriber } from '@/data/subscribers';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function StatusPill({ s }: { s: Subscriber }) {
  if (!s.status)
    return <span className="text-xs text-admin-ink-soft">—</span>;

  if (s.cancelAtPeriodEnd && ['active', 'trialing'].includes(s.status)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-tangerine/15 px-2 py-0.5 text-xs font-bold text-tangerine ring-1 ring-tangerine/40">
        <AlertTriangle className="h-3 w-3" />
        Annulation programmée
      </span>
    );
  }
  if (s.status === 'active' || s.status === 'trialing')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sage/15 px-2 py-0.5 text-xs font-bold text-sage ring-1 ring-sage/40">
        <CheckCircle2 className="h-3 w-3" />
        Actif
      </span>
    );
  if (s.status === 'past_due')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700 ring-1 ring-red-200">
        <AlertTriangle className="h-3 w-3" />
        Impayé
      </span>
    );
  if (s.status === 'paused')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-admin-soft px-2 py-0.5 text-xs font-bold text-admin-ink ring-1 ring-admin-border">
        <Pause className="h-3 w-3" />
        En pause
      </span>
    );
  if (s.status === 'canceled')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-admin-soft px-2 py-0.5 text-xs font-bold text-admin-ink-soft ring-1 ring-admin-border">
        <XCircle className="h-3 w-3" />
        Résilié
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-admin-soft px-2 py-0.5 text-xs font-bold text-admin-ink-soft ring-1 ring-admin-border">
      {s.status}
    </span>
  );
}

export function AbonnesView({ subscribers }: { subscribers: Subscriber[] }) {
  if (subscribers.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
        Aucun abonné pour l&apos;instant. Le 1ᵉʳ paiement Stripe le fera apparaître ici.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl bg-admin-surface shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-admin-border bg-admin-soft/40 text-left text-xs font-semibold uppercase tracking-wide text-admin-ink-soft">
            <th className="px-4 py-3">Abonné</th>
            <th className="px-3 py-3">Plan</th>
            <th className="px-3 py-3">Statut</th>
            <th className="px-3 py-3">Prochaine échéance</th>
            <th className="px-3 py-3">Souscrit le</th>
          </tr>
        </thead>
        <tbody>
          {subscribers.map((s) => (
            <tr
              key={`${s.userId}-${s.createdAt}`}
              className="border-b border-admin-border last:border-0 hover:bg-admin-soft/20"
            >
              <td className="px-4 py-3">
                <p className="font-semibold text-admin-ink">
                  {s.fullName || s.email || '(sans nom)'}
                </p>
                {s.fullName && (
                  <p className="text-xs text-admin-ink-soft">{s.email}</p>
                )}
              </td>
              <td className="px-3 py-3">
                {s.planKind ? (
                  <span className="font-semibold text-admin-ink">
                    {PLANS[s.planKind].label}{' '}
                    <span className="text-xs text-admin-ink-soft">
                      {PLANS[s.planKind].priceEUR} €
                      {PLANS[s.planKind].period}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-admin-ink-soft">—</span>
                )}
              </td>
              <td className="px-3 py-3">
                <StatusPill s={s} />
              </td>
              <td className="px-3 py-3">
                <span className="text-admin-ink">
                  {formatDate(s.currentPeriodEnd)}
                </span>
                {s.daysUntilRenewal != null && s.daysUntilRenewal >= 0 && (
                  <p className="text-xs text-admin-ink-soft">
                    dans {s.daysUntilRenewal} j
                  </p>
                )}
              </td>
              <td className="px-3 py-3 text-xs text-admin-ink-soft">
                {formatDate(s.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
