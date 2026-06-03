'use client';

import { useState, useEffect } from 'react';
import { Loader2, Calculator } from 'lucide-react';
import {
  ACTIVITY_LABELS,
  GOAL_LABELS,
  type Sex,
  type ActivityLevel,
  type Goal,
} from '@/lib/nutrition-calc';

type Profile = {
  sex: Sex | null;
  ageYears: number | null;
  weightKg: number | null;
  heightCm: number | null;
  activityLevel: ActivityLevel | null;
  goal: Goal | null;
};

type Targets = {
  dailyKcal: number | null;
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
};

type Props = {
  onSaved: (targets: Targets) => void;
  onError: (msg: string) => void;
};

/**
 * Form "Renseigne tes besoins" — sexe, age, poids, taille, niveau
 * d'activité, objectif. Calcule daily_kcal via Mifflin-St Jeor.
 *
 * Pré-remplit le sexe depuis user_metadata.gender si OAuth le
 * fournit (Facebook surtout — Google a retiré ce scope en 2019).
 */
export function NutritionProfileForm({ onSaved, onError }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile>({
    sex: null,
    ageYears: null,
    weightKg: null,
    heightCm: null,
    activityLevel: null,
    goal: null,
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/nutrition/profile', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const p = data.profile as Profile;
          // Si pas de sexe enregistré mais OAuth en suggère un, on
          // pré-remplit (l'abonnée peut toujours changer).
          if (!p.sex && data.suggestedSex) {
            p.sex = data.suggestedSex as Sex;
          }
          setProfile(p);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    // Validation simple
    if (!profile.sex) return onError('Sexe requis');
    if (!profile.ageYears || profile.ageYears <= 0)
      return onError('Âge requis (1 à 120)');
    if (!profile.weightKg || profile.weightKg <= 0)
      return onError('Poids requis (1 à 500 kg)');
    if (!profile.heightCm || profile.heightCm <= 0)
      return onError('Taille requise (1 à 300 cm)');
    if (!profile.activityLevel) return onError("Niveau d'activité requis");
    if (!profile.goal) return onError('Objectif requis');

    setSaving(true);
    try {
      const res = await fetch('/api/nutrition/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data?.error || 'Enregistrement impossible');
        return;
      }
      onSaved({
        dailyKcal: data.targets.dailyKcal,
        proteinsG: data.targets.proteinsG,
        lipidsG: data.targets.lipidsG,
        carbsG: data.targets.carbsG,
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg bg-white p-3 text-xs italic text-ink-soft">
        Chargement…
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2.5 rounded-lg bg-white p-3 text-sm"
    >
      {/* Sexe */}
      <div>
        <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">
          Sexe
        </p>
        <div className="flex gap-2">
          {(['female', 'male'] as const).map((s) => (
            <label
              key={s}
              className={`flex-1 cursor-pointer rounded-lg border px-3 py-1.5 text-center text-xs font-semibold transition-colors ${
                profile.sex === s
                  ? 'border-coral bg-coral text-white'
                  : 'border-coral-soft bg-white text-ink-soft hover:bg-coral-soft/20'
              }`}
            >
              <input
                type="radio"
                name="sex"
                value={s}
                checked={profile.sex === s}
                onChange={() => set('sex', s)}
                className="sr-only"
              />
              {s === 'female' ? 'Femme' : 'Homme'}
            </label>
          ))}
        </div>
      </div>

      {/* Age + Poids + Taille en 3 colonnes */}
      <div className="grid grid-cols-3 gap-2">
        <NumberField
          label="Âge"
          suffix="ans"
          value={profile.ageYears}
          onChange={(n) => set('ageYears', n)}
          min={1}
          max={120}
        />
        <NumberField
          label="Poids"
          suffix="kg"
          value={profile.weightKg}
          onChange={(n) => set('weightKg', n)}
          min={1}
          max={500}
          step={0.5}
        />
        <NumberField
          label="Taille"
          suffix="cm"
          value={profile.heightCm}
          onChange={(n) => set('heightCm', n)}
          min={1}
          max={300}
        />
      </div>

      {/* Niveau d'activité */}
      <div>
        <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">
          Niveau d&rsquo;activité
        </p>
        <select
          value={profile.activityLevel ?? ''}
          onChange={(e) => set('activityLevel', e.target.value as ActivityLevel)}
          className="w-full rounded-lg border border-coral-soft px-2 py-1.5 text-sm"
        >
          <option value="">— Choisis —</option>
          {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
            <option key={k} value={k}>
              {ACTIVITY_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {/* Objectif */}
      <div>
        <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">
          Objectif
        </p>
        <select
          value={profile.goal ?? ''}
          onChange={(e) => set('goal', e.target.value as Goal)}
          className="w-full rounded-lg border border-coral-soft px-2 py-1.5 text-sm"
        >
          <option value="">— Choisis —</option>
          {(Object.keys(GOAL_LABELS) as Goal[]).map((k) => (
            <option key={k} value={k}>
              {GOAL_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Calculator className="size-4" />
        )}
        Calculer mes besoins
      </button>
    </form>
  );
}

function NumberField({
  label,
  suffix,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  suffix: string;
  value: number | null;
  onChange: (n: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">
        {label}
      </p>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          step={step ?? 1}
          value={value ?? ''}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            onChange(Number.isFinite(n) ? n : null);
          }}
          className="w-full rounded border border-coral-soft px-1.5 py-1 text-center text-sm"
        />
        <span className="text-[0.65rem] text-ink-soft">{suffix}</span>
      </div>
    </div>
  );
}
