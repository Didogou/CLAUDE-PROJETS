import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { parsePreparationSteps } from '@/data/recipes';

export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET /api/admin/recipes/batch-prepa-status
 *
 * État par recette pour le batch « extraction préparations + voix Karine » :
 *   - sheets         : nb de fiches
 *   - sheetsNoSteps  : fiches SANS preparation_steps (→ extraction à faire)
 *   - steps          : nb total d'étapes (toutes fiches)
 *   - stepsNoAudio   : étapes SANS audioUrl (→ voix à générer)
 *
 * Sert à afficher la liste + savoir ce qui reste à traiter (skip déjà fait).
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const supabase = createServiceClient();

    const { data: recipes, error: rErr } = await (supabase as any)
      .from('recipes')
      .select('id, slug, title')
      .order('title', { ascending: true });
    if (rErr) throw rErr;

    const { data: sheets, error: sErr } = await (supabase as any)
      .from('recipe_sheets')
      .select('recipe_id, preparation_steps');
    if (sErr) throw sErr;

    type Agg = {
      sheets: number;
      sheetsNoSteps: number;
      steps: number;
      stepsNoAudio: number;
    };
    const byRecipe = new Map<number, Agg>();
    for (const sh of (sheets ?? []) as {
      recipe_id: number;
      preparation_steps: unknown;
    }[]) {
      const a =
        byRecipe.get(sh.recipe_id) ??
        { sheets: 0, sheetsNoSteps: 0, steps: 0, stepsNoAudio: 0 };
      a.sheets++;
      const steps = parsePreparationSteps(sh.preparation_steps);
      if (steps.length === 0) a.sheetsNoSteps++;
      a.steps += steps.length;
      a.stepsNoAudio += steps.filter(
        (s) => !(typeof s.audioUrl === 'string' && s.audioUrl.trim()),
      ).length;
      byRecipe.set(sh.recipe_id, a);
    }

    const items = ((recipes ?? []) as { id: number; slug: string; title: string }[]).map(
      (r) => {
        const a =
          byRecipe.get(r.id) ??
          { sheets: 0, sheetsNoSteps: 0, steps: 0, stepsNoAudio: 0 };
        return { slug: r.slug, title: r.title, ...a };
      },
    );

    const stats = items.reduce(
      (acc, it) => {
        acc.recipes++;
        acc.sheets += it.sheets;
        acc.sheetsNoSteps += it.sheetsNoSteps;
        acc.steps += it.steps;
        acc.stepsNoAudio += it.stepsNoAudio;
        return acc;
      },
      { recipes: 0, sheets: 0, sheetsNoSteps: 0, steps: 0, stepsNoAudio: 0 },
    );

    return NextResponse.json({ items, stats });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
