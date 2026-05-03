/**
 * AI Cut Parser — analyse une commande utilisateur en langage naturel et
 * retourne une intention structurée pour l'orchestrateur de découpe.
 *
 * Pipeline :
 *   1. Parser local rapide (regex) : tente de matcher des patterns simples
 *      ("extrait X", "découpe X au centre"). Si OK → retour direct, pas
 *      d'appel LLM (économise 500ms-2s).
 *   2. Sinon, appel Ollama (Qwen 2.5 1.5B par défaut) avec un system prompt
 *      structuré. Le LLM gère la traduction FR→EN + extraction des slots.
 *
 * Intent V1 : seul `extract` est implémenté côté pipeline d'exécution. Les
 * autres intents (`remove`, `replace`, `change_color`…) sont reconnus mais
 * routés vers un placeholder "non implémenté".
 */

import { ollamaJSON } from './ollama'

export type CutIntent =
  | 'extract'        // "extrais le canapé" / "découpe la lampe"
  | 'remove'         // "enlève la voiture rouge" (V2)
  | 'replace'        // "remplace le tableau par une fenêtre" (V2)
  | 'change_color'   // "mets le canapé en rouge" (V2)
  | 'change_material'// "fais le sol en marbre" (V2)
  | 'add'            // "ajoute un PNJ pirate" (V2)
  | 'effect'         // "ajoute de la pluie sur la baie" (V2)
  | 'unknown'

export type SpatialFilter =
  | 'center' | 'left' | 'right' | 'top' | 'bottom'
  | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'
  | 'foreground' | 'background'
  | 'largest' | 'smallest'
  | null

export interface ParsedCutCommand {
  intent: CutIntent
  /** Nom de l'objet en ANGLAIS (canapé → sofa, voiture → car). GroundingDINO
   *  est entraîné en EN, donc on lui passe ça directement. Peut contenir un
   *  modifieur ("red sofa") si pertinent. Vide string si l'intent est juste
   *  une action sans cible (rare). */
  object_en: string
  /** Nom français original (pour affichage UI : "1 canapé trouvé"). */
  object_fr: string
  /** Filtre spatial déduit du langage. Sert à choisir parmi N matches DINO. */
  spatial: SpatialFilter
  /** Params libres selon l'intent (color pour change_color, ref pour replace…). */
  params: Record<string, string>
  /** Source de l'analyse — debug + UI ("Compris par règles" vs "Compris par IA"). */
  source: 'regex' | 'llm'
  /** Moteur de vision recommandé par le parser :
   *   - 'dino'         : GroundingDINO + SAM 1, rapide, multi-classes simple
   *   - 'florence_res' : Florence-2 RES — UN seul sujet désigné par une
   *                      expression relationnelle ("les coussins SUR le canapé",
   *                      retourne juste les coussins, pas le canapé)
   *   - 'florence_ctpg': Florence-2 CTPG + SAM 2 — PLUSIEURS sujets dont au
   *                      moins un avec relation ("le canapé ET les coussins
   *                      qui sont dessus", retourne canapé + coussins) */
  suggested_engine: 'dino' | 'florence_res' | 'florence_ctpg'
}

/** Détecte une relation spatiale entre objets dans la commande. Si présente,
 *  on suggère Florence-2 (qui raisonne sur ces relations) plutôt que DINO. */
const RELATION_RE = /\b(sur|dessus|au[\s-]?dessus|en[\s-]?dessus|dessous|au[\s-]?dessous|en[\s-]?dessous|sous|à côté|à coté|près de|pres de|devant|derrière|derriere|au\s?fond|à l['ae]\s?intérieur|à l['ae]\s?extérieur|entre|au[ -]?dessus|au[ -]?dessous|on (top of|the)|under(neath)?|behind|in front of|next to|beside|between|inside|outside)\b/i

// ── Parser regex (rapide, déterministe) ─────────────────────────────────────

const INTENT_PATTERNS: Array<{ re: RegExp; intent: CutIntent }> = [
  { re: /\b(extrait?s?|extract|d[ée]coup[ée]r?|coupe[rz]?|isole[rz]?|isolate)\b/i, intent: 'extract' },
  { re: /\b(enl[èe]ve[rz]?|supprime[rz]?|retire[rz]?|efface[rz]?|remove|delete)\b/i, intent: 'remove' },
  { re: /\b(remplace[rz]?|replace|swap)\b/i, intent: 'replace' },
  { re: /\b(change[rz]?\s+la?\s+couleur|recolor|colorize)\b/i, intent: 'change_color' },
  { re: /\bajoute[rz]?\b|\badd\b/i, intent: 'add' },
]

