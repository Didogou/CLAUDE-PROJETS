import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { callMistralJson } from '@/lib/mistral';
import { searchCiqualFoods } from '@/lib/ciqual';
import {
  getPortionRules,
  formatPortionRulesForPrompt,
} from '@/lib/portion-rules';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/nutrition/parse
 * Body : { text: string }
 *
 * Pipeline 3 étapes :
 *  0) Mistral CORRIGE l'orthographe de la phrase (fautes courantes,
 *     accents, ligatures œ/æ). On utilise ensuite la version corrigée.
 *  1) Mistral extrait les aliments {search_queries[], portions, grams}.
 *  2) Pour chaque item :
 *     a. Cascade des search_queries jusqu'à candidats Ciqual.
 *     b. Si 0 → match=null + fallbackCandidates si trouvés.
 *     c. Si match évident (startsWith) → on garde top1.
 *     d. Sinon → Mistral choisit parmi les candidats (contexte).
 *  3) Calcule kcal/macros pour 1 portion.
 *  4) Retourne preview + correctedText pour transparence UI.
 */

type MistralItem = {
  /** @deprecated v1, garde la rétrocompat */
  search_query?: string;
  /** v2 : plusieurs variantes essayées en cascade. */
  search_queries?: string[];
  portions?: number;
  approx_grams?: number;
  /** v3 : mot-clé simple pour matcher avec portion_foods (Karine peut tuner). */
  food_keyword?: string;
  /** v3 : taille explicite mentionnée par l'utilisatrice (null si pas dit). */
  size_hint?: 'small' | 'medium' | 'large' | null;
  /** v4 : accompagnements classiques possibles, triés par kcal décroissant, max 3. */
  possible_accompaniments?: Array<{
    name: string;
    typical_g: number;
    kcal_estimate: number;
  }>;
};

export type AccompanimentSuggestion = {
  name: string;
  typicalG: number;
  kcalEstimate: number;
};

type CiqualCandidatePublic = {
  ciqualId: number;
  alimCode: number;
  name: string;
  kcalPer100g: number | null;
  proteinsG: number | null;
  lipidsG: number | null;
  carbsG: number | null;
};

type ParsedItem = {
  label: string;
  searchQuery: string;
  portions: number;
  approxGrams: number;
  /** Masse de base SANS multiplicateur de taille (utile pour recalcul UI chips P/M/G). */
  baseGramsBeforeSizeHint: number;
  match: CiqualCandidatePublic | null;
  // Kcal pour 1 portion (à multiplier par portions côté UI).
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
  // Top 7 candidats Ciqual — toujours présent quand on en a trouvé,
  // pour permettre à l'utilisatrice de choisir une alternative.
  topCandidates?: CiqualCandidatePublic[];
  /** Mot-clé portion (matché avec portion_foods, sert au UI pour size_variability). */
  foodKeyword?: string;
  /** "low" | "medium" | "high" depuis portion_foods. UI utilise pour décider d'afficher les chips P/M/G. */
  sizeVariability?: 'low' | 'medium' | 'high';
  /** Taille explicitement mentionnée par l'utilisatrice (Mistral détecte). */
  sizeHint?: 'small' | 'medium' | 'large' | null;
  /** Suggestions Mistral d'accompagnements (sauce, sucre, fromage…). Triés par kcal décroissant, max 3. */
  possibleAccompaniments?: AccompanimentSuggestion[];
};

const CORRECT_PROMPT = `Tu corriges l'orthographe d'une phrase française qui décrit un repas.

SORTIE OBLIGATOIRE (JSON pur sans markdown) :
{ "corrected": "phrase corrigée en français" }

Règles :
- Conserve le SENS exact (pas de paraphrase, pas d'ajout).
- Corrige les fautes courantes : conjugaisons (manger/mangé), accents (é/è/ê), pluriels.
- Normalise les ligatures : oeuf → œuf, boeuf → bœuf, soeur → sœur.
- Corrige les noms d'aliments mal orthographiés : "tartiflète" → "tartiflette", "raviolli" → "ravioli", "yogourt" → "yaourt".
- Si la phrase est déjà correcte : renvoie-la telle quelle.
- Réponds TOUJOURS en JSON valide.`;

