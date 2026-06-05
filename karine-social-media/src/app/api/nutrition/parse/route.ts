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
  /** v5 : décomposition en ingrédients utilisée par le backend SI le
   *  plat composé n'est pas trouvé dans Ciqual (ex: poivron farci →
   *  poivron + viande + fromage). Tableau vide si pas un plat composé. */
  fallback_decomposition?: Array<{
    search_queries?: string[];
    food_keyword?: string;
    portions?: number;
    approx_grams?: number;
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
      "fallback_decomposition": [],
      "possible_accompaniments": [
        { "name": "miel", "typical_g": 15, "kcal_estimate": 49 },
        { "name": "confiture", "typical_g": 15, "kcal_estimate": 40 },
        { "name": "sucre", "typical_g": 5, "kcal_estimate": 20 }
      ]
    }
  ]
}

CHAMPS À RENSEIGNER POUR CHAQUE ITEM :

⚠️ RÈGLE 0 — PLATS COMPOSÉS = 1 SEUL ITEM, JAMAIS DÉCOMPOSÉ.

Tu dois identifier un PLAT COMPOSÉ par DEUX moyens, et générer UNE SEULE entry quand c'est le cas. NE DÉCOMPOSE JAMAIS en ingrédients individuels, même si la phrase liste explicitement ce qui est dedans.

a) Plats COMPOSÉS NOMMÉS — reconnais ces noms (et leurs variantes) :
   couscous, paella, cassoulet, hachis parmentier, lasagnes, blanquette, bourguignon, tajine, ratatouille, pot-au-feu, choucroute, raclette, fondue, tartiflette, gratin dauphinois, quiche (lorraine, aux poireaux…), pizza, spaghetti bolognaise/carbonara, risotto, moussaka, chili con carne, curry, tikka masala, butter chicken, pad thaï, sushi, ramen, pho, falafel, kebab, hamburger, croque-monsieur, croque-madame, sandwich, panini, wrap, parmentier, parmentière, pélardon, salade niçoise, salade césar, taboulé.

b) Plats COMPOSÉS par PATTERN SYNTAXIQUE — reconnais aussi ces patterns (X = aliment principal, Y/Z = garnitures/sauces qui font partie du plat) :
   - "X farci(e) au/à la/aux Y[ et Z]" → 1 item = "X farci(e)"
     ex: "tomate farcie au fromage et courgette" → 1 item "tomate farcie"
   - "Gratin de X" / "X gratiné(e) au/à la Y" → 1 item
     ex: "gratin de courgettes", "endives gratinées au jambon"
   - "Tarte au/à la X" / "Tarte X" → 1 item
     ex: "tarte aux pommes", "tarte au saumon"
   - "Quiche au/aux X" → 1 item
   - "Soupe de X" / "Velouté de X" / "Crème de X" → 1 item
   - "X à la Y" où Y est une sauce/préparation → 1 item
     ex: "saumon à la crème" → 1 item, "poulet à la moutarde" → 1 item
   - "X au four" / "X poêlé(e)" / "X braisé(e)" / "X mijoté(e)" → 1 item
   - "Brochettes de X" → 1 item
   - "Œufs au plat", "œuf brouillé", "omelette au/aux X" → 1 item
   - "Tagliatelles/spaghetti/pâtes au/à la X" → 1 item
   - "Riz X" (cantonais, sauté, basmati…) → 1 item
   - "Wok de X" → 1 item

c) RÈGLE D'OR : les mots qui suivent "à/au/aux", "avec", "et" À L'INTÉRIEUR d'un plat composé sont des INGRÉDIENTS du plat, PAS des items séparés. Les macros Ciqual du plat composé les couvrent déjà.

   ❌ MAUVAIS : "tomate farcie à la courgette et au fromage de chèvre" → 3 items (tomate, courgette, fromage)
   ✅ BON :    "tomate farcie à la courgette et au fromage de chèvre" → 1 item "tomate farcie"

   ❌ MAUVAIS : "quiche aux poireaux et lardons" → 3 items
   ✅ BON :    "quiche aux poireaux et lardons" → 1 item "quiche lorraine" (ou "quiche poireaux")

d) À l'inverse, l'utilisatrice énumère VRAIMENT des aliments distincts SI :
   - séparés par "puis", "ensuite", virgule + retour
   - listés à l'extérieur d'un plat composé (ex: "j'ai mangé du yaourt et une pomme" = 2 items)
   - clairement servis séparément (ex: "viande hachée avec des haricots verts" → 2 items, pas de pattern composé)

