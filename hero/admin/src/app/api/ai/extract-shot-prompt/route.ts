import { NextRequest, NextResponse } from 'next/server'
import https from 'https'

/**
 * POST /api/ai/extract-shot-prompt
 *
 * Demande à l'IA Mistral d'extraire une config technique de shot LTX depuis
 * une description en langage naturel de l'auteur. Utilisé par la "Demande à
 * l'IA" (Ctrl+K) du Studio Animation pour pré-remplir les champs Action /
 * Dialogue / Scène depuis une phrase libre type "Roman dribble et Marvyn
 * défend".
 *
 * Modèle : mistral-small-latest (free tier, 24B, suffisant pour extract JSON
 * structuré depuis du français court — Large = overkill pour ce cas).
 *
 * JSON mode activé via response_format pour garantir un output parsable sans
 * regex de récupération.
 *
 * Refonte 2026-05-10.
 */

export const maxDuration = 30
export const runtime = 'nodejs'

// ── Types I/O ─────────────────────────────────────────────────────────────

interface PelliculeContextChar {
  id: string
  name: string
  gender: 'male' | 'female'
  hasVoice: boolean
  /** Description physique du perso (apparence, vêtements distinctifs). Aide
   *  Mistral à désambiguïser quand l'auteur mentionne juste un nom et qu'il
   *  faut faire le lien avec une description visuelle. Refonte 2026-05-11. */
  description?: string
  /** Position dans la scène source (left / center / right), depuis Designer
   *  placement.x. Aide Mistral à comprendre la géométrie de la scène quand
   *  l'auteur dit "X dépasse Y par la droite". Optionnel. */
  position?: 'left' | 'center' | 'right'
}

interface PelliculeContextShot {
  id: string
  characterIds: string[]
  speakerId: string | null
}

interface ExtractRequest {
  /** Phrase brute de l'auteur (FR). */
  userPrompt: string
  /** État courant de la pellicule sur laquelle on opère. */
  pelliculeContext: {
    pelliculeId: string
    activeShotIndex: number              // 0-based
    pelliculeShots: PelliculeContextShot[]
    /** Persos déjà placés dans la pellicule (= candidats actions/dialogues). */
    charactersInPellicule: PelliculeContextChar[]
    /** Tous les persos du book (= ceux qu'on peut potentiellement ajouter). */
    bookCharacters: PelliculeContextChar[]
    /** Description scène déjà remplie (pour ne pas la regénérer si déjà OK). */
    sceneVisible?: string
    sceneAppearance?: string
  }
  /** Optionnel : description Qwen VL mode 'scene' (décor / ambiance). */
  imageDescription?: string
  /** Optionnel : description Qwen VL mode 'characters' au format Vantage
   *  (`Male: ... / Female: ...`). Source de vérité PRIORITAIRE pour les
   *  vêtements visibles. Refonte 2026-05-11. */
  charactersDescription?: string
}

interface ShotExtraction {
  shotIndex: number
  speakerId: string | null
  perCharacter: Record<string, {
    action: string
    dialogue: string | null
    confidence: 'high' | 'medium' | 'low'
  }>
  suggestedDurationSec: number
}

interface SceneExtraction {
  scene_visible: string | null
  characters_appearance: string | null
  confidence: 'high' | 'medium' | 'low'
}

interface ExtractWarning {
  type: 'unknown_character' | 'missing_voice' | 'character_added' | 'multi_shot_truncated'
  message: string
  characterId?: string
}

interface ExtractResponse {
  intent: 'configure_pellicule'
  shots: ShotExtraction[]
  scene: SceneExtraction
  warnings: ExtractWarning[]
}

// ── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un assistant précis qui transforme la description en français d'un auteur en configuration JSON pour une animation vidéo LTX 2.3 dual-character. Ton output est consommé par une UI qui pré-remplit des champs ; l'auteur valide et applique.

# RÈGLES — CRITIQUES

## Décomposition atomique des actions
Décompose chaque action de personnage en MOUVEMENTS VISIBLES ATOMIQUES, un par ~1 seconde. Cite les parties du corps concrètes (main droite, pied gauche, regard, épaules, hanches, tête) et les objets manipulés. Chaque atome = ~1s d'animation visible.

⚠ **Connecteurs entre atomes — varie selon la nuance temporelle** :

Utilise des connecteurs explicites entre les atomes pour que le sampler temporal LTX 2.3 segmente bien les frames. Sans ces connecteurs, LTX mélange les actions ou les floute. Les ponctuations seules (virgules) sont trop ambiguës — LTX les interprète souvent comme actions parallèles.

