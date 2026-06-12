import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';

export type Utensil = {
  id: string;
  slug: string;
  label: string;
  imageUrl: string | null;
};

/** Liste tout le catalogue d'ustensiles (admin). Trié par label. */
export async function getAllUtensils(): Promise<Utensil[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('utensils')
    .select('id, slug, label, image_url')
    .order('label', { ascending: true });
  if (error) {
    console.warn('[utensils] getAll', error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    label: String(r.label),
    imageUrl: r.image_url ?? null,
  }));
}

/**
 * Catalogue d'ustensiles AUTO-ALIMENTÉ.
 *
 * L'extraction Vision déduit des ustensiles (ex: "enfourner" → four) en
 * noms canoniques SINGULIERS. On ne singularise pas algorithmiquement
 * (trop risqué en français : "ciseaux" est invariable) — c'est le prompt
 * Vision qui renvoie déjà le singulier. Ici on se contente de :
 *   1. normaliser en slug (minuscule, sans accent) → clé de dédup
 *   2. upserter dans public.utensils (insert si le slug n'existe pas)
 *
 * Karine cure ensuite la liste dans l'admin (image, fusion, renommage).
 */

/** Slug normalisé d'un ustensile : minuscule, sans accent, tirets. */
export function slugifyUtensil(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les diacritiques
    .replace(/[^a-z0-9]+/g, '-') // tout le reste → tiret
    .replace(/^-+|-+$/g, ''); // trim des tirets
}

/** Label d'affichage propre : trim + 1ʳᵉ lettre en minuscule (ex: "Four" → "four"). */
function cleanLabel(label: string): string {
  const t = label.trim().replace(/\s+/g, ' ');
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/**
 * Normalise + déduplique une liste de labels d'ustensiles, upsert le
 * catalogue `utensils`, et renvoie la liste ORDONNÉE et DÉDUPLIQUÉE des
 * slugs (à stocker sur la fiche).
 *
 * - Les entrées vides / non-slugifiables sont ignorées.
 * - Insert uniquement les slugs absents (pas d'écrasement du label/image
 *   déjà curés par Karine).
 * - Tolérant : si l'insert échoue (catalogue indispo, RLS…), on renvoie
 *   quand même les slugs pour ne pas bloquer la sauvegarde de la fiche.
 */
export async function upsertUtensils(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  labels: unknown,
): Promise<string[]> {
  if (!Array.isArray(labels)) return [];

  // 1. Normalise + dédup en gardant l'ordre, slug → label canonique.
  const bySlug = new Map<string, string>();
  for (const raw of labels) {
    if (typeof raw !== 'string') continue;
    const label = cleanLabel(raw);
    const slug = slugifyUtensil(label);
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, label);
  }
  const slugs = [...bySlug.keys()];
  if (slugs.length === 0) return [];

  try {
    const rows = slugs.map((slug) => ({ slug, label: bySlug.get(slug)! }));
    // upsert ON CONFLICT DO NOTHING : insère les nouveaux slugs, laisse
    // les existants INTACTS (préserve label/image déjà curés par Karine).
    // ignoreDuplicates → race-safe : pas d'échec si un autre save insère
    // le même slug en parallèle (contrairement à un INSERT atomique).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('utensils')
      .upsert(rows, { onConflict: 'slug', ignoreDuplicates: true });
  } catch (e) {
    console.warn('[utensils] upsert non bloquant échoué:', e);
  }

  return slugs;
}
