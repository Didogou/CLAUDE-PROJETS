'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Trash2,
  Send,
  Loader2,
  Flame,
  ChevronDown,
  ChevronUp,
  Check,
  Camera,
  Plus,
  Sun,
  UtensilsCrossed,
  Cookie,
  Moon,
} from 'lucide-react';
import { MyInfoModal } from './MyInfoModal';
import { LongPressSlider } from '@/components/ui/LongPressSlider';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { MealCategoryAvatar } from './MealIcon';

type MealCategory = 'breakfast' | 'lunch' | 'snack' | 'dinner';

const MEAL_LABELS: Record<MealCategory, string> = {
  breakfast: "P'tit dej",
  lunch: 'Déjeuner',
  snack: 'Goûter',
  dinner: 'Dîner',
};

const MEAL_ORDER: MealCategory[] = ['breakfast', 'lunch', 'snack', 'dinner'];

/**
 * Catégorie par défaut selon l'heure courante (Europe/Paris).
 *   < 11h45 → breakfast
 *   < 15h30 → lunch
 *   < 19h   → snack
 *   sinon   → dinner
 */
function defaultMealForHour(date: Date = new Date()): MealCategory {
  const h = date.getHours();
  const m = date.getMinutes();
  const total = h * 60 + m;
  if (total < 11 * 60 + 45) return 'breakfast';
  if (total < 15 * 60 + 30) return 'lunch';
  if (total < 19 * 60) return 'snack';
  return 'dinner';
}

/**
 * Catégorie effective d'une entrée : explicite si meal_category posée
 * en base, sinon dérivée de l'heure de logged_at (rétro-compatibilité
 * avec les entrées d'avant la migration).
 */
function categoryOf(entry: FoodLogEntry): MealCategory {
  if (entry.mealCategory) return entry.mealCategory;
  return defaultMealForHour(new Date(entry.loggedAt));
}

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
  mealCategory: MealCategory | null;
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

/**
 * CalorieCounterSheetV2 — variante du layout "Apple Forme" :
 *   - vue Home : grosse tuile calories en haut + 4 tuiles repas en grid.
 *   - vue Meal Detail : drill-down full-screen avec back arrow.
 * Slide horizontal entre les 2 vues. Couleurs coral conservées.
 */