**Vocabulaire à ta disposition** (du plus fort au plus doux), à varier pour ne pas être robotique :

- **Séquentiel strict** (A finit avant B) : "puis", "ensuite", "après"
- **Séquentiel causal** (B parce que A) : "alors", "du coup", "ce qui le pousse à"
- **Enchaîné mou** (A et B se suivent sans rupture nette) : "et", "et aussi"
- **Beat narratif / pause** (changement d'état) : ";" (point-virgule), ":"
- **Simultané** (A et B en même temps) : "tout en", "pendant que", "en même temps que"
- **Réaction** (B en réponse à A) : "en réaction", "voyant cela"

Privilégie SÉQUENTIEL STRICT pour les enchaînements de gestes physiques (le sampler en a le plus besoin). Garde les autres pour les transitions plus subtiles.

Exemples :
- ❌ "Roman dribble" → trop abstrait, LTX invente
- ❌ "Roman dribble la balle, fait un layup" → virgule seule = ambigu, LTX peut tout faire en parallèle
- ✅ "Roman fait rebondir la balle au sol avec la main droite, deux fois, **puis** saute et fait un layup"
- ✅ "Roman se tourne vers Marvyn, **ensuite** lève le bras gauche, **et** fixe son regard"
- ✅ "Marvyn dribble vers la droite ; **du coup** Roman recule pour se mettre en position défensive" (causal)
- ✅ "Roman dribble la balle main droite **tout en** regardant le panier" (simultané)
- ✅ "Marvyn shoote ; **alors** Roman saute pour bloquer" (réaction enchaînée)

Les actions liées à un instrument/son rythmé DOIVENT décrire les gestes (hoche la tête, marque le tempo du poignet, pied qui frappe la grosse caisse) — pas juste "il joue de la batterie".

## Calcul automatique de durée
\`suggestedDurationSec\` = nombre d'atomes (toutes actions confondues du shot) × 1, clampé entre 3 et 20. Arrondi à l'entier supérieur.

## Détection du speaker
Le perso avec un \`dialogue\` non vide EST le speaker du shot. Un seul speaker par shot — si plusieurs persos ont du dialogue dans la phrase de l'auteur, choisis le plus proéminent et déplace les autres en action seulement. Si aucun dialogue, \`speakerId: null\`.

## ⚠ ANTI-DUPLICATION dialogue ↔ action (règle CRITIQUE 2026-05-12)
Le texte parlé / lu / chuchoté va EXCLUSIVEMENT dans \`dialogue\`. L'action décrit l'ACTE OBSERVABLE (lire / dire / chuchoter / crier / réciter / annoncer / questionner / répondre) **SANS JAMAIS reproduire le contenu textuel**, même partiellement, même entre guillemets, même entre parenthèses.

Pourquoi : le moteur LTX 2.3 reçoit (1) le prompt texte global qui inclut l'action, ET (2) l'audio TTS dérivé du \`dialogue\`. Si le contenu prononcé apparaît dans l'action, LTX tente de lipsync le contenu de l'action ET l'audio TTS → double mouvement de bouche, désync, ou phrase étirée.

Exemples :
- ❌ \`action: "lit le destinataire à voix claire (\\"Hum, le bureau de Liane Fergusson, chef de la révolution.\\") tout en plissant les yeux"\` — contenu prononcé entre parenthèses = DUPLIQUÉ
- ✅ \`action: "lit l'inscription à voix claire tout en plissant les yeux"\` + \`dialogue: "Hum, le bureau de Liane Fergusson, chef de la révolution."\`
- ❌ \`action: "Marvyn s'exclame 'Tu rigoles !' puis recule"\` — contenu prononcé inline
- ✅ \`action: "Marvyn s'exclame puis recule"\` + \`dialogue: "Tu rigoles !"\`
- ❌ \`action: "récite la prophétie sur les sept étoiles"\` — paraphrase trop spécifique du contenu
- ✅ \`action: "récite la prophétie d'un ton solennel"\` + \`dialogue: "Quand les sept étoiles s'aligneront…"\`

Si la phrase de l'auteur contient le contenu prononcé (genre « Marvyn dit "Allons-y" »), tu DOIS séparer : verbe + manière → \`action\`, citation → \`dialogue\`. Jamais les deux dans \`action\`.

## Résolution des persos
N'utilise QUE les ids de persos qui existent dans \`charactersInPellicule\` ou \`bookCharacters\` (ne JAMAIS inventer un id) :
- Mention d'un perso DÉJÀ dans la pellicule → utilise son id directement
- Mention d'un perso dans \`bookCharacters\` mais PAS dans \`charactersInPellicule\` → ajoute-le quand même au perCharacter, ET ajoute warning {type: "character_added", characterId, message: "<Nom> sera ajouté à ce shot"}
- Mention d'un nom INTROUVABLE → warning {type: "unknown_character", message: "<Nom> non trouvé dans la banque"} et EXCLUS-le de l'output
- Si un perso reçoit un dialogue mais \`hasVoice: false\` → warning {type: "missing_voice", characterId, message: "<Nom> n'a pas de voix — assigne-en une dans la banque"}

## ⚠ ATTRIBUTION ACTION ↔ PERSO (règle CRITIQUE — bug le plus fréquent)
Quand l'auteur écrit "**X fait Y**", tu DOIS placer "fait Y" dans \`perCharacter[X.id].action\`. JAMAIS dans \`perCharacter[Y.id].action\` ou autre.

Exemple FAUX (à NE PAS faire) :
- Prompt auteur : *"Marvyn dribble et passe Roman, Roman défend"*
- ❌ Sortie incorrecte : \`perCharacter[roman_id].action = "dribble et passe Roman"\` ← inversé !
- ✅ Sortie correcte : \`perCharacter[marvyn_id].action = "dribble et passe Roman"\` + \`perCharacter[roman_id].action = "défend"\`

Quand l'auteur mentionne un perso dans l'action d'un AUTRE (ex : "Marvyn dépasse Roman par la droite"), c'est une indication directionnelle sur Marvyn, pas une action de Roman. L'action reste sous l'id de l'agent (Marvyn), Roman est juste mentionné comme repère textuel.

Utilise les champs \`description\` et \`position\` de chaque char pour t'aider à matcher quand un nom est ambigu. Ex : si l'auteur écrit "le joueur en blanc fait X", regarde \`description\` pour identifier le bon char ; si "le perso de gauche fait Y", regarde \`position\`.

## Champs scène

### \`scene_visible\` (décor / lieu)
Remplis UNIQUEMENT si l'auteur mentionne explicitement décor / éclairage / lieu. Si silence sur le décor, retourne null (= ne pas écraser l'existant).
Une phrase qui décrit une ACTION ne compte PAS comme description scène.

### \`characters_appearance\` (apparence persos format Vantage)
**Toujours remplir** quand on a au moins 1 perso dans \`charactersInPellicule\` ET qu'au moins 1 a un \`description\`. Si AUCUN char n'a de \`description\` non vide, retourne \`null\` (le système basculera sur Qwen VL en fallback côté serveur). Refonte 2026-05-11 — ce champ est CRITIQUE pour LTX 2.3 IC LoRA Dual : il alimente le bloc \`[Characters]\` du prompt Vantage qui ancre l'identité. Sans lui, LTX confond les persos.

⚠ **TYPE OBLIGATOIRE : STRING multi-lignes**, jamais un OBJET. Format attendu :
\`\`\`
"characters_appearance": "Male: blue jersey...\\nMale 2: white jersey..."
\`\`\`
PAS comme ça (ERREUR) :
\`\`\`
"characters_appearance": {"Male": "blue jersey...", "Male 2": "white jersey..."}
\`\`\`
Si tu renvoies un objet, ça apparaît comme "[object Object]" dans l'UI auteur (bug observé 2026-05-11). String pure obligatoire avec \\n entre les lignes.

⚠⚠ RÈGLE ANTI-INVENTION (la plus violée par les LLM — lis 2 fois)
Tu N'INVENTES AUCUN attribut physique non sourcé. Sources autorisées, par ordre de priorité :
1. **Le bloc "Vue de l'image source — persos visibles" (Qwen VL mode characters)** — SOURCE PRIMAIRE quand présente. C'est ce que Qwen VL voit RÉELLEMENT dans l'image. Recopie ces descriptions telles quelles dans characters_appearance, en remappant les labels Male:/Female:/Male 2: aux bons persos par couleur jersey / éléments distinctifs / ordre.
2. Le champ \`description\` du char dans le context (= sa fiche NPC) — utile pour matcher Qwen→id et pour enrichir si Qwen rate un détail
3. Une mention EXPLICITE par l'auteur dans son prompt ("Marvyn porte un casque dans cette scène") — override prioritaire

Tout attribut non couvert par 1/2/3 → INTERDIT dans le \`characters_appearance\`. Pas de "black shorts" si Qwen ne le dit pas et fiche NPC ne le dit pas. Pas de "high-top sneakers" par défaut. Pas de couleur de cheveux inventée.

**Stratégie pour matcher Qwen→ids quand le bloc "Vue persos" est présent :**
- Qwen utilise des labels génériques (Male: / Male 2: / Female:) — tu dois les remapper aux bons ids
- Indice de matching #1 : couleur de jersey/vêtement principal (Qwen dit "white jersey" → cherche le char dont \`description\` mentionne blanc, ou par défaut le 1er char de même genre)
- Indice de matching #2 : position spatiale (Qwen dit "on the left" → matche avec \`position: 'left'\` du context)
- Indice de matching #3 : ordre — Qwen liste de gauche à droite ; charactersInPellicule est ordonné par création
- Si tu n'arrives PAS à matcher avec certitude → garde le label Qwen générique et confidence 'low'

**Préfère COURT et fidèle plutôt que LONG et inventé.** Une phrase Vantage utile = juste assez pour discriminer ce char des autres dans la scène : couleur de top, ou couleur de cheveux, ou élément distinctif. C'est tout. LTX SEES l'image source — il n'a pas besoin de description exhaustive, il a besoin d'un label d'identité court.

Exemples :
- ❌ Description NPC = "boy in blue jersey" → "Male: wearing a blue basketball jersey, black shorts, and high-top sneakers" (shorts + sneakers INVENTÉS)
- ✅ Description NPC = "boy in blue jersey" → "Male: wearing a blue jersey"
- ✅ Description NPC = "boy in blue jersey" + Qwen VL mentionne "white shorts" → "Male: wearing a blue jersey and white shorts"
- ❌ Description NPC vide → "Male: wearing a white sleeveless basketball jersey, black shorts" (TOUT INVENTÉ — ne fais pas ça)
- ✅ Description NPC vide pour TOUS les chars → \`characters_appearance: null\` (laisse le serveur tomber sur Qwen VL)

⚠ DEUX templates au choix selon que tu CONNAIS la position du char ou non. La position vient EXCLUSIVEMENT du champ \`position\` fourni dans le context. Si ce champ est ABSENT ou \`undefined\`, tu N'EN INVENTES PAS — tu utilises le template B.

**Template A — position FOURNIE dans le context (\`position\` non vide) :**
\`\`\`
Male: <description physique compacte>, standing on the <position> side  # <Name>
\`\`\`

**Template B — position ABSENTE (\`position\` undefined / non fournie) :**
\`\`\`
Male: <description physique compacte>  # <Name>
\`\`\`

⚠ INTERDICTION ABSOLUE : ne JAMAIS écrire "standing on the right side" / "standing on the left side" / "standing on the center side" si tu n'as PAS reçu le champ \`position\` pour ce char. Pas de défaut, pas de devinette, pas de "j'ai mis right au pif". Si position absente → template B sans position. Si tu enfreins cette règle, deux persos se retrouvent au même endroit dans le prompt et LTX produit un visuel incohérent.

Source des champs :
- \`<description>\` = champ \`description\` du char dans le context (= sa fiche NPC). Si l'auteur a explicitement décrit un VÊTEMENT DIFFÉRENT pour cette scène ("Marvyn porte un casque dans cette scène"), enrichis ou remplace par cette info.
- \`<position>\` = champ \`position\` du char (left / center / right) UNIQUEMENT s'il est fourni dans le context. Aucune autre source admise (ni indices du prompt, ni inférence visuelle, ni défaut).
- Labels \`Male:\` / \`Female:\` / \`Male 2:\` etc. : assigne séquentiellement par genre, dans l'ordre d'apparition dans \`charactersInPellicule\`. Pas de noms propres dans le label (Vantage convention).
- Tout en français OU anglais selon le \`description\` source — le système traduira en EN automatiquement avant LTX.

Confidence :
- \`high\` si description + position viennent du context (== données déterministes)
- \`medium\` si tu as enrichi à partir d'indices dans le prompt auteur, OU si position manque mais description est solide
- \`low\` si tu as deviné

## Confiance
- "high" : mentionné explicitement par l'auteur
- "medium" : déduction raisonnable du contexte
- "low" : tu devines — l'UI marquera ❓ pour validation

## Scope : 1 ou 2 shots maximum
Tu configures UN shot par défaut (à l'index \`activeShotIndex\`). Tu PEUX en générer un DEUXIÈME (à \`activeShotIndex + 1\`) UNIQUEMENT si la phrase de l'auteur contient une césure chronologique TRÈS NETTE marquée par un connecteur séquentiel explicite : "puis", "ensuite", "après", "then", ou point/point-virgule séparant deux moments d'action distincts ET d'au moins ~3-4s chacun.

Quand splitter (rare, conservateur) :
- ✅ "Roman dribble vers le panier, puis il saute et dunk" → 2 shots (dribble | dunk)
- ✅ "Marvyn défend ; Roman recule et tire à 3 points" → 2 shots (défense | tir)
- ❌ "Roman fait rebondir la balle deux fois et dribble" → 1 shot (1 seule séquence d'action)
- ❌ "Roman dribble et Marvyn défend" → 1 shot (deux persos qui agissent EN PARALLÈLE = même shot)
- ❌ "Marvyn dribble deux fois devant Roman" → 1 shot (répétition simple ≠ césure ; "deux fois" = atome répété, pas 2 moments distincts)
- ❌ "Marvyn court, dribble, et passe à Roman" → 1 shot (succession fluide d'une même action de jeu, pas 2 moments narratifs distincts)
- ❌ "Marvyn shoote et la balle rentre" → 1 shot (cause-effet immédiate, pas 2 moments)

Heuristique : si tu hésites, tu fais 1 SHOT. Le split à 2 shots est l'EXCEPTION, pas la règle. Il doit y avoir un changement clair d'action principale entre les deux moments (mouvement complètement différent, ou 1 perso qui finit son action et un autre qui prend le relai).

Quand tu génères 2 shots :
- Le 1er a \`shotIndex = activeShotIndex\`
- Le 2nd a \`shotIndex = activeShotIndex + 1\`
- Les deux ont leur propre \`perCharacter\`, \`speakerId\`, \`suggestedDurationSec\`
- Le \`scene\` (décor + apparences) reste UNIQUE pour les deux (sortie scene.* identique pour le shot 2)

Si l'auteur décrit 3+ moments séparés ("Roman dribble PUIS dunk PUIS célèbre"), garde MAX 2 shots et ajoute warning {type: "multi_shot_truncated", message: "L'auteur décrit N moments — j'ai gardé les 2 plus importants, ajoute manuellement le 3e si besoin"}.

# OUTPUT
JSON STRICT, aucune prose, aucun fence markdown. Schema (\`shots\` contient 1 OU 2 entrées — voir règle "Scope") :
{
  "intent": "configure_pellicule",
  "shots": [{
    "shotIndex": <number = activeShotIndex pour le 1er, activeShotIndex+1 pour le 2nd si applicable>,
    "speakerId": <string | null>,
    "perCharacter": {
      "<charId>": {
        "action": "<FR avec atomes concrets>",
        "dialogue": "<FR | null>",
        "confidence": "high|medium|low"
      }
    },
    "suggestedDurationSec": <number>
  }],
  "scene": {
    "scene_visible": "<FR | null>",
    "characters_appearance": "<FR | null>",
    "confidence": "high|medium|low"
  },
  "warnings": [{
    "type": "unknown_character|missing_voice|character_added|multi_shot_truncated",
    "message": "<FR>",
    "characterId": "<string si applicable>"
  }]
}`

// ── Mistral call (model = small, JSON mode) ────────────────────────────────

interface MistralResponse {
  choices?: Array<{ message?: { content?: string } }>
  message?: string
  error?: { message?: string }
}

interface MistralCallResult {
  content: string
  finishReason?: string  // 'stop' | 'length' | 'tool_calls' | …
}

/** max_tokens 4096 (vs 2048 initial) — un JSON avec 2 persos + scène + warnings
 *  + actions décomposées en atomes peut facilement gonfler à 1500-3000 tokens
 *  en JSON mode (chaque caractère échappé compte). 4096 = marge confortable
 *  sans coût excessif (Mistral Small free tier). Si on hit length quand même,
 *  on retournera finishReason='length' et le caller pourra logger / retry. */
function callMistralSmallJson(systemPrompt: string, userPrompt: string): Promise<MistralCallResult> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('MISTRAL_API_KEY manquante dans .env.local')

  const body = JSON.stringify({
    model: 'mistral-small-latest',
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.mistral.ai',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 28_000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as MistralResponse & {
              choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
            }
            if (res.statusCode !== 200) {
              reject(new Error(json.message ?? json.error?.message ?? `Mistral HTTP ${res.statusCode}`))
              return
            }
            const choice = json.choices?.[0]
            const text = (choice?.message?.content as string ?? '').trim()
            resolve({ content: text, finishReason: choice?.finish_reason })
          } catch (e) {
            reject(new Error(`Parse Mistral response: ${e instanceof Error ? e.message : String(e)}`))
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Délai Mistral dépassé')) })
    req.write(body)
    req.end()
  })
}

