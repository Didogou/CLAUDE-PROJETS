'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
} from 'react';
import { Trash2, Upload, X } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { ShoppingListEditor } from './ShoppingListEditor';
import { MealSheetEditor } from './MealSheetEditor';
import { compressImage } from '@/lib/compress-image';
import type { WeeklyMenu, ShoppingListItem } from '@/data/menus';
import { DAYS_LABELS } from '@/data/menus';

type ShoppingPreviewData = {
  tempPath: string | null;
  portions: number;
  items: ShoppingListItem[];
};

/**
 * Helper : suppression d'une image existante côté serveur.
 * `type` cible la colonne, `dayIndex` est requis pour les types day_*,
 * `photoUrl` est requis pour day_prep (retire UNE photo du tableau).
 */
async function deleteAsset(
  menuId: string,
  type: 'cover' | 'shopping' | 'day_cover' | 'day_lunch' | 'day_dinner' | 'day_prep',
  opts: { dayIndex?: number; photoUrl?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/admin/menus/${menuId}/asset`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, ...opts }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, error: j?.error || 'Erreur' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur réseau' };
  }
}

/**
 * Sérialise les inputs texte/select du form pour le sauvegarder en localStorage.
 * Les fichiers (input file) ne peuvent PAS être sauvegardés — c'est une limitation
 * navigateur. Mais au moins on garde tout le texte si la page crash / refresh.
 */
function snapshotForm(formEl: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  const data = new FormData(formEl);
  for (const [k, v] of data.entries()) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function applySnapshot(formEl: HTMLFormElement, snap: Record<string, string>) {
  for (const [k, v] of Object.entries(snap)) {
    const input = formEl.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null;
    if (input && 'value' in input) input.value = v;
  }
}

type RecipeOption = { slug: string; title: string };

type Props = {
  /** Si défini, mode édition. Sinon création. */
  menu?: WeeklyMenu;
  /** Toutes les recettes (tous statuts) pour le dropdown "lier à une recette". */
  recipeOptions: RecipeOption[];
};

export function MenuForm({ menu, recipeOptions }: Props) {
  const router = useRouter();
  const isEdit = Boolean(menu);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [shoppingPreview, setShoppingPreview] = useState<string | null>(null);
  // Liste de courses extraite par Vision DANS la page création (mode !isEdit).
  // En mode édition, ShoppingListEditor sauve directement via PUT sans
  // remonter de données ici.
  const [shoppingPreviewData, setShoppingPreviewData] =
    useState<ShoppingPreviewData | null>(null);
  // Stabilise la référence du callback pour éviter de retrigger
  // le useEffect interne de ShoppingListEditor à chaque render parent.
  const onShoppingPreviewChange = useCallback((data: ShoppingPreviewData | null) => {
    setShoppingPreviewData(data);
  }, []);
  // Previews par jour×repas — clé "lunch-0" / "dinner-3" / …
  const [dayPreviews, setDayPreviews] = useState<Record<string, string>>({});

  const formRef = useRef<HTMLFormElement | null>(null);
  const draftKey = isEdit ? `karine-menu-draft-${menu!.id}` : 'karine-menu-draft-new';

  // Autosave + restore : sécurité si la page crash / l'user navigue par erreur.
  // Sauve uniquement les CHAMPS TEXTE (les fichiers sont perdus de toute façon).
  useEffect(() => {
    if (!formRef.current) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const snap = JSON.parse(raw) as Record<string, string>;
        applySnapshot(formRef.current, snap);
        setRestoredFromDraft(true);
      }
    } catch {
      /* ignore */
    }
    const itv = setInterval(() => {
      if (!formRef.current) return;
      try {
        localStorage.setItem(draftKey, JSON.stringify(snapshotForm(formRef.current)));
      } catch {
        /* localStorage plein → ignore */
      }
    }, 2000);
    return () => clearInterval(itv);
  }, [draftKey]);

  function onCoverChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverPreview(file ? URL.createObjectURL(file) : null);
  }
  function onShoppingChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (shoppingPreview) URL.revokeObjectURL(shoppingPreview);
    setShoppingPreview(file ? URL.createObjectURL(file) : null);
  }
  function onDayImageChange(key: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setDayPreviews((prev) => {
      const next = { ...prev };
      if (next[key]) URL.revokeObjectURL(next[key]);
      if (file) next[key] = URL.createObjectURL(file);
      else delete next[key];
      return next;
    });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setProgressLabel('Création du menu…');

    try {
      const formEl = e.currentTarget;
      const opts = { maxDim: 1200, quality: 0.8, skipBelowKB: 150 };

      // === PHASE 1 : envoi du TEXTE uniquement (création/MAJ du menu) ===
      const textForm = new FormData();
      // Copie tous les champs SAUF les inputs file
      for (const el of Array.from(formEl.elements)) {
        const input = el as HTMLInputElement;
        if (!input.name) continue;
        if (input.type === 'file') continue;
        if (input.type === 'checkbox') {
          if (input.checked) textForm.set(input.name, input.value || 'on');
        } else {
          textForm.set(input.name, input.value);
        }
      }

      // Liste de courses pré-analysée en création : on inclut les données
      // pour que la route POST move l'image temp + sauve portions/items en
      // une seule fois.
      if (!isEdit && shoppingPreviewData) {
        if (shoppingPreviewData.tempPath)
          textForm.set('shopping_list_temp_path', shoppingPreviewData.tempPath);
        textForm.set('shopping_list_portions', String(shoppingPreviewData.portions));
        textForm.set('shopping_list_items', JSON.stringify(shoppingPreviewData.items));
      }

      const url = isEdit ? `/api/admin/menus/${menu!.id}` : '/api/admin/menus';
      const textRes = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        body: textForm,
      });
      const textJson = await textRes.json().catch(() => ({}));
      if (!textRes.ok) throw new Error(textJson?.error || 'Erreur création menu');
      const menuId: string = isEdit ? menu!.id : textJson.id;

      // === PHASE 2 : upload des images, UNE PAR UNE ===
      // Collecte tous les fichiers à uploader (cover, shopping, et les 3×7 jours)
      type AssetJob = { type: string; dayIndex?: number; file: File };
      const jobs: AssetJob[] = [];
      const cover = (formEl.elements.namedItem('cover') as HTMLInputElement | null)?.files?.[0];
      if (cover) jobs.push({ type: 'cover', file: cover });
      const shopping = (formEl.elements.namedItem('shoppingList') as HTMLInputElement | null)?.files?.[0];
      if (shopping) jobs.push({ type: 'shopping', file: shopping });
      for (let i = 0; i < 7; i++) {
        const dayCover = (formEl.elements.namedItem(`cover_image_${i}`) as HTMLInputElement | null)?.files?.[0];
        if (dayCover) jobs.push({ type: 'day_cover', dayIndex: i, file: dayCover });
        const lunch = (formEl.elements.namedItem(`lunch_image_${i}`) as HTMLInputElement | null)?.files?.[0];
        if (lunch) jobs.push({ type: 'day_lunch', dayIndex: i, file: lunch });
        const dinner = (formEl.elements.namedItem(`dinner_image_${i}`) as HTMLInputElement | null)?.files?.[0];
        if (dinner) jobs.push({ type: 'day_dinner', dayIndex: i, file: dinner });
        // Pellicule "En vrai" : potentiellement plusieurs photos
        const prepInput = formEl.elements.namedItem(`prep_photos_${i}`) as HTMLInputElement | null;
        if (prepInput?.files) {
          for (const f of Array.from(prepInput.files)) {
            jobs.push({ type: 'day_prep', dayIndex: i, file: f });
          }
        }
      }

      setProgress({ done: 0, total: jobs.length });
      for (let k = 0; k < jobs.length; k++) {
        const job = jobs[k];
        setProgressLabel(`Envoi de l'image ${k + 1}/${jobs.length}…`);
        const compressed = await compressImage(job.file, opts);
        const fd = new FormData();
        fd.set('type', job.type);
        if (job.dayIndex != null) fd.set('dayIndex', String(job.dayIndex));
        fd.set('file', compressed);
        const r = await fetch(`/api/admin/menus/${menuId}/asset`, { method: 'PUT', body: fd });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error || `Échec upload image ${k + 1}`);
        }
        setProgress({ done: k + 1, total: jobs.length });
      }

      // Succès → on efface le brouillon
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      setProgressLabel('Terminé ✓');
      router.push('/admin/menus');
      router.refresh();
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : 'Erreur') +
          ' — Votre saisie est conservée, vous pouvez réessayer.',
      );
      setSubmitting(false);
      setProgressLabel(null);
    }
  }

  async function performDelete() {
    if (!menu) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/menus/${menu.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Erreur');
      }
      router.push('/admin/menus');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }

  const defaultDay = (i: number) => menu?.days.find((d) => d.dayIndex === i);
  const coverBg = coverPreview || menu?.coverImageUrl || '';
  const shoppingBg = shoppingPreview || menu?.shoppingListImageUrl || '';

  /**
   * Wrapper qui appelle deleteAsset puis rafraîchit la page.
   * Marche uniquement en mode édition (menu existe).
   */
  async function handleDelete(
    type: 'cover' | 'shopping' | 'day_cover' | 'day_lunch' | 'day_dinner' | 'day_prep',
    opts: { dayIndex?: number; photoUrl?: string } = {},
  ) {
    if (!menu) return;
    const { ok, error: err } = await deleteAsset(menu.id, type, opts);
    if (!ok) {
      setError(err || 'Impossible de supprimer cette image');
      return;
    }
    router.refresh();
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-5 rounded-2xl bg-admin-surface p-6 shadow-sm"
    >
      {restoredFromDraft && (
        <div className="rounded-lg border border-sage/40 bg-sage/10 px-3 py-2 text-xs text-sage">
          ✓ Brouillon précédent restauré. Les images doivent être re-sélectionnées (limitation
          navigateur).
        </div>
      )}
      <Field label="Lundi de la semaine" required>
        <input
          name="weekStart"
          type="date"
          required
          defaultValue={menu?.weekStart ?? ''}
          className="input"
        />
      </Field>

      <Field label="Titre (optionnel)">
        <input
          name="title"
          defaultValue={menu?.title ?? ''}
          placeholder="ex. Semaine du 26 mai"
          className="input"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Menu de la semaine (image Main_week)" required={!isEdit}>
          <ImagePickup
            bg={coverBg}
            required={!isEdit}
            name="cover"
            onChange={onCoverChange}
            hint={isEdit ? 'Laissez vide pour conserver l’image actuelle.' : undefined}
            serverBg={menu?.coverImageUrl || ''}
            onDelete={isEdit ? () => handleDelete('cover') : undefined}
          />
        </Field>
        <Field label="Liste de courses (image Liste_course_week)">
          <ImagePickup
            bg={shoppingBg}
            name="shoppingList"
            onChange={onShoppingChange}
            hint={
              isEdit
                ? 'Image seule (visuelle). Pour la liste cochable + multiplication par nb de personnes, utilise la zone ci-dessous.'
                : 'Image seule (legacy). Pour la liste cochable, utilise la zone ci-dessous.'
            }
            serverBg={menu?.shoppingListImageUrl || ''}
            onDelete={isEdit ? () => handleDelete('shopping') : undefined}
          />
        </Field>
      </div>

      {/* Liste de courses interactive (extraction Claude Vision + édition).
          - Mode édition : sauvegarde directe via PUT
          - Mode création : remonte les données au form parent via onChange,
            qui les inclut dans le POST de création (image temp move + items
            persistés en une seule transaction). */}
      <ShoppingListEditor
        menuId={isEdit && menu ? menu.id : null}
        initialImageUrl={menu?.shoppingListImageUrl || null}
        initialPortions={menu?.shoppingListPortions ?? null}
        initialItems={menu?.shoppingListItems ?? null}
        onChange={isEdit ? undefined : onShoppingPreviewChange}
      />

      {/* min-w-0 : un <fieldset> a un `min-width: min-content` par défaut
          (règle UA) qui IGNORE la largeur du parent et fait gonfler le bloc
          à la largeur de son contenu le plus large → débordement mobile,
          bordure droite hors viewport. min-w-0 neutralise ce comportement
          et laisse le fieldset se contraindre à la largeur du <form>. */}
      <fieldset className="min-w-0 space-y-3">
        <legend className="text-sm font-semibold text-admin-ink">Repas par jour</legend>
        {DAYS_LABELS.map((label, i) => {
          const initial = defaultDay(i);
          const coverKey = `cover_${i}`;
          const lunchKey = `lunch_${i}`;
          const dinnerKey = `dinner_${i}`;
          return (
            <section
              key={i}
              // Même className que <section> de ShoppingListEditor qui
              // gère parfaitement la largeur mobile (PAIN & AUTRES).
              className="min-w-0 space-y-3 rounded-2xl border border-admin-border bg-admin-surface/40 p-4"
            >
              <p className="text-sm font-bold uppercase tracking-wide text-admin-primary-dark">
                {label}
              </p>
              <CoverRow
                idx={i}
                initialImage={initial?.coverImageUrl ?? ''}
                preview={dayPreviews[coverKey]}
                onImageChange={(e) => onDayImageChange(coverKey, e)}
                onDelete={isEdit ? () => handleDelete('day_cover', { dayIndex: i }) : undefined}
              />
              {/* MealRow Déjeuner/Dîner retirés : depuis le refactor
                  Vision, ce sont les "Fiches recettes (Vision)" plus bas
                  qui font autorité (titre, image, ingrédients lus par
                  Haiku). Les champs lunch_label/dinner_label/etc. en
                  BDD restent acceptés vides — la migration ultérieure
                  remplacera leur lecture front par mealSheets[].title.
                  Les inputs hidden préservent les valeurs existantes
                  côté édition pour ne pas écraser un menu legacy. */}
              <input
                type="hidden"
                name={`day-${i}-lunch-label`}
                defaultValue={initial?.lunchLabel ?? ''}
              />
              <input
                type="hidden"
                name={`day-${i}-lunch-recipe`}
                defaultValue={initial?.lunchRecipeSlug ?? ''}
              />
              <input
                type="hidden"
                name={`day-${i}-dinner-label`}
                defaultValue={initial?.dinnerLabel ?? ''}
              />
              <input
                type="hidden"
                name={`day-${i}-dinner-recipe`}
                defaultValue={initial?.dinnerRecipeSlug ?? ''}
              />

              {/* Fiches Vision : upload image fiche déjeuner et fiche
                  dîner → Vision Haiku 4.5 extrait titre + ingredients
                  + calories + temps. Visible en édition uniquement
                  (besoin de menuId pour appeler l API). */}
              {isEdit && menu && (
                <div className="min-w-0 space-y-2 overflow-hidden rounded-xl border border-admin-border bg-admin-soft/30 p-3">
                  <p className="text-[0.65rem] font-bold uppercase tracking-wider text-admin-primary-dark">
                    🍽 Fiches recettes (Vision)
                  </p>
                  <MealSheetEditor
                    menuId={menu.id}
                    dayIndex={i}
                    mealKind="lunch"
                    initial={menu.mealSheets?.[i]?.lunch ?? null}
                  />
                  <MealSheetEditor
                    menuId={menu.id}
                    dayIndex={i}
                    mealKind="dinner"
                    initial={menu.mealSheets?.[i]?.dinner ?? null}
                  />
                </div>
              )}

              <PrepPhotosRow
                idx={i}
                existing={initial?.prepPhotos ?? []}
                onDeletePhoto={
                  isEdit
                    ? (url) => handleDelete('day_prep', { dayIndex: i, photoUrl: url })
                    : undefined
                }
              />
            </section>
          );
        })}
      </fieldset>

      <Field label="Statut">
        <select name="status" defaultValue={menu?.status ?? 'draft'} className="input">
          <option value="draft">Brouillon</option>
          <option value="published">Publié</option>
        </select>
      </Field>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {progressLabel && (
        <div className="rounded-lg border border-admin-primary/40 bg-admin-soft/60 px-3 py-2 text-sm text-admin-primary-dark">
          <p className="font-semibold">{progressLabel}</p>
          {progress.total > 0 && (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-admin-surface">
              <div
                className="h-full rounded-full bg-admin-primary transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <button
          type="submit"
          disabled={submitting || deleting}
          className="w-full rounded-full bg-admin-primary py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-60"
        >
          {submitting
            ? progress.total > 0
              ? `Envoi… ${progress.done}/${progress.total}`
              : 'Enregistrement…'
            : isEdit
              ? 'Enregistrer les modifications'
              : 'Créer le menu'}
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={submitting || deleting}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-red-300 bg-red-50 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? 'Suppression…' : 'Supprimer ce menu'}
          </button>
        )}
      </div>

      {isEdit && (
        <ConfirmModal
          open={confirmDeleteOpen}
          variant="danger"
          loading={deleting}
          title="Supprimer ce menu ?"
          confirmLabel="Supprimer"
          message={
            <p>
              Le menu, ses images et tous ses jours seront supprimés. Cette action est irréversible.
            </p>
          }
          onConfirm={performDelete}
          onCancel={() => !deleting && setConfirmDeleteOpen(false)}
        />
      )}

      <style>{`
        .input { width: 100%; border-radius: 9999px; border: 1px solid var(--color-admin-border); background: #fff; padding: 0.5rem 0.875rem; font-size: 0.875rem; color: var(--color-admin-ink); outline: none; }
        .input:focus { border-color: var(--color-admin-primary); }
        .file-input { width: 100%; font-size: 0.75rem; color: var(--color-admin-ink); }
        .file-input::file-selector-button { margin-right: 0.5rem; padding: 0.3rem 0.625rem; border-radius: 9999px; border: 0; background: var(--color-admin-soft); color: var(--color-admin-primary-dark); font-weight: 600; cursor: pointer; font-size: 0.75rem; }
      `}</style>
    </form>
  );
}

