import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPortionRules } from '@/lib/portion-rules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/nutrition/suggest?q=<terme>
 *
 * Auto-suggestion d'aliments Ciqual basée sur :
 *  - les aliases validés (status='resolved' > 'pending'),
 *  - le nom Ciqual en fallback.
 *
 * Pensé pour être appelée en debounce (250 ms) pendant que l'utilisatrice
 * tape dans le champ "Ajouter un plat". Permet de SAUTER Mistral quand
 * l'utilisatrice clique une suggestion : le front fait alors un POST
 * direct sur /api/nutrition/log avec les data Ciqual + portion par
 * défaut.
 *
 * Retour :
 *   {
 *     query: "côte de",
 *     suggestions: [
 *       {
 *         ciqualId, alimCode, name, groupName,
 *         kcalPer100g, proteinsG, lipidsG, carbsG,
 *         defaultPortionG,        // depuis portion_foods si dispo, sinon 100
 *         defaultKcalForPortion,  // kcal pour 1 portion = kcalPer100g × portionG/100
 *         matchedVia: 'alias_resolved' | 'alias_pending' | 'name',
 *         matchedText: string,    // le texte qui a matché (alias ou name)
 *       },
 *       ...
 *     ]
 *   }
 *
 * Limite : 8 suggestions max. Aucune si query < 2 chars.
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/\s+/g, ' ')
    .trim();
}

