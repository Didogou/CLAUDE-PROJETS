import 'server-only';
import { callMistralJson } from '@/lib/mistral';
import type { ShoppingListItem } from '@/data/menus';

export type EstimatedMacros = {
  /** Calories par portion (kcal). */
  caloriesPerServing: number | null;
  /** Protéines par portion (g). */
  proteinsG: number | null;
  /** Lipides par portion (g). */
  lipidsG: number | null;
  /** Glucides par portion (g). */
  carbsG: number | null;
};

/**
 * Estime les macros par portion d'une recette à partir de la liste
 * structurée des ingrédients via Mistral Small (JSON mode).
 *
 * Usage : fallback quand Vision n'a pas réussi à lire les macros sur
 * l'image de la fiche recette. Les valeurs renvoyées sont des
 * estimations indicatives — Karine peut toujours les corriger dans
 * l'éditeur.
 *
 * Robuste : ne throw jamais. Retourne `null` partout en cas d'échec
 * pour ne pas casser le pipeline d'extraction. Le caller décide quoi
 * faire (laisser vide).
 */
export async function estimateMacrosFromIngredients(
  ingredients: ShoppingListItem[],
  servings: number,
  knownCaloriesPerServing: number | null,
): Promise<EstimatedMacros> {
  if (!ingredients || ingredients.length === 0) {
    return { caloriesPerServing: null, proteinsG: null, lipidsG: null, carbsG: null };
  }

  const safeServings = servings > 0 ? Math.round(servings) : 4;

  const ingredientsText = ingredients
    .map((it) => {
      const qty = it.quantity != null ? String(it.quantity) : '';
      const unit = it.unit ?? '';
      const qtyStr = [qty, unit].filter(Boolean).join(' ');
      return qtyStr ? `- ${qtyStr} de ${it.label}` : `- ${it.label} (quantité non précisée)`;
    })
    .join('\n');

  const system = `Tu es nutritionniste française. Tu estimes les macros d'une recette à partir de sa liste d'ingrédients structurée.

RÈGLES :
- Tu raisonnes sur les TOTAUX puis tu DIVISES par le nombre de portions à la fin.
- Tu utilises la base ANSES Ciqual mentalement (valeurs nutritionnelles standard françaises).
- Tu retournes des entiers (g pour macros, kcal pour calories).
- Si tu manques d'info pour un macro (ingrédient inconnu, quantité absente), retourne null.
- Estime conservativement (préfère un null à une valeur très approximative).

RÉPONDS UNIQUEMENT EN JSON :
{
  "caloriesPerServing": entier ou null,
  "proteinsG": entier ou null,
  "lipidsG": entier ou null,
  "carbsG": entier ou null
}`;

  const user = `Recette pour ${safeServings} portion${safeServings > 1 ? 's' : ''}.

Ingrédients (totaux pour ${safeServings} portion${safeServings > 1 ? 's' : ''}) :
${ingredientsText}

${
  knownCaloriesPerServing !== null
    ? `Calories par portion déjà mesurées : ${knownCaloriesPerServing} kcal. Reprends cette valeur.`
    : 'Estime aussi les calories par portion si possible.'
}

Estime les macros PAR PORTION (totaux / ${safeServings}). Réponds en JSON.`;

  try {
    const res = await callMistralJson(system, user, {
      maxTokens: 200,
      timeoutMs: 12_000,
    });
    const parsed = JSON.parse(res.content) as Partial<EstimatedMacros>;
    const sanitize = (v: unknown): number | null => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
      // Cap raisonnable pour éviter les délires Mistral
      if (v > 5000) return null;
      return Math.round(v);
    };
    return {
      caloriesPerServing:
        knownCaloriesPerServing !== null
          ? knownCaloriesPerServing
          : sanitize(parsed.caloriesPerServing),
      proteinsG: sanitize(parsed.proteinsG),
      lipidsG: sanitize(parsed.lipidsG),
      carbsG: sanitize(parsed.carbsG),
    };
  } catch {
    return { caloriesPerServing: null, proteinsG: null, lipidsG: null, carbsG: null };
  }
}
