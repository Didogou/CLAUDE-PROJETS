'use client';

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { RecipeIngredient, RecipeSheet } from '@/data/recipes';
import { IngredientsChecklist } from './IngredientsChecklist';
import {
  isGlutenFreeAuto,
  isPorkFreeAuto,
  isVegetarianAuto,
} from '@/lib/dietary-tags';
import { compressImage } from '@/lib/compress-image';

type PreviewData = {
  tempPath: string;
  imageUrl: string;
  title: string | null;
  servings: number | null;
  calories: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  aliments: string[];
  ingredients: RecipeIngredient[];
  isVegetarianOverride?: boolean | null;
  isGlutenFreeOverride?: boolean | null;
  isPorkFreeOverride?: boolean | null;
};

type Props = {
  recipeSlug: string;
  initialSheets: RecipeSheet[];
};

/**
 * Éditeur des fiches détaillées d'une recette.
 *
 *  - Affiche les sheets existantes (carte par sheet, repliable)
 *  - Bouton "+ Ajouter une fiche détaillée" → preview Vision Haiku
 *    → édition tabulaire → save
 *  - Édition d'une sheet existante : PATCH avec patch partiel
 *  - Suppression d'une sheet : DELETE
 */
export function RecipeSheetsEditor({ recipeSlug, initialSheets }: Props) {
  const [sheets, setSheets] = useState(initialSheets);
  const [addingPreview, setAddingPreview] = useState<PreviewData | null>(null);
  const [busy, setBusy] = useState<
    'idle' | 'extracting' | 'saving' | 'patching' | 'deleting'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleAddFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy('extracting');
    try {
      // Compression client AVANT upload (règle projet).
      const compressed = await compressImage(file, {
        maxDim: 1600,
        quality: 0.85,
        skipBelowKB: 400,
      });
      const fd = new FormData();
      fd.set('file', compressed);
      const res = await fetch(
        `/api/admin/recipes/${recipeSlug}/sheets/preview`,
        { method: 'POST', body: fd },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec analyse');
      setAddingPreview({
        tempPath: j.tempPath,
        imageUrl: j.imageUrl,
        title: j.title,
        servings: j.servings,
        calories: j.calories,
        prepTimeMin: j.prepTimeMin,
        cookTimeMin: j.cookTimeMin,
        tags: j.tags ?? [],
        aliments: j.aliments ?? [],
        ingredients: j.ingredients ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy('idle');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function savePreview() {
    if (!addingPreview) return;
    setError(null);
    setBusy('saving');
    try {
      const res = await fetch(`/api/admin/recipes/${recipeSlug}/sheets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tempPath: addingPreview.tempPath,
          title: addingPreview.title,
          servings: addingPreview.servings ?? 4,
          calories: addingPreview.calories,
          prepTimeMin: addingPreview.prepTimeMin,
          cookTimeMin: addingPreview.cookTimeMin,
          tags: addingPreview.tags,
          aliments: addingPreview.aliments,
          ingredients: addingPreview.ingredients,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur save');
      const sheet = j.sheet;
      setSheets((prev) =>
        [
          ...prev,
          {
            id: String(sheet.id),
            sheetIndex: Number(sheet.sheet_index),
            title: sheet.title,
            coverImageUrl: sheet.cover_image_url,
            servings: sheet.servings,
            calories: sheet.calories,
            proteinsG:
              sheet.proteins_g === null || sheet.proteins_g === undefined
                ? null
                : Number(sheet.proteins_g),
            lipidsG:
              sheet.lipids_g === null || sheet.lipids_g === undefined
                ? null
                : Number(sheet.lipids_g),
            carbsG:
              sheet.carbs_g === null || sheet.carbs_g === undefined
                ? null
                : Number(sheet.carbs_g),
            prepTimeMin: sheet.prep_time_min,
            cookTimeMin: sheet.cook_time_min,
            tags: sheet.tags ?? [],
            aliments: sheet.aliments ?? [],
            ingredients: sheet.ingredients ?? [],
            ingredientsText: sheet.ingredients_text,
            likesCount: typeof sheet.likes_count === 'number' ? sheet.likes_count : 0,
            nutriscoreGrade: sheet.nutriscore_grade ?? null,
            nutriscoreConfidence:
              typeof sheet.nutriscore_confidence === 'number'
                ? sheet.nutriscore_confidence
                : null,
            isVegetarianOverride:
              typeof sheet.is_vegetarian_override === 'boolean'
                ? sheet.is_vegetarian_override
                : null,
            isGlutenFreeOverride:
              typeof sheet.is_gluten_free_override === 'boolean'
                ? sheet.is_gluten_free_override
                : null,
            isPorkFreeOverride:
              typeof sheet.is_pork_free_override === 'boolean'
                ? sheet.is_pork_free_override
                : null,
            // Stub : dietary effectif sera recalculé au reload depuis
            // le server (côté admin on n'affiche pas les tags ici).
            dietary: {
              isVegetarian: false,
              isGlutenFree: false,
              isPorkFree: false,
            },
          },
        ].sort((a, b) => a.sheetIndex - b.sheetIndex),
      );
      setAddingPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy('idle');
    }
  }

  async function patchSheet(id: string, patch: Partial<RecipeSheet>) {
    setError(null);
    setBusy('patching');
    try {
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.servings !== undefined) body.servings = patch.servings;
      if (patch.calories !== undefined) body.calories = patch.calories;
      if (patch.prepTimeMin !== undefined) body.prepTimeMin = patch.prepTimeMin;
      if (patch.cookTimeMin !== undefined) body.cookTimeMin = patch.cookTimeMin;
      if (patch.tags !== undefined) body.tags = patch.tags;
      if (patch.aliments !== undefined) body.aliments = patch.aliments;
      if (patch.ingredients !== undefined) body.ingredients = patch.ingredients;
      if (patch.isVegetarianOverride !== undefined)
        body.isVegetarianOverride = patch.isVegetarianOverride;
      if (patch.isGlutenFreeOverride !== undefined)
        body.isGlutenFreeOverride = patch.isGlutenFreeOverride;
      if (patch.isPorkFreeOverride !== undefined)
        body.isPorkFreeOverride = patch.isPorkFreeOverride;
      const res = await fetch(
        `/api/admin/recipes/${recipeSlug}/sheets/${id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur update');
      setSheets((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy('idle');
    }
  }

  async function deleteSheet(id: string) {
    setError(null);
    setBusy('deleting');
    try {
      const res = await fetch(
        `/api/admin/recipes/${recipeSlug}/sheets/${id}`,
        { method: 'DELETE' },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur delete');
      setSheets((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy('idle');
    }
  }

  return (
    <section className="rounded-2xl border border-admin-border bg-admin-surface/40 p-4">
      <header className="mb-4">
        <h3 className="font-script text-2xl text-admin-primary-dark">
          📋 Fiches détaillées
        </h3>
        <p className="mt-1 text-xs text-admin-ink-soft">
          Chaque fiche est une recette à part entière. Upload une image de
          fiche, Claude Vision Haiku 4.5 extrait tout (titre, calories,
          temps, ingrédients, tags). Tu corriges, tu enregistres.
        </p>
      </header>

      {error && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Sheets existantes */}
      {sheets.length > 0 && (
        <div className="space-y-3">
          {sheets.map((sheet, idx) => (
            <SheetCard
              key={sheet.id}
              sheet={sheet}
              index={idx}
              busy={busy !== 'idle'}
              onPatch={(p) => patchSheet(sheet.id, p)}
              onDelete={() => deleteSheet(sheet.id)}
            />
          ))}
        </div>
      )}

      {/* Preview de l'ajout en cours */}
      {addingPreview && (
        <div className="mt-3 rounded-xl border-2 border-admin-primary/40 bg-white p-3">
          <p className="mb-2 text-sm font-bold text-admin-primary-dark">
            Nouvelle fiche — vérifie les valeurs extraites puis enregistre.
          </p>
          <SheetEditableForm
            data={addingPreview}
            onChange={(p) => setAddingPreview({ ...addingPreview, ...p })}
            onCancel={() => setAddingPreview(null)}
            onSave={savePreview}
            busy={busy === 'saving'}
          />
        </div>
      )}

      {/* Bouton + ajouter */}
      {!addingPreview && (
        <label
          className={`mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-admin-border bg-admin-surface px-4 py-4 text-sm font-bold transition hover:bg-admin-soft/30 ${
            busy === 'extracting' ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          {busy === 'extracting' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Vision Haiku analyse l&apos;image…
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Ajouter une fiche détaillée
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAddFile}
            disabled={busy !== 'idle'}
            className="hidden"
          />
        </label>
      )}

      {sheets.length === 0 && !addingPreview && busy !== 'extracting' && (
        <p className="mt-3 rounded-lg bg-admin-soft/40 px-3 py-2 text-xs italic text-admin-ink-soft">
          Aucune fiche détaillée pour cette recette. Ajoute-en au moins une
          pour que les utilisatrices puissent voir les ingrédients et
          ajouter à leur liste de courses.
        </p>
      )}
    </section>
  );
}

function SheetCard({
  sheet,
  index,
  busy,
  onPatch,
  onDelete,
}: {
  sheet: RecipeSheet;
  index: number;
  busy: boolean;
  onPatch: (patch: Partial<RecipeSheet>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-admin-border bg-white">
      <header
        className="flex cursor-pointer items-center justify-between gap-3 p-3"
        onClick={() => setOpen((v) => !v)}
      >
        <div
          className="h-14 w-14 shrink-0 rounded-lg bg-admin-soft/50 bg-cover bg-center"
          style={{ backgroundImage: `url(${sheet.coverImageUrl})` }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-admin-ink">
            #{index + 1} · {sheet.title || 'Sans titre'}
          </p>
          <p className="truncate text-[0.7rem] text-admin-ink-soft">
            {sheet.servings} pers · {sheet.ingredients.length} ingrédients
            {sheet.calories ? ` · ${sheet.calories} kcal` : ''}
          </p>
        </div>
        {/* Badge Nutri-Score par SHEET : calcule au save admin Nutri-Score
            puis persiste sur recipe_sheets.nutriscore_grade. Affiche "?" si
            pas encore calcule (confiance < 50% ou aucun ingredient matche
            Ciqual). Cliquer pour aller dans /admin/recettes/nutriscore avec
            cette sheet pre-selectionnee = nice-to-have a faire ulterieurement. */}
        <SheetGradeBadge
          grade={sheet.nutriscoreGrade}
          confidence={sheet.nutriscoreConfidence}
        />
        {open ? (
          <ChevronUp className="h-4 w-4 text-admin-ink-soft" />
        ) : (
          <ChevronDown className="h-4 w-4 text-admin-ink-soft" />
        )}
      </header>
      {open && (
        <div className="border-t border-admin-border p-3">
          <SheetEditableForm
            data={{
              tempPath: '',
              imageUrl: sheet.coverImageUrl,
              title: sheet.title,
              servings: sheet.servings,
              calories: sheet.calories,
              prepTimeMin: sheet.prepTimeMin,
              cookTimeMin: sheet.cookTimeMin,
              tags: sheet.tags,
              aliments: sheet.aliments,
              ingredients: sheet.ingredients,
            }}
            onChange={(p) => onPatch(p as Partial<RecipeSheet>)}
            busy={busy}
            hideSave
          />
          <div className="mt-3 flex justify-end">
            {confirmDelete ? (
              <div className="flex items-center gap-2 rounded-full bg-red-50 p-1 pl-3">
                <span className="text-xs font-semibold text-red-700">Supprimer cette fiche ?</span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-admin-ink-soft"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    onDelete();
                  }}
                  disabled={busy}
                  className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm"
                >
                  Confirmer
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="flex items-center gap-1 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" /> Supprimer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SheetEditableForm({
  data,
  onChange,
  onCancel,
  onSave,
  busy,
  hideSave,
}: {
  data: PreviewData;
  onChange: (patch: Partial<PreviewData>) => void;
  onCancel?: () => void;
  onSave?: () => void;
  busy: boolean;
  hideSave?: boolean;
}) {
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of data.ingredients) {
      if (!seen.has(it.category)) {
        seen.add(it.category);
        out.push(it.category);
      }
    }
    return out;
  }, [data.ingredients]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div
          className="aspect-square w-full rounded-lg bg-admin-soft/40 bg-cover bg-center"
          style={data.imageUrl ? { backgroundImage: `url(${data.imageUrl})` } : undefined}
        >
          {!data.imageUrl && (
            <div className="grid h-full place-items-center text-admin-ink-soft">
              <Upload className="h-6 w-6" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <input
            type="text"
            value={data.title ?? ''}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Titre de la variante"
            className="input h-9 text-sm"
          />
          <div className="grid gap-2 grid-cols-4">
            <Stat
              label="Pers"
              value={data.servings}
              onChange={(v) => onChange({ servings: v })}
            />
            <Stat
              label="kcal"
              value={data.calories}
              onChange={(v) => onChange({ calories: v })}
            />
            <Stat
              label="Prep"
              value={data.prepTimeMin}
              onChange={(v) => onChange({ prepTimeMin: v })}
              suffix="min"
            />
            <Stat
              label="Cuis"
              value={data.cookTimeMin}
              onChange={(v) => onChange({ cookTimeMin: v })}
              suffix="min"
            />
          </div>
          <CsvField
            label="Tags"
            values={data.tags}
            onChange={(v) => onChange({ tags: v })}
          />
          <CsvField
            label="Aliments"
            values={data.aliments}
            onChange={(v) => onChange({ aliments: v })}
          />
          {/* Overrides admin tags diététiques (Auto / Forcé oui / Forcé non).
              Auto = détection automatique depuis la liste des ingrédients
              (lib/dietary-tags.ts). Karine peut forcer si l'auto se trompe. */}
          <DietaryToggle
            label="Végétarien"
            ingredientList={data.ingredients}
            kind="vegetarian"
            value={data.isVegetarianOverride}
            onChange={(v) => onChange({ isVegetarianOverride: v })}
          />
          <DietaryToggle
            label="Sans gluten"
            ingredientList={data.ingredients}
            kind="glutenFree"
            value={data.isGlutenFreeOverride}
            onChange={(v) => onChange({ isGlutenFreeOverride: v })}
          />
          <DietaryToggle
            label="Sans porc"
            ingredientList={data.ingredients}
            kind="porkFree"
            value={data.isPorkFreeOverride}
            onChange={(v) => onChange({ isPorkFreeOverride: v })}
          />
        </div>
      </div>

      {/* Ingrédients : liste style "à cocher" groupée par catégorie */}
      <IngredientsChecklist
        ingredients={data.ingredients}
        onChange={(next) => onChange({ ingredients: next })}
      />

      {!hideSave && (
        <div className="flex items-center justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-full border border-admin-border bg-white px-4 py-2 text-xs font-semibold text-admin-ink"
            >
              Annuler
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="flex items-center gap-2 rounded-full bg-admin-primary px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Enregistrer la fiche
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[0.6rem] font-semibold uppercase tracking-wider text-admin-ink-soft">
        {label}
        {suffix && ` (${suffix})`}
      </span>
      <input
        type="number"
        min="0"
        value={value ?? ''}
        onChange={(e) =>
          onChange(e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0))
        }
        className="input h-8 w-full px-1.5 text-center text-sm"
      />
    </label>
  );
}

function CsvField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[0.6rem] font-semibold uppercase tracking-wider text-admin-ink-soft">
        {label} (séparés par des virgules)
      </span>
      <input
        type="text"
        value={values.join(', ')}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        className="input h-8 w-full px-2 text-xs"
      />
    </label>
  );
}

// IngredientsChecklist + IngredientChecklistRow ont été extraits dans
// le fichier dédié IngredientsChecklist.tsx pour partage avec
// RecipeFormUnified.

/**
 * Mini-badge Nutri-Score affiche dans le header de chaque SheetCard.
 * Reprend les couleurs officielles Sante publique France 2024.
 * "?" quand la sheet n'a pas encore de grade calcule (confiance trop
 * basse ou ingredients pas encore lies a Ciqual). Couleurs en hex
 * direct (pas de Tailwind dynamique inline-safe).
 */
function SheetGradeBadge({
  grade,
  confidence,
}: {
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null | undefined;
  confidence: number | null;
}) {
  if (!grade || (confidence ?? 0) < 0.5) {
    return (
      <span
        title="Score non calcule (confiance trop basse ou ingredients pas encore lies a Ciqual)"
        className="grid h-7 w-7 shrink-0 place-items-center rounded bg-gray-200 text-xs font-bold text-gray-500"
      >
        ?
      </span>
    );
  }
  const colors: Record<'A' | 'B' | 'C' | 'D' | 'E', string> = {
    A: '#038141',
    B: '#85bb2f',
    C: '#fecb02',
    D: '#ee8100',
    E: '#e63e11',
  };
  return (
    <span
      title={`Nutri-Score ${grade} (confiance ${Math.round((confidence ?? 0) * 100)}%)`}
      className="grid h-7 w-7 shrink-0 place-items-center rounded text-xs font-extrabold text-white"
      style={{ backgroundColor: colors[grade] }}
    >
      {grade}
    </span>
  );
}

/**
 * Toggle 3-states pour les tags diététiques (végétarien / sans gluten).
 *
 *  - Auto (null)  : utilise l'auto-détection depuis les ingrédients
 *  - Forcé oui    : le tag est affiché côté abonnée même si auto dit non
 *  - Forcé non    : le tag est masqué côté abonnée même si auto dit oui
 *
 * Affiche aussi le résultat AUTO en grisé pour que Karine voie ce que
 * l'heuristique propose avant de décider d'override ou pas.
 */
function DietaryToggle({
  label,
  ingredientList,
  kind,
  value,
  onChange,
}: {
  label: string;
  ingredientList: RecipeIngredient[];
  kind: 'vegetarian' | 'glutenFree' | 'porkFree';
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
}) {
  const normalized: boolean | null = value === undefined ? null : value;
  const autoResult =
    kind === 'vegetarian'
      ? isVegetarianAuto(ingredientList)
      : kind === 'glutenFree'
        ? isGlutenFreeAuto(ingredientList)
        : isPorkFreeAuto(ingredientList);
  const effective = normalized === null ? autoResult : normalized;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-admin-soft/40 px-2.5 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="text-xs font-bold text-admin-ink">{label}</span>
        <span
          className={`text-[0.6rem] font-semibold uppercase tracking-wider ${
            effective ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          {effective ? 'OUI' : 'non'}
        </span>
        <span
          className="text-[0.55rem] italic text-admin-ink-soft"
          title="Résultat de l'auto-détection sur les ingrédients"
        >
          (auto : {autoResult ? 'oui' : 'non'})
        </span>
      </div>
      <div className="flex gap-0.5 rounded-full bg-white p-0.5 ring-1 ring-admin-border">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider transition ${
            normalized === null
              ? 'bg-admin-primary text-white'
              : 'text-admin-ink-soft hover:bg-admin-soft'
          }`}
          title="Utiliser l'auto-détection"
        >
          Auto
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider transition ${
            normalized === true
              ? 'bg-emerald-600 text-white'
              : 'text-admin-ink-soft hover:bg-admin-soft'
          }`}
          title="Forcer le tag à OUI"
        >
          Oui
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider transition ${
            normalized === false
              ? 'bg-rose-600 text-white'
              : 'text-admin-ink-soft hover:bg-admin-soft'
          }`}
          title="Forcer le tag à non"
        >
          Non
        </button>
      </div>
    </div>
  );
}
