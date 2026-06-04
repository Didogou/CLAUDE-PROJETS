'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Send, Loader2, Flame, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { NutritionProfileForm } from './NutritionProfileForm';

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
  /** Top 7 candidats Ciqual (toujours quand on en a trouvé) */
  topCandidates?: CiqualCandidate[];
  foodKeyword?: string;
  sizeVariability?: 'low' | 'medium' | 'high';
  sizeHint?: SizeBucket | null;
};

type Followup = {
  itemIndex: number;
  triggerKeyword: string;
  question: string;
  suggestedFood: string;
  defaultG: number;
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
  const [previewStep, setPreviewStep] = useState(0);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [answeredFollowups, setAnsweredFollowups] = useState<Set<number>>(new Set());
  const [correctedText, setCorrectedText] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const [metrics, setMetrics] = useState<{
    kcalBurned: number;
    summaryText: string | null;
  } | null>(null);
  const [showCalories, setShowCalories] = useState<boolean>(true);

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
        // silencieux : les ronds restent à 0
      }
    })();
  }, []);
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
        setPreviewStep(0);
        setFollowups(Array.isArray(data.followups) ? data.followups : []);
        setAnsweredFollowups(new Set());
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
        setPreviewStep(0);
        setFollowups([]);
        setAnsweredFollowups(new Set());
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
  // Bilan net = ingere - depense. Le "reste avant objectif" tient
  // compte des kcal brules par le sport.
  const net = totals - burned;
  const remaining = Math.max(0, target - net);
  const overshoot = Math.max(0, net - target);
  const percent = Math.min(100, target > 0 ? Math.max(0, net) / target * 100 : 0);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 print:hidden md:items-center md:justify-center md:p-4">
      <div className="flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:h-[min(85vh,640px)] md:rounded-3xl">
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

        {/* Bilan Mistral du soir (genere par cron a partir de summary_hour). */}
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

            {/* Champ kcal dépensées (sport, marche) — affiché à droite
                du compteur. Edition inline. */}
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

          <button
            type="button"
            onClick={() => setEditingTarget((v) => !v)}
            className={`mt-2 flex w-full items-center justify-between rounded-lg border px-3 py-1.5 text-left text-xs font-semibold transition-colors ${
              day?.profileComplete
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-coral-soft/40 bg-white text-coral-dark hover:bg-coral-soft/20'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {day?.profileComplete && (
                <Check className="size-3.5" strokeWidth={3} />
              )}
              {day?.profileComplete
                ? 'Tes informations sont à jour'
                : 'Renseigne tes besoins en calorie'}
            </span>
            {editingTarget ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>

          {editingTarget && (
            <div className="mt-2">
              <NutritionProfileForm
                onSaved={() => {
                  setEditingTarget(false);
                  refresh();
                }}
                onError={alertError}
              />
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
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-ink-soft">
                  Voici ce que j&apos;ai trouvé, tu confirmes&nbsp;?
                </p>
                {preview.length > 1 && (
                  <span className="rounded-full bg-coral-soft/40 px-2 py-0.5 text-[0.65rem] font-bold text-coral-dark">
                    {previewStep + 1} / {preview.length}
                  </span>
                )}
              </div>
              {/* Affichage 1 item a la fois (stepper) — l aliment courant
                  est dans une section scrollable pour que la liste des
                  candidats reste visible meme si elle deborde. */}
              <ul
                className="max-h-[40vh] space-y-1.5 overflow-y-auto pr-1"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(226, 120, 141, 0.5) transparent',
                  overscrollBehavior: 'contain',
                }}
              >
                {(() => {
                  const i = Math.min(previewStep, preview.length - 1);
                  const p = preview[i];
                  return (
                    <PreviewRow
                      key={i}
                      item={p}
                      showCalories={showCalories}
                      onPortionsChange={(n) => {
                        const next = [...preview];
                        next[i] = { ...p, portions: n };
                        setPreview(next);
                      }}
                      onPickCandidate={(c) => {
                        const next = [...preview];
                        const recomputed = recomputeFromCandidate(
                          c,
                          p.approxGrams,
                        );
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
                        if (next.length === 0) {
                          setPreview(null);
                          setCorrectedText(null);
                          setPreviewStep(0);
                          setFollowups([]);
                          setAnsweredFollowups(new Set());
                        } else {
                          setPreview(next);
                          // Si on a retire le dernier, recule
                          setPreviewStep((s) => Math.min(s, next.length - 1));
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
                  );
                })()}

                {/* Carte followup : si un followup cible l'item courant
                    ET pas encore répondu, on affiche les boutons Oui/Non.
                    Si Oui, on insère un nouvel item juste après dans le
                    preview pour qu'il devienne le step suivant. */}
                {(() => {
                  const i = Math.min(previewStep, preview.length - 1);
                  const followup = followups.find(
                    (f) =>
                      f.itemIndex === i &&
                      !answeredFollowups.has(f.itemIndex),
                  );
                  if (!followup) return null;
                  return (
                    <li className="rounded-lg border border-amber-300 bg-amber-50/70 p-2.5">
                      <p className="text-xs font-semibold text-amber-900">
                        💡 {followup.question}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAnsweredFollowups((s) => {
                              const next = new Set(s);
                              next.add(followup.itemIndex);
                              return next;
                            });
                          }}
                          className="rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        >
                          Non
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            // Insère un nouvel item avec l'aliment suggéré
                            // juste après l'item courant.
                            const newItem: ParsedItem = {
                              label: followup.suggestedFood,
                              searchQuery: followup.suggestedFood,
                              portions: 1,
                              approxGrams: followup.defaultG,
                              baseGramsBeforeSizeHint: followup.defaultG,
                              match: null,
                              kcalPerPortion: null,
                              proteinsPerPortion: null,
                              lipidsPerPortion: null,
                              carbsPerPortion: null,
                              topCandidates: undefined,
                              sizeVariability: 'low',
                              sizeHint: null,
                            };
                            const next = [...preview];
                            next.splice(i + 1, 0, newItem);
                            setPreview(next);
                            setAnsweredFollowups((s) => {
                              const out = new Set(s);
                              out.add(followup.itemIndex);
                              return out;
                            });
                          }}
                          className="ml-auto rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-amber-600"
                        >
                          Oui, ajouter
                        </button>
                      </div>
                    </li>
                  );
                })()}
              </ul>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    setCorrectedText(null);
                    setPreviewStep(0);
                    setFollowups([]);
                    setAnsweredFollowups(new Set());
                  }}
                  className="rounded-full border border-coral-soft px-3 py-1.5 text-xs font-semibold text-coral"
                >
                  Annuler
                </button>
                {previewStep > 0 && (
                  <button
                    type="button"
                    onClick={() => setPreviewStep((s) => Math.max(0, s - 1))}
                    className="rounded-full border border-coral-soft px-3 py-1.5 text-xs font-semibold text-coral"
                  >
                    ← Précédent
                  </button>
                )}
                {previewStep < preview.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setPreviewStep((s) => s + 1)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-1.5 text-xs font-semibold text-white"
                  >
                    Valider et suivant →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleConfirmPreview}
                    disabled={logging}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {logging ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Ajouter
                  </button>
                )}
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
          <button
            type="button"
            onClick={() => setTodayOpen((v) => !v)}
            className="mb-2 flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-ink-soft transition-colors hover:text-coral-dark"
          >
            <span>
              Aujourd&apos;hui, tu as mangé&nbsp;: {day?.entries.length ?? 0}
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
    </div>,
    document.body,
  );
}

function PreviewRow({
  item,
  showCalories,
  onPortionsChange,
  onPickCandidate,
  onRemove,
  onSizeChange,
}: {
  item: ParsedItem;
  showCalories: boolean;
  onPortionsChange: (n: number) => void;
  onPickCandidate: (c: CiqualCandidate) => void;
  onRemove: () => void;
  onSizeChange: (bucket: SizeBucket) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const total =
    item.kcalPerPortion !== null
      ? Math.round(item.kcalPerPortion * item.portions)
      : null;

  const candidates = item.topCandidates ?? [];
  const hasCandidates = candidates.length > 0;

  // Affichage des chips P/M/G : si l'aliment a une variability !=
  // 'low' ET qu'aucun adjectif explicite (sizeHint=null), on
  // propose les 3 chips pour que l'abonnée valide.
  const showSizeChips =
    item.sizeVariability === 'high' ||
    (item.sizeVariability === 'medium' && item.sizeHint === null);
  const currentBucket: SizeBucket = item.sizeHint ?? 'medium';

  return (
    <li className="space-y-1.5 rounded-lg border border-coral-soft/30 bg-cream/40 px-2 py-1.5">
      {/* Header : nom sélectionné + kcal + stepper portions + supprimer */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{item.label}</p>
          <p className="text-xs text-ink-soft">
            {showCalories && (
              <>
                {total !== null ? `${total} kcal` : 'kcal inconnues'}
                {' · '}
              </>
            )}
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

      {/* Chips Petit / Moyen / Grand — affichés si l'aliment a une
          variabilité non triviale ET aucun adjectif n'a été détecté.
          Sinon l'item garde son approxGrams initial. */}
      {showSizeChips && (
        <div className="flex items-center gap-1.5 rounded-md bg-white p-1.5">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft">
            Taille :
          </span>
          {(['small', 'medium', 'large'] as const).map((b) => {
            const active = b === currentBucket;
            return (
              <button
                key={b}
                type="button"
                onClick={() => onSizeChange(b)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-coral text-white shadow'
                    : 'bg-coral-soft/30 text-coral hover:bg-coral-soft/50'
                }`}
              >
                {SIZE_LABELS[b]}
              </button>
            );
          })}
        </div>
      )}

      {/* Liste des candidats (radio-like) — toujours visible quand on
          en a. Le candidat sélectionné a la coche verte rempli, les
          autres une coche grise éteinte (cliquable). */}
      {hasCandidates && (
        <ul className="space-y-0.5 rounded-md bg-white p-1.5">
          {candidates.map((c) => {
            const selected = item.match?.alimCode === c.alimCode;
            return (
              <li key={c.alimCode}>
                <button
                  type="button"
                  onClick={() => !selected && onPickCandidate(c)}
                  disabled={selected}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors ${
                    selected
                      ? 'bg-emerald-50 text-emerald-900'
                      : 'text-ink hover:bg-coral-soft/30'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-coral-soft/60 bg-white'
                    }`}
                  >
                    {selected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {showCalories && (
                    <span
                      className={`shrink-0 font-semibold ${
                        selected ? 'text-emerald-700' : 'text-coral'
                      }`}
                    >
                      {c.kcalPer100g !== null
                        ? `${Math.round(c.kcalPer100g)} kcal/100g`
                        : '—'}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
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

      {/* Aucun candidat — proposer recherche libre direct */}
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
    </li>
  );
}

/**
 * Recherche libre dans Ciqual (autocomplete). Utilisé en fallback
 * quand l'IA ne propose pas le bon aliment.
 */
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

/**
 * Petit champ "Dépensées" editable inline.
 * - Affiche "💪 -X kcal" en mode lecture
 * - Click → input number editable + bouton check pour valider
 * - PATCH /api/nutrition/metrics au save
 */
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

