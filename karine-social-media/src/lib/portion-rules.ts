import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

export type SizeVariability = 'low' | 'medium' | 'high';

export type PortionFood = {
  id: number;
  name: string;
  portionG: number;
  sizeVariability: SizeVariability;
  notes: string | null;
  /** true = entrée créée automatiquement par Mistral lors d'un parse,
   *  en attente de validation par Karine. */
  aiGenerated: boolean;
};

export type PortionModifier = {
  id: number;
  keyword: string;
  multiplier: number;
};

export type PortionRules = {
  foods: PortionFood[];
  modifiers: PortionModifier[];
};

let cache: { rules: PortionRules; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidatePortionCache() {
  cache = null;
}

export async function getPortionRules(): Promise<PortionRules> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.rules;
  }
  try {
    const supabase = createServiceClient();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const [foodsRes, modsRes] = await Promise.all([
      (supabase as any)
        .from('portion_foods')
        .select('id, name, portion_g, size_variability, notes, ai_generated')
        .order('name', { ascending: true }),
      (supabase as any)
        .from('portion_modifiers')
        .select('id, keyword, multiplier')
        .order('multiplier', { ascending: true }),
    ]);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const foods: PortionFood[] = (foodsRes.data ?? []).map(
      (r: Record<string, unknown>) => ({
        id: Number(r.id),
        name: String(r.name),
        portionG: Number(r.portion_g),
        sizeVariability: (r.size_variability as SizeVariability) || 'medium',
        notes: (r.notes as string | null) ?? null,
        aiGenerated: Boolean(r.ai_generated),
      }),
    );

    const modifiers: PortionModifier[] = (modsRes.data ?? []).map(
      (r: Record<string, unknown>) => ({
        id: Number(r.id),
        keyword: String(r.keyword),
        multiplier: Number(r.multiplier),
      }),
    );

    const rules: PortionRules = { foods, modifiers };
    cache = { rules, expiresAt: Date.now() + CACHE_TTL_MS };
    return rules;
  } catch {
    return { foods: [], modifiers: [] };
  }
}

/**
 * Formate la grille pour injection dans le prompt Mistral.
 * Format compact pour ne pas exploser le contexte.
 */
export function formatPortionRulesForPrompt(rules: PortionRules): string {
  if (rules.foods.length === 0 && rules.modifiers.length === 0) {
    return '';
  }
  const lines: string[] = [];
  if (rules.foods.length > 0) {
    lines.push('GRILLE DES PORTIONS STANDARD (1 unité de chaque aliment, en grammes) :');
    const formatted = rules.foods
      .map((f) => `${f.name}=${f.portionG}g`)
      .join(', ');
    lines.push(formatted);
    lines.push('');
  }
  if (rules.modifiers.length > 0) {
    lines.push("MULTIPLICATEURS DES ADJECTIFS DE TAILLE (s'appliquent à tous les aliments de la phrase) :");
    const formatted = rules.modifiers
      .map((m) => `${m.keyword}=×${m.multiplier}`)
      .join(', ');
    lines.push(formatted);
    lines.push('');
  }
  lines.push(
    'RÈGLE DE CALCUL : approx_grams = portion_standard × multiplicateur. Si un aliment n\'est pas dans la grille, estime librement (~150g pour un plat, ~30g pour une part de fromage…).',
  );
  lines.push(
    'CAS PARTICULIER : si l\'utilisatrice donne une masse précise (\"500g de pâtes\", \"250 grammes de riz\"), prends cette masse exacte et IGNORE la grille.',
  );
  return lines.join('\n');
}

