'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import type {
  CalorieEncouragements,
  EncouragementCategory,
} from '@/data/app-settings';

const CATS: Array<{
  key: EncouragementCategory;
  label: string;
  desc: string;
}> = [
  {
    key: 'debut-journee',
    label: 'Début de journée',
    desc: 'Affiché quand l\'utilisatrice a consommé moins de 30% de son objectif kcal.',
  },
  {
    key: 'bonne-route',
    label: 'En bonne route',
    desc: 'Affiché entre 30% et 99% de l\'objectif consommé.',
  },
  {
    key: 'objectif-atteint',
    label: 'Objectif atteint',
    desc: 'Affiché dès que l\'objectif kcal est atteint (>=100%).',
  },
];

export function EncouragementsAdminClient({
  initial,
}: {
  initial: CalorieEncouragements;
}) {
  const [enc, setEnc] = useState<CalorieEncouragements>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function addPhrase(cat: EncouragementCategory) {
    setEnc((prev) => ({ ...prev, [cat]: [...prev[cat], ''] }));
  }

  function updatePhrase(cat: EncouragementCategory, idx: number, value: string) {
    setEnc((prev) => ({
      ...prev,
      [cat]: prev[cat].map((p, i) => (i === idx ? value : p)),
    }));
  }

  function removePhrase(cat: EncouragementCategory, idx: number) {
    setEnc((prev) => ({
      ...prev,
      [cat]: prev[cat].filter((_, i) => i !== idx),
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Nettoyage cote client : retire les phrases vides
      const cleaned: CalorieEncouragements = {
        'debut-journee': enc['debut-journee'].map((s) => s.trim()).filter(Boolean),
        'bonne-route': enc['bonne-route'].map((s) => s.trim()).filter(Boolean),
        'objectif-atteint': enc['objectif-atteint']
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const res = await fetch('/api/admin/encouragements', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encouragements: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Erreur ${res.status}`);
        return;
      }
      setEnc(cleaned);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 p-4">
      <header>
        <h1 className="text-2xl font-bold text-ink">Encouragements calories</h1>
        <p className="text-sm text-ink-soft">
          Phrases affichées sous le slogan « Chaque petit choix compte ♡ » sur
          /mes-calories. Une phrase aléatoire est tirée par jour selon l'état
          d'avancement.
        </p>
      </header>

      {error && (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {CATS.map(({ key, label, desc }) => (
        <section
          key={key}
          className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30"
        >
          <header className="mb-3">
            <h2 className="text-base font-bold uppercase tracking-wider text-coral-dark">
              {label}
            </h2>
            <p className="text-xs italic text-ink-soft">{desc}</p>
          </header>
          <ul className="space-y-2">
            {enc[key].map((phrase, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <textarea
                  value={phrase}
                  onChange={(e) => updatePhrase(key, idx, e.target.value)}
                  rows={2}
                  maxLength={200}
                  placeholder="Ex. Petit à petit, vous y arrivez ♡"
                  className="flex-1 resize-none rounded-lg border border-coral-soft/40 bg-white px-3 py-2 text-sm focus:border-coral focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removePhrase(key, idx)}
                  aria-label="Supprimer cette phrase"
                  className="grid size-8 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => addPhrase(key)}
            className="mt-3 flex items-center gap-1.5 rounded-full bg-coral-soft/30 px-3 py-1.5 text-xs font-bold text-coral-dark hover:bg-coral-soft/50"
          >
            <Plus className="size-3" /> Ajouter une phrase
          </button>
        </section>
      ))}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-coral-soft/30 bg-white/95 px-4 py-3 backdrop-blur">
        <span className="text-xs text-ink-soft">
          {saved && <span className="text-emerald-700">✓ Enregistré</span>}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Enregistrer
        </button>
      </div>
    </div>
  );
}