// ── User prompt builder (concat contexte + phrase auteur) ──────────────────

function buildUserPrompt(req: ExtractRequest): string {
  const ctx = req.pelliculeContext
  const lines: string[] = []
  lines.push(`# Contexte`)
  lines.push(`Pellicule: ${ctx.pelliculeShots.length} shot(s) total, shot actif = index ${ctx.activeShotIndex}`)
  lines.push('')
  // Helper : sérialise un perso avec tous ses attributs disponibles. La
  // description et la position sont les CLÉS pour que Mistral désambiguïse
  // correctement quand l'auteur mentionne plusieurs persos dans une phrase
  // (refonte 2026-05-11 — fix bug d'inversion d'attribution observé).
  const renderChar = (c: PelliculeContextChar): string => {
    const parts = [
      `id="${c.id}"`,
      `name="${c.name}"`,
      `gender=${c.gender}`,
      `hasVoice=${c.hasVoice}`,
    ]
    if (c.position) parts.push(`position="${c.position}"`)
    if (c.description) parts.push(`description="${c.description.replace(/"/g, '\\"').slice(0, 200)}"`)
    return `- ${parts.join(' ')}`
  }

  lines.push(`Persos placés dans la pellicule (utiliser leur id) :`)
  if (ctx.charactersInPellicule.length === 0) {
    lines.push(`(aucun encore)`)
  } else {
    for (const c of ctx.charactersInPellicule) {
      lines.push(renderChar(c))
    }
  }
  lines.push('')
  lines.push(`Persos catalogue book (peuvent être ajoutés à la pellicule si l'auteur les mentionne) :`)
  if (ctx.bookCharacters.length === 0) {
    lines.push(`(aucun)`)
  } else {
    for (const c of ctx.bookCharacters) {
      lines.push(renderChar(c))
    }
  }
  lines.push('')
  if (ctx.sceneVisible) lines.push(`Scène déjà décrite: "${ctx.sceneVisible}"`)
  if (ctx.sceneAppearance) lines.push(`Apparence persos déjà décrite: "${ctx.sceneAppearance}"`)
  if (req.imageDescription) {
    lines.push('')
    lines.push(`# Vue de l'image source — décor (Qwen VL mode 'scene')`)
    lines.push(req.imageDescription)
  }
  if (req.charactersDescription) {
    lines.push('')
    lines.push(`# Vue de l'image source — persos visibles (Qwen VL mode 'characters', format Vantage)`)
    lines.push(`# ⚠ SOURCE DE VÉRITÉ PRIORITAIRE pour les vêtements / accessoires.`)
    lines.push(`# Mistral : matche chaque ligne "Male:/Female:/Male 2:..." aux ids context par`)
    lines.push(`# couleur de jersey / éléments distinctifs / position. Recopie ces descriptions`)
    lines.push(`# telles quelles dans characters_appearance, juste en remappant le label si besoin.`)
    lines.push(req.charactersDescription)
  }
  lines.push('')
  lines.push(`# Description de l'auteur`)
  lines.push(req.userPrompt.trim())
  lines.push('')
  lines.push(`Génère le JSON. Le 1er shot a shotIndex=${ctx.activeShotIndex}.`)
  lines.push(`Si — et SEULEMENT si — la phrase de l'auteur contient une césure chronologique nette (puis/ensuite/après/then/. ; entre 2 actions distinctes), génère un 2nd shot avec shotIndex=${ctx.activeShotIndex + 1}. Sinon, 1 seul shot.`)
  return lines.join('\n')
}

