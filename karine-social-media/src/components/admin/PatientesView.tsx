'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock, RefreshCcw, X } from 'lucide-react';
import type { ActivePatient, PatientRequest } from '@/data/patients';

type Tab = 'requests' | 'actives';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function statusBadge(days: number | null): { label: string; cls: string } {
  if (days == null) return { label: '—', cls: 'bg-admin-soft text-admin-ink' };
  if (days < 0) return { label: 'Expirée', cls: 'bg-red-100 text-red-700 ring-1 ring-red-300' };
  if (days <= 14) return { label: `${days} j restants`, cls: 'bg-tangerine/20 text-tangerine ring-1 ring-tangerine/40' };
  return { label: `${days} j restants`, cls: 'bg-sage/20 text-sage ring-1 ring-sage/40' };
}

export function PatientesView({
  requests,
  actives,
}: {
  requests: PatientRequest[];
  actives: ActivePatient[];
}) {
  const [tab, setTab] = useState<Tab>(requests.length > 0 ? 'requests' : 'actives');
  const router = useRouter();
  const [busy, setBusy] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(method: 'POST', url: string, busyKey: string | number) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(url, { method });
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
    <div className="space-y-4">
      {/* Onglets */}
      <div className="flex gap-1 rounded-2xl bg-admin-surface p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setTab('requests')}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
            tab === 'requests'
              ? 'bg-admin-primary text-white shadow'
              : 'text-admin-ink-soft hover:bg-admin-soft/40'
          }`}
        >
          Demandes
          {requests.length > 0 && (
            <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-admin-primary">
              {requests.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('actives')}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
            tab === 'actives'
              ? 'bg-admin-primary text-white shadow'
              : 'text-admin-ink-soft hover:bg-admin-soft/40'
          }`}
        >
          Patientes actives
          {actives.length > 0 && (
            <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-admin-primary">
              {actives.length}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {tab === 'requests' &&
        (requests.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
            Aucune demande en attente.
          </p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-3 rounded-2xl bg-admin-surface p-4 shadow-sm sm:flex-row sm:items-start"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <p className="truncate text-base font-semibold text-admin-ink">
                      {r.fullName || r.email}
                    </p>
                    <span className="text-xs text-admin-ink-soft">{r.email}</span>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-admin-ink-soft">
                    <Clock className="h-3.5 w-3.5" />
                    Demande du {formatDate(r.createdAt)}
                  </p>
                  {r.message && (
                    <blockquote className="mt-2 rounded-xl border-l-4 border-admin-primary bg-admin-soft/40 px-3 py-2 text-sm italic text-admin-ink">
                      « {r.message} »
                    </blockquote>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() =>
                      call('POST', `/api/admin/patient-requests/${r.id}/approve`, r.id)
                    }
                    className="flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sage/90 disabled:opacity-60"
                  >
                    <Check className="h-4 w-4" /> Valider
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() =>
                      call('POST', `/api/admin/patient-requests/${r.id}/reject`, r.id)
                    }
                    className="grid h-9 w-9 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-60"
                    aria-label="Refuser"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ))}

      {tab === 'actives' &&
        (actives.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
            Aucune patiente active pour le moment.
          </p>
        ) : (
          <ul className="space-y-2">
            {actives.map((a) => {
              const badge = statusBadge(a.daysRemaining);
              return (
                <li
                  key={a.userId}
                  className="flex flex-col gap-3 rounded-2xl bg-admin-surface p-4 shadow-sm sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <p className="truncate text-base font-semibold text-admin-ink">
                        {a.fullName || a.email}
                      </p>
                      <span className="text-xs text-admin-ink-soft">{a.email}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-admin-ink-soft">
                      <span>Expire le {formatDate(a.expiresAt)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy === a.userId}
                      onClick={() =>
                        call('POST', `/api/admin/patients/${a.userId}/renew`, a.userId)
                      }
                      className="flex items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-60"
                    >
                      <RefreshCcw className="h-4 w-4" /> Renouveler 6 sem.
                    </button>
                    <button
                      type="button"
                      disabled={busy === a.userId}
                      onClick={() =>
                        call('POST', `/api/admin/patients/${a.userId}/revoke`, a.userId)
                      }
                      className="grid h-9 w-9 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-60"
                      aria-label="R&eacute;voquer l&apos;acc&egrave;s"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
