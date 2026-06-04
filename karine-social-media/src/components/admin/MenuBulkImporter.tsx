'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Check,
  ChevronRight,
  GripVertical,
  ImagePlus,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import { compressImage } from '@/lib/compress-image';
import { DAYS_LABELS } from '@/data/menus';
import type { ShoppingListItem } from '@/data/menus';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type Step = 'config' | 'upload' | 'review' | 'saving' | 'done';

/** Slot du planning : 14 cellules ordonnées (lun déj, lun dîner, …). */
type Slot = { dayIndex: number; mealKind: 'lunch' | 'dinner'; label: string };

const SLOTS: Slot[] = DAYS_LABELS.flatMap((day, i) => [
  { dayIndex: i, mealKind: 'lunch' as const, label: `${day} — déjeuner` },
  { dayIndex: i, mealKind: 'dinner' as const, label: `${day} — dîner` },
]);

type PreviewRow = {
  /** Identifiant local pour les re-renders + drag-drop. Pas persisté. */
  uid: string;
  tempPath: string;
  imageUrl: string;
  title: string;
  servings: number;
  calories: number | null;
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  tags: string[];
  aliments: string[];
  ingredients: ShoppingListItem[];
  /** Statut d'extraction Vision (par fichier). */
  status: 'pending' | 'extracting' | 'done' | 'error';
  errorMessage?: string;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** UID local court (pas pour la sécurité — juste pour les keys React + DnD). */
function makeUid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Exécute une liste de promesses async avec une limite de concurrence
 * (sinon Anthropic Vision rate-limit + saturation network).
 *
 * Ordre des résultats préservé. Une promesse qui throw NE bloque PAS
 * les autres : son slot reçoit `undefined` (le caller doit gérer).
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<R | undefined>> {
  const out: Array<R | undefined> = new Array(items.length);
  let cursor = 0;
  async function consume(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = await worker(items[i], i);
      } catch {
        out[i] = undefined;
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, consume);
  await Promise.all(workers);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Composant principal                                                         */
/* -------------------------------------------------------------------------- */

export function MenuBulkImporter() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('config');
  const [error, setError] = useState<string | null>(null);

  // Phase 1 — Config
  const [weekStart, setWeekStart] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [shoppingFile, setShoppingFile] = useState<File | null>(null);
  const [shoppingPreviewUrl, setShoppingPreviewUrl] = useState<string | null>(
    null,
  );

  // Phase 2-3 — Menu créé + fiches
  const [menuId, setMenuId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<PreviewRow[]>([]);
  const [extractProgress, setExtractProgress] = useState({ done: 0, total: 0 });
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0 });

  // Cleanup des object URLs côté preview pour ne pas leaker
  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
      if (shoppingPreviewUrl) URL.revokeObjectURL(shoppingPreviewUrl);
    };
  }, [coverPreviewUrl, shoppingPreviewUrl]);

  /* ---------- Phase 1 : Config ---------- */

  function onCoverChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverFile(f);
    setCoverPreviewUrl(f ? URL.createObjectURL(f) : null);
  }
  function onShoppingChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (shoppingPreviewUrl) URL.revokeObjectURL(shoppingPreviewUrl);
    setShoppingFile(f);
    setShoppingPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function handleConfigSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      setError('Choisis une date de lundi (YYYY-MM-DD).');
      return;
    }
    setStep('upload');

    try {
      // 1. Création du menu (draft) — POST /api/admin/menus
      const fd = new FormData();
      fd.set('weekStart', weekStart);
      if (title.trim()) fd.set('title', title.trim());
      fd.set('status', status);
      const res = await fetch('/api/admin/menus', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.id) {
        throw new Error(j?.error || 'Création du menu impossible');
      }
      const id = String(j.id);
      setMenuId(id);

      // 2. Upload cover + shopping en parallèle (ils sont indépendants)
      const opts = { maxDim: 1200, quality: 0.8, skipBelowKB: 150 };
      const assetJobs: Array<Promise<unknown>> = [];
      if (coverFile) {
        assetJobs.push(uploadAsset(id, 'cover', coverFile, opts));
      }
      if (shoppingFile) {
        assetJobs.push(uploadAsset(id, 'shopping', shoppingFile, opts));
      }
      await Promise.all(assetJobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création menu');
      // On reste en étape 'upload' mais sans menuId : l'écran affichera
      // le message d'erreur et un bouton "Réessayer".
    }
  }

  /* ---------- Phase 2 : Drop 14 fichiers + Vision ---------- */

  async function handleSheetsSelected(files: File[]) {
    if (!menuId) return;
    setError(null);
    if (files.length === 0) return;
    if (files.length > SLOTS.length) {
      setError(
        `Trop de fichiers (max ${SLOTS.length}). Garde les ${SLOTS.length} premiers ou recharge.`,
      );
      return;
    }

    // Initialise les previews vides à partir des fichiers (avec
    // imageUrl objectURL local jusqu'à l'arrivée du tempPath serveur).
    const initial: PreviewRow[] = files.map((f) => ({
      uid: makeUid(),
      tempPath: '',
      imageUrl: URL.createObjectURL(f),
      title: '',
      servings: 4,
      calories: null,
      proteinsG: null,
      lipidsG: null,
      carbsG: null,
      prepTimeMin: null,
      cookTimeMin: null,
      tags: [],
      aliments: [],
      ingredients: [],
      status: 'extracting',
    }));
    setPreviews(initial);
    setStep('review');
    setExtractProgress({ done: 0, total: files.length });

    // Limite à 3 simultanés pour ménager Vision Haiku + bande passante
    let completed = 0;
    await runWithConcurrency(files, 3, async (file, idx) => {
      const fd = new FormData();
      fd.set('file', file);
      try {
        const res = await fetch(
          `/api/admin/menus/${menuId}/meal-sheet/preview`,
          { method: 'POST', body: fd },
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || 'Vision indisponible');

        // Libère l'objectURL local maintenant que Storage nous renvoie une URL stable
        setPreviews((rows) => {
          const next = [...rows];
          const row = next[idx];
          if (!row) return rows;
          if (row.imageUrl.startsWith('blob:')) URL.revokeObjectURL(row.imageUrl);
          next[idx] = {
            ...row,
            tempPath: String(j.tempPath ?? ''),
            imageUrl: String(j.imageUrl ?? row.imageUrl),
            title: typeof j.title === 'string' ? j.title : '',
            servings: typeof j.servings === 'number' ? j.servings : 4,
            calories: typeof j.calories === 'number' ? j.calories : null,
            proteinsG: typeof j.proteinsG === 'number' ? j.proteinsG : null,
            lipidsG: typeof j.lipidsG === 'number' ? j.lipidsG : null,
            carbsG: typeof j.carbsG === 'number' ? j.carbsG : null,
            prepTimeMin: typeof j.prepTimeMin === 'number' ? j.prepTimeMin : null,
            cookTimeMin: typeof j.cookTimeMin === 'number' ? j.cookTimeMin : null,
            tags: Array.isArray(j.tags) ? j.tags.filter((t: unknown) => typeof t === 'string') : [],
            aliments: Array.isArray(j.aliments)
              ? j.aliments.filter((t: unknown) => typeof t === 'string')
              : [],
            ingredients: Array.isArray(j.ingredients) ? (j.ingredients as ShoppingListItem[]) : [],
            status: 'done',
          };
          return next;
        });
      } catch (e) {
        setPreviews((rows) => {
          const next = [...rows];
          const row = next[idx];
          if (!row) return rows;
          next[idx] = {
            ...row,
            status: 'error',
            errorMessage: e instanceof Error ? e.message : 'Erreur',
          };
          return next;
        });
      } finally {
        completed += 1;
        setExtractProgress({ done: completed, total: files.length });
      }
    });
  }

  /* ---------- Phase 3 : Édition + drag-drop ---------- */

  function updateRow(uid: string, patch: Partial<PreviewRow>) {
    setPreviews((rows) =>
      rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
    );
  }
  function removeRow(uid: string) {
    setPreviews((rows) => {
      const target = rows.find((r) => r.uid === uid);
      if (target?.imageUrl.startsWith('blob:')) URL.revokeObjectURL(target.imageUrl);
      return rows.filter((r) => r.uid !== uid);
    });
  }

  // Drag-drop natif HTML5 — pas de lib externe, c'est largement
  // suffisant pour réordonner 14 lignes.
  const dragFromRef = useRef<number | null>(null);
  function onRowDragStart(e: DragEvent<HTMLLIElement>, idx: number) {
    dragFromRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  }
  function onRowDragOver(e: DragEvent<HTMLLIElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function onRowDrop(e: DragEvent<HTMLLIElement>, idx: number) {
    e.preventDefault();
    const from = dragFromRef.current;
    dragFromRef.current = null;
    if (from === null || from === idx) return;
    setPreviews((rows) => {
      const next = [...rows];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      return next;
    });
  }

  /* ---------- Phase 4 : Save final ---------- */

  async function handleSaveAll() {
    if (!menuId) return;
    setError(null);
    // On ne sauvegarde que les rows extracted (status === 'done')
    const ready = previews.slice(0, SLOTS.length).filter((r) => r.status === 'done');
    if (ready.length === 0) {
      setError('Aucune fiche valide à enregistrer.');
      return;
    }
    setStep('saving');
    setSaveProgress({ done: 0, total: ready.length });

    let completed = 0;
    let firstError: string | null = null;
    await runWithConcurrency(ready, 3, async (row, idxInReady) => {
      const slotIdx = previews.findIndex((r) => r.uid === row.uid);
      const slot = SLOTS[slotIdx];
      if (!slot) {
        // Ligne au-delà du 14e slot : on l'ignore silencieusement.
        completed += 1;
        setSaveProgress({ done: completed, total: ready.length });
        return;
      }
      try {
        const body = {
          dayIndex: slot.dayIndex,
          mealKind: slot.mealKind,
          tempPath: row.tempPath,
          title: row.title || null,
          servings: row.servings,
          calories: row.calories,
          proteinsG: row.proteinsG,
          lipidsG: row.lipidsG,
          carbsG: row.carbsG,
          prepTimeMin: row.prepTimeMin,
          cookTimeMin: row.cookTimeMin,
          tags: row.tags,
          aliments: row.aliments,
          ingredients: row.ingredients,
        };
        const res = await fetch(`/api/admin/menus/${menuId}/meal-sheet`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || `Fiche ${idxInReady + 1} échouée`);
        }
      } catch (e) {
        if (!firstError) firstError = e instanceof Error ? e.message : 'Erreur';
      } finally {
        completed += 1;
        setSaveProgress({ done: completed, total: ready.length });
      }
    });

    if (firstError) {
      setError(`Certaines fiches ont échoué : ${firstError}`);
      setStep('review');
      return;
    }
    setStep('done');
    router.push(`/admin/menus/${menuId}`);
    router.refresh();
  }

  /* ---------- Rendu ---------- */

  return (
    <div className="space-y-5">
      <Stepper step={step} />

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === 'config' && (
        <ConfigPanel
          weekStart={weekStart}
          title={title}
          status={status}
          coverPreviewUrl={coverPreviewUrl}
          shoppingPreviewUrl={shoppingPreviewUrl}
          onWeekStartChange={setWeekStart}
          onTitleChange={setTitle}
          onStatusChange={setStatus}
          onCoverChange={onCoverChange}
          onShoppingChange={onShoppingChange}
          onSubmit={handleConfigSubmit}
        />
      )}

      {step === 'upload' && (
        <UploadPanel
          menuReady={Boolean(menuId)}
          onFilesSelected={handleSheetsSelected}
        />
      )}

      {(step === 'review' || step === 'saving') && (
        <ReviewPanel
          previews={previews}
          extractProgress={extractProgress}
          saveProgress={saveProgress}
          saving={step === 'saving'}
          onUpdateRow={updateRow}
          onRemoveRow={removeRow}
          onDragStart={onRowDragStart}
          onDragOver={onRowDragOver}
          onDrop={onRowDrop}
          onSaveAll={handleSaveAll}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Phase 1 — Config                                                            */
/* -------------------------------------------------------------------------- */

function ConfigPanel({
  weekStart,
  title,
  status,
  coverPreviewUrl,
  shoppingPreviewUrl,
  onWeekStartChange,
  onTitleChange,
  onStatusChange,
  onCoverChange,
  onShoppingChange,
  onSubmit,
}: {
  weekStart: string;
  title: string;
  status: 'draft' | 'published';
  coverPreviewUrl: string | null;
  shoppingPreviewUrl: string | null;
  onWeekStartChange: (v: string) => void;
  onTitleChange: (v: string) => void;
  onStatusChange: (v: 'draft' | 'published') => void;
  onCoverChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onShoppingChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl bg-admin-surface p-5 shadow-sm"
    >
      <p className="text-sm font-bold text-admin-ink">
        Étape 1 — Infos du menu + image principale + liste de courses
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-admin-ink-soft">
            Lundi de la semaine
          </span>
          <input
            type="date"
            required
            value={weekStart}
            onChange={(e) => onWeekStartChange(e.target.value)}
            className="w-full rounded-full border border-admin-border bg-white px-3 py-2 text-sm outline-none focus:border-admin-primary"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-admin-ink-soft">
            Titre (optionnel)
          </span>
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="ex. Semaine du 9 juin"
            className="w-full rounded-full border border-admin-border bg-white px-3 py-2 text-sm outline-none focus:border-admin-primary"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PreviewSlot
          name="cover"
          label="Image principale (Main)"
          previewUrl={coverPreviewUrl}
          onChange={onCoverChange}
        />
        <PreviewSlot
          name="shopping"
          label="Liste de courses"
          previewUrl={shoppingPreviewUrl}
          onChange={onShoppingChange}
        />
      </div>

      <label className="block max-w-xs">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-admin-ink-soft">
          Statut
        </span>
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as 'draft' | 'published')}
          className="w-full rounded-full border border-admin-border bg-white px-3 py-2 text-sm outline-none focus:border-admin-primary"
        >
          <option value="draft">Brouillon</option>
          <option value="published">Publié</option>
        </select>
      </label>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-full bg-admin-primary px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark"
        >
          Continuer
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}

function PreviewSlot({
  name,
  label,
  previewUrl,
  onChange,
}: {
  name: string;
  label: string;
  previewUrl: string | null;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-admin-border bg-admin-soft/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-admin-ink-soft">
        {label}
      </p>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="block h-20 w-20 shrink-0 rounded-lg bg-cover bg-center shadow-sm"
          style={{
            backgroundImage: previewUrl ? `url(${previewUrl})` : undefined,
            backgroundColor: 'var(--color-admin-surface)',
          }}
        >
          {!previewUrl && (
            <span className="grid h-full w-full place-items-center">
              <ImagePlus className="h-6 w-6 text-admin-ink-soft" />
            </span>
          )}
        </span>
        <input
          name={name}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          onChange={onChange}
          className="block w-full text-xs file:mr-2 file:rounded-full file:border-0 file:bg-admin-soft file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-admin-primary-dark"
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Phase 2 — Drop 14 fichiers                                                  */
/* -------------------------------------------------------------------------- */

function UploadPanel({
  menuReady,
  onFilesSelected,
}: {
  menuReady: boolean;
  onFilesSelected: (files: File[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    onFilesSelected(files);
  }

  return (
    <div className="space-y-3 rounded-2xl bg-admin-surface p-5 shadow-sm">
      <p className="text-sm font-bold text-admin-ink">
        Étape 2 — Charger les 14 fiches recettes
      </p>
      <p className="text-xs text-admin-ink-soft">
        Ordre : Lundi déj, Lundi dîner, Mardi déj, Mardi dîner, …,
        Dimanche dîner. Tu pourras réordonner après l&apos;extraction Vision.
      </p>

      {!menuReady && (
        <div className="flex items-center gap-2 rounded-xl bg-admin-soft/50 px-3 py-2 text-xs text-admin-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          Création du menu en cours…
        </div>
      )}

      {menuReady && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-sm transition-colors ${
            dragOver
              ? 'border-admin-primary bg-admin-soft/50'
              : 'border-admin-border bg-admin-soft/20 hover:border-admin-primary hover:bg-admin-soft/30'
          }`}
        >
          <Upload className="h-8 w-8 text-admin-primary" />
          <span className="font-semibold text-admin-ink">
            Glisse jusqu&apos;à 14 fiches recettes ici
          </span>
          <span className="text-xs text-admin-ink-soft">
            ou clique pour parcourir tes fichiers
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Phase 3 — Tableau de relecture + drag-drop                                  */
/* -------------------------------------------------------------------------- */

function ReviewPanel({
  previews,
  extractProgress,
  saveProgress,
  saving,
  onUpdateRow,
  onRemoveRow,
  onDragStart,
  onDragOver,
  onDrop,
  onSaveAll,
}: {
  previews: PreviewRow[];
  extractProgress: { done: number; total: number };
  saveProgress: { done: number; total: number };
  saving: boolean;
  onUpdateRow: (uid: string, patch: Partial<PreviewRow>) => void;
  onRemoveRow: (uid: string) => void;
  onDragStart: (e: DragEvent<HTMLLIElement>, idx: number) => void;
  onDragOver: (e: DragEvent<HTMLLIElement>) => void;
  onDrop: (e: DragEvent<HTMLLIElement>, idx: number) => void;
  onSaveAll: () => void;
}) {
  const extracting = extractProgress.done < extractProgress.total;
  const doneCount = previews.filter((r) => r.status === 'done').length;
  const errorCount = previews.filter((r) => r.status === 'error').length;

  return (
    <div className="space-y-3 rounded-2xl bg-admin-surface p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-bold text-admin-ink">
          Étape 3 — Relecture + ordre
        </p>
        <p className="text-xs text-admin-ink-soft">
          {extracting
            ? `Vision en cours… ${extractProgress.done}/${extractProgress.total}`
            : `${doneCount} extraite${doneCount > 1 ? 's' : ''}${
                errorCount > 0 ? ` · ${errorCount} en erreur` : ''
              }`}
        </p>
      </div>

      {extracting && <ProgressBar value={extractProgress.done} max={extractProgress.total} />}

      <ul className="space-y-2">
        {previews.map((row, idx) => {
          const slot = SLOTS[idx];
          return (
            <li
              key={row.uid}
              draggable={!saving}
              onDragStart={(e) => onDragStart(e, idx)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, idx)}
              className="flex flex-col gap-2 rounded-2xl border border-admin-border bg-white p-3 sm:flex-row sm:items-center"
            >
              <span className="flex shrink-0 items-center gap-2">
                <GripVertical className="h-4 w-4 cursor-grab text-admin-ink-soft" />
                <span className="rounded-full bg-admin-soft px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-admin-primary-dark">
                  {slot ? slot.label : 'Hors planning'}
                </span>
              </span>

              <span
                aria-hidden
                className="block h-14 w-14 shrink-0 rounded-lg bg-cover bg-center shadow-sm"
                style={{
                  backgroundImage: row.imageUrl ? `url(${row.imageUrl})` : undefined,
                  backgroundColor: 'var(--color-admin-soft)',
                }}
              />

              <div className="grid min-w-0 flex-1 gap-1.5">
                {row.status === 'extracting' && (
                  <span className="flex items-center gap-1.5 text-xs text-admin-ink-soft">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Vision analyse…
                  </span>
                )}
                {row.status === 'error' && (
                  <span className="flex items-center gap-1.5 text-xs text-red-700">
                    <AlertCircle className="h-3 w-3" />
                    {row.errorMessage || 'Extraction échouée'}
                  </span>
                )}
                {row.status === 'done' && (
                  <>
                    <input
                      type="text"
                      value={row.title}
                      onChange={(e) => onUpdateRow(row.uid, { title: e.target.value })}
                      placeholder="Titre"
                      className="rounded-md border border-admin-border bg-white px-2 py-1 text-sm font-semibold text-admin-ink outline-none focus:border-admin-primary"
                    />
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <NumField
                        label="Part."
                        value={row.servings}
                        min={1}
                        max={20}
                        onChange={(v) =>
                          onUpdateRow(row.uid, { servings: v ?? 4 })
                        }
                      />
                      <NumField
                        label="kcal"
                        value={row.calories}
                        onChange={(v) => onUpdateRow(row.uid, { calories: v })}
                      />
                      <NumField
                        label="P"
                        value={row.proteinsG}
                        suffix="g"
                        onChange={(v) => onUpdateRow(row.uid, { proteinsG: v })}
                      />
                      <NumField
                        label="L"
                        value={row.lipidsG}
                        suffix="g"
                        onChange={(v) => onUpdateRow(row.uid, { lipidsG: v })}
                      />
                      <NumField
                        label="G"
                        value={row.carbsG}
                        suffix="g"
                        onChange={(v) => onUpdateRow(row.uid, { carbsG: v })}
                      />
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => onRemoveRow(row.uid)}
                aria-label="Retirer cette fiche"
                disabled={saving}
                className="shrink-0 self-start rounded-full p-1.5 text-admin-ink-soft transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 sm:self-center"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>

      {previews.length > SLOTS.length && (
        <p className="text-xs text-amber-700">
          ⚠️ Tu as déposé {previews.length} fichiers, seuls les {SLOTS.length} premiers
          seront enregistrés dans le planning.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {saving && (
          <span className="text-xs text-admin-ink-soft">
            Enregistrement {saveProgress.done}/{saveProgress.total}…
          </span>
        )}
        <button
          type="button"
          onClick={onSaveAll}
          disabled={extracting || saving || doneCount === 0}
          className="inline-flex items-center gap-2 rounded-full bg-admin-primary px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {saving ? 'Enregistrement…' : 'Tout enregistrer'}
        </button>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-md bg-admin-soft/40 px-1.5 py-0.5 text-admin-ink-soft">
      <span className="font-semibold text-admin-primary-dark">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') onChange(null);
          else {
            const n = Number(v);
            onChange(Number.isFinite(n) ? n : null);
          }
        }}
        className="w-12 rounded border border-admin-border bg-white px-1 py-0.5 text-right text-xs outline-none focus:border-admin-primary"
      />
      {suffix && <span>{suffix}</span>}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-composants UI                                                           */
/* -------------------------------------------------------------------------- */

function Stepper({ step }: { step: Step }) {
  const labels: Array<{ key: Step; label: string }> = [
    { key: 'config', label: 'Infos + images' },
    { key: 'upload', label: 'Fichiers recettes' },
    { key: 'review', label: 'Relecture' },
    { key: 'done', label: 'Terminé' },
  ];
  const activeIdx = labels.findIndex((l) => l.key === step);
  const normalizedIdx =
    step === 'saving' ? labels.findIndex((l) => l.key === 'review') : activeIdx;

  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {labels.map((l, i) => {
        const active = i === normalizedIdx;
        const past = i < normalizedIdx;
        return (
          <li
            key={l.key}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold transition-colors ${
              active
                ? 'bg-admin-primary text-white shadow-sm'
                : past
                  ? 'bg-admin-soft text-admin-primary-dark'
                  : 'bg-admin-soft/40 text-admin-ink-soft'
            }`}
          >
            <span className="grid h-4 w-4 place-items-center rounded-full bg-white/40 text-[0.6rem] font-bold">
              {i + 1}
            </span>
            {l.label}
          </li>
        );
      })}
    </ol>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-admin-surface">
      <div
        className="h-full rounded-full bg-admin-primary transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers : upload d'asset                                                    */
/* -------------------------------------------------------------------------- */

async function uploadAsset(
  menuId: string,
  type: 'cover' | 'shopping',
  file: File,
  opts: { maxDim: number; quality: number; skipBelowKB: number },
): Promise<void> {
  const compressed = await compressImage(file, opts);
  const fd = new FormData();
  fd.set('type', type);
  fd.set('file', compressed);
  const res = await fetch(`/api/admin/menus/${menuId}/asset`, {
    method: 'PUT',
    body: fd,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.error || `Upload ${type} échoué`);
  }
}

