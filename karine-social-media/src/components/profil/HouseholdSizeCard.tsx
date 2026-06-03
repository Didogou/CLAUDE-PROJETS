'use client';

import { useState } from 'react';
import { Check, Minus, Plus, Users } from 'lucide-react';

/**
 * Carte pour configurer la taille du foyer.
 *
 * Cette valeur sert à dimensionner la liste de courses : quand l'user
 * clique "Ajouter à ma liste" sur une recette pour 4 personnes et
 * que son foyer = 3, on multiplie les quantités par 3/4 = 0,75.
 */
export function HouseholdSizeCard({
  initialSize,
}: {
  initialSize: number;
}) {
  const [size, setSize] = useState(initialSize);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(newSize: number) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/profile/household', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ householdSize: newSize }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Échec de la sauvegarde');
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setSize(initialSize); // rollback
    } finally {
      setSaving(false);
    }
  }

  function update(newSize: number) {
    const clamped = Math.max(1, Math.min(20, newSize));
    if (clamped === size) return;
    setSize(clamped);
    save(clamped);
  }

  return (
    <div className="rounded-2xl bg-white/85 p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Users className="h-5 w-5 text-coral" />
        <h2 className="font-script text-xl text-coral">Mon foyer</h2>
      </header>
      <p className="mb-3 text-xs text-ink-soft">
        Sert à dimensionner ta liste de courses (recettes et menus
        multipliés automatiquement).
      </p>
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => update(size - 1)}
          disabled={size <= 1 || saving}
          aria-label="Moins de personnes"
          className="grid h-12 w-12 place-items-center rounded-full bg-coral-soft/40 text-coral-dark transition hover:bg-coral-soft disabled:opacity-30"
        >
          <Minus className="h-5 w-5" />
        </button>
        <span className="font-script text-5xl font-bold text-coral-dark">
          {size}
        </span>
        <button
          type="button"
          onClick={() => update(size + 1)}
          disabled={size >= 20 || saving}
          aria-label="Plus de personnes"
          className="grid h-12 w-12 place-items-center rounded-full bg-coral-soft/40 text-coral-dark transition hover:bg-coral-soft disabled:opacity-30"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-2 text-center text-xs font-semibold text-ink-soft">
        {size > 1 ? 'personnes' : 'personne'}
      </p>
      {savedFlash && (
        <p className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold text-emerald-600">
          <Check className="h-3 w-3" /> Mise à jour enregistrée
        </p>
      )}
      {error && (
        <p className="mt-2 text-center text-xs font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
