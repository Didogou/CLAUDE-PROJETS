'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { MenuMealSheet, MealKind, ShoppingListItem } from '@/data/menus';
import { IngredientsChecklist } from './IngredientsChecklist';

type Props = {
  menuId: string;
  dayIndex: number;
  mealKind: MealKind;
  /** Sheet déjà persistée pour ce slot (lecture initiale). */
  initial: MenuMealSheet | null;
};

type PreviewData = {
  tempPath: string;
  imageUrl: string;
  title: string | null;
  servings: number | null;
  calories: number | null;
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  aliments: string[];
  ingredients: ShoppingListItem[];
};

/**
 * Éditeur d'une fiche repas (déjeuner ou dîner) d'un jour du menu.
 *
 * 3 états possibles :
 *   1. Aucune sheet pour ce slot : bouton "Importer + analyser"
 *   2. Preview en cours d'édition (après upload + Vision) : form
 *      éditable + boutons Enregistrer / Annuler
 *   3. Sheet persistée : carte repliable avec résumé + Modifier /
 *      Supprimer / Remplacer
 *
 * Pattern dérivé de RecipeSheetsEditor mais simplifié (1 seul slot,
 * pas de carrousel).
 */
export function MealSheetEditor({
  menuId,
  dayIndex,
  mealKind,
  initial,
}: Props) {
  const [persisted, setPersisted] = useState<MenuMealSheet | null>(initial);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [busy, setBusy] = useState<'idle' | 'extracting' | 'saving' | 'deleting'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy('extracting');
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch(
        `/api/admin/menus/${menuId}/meal-sheet/preview`,
        { method: 'POST', body: fd },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec analyse');
      setPreview({
        tempPath: j.tempPath,
        imageUrl: j.imageUrl,
        title: j.title,
        servings: j.servings,
        calories: j.calories,
        proteinsG: j.proteinsG ?? null,
        lipidsG: j.lipidsG ?? null,
        carbsG: j.carbsG ?? null,
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

  async function save() {
    if (!preview) return;
    setBusy('saving');
    setError(null);
    try {
      const res = await fetch(`/api/admin/menus/${menuId}/meal-sheet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dayIndex,
          mealKind,
          tempPath: preview.tempPath,
          title: preview.title,
          servings: preview.servings ?? 4,
          calories: preview.calories,
          proteinsG: preview.proteinsG,
          lipidsG: preview.lipidsG,
          carbsG: preview.carbsG,
          prepTimeMin: preview.prepTimeMin,
          cookTimeMin: preview.cookTimeMin,
          tags: preview.tags,
          aliments: preview.aliments,
          ingredients: preview.ingredients,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur save');
      const s = j.sheet;
      setPersisted({
        id: String(s.id),
        menuId,
        dayIndex,
        mealKind,
        title: s.title,
        coverImageUrl: s.cover_image_url,
        servings: s.servings,
        calories: s.calories,
        proteinsG: s.proteins_g === null || s.proteins_g === undefined ? null : Number(s.proteins_g),
        lipidsG: s.lipids_g === null || s.lipids_g === undefined ? null : Number(s.lipids_g),
        carbsG: s.carbs_g === null || s.carbs_g === undefined ? null : Number(s.carbs_g),
        prepTimeMin: s.prep_time_min,
        cookTimeMin: s.cook_time_min,
        tags: s.tags ?? [],
        aliments: s.aliments ?? [],
        ingredients: s.ingredients ?? [],
        likesCount: typeof s.likes_count === 'number' ? s.likes_count : 0,
      });
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy('idle');
    }
  }

  async function deleteSheet() {
    setBusy('deleting');
    setError(null);
    try {
      const res = await fetch(`/api/admin/menus/${menuId}/meal-sheet`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dayIndex, mealKind }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur delete');
      setPersisted(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy('idle');
      setConfirmDel(false);
    }
  }

  const label = mealKind === 'lunch' ? 'Déjeuner' : 'Dîner';

  // === RENDU ===

  // 2. Preview après upload Vision (form éditable)
  if (preview) {
    return (
      <div className="rounded-xl border-2 border-admin-primary/40 bg-admin-soft/30 p-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-admin-primary-dark">
          ✨ {label} — vérifier puis enregistrer
        </p>
        {error && (
          <div className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <PreviewForm
          data={preview}
          onChange={(p) => setPreview({ ...preview, ...p })}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setPreview(null)}
            disabled={busy !== 'idle'}
            className="rounded-full border border-admin-border bg-white px-3 py-1.5 text-xs font-semibold text-admin-ink-soft"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy !== 'idle'}
            className="flex items-center gap-1.5 rounded-full bg-admin-primary px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50"
          >
            {busy === 'saving' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Enregistrer
          </button>
        </div>
      </div>
    );
  }

  // 3. Sheet persistée : carte repliable
  if (persisted) {
    return (
      <div className="overflow-hidden rounded-xl border border-admin-border bg-white">
        <header
          className="flex cursor-pointer items-center gap-3 p-3"
          onClick={() => setOpen((v) => !v)}
        >
          <div
            className="h-12 w-12 shrink-0 rounded-lg bg-admin-soft/50 bg-cover bg-center"
            style={{ backgroundImage: `url(${persisted.coverImageUrl})` }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[0.6rem] font-bold uppercase tracking-wider text-admin-primary-dark">
              {label}
            </p>
            <p className="truncate text-sm font-bold text-admin-ink">
              {persisted.title || 'Sans titre'}
            </p>
            <p className="truncate text-[0.65rem] text-admin-ink-soft">
              {persisted.servings} pers · {persisted.ingredients.length} ingr
              {persisted.calories ? ` · ${persisted.calories} kcal` : ''}
            </p>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-admin-ink-soft" />
          ) : (
            <ChevronDown className="h-4 w-4 text-admin-ink-soft" />
          )}
        </header>
        {open && (
          <div className="border-t border-admin-border p-3">
            <PreviewForm
              data={{
                tempPath: '',
                imageUrl: persisted.coverImageUrl,
                title: persisted.title,
                servings: persisted.servings,
                calories: persisted.calories,
                proteinsG: persisted.proteinsG,
                lipidsG: persisted.lipidsG,
                carbsG: persisted.carbsG,
                prepTimeMin: persisted.prepTimeMin,
                cookTimeMin: persisted.cookTimeMin,
                tags: persisted.tags,
                aliments: persisted.aliments,
                ingredients: persisted.ingredients,
              }}
              onChange={() => {
                /* lecture seule — re-upload pour modifier */
              }}
              readOnly
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-full bg-admin-soft/40 px-3 py-1.5 text-xs font-semibold text-admin-ink-soft transition hover:bg-admin-soft/60">
                <Sparkles className="h-3 w-3" />
                Remplacer + ré-analyser
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFile}
                />
              </label>
              {confirmDel ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirmDel(false)}
                    disabled={busy === 'deleting'}
                    className="rounded-full bg-cream px-2.5 py-1 text-[0.65rem] font-semibold text-admin-ink-soft"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={deleteSheet}
                    disabled={busy === 'deleting'}
                    className="rounded-full bg-red-600 px-2.5 py-1 text-[0.65rem] font-bold text-white"
                  >
                    {busy === 'deleting' ? '…' : 'Confirmer'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDel(true)}
                  className="flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-[0.65rem] font-semibold text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3 w-3" /> Supprimer
                </button>
              )}
            </div>
            {error && (
              <p className="mt-2 text-xs text-red-600">{error}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // 1. Aucune sheet : bouton upload
  return (
    <div className="rounded-xl border border-dashed border-admin-border bg-admin-surface/40 p-3">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full bg-admin-primary/90 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-admin-primary disabled:opacity-50">
        {busy === 'extracting' ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Vision analyse {label.toLowerCase()}…
          </>
        ) : (
          <>
            <Upload className="h-3.5 w-3.5" />
            {label} — Importer + analyser
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
          disabled={busy !== 'idle'}
        />
      </label>
      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

// ============================================================
// Sous-composant : form éditable Vision preview
// ============================================================

function PreviewForm({
  data,
  onChange,
  readOnly = false,
}: {
  data: PreviewData;
  onChange: (patch: Partial<PreviewData>) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[7rem_1fr]">
        <div
          className="aspect-square w-full rounded-lg bg-admin-soft/40 bg-cover bg-center"
          style={data.imageUrl ? { backgroundImage: `url(${data.imageUrl})` } : undefined}
        />
        <div className="space-y-1.5">
          <input
            type="text"
            value={data.title ?? ''}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Titre du plat"
            disabled={readOnly}
            className="input h-8 text-sm"
          />
          <div className="grid gap-1.5 grid-cols-4">
            <Stat
              label="Pers"
              value={data.servings}
              onChange={(v) => onChange({ servings: v })}
              readOnly={readOnly}
            />
            <Stat
              label="kcal"
              value={data.calories}
              onChange={(v) => onChange({ calories: v })}
              readOnly={readOnly}
            />
            <Stat
              label="Prep"
              suffix="min"
              value={data.prepTimeMin}
              onChange={(v) => onChange({ prepTimeMin: v })}
              readOnly={readOnly}
            />
            <Stat
              label="Cuis"
              suffix="min"
              value={data.cookTimeMin}
              onChange={(v) => onChange({ cookTimeMin: v })}
              readOnly={readOnly}
            />
          </div>
          {/* Macros : Protéines / Lipides / Glucides */}
          <div className="grid grid-cols-3 gap-1.5">
            <Stat
              label="Prot"
              suffix="g"
              value={data.proteinsG}
              onChange={(v) => onChange({ proteinsG: v })}
              readOnly={readOnly}
              allowDecimal
            />
            <Stat
              label="Lip"
              suffix="g"
              value={data.lipidsG}
              onChange={(v) => onChange({ lipidsG: v })}
              readOnly={readOnly}
              allowDecimal
            />
            <Stat
              label="Gluc"
              suffix="g"
              value={data.carbsG}
              onChange={(v) => onChange({ carbsG: v })}
              readOnly={readOnly}
              allowDecimal
            />
          </div>
          <CsvField
            label="Tags"
            values={data.tags}
            onChange={(v) => onChange({ tags: v })}
            readOnly={readOnly}
          />
          <CsvField
            label="Aliments"
            values={data.aliments}
            onChange={(v) => onChange({ aliments: v })}
            readOnly={readOnly}
          />
        </div>
      </div>
      <IngredientsChecklist
        ingredients={data.ingredients.map((it) => ({
          category: it.category,
          label: it.label,
          quantity: it.quantity,
          unit: it.unit,
          note: it.note ?? null,
        }))}
        onChange={(next) =>
          onChange({
            ingredients: next.map((it) => ({
              category: it.category,
              label: it.label,
              quantity: it.quantity,
              unit: it.unit,
              note: it.note,
            })),
          })
        }
      />
    </div>
  );
}

function Stat({
  label,
  value,
  onChange,
  suffix,
  readOnly,
  allowDecimal,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
  readOnly?: boolean;
  allowDecimal?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[0.55rem] font-semibold uppercase tracking-wider text-admin-ink-soft">
        {label}
        {suffix && ` (${suffix})`}
      </span>
      <input
        type="number"
        min="0"
        step={allowDecimal ? 0.1 : 1}
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value === '') return onChange(null);
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return onChange(null);
          onChange(
            Math.max(0, allowDecimal ? Math.round(n * 10) / 10 : Math.round(n)),
          );
        }}
        readOnly={readOnly}
        className="input h-7 w-full px-1 text-center text-xs"
      />
    </label>
  );
}

function CsvField({
  label,
  values,
  onChange,
  readOnly,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[0.55rem] font-semibold uppercase tracking-wider text-admin-ink-soft">
        {label}
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
        readOnly={readOnly}
        className="input h-7 w-full px-1.5 text-xs"
      />
    </label>
  );
}