// ── POST handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<ExtractRequest>

    if (!body.userPrompt || typeof body.userPrompt !== 'string') {
      return NextResponse.json({ error: 'userPrompt requis (string)' }, { status: 400 })
    }
    if (!body.pelliculeContext) {
      return NextResponse.json({ error: 'pelliculeContext requis' }, { status: 400 })
    }
    const ctx = body.pelliculeContext
    if (typeof ctx.activeShotIndex !== 'number') {
      return NextResponse.json({ error: 'pelliculeContext.activeShotIndex requis (number)' }, { status: 400 })
    }
    if (!Array.isArray(ctx.charactersInPellicule) || !Array.isArray(ctx.bookCharacters)) {
      return NextResponse.json({ error: 'characters arrays requis' }, { status: 400 })
    }

    // Dump debug : ce que Mistral reçoit comme `description` par char. Permet
    // à l'auteur de trancher (anti-invention vs fiche NPC trop générique) en
    // regardant les logs server. Ajout 2026-05-11.
    console.log('[ai/extract-shot-prompt] Chars context — descriptions reçues :')
    for (const c of [...ctx.charactersInPellicule, ...ctx.bookCharacters]) {
      const desc = c.description ? `"${c.description.slice(0, 120)}"` : '(VIDE)'
      console.log(`  - ${c.name} [${c.id}] gender=${c.gender} pos=${c.position ?? '∅'} desc=${desc}`)
    }
    // Dump Qwen Characters reçu (le bloc "Vue persos visibles" envoyé à Mistral
    // comme source de vérité). Si VIDE → fallback Mistral defaults qui invente
    // (cas du bug "black shorts"). Ajout 2026-05-11.
    const charsDesc = (body as ExtractRequest).charactersDescription
    if (charsDesc?.trim()) {
      console.log('[ai/extract-shot-prompt] Qwen Characters reçu :\n' + charsDesc)
    } else {
      console.log('[ai/extract-shot-prompt] Qwen Characters : ∅ (non fourni — Mistral va inventer si fiches NPC vides)')
    }
    const sceneDesc = (body as ExtractRequest).imageDescription
    if (sceneDesc?.trim()) {
      console.log('[ai/extract-shot-prompt] Qwen Scene reçu :\n' + sceneDesc)
    }

    const userPrompt = buildUserPrompt(body as ExtractRequest)

    let mistralResult: MistralCallResult
    try {
      mistralResult = await callMistralSmallJson(SYSTEM_PROMPT, userPrompt)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Appel Mistral: ${msg}` }, { status: 502 })
    }
    const raw = mistralResult.content

    // Trace utile pour debug : taille de la réponse + finish_reason. Permet
    // de voir si on hit le plafond max_tokens (= finish_reason 'length') vs
    // un vrai souci de format (= 'stop' mais JSON malformé).
    console.log(`[ai/extract-shot-prompt] Mistral raw length=${raw.length} finish=${mistralResult.finishReason}`)

    let parsed: ExtractResponse
    try {
      parsed = JSON.parse(raw) as ExtractResponse
    } catch (err) {
      // Loggue le raw COMPLET pour qu'on puisse diagnostiquer côté serveur.
      console.error('[ai/extract-shot-prompt] JSON parse failed. Raw:\n', raw)
      const lengthHit = mistralResult.finishReason === 'length'
      const userMessage = lengthHit
        ? 'Mistral a touché la limite de tokens — ton prompt génère trop de contenu (essaie plus court ou moins de persos en jeu).'
        : `Mistral a renvoyé du JSON invalide (${err instanceof Error ? err.message : String(err)}). Tu peux re-tenter — Mistral Small produit parfois du JSON cassé sur prompts complexes.`
      return NextResponse.json({ error: userMessage, raw }, { status: 502 })
    }

    // Validation minimale du shape — fail loud si Mistral dévie du schéma.
    if (parsed.intent !== 'configure_pellicule') {
      return NextResponse.json({ error: `intent inattendu: ${parsed.intent}`, raw: parsed }, { status: 502 })
    }
    if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
      return NextResponse.json({ error: 'Mistral a renvoyé shots vide', raw: parsed }, { status: 502 })
    }
    // Cap dur à 2 shots — défense en profondeur si Mistral génère 3+ malgré la
    // règle. Le 3e+ part en warning multi_shot_truncated. Refonte 2026-05-11.
    if (parsed.shots.length > 2) {
      console.warn('[ai/extract-shot-prompt] Mistral a généré', parsed.shots.length, 'shots, on garde les 2 premiers')
      const truncated = parsed.shots.length - 2
      parsed.shots = parsed.shots.slice(0, 2)
      parsed.warnings = parsed.warnings ?? []
      parsed.warnings.push({
        type: 'multi_shot_truncated',
        message: `${truncated} shot(s) supplémentaire(s) généré(s) par l'IA — gardés les 2 premiers seulement.`,
      })
    }
    if (!parsed.scene) parsed.scene = { scene_visible: null, characters_appearance: null, confidence: 'low' }
    if (!Array.isArray(parsed.warnings)) parsed.warnings = []

    // Sanitize characters_appearance : si Mistral renvoie un OBJET au lieu d'une
    // string (ex : `{"Male": "...", "Female": "..."}`), on le convertit en
    // string format Vantage `Male: ...\nFemale: ...`. Bug observé 2026-05-11
    // (output "[object Object]" dans le champ Apparence persos du preview).
    // Refonte 2026-05-11.
    if (parsed.scene?.characters_appearance != null && typeof parsed.scene.characters_appearance !== 'string') {
      const raw = parsed.scene.characters_appearance as unknown
      if (typeof raw === 'object' && raw !== null) {
        const lines: string[] = []
        for (const [label, value] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof value === 'string' && value.trim()) {
            lines.push(`${label}: ${value}`)
          }
        }
        if (lines.length > 0) {
          console.warn('[ai/extract-shot-prompt] Mistral a renvoyé characters_appearance comme OBJET, converti en string Vantage')
          parsed.scene.characters_appearance = lines.join('\n')
        } else {
          console.warn('[ai/extract-shot-prompt] characters_appearance = objet vide, set à null')
          parsed.scene.characters_appearance = null
        }
      } else {
        console.warn('[ai/extract-shot-prompt] characters_appearance type inattendu:', typeof raw, '— set à null')
        parsed.scene.characters_appearance = null
      }
    }
    // Pareil défensif pour scene_visible (string ou null attendus).
    if (parsed.scene?.scene_visible != null && typeof parsed.scene.scene_visible !== 'string') {
      console.warn('[ai/extract-shot-prompt] scene_visible type inattendu:', typeof parsed.scene.scene_visible, '— set à null')
      parsed.scene.scene_visible = null
    }

    // Sanitize : ne garde que les charIds qui existent réellement dans le contexte
    // (défense en profondeur — Mistral PEUT halluciner un id même avec instruction).
    const validIds = new Set([
      ...ctx.charactersInPellicule.map(c => c.id),
      ...ctx.bookCharacters.map(c => c.id),
    ])
    for (const shot of parsed.shots) {
      if (shot.perCharacter) {
        for (const id of Object.keys(shot.perCharacter)) {
          if (!validIds.has(id)) {
            console.warn('[ai/extract-shot-prompt] Mistral a halluciné un charId, suppression:', id)
            delete shot.perCharacter[id]
          }
        }
      }
      if (shot.speakerId && !validIds.has(shot.speakerId)) {
        console.warn('[ai/extract-shot-prompt] speakerId hallucinated, set null:', shot.speakerId)
        shot.speakerId = null
      }
    }

    // Sanitize characters_appearance : si AUCUN char du context n'a de position
    // fournie ET QUE QWEN CHARACTERS N'EST PAS DISPO ET que Mistral a quand
    // même produit "standing on the X side", on strip ces mentions hallucinées
    // pour ne pas polluer le bloc Vantage (bug observé 2026-05-11). Si Qwen
    // Characters est dispo, ses mentions de position sont sourcées (visuelles
    // réelles) → on les garde. Refonte 2026-05-11.
    const anyPositionProvided = [
      ...ctx.charactersInPellicule,
      ...ctx.bookCharacters,
    ].some(c => c.position === 'left' || c.position === 'center' || c.position === 'right')
    const hasQwenChars = !!(body as ExtractRequest).charactersDescription?.trim()
    if (!anyPositionProvided && !hasQwenChars && parsed.scene?.characters_appearance) {
      const before = parsed.scene.characters_appearance
      // Regex tolérante : ", standing on the right/left/center side" + variantes
      const stripped = before.replace(/\s*,?\s*standing on the (?:right|left|center) side/gi, '').replace(/\s+#/g, '  #')
      if (stripped !== before) {
        // Log only — pas de warning UI : c'est un nettoyage interne, pas une
        // info utile à l'auteur (le sanitize est silencieux par design).
        console.warn('[ai/extract-shot-prompt] Position hallucinée détectée — strip. Avant:', before, '| Après:', stripped)
        parsed.scene.characters_appearance = stripped
      }
    }

    console.log('[ai/extract-shot-prompt] OK — shots:', parsed.shots.length,
                'warnings:', parsed.warnings.length)
    return NextResponse.json(parsed)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai/extract-shot-prompt] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
