'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, GlassWater, Minus, Plus, Settings, Trash2 } from 'lucide-react';

type WaterState = {
  targetMl: number;
  glassSizeMl: number;
  consumedMl: number;
  glassesCount: number;
  entries: { id: string; loggedAt: string; ml: number }[];
};

type Props = {
  onClose: () => void;
  onChanged?: () => void;
};

/**
 * Sheet dédiée au compteur d'eau (ouvert depuis WaterFAB).
 * - Header objectif consommé + jauge
 * - Boutons +1 et annuler dernier
 * - Réglages inline (objectif + taille verre)
 * - Liste des verres du jour avec suppression individuelle
 */
export function WaterCounterSheet({ onClose, onChanged }: Props) {
  const [state, setState] = useState<WaterState | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTargetMl, setDraftTargetMl] = useState('');
  const [draftGlassMl, setDraftGlassMl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

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
        onChanged?.();
        window.dispatchEvent(new CustomEvent('water-log-updated'));
      } else {
        const j = await res.json();
        setError(j?.error || 'Ajout impossible');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/water/log/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await refresh();
        onChanged?.();
        window.dispatchEvent(new CustomEvent('water-log-updated'));
      } else {
        const j = await res.json();
        setError(j?.error || 'Suppression impossible');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveLast() {
    if (!state || state.entries.length === 0) return;
    await handleRemove(state.entries[0].id);
  }

  async function handleSaveSettings() {
    const targetMl = parseInt(draftTargetMl, 10);
    const glassMl = parseInt(draftGlassMl, 10);
    if (!Number.isFinite(targetMl) || targetMl < 500 || targetMl > 5000) {
      setError('Objectif entre 500 et 5000 ml');
      return;
    }
    if (!Number.isFinite(glassMl) || glassMl < 50 || glassMl > 1000) {
      setError('Taille verre entre 50 et 1000 ml');
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
        onChanged?.();
        window.dispatchEvent(new CustomEvent('water-log-updated'));
      } else {
        const j = await res.json();
        setError(j?.error || 'Enregistrement impossible');
      }
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === 'undefined') return null;

  if (!state) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 print:hidden">
        <div className="w-full max-w-md rounded-t-3xl bg-white p-6 text-center text-ink-soft shadow-2xl">
          Chargement…
        </div>
      </div>,
      document.body,
    );
  }

  const targetGlasses = Math.max(
    1,
    Math.round(state.targetMl / state.glassSizeMl),
  );
  const percent = Math.min(100, (state.glassesCount / targetGlasses) * 100);
  const reached = state.glassesCount >= targetGlasses;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 print:hidden">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-sky-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <GlassWater className="size-5 text-sky-500" />
            <h2 className="font-script text-2xl text-sky-700">Mon eau</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-full p-1.5 hover:bg-sky-100"
          >
            <X className="size-5 text-ink-soft" />
          </button>
        </header>

        {error && (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {error}
          </div>
        )}

        <section className="border-b border-sky-100 bg-sky-50/50 px-4 py-3">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-3xl font-bold text-sky-600">
                {state.glassesCount}
                <span className="text-base font-normal text-ink-soft">
                  {' '}
                  / {targetGlasses} verres
                </span>
              </p>
              <p className="text-xs text-ink-soft">
                {state.consumedMl} / {state.targetMl} ml
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing((v) => !v);
                setDraftTargetMl(String(state.targetMl));
                setDraftGlassMl(String(state.glassSizeMl));
              }}
              aria-label="Régler"
              className="rounded-full p-1.5 hover:bg-sky-100"
            >
              <Settings className="size-4 text-ink-soft" />
            </button>
          </div>

          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-100">
            <div
              className={`h-full transition-all ${reached ? 'bg-emerald-500' : 'bg-sky-400'}`}
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleRemoveLast}
              disabled={busy || state.entries.length === 0}
              className="inline-flex items-center gap-1 rounded-full border border-sky-300 px-3 py-1.5 text-sm font-semibold text-sky-700 disabled:opacity-30"
            >
              <Minus className="size-4" />
              Annuler
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-4 py-1.5 text-sm font-semibold text-white shadow disabled:opacity-50"
            >
              <Plus className="size-4" />
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
                    className="w-24 rounded border border-sky-300 px-2 py-1 text-sm"
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
                    className="w-24 rounded border border-sky-300 px-2 py-1 text-sm"
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

        <section className="flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Aujourd&apos;hui ({state.entries.length})
          </p>
          {state.entries.length === 0 ? (
            <p className="text-sm text-ink-soft">Aucun verre pour le moment.</p>
          ) : (
            <ul className="space-y-1.5">
              {state.entries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 rounded-lg border border-sky-200 bg-white px-2.5 py-1.5"
                >
                  <GlassWater className="size-4 text-sky-500" />
                  <span className="flex-1 text-sm text-ink">{e.ml} ml</span>
                  <span className="text-xs text-ink-soft">
                    {new Date(e.loggedAt).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(e.id)}
                    aria-label="Supprimer"
                    className="rounded-full p-1.5 text-ink-soft hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}
