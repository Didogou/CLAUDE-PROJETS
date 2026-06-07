'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Trash2, X, ChevronUp, ChevronDown } from 'lucide-react';
import type { Recipe } from '@/data/recipes';
import { ConfirmModal } from './ConfirmModal';
import { compressImage, compressMany } from '@/lib/compress-image';

type RecipeWithStatus = Recipe & { status: string };

export function EditRecipeForm({ recipe }: { recipe: RecipeWithStatus }) {
  const router = useRouter();

  const [slides, setSlides] = useState<string[]>(recipe.slides);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [newSlideFiles, setNewSlideFiles] = useState<File[]>([]);
  const [prepPhotos, setPrepPhotos] = useState<string[]>(recipe.prepPhotos);
  const [newPrepFiles, setNewPrepFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Object URLs pour les previews des nouveaux fichiers (calculées au render).
  const newSlideUrls = useMemo(
    () => newSlideFiles.map((f) => URL.createObjectURL(f)),
    [newSlideFiles],
  );
  const newPrepUrls = useMemo(
    () => newPrepFiles.map((f) => URL.createObjectURL(f)),
    [newPrepFiles],
  );
  // Cleanup au démontage / changement de la liste pour éviter les leaks mémoire.
  useEffect(() => {
    return () => {
      newSlideUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [newSlideUrls]);
  useEffect(() => {
    return () => {
      newPrepUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [newPrepUrls]);

  function removeSlide(i: number) {
    setSlides((s) => s.filter((_, j) => j !== i));
  }
  function moveSlide(i: number, dir: -1 | 1) {
    setSlides((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function removeNewSlide(i: number) {
    setNewSlideFiles((arr) => arr.filter((_, j) => j !== i));
  }
  function removePrep(i: number) {
    setPrepPhotos((p) => p.filter((_, j) => j !== i));
  }
  function removeNewPrep(i: number) {
    setNewPrepFiles((arr) => arr.filter((_, j) => j !== i));
  }
  function onCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverPreview(file ? URL.createObjectURL(file) : null);
  }
  function onNewSlidesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []) as File[];
    setNewSlideFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  }
  function onNewPrepChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []) as File[];
    setNewPrepFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData(e.currentTarget);
      // L'ordre des slides existants est porté par notre state, pas par le DOM
      form.set('existingSlides', JSON.stringify(slides));

      // Compression cover si remplacée (évite Vercel 413).
      const coverFile = form.get('cover');
      if (coverFile instanceof File && coverFile.size > 0) {
        form.set('cover', await compressImage(coverFile));
      } else {
        form.delete('cover');
      }

      // Compression nouveaux slides.
      form.delete('newSlides');
      const compressedSlides = await compressMany(newSlideFiles);
      compressedSlides.forEach((f) => form.append('newSlides', f));

      // Prep photos : URLs existantes (state) + nouveaux fichiers compressés
      form.set('existingPrepPhotos', JSON.stringify(prepPhotos));
      form.delete('newPrepPhotos');
      const compressedPrep = await compressMany(newPrepFiles);
      compressedPrep.forEach((f) => form.append('newPrepPhotos', f));

      const res = await fetch(`/api/admin/recipes/${recipe.id}`, {
        method: 'PATCH',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Erreur');
      router.push('/admin/recettes');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setSubmitting(false);
    }
  }

  async function performDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/recipes/${recipe.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Erreur');
      }
      router.push('/admin/recettes');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-admin-surface p-6 shadow-sm">
      <Field label="Titre" required>
        <input name="title" required defaultValue={recipe.title} className="input" />
      </Field>

      <Field label="Catégorie" required>
        <select name="category" required defaultValue={recipe.category} className="input">
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
          <option value="sur_le_pouce">Sur le pouce</option>
        </select>
      </Field>

      <div className="rounded-xl border border-coral-soft/50 bg-coral-soft/10 p-3 text-xs text-admin-ink-soft">
        💡 <strong>Calories, temps, ingrédients, tags et aliments</strong>{' '}
        sont désormais gérés <strong>par fiche détaillée</strong> dans la section
        ci-dessous (chaque variante a ses propres valeurs).
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-sage/40 bg-sage/10 p-3">
        <input
          type="checkbox"
          name="isSeasonal"
          defaultChecked={recipe.isSeasonal}
          className="mt-0.5 h-4 w-4 accent-sage"
        />
        <span>
          <span className="block text-sm font-semibold text-admin-ink">🌿 De saison</span>
          <span className="block text-xs text-admin-ink-soft">
            Cocher si la recette est préparée à partir d&apos;ingrédients de saison.
          </span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-admin-primary/40 bg-admin-soft p-3">
        <input
          type="checkbox"
          name="isFeatured"
          defaultChecked={recipe.isFeatured}
          className="mt-0.5 h-4 w-4 accent-admin-primary"
        />
        <span>
          <span className="block text-sm font-semibold text-admin-ink">⭐ Mettre à la une</span>
          <span className="block text-xs text-admin-ink-soft">
            Affichée tout en haut de la pile de sa catégorie sur l&apos;accueil recettes.
          </span>
        </span>
      </label>

      {/* Toggle "Tout le monde" : visibilité publique. Quand coché,
          la recette est accessible aux visiteurs non abonnés (mode
          découverte). Par défaut décoché → réservée aux abonnées. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-sage/40 bg-sage/5 p-3">
        <input
          type="checkbox"
          name="isPublic"
          defaultChecked={recipe.isPublic}
          className="mt-0.5 h-4 w-4 accent-sage"
        />
        <span>
          <span className="block text-sm font-semibold text-admin-ink">
            🌍 Tout le monde
          </span>
          <span className="block text-xs text-admin-ink-soft">
            Recette accessible aux visiteuses non abonnées (mode
            découverte). Sinon, réservée aux abonnées et patientes.
          </span>
        </span>
      </label>

      <Field label="Statut">
        <select name="status" defaultValue={recipe.status} className="input">
          <option value="draft">Brouillon</option>
          <option value="published">Publiée</option>
        </select>
      </Field>

      {/* Cover */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-admin-ink">Image principale</p>
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="block h-24 w-24 shrink-0 rounded-lg bg-cover bg-center shadow-sm"
            style={{ backgroundImage: `url(${coverPreview || recipe.coverImage})` }}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <input
              name="cover"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
              onChange={onCoverChange}
              className="file-input"
            />
            <p className="text-xs text-admin-ink-soft">
              Laisse vide pour conserver l’image actuelle.
            </p>
          </div>
        </div>
      </div>

      {/* Slides existants */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-admin-ink">
          Slides ({slides.length + newSlideFiles.length})
        </p>
        {slides.length === 0 && newSlideFiles.length === 0 && (
          <p className="text-xs text-admin-ink-soft">Aucun slide pour l’instant.</p>
        )}

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {slides.map((url, i) => (
            <div
              key={url + i}
              className="relative aspect-square overflow-hidden rounded-lg bg-cover bg-center shadow-sm ring-1 ring-admin-border"
              style={{ backgroundImage: `url(${url})` }}
            >
              <span className="absolute left-1 top-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-admin-primary px-1 text-[0.6rem] font-bold text-white">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeSlide(i)}
                aria-label="Retirer ce slide"
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-admin-ink-soft transition hover:bg-white hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="absolute bottom-1 right-1 flex gap-0.5">
                <button
                  type="button"
                  onClick={() => moveSlide(i, -1)}
                  disabled={i === 0}
                  aria-label="Monter"
                  className="grid h-6 w-6 place-items-center rounded-full bg-white/90 text-admin-ink-soft transition hover:bg-white disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveSlide(i, 1)}
                  disabled={i === slides.length - 1}
                  aria-label="Descendre"
                  className="grid h-6 w-6 place-items-center rounded-full bg-white/90 text-admin-ink-soft transition hover:bg-white disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {newSlideFiles.map((f, i) => (
            <div
              key={`new-${i}-${f.name}`}
              className="relative aspect-square overflow-hidden rounded-lg bg-cover bg-center shadow-sm ring-2 ring-sage"
              style={{ backgroundImage: `url(${newSlideUrls[i] ?? ''})` }}
            >
              <span className="absolute left-1 top-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-sage px-1 text-[0.6rem] font-bold text-white">
                +
              </span>
              <button
                type="button"
                onClick={() => removeNewSlide(i)}
                aria-label="Annuler cet ajout"
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-admin-ink-soft transition hover:bg-white hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div>
          <input
            name="newSlides"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            multiple
            onChange={onNewSlidesChange}
            className="file-input"
          />
        </div>
      </div>

      {/* Photos réelles de la préparation (pellicule) */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-admin-ink">
          Photos de préparation ({prepPhotos.length + newPrepFiles.length})
        </p>
        <p className="text-xs text-admin-ink-soft">
          Optionnel — photos prises pendant la préparation, affichées en pellicule sous la fiche.
        </p>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {prepPhotos.map((url, i) => (
            <div
              key={url + i}
              className="relative aspect-square overflow-hidden rounded-lg bg-cover bg-center shadow-sm ring-1 ring-admin-border"
              style={{ backgroundImage: `url(${url})` }}
            >
              <button
                type="button"
                onClick={() => removePrep(i)}
                aria-label="Retirer cette photo"
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-admin-ink-soft transition hover:bg-white hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {newPrepFiles.map((f, i) => (
            <div
              key={`new-prep-${i}-${f.name}`}
              className="relative aspect-square overflow-hidden rounded-lg bg-cover bg-center shadow-sm ring-2 ring-sage"
              style={{ backgroundImage: `url(${newPrepUrls[i] ?? ''})` }}
            >
              <span className="absolute left-1 top-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-sage px-1 text-[0.6rem] font-bold text-white">
                +
              </span>
              <button
                type="button"
                onClick={() => removeNewPrep(i)}
                aria-label="Annuler cet ajout"
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-admin-ink-soft transition hover:bg-white hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div>
          <input
            name="newPrepPhotos"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            multiple
            onChange={onNewPrepChange}
            className="file-input"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <button
          type="submit"
          disabled={submitting || deleting}
          className="w-full rounded-full bg-admin-primary py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-60"
        >
          {submitting ? 'Enregistrement…' : 'Enregistrer les modifications'}
        </button>
        <button
          type="button"
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={submitting || deleting}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-red-300 bg-red-50 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {deleting ? 'Suppression…' : 'Supprimer définitivement la recette'}
        </button>
      </div>

      <ConfirmModal
        open={confirmDeleteOpen}
        variant="danger"
        loading={deleting}
        title="Supprimer cette recette ?"
        confirmLabel="Supprimer"
        message={
          <>
            <p>
              <span className="font-semibold text-admin-ink">«&nbsp;{recipe.title}&nbsp;»</span>{' '}
              sera supprimée définitivement, ainsi que tous ses slides et images uploadés.
            </p>
            <p className="mt-2 text-xs">Cette action est irréversible.</p>
          </>
        }
        onConfirm={performDelete}
        onCancel={() => !deleting && setConfirmDeleteOpen(false)}
      />

      <style>{`
        .input { width: 100%; border-radius: 9999px; border: 1px solid var(--color-admin-border); background: #fff; padding: 0.5rem 0.875rem; font-size: 0.875rem; color: var(--color-admin-ink); outline: none; }
        .input:focus { border-color: var(--color-admin-primary); }
        .file-input { width: 100%; font-size: 0.875rem; color: var(--color-admin-ink); }
        .file-input::file-selector-button { margin-right: 0.75rem; padding: 0.4rem 0.875rem; border-radius: 9999px; border: 0; background: var(--color-admin-soft); color: var(--color-admin-primary-dark); font-weight: 600; cursor: pointer; }
      `}</style>
    </form>
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
