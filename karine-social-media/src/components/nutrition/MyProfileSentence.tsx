'use client';

import { useEffect, useState } from 'react';
import { DrumPicker } from '@/components/ui/DrumPicker';

type Profile = {
  sex: 'male' | 'female' | null;
  ageYears: number | null;
  weightKg: number | null;
  heightCm: number | null;
  weightLossKg: number | null;
  targetHorizonMonths: 3 | 6 | 12;
  dailyWaterMl: number | null;
};

type Resp = {
  profile: Profile & { activityLevel: string | null; goal: string | null };
  fullName: string | null;
};

/** Field actuellement éditée via le drum picker. */
type EditingField =
  | null
  | 'sex'
  | 'age'
  | 'weight'
  | 'height'
  | 'lossKg'
  | 'horizon'
  | 'water';

/** Options drum picker pour l'objectif eau (en ml).
 *  De 1000 ml à 4000 ml par pas de 250 ml. */
const WATER_OPTIONS = Array.from(
  { length: (4000 - 1000) / 250 + 1 },
  (_, i) => 1000 + i * 250,
);

/** Options drum pickers — bornes raisonnables pour des adultes. */
const AGE_OPTIONS = Array.from({ length: 88 }, (_, i) => i + 13); // 13..100
const WEIGHT_OPTIONS = (() => {
  // 35.0 → 200.0 par pas de 0.5 kg
  const arr: number[] = [];
  for (let v = 35; v <= 200; v += 0.5) arr.push(Math.round(v * 10) / 10);
  return arr;
})();
const HEIGHT_OPTIONS = Array.from({ length: 121 }, (_, i) => i + 120); // 120..240 cm

/**
 * Phrase personnalisée à la 1ère personne avec les éléments du
 * profil cliquables. Chaque clic ouvre un drum picker → l'auto-save
 * PATCH /api/nutrition/profile dès que la valeur change → on
 * recharge la phrase avec la nouvelle valeur.
 *
 * Si un élément manque (ex: poids non saisi), on affiche un placeholder
 * cliquable "[+ poids]" en italique amber.
 */
