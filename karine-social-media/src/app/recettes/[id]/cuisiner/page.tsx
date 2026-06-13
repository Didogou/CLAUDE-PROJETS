import { notFound, redirect } from 'next/navigation';
import { getRecipeBySlug } from '@/lib/recipes';
import { userHasPlanAccess } from '@/lib/user-access';
import { getAllUtensils } from '@/lib/utensils';
import { createServiceClient } from '@/lib/supabase/server';
import {
  RecipeCookView,
  type CookStepData,
} from '@/components/recettes/RecipeCookView';

export const dynamic = 'force-dynamic';

/** minuscule + sans accent + trim, pour matcher des libellés d'ingrédients. */
function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    // Stemming pluriel léger : « gousses » ↔ « gousse », « tomates » ↔
    // « tomate » — pour que les labels d'étape matchent ceux de la fiche.
    .split(/\s+/)
    .map((w) => (w.length >= 4 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

/**
 * Page "cuisine guidée" d'une recette : reprend la fiche (variante) choisie
 * et déroule ses étapes de préparation une par une (ustensiles + ingrédients
 * + voix). Même gate d'accès que la page recette (paywall).
 */
export default async function RecipeCookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sheet?: string }>;
}) {
  const { id } = await params;
  const { sheet: sheetParam } = await searchParams;

  const recipe = await getRecipeBySlug(id);
  if (!recipe || recipe.coverImage === '') notFound();

  const userHasPlan = await userHasPlanAccess();
  if (!recipe.isPublic && !userHasPlan) {
    redirect(`/mon-plan?next=/recettes/${recipe.id}/cuisiner`);
  }

  // Fiche (variante) ciblée par ?sheet= ; clampée à l'intervalle valide.
  const idx = Math.max(
    0,
    Math.min(recipe.sheets.length - 1, Number(sheetParam) || 0),
  );
  const sheet = recipe.sheets[idx];
  if (!sheet) notFound();

  // Catalogue ustensiles → résolution slug → { label, image }.
  const catalogue = await getAllUtensils();
  const uMap = new Map(catalogue.map((u) => [u.slug, u]));

  // Images d'ingrédients : via le lien Ciqual STABLE (ciqual_alim_code =
  // code ANSES) → image_url des vignettes Ciqual. Précis (pas de matching flou).
  const supabase = createServiceClient();
  const alimCodes = [
    ...new Set(
      sheet.ingredients
        .map((i) => i.ciqual_alim_code)
        .filter((x): x is number => typeof x === 'number'),
    ),
  ];
  const ciqualImg = new Map<number, string>();
  if (alimCodes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('ciqual_foods')
      .select('alim_code, image_url')
      .in('alim_code', alimCodes);
    for (const r of (data ?? []) as { alim_code: number; image_url: string | null }[]) {
      if (r.image_url) ciqualImg.set(Number(r.alim_code), r.image_url);
    }
  }

  const steps: CookStepData[] = sheet.preparationSteps.map((s) => ({
    text: s.text,
    audioUrl: s.audioUrl ?? null,
    utensils: s.utensils.map((slug) => {
      const u = uMap.get(slug);
      return { slug, label: u?.label ?? slug, imageUrl: u?.imageUrl ?? null };
    }),
    // Résout la quantité depuis la liste d'ingrédients de la fiche (match par label).
    ingredients: s.ingredients.map((label) => {
      // Match tolérant : exact d'abord, sinon inclusion ("oignon" ↔
      // "oignon jaune"), accents/casse ignorés.
      const nl = normalizeLabel(label);
      const ing =
        sheet.ingredients.find((i) => normalizeLabel(i.label) === nl) ??
        sheet.ingredients.find((i) => {
          const ni = normalizeLabel(i.label);
          return ni.includes(nl) || nl.includes(ni);
        });
      return {
        label,
        quantity: ing?.quantity ?? null,
        unit: ing?.unit ?? null,
        imageUrl:
          typeof ing?.ciqual_alim_code === 'number'
            ? ciqualImg.get(ing.ciqual_alim_code) ?? null
            : null,
      };
    }),
  }));

  return (
    <RecipeCookView
      title={sheet.title || recipe.title}
      steps={steps}
      backHref={`/recettes/${recipe.id}`}
    />
  );
}
