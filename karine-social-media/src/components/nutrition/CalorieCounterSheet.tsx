'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Send, Loader2, Flame, ChevronDown, ChevronUp, Check, Camera } from 'lucide-react';
import { MyInfoModal } from './MyInfoModal';

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
  target: {
    dailyKcal: number;
    dailyWaterMl: number;
    dailyProteinsG: number | null;
    dailyLipidsG: number | null;
    dailyCarbsG: number | null;
  };
  entries: FoodLogEntry[];
  totals: { kcal: number; proteinsG: number; lipidsG: number; carbsG: number };
  profileComplete: boolean;
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

type SizeBucket = 'small' | 'medium' | 'large';

const SIZE_MULTIPLIERS: Record<SizeBucket, number> = {
  small: 0.7,
  medium: 1.0,
  large: 1.4,
};

const SIZE_LABELS: Record<SizeBucket, string> = {
  small: 'Petit',
  medium: 'Moyen',
  large: 'Grand',
};

type AccompanimentSuggestion = {
  name: string;
  typicalG: number;
  kcalEstimate: number;
};

type ParsedItem = {
  label: string;
  searchQuery: string;
  portions: number;
  approxGrams: number;
  baseGramsBeforeSizeHint?: number;
  match: CiqualCandidate | null;
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
  topCandidates?: CiqualCandidate[];
  foodKeyword?: string;
  sizeVariability?: 'low' | 'medium' | 'high';
  sizeHint?: SizeBucket | null;
  possibleAccompaniments?: AccompanimentSuggestion[];
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

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
  /**
   * Sélection d'accompagnements par bloc-item.
   * Map<itemIndex, Set<accompanimentIndex>>.
   * Les cases sont cumulatives : l'abonnée peut cocher 0, 1, 2 ou 3
   * accompagnements par aliment.
   */
  const [accSel, setAccSel] = useState<Map<number, Set<number>>>(new Map());
  const [photoUploading, setPhotoUploading] = useState(false);
  const [logging, setLogging] = useState(false);
  const [myInfoOpen, setMyInfoOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const [metrics, setMetrics] = useState<{
    kcalBurned: number;
    summaryText: string | null;
  } | null>(null);
  const [showCalories, setShowCalories] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/app-settings', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          setShowCalories(j?.showCaloriesInCounter !== false);
        }
      } catch {
        // default = true
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/nutrition/metrics', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          setMetrics({
            kcalBurned: Number(j.metrics?.kcalBurned ?? 0),
            summaryText: j.metrics?.summaryText ?? null,
          });
        }
      } catch {
        // silencieux
      }
    })();
  }, []);

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

  async function handlePhoto(file: File) {
    if (!file || photoUploading) return;
    setPhotoUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const res = await fetch('/api/nutrition/describe-meal', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Analyse photo impossible');
        return;
      }
      if (typeof data.description === 'string' && data.description.trim()) {
        setNaturalText(data.description.trim());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur photo');
    } finally {
      setPhotoUploading(false);
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
      const corrected =
        typeof data.correctedText === 'string' ? data.correctedText : null;
      // Reflet silencieux dans la saisie pour qu'elle puisse re-modifier.
      if (corrected) setNaturalText(corrected);
      if (Array.isArray(data.items) && data.items.length > 0) {
        setPreview(data.items);
        setAccSel(new Map());
      } else {
        alertError('Aucun aliment détecté');
      }
    } finally {
      setParsing(false);
    }
  }

  function toggleAcc(itemIdx: number, accIdx: number) {
    setAccSel((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(itemIdx) ?? []);
      if (set.has(accIdx)) set.delete(accIdx);
      else set.add(accIdx);
      next.set(itemIdx, set);
      return next;
    });
  }

  async function handleConfirmPreview() {
    if (!preview || logging) return;
    setLogging(true);
    try {
      const entries: Array<{
        source: 'ciqual' | 'free';
        sourceRefId: string | null;
        label: string;
        kcal: number;
        proteinsG: number | null;
        lipidsG: number | null;
        carbsG: number | null;
        portions: number;
      }> = [];

      preview.forEach((p, idx) => {
        if (p.kcalPerPortion !== null) {
          entries.push({
            source: p.match ? 'ciqual' : 'free',
            sourceRefId: p.match ? String(p.match.alimCode) : null,
            label: p.label,
            kcal: p.kcalPerPortion,
            proteinsG: p.proteinsPerPortion,
            lipidsG: p.lipidsPerPortion,
            carbsG: p.carbsPerPortion,
            portions: p.portions,
          });
        }
        // Ajout des accompagnements cochés pour ce bloc — source 'free'
        // (estimation Mistral, pas Ciqual). Macros nulles : seul kcal
        // est connu à l'estime.
        const selected = accSel.get(idx);
        if (selected && selected.size > 0 && p.possibleAccompaniments) {
          for (const accIdx of selected) {
            const acc = p.possibleAccompaniments[accIdx];
            if (!acc) continue;
            entries.push({
              source: 'free',
              sourceRefId: null,
              label: acc.name,
              kcal: acc.kcalEstimate,
              proteinsG: null,
              lipidsG: null,
              carbsG: null,
              portions: 1,
            });
          }
        }
      });

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
        setAccSel(new Map());
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

  if (typeof document === 'undefined') return null;

  const totals = day?.totals.kcal ?? 0;
  const target = day?.target.dailyKcal ?? 2000;
  const burned = metrics?.kcalBurned ?? 0;
  const net = totals - burned;
  const remaining = Math.max(0, target - net);
  const overshoot = Math.max(0, net - target);
  const percent = Math.min(100, target > 0 ? Math.max(0, net) / target * 100 : 0);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 print:hidden md:items-center md:justify-center md:p-4">
      <div className="flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl md:h-[min(90vh,720px)] md:rounded-3xl">
        {/* Header */}
        <header className="flex items-center justify-between gap-2 border-b border-coral-soft/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <Flame className="size-5 text-coral" />
            <h2 className="font-script text-2xl text-coral">Mes calories</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMyInfoOpen(true)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                day?.profileComplete
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-coral-soft/30 text-coral-dark hover:bg-coral-soft/50'
              }`}
            >
              {day?.profileComplete && (
                <Check className="size-3" strokeWidth={3} />
              )}
              Mes infos
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="rounded-full p-1.5 hover:bg-coral-soft/30"
            >
              <X className="size-5 text-ink-soft" />
            </button>
          </div>
        </header>

        {error && (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {error}
          </div>
        )}

        {metrics?.summaryText && (
          <div className="border-b border-coral-soft/30 bg-gradient-to-r from-coral-soft/30 to-amber-50/60 px-4 py-2.5">
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
              Ton bilan ce soir
            </p>
            <p className="mt-0.5 text-sm leading-snug text-ink">
              {metrics.summaryText}
            </p>
          </div>
        )}

        {/* Objectif vs consommé */}
        <section className="border-b border-coral-soft/20 bg-cream/40 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
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

            <KcalBurnedEditor
              value={metrics?.kcalBurned ?? 0}
              onSaved={(n) => {
                setMetrics((m) =>
                  m ? { ...m, kcalBurned: n } : { kcalBurned: n, summaryText: null },
                );
              }}
            />
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-coral-soft/30">
            <div
              className={`h-full transition-all ${
                overshoot > 0 ? 'bg-rose-500' : 'bg-coral'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </section>

        {/* Saisie naturelle (toujours visible) */}
        <section className="border-b border-coral-soft/20 px-4 py-3">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-ink-soft">
              Qu&apos;as-tu mang&eacute; ?
            </label>
            <div className="flex gap-2">
              {naturalText.length > 80 ? (
                <textarea
                  value={naturalText}
                  onChange={(e) => setNaturalText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleParse();
                    }
                  }}
                  rows={2}
                  maxLength={500}
                  className="flex-1 resize-none rounded-lg border border-coral-soft px-2 py-1.5 text-sm"
                  placeholder="ex. un yaourt nature et une pomme"
                />
              ) : (
                <input
                  type="text"
                  value={naturalText}
                  onChange={(e) => setNaturalText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleParse();
                    }
                  }}
                  maxLength={500}
                  className="flex-1 rounded-lg border border-coral-soft px-2 py-1.5 text-sm"
                  placeholder="ex. un yaourt nature et une pomme"
                />
              )}
              <label
                className={`flex size-9 cursor-pointer items-center justify-center self-end rounded-full bg-white text-coral ring-2 ring-coral-soft hover:bg-coral-soft/30 ${
                  photoUploading ? 'cursor-wait opacity-50' : ''
                }`}
                title="Prendre une photo du plat"
              >
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={photoUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePhoto(f);
                    e.target.value = '';
                  }}
                  className="sr-only"
                />
                {photoUploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Camera className="size-4" />
                )}
              </label>
              <button
                type="button"
                onClick={handleParse}
                disabled={parsing || naturalText.trim().length < 3}
                aria-label="Analyser"
                className="flex size-9 items-center justify-center self-end rounded-full bg-coral text-white disabled:opacity-50"
              >
                {parsing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Propositions du parse (1 bloc par aliment) */}
        {preview && preview.length > 0 && (
          <section className="border-b border-coral-soft/20 px-4 py-3">
            <ul
              className="max-h-[50vh] space-y-2.5 overflow-y-auto pr-1"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(226, 120, 141, 0.5) transparent',
                overscrollBehavior: 'contain',
              }}
            >
              {preview.map((p, i) => (
                <ItemBlock
                  key={i}
                  item={p}
                  showCalories={showCalories}
                  selectedAccs={accSel.get(i) ?? new Set()}
                  onToggleAcc={(accIdx) => toggleAcc(i, accIdx)}
                  onPortionsChange={(n) => {
                    const next = [...preview];
                    next[i] = { ...p, portions: n };
                    setPreview(next);
                  }}
                  onGramsChange={(g) => {
                    const next = [...preview];
                    const factor = g / 100;
                    next[i] = {
                      ...p,
                      approxGrams: g,
                      kcalPerPortion:
                        p.match?.kcalPer100g != null
                          ? round1(p.match.kcalPer100g * factor)
                          : p.kcalPerPortion,
                      proteinsPerPortion:
                        p.match?.proteinsG != null
                          ? round1(p.match.proteinsG * factor)
                          : p.proteinsPerPortion,
                      lipidsPerPortion:
                        p.match?.lipidsG != null
                          ? round1(p.match.lipidsG * factor)
                          : p.lipidsPerPortion,
                      carbsPerPortion:
                        p.match?.carbsG != null
                          ? round1(p.match.carbsG * factor)
                          : p.carbsPerPortion,
                    };
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
                      topCandidates: p.topCandidates?.some(
                        (x) => x.alimCode === c.alimCode,
                      )
                        ? p.topCandidates
                        : [c, ...(p.topCandidates ?? [])].slice(0, 7),
                    };
                    setPreview(next);
                  }}
                  onRemove={() => {
                    const next = preview.filter((_, k) => k !== i);
                    // Réindexe les sélections d'accompagnements pour
                    // qu'elles restent alignées sur les blocs restants.
                    setAccSel((prev) => {
                      const out = new Map<number, Set<number>>();
                      for (const [k, v] of prev) {
                        if (k < i) out.set(k, v);
                        else if (k > i) out.set(k - 1, v);
                      }
                      return out;
                    });
                    if (next.length === 0) {
                      setPreview(null);
                    } else {
                      setPreview(next);
                    }
                  }}
                  onSizeChange={(bucket) => {
                    const base = p.baseGramsBeforeSizeHint ?? p.approxGrams;
                    const newGrams = Math.round(base * SIZE_MULTIPLIERS[bucket]);
                    const factor = newGrams / 100;
                    const next = [...preview];
                    next[i] = {
                      ...p,
                      approxGrams: newGrams,
                      sizeHint: bucket,
                      kcalPerPortion:
                        p.match?.kcalPer100g != null
                          ? round1(p.match.kcalPer100g * factor)
                          : p.kcalPerPortion,
                      proteinsPerPortion:
                        p.match?.proteinsG != null
                          ? round1(p.match.proteinsG * factor)
                          : p.proteinsPerPortion,
                      lipidsPerPortion:
                        p.match?.lipidsG != null
                          ? round1(p.match.lipidsG * factor)
                          : p.lipidsPerPortion,
                      carbsPerPortion:
                        p.match?.carbsG != null
                          ? round1(p.match.carbsG * factor)
                          : p.carbsPerPortion,
                    };
                    setPreview(next);
                  }}
                />
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2 border-t border-coral-soft/20 pt-3">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setAccSel(new Map());
                }}
                className="rounded-full border border-coral-soft px-3 py-1.5 text-xs font-semibold text-coral"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmPreview}
                disabled={logging}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
              >
                {logging ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Ajouter
              </button>
            </div>
          </section>
        )}

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
          <button
            type="button"
            onClick={() => setTodayOpen((v) => !v)}
            className="mb-2 flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-ink-soft transition-colors hover:text-coral-dark"
          >
            <span>
              Mes repas ({day?.entries.length ?? 0})
            </span>
            {todayOpen ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
          {todayOpen && day && day.entries.length === 0 ? (
            <p className="text-sm text-ink-soft">Aucune entrée pour le moment.</p>
          ) : todayOpen ? (
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
          ) : null}
        </section>
      </div>

      <MyInfoModal
        open={myInfoOpen}
        onClose={() => setMyInfoOpen(false)}
        onSaved={() => refresh()}
        onError={alertError}
        profileComplete={day?.profileComplete ?? false}
      />
    </div>,
    document.body,
  );
}

