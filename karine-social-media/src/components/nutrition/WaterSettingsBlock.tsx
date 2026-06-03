'use client';

import { useState, useEffect, useCallback } from 'react';
import { GlassWater, Minus, Plus, Settings } from 'lucide-react';

type WaterState = {
  targetMl: number;
  glassSizeMl: number;
  consumedMl: number;
  glassesCount: number;
  entries: { id: string; loggedAt: string; ml: number }[];
};

/**
 * Bloc Eau intégré à la CalorieCounterSheet.
 * - Affiche jauge + verres consommés / objectif
 * - +1 / -1 verre
 * - Édition objectif quotidien + taille verre (inline collapsible)
 */
export function WaterSettingsBlock({
  onError,
}: {
  onError: (msg: string) => void;
}) {
  const [state, setState] = useState<WaterState | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTargetMl, setDraftTargetMl] = useState('');
  const [draftGlassMl, setDraftGlassMl] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/water/today', { cache: 'no-store' });
      if (res.ok) setState(await res.json());
    } catch {
      // silencieux
    }
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('water-log-updated', onChange);
    return () => window.removeEventListener('water-log-updated', onChange);
  }, [refresh]);

  async function handleAdd() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/water/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await refresh();
        window.dispatchEvent(new CustomEvent('water-log-updated'));
      } else {
        const j = await res.json();
        onError(j?.error || 'Ajout impossible');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveLast() {
    if (busy || !state || state.entries.length === 0) return;
    const last = state.entries[0]; // entries triées desc
    setBusy(true);
    try {
      const res = await fetch(`/api/water/log/${last.id}`, { method: 'DELETE' });
      if (res.ok) {
        await refresh();
        window.dispatchEvent(new CustomEvent('water-log-updated'));
      } else {
        const j = await res.json();
        onError(j?.error || 'Annulation impossible');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings() {
    const targetMl = parseInt(draftTargetMl, 10);
    const glassMl = parseInt(draftGlassMl, 10);
    if (!Number.isFinite(targetMl) || targetMl < 500 || targetMl > 5000) {
      onError('Objectif entre 500 et 5000 ml');
      return;
    }
    if (!Number.isFinite(glassMl) || glassMl < 50 || glassMl > 1000) {
      onError('Taille verre entre 50 et 1000 ml');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/water/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyWaterMl: targetMl, glassSizeMl: glassMl }),
      });
      if (res.ok) {
        setEditing(false);
        await refresh();
        window.dispatchEvent(new CustomEvent('water-log-updated'));
      } else {
        const j = await res.json();
        onError(j?.error || 'Enregistrement impossible');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="border-b border-coral-soft/20 bg-sky-50/50 px-4 py-3">
        <p className="text-xs text-ink-soft">Chargement…</p>
      </section>
    );
  }

  const targetGlasses = Math.max(
    1,
    Math.round(state.targetMl / state.glassSizeMl),
  );
  const percent = Math.min(100, (state.glassesCount / targetGlasses) * 100);
  const reached = state.glassesCount >= targetGlasses;

  return (
    <section className="border-b border-coral-soft/20 bg-sky-50/50 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GlassWater className="size-4 text-sky-500" />
          <span className="text-sm font-semibold text-sky-700">Eau</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing((v) => !v);
            setDraftTargetMl(String(state.targetMl));
            setDraftGlassMl(String(state.glassSizeMl));
          }}
          aria-label="Régler eau"
          className="rounded-full p-1 hover:bg-sky-100"
        >
          <Settings className="size-3.5 text-ink-soft" />
        </button>
      </div>

      <div className="flex items-baseline justify-between">
        <p className="text-xl font-bold text-sky-600">
          {state.glassesCount} <span className="text-sm font-normal text-ink-soft">/ {targetGlasses} verres</span>
        </p>
        <p className="text-xs text-ink-soft">
          {state.consumedMl} / {state.targetMl} ml
        </p>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sky-100">
        <div
          className={`h-full transition-all ${reached ? 'bg-emerald-500' : 'bg-sky-400'}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={handleRemoveLast}
          disabled={busy || state.entries.length === 0}
          className="inline-flex items-center gap-1 rounded-full border border-sky-300 px-3 py-1 text-xs font-semibold text-sky-700 disabled:opacity-30"
        >
          <Minus className="size-3.5" />
          Annuler
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          Un verre ({state.glassSizeMl} ml)
        </button>
      </div>

      {editing && (
        <div className="mt-3 space-y-2 rounded-lg bg-white p-2.5">
          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">
              Objectif quotidien
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={500}
                max={5000}
                step={100}
                value={draftTargetMl}
                onChange={(e) => setDraftTargetMl(e.target.value)}
                className="w-20 rounded border border-sky-300 px-1.5 py-0.5 text-sm"
              />
              <span className="text-xs text-ink-soft">ml/jour</span>
            </div>
          </div>
          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">
              Taille du verre
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={50}
                max={1000}
                step={25}
                value={draftGlassMl}
                onChange={(e) => setDraftGlassMl(e.target.value)}
                className="w-20 rounded border border-sky-300 px-1.5 py-0.5 text-sm"
              />
              <span className="text-xs text-ink-soft">ml/verre</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={busy}
            className="rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            Enregistrer
          </button>
        </div>
      )}
    </section>
  );
}