Exemples décisifs :
   - "couscous poulet" → 1 item ["couscous poulet", "couscous"]
   - "tomate farcie à la courgette et au fromage de chèvre" → 1 item ["tomate farcie viande", "tomate farcie", "tomate cuite"]
   - "saumon à la crème de poireaux" → 1 item ["saumon crème", "saumon cuit"]
   - "yaourt et pomme" → 2 items (séparation explicite, pas de plat composé)
   - "viande hachée avec des haricots" → 2 items (juxtaposition simple, pas de pattern)

⚠️ RÈGLE 0bis — FALLBACK DECOMPOSITION pour les plats composés :

Tu génères 1 item pour le plat composé (règle 0). MAIS la base Ciqual ne contient pas TOUS les plats composés possibles. Si Ciqual n'a pas l'entrée "poivron farci", on tombe sur "poivron" cru — l'abonnée mange beaucoup PLUS de calories qu'un poivron seul, à cause de la viande et du fromage à l'intérieur.

Solution : pour CHAQUE item identifié comme plat composé (règle 0), tu ajoutes un champ "fallback_decomposition" qui est un tableau d'ingrédients constitutifs avec leurs quantités proportionnelles. Le backend l'utilisera SI le plat composé n'est pas trouvé dans Ciqual (sinon il est ignoré).

Format de chaque élément de fallback_decomposition :
{
  "search_queries": [...],   // comme un item normal
  "food_keyword": "...",
  "portions": 1,
  "approx_grams": ...        // proportionnel au poids total du plat
}

Exemples :
- "tomate farcie à la viande et au fromage, 350g" :
  fallback_decomposition = [
    { "search_queries": ["tomate cuite", "tomate"], "food_keyword": "tomate", "portions": 1, "approx_grams": 200 },
    { "search_queries": ["bœuf haché cuit", "viande hachée"], "food_keyword": "viande hachée", "portions": 1, "approx_grams": 100 },
    { "search_queries": ["fromage"], "food_keyword": "fromage", "portions": 1, "approx_grams": 50 }
  ]
- "poivron farci à la viande et chèvre, 300g" :
  fallback_decomposition = [
    { "search_queries": ["poivron cuit", "poivron"], "food_keyword": "poivron", "portions": 1, "approx_grams": 180 },
    { "search_queries": ["bœuf haché cuit", "viande hachée"], "food_keyword": "viande hachée", "portions": 1, "approx_grams": 80 },
    { "search_queries": ["fromage chèvre", "chèvre"], "food_keyword": "chèvre", "portions": 1, "approx_grams": 40 }
  ]
- "gratin de courgettes au fromage, 300g" :
  fallback_decomposition = [
    { "search_queries": ["courgette cuite", "courgette"], "food_keyword": "courgette", "portions": 1, "approx_grams": 200 },
    { "search_queries": ["fromage râpé", "emmental râpé"], "food_keyword": "fromage", "portions": 1, "approx_grams": 60 },
    { "search_queries": ["béchamel"], "food_keyword": "béchamel", "portions": 1, "approx_grams": 40 }
  ]
- "yaourt" (NON plat composé) → fallback_decomposition = []  (tableau vide)
- "couscous poulet" (plat connu de Ciqual habituellement) → tu mets quand même un fallback au cas où :
  fallback_decomposition = [
    { "search_queries": ["semoule cuite", "semoule"], "food_keyword": "semoule", "portions": 1, "approx_grams": 200 },
    { "search_queries": ["poulet cuit", "poulet"], "food_keyword": "poulet", "portions": 1, "approx_grams": 100 },
    { "search_queries": ["légumes couscous", "légumes"], "food_keyword": "légumes", "portions": 1, "approx_grams": 100 }
  ]

RÈGLE : la SOMME des approx_grams du fallback ≈ approx_grams du plat composé principal (± 20%).
Si l'item N'EST PAS un plat composé : fallback_decomposition = [] (tableau vide, JAMAIS omis).

