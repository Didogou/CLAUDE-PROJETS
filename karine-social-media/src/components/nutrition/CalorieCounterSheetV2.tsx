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
import { DrumPicker } from '@/components/ui/DrumPicker';
import { MealCategoryAvatar } from './MealIcon';
import { WaterSection } from './WaterSection';
import { IngredientCardCarousel } from './IngredientCardCarousel';

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
  /** URL Supabase Storage de la photo si l'entry a été créée à partir
   *  d'une analyse photo (toutes les entries d'un même batch POST
   *  partagent la même photo_url). null si saisie texte. */
  photoUrl: string | null;
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

/** Normalise un nom d'aliment pour matcher entre accompagnements
 *  Mistral et autres ingrédients du preview. Lowercase + retire
 *  accents + pluriel basique. "Sucre", "sucres", "SUCRE" → "sucre". */
function normalizeForAccompMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/s$/, '')
    .trim();
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
  // URL de la photo qui vient d'être analysée — visible en vignette
  // sous "Ajouter un plat" tant qu'on n'a pas validé d'entry. Au 1er
  // handleConfirmSingle, on l'attache à l'entry sauvée (côté API)
  // puis on remet null pour ne pas l'afficher en haut. La photo
  // réapparaît automatiquement dans la liste "Déjà ajouté" (via la
  // colonne photo_url remontée par getNutritionDayState).
  const [mealPhotoUrl, setMealPhotoUrl] = useState<string | null>(null);
  // URL en cours d'affichage en lightbox plein écran (null = fermé).
  // - persisted=false : photo en cours d'analyse (pas encore sauvée),
  //   pas de bouton supprimer.
  // - persisted=true : photo attachée à une entry en BDD, on affiche
  //   un bouton "Supprimer ce repas" qui supprime tout le batch.
  const [lightboxState, setLightboxState] = useState<
    | { url: string; persisted: boolean }
    | null
  >(null);
  // Confirmation inline custom (pas de window.confirm — règle d'app).
  const [confirmDeletePhoto, setConfirmDeletePhoto] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
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
  // Garde la dernière catégorie ouverte même quand on referme, pour
  // que le contenu du panel détail reste rendu pendant l'animation de
  // slide (sinon il "tremble" en disparaissant brusquement). Le panel
  // est masqué par translate-x-full, pas par démontage du DOM.
  const lastMealCategoryRef = useRef<MealCategory | null>(null);
  if (activeMealCategory) lastMealCategoryRef.current = activeMealCategory;
  const renderedMealCategory =
    activeMealCategory ?? lastMealCategoryRef.current;
  /**
   * Sélection d'accompagnements par bloc-item.
   * Map<itemIndex, Set<accompanimentIndex>>.
   * Les cases sont cumulatives : l'abonnée peut cocher 0, 1, 2 ou 3
   * accompagnements par aliment.
   */
  // Compteur d'accompagnements par bloc : on autorise plusieurs
  // unités du même accomp (ex: 3 sucres = 3 × 5g). Map<itemIdx, Map<accIdx, count>>.
  const [accSel, setAccSel] = useState<Map<number, Map<number, number>>>(new Map());
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
      // URL de la photo (peut être null si l'upload Storage a échoué).
      if (typeof data.photoUrl === 'string') {
        setMealPhotoUrl(data.photoUrl);
      }
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

  /** +1 sur le compteur d'un accompagnement. Click répété = +n. */
  function incrementAcc(itemIdx: number, accIdx: number) {
    setAccSel((prev) => {
      const next = new Map(prev);
      const counts = new Map(next.get(itemIdx) ?? []);
      counts.set(accIdx, (counts.get(accIdx) ?? 0) + 1);
      next.set(itemIdx, counts);
      return next;
    });
  }

  /** Décrément (-1) ; supprime l'entrée si tombe à 0. Pour le long-press
   *  ou un futur bouton "−" sur la vignette. */
  function decrementAcc(itemIdx: number, accIdx: number) {
    setAccSel((prev) => {
      const next = new Map(prev);
      const counts = new Map(next.get(itemIdx) ?? []);
      const cur = counts.get(accIdx) ?? 0;
      if (cur <= 1) counts.delete(accIdx);
      else counts.set(accIdx, cur - 1);
      next.set(itemIdx, counts);
      return next;
    });
  }

  /** Retire la card d'index `idx` du preview + réindexe les
   *  compteurs d'accompagnements pour rester alignés. */
  function removeFromPreview(idx: number) {
    if (!preview) return;
    const next = preview.filter((_, k) => k !== idx);
    setAccSel((prev) => {
      const out = new Map<number, Map<number, number>>();
      for (const [k, v] of prev) {
        if (k < idx) out.set(k, v);
        else if (k > idx) out.set(k - 1, v);
      }
      return out;
    });
    if (next.length === 0) {
      setPreview(null);
      setNaturalText('');
      setMealPhotoUrl(null);
      setActiveMealCategory(null);
      setMealCategory(defaultMealForHour());
    } else {
      setPreview(next);
    }
  }

  /** Annule un ingrédient sans le sauver (juste retire de la preview). */
  function handleCancelSingle(idx: number) {
    removeFromPreview(idx);
  }

  /** Valide UN seul ingrédient (+ ses accompagnements) et le retire
   *  du preview. Les autres restent pour être validés un par un. */
  async function handleConfirmSingle(idx: number) {
    if (!preview || logging) return;
    const p = preview[idx];
    if (!p) return;
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
      const counts = accSel.get(idx);
      if (counts && counts.size > 0 && p.possibleAccompaniments) {
        for (const [accIdx, qty] of counts) {
          const acc = p.possibleAccompaniments[accIdx];
          if (!acc || qty < 1) continue;
          entries.push({
            source: 'free',
            sourceRefId: null,
            label: acc.name,
            kcal: acc.kcalEstimate,
            proteinsG: null,
            lipidsG: null,
            carbsG: null,
            portions: qty,
          });
        }
      }

      if (entries.length === 0) {
        alertError('Aucun aliment avec kcal détecté');
        return;
      }
      const effectiveCategory: MealCategory = activeMealCategory ?? mealCategory;
      // On envoie photoUrl seulement la 1ère fois — au prochain
      // handleConfirmSingle on le passe à null pour ne pas créer 2
      // vignettes pour le même repas. Une fois saved côté API, on
      // remet mealPhotoUrl à null pour que la vignette du haut
      // disparaisse et soit remplacée par celle de l'entry.
      const photoUrlToSave = mealPhotoUrl;
      const res = await fetch('/api/nutrition/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries,
          mealCategory: effectiveCategory,
          photoUrl: photoUrlToSave,
        }),
      });
      if (res.ok) {
        if (photoUrlToSave) setMealPhotoUrl(null);
        removeFromPreview(idx);
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

  /** Modifie le total kcal d'une entrée du journal (sécurise portions=1
   *  côté API). Refresh local + propagation aux autres composants. */
  async function changeEntryKcal(id: string, kcal: number) {
    const prev = day;
    // Optimistic update : la sub-page totalise les entrées via leurs
    // kcal × portions. On set kcal = new + portions = 1.
    setDay((d) =>
      d
        ? {
            ...d,
            entries: d.entries.map((e) =>
              e.id === id ? { ...e, kcal, portions: 1 } : e,
            ),
          }
        : d,
    );
    const res = await fetch(`/api/nutrition/log/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kcal }),
    });
    if (!res.ok) {
      setDay(prev);
      const j = await res.json().catch(() => ({}));
      alertError(j?.error || 'Modification impossible');
    } else {
      await refresh();
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
      className="anim-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 print:hidden md:items-center md:justify-center md:p-4"
      // Désactive le pinch-to-zoom et autres gestes natifs sur la
      // sheet, autorise uniquement le scroll vertical.
      style={{ touchAction: 'pan-y' }}
    >
      <div className="anim-slide-up flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl md:h-[min(95vh,840px)] md:rounded-3xl">
        {/* === Header transparent sur fond hero ===
            Caché sur la sub-page (drill-down) : c'est le header de
            la sub-page (panel 2) qui prend le relais avec sa propre
            grosse flèche back et titre de catégorie. */}
        <header
          className={`flex shrink-0 items-center justify-between gap-2 bg-coral/95 px-4 py-4 text-white ${
            activeMealCategory ? 'hidden' : ''
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Flame className="size-6" />
            <h2 className="font-script text-3xl">Mes calories</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMyInfoOpen(true)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                day?.profileComplete
                  ? 'bg-white/90 text-coral-dark hover:bg-white'
                  : 'bg-coral-soft/40 text-white hover:bg-coral-soft/60'
              }`}
            >
              {day?.profileComplete && (
                <Check className="size-4" strokeWidth={3} />
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
          <section className="bg-gradient-to-b from-coral via-coral/90 to-coral/50 px-4 pt-10 pb-12 text-white">
            <div className="flex items-center justify-center gap-4">
              <CircularProgress
                value={Math.max(0, net)}
                max={target}
                size="12rem"
                strokeWidth="0.9rem"
                trackClassName="stroke-white/25"
                arcClassName={overshoot > 0 ? 'stroke-rose-200' : 'stroke-white'}
              >
                <span className="text-[0.7rem] font-semibold uppercase tracking-widest text-white/90">
                  Restant
                </span>
                <span className="font-bold leading-none" style={{ fontSize: '2.5rem' }}>
                  {Math.round(Math.max(0, remaining))}
                </span>
                <span className="text-[0.7rem] text-white/90">
                  / {target} kcal
                </span>
              </CircularProgress>

              {/* Card Dépensées côte à côte avec le cercle. Plus
                  grande en hauteur et polices plus visibles. Plus
                  d info "Consommé" (le cercle l indique deja). */}
              <div className="flex shrink-0 flex-col items-stretch justify-center rounded-2xl bg-white px-4 py-5 text-emerald-900 shadow-xl ring-2 ring-white/40" style={{ minHeight: '11rem' }}>
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
              </div>
            </div>
          </section>

          {/* === MACROS : fond fondu depuis le coral vers blanc ===
              Le gradient demarre en coral/30 pour faire la continuite
              avec la section hero, puis fond en blanc. Les tuiles
              sont decalees vers le haut pour mordre sur la fin du
              hero (effet flottant). */}
          <section className="bg-gradient-to-b from-coral/30 via-emerald-50/40 to-white px-4 pb-3 -mt-6">
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
                const dailyTarget = day?.target.dailyKcal ?? 0;
                const ratio = MEAL_KCAL_RATIO[cat];
                const mealTarget = Math.round(dailyTarget * ratio);
                return (
                  <MealTileApple
                    key={cat}
                    category={cat}
                    count={entries.length}
                    totalKcal={totalsForCat(cat)}
                    mealTargetKcal={mealTarget}
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

          {/* === SECTION "MES REPAS" : photos de la journée ===
              Carrousel horizontal des photos uniques attachées aux
              entries du jour. Tap = lightbox plein écran. */}
          {day && (
            <MyMealsSection
              entries={day.entries}
              onShowPhoto={(url) =>
                setLightboxState({ url, persisted: true })
              }
            />
          )}

          {/* === SECTION EAU : verres + slider objectif + barre ===
              Fond dégradé rose (continuité avec les tuiles repas) →
              bleu (signature eau). */}
          <section className="bg-gradient-to-b from-coral-soft/40 via-sky-100/50 to-blue-100/60 px-4 pb-5 pt-2">
            <WaterSection />
          </section>
          </div>

          {/* === PANEL 2 : MEAL DETAIL ===
              Affiche header (back + nom catégorie) + entries + invite
              + preview. Slide depuis la droite quand activeMealCategory
              est posé. */}
          <div
            className={`absolute inset-0 flex flex-col overflow-hidden bg-gradient-to-br from-coral-soft/30 via-pink-50/40 to-sky-100/60 transition-transform duration-300 ease-out ${
              activeMealCategory ? 'translate-x-0' : 'translate-x-full'
            }`}
            aria-hidden={!activeMealCategory}
          >
            {renderedMealCategory && (
              <>
                {/* Header sub-page : flèche back BIEN GROSSE +
                    titre catégorie BIEN GROS. Seul header visible. */}
                <div className="flex shrink-0 items-center gap-4 bg-coral/95 px-4 py-5 text-white">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMealCategory(null);
                      setNaturalText('');
                      setPreview(null);
                      setAccSel(new Map());
                    }}
                    aria-label="Retour"
                    className="grid size-12 shrink-0 place-items-center rounded-full bg-white/20 transition hover:bg-white/30 active:scale-95"
                  >
                    <ChevronLeftIcon size="size-7" />
                  </button>
                  <h2 className="font-script text-4xl">
                    {MEAL_LABELS[renderedMealCategory]}
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
                  {/* "Ajouter un plat" tout en HAUT (avant la liste
                      des plats déjà saisis). Décision UX : la sub-page
                      commence par l'action principale. */}
                  <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-coral-soft/30">
                    <p className="mb-2 text-base font-bold text-ink">
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

                  {/* Vignette de la photo analysée — alignée à GAUCHE
                      avec petit texte de description à côté. Clic =
                      lightbox plein écran. Croix rouge = supprime. */}
                  {mealPhotoUrl && (
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            mealPhotoUrl &&
                            setLightboxState({ url: mealPhotoUrl, persisted: false })
                          }
                          aria-label="Voir la photo en grand"
                          className="block overflow-hidden rounded-2xl shadow-md ring-1 ring-coral-soft/40 transition hover:scale-[1.02] active:scale-95"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={mealPhotoUrl}
                            alt="Photo du plat analysé"
                            className="h-20 w-20 object-cover"
                            draggable={false}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => setMealPhotoUrl(null)}
                          aria-label="Retirer la photo"
                          className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full bg-rose-500 text-white shadow ring-2 ring-white transition hover:scale-110 active:scale-95"
                        >
                          <X className="size-3" strokeWidth={3} />
                        </button>
                      </div>
                      <p className="line-clamp-4 min-w-0 flex-1 text-xs italic leading-snug text-ink-soft">
                        {naturalText || 'Analyse en cours…'}
                      </p>
                    </div>
                  )}

                  {/* Preview du parse Mistral — plus de wrapper blanc
                      autour, les cards portent leur propre frame. Les
                      FABs Valider/Fermer sont DANS la première card. */}
                  {preview && preview.length > 0 && (
                    <ul className="space-y-2.5">
              {preview.map((p, i) => {
                // Filtre les accompagnements qui seraient redondants
                // avec un autre aliment déjà présent dans le preview.
                // Ex: "café avec sucre" → 2 cards (café + sucre) ; on
                // retire "sucre" des accompagnements proposés du café.
                const otherNames = new Set(
                  preview
                    .filter((_, k) => k !== i)
                    .map((o) =>
                      normalizeForAccompMatch(
                        o.foodKeyword ?? o.label ?? '',
                      ),
                    )
                    .filter(Boolean),
                );
                const filteredAccomp = p.possibleAccompaniments?.filter(
                  (acc) =>
                    !otherNames.has(normalizeForAccompMatch(acc.name)),
                );
                const itemForCard: typeof p = {
                  ...p,
                  possibleAccompaniments: filteredAccomp,
                };
                return (
                <IngredientCardCarousel
                  key={i}
                  item={itemForCard}
                  showCalories={showCalories}
                  onConfirmAll={() => handleConfirmSingle(i)}
                  onCancelAll={() => handleCancelSingle(i)}
                  confirming={logging}
                  accQuantities={accSel.get(i) ?? new Map()}
                  onIncrementAcc={(accIdx) => incrementAcc(i, accIdx)}
                  onDecrementAcc={(accIdx) => decrementAcc(i, accIdx)}
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
                      const out = new Map<number, Map<number, number>>();
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
                );
              })}
            </ul>
                  )}

                  {/* Plats déjà saisis pour cette catégorie — en BAS
                      de la sub-page : on arrive sur la zone d'action,
                      le contexte (ce qu'on a déjà mangé) reste sous. */}
                  {entriesByCat[renderedMealCategory].length > 0 && (
                    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-coral-soft/30">
                      <h4 className="border-b border-coral-soft/20 px-4 py-2 text-[0.7rem] font-bold uppercase tracking-wider text-coral-dark">
                        Déjà ajouté ({Math.round(totalsForCat(renderedMealCategory))} kcal)
                      </h4>
                      <ul className="space-y-1.5 px-4 py-2.5">
                        {entriesByCat[renderedMealCategory].map((e) => (
                          <EntryRow
                            key={e.id}
                            entry={e}
                            onDelete={() => handleDelete(e.id)}
                            onChangeCategory={(next) => changeEntryCategory(e.id, next)}
                            onChangeKcal={(kcal) => changeEntryKcal(e.id, kcal)}
                            onShowPhoto={(url) =>
                              setLightboxState({ url, persisted: true })
                            }
                          />
                        ))}
                      </ul>
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

      {/* Lightbox photo plein écran — utilisable depuis la vignette
          en haut (persisted=false) ET depuis Mes repas / Déjà ajouté
          (persisted=true → bouton "Supprimer ce repas"). */}
      {lightboxState && (
        <div
          role="dialog"
          aria-modal="true"
          className="anim-fade-quick fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4"
          onClick={() => {
            setLightboxState(null);
            setConfirmDeletePhoto(false);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxState.url}
            alt="Photo du plat"
            className="max-h-[80vh] max-w-[95vw] rounded-2xl object-contain shadow-2xl"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => {
              setLightboxState(null);
              setConfirmDeletePhoto(false);
            }}
            aria-label="Fermer"
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/90 text-ink shadow-lg hover:bg-white"
          >
            <X className="size-5" strokeWidth={3} />
          </button>

          {/* Bouton "Supprimer ce repas" — visible uniquement quand
              la photo est persisted (= un batch en BDD). */}
          {lightboxState.persisted && (
            <div
              className="absolute inset-x-4 bottom-6 flex justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              {!confirmDeletePhoto ? (
                <button
                  type="button"
                  onClick={() => setConfirmDeletePhoto(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg ring-2 ring-white/40 transition hover:bg-rose-600 active:scale-95"
                >
                  <Trash2 className="size-4" />
                  Supprimer ce repas
                </button>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/95 px-5 py-3 shadow-xl">
                  <p className="text-sm font-semibold text-ink">
                    Supprimer ce repas et tous ses aliments ?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDeletePhoto(false)}
                      disabled={deletingPhoto}
                      className="rounded-full border border-coral-soft px-4 py-1.5 text-xs font-semibold text-coral disabled:opacity-50"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!lightboxState || deletingPhoto) return;
                        setDeletingPhoto(true);
                        try {
                          const res = await fetch(
                            '/api/nutrition/log/by-photo',
                            {
                              method: 'DELETE',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                photoUrl: lightboxState.url,
                              }),
                            },
                          );
                          if (res.ok) {
                            await refresh();
                            onChanged();
                            window.dispatchEvent(
                              new CustomEvent('nutrition-log-updated'),
                            );
                            setLightboxState(null);
                            setConfirmDeletePhoto(false);
                          } else {
                            const j = await res.json().catch(() => ({}));
                            alertError(j?.error || 'Suppression impossible');
                          }
                        } finally {
                          setDeletingPhoto(false);
                        }
                      }}
                      disabled={deletingPhoto}
                      className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50"
                    >
                      {deletingPhoto && (
                        <Loader2 className="size-3 animate-spin" />
                      )}
                      Oui, supprimer
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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

/** Flèche gauche réutilisée pour le bouton "Retour" du drill-down. */
function ChevronLeftIcon({ size = 'size-5' }: { size?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={size}
      aria-hidden
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

/**
 * Section "Mes repas" — carrousel horizontal des photos uniques
 * attachées aux entries de la journée. Tap = lightbox plein écran.
 *
 * Une photo n'apparait qu'UNE fois même si plusieurs entries du
 * même batch la partagent (déduplication par URL).
 *
 * Affiche le badge de la catégorie + l'heure de prise.
 * Cachée si aucune photo dans le jour.
 */
function MyMealsSection({
  entries,
  onShowPhoto,
}: {
  entries: FoodLogEntry[];
  onShowPhoto: (url: string) => void;
}) {
  // Déduplique sur photoUrl pour ne pas afficher 3 fois la même photo
  // si elle a été attachée à 3 entries (cas: même batch).
  const seen = new Set<string>();
  const photoEntries: Array<{ url: string; cat: MealCategory | null; loggedAt: string }> = [];
  for (const e of entries) {
    if (!e.photoUrl || seen.has(e.photoUrl)) continue;
    seen.add(e.photoUrl);
    photoEntries.push({
      url: e.photoUrl,
      cat: categoryOf(e),
      loggedAt: e.loggedAt,
    });
  }

  if (photoEntries.length === 0) return null;

  return (
    <section className="bg-gradient-to-b from-white to-coral-soft/20 px-4 pb-3 pt-3">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-coral-dark">
        Mes repas
      </h3>
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        style={{
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {photoEntries.map((p, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onShowPhoto(p.url)}
            aria-label={`Voir photo ${MEAL_LABELS[p.cat ?? 'breakfast']}`}
            className="relative shrink-0 overflow-hidden rounded-2xl shadow-md ring-1 ring-coral-soft/40 transition hover:scale-[1.02] active:scale-95"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url}
              alt=""
              aria-hidden
              draggable={false}
              className="h-24 w-24 object-cover"
            />
            {/* Bandeau catégorie + heure en surimpression bas */}
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-[0.55rem] font-semibold text-white">
              <span>{p.cat ? MEAL_LABELS[p.cat] : '—'}</span>
              <span>
                {new Date(p.loggedAt).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
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
  mealTargetKcal,
  onClick,
}: {
  category: MealCategory;
  count: number;
  totalKcal: number;
  /** Objectif kcal calculé pour ce repas (ex: petit dej = 20% du
   *  daily target). 0 ou null si profil incomplet. */
  mealTargetKcal: number;
  onClick: () => void;
}) {
  const pct =
    mealTargetKcal > 0
      ? Math.min(100, Math.round((totalKcal / mealTargetKcal) * 100))
      : 0;
  // Overshoot : on garde la barre rouge si on dépasse la cible
  const overshoot = mealTargetKcal > 0 && totalKcal > mealTargetKcal;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex min-h-[8.5rem] flex-col items-start justify-end gap-1 overflow-hidden rounded-2xl bg-white p-4 pb-3 text-left shadow-sm ring-1 ring-coral-soft/30 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95"
    >
      {/* Icône en haut à droite, grande, transparente sans fond. */}
      <span className="absolute right-2 top-2">
        <MealCategoryAvatar
          category={category}
          wrapperSize="size-20"
          lucideSize="size-10"
        />
      </span>
      <span className="mt-auto text-lg font-bold text-ink">
        {MEAL_LABELS[category]}
      </span>
      <span className="whitespace-nowrap text-xs font-medium text-ink-soft">
        {count === 0
          ? `0 / ${mealTargetKcal} kcal`
          : `${Math.round(totalKcal)} / ${mealTargetKcal} kcal · ${count} ${
              count > 1 ? 'plats' : 'plat'
            }`}
      </span>
      {/* Barre de progression par repas (objectif = % du daily target).
          Gradient vert pâle → jaune → coral → rose qui se révèle au
          fur et à mesure du remplissage. Le backgroundSize en %
          inverse de pct fait que le gradient garde sa position
          absolue dans la barre : à 30% rempli on voit la partie
          verte, à 100% le rose. */}
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink-soft/15">
        <div
          className="h-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            // Décompose en propriétés non-shorthand pour éviter le
            // warning React "mixing shorthand background and
            // backgroundPosition/Size/Repeat".
            backgroundColor: overshoot ? '#e11d48' : 'transparent',
            backgroundImage: overshoot
              ? 'none'
              : 'linear-gradient(to right, #86efac 0%, #fde68a 40%, #f9a8d4 75%, #ec4899 100%)',
            backgroundSize: pct > 0 ? `${10000 / pct}% 100%` : '100% 100%',
            backgroundPosition: 'left center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      </div>
      {/* + en HAUT À GAUCHE — affordance "ajouter" toujours visible
          avec une petite marge confortable. */}
      <span
        aria-hidden
        className="absolute left-2 top-2 grid size-9 place-items-center rounded-full bg-coral text-white shadow"
      >
        <Plus className="size-4" />
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
  multiline = false,
}: {
  naturalText: string;
  onTextChange: (v: string) => void;
  parsing: boolean;
  photoUploading: boolean;
  onPhoto: (file: File) => void;
  onParse: () => void;
  /** Si true, rend un <textarea> 2 lignes au lieu d'un <input> 1 ligne.
   *  Utilisé sur la sub-page V2 pour pouvoir saisir plus confortablement
   *  une description longue type "pâtes carbonara avec parmesan". */
  multiline?: boolean;
}) {
  const SharedTextareaProps = {
    value: naturalText,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onTextChange(e.target.value),
    onKeyDown: (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      // Sur l'input simple : Enter = lance.
      // Sur le textarea : Cmd/Ctrl+Enter = lance (Enter seul = saut de ligne).
      const isModEnter =
        e.key === 'Enter' && (e.metaKey || e.ctrlKey);
      if (!multiline && e.key === 'Enter') {
        e.preventDefault();
        onParse();
      } else if (multiline && isModEnter) {
        e.preventDefault();
        onParse();
      }
    },
    maxLength: 500,
    autoFocus: true,
    placeholder: 'ex. un yaourt nature et une pomme',
  };
  return (
    <div className={multiline ? 'space-y-2' : 'flex gap-2'}>
      {multiline ? (
        <textarea
          {...SharedTextareaProps}
          rows={2}
          className="w-full resize-none rounded-lg border border-coral-soft px-3 py-2 text-sm leading-relaxed"
        />
      ) : (
        <input
          type="text"
          {...SharedTextareaProps}
          className="flex-1 rounded-lg border border-coral-soft px-2 py-1.5 text-sm"
        />
      )}
      <div className={multiline ? 'flex justify-end gap-2' : 'contents'}>
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
 * Répartition standard des apports caloriques par repas (en %
 * du total journalier). Convention Karine 2026-06-05 — sert à
 * calculer la cible kcal et la barre de progression de chaque
 * tuile repas. Total = 90% (10% pour collation libre / boissons).
 */
const MEAL_KCAL_RATIO: Record<MealCategory, number> = {
  breakfast: 0.20,
  lunch: 0.30,
  snack: 0.10,
  dinner: 0.30,
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

// Options pour le drum picker kcal d'une entrée déjà sauvegardée.
// Couvre l'essentiel des cas (snack ~50, plat principal ~500-800,
// repas copieux ~1000+). Pas de 25 jusqu'à 1000.
const ENTRY_KCAL_OPTIONS = (() => {
  const arr: number[] = [];
  for (let v = 25; v <= 1000; v += 25) arr.push(v);
  for (let v = 1100; v <= 2000; v += 100) arr.push(v);
  return arr;
})();

function EntryRow({
  entry,
  onDelete,
  onChangeCategory,
  onChangeKcal,
  onShowPhoto,
}: {
  entry: FoodLogEntry;
  onDelete: () => void;
  onChangeCategory: (next: MealCategory) => void;
  /** Si fourni, les kcal deviennent cliquables et ouvrent un drum
   *  picker pour modifier. Sinon affichage en texte simple. */
  onChangeKcal?: (kcal: number) => void;
  /** Si fourni ET entry.photoUrl existe, affiche une mini-vignette
   *  cliquable à droite. Le parent gère le lightbox. */
  onShowPhoto?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kcalPickerOpen, setKcalPickerOpen] = useState(false);
  const cat = categoryOf(entry);
  const wrapperRef = useRef<HTMLLIElement>(null);
  const currentKcal = Math.round(entry.kcal * entry.portions);

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
        {onChangeKcal ? (
          <button
            type="button"
            onClick={() => setKcalPickerOpen(true)}
            className="text-left text-xs font-semibold text-coral-dark underline decoration-coral-soft underline-offset-2 hover:decoration-coral"
            aria-label="Modifier les kcal"
          >
            {currentKcal} kcal
            {entry.portions !== 1 && (
              <span className="font-normal text-ink-soft">
                {' '}
                ({entry.portions} portions)
              </span>
            )}
          </button>
        ) : (
          <p className="text-xs text-ink-soft">
            {currentKcal} kcal
            {entry.portions !== 1 && ` (${entry.portions} portions)`}
          </p>
        )}
      </div>
      {entry.photoUrl && onShowPhoto && (
        <button
          type="button"
          onClick={() => onShowPhoto(entry.photoUrl as string)}
          aria-label="Voir la photo du repas"
          className="block overflow-hidden rounded-lg shadow-sm ring-1 ring-coral-soft/40 transition hover:scale-105 active:scale-95"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={entry.photoUrl}
            alt=""
            aria-hidden
            draggable={false}
            className="h-10 w-10 object-cover"
          />
        </button>
      )}
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

      {kcalPickerOpen && onChangeKcal && (
        <DrumPicker
          title="Combien de kcal ?"
          options={ENTRY_KCAL_OPTIONS}
          current={currentKcal}
          formatLabel={(n) => `${n} kcal`}
          accent="coral"
          onClose={() => setKcalPickerOpen(false)}
          onPick={(n) => {
            onChangeKcal(n);
            setKcalPickerOpen(false);
          }}
        />
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
          // Si value === 0, on prefere demarrer avec un draft vide
          // pour ne pas avoir le "0" en prefixe quand on tape.
          setDraft(value === 0 ? '' : String(value));
          setEditing(true);
        }}
        className="flex flex-col items-center gap-1 text-center"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
          Dépensées
        </span>
        <span className="text-3xl font-extrabold leading-none text-emerald-600">
          {value > 0 ? `−${value}` : '0'}
        </span>
        <span className="text-xs font-semibold text-ink-soft">kcal</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
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
        onFocus={(e) => e.currentTarget.select()}
        autoFocus
        placeholder="0"
        className="w-24 rounded-lg border-2 border-emerald-300 px-2 py-1.5 text-center text-2xl font-extrabold text-emerald-600 outline-none focus:border-emerald-500"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        aria-label="Enregistrer"
        className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        <Check className="size-3" strokeWidth={3} />
        OK
      </button>
    </div>
  );
}

