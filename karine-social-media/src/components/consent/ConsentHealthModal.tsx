'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Heart, ShieldCheck, X } from 'lucide-react';

/**
 * Modale de consentement explicite Art. 9 RGPD pour le traitement
 * des donnees de sante (poids, taille, sexe, objectif perte).
 *
 * Affichee la PREMIERE FOIS qu'une utilisatrice tente de saisir une
 * donnee de sante. Le caller passe `open` selon `profile.consent_health_at`
 * (null → afficher).
 *
 * Bouton "Je consens" → POST /api/profile/consent-health → onAccepted.
 * Bouton "Annuler" → close + onCancelled (le caller annule la saisie).
 *
 * Texte du consentement reglemente :
 *  - Finalite : calcul des besoins nutritionnels personnalises
 *  - Base legale : consentement explicite Art. 9-2-a RGPD
 *  - Retrait : possible a tout moment via /profil
 *  - Conservation : tant que le compte est actif
 */
export function ConsentHealthModal({
  open,
  onAccepted,
  onCancelled,
}: {
  open: boolean;
  onAccepted: () => void;
  onCancelled: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setChecked(false);
    setError(null);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !mounted) return null;

  async function handleAccept() {
    if (!checked) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/profile/consent-health', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Erreur serveur');
      }
      onAccepted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
      setLoading(false);
    }
  }

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Consentement données de santé"
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-cream shadow-2xl sm:max-h-[85vh] sm:rounded-3xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-coral-soft/40 bg-cream/95 px-4 py-3 backdrop-blur-sm sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[0.55rem] font-bold uppercase tracking-[0.22em] text-coral">
              RGPD · Art. 9
            </p>
            <h2 className="truncate font-script text-xl text-coral-dark sm:text-2xl">
              Tes données de santé
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancelled}
            aria-label="Fermer"
            disabled={loading}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral-soft/30 text-coral-dark transition hover:bg-coral-soft/60 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-coral-soft/30 text-coral-dark">
            <Heart className="h-7 w-7" />
          </div>

          <p className="text-center text-sm text-ink">
            Pour calculer tes besoins nutritionnels personnalisés
            (calories, protéines, etc.), Karine a besoin de connaître
            quelques données de santé&nbsp;:
          </p>
          <ul className="mt-3 space-y-1 text-sm text-ink-soft">
            <li>• ton <strong>poids</strong> actuel</li>
            <li>• ta <strong>taille</strong></li>
            <li>• ton <strong>sexe</strong> (besoins métaboliques différents)</li>
            <li>• ton <strong>objectif</strong> (maintien, perte de poids…)</li>
          </ul>

          <div className="mt-5 rounded-2xl border border-coral-soft/40 bg-white p-4 text-[0.8rem] text-ink">
            <p className="mb-2 flex items-center gap-2 font-bold text-coral-dark">
              <ShieldCheck className="h-4 w-4" />
              Tes droits
            </p>
            <ul className="space-y-1.5 text-ink-soft">
              <li>
                <strong>Finalité :</strong> calcul de tes besoins
                nutritionnels uniquement.
              </li>
              <li>
                <strong>Base légale :</strong> ton consentement explicite
                (Art. 9-2-a RGPD).
              </li>
              <li>
                <strong>Accès :</strong> uniquement toi et Karine. Aucun
                partage commercial.
              </li>
              <li>
                <strong>Conservation :</strong> tant que ton compte est
                actif. Suppression dans les 30 jours après fermeture.
              </li>
              <li>
                <strong>Retrait :</strong> à tout moment depuis ton
                profil — tes données seront immédiatement supprimées.
              </li>
            </ul>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-coral-soft bg-white p-4 transition hover:border-coral hover:bg-coral-soft/10">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-coral"
            />
            <span className="text-sm text-ink">
              <strong>Je consens</strong> au traitement de mes données de
              santé pour le calcul de mes besoins nutritionnels par Karine
              Diététique. Je peux retirer ce consentement à tout moment.
            </span>
          </label>

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancelled}
              disabled={loading}
              className="rounded-full bg-coral-soft/30 px-5 py-2.5 text-sm font-semibold text-coral-dark transition hover:bg-coral-soft/50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={!checked || loading}
              className="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Enregistrement…' : 'Je consens'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