1) search_queries : tableau de 1 à 4 termes à chercher en cascade dans Ciqual. Le 1er est le plus précis, les suivants dégradent vers du plus générique. Si zéro résultat sur le 1er, on essaie le 2e, etc.

   ⚠️ RÈGLE CRITIQUE — CASCADE DÉGRADANTE :
   La DERNIÈRE entrée de search_queries doit TOUJOURS être l'aliment principal SEUL (le nom du légume, de la viande, du féculent, du fruit…). JAMAIS un qualificatif de préparation isolé comme "farci", "rôti", "grillé", "braisé", "mijoté", "poêlé", "gratiné", "pané", "fumé".

   ⚠️ RÈGLE VIANDES — TOUJOURS PRIVILÉGIER LA VERSION CUITE : pour TOUTE viande (bœuf, agneau, porc, veau, poulet, canard, dinde, lapin, viande hachée, steak…), le 1er search_query DOIT inclure "cuit" / "cuite" / "rôti" / "grillé", MÊME si l'utilisatrice ne précise pas la préparation. On mange rarement de la viande crue, donc on prend la version cuite par défaut.

   Exemples viandes :
   - "j'ai mangé du bœuf" → ["bœuf cuit", "bœuf braisé", "bœuf"] ✅ (cuit en 1er même si pas dit)
   - "viande hachée" → ["viande hachée cuite", "viande hachée", "bœuf haché cuit"] ✅
   - "côte de bœuf" → ["côte bœuf grillée", "côte bœuf cuit", "bœuf cuit", "bœuf"] ✅
   - "blanc de poulet" → ["blanc poulet cuit", "poulet cuit", "poulet"] ✅
   - "agneau" → ["agneau rôti", "agneau cuit", "agneau"] ✅
   - EXCEPTIONS (mention explicite de cru) :
     - "tartare de bœuf" → ["tartare bœuf", "bœuf cru"] ✅
     - "carpaccio de bœuf" → ["carpaccio bœuf", "bœuf cru"] ✅
     - "steak tartare" → ["tartare bœuf", "bœuf cru"] ✅

   Autres exemples :
   - "poivrons farcis à la viande" → ["poivron farci viande", "poivron"] ✅ (PAS ["poivron farci", "farci"] ❌)
   - "gigot d'agneau rôti" → ["gigot agneau rôti", "agneau cuit", "agneau"] ✅
   - "poisson pané" → ["poisson pané", "poisson cuit", "poisson"] ✅
   - "saumon fumé" → ["saumon fumé", "saumon"] ✅ (la forme "saumon fumé" existe en Ciqual donc OK en 1er)

2) food_keyword : un mot-clé simple en français qui sert à matcher la grille des portions (voir ci-dessous). Ex : "yaourt", "lait", "frites", "pomme", "salade".

3) portions : nombre de portions. "2 pommes" = 2. "un demi sandwich" = 0.5. "un verre de lait" = 1.

4) approx_grams : masse en grammes pour UNE portion. Calcule selon la grille ci-dessous × le multiplicateur (si adjectif).

5) size_hint : indique si l'utilisatrice a mentionné explicitement une taille.
   - "small" si elle dit "petit", "petite", "léger", "mini" → multiplicateur déjà appliqué dans approx_grams
   - "medium" si elle dit "moyen", "normal" → multiplicateur ×1
   - "large" si elle dit "grand", "gros", "grosse", "énorme", "XL" → multiplicateur déjà appliqué
   - null si aucune taille mentionnée