export function MyProfileSentence() {
  const [data, setData] = useState<Resp | null>(null);
  const [editing, setEditing] = useState<EditingField>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    try {
      const res = await fetch('/api/nutrition/profile', { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } catch {
      /* silencieux */
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  /**
   * PATCH partiel : on renvoie le profil COMPLET au serveur (car la
   * route /api/nutrition/profile fait un upsert qui recalcule les
   * targets via Mifflin-St Jeor). On override juste le champ modifié.
   */
  async function patch(field: EditingField, value: number | string | null) {
    if (!data || !field) return;
    // L'objectif eau passe par /api/water/settings (table dédiée),
    // pas par /api/nutrition/profile.
    if (field === 'water') {
      setSaving(true);
      try {
        const res = await fetch('/api/water/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dailyWaterMl: value }),
        });
        if (res.ok) {
          await reload();
          // Notifie les autres composants (WaterGoalSection) que la
          // cible eau a changé.
          window.dispatchEvent(new CustomEvent('water-log-updated'));
        }
      } finally {
        setSaving(false);
        setEditing(null);
      }
      return;
    }
    const p = data.profile;
    const payload = {
      sex: field === 'sex' ? value : p.sex,
      ageYears: field === 'age' ? value : p.ageYears,
      weightKg: field === 'weight' ? value : p.weightKg,
      heightCm: field === 'height' ? value : p.heightCm,
      activityLevel: p.activityLevel,
      weightLossKg: field === 'lossKg' ? value : p.weightLossKg,
      targetHorizonMonths: field === 'horizon' ? value : p.targetHorizonMonths,
      goal: p.goal ?? 'maintain',
    };
    setSaving(true);
    try {
      const res = await fetch('/api/nutrition/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) await reload();
    } finally {
      setSaving(false);
      setEditing(null);
    }
  }

  if (!data) {
    return (
      <p className="text-xs italic text-ink-soft">Chargement du profil…</p>
    );
  }

  const p = data.profile;
  // Premier mot du full_name → prénom. Reste → nom.
  let firstName: string | null = null;
  let lastName: string | null = null;
  if (data.fullName) {
    const parts = data.fullName.split(/\s+/);
    firstName = parts[0] ?? null;
    lastName = parts.slice(1).join(' ') || null;
  }

  // Helpers rendu d'un élément cliquable.
  const Chip = ({
    value,
    onClick,
    placeholder = '?',
  }: {
    value: string | number | null;
    onClick: () => void;
    placeholder?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`inline-block rounded-md border-b-2 border-dashed px-1 font-semibold transition ${
        value === null
          ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'
          : 'border-coral/40 text-coral-dark hover:bg-coral-soft/30'
      }`}
    >
      {value === null ? `[+ ${placeholder}]` : value}
    </button>
  );

  // Texte de l'identité (prénom / nom).
  const fullNameStr = firstName
    ? lastName
      ? `${firstName} ${lastName}`
      : firstName
    : null;

  // "une femme" / "un homme" / "[+ sexe]"
  const sexLabel =
    p.sex === 'female' ? 'une femme' : p.sex === 'male' ? 'un homme' : null;

  return (
    <>
      <p className="text-sm leading-relaxed text-ink">
        Je suis{' '}
        {fullNameStr ? (
          <span className="font-semibold text-ink">{fullNameStr}</span>
        ) : (
          <span className="italic text-ink-soft">(nom non renseigné)</span>
        )}
        ,{' '}
        <Chip
          value={sexLabel}
          onClick={() => setEditing('sex')}
          placeholder="sexe"
        />{' '}
        de{' '}
        <Chip
          value={p.ageYears !== null ? `${p.ageYears} ans` : null}
          onClick={() => setEditing('age')}
          placeholder="âge"
        />
        , je pèse{' '}
        <Chip
          value={
            p.weightKg !== null
              ? `${p.weightKg.toString().replace('.', ',')} kg`
              : null
          }
          onClick={() => setEditing('weight')}
          placeholder="poids"
        />
        , je mesure{' '}
        <Chip
          value={p.heightCm !== null ? `${p.heightCm} cm` : null}
          onClick={() => setEditing('height')}
          placeholder="taille"
        />
        {/* Défi poids — affiché UNIQUEMENT si l'utilisatrice s'est
            fixé un objectif de perte > 0. Sinon : phrase muette
            (l'utilisatrice tape sur n'importe quel chip pour en
            ajouter un). */}
        {p.weightLossKg !== null && p.weightLossKg > 0 && (
          <>
            , et je souhaite perdre{' '}
            <Chip
              value={`${p.weightLossKg} kg`}
              onClick={() => setEditing('lossKg')}
            />{' '}
            sur{' '}
            <Chip
              value={`${p.targetHorizonMonths} mois`}
              onClick={() => setEditing('horizon')}
            />
          </>
        )}
        . 🤞🍀
        {/* Défi eau — affiché UNIQUEMENT si dailyWaterMl renseigné. */}
        {p.dailyWaterMl !== null && p.dailyWaterMl > 0 && (
          <>
            {' '}Ah oui, et je me suis promis de boire{' '}
            <Chip
              value={`${(p.dailyWaterMl / 1000)
                .toFixed(1)
                .replace('.', ',')} L`}
              onClick={() => setEditing('water')}
            />{' '}
            d&apos;eau par jour.
          </>
        )}
      </p>
      {saving && (
        <p className="mt-2 text-[0.65rem] italic text-ink-soft">
          Enregistrement…
        </p>
      )}

      {/* Drum pickers — un seul ouvert à la fois selon editing. */}
      {editing === 'sex' && (
        <DrumPicker<'female' | 'male'>
          title="Tu es…"
          options={['female', 'male']}
          current={p.sex ?? 'female'}
          formatLabel={(v) => (v === 'female' ? 'une femme' : 'un homme')}
          accent="coral"
          onClose={() => setEditing(null)}
          onPick={(v) => void patch('sex', v)}
        />
      )}
      {editing === 'age' && (
        <DrumPicker<number>
          title="Quel âge as-tu ?"
          options={AGE_OPTIONS}
          current={p.ageYears ?? 35}
          formatLabel={(v) => `${v} ans`}
          accent="coral"
          onClose={() => setEditing(null)}
          onPick={(v) => void patch('age', v)}
        />
      )}
      {editing === 'weight' && (
        <DrumPicker<number>
          title="Combien pèses-tu ?"
          options={WEIGHT_OPTIONS}
          current={p.weightKg ?? 65}
          formatLabel={(v) => `${v.toFixed(1).replace('.', ',')} kg`}
          accent="coral"
          onClose={() => setEditing(null)}
          onPick={(v) => void patch('weight', v)}
        />
      )}
      {editing === 'height' && (
        <DrumPicker<number>
          title="Combien mesures-tu ?"
          options={HEIGHT_OPTIONS}
          current={p.heightCm ?? 165}
          formatLabel={(v) => `${v} cm`}
          accent="coral"
          onClose={() => setEditing(null)}
          onPick={(v) => void patch('height', v)}
        />
      )}
      {editing === 'lossKg' && (
        <DrumPicker<number>
          title="Combien souhaites-tu perdre ?"
          options={[
            0,
            ...Array.from(
              { length: { 3: 9, 6: 15, 12: 30 }[p.targetHorizonMonths] },
              (_, i) => i + 1,
            ),
          ]}
          current={p.weightLossKg ?? 0}
          formatLabel={(v) =>
            v === 0 ? 'Maintenir mon poids' : `Perdre ${v} kg`
          }
          accent="coral"
          onClose={() => setEditing(null)}
          onPick={(v) => void patch('lossKg', v === 0 ? null : v)}
        />
      )}
      {editing === 'horizon' && (
        <DrumPicker<3 | 6 | 12>
          title="Sur combien de temps ?"
          options={[3, 6, 12]}
          current={p.targetHorizonMonths}
          formatLabel={(v) => `${v} mois`}
          accent="coral"
          onClose={() => setEditing(null)}
          onPick={(v) => void patch('horizon', v)}
        />
      )}
      {editing === 'water' && (
        <DrumPicker<number>
          title="Combien d'eau par jour ?"
          options={WATER_OPTIONS}
          current={p.dailyWaterMl ?? 1500}
          formatLabel={(v) => `${(v / 1000).toFixed(2).replace('.', ',')} L`}
          accent="blue"
          onClose={() => setEditing(null)}
          onPick={(v) => void patch('water', v)}
        />
      )}
    </>
  );
}
