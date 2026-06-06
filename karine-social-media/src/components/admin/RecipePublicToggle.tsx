'use client';

import { useState } from 'react';
import { Globe, Lock } from 'lucide-react';

/**
 * Toggle "Tout le monde" pour une recette dans la liste admin.
 *
 * - Vert (Globe + ON) → recette publique, accessible aux visiteurs
 * - Gris (Lock + OFF) → recette réservée aux abonnées (default)
 *
 * Update optimiste : on bascule l'état UI immédiatement, puis on
 * envoie le PATCH. En cas d'erreur, on rollback.
 */
export function RecipePublicToggle({
  slug,
  initial,
}: {
  slug: string;
  initial: boolean;
}) {
  const [isPublic, setIsPublic] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !isPublic;
    setBusy(true);
    setIsPublic(next); // optimiste
    try {
      const res = await fetch(`/api/admin/recipes/${slug}/is-public`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: next }),
      });
      if (!res.ok) {
        setIsPublic(!next); // rollback
        const j = await res.json().catch(() => ({}));
        console.error('toggle is_public failed:', j?.error);
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
          ? 'Recette accessible à tout le monde — désactiver'
          : 'Recette réservée aux abonnées — rendre publique'
      }
      title={
        isPublic
          ? 'Tout le monde — clic pour réserver aux abonnées'
          : 'Réservée aux abonnées — clic pour rendre publique'
      }
      // Bouton rond icône seule (cohérent avec les actions Modifier/
      // Supprimer à droite). Le sens est transmis par l'icône + le
      // aria-label + le title (tooltip hover desktop).
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