/**
 * Bloc d'un aliment Mistral détecté.
 * Layout :
 *   [Titre aliment] [select Taille] [X retirer]      ← MEME LIGNE
 *   Liste radio candidats : ⦿ nom (Suite si long)  [g]  [Qté]
 *   🔍 Chercher autre chose
 *   Accompagnements (cases à cocher, max 3 triés par kcal desc)
 */
function ItemBlock({
  item,
  showCalories,
  selectedAccs,
  onToggleAcc,
  onPortionsChange,
  onGramsChange,
  onPickCandidate,
  onRemove,
  onSizeChange,
}: {
  item: ParsedItem;
  showCalories: boolean;
  selectedAccs: Set<number>;
  onToggleAcc: (accIdx: number) => void;
  onPortionsChange: (n: number) => void;
  onGramsChange: (g: number) => void;
  onPickCandidate: (c: CiqualCandidate) => void;
  onRemove: () => void;
  onSizeChange: (bucket: SizeBucket) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  // Replié par défaut : seule la ligne sélectionnée est affichée. Un
  // bouton "Voir les X autres propositions" permet de déployer.
  const [expanded, setExpanded] = useState(false);
  const candidates = item.topCandidates ?? [];
  const hasCandidates = candidates.length > 0;
  const selectedIdx = candidates.findIndex(
    (c) => item.match?.alimCode === c.alimCode,
  );
  const selectedCandidate =
    selectedIdx >= 0 ? candidates[selectedIdx] : candidates[0] ?? null;
  const visibleCandidates =
    expanded || !selectedCandidate ? candidates : [selectedCandidate];
  const otherCount = candidates.length - visibleCandidates.length;

  // Affichage du select Taille : si l'aliment a une variabilité non
  // triviale OU qu'un sizeHint a déjà été détecté.
  const showSizeSelect =
    item.sizeVariability === 'high' ||
    item.sizeVariability === 'medium' ||
    item.sizeHint !== null;
  const currentBucket: SizeBucket = item.sizeHint ?? 'medium';

  return (
    <li className="space-y-2 rounded-lg border border-coral-soft/30 bg-cream/30 p-2">
      {/* Header : titre aliment + Taille (listbox) + retirer — MEME LIGNE */}
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {item.foodKeyword
            ? item.foodKeyword.charAt(0).toUpperCase() + item.foodKeyword.slice(1)
            : item.label}
        </p>
        {showSizeSelect && (
          <label className="flex shrink-0 items-center gap-1 text-[0.65rem] uppercase tracking-wider text-ink-soft">
            <span>Taille</span>
            <select
              value={currentBucket}
              onChange={(e) => onSizeChange(e.target.value as SizeBucket)}
              className="rounded border border-coral-soft bg-white px-1 py-0.5 text-xs font-semibold text-ink"
            >
              {(['small', 'medium', 'large'] as const).map((b) => (
                <option key={b} value={b}>
                  {SIZE_LABELS[b]}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Retirer ce bloc"
          className="rounded-full p-1 text-ink-soft hover:bg-rose-50 hover:text-rose-600"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Liste des candidats radio (nom + g éditable + Qté éditable).
          Par défaut on n'affiche QUE le candidat sélectionné. Un toggle
          déploie les autres propositions Ciqual. */}
      {hasCandidates && (
        <ul className="space-y-0.5 rounded-md bg-white p-1.5">
          {visibleCandidates.map((c) => {
            const selected = item.match?.alimCode === c.alimCode;
            return (
              <CandidateRow
                key={c.alimCode}
                candidate={c}
                selected={selected}
                approxGrams={item.approxGrams}
                portions={item.portions}
                showCalories={showCalories}
                onSelect={() => !selected && onPickCandidate(c)}
                onGramsChange={(g) => {
                  if (!selected) onPickCandidate(c);
                  onGramsChange(g);
                }}
                onPortionsChange={(n) => {
                  if (!selected) onPickCandidate(c);
                  onPortionsChange(n);
                }}
              />
            );
          })}
          {!expanded && otherCount > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-semibold text-coral hover:bg-coral-soft/30"
              >
                <ChevronDown className="size-3" />
                Voir {otherCount} autre{otherCount > 1 ? 's' : ''} proposition
                {otherCount > 1 ? 's' : ''}
              </button>
            </li>
          )}
          {expanded && candidates.length > 1 && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-semibold text-ink-soft hover:bg-coral-soft/30"
              >
                <ChevronUp className="size-3" />
                Replier
              </button>
            </li>
          )}
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

      {!hasCandidates && (
        <button
          type="button"
          onClick={() => setShowPicker((v) => !v)}
          className="w-full rounded-md bg-white px-2 py-1 text-left text-xs italic text-coral hover:bg-coral-soft/30"
        >
          {showPicker ? '↑ Fermer la recherche' : '🔍 Chercher dans la base Ciqual'}
        </button>
      )}

      {showPicker && (
        <FreeSearchPicker
          showCalories={showCalories}
          onPick={(c) => {
            onPickCandidate(c);
            setShowPicker(false);
          }}
        />
      )}

      {/* Accompagnements Mistral (cases à cocher, 0-3) */}
      {item.possibleAccompaniments && item.possibleAccompaniments.length > 0 && (
        <div className="rounded-md bg-amber-50/60 p-1.5">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-amber-900">
            As-tu ajouté…&nbsp;?
          </p>
          <ul className="mt-1 space-y-0.5">
            {item.possibleAccompaniments.map((acc, accIdx) => {
              const checked = selectedAccs.has(accIdx);
              return (
                <li key={accIdx}>
                  <label className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-amber-100/60">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleAcc(accIdx)}
                      className="size-3.5 accent-amber-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {acc.name}
                      <span className="ml-1 text-ink-soft">({acc.typicalG}g)</span>
                    </span>
                    {showCalories && (
                      <span className="shrink-0 font-semibold text-amber-700">
                        +{acc.kcalEstimate} kcal
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

/**
 * Une ligne de candidat Ciqual.
 * - Radio à gauche (cliquable pour sélectionner ce candidat).
 * - Nom tronqué par défaut. Si trop long pour tenir, un lien "(Suite)"
 *   permet de basculer en mode "nom complet visible".
 * - Inputs grammes + Qté à droite. Tout changement de l'un sélectionne
 *   automatiquement ce candidat.
 */
function CandidateRow({
  candidate,
  selected,
  approxGrams,
  portions,
  showCalories,
  onSelect,
  onGramsChange,
  onPortionsChange,
}: {
  candidate: CiqualCandidate;
  selected: boolean;
  approxGrams: number;
  portions: number;
  showCalories: boolean;
  onSelect: () => void;
  onGramsChange: (g: number) => void;
  onPortionsChange: (n: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const TRUNCATE_AT = 38;
  const isLong = candidate.name.length > TRUNCATE_AT;
  const visibleName =
    !isLong || expanded ? candidate.name : candidate.name.slice(0, TRUNCATE_AT) + '…';

  return (
    <li
      className={`flex flex-wrap items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors ${
        selected ? 'bg-emerald-50' : 'hover:bg-coral-soft/20'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={selected ? 'Sélectionné' : 'Sélectionner'}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          selected
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-coral-soft/60 bg-white hover:border-coral'
        }`}
      >
        {selected && <Check className="size-3" strokeWidth={3} />}
      </button>

      <span
        className={`min-w-0 flex-1 ${
          expanded ? 'whitespace-normal' : 'truncate'
        } ${selected ? 'font-medium text-emerald-900' : 'text-ink'}`}
      >
        {visibleName}
        {isLong && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="ml-1 inline text-coral underline decoration-dotted"
          >
            ({expanded ? 'Réduire' : 'Suite'})
          </button>
        )}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <label className="flex items-center gap-0.5 text-[0.65rem] text-ink-soft">
          <input
            type="number"
            min={1}
            max={5000}
            step={5}
            value={approxGrams}
            onFocus={() => {
              if (!selected) onSelect();
            }}
            onChange={(e) => {
              const g = parseInt(e.target.value, 10);
              if (Number.isFinite(g) && g > 0) onGramsChange(g);
            }}
            className={`w-12 rounded border bg-white px-1 py-0.5 text-right text-xs ${
              selected ? 'border-emerald-300' : 'border-coral-soft/60 text-ink-soft'
            }`}
          />
          g
        </label>
        <label className="flex items-center gap-0.5 text-[0.65rem] text-ink-soft">
          Qté
          <input
            type="number"
            min={0.25}
            max={20}
            step={0.25}
            value={portions}
            onFocus={() => {
              if (!selected) onSelect();
            }}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n) && n > 0) onPortionsChange(n);
            }}
            className={`w-10 rounded border bg-white px-1 py-0.5 text-right text-xs ${
              selected ? 'border-emerald-300' : 'border-coral-soft/60 text-ink-soft'
            }`}
          />
        </label>
        {showCalories && candidate.kcalPer100g !== null && (
          <span
            className={`shrink-0 text-[0.65rem] font-semibold ${
              selected ? 'text-emerald-700' : 'text-coral'
            }`}
          >
            {Math.round((candidate.kcalPer100g * approxGrams) / 100 * portions)} kcal
          </span>
        )}
      </div>
    </li>
  );
}

function FreeSearchPicker({
  showCalories,
  onPick,
}: {
  showCalories: boolean;
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
                {showCalories && (
                  <span className="shrink-0 font-semibold text-coral">
                    {c.kcalPer100g !== null ? `${Math.round(c.kcalPer100g)} kcal/100g` : '—'}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KcalBurnedEditor({
  value,
  onSaved,
}: {
  value: number;
  onSaved: (n: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 0 || n > 10000) {
      setEditing(false);
      setDraft(String(value));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/nutrition/metrics', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kcalBurned: n }),
      });
      if (res.ok) {
        onSaved(n);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        className="flex flex-col items-end text-right"
      >
        <span className="text-[0.65rem] uppercase tracking-wider text-ink-soft">
          Dépensées
        </span>
        <span className="text-xl font-bold text-emerald-600">
          {value > 0 ? `−${value}` : '+'}
          <span className="ml-0.5 text-xs font-normal text-ink-soft">kcal</span>
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-end gap-1">
      <div className="flex flex-col">
        <span className="text-[0.65rem] uppercase tracking-wider text-ink-soft">
          Dépensées
        </span>
        <input
          type="number"
          min={0}
          max={10000}
          step={10}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              setEditing(false);
              setDraft(String(value));
            }
          }}
          autoFocus
          className="w-16 rounded border border-emerald-300 px-1 py-0.5 text-right text-sm"
        />
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        aria-label="Enregistrer"
        className="rounded-full bg-emerald-500 p-1 text-white disabled:opacity-50"
      >
        <Check className="size-3" strokeWidth={3} />
      </button>
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