export function CalorieCounterSheetV2({ onClose, onChanged }: Props) {
  const [day, setDay] = useState<DayState | null>(null);
  const [naturalText, setNaturalText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<ParsedItem[] | null>(null);
  // Catégorie sélectionnée pour la prochaine saisie (et le preview en
  // cours). Initialisée à la catégorie correspondant à l'heure.
  const [mealCategory, setMealCategory] = useState<MealCategory>(() =>
    defaultMealForHour(),
  );
  // Tuile repas dont l'invite de saisie est ouverte inline. Null par
  // défaut — l'écran montre alors juste les tuiles compactes. Quand
  // l'abonnée clique le + d'une tuile, on set la catégorie ici et le
  // bloc saisie + photo + preview s'affiche sous cette tuile.
  const [activeMealCategory, setActiveMealCategory] =
    useState<MealCategory | null>(null);
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
    karineTip: string | null;
    karineTipRecipe: {
      slug: string;
      title: string;
      calories: number | null;
      coverImageUrl: string | null;
    } | null;
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
            karineTip: j.metrics?.karineTip ?? null,
            karineTipRecipe: j.metrics?.karineTipRecipe ?? null,
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
      const desc = typeof data.description === 'string' ? data.description.trim() : '';
      if (desc) {
        setNaturalText(desc);
        // Auto-parse : la description Vision part directement dans le
        // pipeline parse — l'abonnée n'a pas besoin de re-cliquer Send.
        await parseText(desc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur photo');
    } finally {
      setPhotoUploading(false);
    }
  }

  async function parseText(text: string) {
    if (!text.trim() || parsing) return;
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

  async function handleParse() {
    await parseText(naturalText);
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
      // Catégorie effective : celle de la tuile active si l'invite a
      // été ouverte via un + de tuile, sinon la sélection globale.
      const effectiveCategory: MealCategory = activeMealCategory ?? mealCategory;
      const res = await fetch('/api/nutrition/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries, mealCategory: effectiveCategory }),
      });
      if (res.ok) {
        setPreview(null);
        setAccSel(new Map());
        setNaturalText('');
        // Ferme l'invite inline et recalcule la catégorie par défaut.
        setActiveMealCategory(null);
        setMealCategory(defaultMealForHour());
        await refresh();
        onChanged();
        window.dispatchEvent(new CustomEvent('nutrition-log-updated'));
        // Déclenche la génération du conseil Karine en arrière-plan.
        // Pas de await : si Mistral met 2s, l'UI reste réactive et le
        // toast apparaît dès que la réponse arrive.
        // Decision Karine 2026-06-05 : on retire l'affichage du
        // conseil (toast supprime, bandeau supprime). On continue
        // a l'enregistrer en BDD via karine-tip pour pouvoir le
        // ressortir plus tard si besoin.
        fetch('/api/nutrition/karine-tip', { method: 'POST' })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.tip) {
              setMetrics((m) =>
                m
                  ? { ...m, karineTip: data.tip, karineTipRecipe: data.recipe ?? null }
                  : {
                      kcalBurned: 0,
                      karineTip: data.tip,
                      karineTipRecipe: data.recipe ?? null,
                    },
              );
            }
          })
          .catch(() => {
            // silencieux : si Mistral plante, on n'a juste pas de
            // conseil ce coup-ci.
          });
      } else {
        const j = await res.json();
        alertError(j?.error || 'Enregistrement impossible');
      }
    } finally {
      setLogging(false);
    }
  }

  async function changeEntryCategory(id: string, next: MealCategory) {
    const prev = day;
    // Optimistic update
    setDay((d) =>
      d
        ? {
            ...d,
            entries: d.entries.map((e) =>
              e.id === id ? { ...e, mealCategory: next } : e,
            ),
          }
        : d,
    );
    const res = await fetch(`/api/nutrition/log/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mealCategory: next }),
    });
    if (!res.ok) {
      // Rollback
      setDay(prev);
      const j = await res.json().catch(() => ({}));
      alertError(j?.error || 'Modification impossible');
    } else {
      onChanged();
      window.dispatchEvent(new CustomEvent('nutrition-log-updated'));
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

  // Préparation des stats macros + groupement entries par catégorie.
  // Ces calculs sont peu coûteux et faits à chaque rerender — pas
  // besoin de memo.
  const entriesByCat: Record<MealCategory, FoodLogEntry[]> = {
    breakfast: [],
    lunch: [],
    snack: [],
    dinner: [],
  };
  if (day) {
    for (const e of day.entries) entriesByCat[categoryOf(e)].push(e);
  }
  const totalsForCat = (cat: MealCategory) =>
    entriesByCat[cat].reduce((a, e) => a + e.kcal * e.portions, 0);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 print:hidden md:items-center md:justify-center md:p-4"
      // Désactive le pinch-to-zoom et autres gestes natifs sur la
      // sheet, autorise uniquement le scroll vertical.
      style={{ touchAction: 'pan-y' }}
    >
      <div className="flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl md:h-[min(95vh,840px)] md:rounded-3xl">
        {/* === Header transparent sur fond hero === */}
        <header className="flex shrink-0 items-center justify-between gap-2 bg-coral/95 px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <Flame className="size-5" />
            <h2 className="font-script text-2xl">Mes calories</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMyInfoOpen(true)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                day?.profileComplete
                  ? 'bg-white/90 text-coral-dark hover:bg-white'
                  : 'bg-coral-soft/40 text-white hover:bg-coral-soft/60'
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
              className="rounded-full p-1.5 hover:bg-white/10"
            >
              <X className="size-5" />
            </button>
          </div>
        </header>

        {error && (
          <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {error}
          </div>
        )}

        {/* === Body : 2 panneaux qui slident horizontalement ===
            Pattern Apple Forme drill-down. Chaque panel prend toute
            la largeur (absolute inset-0) et glisse via translate-x —
            plus fiable que le pattern flex w-[200%] qui cassait sur
            PC. */}
        <div className="relative min-h-0 flex-1 overflow-hidden">

          {/* === PANEL 1 : HOME === */}
          <div
            className={`absolute inset-0 overflow-y-auto overscroll-contain transition-transform duration-300 ease-out ${
              activeMealCategory ? '-translate-x-full' : 'translate-x-0'
            }`}
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(226, 120, 141, 0.5) transparent',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
            }}
            aria-hidden={!!activeMealCategory}
          >
          {/* === HERO : cercle + kcal dépensées ===
              Fond dégradé coral, paddings horizontaux + verticaux
              généreux pour que le cercle ne touche jamais les bords. */}
          <section className="bg-gradient-to-b from-coral via-coral/90 to-coral/50 px-4 pt-6 pb-8 text-white">
            <div className="flex items-center justify-center gap-3">
              <CircularProgress
                value={Math.max(0, net)}
                max={target}
                size="9.5rem"
                strokeWidth="0.8rem"
                trackClassName="stroke-white/25"
                arcClassName={overshoot > 0 ? 'stroke-rose-200' : 'stroke-white'}
              >
                <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-white/90">
                  Restant
                </span>
                <span className="font-bold leading-none" style={{ fontSize: '2.1rem' }}>
                  {Math.round(Math.max(0, remaining))}
                </span>
                <span className="text-[0.65rem] text-white/90">
                  / {target} kcal
                </span>
              </CircularProgress>

              {/* Card Dépensées côte à côte avec le cercle, compacte.
                  KcalBurnedEditor gère son propre label "Dépensées" —
                  on ne le double pas ici. */}
              <div className="flex shrink-0 flex-col items-stretch rounded-2xl bg-white p-3 text-emerald-900 shadow-xl ring-2 ring-white/40">
                <KcalBurnedEditor
                  value={metrics?.kcalBurned ?? 0}
                  onSaved={(n) => {
                    setMetrics((m) =>
                      m
                        ? { ...m, kcalBurned: n }
                        : { kcalBurned: n, karineTip: null, karineTipRecipe: null },
                    );
                  }}
                />
                <span className="border-t border-emerald-200/70 pt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-800/80">
                  Consommé&nbsp;: {Math.round(totals)} kcal
                </span>
              </div>
            </div>
          </section>

          {/* === MACROS : fond légèrement vert + grosses tuiles ===
              Tuiles décalées vers le haut pour entrer dans la fin du
              hero, donnent l'illusion d'une carte qui flotte sur le
              gradient coral. */}
          <section className="bg-gradient-to-b from-emerald-50/60 via-emerald-50/30 to-white px-4 pb-3 -mt-4">
            <MacrosTiles
              consumed={day?.totals ?? { kcal: 0, proteinsG: 0, lipidsG: 0, carbsG: 0 }}
              target={day?.target ?? null}
            />
          </section>

          {/* === TUILES REPAS en grid 2x2 (style Apple) ===
              Click sur tuile = drill-down vers Panel 2 (meal detail). */}
          <section className="bg-gradient-to-b from-cream/20 to-white px-4 pt-2 pb-3">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-coral-dark">
              Repas du jour
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {MEAL_ORDER.map((cat) => {
                const entries = entriesByCat[cat];
                return (
                  <MealTileApple
                    key={cat}
                    category={cat}
                    count={entries.length}
                    totalKcal={totalsForCat(cat)}
                    onClick={() => {
                      setActiveMealCategory(cat);
                      setMealCategory(cat);
                      setNaturalText('');
                      setPreview(null);
                      setAccSel(new Map());
                    }}
                  />
                );
              })}
            </div>
          </section>
          </div>

          {/* === PANEL 2 : MEAL DETAIL ===
              Affiche header (back + nom catégorie) + entries + invite
              + preview. Slide depuis la droite quand activeMealCategory
              est posé. */}
          <div
            className={`absolute inset-0 flex flex-col overflow-hidden bg-white transition-transform duration-300 ease-out ${
              activeMealCategory ? 'translate-x-0' : 'translate-x-full'
            }`}
            aria-hidden={!activeMealCategory}
          >
            {activeMealCategory && (
              <>
                <div className="flex shrink-0 items-center gap-3 border-b border-coral-soft/30 bg-coral/95 px-4 py-3 text-white">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMealCategory(null);
                      setNaturalText('');
                      setPreview(null);
                      setAccSel(new Map());
                    }}
                    aria-label="Retour"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20 transition hover:bg-white/30"
                  >
                    <ChevronLeftIcon />
                  </button>
                  <h2 className="font-script text-2xl">
                    {MEAL_LABELS[activeMealCategory]}
                  </h2>
                </div>

                <div
                  className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(226, 120, 141, 0.5) transparent',
                    WebkitOverflowScrolling: 'touch',
                    touchAction: 'pan-y',
                  }}
                >
                  {/* Entries déjà saisies pour cette catégorie */}
                  {entriesByCat[activeMealCategory].length > 0 && (
                    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-coral-soft/30">
                      <h4 className="border-b border-coral-soft/20 px-4 py-2 text-[0.7rem] font-bold uppercase tracking-wider text-coral-dark">
                        Déjà ajouté ({Math.round(totalsForCat(activeMealCategory))} kcal)
                      </h4>
                      <ul className="space-y-1.5 px-4 py-2.5">
                        {entriesByCat[activeMealCategory].map((e) => (
                          <EntryRow
                            key={e.id}
                            entry={e}
                            onDelete={() => handleDelete(e.id)}
                            onChangeCategory={(next) => changeEntryCategory(e.id, next)}
                          />
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Zone de saisie inline */}
                  <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-coral-soft/30">
                    <p className="mb-2 text-xs font-semibold text-ink-soft">
                      Ajouter un plat
                    </p>
                    <InlineMealInvite
                      naturalText={naturalText}
                      onTextChange={setNaturalText}
                      parsing={parsing}
                      photoUploading={photoUploading}
                      onPhoto={handlePhoto}
                      onParse={handleParse}
                    />
                  </div>

                  {/* Preview du parse Mistral */}
                  {preview && preview.length > 0 && (
                    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-coral-soft/30">
                    <ul className="space-y-2.5">
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
                    {/* Boutons Annuler / Ajouter sous le preview,
                        dans le panel meal detail. */}
                    <div className="mt-3 flex items-center gap-2 border-t border-coral-soft/20 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setPreview(null);
                          setAccSel(new Map());
                        }}
                        className="rounded-full border border-coral-soft px-4 py-2 text-sm font-semibold text-coral"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmPreview}
                        disabled={logging}
                        className="ml-auto inline-flex items-center gap-2 rounded-full bg-coral px-6 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
                      >
                        {logging ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        Ajouter
                      </button>
                    </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

        </div>
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
        </ul>
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
          <LongPressSlider
            value={approxGrams}
            min={1}
            max={1000}
            step={5}
            suffix="g"
            ariaLabel="Grammes par portion"
            onFocusValue={() => {
              if (!selected) onSelect();
            }}
            onChange={(g) => {
              if (Number.isFinite(g) && g > 0) onGramsChange(Math.round(g));
            }}
            inputClassName={`w-12 rounded border bg-white px-1 py-0.5 text-right text-xs ${
              selected ? 'border-emerald-300' : 'border-coral-soft/60 text-ink-soft'
            }`}
          />
          g
        </label>
        <label className="flex items-center gap-0.5 text-[0.65rem] text-ink-soft">
          Qté
          <LongPressSlider
            value={portions}
            min={0.25}
            max={20}
            step={0.25}
            suffix="Qté"
            ariaLabel="Nombre de portions"
            onFocusValue={() => {
              if (!selected) onSelect();
            }}
            onChange={(n) => {
              if (Number.isFinite(n) && n > 0) onPortionsChange(n);
            }}
            inputClassName={`w-10 rounded border bg-white px-1 py-0.5 text-right text-xs ${
              selected ? 'border-emerald-300' : 'border-coral-soft/60 text-ink-soft'
            }`}
          />
        </label>
        {showCalories && (
          <span
            className={`shrink-0 text-[0.65rem] font-semibold ${
              selected ? 'text-emerald-700' : 'text-coral'
            }`}
          >
            {candidate.kcalPer100g !== null
              ? `${Math.round((candidate.kcalPer100g * approxGrams) / 100 * portions)} kcal`
              : '— kcal'}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * Mini-cards macros : Glucides / Protéines / Lipides au format
 * `consommé / objectif g`. Si le profil n'est pas complet (objectif
 * null), on affiche seulement le consommé.
 */
/**
 * Tuiles macros — fond blanc cassé, mini-barre de progression colorée
 * par macro (rose / sky / amber comme aujourd'hui).
 */
function MacrosTiles({
  consumed,
  target,
}: {
  consumed: { kcal: number; proteinsG: number; lipidsG: number; carbsG: number };
  target:
    | {
        dailyProteinsG: number | null;
        dailyLipidsG: number | null;
        dailyCarbsG: number | null;
      }
    | null;
}) {
  const items: Array<{
    label: string;
    consumed: number;
    target: number | null;
    barClass: string;
    accent: string;
    labelColor: string;
  }> = [
    {
      label: 'Glucides',
      consumed: consumed.carbsG,
      target: target?.dailyCarbsG ?? null,
      barClass: 'bg-rose-400',
      accent: 'text-rose-700',
      labelColor: 'text-rose-800/80',
    },
    {
      label: 'Protéines',
      consumed: consumed.proteinsG,
      target: target?.dailyProteinsG ?? null,
      barClass: 'bg-sky-500',
      accent: 'text-sky-700',
      labelColor: 'text-sky-800/80',
    },
    {
      label: 'Lipides',
      consumed: consumed.lipidsG,
      target: target?.dailyLipidsG ?? null,
      barClass: 'bg-amber-500',
      accent: 'text-amber-700',
      labelColor: 'text-amber-800/80',
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((it) => {
        const pct =
          it.target && it.target > 0
            ? Math.min(100, Math.round((it.consumed / it.target) * 100))
            : 0;
        return (
          <div
            key={it.label}
            className="rounded-2xl bg-gradient-to-b from-white to-emerald-50/60 px-4 py-4 shadow-md ring-1 ring-emerald-100"
          >
            <p
              className={`text-xs font-bold uppercase tracking-wider ${it.labelColor}`}
            >
              {it.label}
            </p>
            <p className={`mt-1.5 text-2xl font-extrabold ${it.accent}`}>
              {Math.round(it.consumed)}
              <span className="text-base font-semibold text-ink-soft">
                {it.target !== null ? `/${Math.round(it.target)}` : ''}g
              </span>
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-soft/15">
              <div
                className={`h-full ${it.barClass} transition-[width] duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Tuile d'une catégorie de repas (P'tit dej / Déj / Goûter / Dîner).
 *
 * En mode compact (non-active) :
 *   [icône] Pti dej · 235 kcal · 2 plats    [ + ]
 *
 * Quand active (children rendus dessous) : l'invite de saisie inline,
 * le preview Mistral, etc.
 *
 * Cliquer la tuile (hors +) déploie le détail éditable des entries
 * (avec changement de catégorie + suppression).
 */

/** Petite flèche gauche réutilisée pour le bouton "Retour" du drill-down. */
function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

/**
 * Tuile carrée style Apple Forme. Affiche en grand l'icône colorée +
 * label de catégorie + total kcal + nb plats. Click → drill-down vers
 * le meal detail panel.
 */
function MealTileApple({
  category,
  count,
  totalKcal,
  onClick,
}: {
  category: MealCategory;
  count: number;
  totalKcal: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex min-h-[7rem] flex-col items-start justify-end gap-1 overflow-hidden rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-coral-soft/30 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
    >
      {/* Icône en haut à droite, grande pour effet "vignette" Apple. */}
      <span className="absolute right-2 top-2">
        <MealCategoryAvatar
          category={category}
          wrapperSize="size-16"
          lucideSize="size-8"
        />
      </span>
      <span className="mt-auto text-lg font-bold text-ink">
        {MEAL_LABELS[category]}
      </span>
      <span className="text-sm font-medium text-ink-soft">
        {count === 0
          ? 'Aucun plat'
          : `${Math.round(totalKcal)} kcal · ${count} ${
              count > 1 ? 'plats' : 'plat'
            }`}
      </span>
    </button>
  );
}

function MealTile({
  category,
  entries,
  totalKcal,
  isActive,
  onAddClick,
  onCloseInvite,
  onDelete,
  onChangeCategory,
  children,
}: {
  category: MealCategory;
  entries: FoodLogEntry[];
  totalKcal: number;
  isActive: boolean;
  onAddClick: () => void;
  onCloseInvite: () => void;
  onDelete: (id: string) => void;
  onChangeCategory: (id: string, next: MealCategory) => void;
  children?: React.ReactNode;
}) {
  const tileRef = useRef<HTMLElement | null>(null);
  const hasEntries = entries.length > 0;

  // Quand la tuile passe en mode actif, on la centre dans le viewport
  // de la sheet pour que l'abonnée voie clairement l'invite + entries.
  useEffect(() => {
    if (isActive && tileRef.current) {
      // Délai léger pour laisser l'animation d'ouverture commencer
      // avant de scroller (sinon le scroll vise une mauvaise hauteur).
      const t = setTimeout(() => {
        tileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
      return () => clearTimeout(t);
    }
  }, [isActive]);

  return (
    <article
      ref={tileRef}
      className={`overflow-hidden rounded-2xl bg-[#fdfbf6] shadow-sm transition-all duration-300 ring-1 ${
        isActive ? 'ring-2 ring-coral' : 'ring-coral-soft/30'
      }`}
    >
      {/* Bandeau header de la tuile */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className="grid size-11 shrink-0 place-items-center"
        >
          <MealCategoryAvatar category={category} wrapperSize="size-11" lucideSize="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start text-left">
          <span className="text-base font-bold text-ink">
            {MEAL_LABELS[category]}
          </span>
          <span className="text-xs text-ink-soft">
            {hasEntries
              ? `${Math.round(totalKcal)} kcal · ${entries.length} ${
                  entries.length > 1 ? 'plats' : 'plat'
                }`
              : 'Aucun plat'}
          </span>
        </div>
        {isActive ? (
          <button
            type="button"
            onClick={onCloseInvite}
            aria-label="Fermer"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-coral-dark transition hover:bg-coral-soft/70"
          >
            <X className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onAddClick}
            aria-label={`Ajouter à ${MEAL_LABELS[category]}`}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-coral text-white shadow-md transition-transform duration-200 hover:scale-105 hover:bg-coral-dark active:scale-95"
          >
            <Plus className="size-5" />
          </button>
        )}
      </div>

      {/* Liste des entries existantes — TOUJOURS visible quand la
          tuile contient des plats, qu'on soit en mode invite OU non.
          Karine voulait pouvoir voir ce qu'elle a déjà ajouté avant
          d'en ajouter un nouveau. */}
      {hasEntries && (
        <ul className="space-y-1.5 border-t border-coral-soft/20 bg-white px-4 py-2.5">
          {entries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              onDelete={() => onDelete(e.id)}
              onChangeCategory={(next) => onChangeCategory(e.id, next)}
            />
          ))}
        </ul>
      )}

      {/* Panneau invite + preview + bouton Ajouter — uniquement
          quand la tuile est active. Animation slide via grid-rows
          0→1fr (technique CSS moderne, sans JS). */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          isActive ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {isActive && (
            <div className="border-t border-coral-soft/20 bg-white px-4 pb-3 pt-3">
              {children}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Invite inline de saisie naturelle + photo. Déclenchée par le +
 * d'une tuile repas — la catégorie cible est gérée par l'état
 * `activeMealCategory` côté parent.
 */
function InlineMealInvite({
  naturalText,
  onTextChange,
  parsing,
  photoUploading,
  onPhoto,
  onParse,
}: {
  naturalText: string;
  onTextChange: (v: string) => void;
  parsing: boolean;
  photoUploading: boolean;
  onPhoto: (file: File) => void;
  onParse: () => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={naturalText}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onParse();
          }
        }}
        maxLength={500}
        autoFocus
        placeholder="ex. un yaourt nature et une pomme"
        className="flex-1 rounded-lg border border-coral-soft px-2 py-1.5 text-sm"
      />
      <label
        className={`flex size-9 cursor-pointer items-center justify-center rounded-full bg-white text-coral ring-2 ring-coral-soft hover:bg-coral-soft/30 ${
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
            if (f) onPhoto(f);
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
        onClick={onParse}
        disabled={parsing || naturalText.trim().length < 3}
        aria-label="Analyser"
        className="flex size-9 items-center justify-center rounded-full bg-coral text-white disabled:opacity-50"
      >
        {parsing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
      </button>
    </div>
  );
}

// Mapping icône + couleur de fond par catégorie de repas.
const MEAL_ICONS: Record<MealCategory, typeof Sun> = {
  breakfast: Sun,
  lunch: UtensilsCrossed,
  snack: Cookie,
  dinner: Moon,
};
const MEAL_BG_COLOR: Record<MealCategory, string> = {
  breakfast: '#f59e0b', // amber
  lunch: '#e2788d',     // coral
  snack: '#a78bfa',     // violet
  dinner: '#1e3a8a',    // navy
};

/**
 * Chips de catégorie de repas. Compacts pour cohabiter avec le label
 * "Qu'as-tu mangé ?" sur la même ligne.
 */
function MealCategoryChips({
  value,
  onChange,
}: {
  value: MealCategory;
  onChange: (next: MealCategory) => void;
}) {
  return (
    <div className="mb-2 grid grid-cols-4 gap-1 rounded-full bg-coral-soft/20 p-1">
      {MEAL_ORDER.map((m) => {
        const active = m === value;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`rounded-full px-2 py-1 text-center text-[0.7rem] font-semibold transition-colors ${
              active
                ? 'bg-coral text-white shadow-sm'
                : 'text-coral-dark hover:bg-coral-soft/40'
            }`}
          >
            {MEAL_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Affiche les entrées du jour groupées par catégorie de repas (Ptit
 * dej / Déj / Goûter / Dîner). Sous-total kcal par section. Chaque
 * entry permet de re-catégoriser via un popover compact.
 */
function MealsByCategory({
  entries,
  onDelete,
  onChangeCategory,
}: {
  entries: FoodLogEntry[];
  onDelete: (id: string) => void;
  onChangeCategory: (id: string, next: MealCategory) => void;
}) {
  // Catégories pliées (par défaut tout est déployé).
  const [collapsed, setCollapsed] = useState<Set<MealCategory>>(new Set());

  const groups: Record<MealCategory, FoodLogEntry[]> = {
    breakfast: [],
    lunch: [],
    snack: [],
    dinner: [],
  };
  for (const e of entries) {
    groups[categoryOf(e)].push(e);
  }

  function toggle(cat: MealCategory) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="space-y-2.5">
      {MEAL_ORDER.map((cat) => {
        const items = groups[cat];
        if (items.length === 0) return null;
        const subTotal = items.reduce((a, e) => a + e.kcal * e.portions, 0);
        const isCollapsed = collapsed.has(cat);
        return (
          <div
            key={cat}
            className="overflow-hidden rounded-xl border border-coral-soft/30 bg-coral-soft/10"
          >
            <button
              type="button"
              onClick={() => toggle(cat)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-coral-soft/20"
            >
              <span className="flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wider text-coral-dark">
                {isCollapsed ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronUp className="size-3.5" />
                )}
                {MEAL_LABELS[cat]}
                <span className="rounded-full bg-coral-soft/40 px-1.5 py-0.5 text-[0.6rem] font-semibold text-coral-dark">
                  {items.length}
                </span>
              </span>
              <span className="text-[0.7rem] font-semibold text-coral">
                {Math.round(subTotal)} kcal
              </span>
            </button>
            {!isCollapsed && (
              <ul className="space-y-1.5 border-t border-coral-soft/30 bg-white/40 p-2">
                {items.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    onDelete={() => onDelete(e.id)}
                    onChangeCategory={(next) => onChangeCategory(e.id, next)}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EntryRow({
  entry,
  onDelete,
  onChangeCategory,
}: {
  entry: FoodLogEntry;
  onDelete: () => void;
  onChangeCategory: (next: MealCategory) => void;
}) {
  const [open, setOpen] = useState(false);
  const cat = categoryOf(entry);
  const wrapperRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <li
      ref={wrapperRef}
      className="relative flex items-center gap-2 rounded-lg border border-coral-soft/30 bg-white px-2.5 py-1.5"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 rounded-full bg-coral-soft/40 px-2 py-0.5 text-[0.6rem] font-semibold text-coral-dark hover:bg-coral-soft/60"
        aria-label="Changer la catégorie"
      >
        {MEAL_LABELS[cat]}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{entry.label}</p>
        <p className="text-xs text-ink-soft">
          {Math.round(entry.kcal * entry.portions)} kcal
          {entry.portions !== 1 && ` (${entry.portions} portions)`}
        </p>
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Supprimer"
        className="rounded-full p-1.5 text-ink-soft hover:bg-rose-50 hover:text-rose-600"
      >
        <Trash2 className="size-4" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 flex gap-1 rounded-full border border-coral-soft/40 bg-white p-1 shadow-lg">
          {MEAL_ORDER.map((m) => {
            const active = m === cat;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (m !== cat) onChangeCategory(m);
                }}
                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[0.65rem] font-semibold transition-colors ${
                  active
                    ? 'bg-coral text-white'
                    : 'text-coral-dark hover:bg-coral-soft/40'
                }`}
              >
                {MEAL_LABELS[m]}
              </button>
            );
          })}
        </div>
      )}
    </li>
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

