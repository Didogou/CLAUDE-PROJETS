'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { compressImage, compressMany } from '@/lib/compress-image';

const SHARE_CACHE = 'karine-share-target';

async function loadSharedFiles(): Promise<{ title: string; files: File[] } | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match('/__share_meta');
    if (!metaRes) return null;
    const meta = (await metaRes.json()) as { title?: string; count: number };
    const files: File[] = [];
    for (let i = 0; i < (meta.count ?? 0); i++) {
      const r = await cache.match(`/__share_file_${i}`);
      if (!r) continue;
      const name = decodeURIComponent(r.headers.get('X-File-Name') || `shared-${i}.png`);
      const type = r.headers.get('Content-Type') || 'image/png';
      const blob = await r.blob();
      files.push(new File([blob], name, { type }));
    }
    // purge after loading
    for (const k of await cache.keys()) await cache.delete(k);
    return { title: meta.title ?? '', files };
  } catch {
    return null;
  }
}

function setInputFiles(input: HTMLInputElement | null, files: File[]) {
  if (!input) return;
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  input.files = dt.files;
}

export function RecipeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<{ cover?: string; slides: string[] }>({ slides: [] });
  const [defaultTitle, setDefaultTitle] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const coverRef = useRef<HTMLInputElement | null>(null);
  const slidesRef = useRef<HTMLInputElement | null>(null);

  // PWA share-target : si on arrive avec ?shared=1, on précharge les images du cache
  useEffect(() => {
    if (searchParams.get('shared') !== '1') return;
    (async () => {
      const shared = await loadSharedFiles();
      if (!shared || shared.files.length === 0) return;
      if (shared.title) setDefaultTitle(shared.title);
      const [first, ...rest] = shared.files;
      setInputFiles(coverRef.current, [first]);
      setInputFiles(slidesRef.current, rest);
      setPreviews({
        cover: URL.createObjectURL(first),
        slides: rest.map((f) => URL.createObjectURL(f)),
      });
    })();
  }, [searchParams]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const formEl = e.currentTarget;
      // === Phase 1 : POST texte + cover seulement ===
      // (slides et prepPhotos uploadés un par un en phase 2 pour éviter le 413)
      setProgress({ done: 0, total: 0, label: 'Création de la recette…' });
      const phase1 = new FormData();
      for (const el of Array.from(formEl.elements)) {
        const input = el as HTMLInputElement;
        if (!input.name) continue;
        if (input.type === 'file') continue;
        if (input.type === 'checkbox') {
          if (input.checked) phase1.set(input.name, input.value || 'on');
        } else {
          phase1.set(input.name, input.value);
        }
      }
      // Cover compressée (1 fichier seul → toujours sous 4,5 MB après compression agressive)
      const coverFile = (formEl.elements.namedItem('cover') as HTMLInputElement | null)?.files?.[0];
      if (!coverFile) throw new Error('Image principale requise');
      try {
        const compressedCover = await compressImage(coverFile, {
          maxDim: 1200,
          quality: 0.78,
        });
        phase1.set('cover', compressedCover);
      } catch {
        // Fallback : envoie le fichier original (taille à risque)
        phase1.set('cover', coverFile);
      }
      const res1 = await fetch('/api/admin/recipes', { method: 'POST', body: phase1 });
      const json1 = await res1.json().catch(() => ({}));
      if (!res1.ok) throw new Error(json1?.error || 'Erreur création recette');
      const newSlug: string = json1.slug;

      // === Phase 2 : upload incrémental des slides + prep photos ===
      const slideFiles = Array.from(
        (formEl.elements.namedItem('slides') as HTMLInputElement | null)?.files ?? [],
      );
      const prepFiles = Array.from(
        (formEl.elements.namedItem('prepPhotos') as HTMLInputElement | null)?.files ?? [],
      );
      const totalAssets = slideFiles.length + prepFiles.length;
      setProgress({ done: 0, total: totalAssets, label: '' });

      const opts = { maxDim: 1200, quality: 0.78, skipBelowKB: 150 };
      let k = 0;

      for (const f of slideFiles) {
        setProgress({ done: k, total: totalAssets, label: `Envoi de la slide ${k + 1}/${totalAssets}…` });
        let compressed: File;
        try {
          compressed = await compressImage(f, opts);
        } catch {
          compressed = f;
        }
        const fd = new FormData();
        fd.set('type', 'slide');
        fd.set('file', compressed);
        const r = await fetch(`/api/admin/recipes/${newSlug}/asset`, { method: 'POST', body: fd });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error || `Échec slide ${k + 1}`);
        }
        k++;
        setProgress({ done: k, total: totalAssets, label: '' });
      }

      for (const f of prepFiles) {
        setProgress({ done: k, total: totalAssets, label: `Envoi de la photo ${k + 1}/${totalAssets}…` });
        let compressed: File;
        try {
          compressed = await compressImage(f, opts);
        } catch {
          compressed = f;
        }
        const fd = new FormData();
        fd.set('type', 'prep');
        fd.set('file', compressed);
        const r = await fetch(`/api/admin/recipes/${newSlug}/asset`, { method: 'POST', body: fd });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error || `Échec photo ${k - slideFiles.length + 1}`);
        }
        k++;
        setProgress({ done: k, total: totalAssets, label: '' });
      }
      setProgress({ done: totalAssets, total: totalAssets, label: 'Terminé ✓' });
      router.push('/admin/recettes');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white/85 p-6 shadow-sm">
      {searchParams.get('shared') === '1' && previews.cover && (
        <div className="rounded-lg border border-sage bg-sage/10 px-3 py-2 text-sm text-ink">
          ✨ Image partagée préchargée. Complète les champs ci-dessous puis publie.
        </div>
      )}

      <Field label="Titre" required>
        <input name="title" required defaultValue={defaultTitle} placeholder="ex. Brownie healthy" className="input" />
      </Field>

      <Field label="Catégorie" required>
        <select name="category" required defaultValue="" className="input">
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

      <Field label="Calories (par portion)">
        <input name="calories" type="number" min="0" placeholder="ex. 180" className="input" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Préparation (min)">
          <input name="prepTimeMin" type="number" min="0" placeholder="ex. 15" className="input" />
        </Field>
        <Field label="Cuisson (min)">
          <input name="cookTimeMin" type="number" min="0" placeholder="ex. 30" className="input" />
        </Field>
        <Field label="Pour X personnes">
          <input
            name="servings"
            type="number"
            min="1"
            max="20"
            defaultValue="4"
            className="input"
          />
        </Field>
      </div>

      <Field label="Ingrédients (un par ligne — Claude extrait automatiquement)">
        <textarea
          name="ingredientsText"
          rows={8}
          placeholder={`Exemple :\n200 g de feta\n3 tomates mûres\n1 oignon\nHuile d'olive\nSel, poivre`}
          className="input min-h-[10rem] resize-y font-mono text-sm"
        />
        <p className="mt-1 text-xs text-ink-soft">
          ✨ Au save, Claude lit ce texte et le transforme en liste structurée
          (catégorie / qté / unité). Permet aux utilisateurs d&apos;ajouter
          cette recette à leur liste de courses.
        </p>
      </Field>

      <Field label="Tags (séparés par des virgules)">
        <input name="tags" placeholder="healthy, chocolat, sans beurre" className="input" />
      </Field>

      <Field label="Aliments principaux (séparés par des virgules)">
        <input name="aliments" placeholder="compote de pommes, œufs, cacao" className="input" />
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-sage/40 bg-sage/10 p-3">
        <input type="checkbox" name="isSeasonal" className="mt-0.5 h-4 w-4 accent-sage" />
        <span>
          <span className="block text-sm font-semibold text-ink">🌿 De saison</span>
          <span className="block text-xs text-ink-soft">
            Cocher si la recette est préparée à partir d&apos;ingrédients de saison.
          </span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-coral/40 bg-coral/10 p-3">
        <input type="checkbox" name="isFeatured" className="mt-0.5 h-4 w-4 accent-coral" />
        <span>
          <span className="block text-sm font-semibold text-ink">⭐ Mettre à la une</span>
          <span className="block text-xs text-ink-soft">
            Affichée tout en haut de la pile de sa catégorie sur l&apos;accueil recettes.
          </span>
        </span>
      </label>

      <Field label="Image principale (Main)" required>
        <input
          ref={coverRef}
          name="cover"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          required
          className="file-input"
        />
        {previews.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previews.cover} alt="" className="mt-2 h-24 w-24 rounded-lg object-cover shadow-sm" />
        )}
      </Field>

      <Field label="Slides détaillés (plusieurs fichiers, ordre = ordre de tri)">
        <input
          ref={slidesRef}
          name="slides"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          multiple
          className="file-input"
        />
        {previews.slides.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {previews.slides.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="h-16 w-16 rounded-lg object-cover shadow-sm" />
            ))}
          </div>
        )}
      </Field>

      <Field label="Photos réelles de la préparation (optionnel — pellicule sous la fiche)">
        <input
          name="prepPhotos"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          multiple
          className="file-input"
        />
        <p className="mt-1 text-xs text-ink-soft">
          Photos prises par Karine pendant la préparation. Affichées en pellicule défilante.
        </p>
      </Field>

      <Field label="Statut">
        <select name="status" defaultValue="published" className="input">
          <option value="draft">Brouillon</option>
          <option value="published">Publiée</option>
        </select>
      </Field>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {progress.label && (
        <div className="rounded-lg border border-coral-soft bg-coral-soft/20 px-3 py-2 text-sm text-coral-dark">
          <p className="font-semibold">{progress.label}</p>
          {progress.total > 0 && (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-coral transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-coral py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-60"
      >
        {submitting
          ? progress.total > 0
            ? `Envoi… ${progress.done}/${progress.total}`
            : 'Création…'
          : 'Créer la recette'}
      </button>

      <style>{`
        .input { width: 100%; border-radius: 9999px; border: 1px solid rgba(226,120,141,0.4); background: #fff; padding: 0.5rem 0.875rem; font-size: 0.875rem; color: #4b4248; outline: none; }
        .input:focus { border-color: #e2788d; }
        .file-input { width: 100%; font-size: 0.875rem; color: #4b4248; }
        .file-input::file-selector-button { margin-right: 0.75rem; padding: 0.4rem 0.875rem; border-radius: 9999px; border: 0; background: #f6c9d3; color: #c75a73; font-weight: 600; cursor: pointer; }
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
      <span className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {required && <span className="ml-1 text-coral">*</span>}
      </span>
      {children}
    </label>
  );
}
