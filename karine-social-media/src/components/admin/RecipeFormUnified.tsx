'use client';

import {
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { RecipeIngredient } from '@/data/recipes';
import { IngredientsChecklist } from './IngredientsChecklist';

/* eslint-disable @next/next/no-img-element */

type ExtractedData = {
  title: string | null;
  servings: number | null;
  calories: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  aliments: string[];
  ingredients: RecipeIngredient[];
};

type MainData = ExtractedData & {
  tempPath: string;
  imageUrl: string;
};

type SheetData = ExtractedData & {
  tempPath: string;
  imageUrl: string;
  fileName: string;
};

/**
 * Création unifiée d'une recette sur UN SEUL écran :
 *
 *   1. Upload image principale → Vision Haiku 4.5 extract auto
 *   2. Karine valide / corrige titre + catégorie
 *   3. Upload N images détaillées en MULTI-SELECT → batch Vision parallèle
 *   4. Chaque fiche extractée s'affiche en carte éditable
 *   5. Bouton "Créer la recette" → un seul POST qui assemble tout
 *
 * Si Karine ne charge AUCUNE fiche détaillée et que la cover EST elle-même
 * une fiche complète (Vision a extrait des ingrédients) → la cover devient
 * automatiquement la fiche unique de la recette.
 */
export function RecipeFormUnified() {
  const router = useRouter();
  const [mainData, setMainData] = useState<MainData | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [isSeasonal, setIsSeasonal] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [busy, setBusy] = useState<
    'idle' | 'main' | 'sheets' | 'saving'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const mainInputRef = useRef<HTMLInputElement | null>(null);
  const sheetsInputRef = useRef<HTMLInputElement | null>(null);

  // === Upload image principale ===
  async function handleMainFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy('main');
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/admin/recipes/preview-main', {
        method: 'POST',
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec analyse cover');
      const data: MainData = {
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
      };
      setMainData(data);
      // Pré-remplir le titre si Karine ne l'a pas déjà saisi
      if (!title.trim() && data.title) setTitle(data.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy('idle');
      if (mainInputRef.current) mainInputRef.current.value = '';
    }
  }

  // === Upload images détaillées (multi) ===
  async function handleSheetsFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setBusy('sheets');
    setProgress({ done: 0, total: files.length });
    try {
      // Découpe en batchs de 10 max (limite serveur)
      const batches: File[][] = [];
      for (let i = 0; i < files.length; i += 10) {
        batches.push(files.slice(i, i + 10));
      }
      const newSheets: SheetData[] = [];
      for (const batch of batches) {
        const fd = new FormData();
        for (const f of batch) fd.append('files', f);
        const res = await fetch('/api/admin/recipes/sheets-preview-bulk', {
          method: 'POST',
          body: fd,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || 'Échec batch');
        for (const s of j.sheets ?? []) {
          if (s.ok) {
            newSheets.push({
              tempPath: s.tempPath,
              imageUrl: s.imageUrl,
              fileName: s.fileName,
              title: s.title,
              servings: s.servings,
              calories: s.calories,
              prepTimeMin: s.prepTimeMin,
              cookTimeMin: s.cookTimeMin,
              tags: s.tags ?? [],
              aliments: s.aliments ?? [],
              ingredients: s.ingredients ?? [],
            });
          }
        }
        setProgress((p) => p && { ...p, done: p.done + batch.length });
      }
      setSheets((prev) => [...prev, ...newSheets]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy('idle');
      setProgress(null);
      if (sheetsInputRef.current) sheetsInputRef.current.value = '';
    }
  }

  // === Save final ===
  async function save() {
    setError(null);
    if (!mainData) {
      setError('Upload l\'image principale d\'abord.');
      return;
    }
    if (!category) {
      setError('Choisis une catégorie.');
      return;
    }
    if (!title.trim()) {
      setError('Le titre est requis.');
      return;
    }
    setBusy('saving');
    try {
      // mainAsSheet : si pas de sheets uploadées explicitement, on envoie
      // les données extraites de la cover pour qu'elle devienne sheet 0
      // (cas la cover EST elle-même une fiche détaillée).
      const mainAsSheet =
        sheets.length === 0 && mainData.ingredients.length > 0
          ? {
              title: mainData.title,
              servings: mainData.servings,
              calories: mainData.calories,
              prepTimeMin: mainData.prepTimeMin,
              cookTimeMin: mainData.cookTimeMin,
              tags: mainData.tags,
              aliments: mainData.aliments,
              ingredients: mainData.ingredients,
            }
          : undefined;

      const res = await fetch('/api/admin/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          category,
          status,
          isSeasonal,
          isFeatured,
          isPublic,
          mainTempPath: mainData.tempPath,
          mainAsSheet,
          sheets: sheets.map((s) => ({
            tempPath: s.tempPath,
            title: s.title,
            servings: s.servings,
            calories: s.calories,
            prepTimeMin: s.prepTimeMin,
            cookTimeMin: s.cookTimeMin,
            tags: s.tags,
            aliments: s.aliments,
            ingredients: s.ingredients,
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec création');
      router.push('/admin/recettes');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setBusy('idle');
    }
  }

  function updateSheet(idx: number, patch: Partial<SheetData>) {
    setSheets((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function removeSheet(idx: number) {
    setSheets((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-6">
      {/* Bloc explicatif */}
      <div className="rounded-2xl border border-coral-soft/50 bg-coral-soft/10 p-4 text-sm text-ink-soft">
        <p className="font-bold text-coral-dark">✨ Création unifiée :</p>
        <ol className="mt-1 list-decimal pl-5 text-xs">
          <li>Upload l&apos;image principale → Vision Haiku 4.5 lit le titre + tout ce qui est lisible</li>
          <li>(optionnel) Upload N images de fiches détaillées en multi-select → batch Vision parallèle</li>
          <li>Vérifie et corrige les données</li>
          <li>Clique <strong>Créer la recette</strong> — tout se sauve d&apos;un coup</li>
        </ol>
        <p className="mt-2 text-xs italic">
          Si tu ne charges pas de fiches détaillées et que l&apos;image
          principale est elle-même une fiche complète, elle devient
          automatiquement la fiche unique de la recette.
        </p>
      </div>

      {/* ========== Section 1 : Image principale ========== */}
      <section className="rounded-2xl bg-white/85 p-5 shadow-sm">
        <header className="mb-3">
          <h2 className="font-script text-xl text-admin-primary-dark">
            1. Image principale
          </h2>
          <p className="text-xs text-admin-ink-soft">
            Cover de la recette. Vision lit titre + (si présents) ingrédients,
            calories, temps, etc.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <div
            className="relative aspect-square w-full overflow-hidden rounded-xl border-2 border-dashed border-admin-border bg-admin-soft/40 bg-cover bg-center"
            style={mainData ? { backgroundImage: `url(${mainData.imageUrl})` } : undefined}
          >
            {!mainData && busy !== 'main' && (
              <div className="grid h-full place-items-center text-admin-ink-soft">
                <div className="text-center">
                  <Upload className="mx-auto h-8 w-8" />
                  <p className="mt-2 text-xs font-semibold">Aucune image</p>
                </div>
              </div>
            )}
            {busy === 'main' && (
              <div className="absolute inset-0 grid place-items-center bg-black/60 text-white">
                <div className="text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin" />
                  <p className="mt-2 text-sm font-bold">Vision analyse…</p>
                  <p className="text-xs opacity-80">~5 à 10 secondes</p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full bg-admin-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50">
              <Sparkles className="h-4 w-4" />
              {mainData ? 'Remplacer l\'image' : 'Choisir l\'image principale'}
              <input
                ref={mainInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleMainFile}
                disabled={busy !== 'idle'}
              />
            </label>

            <Field label="Titre">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={mainData?.title ?? 'Sera proposé par Vision'}
                className="input"
              />
            </Field>

            <Field label="Catégorie">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="input"
              >
                <option value="" disabled>
                  Choisir…
                </option>
                <option value="petit_dejeuner">Petit déjeuner</option>
                <option value="entree">Entrée</option>
                <option value="salade">Salade</option>
                <option value="plat">Plat</option>
                <option value="sauce">Sauce</option>
                <option value="gouter">Goûter</option>
                <option value="dessert">Dessert</option>
                <option value="boisson">Boisson</option>
                <option value="aperitif">Apéro dînatoire</option>
                <option value="repas_fete">Repas de fête</option>
              </select>
            </Field>

            <div className="flex flex-col gap-1.5 pt-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isSeasonal}
                  onChange={(e) => setIsSeasonal(e.target.checked)}
                  className="h-4 w-4 accent-sage"
                />
                <span>🌿 De saison</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                  className="h-4 w-4 accent-coral"
                />
                <span>⭐ Mettre à la une</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="h-4 w-4 accent-sage"
                />
                <span>🌍 Tout le monde (recette accessible aux non abonnées)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Si Vision a extrait des ingrédients depuis la cover : indication */}
        {mainData && mainData.ingredients.length > 0 && sheets.length === 0 && (
          <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
            ✓ Vision a extrait <strong>{mainData.ingredients.length} ingrédients</strong>{' '}
            depuis la cover. Si tu n&apos;ajoutes pas de fiches détaillées, la
            cover devient automatiquement la fiche unique.
          </div>
        )}
      </section>

      {/* ========== Section 2 : Fiches détaillées (optional) ========== */}
      {mainData && (
        <section className="rounded-2xl bg-white/85 p-5 shadow-sm">
          <header className="mb-3">
            <h2 className="font-script text-xl text-admin-primary-dark">
              2. Fiches détaillées <span className="text-xs">(optionnel)</span>
            </h2>
            <p className="text-xs text-admin-ink-soft">
              Chaque fiche détaillée = une variante de la recette. Upload
              autant d&apos;images d&apos;un coup, Vision lit toutes en parallèle.
            </p>
          </header>

          {/* Sheets uploadées : cartes repliables */}
          {sheets.length > 0 && (
            <div className="mb-3 space-y-2">
              {sheets.map((s, idx) => (
                <SheetCard
                  key={`${s.tempPath}-${idx}`}
                  sheet={s}
                  index={idx}
                  onChange={(p) => updateSheet(idx, p)}
                  onRemove={() => removeSheet(idx)}
                />
              ))}
            </div>
          )}

          {/* Bouton multi-upload */}
          <label
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-admin-border bg-admin-surface px-4 py-4 text-sm font-bold transition hover:bg-admin-soft/30 ${
              busy === 'sheets' ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {busy === 'sheets' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Vision analyse{' '}
                {progress ? `${progress.done}/${progress.total}` : 'les images'}…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Ajouter des fiches détaillées (multi-select)
              </>
            )}
            <input
              ref={sheetsInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleSheetsFiles}
              disabled={busy !== 'idle'}
            />
          </label>
        </section>
      )}

      {/* ========== Footer actions ========== */}
      <section className="sticky bottom-0 z-10 -mx-1 rounded-2xl bg-white/95 p-4 shadow-lg backdrop-blur">
        {error && (
          <div className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <Field label="Statut">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
              className="input w-32"
            >
              <option value="draft">Brouillon</option>
              <option value="published">Publiée</option>
            </select>
          </Field>
          <button
            type="button"
            onClick={save}
            disabled={busy !== 'idle' || !mainData}
            className="flex items-center gap-2 rounded-full bg-admin-primary px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-admin-primary-dark disabled:opacity-50"
          >
            {busy === 'saving' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Création…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Créer la recette
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

// ============================================================
// Sub-composants
// ============================================================

function SheetCard({
  sheet,
  index,
  onChange,
  onRemove,
}: {
  sheet: SheetData;
  index: number;
  onChange: (p: Partial<SheetData>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-admin-border bg-white">
      <header className="flex items-center justify-between gap-3 p-3">
        <div
          className="h-12 w-12 shrink-0 rounded-lg bg-admin-soft/40 bg-cover bg-center"
          style={{ backgroundImage: `url(${sheet.imageUrl})` }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-admin-ink">
            Fiche #{index + 1} · {sheet.title || sheet.fileName}
          </p>
          <p className="truncate text-[0.7rem] text-admin-ink-soft">
            {sheet.servings ?? '?'} pers · {sheet.ingredients.length} ingrédients
            {sheet.calories ? ` · ${sheet.calories} kcal` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Replier' : 'Déplier'}
          className="grid h-7 w-7 place-items-center rounded-full text-admin-ink-soft hover:bg-admin-soft/40"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Retirer cette fiche"
          className="grid h-7 w-7 place-items-center rounded-full text-admin-ink-soft hover:bg-red-50 hover:text-red-600"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {open && (
        <div className="border-t border-admin-border p-3">
          <SheetEditableForm data={sheet} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function SheetEditableForm({
  data,
  onChange,
}: {
  data: ExtractedData;
  onChange: (p: Partial<ExtractedData>) => void;
}) {
  return (
    <div className="space-y-3">
      <input
        type="text"
        value={data.title ?? ''}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Titre de la variante"
        className="input h-8 text-sm"
      />
      <div className="grid gap-2 grid-cols-4">
        <Stat label="Pers" value={data.servings} onChange={(v) => onChange({ servings: v })} />
        <Stat label="kcal" value={data.calories} onChange={(v) => onChange({ calories: v })} />
        <Stat label="Prep" value={data.prepTimeMin} onChange={(v) => onChange({ prepTimeMin: v })} suffix="min" />
        <Stat label="Cuis" value={data.cookTimeMin} onChange={(v) => onChange({ cookTimeMin: v })} suffix="min" />
      </div>
      <CsvField label="Tags" values={data.tags} onChange={(v) => onChange({ tags: v })} />
      <CsvField label="Aliments" values={data.aliments} onChange={(v) => onChange({ aliments: v })} />
      <IngredientsChecklist
        ingredients={data.ingredients}
        onChange={(next) => onChange({ ingredients: next })}
      />
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-admin-ink">
        {label}
      </span>
      {children}
    </label>
  );
}