6) possible_accompaniments : tableau de **2 à 3** suggestions d'accompagnements ou ingrédients additionnels classiques qui pourraient accompagner ce plat et augmenter SIGNIFICATIVEMENT les calories ou les macros (sauce, fromage, huile, sucre, crème, herbes, condiments…). TRIE PAR KCAL_ESTIMATE DÉCROISSANT (le plus calorique en 1er pour alerter l'abonnée).

   ⚠️ RÈGLE — TOUJOURS PROPOSER 2 à 3 SUGGESTIONS, même si la phrase mentionne déjà un accompagnement. Le filtrage des doublons est géré côté UI. Ton job : penser à ce qui s'ajoute typiquement.
   - "crêpe au sucre" → [nutella, chocolat, confiture]  (sucre déjà dit → sera filtré, mais d'autres options restent)
   - "café au lait" → [sucre, miel, crème]
   - "pâtes au parmesan" → [huile d'olive, beurre, basilic]
   - "spaghetti à la bolognaise" → [parmesan, huile d'olive, basilic]   ← plat composé, mais on enrichit
   - "lasagnes" → [parmesan, basilic, salade verte]
   - "ratatouille" → [huile d'olive, parmesan, riz blanc]
   - "couscous" → [harissa, semoule, raisins secs]
   - "ratatouille" → [huile d'olive, parmesan, riz blanc]
   - "soupe à l'oignon" → [croûtons, gruyère râpé, crème fraîche]

   Format chaque élément : { name, typical_g, kcal_estimate }
   - name : nom de l'accompagnement en français minuscules ("vinaigrette", "parmesan", "miel"…)
   - typical_g : masse typique d'une portion classique (vinaigrette 15g, fromage râpé 10g, miel 15g, sucre 5g…)
   - kcal_estimate : kcal de la portion typique (utilise tes connaissances : huile=90, vinaigrette=70, fromage râpé=40, miel=49, sucre=20…)

   EXCEPTION — tableau vide [] : UNIQUEMENT si l'aliment est typiquement consommé seul SANS rien d'ajoutable (eau plate, alcool fort pur, fruit cru…). Pour TOUT le reste, propose au moins 2.

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
  // Queue mutable d'items à traiter. On peut y INSÉRER des sous-items
  // depuis fallback_decomposition d'un plat composé si Ciqual ne le
  // trouve pas. Plafond 30 pour éviter une boucle infinie improbable.
  const itemsQueue: MistralItem[] = [...items];
  const MAX_ITEMS = 30;
  let processed = 0;
  let qi = 0;
  while (qi < itemsQueue.length && processed < MAX_ITEMS) {
    const it = itemsQueue[qi];
    qi++;
    processed++;
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
    // PERTINENTS — c-à-d dont au moins UN nom commence par le mot
    // principal (1er token de la variant). Sinon on continue la
    // cascade. Évite le bug "poivron farci" qui matchait "Olive
    // farcie au poivron" parce que c'était la seule entry trouvée.
    let candidates: Awaited<ReturnType<typeof searchCiqualFoods>> = [];
    let usedQuery = cascade[0];
    // Fallback si AUCUNE variant n'a de candidat pertinent : on
    // garde au moins le dernier non-vide pour ne pas finir à 0.
    let bestFallback: typeof candidates = [];
    let bestFallbackQuery = cascade[0];

    const stripAccents = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/œ/g, 'oe');

    for (const variant of cascade) {
      const found = await searchCiqualFoods(variant, 15);
      if (found.length === 0) continue;
      // Sauvegarde au cas où rien de "pertinent"
      if (bestFallback.length === 0) {
        bestFallback = found;
        bestFallbackQuery = variant;
      }
      // Pertinence : au moins un candidat commence par le mot
      // principal de la query.
      const principal = stripAccents(variant.split(/\s+/)[0] ?? '');
      const isRelevant =
        principal.length >= 3 &&
        found.some((c) => stripAccents(c.name).startsWith(principal));
      if (isRelevant) {
        candidates = found;
        usedQuery = variant;
        break;
      }
    }
    if (candidates.length === 0) {
      candidates = bestFallback;
      usedQuery = bestFallbackQuery;
    }

    // BASCULE FALLBACK_DECOMPOSITION : on décompose en ingrédients si
    // (a) la cascade n'a pas trouvé de match pertinent — Ciqual ne
    //     contient même pas l'ingrédient principal,
    // OU
    // (b) le candidat trouvé est l'ingrédient principal SEUL (style
    //     "Poivron, rouge, cru") alors qu'on cherchait un plat
    //     composé — la décomposition apporte les ingrédients que
    //     l'ingrédient principal ne couvre pas (poulet, riz…).
    //
    // Heuristique pour (b) : le nom Ciqual matché ne contient AUCUN
    // mot de préparation typique d'un plat composé (farci, gratin,
    // à la, au four, tarte, quiche…).
    const principalCascade = stripAccents(
      (cascade[0]?.split(/\s+/)[0]) ?? '',
    );
    const hasRelevantMatch =
      candidates.length > 0 &&
      principalCascade.length >= 3 &&
      candidates.some((c) =>
        stripAccents(c.name).startsWith(principalCascade),
      );
    // Vrai plat composé reconnu côté Ciqual = nom contient un mot
    // qui caractérise une préparation cuisinée.
    const PLAT_COMPOSE_REGEX =
      /\b(farci|farcie|farcis|farcies|gratin|gratine|gratinee|gratines|gratinees|tarte|quiche|soupe|veloute|creme\s+de|a\s+la|au\s+four|poele|poelee|braise|braisee|mijote|mijotee|cuisine|prepare|bourguignon|tajine|couscous|pizza|lasagne|lasagnes|moussaka|risotto|paella|sushi|hachis|parmentier|cassoulet|choucroute|raclette|fondue|tartiflette|ratatouille|blanquette|chili|curry|wok|brochettes|omelette)\b/i;
    const matchedName = candidates[0] ? stripAccents(candidates[0].name) : '';
    const isPlatComposeMatch =
      hasRelevantMatch && PLAT_COMPOSE_REGEX.test(matchedName);
    const shouldDecompose =
      (!hasRelevantMatch || !isPlatComposeMatch) &&
      Array.isArray(it.fallback_decomposition) &&
      it.fallback_decomposition.length > 0;
    if (shouldDecompose) {
      const subItems: MistralItem[] = (it.fallback_decomposition ?? [])
        .filter(
          (sub) =>
            sub &&
            (Array.isArray(sub.search_queries)
              ? sub.search_queries.some(
                  (q) => typeof q === 'string' && q.trim(),
                )
              : false),
        )
        .map((sub) => ({
          search_queries: sub.search_queries,
          food_keyword: sub.food_keyword,
          portions: sub.portions,
          approx_grams: sub.approx_grams,
          fallback_decomposition: [], // évite la récursion
        }));
      if (subItems.length > 0) {
        itemsQueue.splice(qi, 0, ...subItems);
        continue; // skip l'item composé : ses ingrédients prendront sa place
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