const SPATIAL_PATTERNS: Array<{ re: RegExp; spatial: SpatialFilter }> = [
  { re: /\b(en haut|tout en haut|au sommet|haut de l['ae]?image|top)\b/i, spatial: 'top' },
  { re: /\b(en bas|tout en bas|bas de l['ae]?image|bottom)\b/i, spatial: 'bottom' },
  { re: /\b(à gauche|tout à gauche|gauche de l['ae]?image|left)\b/i, spatial: 'left' },
  { re: /\b(à droite|tout à droite|droite de l['ae]?image|right)\b/i, spatial: 'right' },
  { re: /\b(au centre|du milieu|au milieu|centre de l['ae]?image|center|centered)\b/i, spatial: 'center' },
  { re: /\b(premier plan|foreground|devant|au premier plan)\b/i, spatial: 'foreground' },
  { re: /\b(arri[èe]re[ -]?plan|background|au fond|fond de l['ae]?image)\b/i, spatial: 'background' },
  { re: /\b(le plus (grand|gros|large|big|biggest)|largest)\b/i, spatial: 'largest' },
  { re: /\b(le plus (petit|small|smallest))\b/i, spatial: 'smallest' },
]

/** Petit dictionnaire FR→EN seed pour les objets les plus courants en
 *  scène intérieure / extérieure (ameublement, déco, nature). Couvre ~30%
 *  des cas. Le LLM gère le reste. */
const FR_EN_SEED: Record<string, string> = {
  canapé: 'sofa', sofa: 'sofa', fauteuil: 'armchair', chaise: 'chair',
  table: 'table', lit: 'bed', lampe: 'lamp', lampadaire: 'floor lamp',
  télé: 'television', télévision: 'television', écran: 'screen',
  tableau: 'painting', cadre: 'picture frame', miroir: 'mirror',
  rideau: 'curtain', rideaux: 'curtains', tapis: 'rug', coussin: 'cushion', coussins: 'cushions',
  fenêtre: 'window', fenêtres: 'windows', porte: 'door', mur: 'wall', sol: 'floor', plafond: 'ceiling',
  baie: 'glass door', cheminée: 'fireplace',
  arbre: 'tree', arbres: 'trees', plante: 'plant', plantes: 'plants',
  fleur: 'flower', fleurs: 'flowers', bouquet: 'flower bouquet',
  herbe: 'grass', ciel: 'sky', nuage: 'cloud', nuages: 'clouds',
  voiture: 'car', vélo: 'bicycle', moto: 'motorcycle',
  personnage: 'person', personne: 'person', homme: 'man', femme: 'woman', enfant: 'child',
  chien: 'dog', chat: 'cat', oiseau: 'bird',
  livre: 'book', livres: 'books', verre: 'glass', bouteille: 'bottle',
  ordinateur: 'computer', téléphone: 'phone', clavier: 'keyboard',
}

/** Détecte si le texte contient un connecteur multi-objets ("et", "+", "ainsi
 *  que", etc). Si oui, le regex parser bail → on laisse le LLM gérer la liste
 *  d'objets et la traduction propre. */
const MULTI_OBJECT_RE = /\b(et|and|plus|ainsi que|avec|along with)\b|[+,]/i

/** Tente de parser via regex. Retourne null si trop ambigu → fallback LLM. */
export function tryParseRegex(text: string): ParsedCutCommand | null {
  // 0a. Multi-objets ? → LLM (regex peut pas gérer la combinatoire dico)
  if (MULTI_OBJECT_RE.test(text)) return null
  // 0b. Relation spatiale entre objets ? → LLM (le regex extrait juste le 1er
  // mot, on perdrait l'autre objet de la relation). Florence-2 fera le reste.
  if (RELATION_RE.test(text)) return null

  // 1. Détecte l'intent
  let intent: CutIntent = 'unknown'
  for (const p of INTENT_PATTERNS) {
    if (p.re.test(text)) { intent = p.intent; break }
  }
  // Si pas d'intent ou intent complexe (replace/change_color), fallback LLM
  if (intent === 'unknown' || intent === 'replace' || intent === 'change_color' || intent === 'add') {
    return null
  }

  // 2. Détecte le filtre spatial
  let spatial: SpatialFilter = null
  for (const p of SPATIAL_PATTERNS) {
    if (p.re.test(text)) { spatial = p.spatial; break }
  }

  // 3. Extrait l'objet : tout ce qui reste après avoir retiré intent + spatial + stopwords
  let cleaned = text.toLowerCase()
  for (const p of INTENT_PATTERNS) cleaned = cleaned.replace(p.re, ' ')
  for (const p of SPATIAL_PATTERNS) cleaned = cleaned.replace(p.re, ' ')
  cleaned = cleaned
    .replace(/\b(le|la|les|l['e]|un|une|des|du|de|d['e]|au|aux|sur|dans|puis|alors)\b/gi, ' ')
    .replace(/[.,;:!?'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return null

  // Cherche dans le dico, sinon retourne le 1er mot tel quel (last resort)
  const words = cleaned.split(' ')
  const objectFr = words[0]
  const objectEn = FR_EN_SEED[objectFr] ?? null

  // Si le mot n'est pas dans le dico, on bascule sur LLM (plus fiable que random)
  if (!objectEn) return null

  // Le regex parser bail sur multi-objet (MULTI_OBJECT_RE) ou relation
  // (RELATION_RE), donc à ce stade on est sur un objet seul sans relation.
  return {
    intent,
    object_en: objectEn,
    object_fr: objectFr,
    spatial,
    params: {},
    source: 'regex',
    suggested_engine: 'dino',
  }
}

// ── Parser LLM (fallback robuste pour tout ce que regex ne capture pas) ────

const SYSTEM_PROMPT = `You are a NLU module for an image editor. Parse the user's French command into a strict JSON object describing the editing intent.

OUTPUT FORMAT (always respond with valid JSON, no other text):
{
  "intent": "extract" | "remove" | "replace" | "change_color" | "change_material" | "add" | "effect" | "unknown",
  "object_en": "<object name in ENGLISH, suitable for GroundingDINO or Florence-2>",
  "object_fr": "<object name in original French>",
  "spatial": "center" | "left" | "right" | "top" | "bottom" | "top_left" | "top_right" | "bottom_left" | "bottom_right" | "foreground" | "background" | "largest" | "smallest" | null,
  "params": { "<key>": "<value>" },
  "suggested_engine": "dino" | "florence"
}

INTENT GUIDE:
- "extract" : extrait, découpe, isole, sépare
- "remove" : enlève, supprime, retire, efface
- "replace" : remplace X par Y → params.target_en = "Y in english"
- "change_color" : change la couleur, mets en rouge → params.new_color_en = "<color in english>"
- "change_material" : fais en marbre → params.new_material_en = "<material in english>"
- "add" : ajoute X → object = X
- "effect" : ajoute de la pluie / brouillard / neige → object = effect type ("rain", "fog", "snow")

OBJECT TRANSLATION:
- Translate French nouns to English words/phrases that the vision engine recognizes.
- Examples: "canapé" → "sofa", "baie vitrée" → "glass door", "lampadaire" → "floor lamp", "rideaux" → "curtains".
- Preserve descriptors when relevant: "voiture rouge" → "red car", "chat blanc" → "white cat".

FORMAT object_en (varie selon suggested_engine) :

A) ENGINE = "dino" — multi-objets sans relation OU objet seul.
   Format : noun phrases concaténées avec " . " (espace point espace).
   - "le canapé"                         → en="sofa"
   - "le canapé et les coussins"         → en="sofa . cushions"
   - "lampe et tableau et plante"        → en="lamp . painting . plant"
   - object_fr garde la phrase originale FR : "canapé et coussins", "lampe, tableau et plante"

B) ENGINE = "florence_res" — UN sujet désigné par une relation.
   Format : phrase anglaise NATURELLE complète (referring expression).
   Le sujet désigné est généralement le 1er nom de la phrase.
   - "les coussins qui sont sur le canapé"  → en="the cushions on the sofa", fr="coussins"
   - "la voiture devant la maison"           → en="the car in front of the house", fr="voiture"
   - "l'oiseau dans la cage"                  → en="the bird in the cage", fr="oiseau"
   - "la lampe à côté du fauteuil"            → en="the lamp next to the armchair", fr="lampe"
   - "le chat sous la table"                  → en="the cat under the table", fr="chat"
   object_fr = LE SUJET SEUL (juste 1 mot ou groupe nominal court).

C) ENGINE = "florence_ctpg" — PLUSIEURS sujets dont au moins un avec relation.
   Format Florence-2 CTPG : "phrase1. phrase2. phrase3." — POINT COLLÉ au mot
   précédent (PAS d'espace avant le point), espace APRÈS le point.
   ⚠ INCORRECT : "sofa . cushions ."   (Florence voit 1 seule phrase "sofa . cushions")
   ⚠ CORRECT   : "sofa. cushions."     (Florence voit 2 phrases distinctes)
   Termine toujours la dernière phrase par un point.
   Pas d'articles ("the", "a") au début. Pas de pronoms ("it"). Répète l'objet.

   - "le canapé et les coussins qui sont dessus"  → en="sofa. cushions on the sofa.",            fr="canapé et coussins"
   - "la maison et la voiture devant"             → en="house. car in front of the house.",      fr="maison et voiture"
   - "la cage et l'oiseau dedans"                 → en="cage. bird inside the cage.",            fr="cage et oiseau"
   - "le fauteuil et la lampe à côté"             → en="armchair. lamp next to the armchair.",   fr="fauteuil et lampe"
   - "le canapé, les coussins et le tableau"      → en="sofa. cushions. painting.",              fr="canapé, coussins et tableau"

SPATIAL HINTS:
- Map French spatial expressions to the enum.
- "au centre" / "du milieu" → "center"
- "à gauche" / "côté gauche" → "left"
- "premier plan" / "devant" → "foreground"
- "arrière-plan" / "au fond" → "background"
- "le plus grand" / "le plus gros" → "largest"
- If no spatial info → null

ENGINE SELECTION (suggested_engine field) — 3 valeurs possibles :

1. "dino" : objets simples ou multiples SANS relation spatiale entre objets.
   Le filtre spatial (centre/gauche/droite) ne compte PAS comme relation entre
   objets, juste comme position d'UN objet sur l'image.
   - "le canapé"                          → dino
   - "le canapé au centre"                → dino
   - "le canapé et les coussins"          → dino (multi-objet sans relation)
   - "le canapé rouge"                    → dino (descripteur)
   - "la voiture rouge à gauche"          → dino

2. "florence_res" : UN SEUL sujet désigné par une expression relationnelle.
   L'utilisateur veut le sujet désigné UNIQUEMENT, pas l'objet de référence.
   - "les coussins QUI SONT SUR le canapé"  → florence_res (juste coussins)
   - "la voiture DEVANT la maison"           → florence_res (juste voiture)
   - "le chat SOUS la table"                  → florence_res (juste chat)
   - "la lampe À CÔTÉ DU fauteuil"            → florence_res (juste lampe)
   - "l'oiseau DANS la cage"                  → florence_res (juste oiseau)
   Caractéristique : un seul sujet, l'objet de référence est juste un repère.

3. "florence_ctpg" : PLUSIEURS sujets dont au moins un avec relation.
   L'utilisateur veut TOUS les objets mentionnés.
   - "le canapé ET les coussins qui sont dessus"  → florence_ctpg (canapé + coussins)
   - "la maison ET la voiture devant"             → florence_ctpg (maison + voiture)
   - "la cage ET l'oiseau dedans"                 → florence_ctpg (cage + oiseau)
   Caractéristique : connecteur "et"/"and" + au moins une relation.

Mots-clés relation : sur, dessus, dessous, sous, devant, derrière, à côté de,
près de, entre, dans, on, on top of, under, behind, in front of, next to,
beside, between, inside.

EXAMPLES:
Input: "Repère le canapé au centre et extrait"
Output: {"intent":"extract","object_en":"sofa","object_fr":"canapé","spatial":"center","params":{},"suggested_engine":"dino"}

Input: "Extrais le canapé et les coussins"
Output: {"intent":"extract","object_en":"sofa . cushions","object_fr":"canapé et coussins","spatial":null,"params":{},"suggested_engine":"dino"}

Input: "Extrais les coussins qui sont sur le canapé"
Output: {"intent":"extract","object_en":"the cushions on the sofa","object_fr":"coussins","spatial":null,"params":{},"suggested_engine":"florence_res"}

Input: "Extrais le canapé et les coussins qui sont dessus"
Output: {"intent":"extract","object_en":"sofa. cushions on the sofa.","object_fr":"canapé et coussins","spatial":null,"params":{},"suggested_engine":"florence_ctpg"}

Input: "Découpe la lampe à côté du fauteuil"
Output: {"intent":"extract","object_en":"the lamp next to the armchair","object_fr":"lampe","spatial":null,"params":{},"suggested_engine":"florence_res"}

Input: "Trouve la voiture devant la maison et la maison"
Output: {"intent":"extract","object_en":"house. car in front of the house.","object_fr":"maison et voiture","spatial":null,"params":{},"suggested_engine":"florence_ctpg"}

Input: "Enlève la voiture rouge à gauche"
Output: {"intent":"remove","object_en":"red car","object_fr":"voiture rouge","spatial":"left","params":{},"suggested_engine":"dino"}

Input: "Change la couleur du canapé en bleu"
Output: {"intent":"change_color","object_en":"sofa","object_fr":"canapé","spatial":null,"params":{"new_color_en":"blue"},"suggested_engine":"dino"}

Input: "Remplace le tableau par une fenêtre"
Output: {"intent":"replace","object_en":"painting","object_fr":"tableau","spatial":null,"params":{"target_en":"window"},"suggested_engine":"dino"}

Now parse the user's input. Return ONLY the JSON, no markdown, no explanation.`

/** Parser LLM via Ollama. Throw si Ollama indisponible. */
export async function parseWithLLM(text: string, opts?: { model?: string }): Promise<ParsedCutCommand> {
  const raw = await ollamaJSON<Partial<ParsedCutCommand>>({
    system: SYSTEM_PROMPT,
    prompt: text,
    model: opts?.model,
    temperature: 0.1,
  })

  // Validation + valeurs par défaut sécurisées
  const intent: CutIntent = isValidIntent(raw.intent) ? raw.intent : 'unknown'
  const object_en = (raw.object_en ?? '').toString().trim()
  const object_fr = (raw.object_fr ?? '').toString().trim()
  const spatial = isValidSpatial(raw.spatial) ? raw.spatial : null
  const params = (raw.params && typeof raw.params === 'object') ? raw.params as Record<string, string> : {}
  // suggested_engine : la HEURISTIQUE prime sur Qwen pour les cas ambigus.
  // Qwen 1.5B confond souvent florence_res (1 sujet) vs florence_ctpg (multi
  // sujet) quand la phrase contient à la fois `et` ET une relation. La
  // heuristique déterministe corrige ça en forçant ctpg quand c'est manifeste.
  const validEngines = new Set(['dino', 'florence_res', 'florence_ctpg'])
  const hasRelation = RELATION_RE.test(text) ||
    /\b(on top of|next to|in front of|behind|under|beside|inside)\b/i.test(object_en)
  const hasMultiObject = MULTI_OBJECT_RE.test(text)

  let suggested_engine: 'dino' | 'florence_res' | 'florence_ctpg'
  if (hasRelation && hasMultiObject) {
    // Override Qwen : multi-sujet + relation → ctpg de manière déterministe
    suggested_engine = 'florence_ctpg'
  } else if (typeof raw.suggested_engine === 'string' && validEngines.has(raw.suggested_engine)) {
    // Qwen a précisé un engine valide → on lui fait confiance
    suggested_engine = raw.suggested_engine as 'dino' | 'florence_res' | 'florence_ctpg'
  } else if (hasRelation) {
    suggested_engine = 'florence_res'
  } else {
    suggested_engine = 'dino'
  }

  return { intent, object_en, object_fr, spatial, params, source: 'llm', suggested_engine }
}

/** Wrapper qui essaie regex d'abord, fallback LLM. Throw uniquement si LLM
 *  fail (pas de fallback supplémentaire possible). */
export async function parseCutCommand(text: string): Promise<ParsedCutCommand> {
  const regexResult = tryParseRegex(text)
  if (regexResult) return regexResult
  return await parseWithLLM(text)
}

// ── Type guards ─────────────────────────────────────────────────────────────

const VALID_INTENTS: CutIntent[] = ['extract','remove','replace','change_color','change_material','add','effect','unknown']
const VALID_SPATIALS: Exclude<SpatialFilter, null>[] = [
  'center','left','right','top','bottom','top_left','top_right','bottom_left','bottom_right',
  'foreground','background','largest','smallest',
]
function isValidIntent(v: unknown): v is CutIntent {
  return typeof v === 'string' && (VALID_INTENTS as string[]).includes(v)
}
function isValidSpatial(v: unknown): v is SpatialFilter {
  if (v === null || v === undefined) return true
  return typeof v === 'string' && (VALID_SPATIALS as string[]).includes(v)
}
