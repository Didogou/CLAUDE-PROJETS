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

type CiqualCandidate = {
  ciqualId: number;
  alimCode: number;
  name: string;
  kcalPer100g: number | null;
  proteinsG?: number | null;
  lipidsG?: number | null;
  carbsG?: number | null;
};

type ParsedItem = {
  label: string;
  searchQuery: string;
  portions: number;
  approxGrams: number;
  match: CiqualCandidate | null;
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
  fallbackCandidates?: CiqualCandidate[];
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Recalcule kcal/macros pour 1 portion à partir d'un candidat et de approxGrams. */
function recomputeFromCandidate(
  candidate: CiqualCandidate,
  approxGrams: number,
): {
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
} {
  const factor = approxGrams / 100;
  return {
    kcalPerPortion:
      candidate.kcalPer100g !== null ? round1(candidate.kcalPer100g * factor) : null,
    proteinsPerPortion:
      candidate.proteinsG != null ? round1(candidate.proteinsG * factor) : null,
    lipidsPerPortion:
      candidate.lipidsG != null ? round1(candidate.lipidsG * factor) : null,
    carbsPerPortion:
      candidate.carbsG != null ? round1(candidate.carbsG * factor) : null,
  };
}

type Props = {
  onClose: () => void;
  onChanged: () => void;
};

export function CalorieCounterSheet({ onClose, onChanged }: Props) {
  const [day, setDay] = useState<DayState | null>(null);
  const [naturalText, setNaturalText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<ParsedItem[] | null>(null);
  const [correctedText, setCorrectedText] = useState<string | null>(null);
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

  // Verrouille le scroll du body tant que la sheet est ouverte.
  // Sans ça, sur mobile, le drag touch dans la liste fait scroller
  // la page de fond (scroll bleeding).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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
      setCorrectedText(
        typeof data.correctedText === 'string' ? data.correctedText : null,
      );
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
        setCorrectedText(null);
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 print:hidden md:items-end md:justify-end md:p-4">
      <div className="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:h-auto md:max-h-[760px] md:rounded-3xl">
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
              {correctedText && (
                <p className="rounded bg-coral-soft/20 px-2 py-1 text-xs italic text-coral-dark">
                  Compris :{' '}
                  <span className="font-semibold">«&nbsp;{correctedText}&nbsp;»</span>
                </p>
              )}
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
                    onPickCandidate={(c) => {
                      const next = [...preview];
                      const recomputed = recomputeFromCandidate(c, p.approxGrams);
                      next[i] = {
                        ...p,
                        label: c.name,
                        match: c,
                        ...recomputed,
                        fallbackCandidates: undefined,
                      };
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
                  onClick={() => {
                    setPreview(null);
                    setCorrectedText(null);
                  }}
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
                  onKeyDown={(e) => {
                    // Enter = analyser, Shift+Enter = nouvelle ligne.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleParse();
                    }
                  }}
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
        <section
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(226, 120, 141, 0.5) transparent',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
          }}
        >
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
  onPickCandidate,
  onRemove,
}: {
  item: ParsedItem;
  onPortionsChange: (n: number) => void;
  onPickCandidate: (c: CiqualCandidate) => void;
  onRemove: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const total =
    item.kcalPerPortion !== null
      ? Math.round(item.kcalPerPortion * item.portions)
      : null;

  const isFallback = !item.match && (item.fallbackCandidates?.length ?? 0) > 0;
  const isNotFound = !item.match && (!item.fallbackCandidates || item.fallbackCandidates.length === 0);

  return (
    <li className="space-y-1.5 rounded-lg border border-coral-soft/30 bg-cream/40 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{item.label}</p>
          <p className="text-xs text-ink-soft">
            {item.match
              ? '✓ Ciqual'
              : isFallback
                ? '⚠ Aucun choix sûr — sélectionne ci-dessous'
                : '⚠ Pas trouvé'}
            {' — '}
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
      </div>

      {/* Liste de candidats si match incertain */}
      {isFallback && (
        <ul className="space-y-0.5 rounded-md bg-white p-1.5">
          <li className="px-1 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">
            Choix possibles :
          </li>
          {item.fallbackCandidates!.map((c) => (
            <li key={c.alimCode}>
              <button
                type="button"
                onClick={() => onPickCandidate(c)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-coral-soft/30"
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 font-semibold text-coral">
                  {c.kcalPer100g !== null ? `${Math.round(c.kcalPer100g)} kcal/100g` : '—'}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              className="w-full rounded px-1.5 py-1 text-left text-xs italic text-coral hover:bg-coral-soft/30"
            >
              {showPicker ? '↑ Fermer' : '🔍 Chercher autre chose…'}
            </button>
          </li>
        </ul>
      )}

      {/* Bouton "Chercher autre chose" même si rien trouvé */}
      {isNotFound && (
        <button
          type="button"
          onClick={() => setShowPicker((v) => !v)}
          className="w-full rounded-md bg-white px-2 py-1 text-left text-xs italic text-coral hover:bg-coral-soft/30"
        >
          {showPicker ? '↑ Fermer la recherche' : '🔍 Chercher dans la base Ciqual'}
        </button>
      )}

      {showPicker && (
        <FreeSearchPicker onPick={(c) => {
          onPickCandidate(c);
          setShowPicker(false);
        }} />
      )}
    </li>
  );
}

/**
 * Recherche libre dans Ciqual (autocomplete). Utilisé en fallback
 * quand l'IA ne propose pas le bon aliment.
 */
function FreeSearchPicker({
  onPick,
}: {
  onPick: (c: CiqualCandidate) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CiqualCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/nutrition/search?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        if (res.ok) {
          const data = await res.json();
          setItems(Array.isArray(data.items) ? data.items : []);
        }
      } catch {
        // abort = silencieux
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="space-y-1 rounded-md bg-white p-1.5">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Tapez un aliment…"
        autoFocus
        className="w-full rounded border border-coral-soft px-2 py-1 text-sm"
      />
      {searching && (
        <p className="px-1 py-0.5 text-xs italic text-ink-soft">Recherche…</p>
      )}
      {!searching && query.trim().length >= 2 && items.length === 0 && (
        <p className="px-1 py-0.5 text-xs italic text-ink-soft">Aucun résultat.</p>
      )}
      {items.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
          {items.map((c) => (
            <li key={c.alimCode}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-coral-soft/30"
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 font-semibold text-coral">
                  {c.kcalPer100g !== null ? `${Math.round(c.kcalPer100g)} kcal/100g` : '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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

