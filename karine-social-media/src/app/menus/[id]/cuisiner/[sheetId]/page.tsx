import { notFound, redirect } from 'next/navigation';
import { getPublishedMenuById, getMealSheetById } from '@/lib/menus';
import { getCurrentUser } from '@/lib/current-user';
import { getAllUtensils } from '@/lib/utensils';
import { createServiceClient } from '@/lib/supabase/server';
import {
  RecipeCookView,
  type CookStepData,
} from '@/components/recettes/RecipeCookView';

export const dynamic = 'force-dynamic';

/** minuscule + sans accent + trim + stemming pluriel léger (idem recette). */
function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length >= 4 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

/**
 * Page « cuisine guidée » d'un repas de menu — strictement le même écran
 * que pour une recette (RecipeCookView), alimenté par la fiche repas.
 * Même gate d'accès que la page jour du menu (abonnée OU menu public).
 */
export default async function MenuMealCookPage({
  params,
}: {
  params: Promise<{ id: string; sheetId: string }>;
}) {
  const { id, sheetId } = await params;
  const [menu, user, sheet] = await Promise.all([
    getPublishedMenuById(id),
    getCurrentUser(),
    getMealSheetById(sheetId),
  ]);
  if (!menu || !sheet) notFound();

  const isSubscriber =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';
  if (!menu.isPublic && !isSubscriber) {
    redirect(`/mon-plan?next=/menus/${menu.id}/jour`);
  }

  // Catalogue ustensiles → slug → { label, image }.
  const catalogue = await getAllUtensils();
  const uMap = new Map(catalogue.map((u) => [u.slug, u]));

  // Images d'ingrédients via le lien Ciqual stable (alim_code).
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
    ingredients: s.ingredients.map((label) => {
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
      title={sheet.title || 'Repas du menu'}
      steps={steps}
      backHref={`/menus/${menu.id}/jour`}
    />
  );
}
