'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  Check,
  Clock,
  RefreshCcw,
  X,
} from 'lucide-react';
import type { ActivePatient, PatientRequest } from '@/data/patients';

type Tab = 'requests' | 'rejected' | 'actives';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function waitingBadge(days: number): { label: string; cls: string } {
  if (days >= 7)
    return {
      label: `${days} j d'attente`,
      cls: 'bg-red-100 text-red-700 ring-1 ring-red-300',
    };
  if (days >= 3)
    return {
      label: `${days} j d'attente`,
      cls: 'bg-tangerine/20 text-tangerine ring-1 ring-tangerine/40',
    };
  return {
    label: days === 0 ? "Aujourd'hui" : `${days} j d'attente`,
    cls: 'bg-sage/15 text-sage ring-1 ring-sage/40',
  };
}

function expiryBadge(days: number | null): { label: string; cls: string } {
  if (days == null) return { label: '—', cls: 'bg-admin-soft text-admin-ink' };
  if (days < 0)
    return {
      label: 'Expirée',
      cls: 'bg-red-100 text-red-700 ring-1 ring-red-300',
    };
  if (days <= 14)
    return {
      label: `${days} j restants`,
      cls: 'bg-tangerine/20 text-tangerine ring-1 ring-tangerine/40',
    };
  return {
    label: `${days} j restants`,
    cls: 'bg-sage/20 text-sage ring-1 ring-sage/40',
  };
}

