'use client';

import { useState } from 'react';
import { Globe, Lock } from 'lucide-react';

/**
 * Toggle générique "Tout le monde" (icône Globe / Lock).
 *
 * Identique visuellement à RecipePublicToggle / MenuPublicToggle.
 * Pour ne pas dupliquer le code, on passe l'endpoint d'API en prop.
 *
 *  - Globe vert  : élément accessible aux visiteuses (is_public = true)
 *  - Cadenas gris : réservé aux abonnées (is_public = false, default)
 *
 * Update optimiste avec rollback en cas d'erreur HTTP.
 */
export function PublicToggle({
  endpoint,
  initial,
}: {
  /** URL PATCH ex: `/api/admin/tips/${slug}/is-public`.
   *  Body attendu côté serveur : { isPublic: boolean }. */
  endpoint: string;
  initial: boolean;
}) {
  const [isPublic, setIsPublic] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !isPublic;
    setBusy(true);
    setIsPublic(next);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: next }),
      });
      if (!res.ok) {
        setIsPublic(!next);
        const j = await res.json().catch(() => ({}));
        console.error('PublicToggle failed:', j?.error);
      }
    } catch (e) {
      setIsPublic(!next);
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={isPublic}
      aria-label={
        isPublic
          ? 'Accessible à tout le monde — désactiver'
          : 'Réservé aux abonnées — rendre public'
      }
      title={
        isPublic
          ? 'Tout le monde — clic pour réserver aux abonnées'
          : 'Réservé aux abonnées — clic pour rendre public'
      }
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition disabled:opacity-50 ${
        isPublic
          ? 'bg-sage/20 text-sage hover:bg-sage/30'
          : 'bg-admin-soft text-admin-ink hover:bg-admin-soft/70'
      }`}
    >
      {isPublic ? (
        <Globe className="h-4 w-4" strokeWidth={2.4} />
      ) : (
        <Lock className="h-4 w-4" strokeWidth={2.4} />
      )}
    </button>
  );
}
