'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { compressImage } from '@/lib/compress-image';

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

/**
 * Création d'une recette — flow simplifié :
 *   1. Karine choisit catégorie + status + upload cover principale
 *   2. POST /api/admin/recipes : Vision Haiku lit la cover et extrait
 *      le titre (+ tout le reste si la cover EST elle-même une fiche
 *      détaillée complète).
 *   3. Redirect vers /admin/recettes/[slug] où Karine ajoute les
 *      fiches détaillées via RecipeSheetsEditor.
 */
export function RecipeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [defaultTitle, setDefaultTitle] = useState('');
  const coverRef = useRef<HTMLInputElement | null>(null);

  // PWA share-target : précharge depuis le cache si arrivée via ?shared=1
  useEffect(() => {
    if (searchParams.get('shared') !== '1') return;
    (async () => {
      const shared = await loadSharedFiles();
      if (!shared || shared.files.length === 0) return;
      if (shared.title) setDefaultTitle(shared.title);
      const [first] = shared.files;
      setInputFiles(coverRef.current, [first]);
      setCoverPreview(URL.createObjectURL(first));
    })();
  }, [searchParams]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const formEl = e.currentTarget;
      const fd = new FormData();
      for (const el of Array.from(formEl.elements)) {
        const input = el as HTMLInputElement;
        if (!input.name) continue;
        if (input.type === 'file') continue;
        if (input.type === 'checkbox') {
          if (input.checked) fd.set(input.name, input.value || 'on');
        } else {
          fd.set(input.name, input.value);
        }
      }
      const coverFile = (formEl.elements.namedItem('cover') as HTMLInputElement | null)?.files?.[0];
      if (!coverFile) throw new Error('Image principale requise');
      try {
        const compressed = await compressImage(coverFile, {
          maxDim: 1600,
          quality: 0.82,
        });
        fd.set('cover', compressed);
      } catch {
        fd.set('cover', coverFile);
      }
      const res = await fetch('/api/admin/recipes', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Erreur création');
      router.push(`/admin/recettes/${json.slug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white/85 p-6 shadow-sm">
      {searchParams.get('shared') === '1' && coverPreview && (
        <div className="rounded-lg border border-sage bg-sage/10 px-3 py-2 text-sm text-ink">
          ✨ Image partagée préchargée. Complète les champs ci-dessous puis crée la recette.
        </div>
      )}

      <div className="rounded-xl border border-coral-soft/50 bg-coral-soft/10 px-3 py-2.5 text-xs text-ink-soft">
        <strong className="font-bold text-coral-dark">✨ Création simplifiée :</strong>{' '}
        upload juste l&apos;image principale, Claude Vision (Haiku 4.5) lit
        le titre automatiquement. Tu ajouteras les fiches détaillées
        (chacune = une recette à part entière) sur la page suivante.
      </div>

      <Field label="Image principale (Main)" required>
        <input
          ref={coverRef}
          name="cover"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
          required
          onChange={(e) => {
            const f = e.target.files?.[0];
            setCoverPreview(f ? URL.createObjectURL(f) : null);
          }}
          className="file-input"
        />
        {coverPreview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverPreview}
            alt=""
            className="mt-2 h-32 w-32 rounded-lg object-cover shadow-sm"
          />
        )}
      </Field>

      <Field label="Titre (optionnel — sinon extrait de l'image)">
        <input
          name="title"
          defaultValue={defaultTitle}
          placeholder="Laisser vide pour extraction automatique"
          className="input"
        />
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
          <option value="sur_le_pouce">Sur le pouce</option>
        </select>
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

      <Field label="Statut">
        <select name="status" defaultValue="draft" className="input">
          <option value="draft">Brouillon</option>
          <option value="published">Publiée</option>
        </select>
      </Field>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-coral px-4 py-3 text-base font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Vision analyse l&apos;image…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Créer la recette
          </>
        )}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
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
