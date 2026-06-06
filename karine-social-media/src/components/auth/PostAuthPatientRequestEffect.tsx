'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { popPendingPatientRequest } from '@/lib/pending-patient-request';

/**
 * Effet client global qui finalise une demande d'accès patiente
 * stashée juste avant un round-trip OAuth (cf. lib/pending-patient-request).
 *
 * Monté une fois dans le RootLayout. Au mount, consomme la clé
 * sessionStorage (one-shot) et POST /api/patient-requests. Quand la
 * réponse arrive, affiche une **modale plein écran** par-dessus la
 * page d'atterrissage — même panneau visuel que le SignupForm
 * classique avec la case patiente cochée (fond sage, icône check,
 * titre script « Demande envoyée à Karine », bouton Continuer).
 *
 * Pourquoi modale et pas toast : un toast 5 secondes n'est pas assez
 * visible pour une action métier importante comme une demande à
 * Karine (cf. retour Didier 2026-06-08). La modale reste affichée
 * tant que l'utilisatrice ne clique pas Continuer.
 *
 * États possibles selon le retour de l'API :
 *  - `created`        → nouvelle demande créée
 *  - `reminder`       → demande existait, notif relancée
 *  - `already_active` → déjà patiente active
 *  - `cooldown`       → relance trop tôt (avec délai restant)
 *  - `error`          → réseau ou serveur
 *
 * Comportement silencieux quand il n'y a rien à finaliser : la
 * quasi-totalité des navigations passent ici sans rien faire.
 */
type Result =
  | { kind: 'created' }
  | { kind: 'reminder' }
  | { kind: 'already_active' }
  | { kind: 'cooldown'; days: number }
  | { kind: 'error' };

export function PostAuthPatientRequestEffect() {
  const [mounted, setMounted] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const message = popPendingPatientRequest();
      if (message === null) return;

      // Vérifie qu'on est bien authentifié. Si l'OAuth a échoué et
      // qu'on est de retour sans session, on ne POST pas (sinon 401).
      // La demande est perdue — l'utilisatrice pourra refaire depuis
      // son profil.
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      try {
        const res = await fetch('/api/patient-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        if (cancelled) return;
        const json = (await res.json().catch(() => ({}))) as {
          reminder?: boolean;
          cooldownRemainingDays?: number;
        };
        if (res.ok) {
          setResult({ kind: json.reminder ? 'reminder' : 'created' });
        } else if (res.status === 400) {
          setResult({ kind: 'already_active' });
        } else if (res.status === 429) {
          setResult({
            kind: 'cooldown',
            days: typeof json.cooldownRemainingDays === 'number'
              ? json.cooldownRemainingDays
              : 0,
          });
        } else {
          setResult({ kind: 'error' });
        }
      } catch {
        if (!cancelled) setResult({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mounted || !result || dismissed) return null;

  const isError = result.kind === 'error';

  const title = (() => {
    switch (result.kind) {
      case 'created':
      case 'reminder':
        return 'Demande envoyée à Karine';
      case 'already_active':
        return 'Tu es déjà patiente';
      case 'cooldown':
        return 'Patiente encore un peu';
      case 'error':
        return 'On n’a pas pu transmettre ta demande';
    }
  })();

  const message = (() => {
    switch (result.kind) {
      case 'created':
        return 'Karine est prévenue de ta demande. Tu auras un accès gratuit dès qu’elle l’aura validée. Tu peux aussi t’abonner en attendant depuis ton plan.';
      case 'reminder':
        return 'Une demande existait déjà — Karine vient d’être notifiée à nouveau, elle te répondra bientôt.';
      case 'already_active':
        return 'Tu as déjà un accès patiente actif. Profite de l’application !';
      case 'cooldown':
        return `Tu pourras relancer Karine dans ${result.days} jour${result.days > 1 ? 's' : ''}.`;
      case 'error':
        return 'Tu peux refaire la démarche depuis ton profil dès que tu veux.';
    }
  })();

  const palette = isError
    ? {
        ring: 'border-coral-soft/60 shadow-[0_18px_40px_-10px_rgba(226,120,141,0.35)]',
        iconWrap: 'bg-coral-soft/40 text-coral-dark',
        Icon: AlertCircle,
      }
    : {
        ring: 'border-sage/40 shadow-[0_18px_40px_-10px_rgba(140,180,140,0.45)]',
        iconWrap: 'bg-sage/15 text-sage',
        Icon: CheckCircle2,
      };
  const { Icon } = palette;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-3 py-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-auth-patient-title"
    >
      <section
        className={`w-full max-w-md rounded-3xl border bg-white/95 px-5 py-7 text-center backdrop-blur-sm sm:px-8 sm:py-8 ${palette.ring}`}
      >
        <div
          className={`mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full ${palette.iconWrap}`}
        >
          <Icon className="h-8 w-8" strokeWidth={2} />
        </div>
        <h2
          id="post-auth-patient-title"
          className="font-script text-3xl text-coral-dark sm:text-4xl"
        >
          {title}
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink">
          {message}
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-coral px-6 py-3 text-sm font-bold text-white shadow-[0_6px_18px_-8px_rgba(226,120,141,0.8)] transition hover:bg-coral-dark active:scale-[0.98]"
        >
          Continuer
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </section>
    </div>,
    document.body,
  );
}