// Détection « cru » / « cuit » dans la query ou le nom Ciqual.
// Sert à appliquer la règle métier "cuit > cru par défaut" alignée
// avec /api/nutrition/parse (RÈGLE VIANDES) et l'auto-resolve admin.
const RE_RAW = /\b(cru|crue|crus|crues)\b/;
const RE_COOKED =
  /\b(cuit|cuite|cuits|cuites|grill[ée]e?s?|po[êe]l[ée]e?s?|r[ôo]tie?s?|brais[ée]e?s?|appert[ié]s[ée]e?s?|vapeur|frite?s?|bouillie?s?|blanchie?s?|confite?s?|mijot[ée]e?s?)\b|à l[ '’]?étouff[ée]e|au four/;

type CiqualFood = {
  id: number;
  alim_code: number;
  name: string;
  group_name: string | null;
  kcal_per_100g: number | null;
  proteins_g: number | null;
  lipids_g: number | null;
  carbs_g: number | null;
};

type AliasHit = {
  alias: string;
  alias_display: string;
  ciqual_id: number;
  status: string;
  ciqual_foods: CiqualFood;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ query: q, suggestions: [] });
  }

  const qNorm = normalize(q);
  const supabase = await createClient();

  // Query parallèle dans 3 sources :
  //  1) aliases status='resolved' → priorité absolue (Karine a validé)
  //  2) aliases status='pending'  → en attente, mais déjà utilisables
  //  3) ciqual_foods.name        → fallback (sans alias correspondant)
  //
  // On préfère le matching par préfixe (alias.like.q%) qui est plus
  // précis et rapide grâce à l'index trigram. Pour name, on accepte
  // aussi la substring (%q%).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [resolvedAliases, pendingAliases, nameMatches] = await Promise.all([
    (supabase as any)
      .from('ciqual_aliases')
      .select(
        'alias, alias_display, ciqual_id, status, ciqual_foods!inner(id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g)',
      )
      .eq('status', 'resolved')
      .like('alias', `${qNorm}%`)
      .limit(8),
    (supabase as any)
      .from('ciqual_aliases')
      .select(
        'alias, alias_display, ciqual_id, status, ciqual_foods!inner(id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g)',
      )
      .eq('status', 'pending')
      .like('alias', `${qNorm}%`)
      .limit(8),
    (supabase as any)
      .from('ciqual_foods')
      .select('id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g')
      .ilike('name', `${q}%`)
      .limit(8),
  ]);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Récupère les règles portion pour calculer la kcal "1 portion"
  const rules = await getPortionRules().catch(() => null);

  type Suggestion = {
    ciqualId: number;
    alimCode: number;
    name: string;
    groupName: string | null;
    kcalPer100g: number | null;
    proteinsG: number | null;
    lipidsG: number | null;
    carbsG: number | null;
    defaultPortionG: number;
    defaultKcalForPortion: number | null;
    matchedVia: 'alias_resolved' | 'alias_pending' | 'name';
    matchedText: string;
    /**
     * Texte à afficher en TITRE dans le dropdown. Préférentiellement
     * un alias (plus naturel) ; fallback sur le name Ciqual.
     * - matches via alias → alias_display
     * - matches via name + alias dispo trouvé → alias_display
     * - matches via name sans alias → name Ciqual
     */
    displayText: string;
    _score: number;
  };

  // Map par ciqual_id pour dédupliquer (un aliment peut matcher via
  // 2 voies, on garde la meilleure).
  const byId = new Map<number, Suggestion>();

  function addSuggestion(
    food: CiqualFood,
    matchedVia: Suggestion['matchedVia'],
    matchedText: string,
  ) {
    if (!food || !food.id) return;

    // Cherche une portion par défaut dans portion_foods. Match simple :
    // si le portion_food.name est inclus dans le ciqual.name (ou
    // l'inverse), on prend sa portion. Sinon fallback 100 g.
    let defaultPortionG = 100;
    if (rules?.foods) {
      const nameNorm = normalize(food.name);
      for (const pf of rules.foods) {
        const pfNorm = normalize(pf.name);
        if (nameNorm.includes(pfNorm) || pfNorm.includes(nameNorm)) {
          defaultPortionG = pf.portionG;
          break;
        }
      }
    }

    const defaultKcalForPortion =
      food.kcal_per_100g !== null
        ? Math.round((Number(food.kcal_per_100g) * defaultPortionG) / 100)
        : null;

    // Score (plus bas = meilleur). Hiérarchie pensée pour qu'un nom
    // Ciqual qui COMMENCE VRAIMENT par la query batte un alias pending
    // sous-spécifié (Mistral génère des aliases descriptifs longs
    // comme "puree de pruneaux" pour des aliments qui ne s'appellent
    // pas "purée" dans Ciqual — il faut éviter qu'ils remontent).
    //
    //  0   alias_resolved exact OU name exact
    //  0.5 name startsWith "<query>," (variante stricte, ex: "Purée,")
    //  1   name startsWith "<query> " (variété, ex: "Purée de pomme...")
    //  1.5 alias_resolved préfixe
    //  2   name startsWith "<query>" (sans séparateur, plus rare)
    //  3   alias_pending exact
    //  4   alias_pending préfixe (sous-spécification : "puree de pruneaux"
    //                              pour query "purée")
    //  5   reste
    const nameNorm = normalize(food.name);
    // matchedText peut être `alias_display` (avec accents) pour les
    // aliases, ou le `name` Ciqual. On normalise pour la comparaison
    // d'égalité, en gardant la version display pour l'affichage.
    const matchedNorm = normalize(matchedText);
    let score: number;
    if (matchedVia === 'alias_resolved') {
      score = matchedNorm === qNorm ? 0 : 1.5;
    } else if (matchedVia === 'alias_pending') {
      score = matchedNorm === qNorm ? 3 : 4;
    } else if (nameNorm === qNorm) {
      score = 0;
    } else if (nameNorm.startsWith(qNorm + ',')) {
      score = 0.5;
    } else if (nameNorm.startsWith(qNorm + ' ')) {
      score = 1;
    } else if (nameNorm.startsWith(qNorm)) {
      score = 2;
    } else {
      score = 5;
    }

    // Règle "cuit > cru par défaut" : si la query est NEUTRE (ne
    // mentionne pas cru) et que le nom Ciqual contient cru sans
    // marqueur de cuisson → grosse pénalité. Aligné sur le prompt
    // Mistral (RÈGLE VIANDES) et l'auto-resolve cuit/cru.
    if (!RE_RAW.test(qNorm) && RE_RAW.test(nameNorm) && !RE_COOKED.test(nameNorm)) {
      score += 2;
    }

    // Pénalité aliments infantiles. Le tracker n'est PAS prévu pour
    // les repas de bébé — ces aliments parasitent quand l'utilisatrice
    // tape un terme commun ("compote", "purée", "biscuit") et qu'ils
    // remontent. On les rétrograde mais on les garde dispo (au cas où).
    if (food.group_name && /infantil/i.test(food.group_name)) {
      score += 3;
    }

    const existing = byId.get(food.id);
    if (existing && existing._score <= score) return;

    byId.set(food.id, {
      ciqualId: food.id,
      alimCode: Number(food.alim_code),
      name: String(food.name),
      groupName: food.group_name,
      kcalPer100g: food.kcal_per_100g === null ? null : Number(food.kcal_per_100g),
      proteinsG: food.proteins_g === null ? null : Number(food.proteins_g),
      lipidsG: food.lipids_g === null ? null : Number(food.lipids_g),
      carbsG: food.carbs_g === null ? null : Number(food.carbs_g),
      defaultPortionG,
      defaultKcalForPortion,
      matchedVia,
      matchedText,
      // Par défaut, on affiche le matchedText (alias si alias_match,
      // sinon name). L'enrichissement post-sort peut override pour
      // les matches via name si on trouve un alias plus naturel.
      displayText: matchedText,
      _score: score,
    });
  }

  // 1) aliases resolved — on passe alias_display (avec accents) plutôt
  //    que alias (normalisé) pour qu'on puisse l'afficher tel quel en
  //    titre de suggestion.
  if (!resolvedAliases.error && Array.isArray(resolvedAliases.data)) {
    for (const row of resolvedAliases.data as AliasHit[]) {
      if (row.ciqual_foods) {
        addSuggestion(row.ciqual_foods, 'alias_resolved', row.alias_display || row.alias);
      }
    }
  }
  // 2) aliases pending
  if (!pendingAliases.error && Array.isArray(pendingAliases.data)) {
    for (const row of pendingAliases.data as AliasHit[]) {
      if (row.ciqual_foods) {
        addSuggestion(row.ciqual_foods, 'alias_pending', row.alias_display || row.alias);
      }
    }
  }
  // 3) name fallback (matchedText = name, qu'on affichera en titre)
  if (!nameMatches.error && Array.isArray(nameMatches.data)) {
    for (const row of nameMatches.data as CiqualFood[]) {
      addSuggestion(row, 'name', row.name);
    }
  }

  const sorted = [...byId.values()]
    .sort((a, b) => {
      if (a._score !== b._score) return a._score - b._score;
      if (a.name.length !== b.name.length) return a.name.length - b.name.length;
      return a.name.localeCompare(b.name, 'fr');
    })
    .slice(0, 8);

  // ─── Enrichissement displayText pour les matches via name ─────────
  // Quand le match est passé par le name Ciqual (pas via alias), on
  // tente de récupérer un alias dispo de cet aliment pour l'afficher
  // en titre. Plus naturel pour l'utilisatrice que le nom Ciqual brut
  // ("Purée de pomme de terre, à base de flocons, reconstituée..."
  //  devient ex. "purée mousseline").
  //
  // Une seule query batch sur l'ensemble des ciqual_ids des matches
  // via name. Resolved prioritaire sur pending. Si aucun alias dispo,
  // matchedText reste le name Ciqual.
  const nameOnlyIds = sorted
    .filter((s) => s.matchedVia === 'name')
    .map((s) => s.ciqualId);

  if (nameOnlyIds.length > 0) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: aliasFallbacks } = await (supabase as any)
      .from('ciqual_aliases')
      .select('ciqual_id, alias_display, status')
      .in('ciqual_id', nameOnlyIds)
      .neq('status', 'rejected')
      // resolved (string) > pending (string) alphabétiquement, donc
      // ascending mettra 'pending' avant 'resolved'. On veut l'inverse :
      // descending pour avoir 'resolved' en premier.
      .order('status', { ascending: false });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (Array.isArray(aliasFallbacks)) {
      // 1er alias trouvé par ciqual_id (en respectant l'order resolved>pending)
      const aliasByCiqualId = new Map<number, string>();
      for (const row of aliasFallbacks as Array<{
        ciqual_id: number;
        alias_display: string;
      }>) {
        if (!aliasByCiqualId.has(row.ciqual_id)) {
          aliasByCiqualId.set(row.ciqual_id, row.alias_display);
        }
      }
      for (const s of sorted) {
        if (s.matchedVia === 'name') {
          const alias = aliasByCiqualId.get(s.ciqualId);
          if (alias) {
            // On bascule le titre sur l'alias plus naturel. Le name
            // Ciqual reste dans s.name comme référence et sera affiché
            // en sous-titre. matchedVia reste 'name' (transparence
            // sur la voie qui a fait scorer).
            s.displayText = alias;
          }
        }
      }
    }
  }

  // Retire _score du retour public
  const publicSorted = sorted.map(({ _score, ...rest }) => rest);

  return NextResponse.json({ query: q, suggestions: publicSorted });
}
