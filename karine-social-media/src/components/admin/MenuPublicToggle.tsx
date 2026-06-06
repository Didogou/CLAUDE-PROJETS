'use client';

import { useState } from 'react';
import { Globe, Lock } from 'lucide-react';

/**
 * Toggle "Tout le monde" pour un menu hebdomadaire dans la liste
 * admin (équivalent de RecipePublicToggle).
 *
 *  - Globe vert  → menu accessible aux visiteuses non abonnées
 *  - Cadenas gris → menu réservé aux abonnées (default)
 *
 * Update optimiste avec rollback en cas d'erreur.
 */
export function MenuPublicToggle({
  id,
  initial,
}: {
  id: string;
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
      const res = await fetch(`/api/admin/menus/${id}/is-public`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: next }),
      });
      if (!res.ok) {
        setIsPublic(!next);
        const j = await res.json().catch(() => ({}));
        console.error('toggle menu is_public failed:', j?.error);
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
          ? 'Menu accessible à tout le monde — désactiver'
          : 'Menu réservé aux abonnées — rendre public'
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