function PrepPhotosRow({
  idx,
  existing,
  onDeletePhoto,
}: {
  idx: number;
  existing: string[];
  onDeletePhoto?: (url: string) => void;
}) {
  return (
    <div className="space-y-1 rounded-lg bg-coral-soft/10 p-2">
      <p className="text-xs font-semibold text-admin-ink-soft">
        Pellicule « En vrai » ({existing.length} déjà en ligne)
      </p>
      {existing.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {existing.map((url, i) => (
            <span key={url + i} className="relative block h-12 w-12">
              <span
                aria-hidden
                className="block h-full w-full rounded-md bg-cover bg-center shadow-sm ring-1 ring-coral-soft"
                style={{ backgroundImage: `url(${url})` }}
              />
              {onDeletePhoto && (
                <button
                  type="button"
                  onClick={() => onDeletePhoto(url)}
                  aria-label="Supprimer cette photo"
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-white text-red-600 shadow ring-1 ring-red-300 transition hover:bg-red-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-full bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark">
        <Upload className="h-3.5 w-3.5" strokeWidth={2.4} />
        Sélect. fichiers
        <input
          name={`prep_photos_${idx}`}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          multiple
          className="hidden"
        />
      </label>
      <p className="text-[0.65rem] text-admin-ink-soft">
        Plusieurs photos possibles. Les nouvelles s&apos;ajoutent à la pellicule existante.
      </p>
    </div>
  );
}

function CoverRow({
  idx,
  initialImage,
  preview,
  onImageChange,
  onDelete,
}: {
  idx: number;
  initialImage: string;
  preview?: string;
  onImageChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onDelete?: () => void;
}) {
  const bg = preview || initialImage || '';
  return (
    // flex-wrap : si "Cover du jour" + thumbnail + bouton "Choisir"
    // dépasse la largeur dispo (~265px sur mobile étroit), le bouton
    // passe à la ligne au lieu de pousser tout hors viewport.
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-admin-soft/40 p-2">
      <p className="w-20 shrink-0 text-xs font-semibold text-admin-ink-soft">Cover du jour</p>
      <span className="relative block h-12 w-12 shrink-0">
        <span
          aria-hidden
          className="block h-full w-full rounded-lg bg-cover bg-center shadow-sm"
          style={{
            backgroundImage: bg ? `url(${bg})` : undefined,
            backgroundColor: 'var(--color-admin-surface)',
          }}
        />
        {initialImage && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Supprimer le cover"
            className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-white text-red-600 shadow ring-1 ring-red-300 transition hover:bg-red-100"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </span>
      {/* Pattern label-stylisé + input caché, copié sur
          ShoppingListEditor. L'input natif iOS faisait ~250px et
          débordait du viewport mobile. */}
      <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark">
        <Upload className="h-3.5 w-3.5" strokeWidth={2.4} />
        Choisir
        <input
          name={`cover_image_${idx}`}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          onChange={onImageChange}
          className="hidden"
        />
      </label>
    </div>
  );
}

function MealRow({
  kind,
  idx,
  fieldLabel,
  required = false,
  initialLabel,
  initialRecipe,
  initialImage,
  preview,
  onImageChange,
  onDelete,
  recipeOptions,
}: {
  kind: string;
  idx: number;
  fieldLabel: 'lunch' | 'dinner';
  required?: boolean;
  initialLabel: string;
  initialRecipe: string;
  initialImage: string;
  preview?: string;
  onImageChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onDelete?: () => void;
  recipeOptions: RecipeOption[];
}) {
  const bg = preview || initialImage || '';
  return (
    <div className="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_14rem]">
      <p className="text-xs font-semibold text-admin-ink-soft">
        {kind}
        {required && <span className="ml-0.5 text-admin-primary">*</span>}
      </p>
      <input
        name={`${fieldLabel}_label_${idx}`}
        required={required}
        defaultValue={initialLabel}
        placeholder={`Plat ${kind.toLowerCase()}${required ? '' : ' (optionnel)'}`}
        className="input min-w-0"
      />
      <select
        name={`${fieldLabel}_recipe_${idx}`}
        defaultValue={initialRecipe}
        className="input min-w-0"
        title="Lier à une recette de la banque (optionnel)"
      >
        <option value="">— pas de lien —</option>
        {recipeOptions.map((r) => (
          <option key={r.slug} value={r.slug}>
            {r.title}
          </option>
        ))}
      </select>
      <label className="flex min-w-0 items-center gap-2 text-xs">
        <span className="relative block h-10 w-10 shrink-0">
          <span
            aria-hidden
            className="block h-full w-full rounded-lg bg-cover bg-center shadow-sm"
            style={{
              backgroundImage: bg ? `url(${bg})` : undefined,
              backgroundColor: 'var(--color-admin-soft)',
            }}
          />
          {initialImage && onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onDelete();
              }}
              aria-label="Supprimer cette image"
              className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-white text-red-600 shadow ring-1 ring-red-300 transition hover:bg-red-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
        <input
          name={`${fieldLabel}_image_${idx}`}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          onChange={onImageChange}
          className="file-input min-w-0 flex-1"
        />
      </label>
    </div>
  );
}

function ImagePickup({
  bg,
  required,
  name,
  onChange,
  hint,
  serverBg,
  onDelete,
}: {
  bg: string;
  required?: boolean;
  name: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  hint?: string;
  /** URL serveur de l'image (différente d'un preview local) — pour décider si on affiche la croix de suppression. */
  serverBg?: string;
  onDelete?: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <span className="relative block h-20 w-20 shrink-0">
          <span
            aria-hidden
            className="block h-full w-full rounded-lg bg-cover bg-center shadow-sm"
            style={{
              backgroundImage: bg ? `url(${bg})` : undefined,
              backgroundColor: 'var(--color-admin-soft)',
            }}
          />
          {serverBg && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Supprimer l’image"
              className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-red-600 shadow ring-1 ring-red-300 transition hover:bg-red-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
        <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark">
          <Upload className="h-3.5 w-3.5" strokeWidth={2.4} />
          Choisir
          <input
            name={name}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            required={required}
            onChange={onChange}
            className="hidden"
          />
        </label>
      </div>
      {hint && <p className="text-xs text-admin-ink-soft">{hint}</p>}
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-admin-ink">
        {label}
        {required && <span className="ml-1 text-admin-primary">*</span>}
      </span>
      {children}
    </label>
  );
}