function buildSystemPrompt(portionRulesText: string): string {
  return `Tu es un assistant nutritionnel français. L'utilisatrice tape en français une phrase qui décrit son repas. Tu dois extraire la liste des aliments, leur quantité, et fournir des termes de recherche pour la base ANSES Ciqual.

RÉPONDS UNIQUEMENT EN JSON PUR (pas de markdown, pas de commentaire) :
{
  "items": [
    {
      "search_queries": ["yaourt nature", "yaourt"],
      "food_keyword": "yaourt",
      "portions": 1,
      "approx_grams": 125,
      "size_hint": null,
      "possible_accompaniments": [
        { "name": "miel", "typical_g": 15, "kcal_estimate": 49 },
        { "name": "confiture", "typical_g": 15, "kcal_estimate": 40 },
        { "name": "sucre", "typical_g": 5, "kcal_estimate": 20 }
      ]
    }
  ]
}

CHAMPS À RENSEIGNER POUR CHAQUE ITEM :

1) search_queries : tableau de 1 à 4 termes à chercher en cascade dans Ciqual. Le 1er est le plus précis, les suivants dégradent vers du plus générique. Si zéro résultat sur le 1er, on essaie le 2e, etc.

   ⚠️ RÈGLE CRITIQUE — CASCADE DÉGRADANTE :
   La DERNIÈRE entrée de search_queries doit TOUJOURS être l'aliment principal SEUL (le nom du légume, de la viande, du féculent, du fruit…). JAMAIS un qualificatif de préparation isolé comme "farci", "rôti", "grillé", "braisé", "mijoté", "poêlé", "gratiné", "pané", "fumé".

   Exemples :
   - "poivrons farcis à la viande" → ["poivron farci viande", "poivron"] ✅ (PAS ["poivron farci", "farci"] ❌)
   - "gigot d'agneau rôti" → ["gigot agneau", "agneau"] ✅ (PAS ["gigot rôti", "rôti"] ❌)
   - "côte de bœuf grillée" → ["côte bœuf grillée", "côte bœuf", "bœuf"] ✅
   - "poisson pané" → ["poisson pané", "poisson"] ✅
   - "saumon fumé" → ["saumon fumé", "saumon"] ✅ (la forme "saumon fumé" existe en Ciqual donc OK en 1er)

2) food_keyword : un mot-clé simple en français qui sert à matcher la grille des portions (voir ci-dessous). Ex : "yaourt", "lait", "frites", "pomme", "salade".

3) portions : nombre de portions. "2 pommes" = 2. "un demi sandwich" = 0.5. "un verre de lait" = 1.

4) approx_grams : masse en grammes pour UNE portion. Calcule selon la grille ci-dessous × le multiplicateur (si adjectif).

5) size_hint : indique si l'utilisatrice a mentionné explicitement une taille.
   - "small" si elle dit "petit", "petite", "léger", "mini" → multiplicateur déjà appliqué dans approx_grams
   - "medium" si elle dit "moyen", "normal" → multiplicateur ×1
   - "large" si elle dit "grand", "gros", "grosse", "énorme", "XL" → multiplicateur déjà appliqué
   - null si aucune taille mentionnée

6) possible_accompaniments : tableau de **0 à 3** suggestions d'accompagnements ou ingrédients additionnels classiques qui pourraient accompagner ce plat et augmenter SIGNIFICATIVEMENT les calories ou les macros (sauce, fromage, huile, sucre, crème…). TRIE PAR KCAL_ESTIMATE DÉCROISSANT (le plus calorique en 1er pour alerter l'abonnée).

   ⚠️ RÈGLE CRITIQUE — "PHRASE COMPLÈTE" : Si l'abonnée a DÉJÀ PRÉCISÉ un accompagnement dans sa phrase (formule du type "X au Y", "X avec Y", "X à la Y", "X et Y", ou simplement la présence du mot de l'accompagnement dans la même phrase), sa déclaration est COMPLÈTE — retourne un **tableau VIDE []**. N'invente PAS d'accompagnement supplémentaire au-dessus de ce qu'elle a déjà dit.

   Exemples — déclaration complète, tableau VIDE :
   - "crêpe au sucre" → [] (on ne mange pas une crêpe au sucre AVEC du nutella en plus)
   - "café au lait" → []
   - "yaourt au miel" → []
   - "salade vinaigrette" → []
   - "pâtes au parmesan" → []
   - "tartine au beurre" → []
   - "frites ketchup" → []
   - "pain et confiture" → []
   - "thé au sucre" → []

   À l'inverse, si la phrase ne mentionne AUCUN accompagnement (plat nu), propose 1 à 3 suggestions classiques :
   - "une crêpe" → [nutella, sucre, confiture]
   - "un yaourt" → [miel, confiture, sucre]
   - "une salade" → [vinaigrette, huile d'olive, fromage de chèvre]
   - "des pâtes" → [parmesan, huile d'olive, beurre]
   - "un café" → [lait, sucre, crème]
   - "des frites" → [mayonnaise, ketchup, sauce barbecue]

   Format chaque élément : { name, typical_g, kcal_estimate }
   - name : nom de l'accompagnement en français minuscules ("vinaigrette", "parmesan", "miel"…)
   - typical_g : masse typique d'une portion classique (vinaigrette 15g, fromage râpé 10g, miel 15g, sucre 5g…)
   - kcal_estimate : kcal de la portion typique (utilise tes connaissances : huile=90, vinaigrette=70, fromage râpé=40, miel=49, sucre=20…)

   Si aucun accompagnement n'a de sens (fruits crus, eau, alcool fort…) OU si l'abonnée en a déjà précisé un : tableau vide [].

═══════════════════════════════════════════════════════
${portionRulesText || 'Pas de grille disponible — estime librement les portions selon les normes nutritionnelles françaises.'}
═══════════════════════════════════════════════════════

EXEMPLES COMPLETS :

"j'ai mangé un yaourt"
  → search_queries=["yaourt nature","yaourt"], food_keyword="yaourt", portions=1, approx_grams=125, size_hint=null

"j'ai mangé une grosse assiette de frites"
  → search_queries=["frites cuites","frites"], food_keyword="frites", portions=1, approx_grams=350 (250×1.4), size_hint="large"

"un grand bol de céréales avec du lait" (DEUX items distincts)
  → item 1 : search_queries=["céréales petit déjeuner","céréales"], food_keyword="céréales", portions=1, approx_grams=56 (40×1.4), size_hint="large"
  → item 2 : search_queries=["lait demi-écrémé","lait"], food_keyword="lait", portions=1, approx_grams=280 (200×1.4), size_hint="large"

"un verre de lait" (BOISSON, jamais "lait de vache" qui matche des fromages)
  → search_queries=["lait demi-écrémé","lait entier","lait"], food_keyword="lait", portions=1, approx_grams=200, size_hint=null

"500g de pâtes"
  → search_queries=["pâtes cuites","pâtes"], food_keyword="pâtes", portions=1, approx_grams=500, size_hint=null (la masse explicite REMPLACE la grille)

"deux pommes"
  → search_queries=["pomme crue","pomme"], food_keyword="pomme", portions=2, approx_grams=150, size_hint=null

"une côte de bœuf crue"
  → search_queries=["côte de bœuf crue","faux-filet bœuf","entrecôte bœuf","bœuf cru"], food_keyword="bœuf", portions=1, approx_grams=150, size_hint=null

"un poivron farci à la viande" (PLAT COMPOSÉ ABSENT DE CIQUAL → DÉCOMPOSE)
  → item 1 : search_queries=["poivron cru","poivron"], food_keyword="poivron", portions=1, approx_grams=120, size_hint=null
  → item 2 : search_queries=["bœuf haché cuit","bœuf haché","bœuf"], food_keyword="bœuf haché", portions=1, approx_grams=80, size_hint=null

"des tomates farcies" (DÉCOMPOSE)
  → item 1 : search_queries=["tomate crue","tomate"], food_keyword="tomate", portions=2, approx_grams=150
  → item 2 : search_queries=["bœuf haché cuit","bœuf haché","bœuf"], food_keyword="bœuf haché", portions=1, approx_grams=100

⚠️ MAPPINGS GÉNÉRIQUES → ESPÈCE EXACTE (la base Ciqual ne contient PAS les mots "viande" ni "poisson blanc" — il faut donner l'espèce animale précise pour qu'on trouve quelque chose) :

- "viande hachée" / "viande" / "viande rouge" → search_queries=["bœuf haché cuit","bœuf haché","bœuf"], food_keyword="bœuf haché"
- "steak" / "steak haché" → search_queries=["bœuf haché cuit","steak haché bœuf","bœuf"], food_keyword="steak haché"
- "viande blanche" → search_queries=["poulet cuit","poulet"], food_keyword="poulet"
- "poisson" / "poisson blanc" → search_queries=["cabillaud cuit","cabillaud","lieu noir","poisson"], food_keyword="poisson"
- "poisson rouge" / "poisson gras" → search_queries=["saumon cuit","saumon"], food_keyword="saumon"
- "céréales" / "muesli" → search_queries=["muesli","céréales petit déjeuner"], food_keyword="céréales"
- "fromage" (sans précision) → search_queries=["emmental","fromage"], food_keyword="fromage"
- "yaourt" / "yogourt" → search_queries=["yaourt nature","yaourt"], food_keyword="yaourt"

Règle générale : la base ANSES Ciqual parle par ESPÈCE animale et par NOM précis d'aliment. Si l'abonnée dit un terme générique ("viande", "poisson", "céréales"), tu DOIS le traduire en au moins une espèce / nom précis dans search_queries. Sinon Ciqual ne trouvera rien.

RÈGLES IMPORTANTES :

- PLATS COMPOSÉS PRÉSENTS DANS CIQUAL — NE DÉCOMPOSE PAS : aligot, ratatouille, paella, lasagnes, tartiflette, couscous, quiche lorraine, hachis parmentier, tiramisu, choucroute. Mets le plat tel quel comme 1ère search_query.

- ⚠️ PLATS COMPOSÉS ABSENTS DE CIQUAL — DÉCOMPOSE EN 2-3 ITEMS : poivrons farcis, tomates farcies, courgettes farcies, aubergines farcies, parmentier de canard, moussaka, cannelloni, tajine, blanquette, navarin, bourguignon préparé maison. Pour ces plats, crée un item par ingrédient principal (légume + protéine + parfois féculent) avec leur masse estimée. Le résultat sera plus précis qu'un match approximatif.

- DÉCOMPOSE en plusieurs items SEULEMENT si l'utilisatrice énumère explicitement plusieurs aliments avec "et", "puis", ",", "avec" :
    "une pomme et un yaourt" → 2 items
    "un bol de céréales avec du lait" → 2 items (céréales + lait)
    "des pâtes à la carbonara" → 1 item (carbonara est un plat composé)

- POUR LES VIANDES : 2-3 variantes (la coupe précise + un nom Ciqual + le nom de l'animal). Ciqual liste les coupes officielles (faux-filet, entrecôte, paleron, jarret, rumsteck), pas les appellations bouchères.

- POUR LES BOISSONS ("verre de X", "tasse de X") : c'est la BOISSON elle-même. "verre de lait" ≠ "lait de vache" (qui matche les fromages). Mets toujours le nom de la boisson en 1er ("lait demi-écrémé", pas "lait de vache").

- IGNORE les phrases vagues ("un repas", "des trucs", "pas grand chose").

- MAXIMUM 10 items par phrase.`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (text.length < 3) {
    return NextResponse.json(
      { error: 'Texte trop court (3 caractères min)' },
      { status: 400 },
    );
  }
  if (text.length > 500) {
    return NextResponse.json(
      { error: 'Texte trop long (500 caractères max)' },
      { status: 400 },
    );
  }

  // Étape 0 : correction orthographique. Si Mistral plante, on
  // retombe sur le texte brut.
  const correctedText = await correctSpelling(text);

  // Charge les regles de portions (cache 5 min) + injecte dans le prompt.
  const portionRules = await getPortionRules();
  const rulesText = formatPortionRulesForPrompt(portionRules);
  const systemPrompt = buildSystemPrompt(rulesText);

  let parsed: { items?: MistralItem[] };
  try {
    const result = await callMistralJson(systemPrompt, correctedText, {
      maxTokens: 1200, // plus large car la grille a injecter peut etre grosse
    });
    parsed = JSON.parse(result.content) as { items?: MistralItem[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur Mistral';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 10) : [];
  if (items.length === 0) {
    return NextResponse.json({
      items: [],
      correctedText: correctedText !== text ? correctedText : undefined,
    });
  }

  const out: ParsedItem[] = [];
  for (const it of items) {
    // Build cascade : V2 search_queries[] sinon fallback V1 search_query.
    const cascade: string[] = [];
    if (Array.isArray(it.search_queries)) {
      for (const q of it.search_queries) {
        if (typeof q === 'string' && q.trim()) cascade.push(q.trim());
      }
    } else if (typeof it.search_query === 'string') {
      const q = it.search_query.trim();
      if (q) cascade.push(q);
    }
    if (cascade.length === 0) continue;

    const portions =
      typeof it.portions === 'number' && Number.isFinite(it.portions) && it.portions > 0
        ? it.portions
        : 1;
    const grams =
      typeof it.approx_grams === 'number' &&
      Number.isFinite(it.approx_grams) &&
      it.approx_grams > 0
        ? it.approx_grams
        : 100;

    // Extraction food_keyword + size_hint Mistral.
    const foodKeyword =
      typeof it.food_keyword === 'string' ? it.food_keyword.trim().toLowerCase() : '';
    const sizeHint: ParsedItem['sizeHint'] =
      it.size_hint === 'small' || it.size_hint === 'medium' || it.size_hint === 'large'
        ? it.size_hint
        : null;

    // Match avec portion_foods pour récupérer size_variability +
    // base_g (= grams sans le multiplicateur de taille, utile UI).
    const matchedFood = foodKeyword
      ? portionRules.foods.find(
          (f) =>
            f.name === foodKeyword ||
            f.name.includes(foodKeyword) ||
            foodKeyword.includes(f.name),
        )
      : undefined;
    const sizeVariability = matchedFood?.sizeVariability ?? 'medium';
    // Base = portion standard du food matché. Sinon retombe sur grams
    // estimé Mistral (le ratio sera 1).
    const baseGrams = matchedFood ? matchedFood.portionG : grams;

    // Étape 2a : essayer chaque variante jusqu'à trouver des candidats
    let candidates: Awaited<ReturnType<typeof searchCiqualFoods>> = [];
    let usedQuery = cascade[0];
    for (const variant of cascade) {
      const found = await searchCiqualFoods(variant, 15);
      if (found.length > 0) {
        candidates = found;
        usedQuery = variant;
        break;
      }
    }

    type Picked = (typeof candidates)[number] | null;
    let picked: Picked = candidates[0] ?? null;

    // Étape 2d : si plusieurs candidats et pas de match évident, on
    // demande à Mistral de choisir avec le contexte de la phrase.
    if (candidates.length > 1 && !isObviousMatch(usedQuery, candidates[0].name)) {
      const better = await pickBestCandidate(text, usedQuery, candidates);
      if (better) {
        picked = better;
      } else {
        picked = null;
      }
    }
    const query = usedQuery;

    const factor = grams / 100;
    const kcalPerPortion =
      picked && picked.kcal_per_100g !== null
        ? round1(picked.kcal_per_100g * factor)
        : null;
    const proteinsPerPortion =
      picked && picked.proteins_g !== null ? round1(picked.proteins_g * factor) : null;
    const lipidsPerPortion =
      picked && picked.lipids_g !== null ? round1(picked.lipids_g * factor) : null;
    const carbsPerPortion =
      picked && picked.carbs_g !== null ? round1(picked.carbs_g * factor) : null;

    const toPublic = (c: typeof candidates[number]): CiqualCandidatePublic => ({
      ciqualId: c.id,
      alimCode: c.alim_code,
      name: c.name,
      kcalPer100g: c.kcal_per_100g,
      proteinsG: c.proteins_g,
      lipidsG: c.lipids_g,
      carbsG: c.carbs_g,
    });

    // Construit topCandidates : on remonte TOUJOURS la liste des
    // 7 meilleurs candidats Ciqual, même si on a un match certain,
    // pour permettre à l'utilisatrice de choisir une autre option
    // (UX V3 — "tu confirmes ?").
    const topCandidates =
      candidates.length > 0
        ? candidates.slice(0, 7).map(toPublic)
        : undefined;

    // Extraction des accompagnements suggérés par Mistral (max 3, triés
    // par kcal décroissant). Pas d'appel à la DB : c'est dynamique
    // 100% LLM, source plat-spécifique.
    let possibleAccompaniments: AccompanimentSuggestion[] | undefined;
    if (Array.isArray(it.possible_accompaniments)) {
      const cleaned = it.possible_accompaniments
        .filter(
          (a) =>
            a &&
            typeof a.name === 'string' &&
            a.name.trim().length > 0 &&
            typeof a.typical_g === 'number' &&
            Number.isFinite(a.typical_g) &&
            a.typical_g > 0 &&
            typeof a.kcal_estimate === 'number' &&
            Number.isFinite(a.kcal_estimate) &&
            a.kcal_estimate >= 0,
        )
        .map((a) => ({
          name: a.name.trim(),
          typicalG: Math.round(a.typical_g),
          kcalEstimate: Math.round(a.kcal_estimate),
        }))
        // Tri par kcal décroissant (sécurité, on ne fait pas confiance
        // aveuglément à l'ordre Mistral).
        .sort((x, y) => y.kcalEstimate - x.kcalEstimate)
        .slice(0, 3);
      if (cleaned.length > 0) possibleAccompaniments = cleaned;
    }

    out.push({
      label: picked ? picked.name : query,
      searchQuery: query,
      portions,
      approxGrams: grams,
      baseGramsBeforeSizeHint: baseGrams,
      match: picked ? toPublic(picked) : null,
      kcalPerPortion,
      proteinsPerPortion,
      lipidsPerPortion,
      carbsPerPortion,
      topCandidates,
      foodKeyword: foodKeyword || undefined,
      sizeVariability,
      sizeHint,
      possibleAccompaniments,
    });
  }

  return NextResponse.json({
    items: out,
    correctedText: correctedText !== text ? correctedText : undefined,
  });
}

/**
 * Étape 0 : correction orthographique de la phrase via Mistral.
 * Retourne le texte corrigé, ou le texte original si l'appel
 * échoue (graceful fallback, on ne bloque pas le pipeline).
 */
async function correctSpelling(input: string): Promise<string> {
  try {
    const result = await callMistralJson(CORRECT_PROMPT, input, {
      maxTokens: 250,
      timeoutMs: 10_000,
    });
    const parsed = JSON.parse(result.content) as { corrected?: string };
    if (
      typeof parsed.corrected === 'string' &&
      parsed.corrected.trim().length > 0
    ) {
      return parsed.corrected.trim();
    }
  } catch {
    // Silencieux : on retombe sur l'input brut.
  }
  return input;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Si le nom Ciqual commence par la query (ex: query="pomme",
 * name="Pomme, chair et peau, crue") → match évident, skip l'appel
 * Mistral. Économise un appel API quand la recherche est triviale.
 */
function isObviousMatch(query: string, name: string): boolean {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (n === q) return true;
  if (n.startsWith(q + ',') || n.startsWith(q + ' ')) return true;
  return false;
}

const PICK_PROMPT = `Tu es un assistant nutritionnel. Choisis dans une liste de candidats Ciqual ANSES celui qui correspond le mieux à un aliment mentionné dans une phrase.

SORTIE OBLIGATOIRE (JSON pur) :
{ "alim_code": <int|null>, "reason": "<courte explication>" }

- alim_code : code numérique du candidat retenu, OU null si aucun ne correspond raisonnablement.
- reason : 1 phrase ("plat préparé identique", "ingrédient principal", "aucun match correct").
- Préfère le candidat le plus PROCHE du plat décrit (pas un ingrédient si c'est un plat composé).
- Si plusieurs candidats sont équivalents, prends le plus court / le plus générique.
- Si tu n'es pas sûr → null.`;

type CiqualCandidate = Awaited<
  ReturnType<typeof searchCiqualFoods>
>[number];

async function pickBestCandidate(
  originalText: string,
  searchQuery: string,
  candidates: CiqualCandidate[],
): Promise<CiqualCandidate | null> {
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. alim_code=${c.alim_code} — "${c.name}"${
          c.kcal_per_100g !== null ? ` (${c.kcal_per_100g} kcal/100g)` : ''
        }`,
    )
    .join('\n');
  const userPrompt = `Phrase originale: "${originalText}"
Aliment recherché: "${searchQuery}"

Candidats Ciqual :
${list}`;
  try {
    const result = await callMistralJson(PICK_PROMPT, userPrompt, {
      maxTokens: 200,
      timeoutMs: 12_000,
    });
    const parsed = JSON.parse(result.content) as {
      alim_code?: number | null;
      reason?: string;
    };
    if (
      typeof parsed.alim_code !== 'number' ||
      !Number.isFinite(parsed.alim_code)
    )
      return null;
    return candidates.find((c) => c.alim_code === parsed.alim_code) ?? null;
  } catch {
    // Si Mistral plante, fallback sur le top 1 du scoring.
    return candidates[0] ?? null;
  }
}
