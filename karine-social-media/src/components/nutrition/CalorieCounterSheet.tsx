'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Send, Loader2, Settings, Flame } from 'lucide-react';

type FoodLogEntry = {
  id: string;
  loggedAt: string;
  source: 'ciqual' | 'recipe' | 'menu' | 'free';
  sourceRefId: string | null;
  label: string;
  kcal: number;
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
  portions: number;
};

type DayState = {
  target: { dailyKcal: number; dailyWaterMl: number };
  entries: FoodLogEntry[];
  totals: { kcal: number; proteinsG: number; lipidsG: number; carbsG: number };
};

type ParsedItem = {
  label: string;
  searchQuery: string;
  portions: number;
  approxGrams: number;
  match: {
    ciqualId: number;
    alimCode: number;
    name: string;
    kcalPer100g: number | null;
  } | null;
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
};

type Props = {
  onClose: () => void;
  onChanged: () => void;
};

export function CalorieCounterSheet({ onClose, onChanged }: Props) {
  const [day, setDay] = useState<DayState | null>(null);
  const [naturalText, setNaturalText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<ParsedItem[] | null>(null);
  const [logging, setLogging] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [draftKcalTarget, setDraftKcalTarget] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Auto-clear erreurs après 4s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const alertError = (msg: string) => setError(msg);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/nutrition/today', { cache: 'no-store' });
    if (res.ok) setDay(await res.json());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDelete(id: string) {
    const res = await fetch(`/api/nutrition/log/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await refresh();
      onChanged();
      window.dispatchEvent(new CustomEvent('nutrition-log-updated'));
    }
  }

  async function handleParse() {
    const text = naturalText.trim();
    if (!text || parsing) return;
    setParsing(true);
    try {
      const res = await fetch('/api/nutrition/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        alertError(data?.error || 'Analyse impossible');
        return;
      }
      if (Array.isArray(data.items) && data.items.length > 0) {
        setPreview(data.items);
      } else {
        alertError('Aucun aliment détecté');
      }
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirmPreview() {
    if (!preview || logging) return;
    setLogging(true);
    try {
      const entries = preview
        .filter((p) => p.kcalPerPortion !== null)
        .map((p) => ({
          source: p.match ? ('ciqual' as const) : ('free' as const),
          sourceRefId: p.match ? String(p.match.alimCode) : null,
          label: p.label,
          kcal: p.kcalPerPortion ?? 0,
          proteinsG: p.proteinsPerPortion,
          lipidsG: p.lipidsPerPortion,
          carbsG: p.carbsPerPortion,
          portions: p.portions,
        }));
      if (entries.length === 0) {
        alertError('Aucun aliment avec kcal détecté');
        return;
      }
      const res = await fetch('/api/nutrition/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      if (res.ok) {
        setPreview(null);
        setNaturalText('');
        await refresh();
        onChanged();
        window.dispatchEvent(new CustomEvent('nutrition-log-updated'));
      } else {
        const j = await res.json();
        alertError(j?.error || 'Enregistrement impossible');
      }
    } finally {
      setLogging(false);
    }
  }

  async function handleSaveTarget() {
    const n = parseInt(draftKcalTarget, 10);
    if (!Number.isFinite(n) || n < 800 || n > 6000) {
      alertError('Objectif entre 800 et 6000 kcal');
      return;
    }
    const res = await fetch('/api/nutrition/target', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dailyKcal: n }),
    });
    if (res.ok) {
      setEditingTarget(false);
      await refresh();
      onChanged();
    } else {
      const j = await res.json();
      alertError(j?.error || 'Mise à jour impossible');
    }
  }

  if (typeof document === 'undefined') return null;

  const totals = day?.totals.kcal ?? 0;
  const target = day?.target.dailyKcal ?? 2000;
  const remaining = Math.max(0, target - totals);
  const overshoot = Math.max(0, totals - target);
  const percent = Math.min(100, target > 0 ? (totals / target) * 100 : 0);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 print:hidden">
      <div className="flex h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-coral-soft/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <Flame className="size-5 text-coral" />
            <h2 className="font-script text-2xl text-coral">Mes calories</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-full p-1.5 hover:bg-coral-soft/30"
          >
            <X className="size-5 text-ink-soft" />
          </button>
        </header>

        {error && (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {error}
          </div>
        )}

        {/* Objectif vs consommé */}
        <section className="border-b border-coral-soft/20 bg-cream/40 px-4 py-3">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-3xl font-bold text-coral">
                {Math.round(totals)}
                <span className="text-base font-normal text-ink-soft"> / {target} kcal</span>
              </p>
              <p className="text-xs text-ink-soft">
                {overshoot > 0
                  ? `${Math.round(overshoot)} kcal au-dessus`
                  : `Reste ${Math.round(remaining)} kcal`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingTarget((v) => !v);
                setDraftKcalTarget(String(target));
              }}
              aria-label="Régler l'objectif"
              className="rounded-full p-1.5 hover:bg-coral-soft/30"
            >
              <Settings className="size-4 text-ink-soft" />
            </button>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-coral-soft/30">
            <div
              className={`h-full transition-all ${
                overshoot > 0 ? 'bg-rose-500' : 'bg-coral'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>

          {editingTarget && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                min={800}
                max={6000}
                step={50}
                value={draftKcalTarget}
                onChange={(e) => setDraftKcalTarget(e.target.value)}
                className="w-24 rounded-lg border border-coral-soft px-2 py-1 text-sm"
              />
              <span className="text-xs text-ink-soft">kcal/jour</span>
              <button
                type="button"
                onClick={handleSaveTarget}
                className="ml-auto rounded-full bg-coral px-3 py-1 text-xs font-semibold text-white"
              >
                Enregistrer
              </button>
            </div>
          )}
        </section>

        {/* Saisie naturelle / Preview */}
        <section className="border-b border-coral-soft/20 px-4 py-3">
          {preview ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-soft">
                Détecté ({preview.length}) — vérifie puis confirme
              </p>
              <ul className="space-y-1.5">
                {preview.map((p, i) => (
                  <PreviewRow
                    key={i}
                    item={p}
                    onPortionsChange={(n) => {
                      const next = [...preview];
                      next[i] = { ...p, portions: n };
                      setPreview(next);
                    }}
                    onRemove={() => {
                      const next = preview.filter((_, k) => k !== i);
                      setPreview(next.length > 0 ? next : null);
                    }}
                  />
                ))}
              </ul>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-full border border-coral-soft px-3 py-1.5 text-xs font-semibold text-coral"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPreview}
                  disabled={logging}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {logging ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Ajouter au compteur
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-ink-soft">
                Qu&apos;as-tu mang&eacute; ?
              </label>
              <div className="flex gap-2">
                <textarea
                  value={naturalText}
                  onChange={(e) => setNaturalText(e.target.value)}
                  placeholder="ex. un yaourt nature et une pomme"
                  rows={2}
                  maxLength={500}
                  className="flex-1 resize-none rounded-lg border border-coral-soft px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={parsing || naturalText.trim().length < 3}
                  aria-label="Analyser"
                  className="self-end rounded-full bg-coral p-2 text-white disabled:opacity-50"
                >
                  {parsing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Liste du jour */}
        <section className="flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Aujourd&apos;hui ({day?.entries.length ?? 0})
          </p>
          {day && day.entries.length === 0 ? (
            <p className="text-sm text-ink-soft">Aucune entrée pour le moment.</p>
          ) : (
            <ul className="space-y-1.5">
              {day?.entries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 rounded-lg border border-coral-soft/30 bg-white px-2.5 py-1.5"
                >
                  <SourceBadge source={e.source} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {e.label}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {Math.round(e.kcal * e.portions)} kcal
                      {e.portions !== 1 && ` (${e.portions} portions)`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(e.id)}
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

function PreviewRow({
  item,
  onPortionsChange,
  onRemove,
}: {
  item: ParsedItem;
  onPortionsChange: (n: number) => void;
  onRemove: () => void;
}) {
  const total = item.kcalPerPortion !== null
    ? Math.round(item.kcalPerPortion * item.portions)
    : null;
  return (
    <li className="flex items-center gap-2 rounded-lg border border-coral-soft/30 bg-cream/40 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{item.label}</p>
        <p className="text-xs text-ink-soft">
          {item.match ? '✓ Ciqual' : '⚠ Pas trouvé'} —{' '}
          {total !== null ? `${total} kcal` : 'kcal inconnues'}
          {' · '}
          {item.approxGrams}g/portion
        </p>
      </div>
      <input
        type="number"
        min={0.25}
        max={20}
        step={0.25}
        value={item.portions}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n > 0) onPortionsChange(n);
        }}
        className="w-14 rounded border border-coral-soft px-1 py-0.5 text-center text-xs"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Retirer"
        className="rounded-full p-1 text-ink-soft hover:bg-rose-50 hover:text-rose-600"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

function SourceBadge({ source }: { source: FoodLogEntry['source'] }) {
  const map: Record<FoodLogEntry['source'], { label: string; cls: string }> = {
    ciqual: { label: 'Ciqual', cls: 'bg-emerald-100 text-emerald-700' },
    recipe: { label: 'Recette', cls: 'bg-coral-soft/40 text-coral' },
    menu: { label: 'Menu', cls: 'bg-amber-100 text-amber-700' },
    free: { label: 'Libre', cls: 'bg-slate-100 text-slate-600' },
  };
  const m = map[source];
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

