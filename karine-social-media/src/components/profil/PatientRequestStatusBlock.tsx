'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  BellRing,
  Clock,
  HeartHandshake,
  RefreshCcw,
} from 'lucide-react';
import type { PatientRequest } from '@/data/patients';

function daysSince(iso: string): number {
  return Math.floor(
    (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24),
  );
}

/**
 * Bloc affiché sur /profil pour montrer à la patiente l'état de sa demande
 * d'accès et lui permettre de relancer Karine si nécessaire.
 *
 * 2 cas :
 *  - Demande pending : « Demande en cours, Karine te répondra ». Bouton
 *    Relancer Karine actif/désactivé selon le cooldown.
 *  - Demande rejected : affiche le commentaire de Karine et propose de
 *    refaire une nouvelle demande.
 */
export function PatientRequestStatusBlock({
  request,
  cooldownDays,
}: {
  request: PatientRequest;
  cooldownDays: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Calcul du cooldown côté client. Le serveur revérifie de toute façon.
  const lastAction = request.lastReminderAt
    ? new Date(request.lastReminderAt) > new Date(request.createdAt)
      ? request.lastReminderAt
      : request.createdAt
    : request.createdAt;
  const daysWaited = daysSince(lastAction);
  const cooldownActive = cooldownDays > 0 && daysWaited < cooldownDays;
  const daysUntilNext = cooldownDays - daysWaited;

  async function relance() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/patient-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      setSuccess(
        j?.reminder
          ? 'Karine vient d\'être notifiée à nouveau. Tu auras une réponse bientôt.'
          : 'Demande envoyée.',
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  // === CAS 1 : Demande pending ===
  if (request.status === 'pending') {
    return (
      <section className="rounded-2xl border border-coral-soft bg-white/85 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-coral-dark">
            <HeartHandshake className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="font-script text-2xl text-coral-dark">
              Demande en cours
            </h2>
            <p className="text-sm text-ink">
              Karine a bien reçu ta demande d&apos;accès patiente. Elle te
              répondra bientôt par email.
            </p>
            <p className="flex items-center gap-1.5 text-xs text-ink-soft">
              <Clock className="h-3.5 w-3.5" />
              Demande du {new Date(request.createdAt).toLocaleDateString('fr-FR')}
              {request.reminderCount > 0 && (
                <>
                  {' · '}
                  {request.reminderCount} relance
                  {request.reminderCount > 1 ? 's' : ''}
                </>
              )}
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p className="mt-3 rounded-xl border border-sage/40 bg-sage/10 px-3 py-2 text-xs text-ink">
            {success}
          </p>
        )}

        <div className="mt-4">
          <button
            type="button"
            onClick={relance}
            disabled={busy || cooldownActive}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-coral py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:cursor-not-allowed disabled:bg-coral-soft disabled:text-coral-dark/60"
          >
            <BellRing className="h-4 w-4" />
            {busy
              ? 'Envoi…'
              : cooldownActive
                ? `Tu pourras relancer dans ${daysUntilNext} jour${daysUntilNext > 1 ? 's' : ''}`
                : 'Relancer Karine'}
          </button>
          {cooldownDays > 0 && !cooldownActive && (
            <p className="mt-2 text-center text-[0.65rem] text-ink-soft">
              Pour rester respectueuse, attends {cooldownDays} jours entre
              chaque relance.
            </p>
          )}
        </div>
      </section>
    );
  }

  // === CAS 2 : Demande rejected ===
  return (
    <section className="rounded-2xl border border-red-200 bg-white/85 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="font-script text-2xl text-coral-dark">
            Demande non retenue
          </h2>
          <p className="text-sm text-ink">
            Karine n&apos;a pas retenu ta demande d&apos;accès gratuit.
          </p>
          {request.reviewerComment && (
            <blockquote className="mt-2 rounded-xl border-l-4 border-red-300 bg-red-50/50 px-3 py-2 text-sm italic text-ink">
              « {request.reviewerComment} »
            </blockquote>
          )}
          <p className="mt-2 text-xs text-ink-soft">
            Tu peux toujours souscrire un abonnement depuis{' '}
            <a href="/mon-plan" className="font-semibold text-coral underline">
              ton plan
            </a>
            .
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-3 rounded-xl border border-sage/40 bg-sage/10 px-3 py-2 text-xs text-ink">
          {success}
        </p>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={relance}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-coral-soft bg-white py-2.5 text-sm font-semibold text-coral-dark shadow-sm transition hover:bg-coral-soft/30 disabled:opacity-50"
        >
          <RefreshCcw className="h-4 w-4" />
          {busy ? 'Envoi…' : 'Refaire une demande'}
        </button>
      </div>
    </section>
  );
}