export function PatientesView({
  requests,
  rejected,
  actives,
}: {
  requests: PatientRequest[];
  rejected: PatientRequest[];
  actives: ActivePatient[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(
    requests.length > 0 ? 'requests' : 'actives',
  );
  const [busy, setBusy] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modal de refus : on stocke la demande sélectionnée + le commentaire
  const [rejectTarget, setRejectTarget] = useState<PatientRequest | null>(null);

  async function call(method: 'POST', url: string, busyKey: string | number, body?: object) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
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
      <div className="flex flex-wrap gap-1 rounded-2xl bg-admin-surface p-1 shadow-sm">
        <TabButton
          active={tab === 'requests'}
          onClick={() => setTab('requests')}
          label="Demandes"
          count={requests.length}
        />
        <TabButton
          active={tab === 'actives'}
          onClick={() => setTab('actives')}
          label="Patientes actives"
          count={actives.length}
        />
        <TabButton
          active={tab === 'rejected'}
          onClick={() => setTab('rejected')}
          label="Refusées"
          count={rejected.length}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* === DEMANDES EN ATTENTE === */}
      {tab === 'requests' &&
        (requests.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
            Aucune demande en attente.
          </p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => {
              const waiting = waitingBadge(daysSince(r.createdAt));
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 rounded-2xl bg-admin-surface p-4 shadow-sm sm:flex-row sm:items-start"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <p className="truncate text-base font-bold text-admin-ink">
                        {r.fullName ?? '(nom non renseigné)'}
                      </p>
                      <span className="text-xs text-admin-ink-soft">{r.email}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="flex items-center gap-1 text-admin-ink-soft">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDate(r.createdAt)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase ${waiting.cls}`}
                      >
                        {waiting.label}
                      </span>
                      {r.reminderCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-coral/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-coral-dark ring-1 ring-coral/40">
                          <Bell className="h-3 w-3" />
                          {r.reminderCount} relance
                          {r.reminderCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
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
                        call(
                          'POST',
                          `/api/admin/patient-requests/${r.id}/approve`,
                          r.id,
                        )
                      }
                      className="flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sage/90 disabled:opacity-60"
                    >
                      <Check className="h-4 w-4" /> Valider
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => setRejectTarget(r)}
                      className="grid h-9 w-9 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-60"
                      aria-label="Refuser"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      {/* === PATIENTES ACTIVES === */}
      {tab === 'actives' &&
        (actives.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
            Aucune patiente active pour le moment.
          </p>
        ) : (
          <ul className="space-y-2">
            {actives.map((a) => {
              const badge = expiryBadge(a.daysRemaining);
              return (
                <li
                  key={a.userId}
                  className="flex flex-col gap-3 rounded-2xl bg-admin-surface p-4 shadow-sm sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <p className="truncate text-base font-bold text-admin-ink">
                        {a.fullName ?? '(nom non renseigné)'}
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
                        call(
                          'POST',
                          `/api/admin/patients/${a.userId}/renew`,
                          a.userId,
                        )
                      }
                      className="flex items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-60"
                    >
                      <RefreshCcw className="h-4 w-4" /> Renouveler 6 sem.
                    </button>
                    <button
                      type="button"
                      disabled={busy === a.userId}
                      onClick={() =>
                        call(
                          'POST',
                          `/api/admin/patients/${a.userId}/revoke`,
                          a.userId,
                        )
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

      {/* === DEMANDES REFUSÉES === */}
      {tab === 'rejected' &&
        (rejected.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
            Aucune demande refusée.
          </p>
        ) : (
          <ul className="space-y-2">
            {rejected.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-3 rounded-2xl bg-admin-surface p-4 shadow-sm sm:flex-row sm:items-start"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <p className="truncate text-base font-bold text-admin-ink">
                      {r.fullName ?? '(nom non renseigné)'}
                    </p>
                    <span className="text-xs text-admin-ink-soft">{r.email}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-admin-ink-soft">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                      Refusée le {formatDate(r.reviewedAt)}
                    </span>
                  </div>
                  {r.message && (
                    <blockquote className="mt-2 rounded-xl border-l-4 border-admin-border bg-admin-soft/40 px-3 py-2 text-xs italic text-admin-ink-soft">
                      Demande initiale : « {r.message} »
                    </blockquote>
                  )}
                  {r.reviewerComment && (
                    <blockquote className="mt-1 rounded-xl border-l-4 border-red-300 bg-red-50/50 px-3 py-2 text-xs italic text-admin-ink">
                      Ta réponse : « {r.reviewerComment} »
                    </blockquote>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() =>
                      call(
                        'POST',
                        `/api/admin/patient-requests/${r.id}/approve`,
                        r.id,
                      )
                    }
                    className="flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sage/90 disabled:opacity-60"
                  >
                    <Check className="h-4 w-4" /> Valider quand même
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ))}

      <RejectModal
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={async (comment) => {
          if (!rejectTarget) return;
          await call(
            'POST',
            `/api/admin/patient-requests/${rejectTarget.id}/reject`,
            rejectTarget.id,
            { comment },
          );
          setRejectTarget(null);
        }}
        busy={busy === rejectTarget?.id}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
        active
          ? 'bg-admin-primary text-white shadow'
          : 'text-admin-ink-soft hover:bg-admin-soft/40'
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${
            active ? 'bg-white text-admin-primary' : 'bg-admin-soft text-admin-ink'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function RejectModal({
  target,
  onClose,
  onConfirm,
  busy,
}: {
  target: PatientRequest | null;
  onClose: () => void;
  onConfirm: (comment: string) => Promise<void>;
  busy: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [comment, setComment] = useState('');
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset le commentaire à chaque ouverture (nouvelle target)
  useEffect(() => {
    if (target) setComment('');
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [target, busy, onClose]);

  if (!mounted || !target) return null;

  const content = (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Refuser la demande de ${target.fullName ?? target.email}`}
    >
      {/* ⚠️ Pas de close sur clic backdrop pour éviter une perte de saisie. */}
      <div className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl sm:p-7">
        <header className="mb-4 flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200">
            <X className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-admin-primary">
              Refuser la demande
            </p>
            <h2 className="mt-0.5 font-script text-2xl text-admin-primary-dark">
              {target.fullName ?? target.email}
            </h2>
            <p className="mt-0.5 text-xs text-admin-ink-soft">{target.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-admin-ink-soft transition hover:bg-admin-soft/40 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <label className="block text-sm font-semibold text-admin-ink">
          Message envoyé à la patiente
          <span className="ml-1 font-normal text-admin-ink-soft">(facultatif)</span>
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Ex. Je ne te reconnais pas comme patiente. Si tu pensais à un autre nom, écris-moi…"
          className="mt-2 w-full rounded-xl border border-admin-border bg-white px-3 py-2 text-sm text-admin-ink outline-none transition focus:border-admin-primary focus:shadow-[0_0_0_3px_rgba(199,90,115,0.15)]"
          autoFocus
        />
        <p className="mt-1 text-xs text-admin-ink-soft">
          La patiente recevra ce message par email. Elle pourra toujours
          s&apos;abonner à la place.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-full border border-admin-border bg-white px-4 py-3 text-sm font-semibold text-admin-ink shadow-sm transition hover:bg-admin-soft/30 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onConfirm(comment)}
            disabled={busy}
            className="flex-1 rounded-full bg-red-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Envoi…' : 'Refuser & envoyer'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
