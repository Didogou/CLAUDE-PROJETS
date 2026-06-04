'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, ChevronRight, Flame, ImagePlus, Save } from 'lucide-react';
import type { AppSettings } from '@/data/app-settings';

export function ParametresView({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [cooldown, setCooldown] = useState<number>(
    initial.patientRelanceCooldownDays,
  );
  const [showCalories, setShowCalories] = useState<boolean>(
    initial.showCaloriesInCounter,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_relance_cooldown_days: cooldown,
          show_calories_in_counter: showCalories,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Erreur');
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* === Lien vers la page Fonds d'écran === */}
      <Link
        href="/admin/parametres/fonds"
        className="flex items-center gap-3 rounded-2xl bg-admin-surface p-5 shadow-sm transition hover:shadow-md"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-coral-dark">
          <ImagePlus className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-admin-ink">Fonds d&apos;écran</h3>
          <p className="mt-0.5 text-xs text-admin-ink-soft">
            Personnaliser les images de fond pour chaque section (mobile + PC).
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-admin-ink-soft" />
      </Link>

      <form onSubmit={handleSubmit} className="space-y-5">
      {/* === Section : Délai entre relances patiente === */}
      <section className="rounded-2xl bg-admin-surface p-5 shadow-sm">
        <header className="mb-3 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-coral-dark">
            <BellRing className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-admin-ink">
              Délai entre relances patientes
            </h3>
            <p className="mt-0.5 text-xs text-admin-ink-soft">
              Nombre de jours minimum qu&apos;une patiente doit attendre avant de
              pouvoir te relancer depuis son profil. <b>0</b> = pas de limite (utile
              pour les tests). <b>3</b> = recommandé en production pour rester
              respectueux.
            </p>
          </div>
        </header>

        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-admin-ink">
            Cooldown :
          </label>
          <input
            type="number"
            min={0}
            max={365}
            step={1}
            value={cooldown}
            onChange={(e) => setCooldown(Number(e.target.value))}
            disabled={busy}
            className="w-20 rounded-lg border border-admin-border bg-white px-3 py-2 text-center text-sm font-bold text-admin-ink outline-none transition focus:border-admin-primary focus:shadow-[0_0_0_3px_rgba(199,90,115,0.15)]"
          />
          <span className="text-sm text-admin-ink-soft">jour(s)</span>
        </div>
      </section>

      {/* === Section : Affichage des kcal côté abonnée === */}
      <section className="rounded-2xl bg-admin-surface p-5 shadow-sm">
        <header className="mb-3 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-coral-dark">
            <Flame className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-admin-ink">
              Montrer les calories dans Mes calories
            </h3>
            <p className="mt-0.5 text-xs text-admin-ink-soft">
              Si activé, les abonnées voient les <b>kcal/100g</b> et la
              valeur calorique de chaque candidat dans la fenêtre Mes
              calories. <b>Désactiver</b> pour un mode focus aliments
              (anti-stress chiffres).
            </p>
          </div>
        </header>

        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={showCalories}
            onChange={(e) => setShowCalories(e.target.checked)}
            disabled={busy}
            className="h-5 w-5 rounded border-admin-border text-admin-primary focus:ring-admin-primary"
          />
          <span className="text-sm font-semibold text-admin-ink">
            {showCalories ? 'Activé' : 'Désactivé'}
          </span>
        </label>
      </section>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-sage/40 bg-sage/10 px-3 py-2 text-sm text-ink">
          ✅ Paramètres sauvegardés. Effet immédiat sur l&apos;app.
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-admin-primary py-3 text-sm font-bold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50 sm:w-auto sm:px-6"
      >
        <Save className="h-4 w-4" />
        {busy ? 'Sauvegarde…' : 'Sauvegarder'}
      </button>
    </form>
    </div>
  );
}
