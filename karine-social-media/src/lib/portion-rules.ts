import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

export type SizeVariability = 'low' | 'medium' | 'high';

export type PortionFood = {
  id: number;
  name: string;
  portionG: number;
  sizeVariability: SizeVariability;
  notes: string | null;
};

export type PortionModifier = {
  id: number;
  keyword: string;
  multiplier: number;
};

export type PortionFollowup = {
  id: number;
  triggerKeyword: string;
  question: string;
  suggestedFood: string;
  defaultG: number;
  excludeKeywords: string[];
};

export type PortionRules = {
  foods: PortionFood[];
  modifiers: PortionModifier[];
  followups: PortionFollowup[];
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
    const [foodsRes, modsRes, fupsRes] = await Promise.all([
      (supabase as any)
        .from('portion_foods')
        .select('id, name, portion_g, size_variability, notes')
        .order('name', { ascending: true }),
      (supabase as any)
        .from('portion_modifiers')
        .select('id, keyword, multiplier')
        .order('multiplier', { ascending: true }),
      (supabase as any)
        .from('portion_followups')
        .select('id, trigger_keyword, question, suggested_food, default_g, exclude_keywords')
        .order('trigger_keyword', { ascending: true }),
    ]);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const foods: PortionFood[] = (foodsRes.data ?? []).map(
      (r: Record<string, unknown>) => ({
        id: Number(r.id),
        name: String(r.name),
        portionG: Number(r.portion_g),
        sizeVariability: (r.size_variability as SizeVariability) || 'medium',
        notes: (r.notes as string | null) ?? null,
      }),
    );

    const modifiers: PortionModifier[] = (modsRes.data ?? []).map(
      (r: Record<string, unknown>) => ({
        id: Number(r.id),
        keyword: String(r.keyword),
        multiplier: Number(r.multiplier),
      }),
    );

    const followups: PortionFollowup[] = (fupsRes.data ?? []).map(
      (r: Record<string, unknown>) => ({
        id: Number(r.id),
        triggerKeyword: String(r.trigger_keyword),
        question: String(r.question),
        suggestedFood: String(r.suggested_food),
        defaultG: Number(r.default_g),
        excludeKeywords: Array.isArray(r.exclude_keywords)
          ? (r.exclude_keywords as string[])
          : [],
      }),
    );

    const rules: PortionRules = { foods, modifiers, followups };
    cache = { rules, expiresAt: Date.now() + CACHE_TTL_MS };
    return rules;
  } catch {
    return { foods: [], modifiers: [], followups: [] };
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

/**
 * Detecte les followups applicables apres parse. Pour chaque item
 * matche (label contient trigger_keyword sans aucun exclude_keyword
 * dans la phrase originale), renvoie la question + suggestion.
 */
export type ApplicableFollowup = {
  itemIndex: number;
  triggerKeyword: string;
  question: string;
  suggestedFood: string;
  defaultG: number;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe');
}

export function detectFollowups(
  originalText: string,
  itemLabels: string[],
  rules: PortionRules,
): ApplicableFollowup[] {
  const origNorm = normalize(originalText);
  const out: ApplicableFollowup[] = [];
  itemLabels.forEach((label, idx) => {
    const labelNorm = normalize(label);
    for (const f of rules.followups) {
      const triggerNorm = normalize(f.triggerKeyword);
      if (!labelNorm.includes(triggerNorm) && !origNorm.includes(triggerNorm)) {
        continue;
      }
      // Check exclude keywords
      const excluded = f.excludeKeywords.some((ex) => {
        const exNorm = normalize(ex);
        return origNorm.includes(exNorm) || labelNorm.includes(exNorm);
      });
      if (excluded) continue;
      out.push({
        itemIndex: idx,
        triggerKeyword: f.triggerKeyword,
        question: f.question,
        suggestedFood: f.suggestedFood,
        defaultG: f.defaultG,
      });
      break; // 1 followup max par item
    }
  });
  return out;
}
