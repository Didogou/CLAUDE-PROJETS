import { NextRequest, NextResponse } from 'next/server'
import https from 'https'

/**
 * POST /api/ai/edit-plan-intent
 *
 * Classifie une demande d'édition d'image (Ctrl+K Studio Designer) en 1 des
 * 4 actions canoniques + prépare le prompt final pour Qwen Image Edit.
 *
 * Actions : modify_scene · modify_character · remove_element · add_object
 *
 * Cas usage : l'auteur tape "Enlève les lunettes de Duke" → l'IA classe
 * en remove_element, identifie Duke comme cible, et reformule en un prompt
 * clean ("Remove the glasses from the character named Duke") qui sera
 * envoyé à Qwen Edit après confirmation côté UI.
 *
 * Modèle : mistral-small-latest (free, JSON mode).
 *
 * Refonte 2026-05-12.
 */

export const maxDuration = 30
export const runtime = 'nodejs'

// ── Types I/O ─────────────────────────────────────────────────────────────

interface IntentContextChar {
  id: string
  name: string
  /** Description physique pour aider à désambiguïser. */
  description?: string
}

interface IntentRequest {
  /** Phrase brute de l'auteur (FR). */
  userPrompt: string
  /** Persos présents dans la scène courante (pour matcher target_character_id). */
  charactersInScene: IntentContextChar[]
  /** Description optionnelle du plan (résumé narratif) — aide à la
   *  désambiguïsation contextuelle. */
  planSummary?: string
}

type IntentActionType = 'modify_scene' | 'modify_character' | 'remove_element' | 'add_object'

interface IntentResponse {
  action_type: IntentActionType
  /** Id du perso ciblé (depuis charactersInScene). null si action ne cible
   *  pas un perso précis (ex: changer le ciel). */
  target_character_id: string | null
  /** Si add_object : true = objet narratif (épée, clé, potion…) → branche
   *  ItemAttachmentPickerModal. false = accessoire purement décoratif (chapeau,
   *  fleur…) → exécute direct. Toujours null pour les autres action_type. */
  is_narrative_object: boolean | null
  /** Nom de l'objet (si add_object) ou de l'élément (si remove_element). */
  object_name: string | null
  /** Prompt final qui sera envoyé à Qwen Image Edit. Reformulé clean depuis
   *  userPrompt, avec mention explicite de la cible. */
  edit_prompt: string
  /** Phrase FR humaine à afficher dans le panneau confirmation. Ex: "Je vais
   *  enlever les lunettes du personnage Duke." */
  explanation_fr: string
  /** high / medium / low — affichée dans l'UI confirmation pour signaler les
   *  cas où l'IA n'est pas sûre (ex: nom de perso pas matché). */
  confidence: 'high' | 'medium' | 'low'
  /** Warnings non-bloquants (ex: nom mentionné mais pas trouvé). */
  warnings: Array<{ type: 'unknown_character' | 'ambiguous'; message: string }>
}

// ── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un assistant qui analyse une demande d'édition d'image en langage naturel et la classifie en 1 des 4 actions canoniques. Ton output JSON est consommé par un panneau de confirmation : l'auteur valide, puis le moteur (Qwen Image Edit) applique l'édition.

# ACTIONS POSSIBLES

1. **modify_scene** — change le décor / l'éclairage / l'ambiance / la météo / le ciel / la couleur du fond.
   Exemples : "rends la scène nocturne", "ajoute de la pluie", "change le ciel pour un coucher de soleil".

2. **modify_character** — change un attribut visuel d'un personnage existant (vêtements, couleur de cheveux, accessoire porté, posture).
   Exemples : "Duke porte une veste rouge", "donne des cheveux courts à Marvyn", "change la couleur du jersey de Roman en bleu".

3. **remove_element** — enlève un élément (perso, objet, accessoire) de la scène.
   Exemples : "enlève les lunettes de Duke", "supprime le panier de basket", "retire la voiture en arrière-plan".

4. **add_object** — ajoute un NOUVEL objet à la scène.
   Exemples : "ajoute un ballon dans les mains de Marvyn", "place une épée près du rocher", "mets une lampe sur la table".

# RÈGLE D'AMBIGUÏTÉ MODIFY vs REMOVE
- "Enlève les lunettes de Duke" → remove_element (l'accessoire DISPARAÎT)
- "Change les lunettes de Duke pour des solaires" → modify_character (remplacement, le perso porte toujours quelque chose)
- "Donne-lui des lunettes" → add_object (l'accessoire APPARAÎT là où il n'y en avait pas)

# CIBLE PERSO (target_character_id)
- Si l'action mentionne un perso (par nom) PRÉSENT dans \`charactersInScene\` → target_character_id = son id.
- Si l'action mentionne un nom INTROUVABLE → target_character_id = null + warning {type: "unknown_character", message: "<Nom> non trouvé dans la scène"}.
- Si l'action ne cible PAS un perso (ex: "ajoute un nuage") → target_character_id = null sans warning.
- Si l'action mentionne "le personnage" / "il" / "elle" sans nom ET qu'il n'y a QU'UN SEUL perso dans la scène → utilise son id avec confidence: 'high'.
- Si pronom ambigu (plusieurs persos) → target_character_id = null + warning {type: "ambiguous", message: "Plusieurs persos dans la scène, précise lequel"}.

# is_narrative_object (uniquement si action_type = "add_object")
- **narratif (true)** : objet qui POURRAIT être interactif / pris / utilisé en jeu : arme (épée, pistolet, dague), clé, potion, livre, parchemin, talisman, outil, trésor, bijou de quête, document.
- **décoratif (false)** : accessoire purement visuel non interactif : chapeau, lunettes, écharpe, fleur, nuage, plante d'ambiance, vêtement, accessoire de costume, élément décoratif du décor.
- **En cas d'ambiguïté → true (narratif par défaut)**. Mieux vaut que l'auteur clique "pas d'item" qu'oublier d'attacher un item important.
- Pour modify_scene / modify_character / remove_element → \`is_narrative_object: null\`.

# object_name
- Pour add_object : nom court de l'objet ajouté. Ex: "ballon", "épée", "lampe à pétrole". Pour la modal item.
- Pour remove_element : nom court de l'élément retiré. Ex: "lunettes", "panier de basket".
- Pour modify_scene / modify_character : null.

# edit_prompt (prompt final pour Qwen Image Edit)
Reformule la demande de l'auteur en UN prompt CLEAN, DIRECT, sans ambiguïté pour Qwen Image Edit. Garde le français (Qwen comprend FR + EN). Mentionne explicitement la cible (nom du perso si target_character_id non null, ou description physique courte pour aider Qwen à localiser).
- ❌ "Enleve les lunettes de Duke" → trop court, ambigu
- ✅ "Supprime les lunettes portées par le personnage nommé Duke. Le visage en dessous reste naturel, sans déformation."
- ❌ "ajoute un ballon" → où ?
- ✅ "Ajoute un ballon de basketball orange dans la main droite du personnage nommé Marvyn."

Ne mets PAS d'instructions techniques (resolution, seed, steps) — c'est géré par le wrapper.

# explanation_fr (pour le panneau confirmation)
Une phrase courte FR qui résume ce que l'IA a compris, en commençant par "Je vais…". L'auteur la lit avant de cliquer Valider.
Ex: "Je vais enlever les lunettes du personnage Duke."
Ex: "Je vais ajouter un ballon de basketball orange dans la main droite de Marvyn."

# confidence
- "high" : action claire + cible identifiée sans ambiguïté.
- "medium" : action claire mais cible déduite par contexte (pronom, "le personnage en bleu"…).
- "low" : action ambiguë ou cible introuvable.

# OUTPUT
JSON STRICT, aucune prose, aucun fence markdown. Schema :
{
  "action_type": "modify_scene" | "modify_character" | "remove_element" | "add_object",
  "target_character_id": "<id ou null>",
  "is_narrative_object": <true | false | null>,
  "object_name": "<string ou null>",
  "edit_prompt": "<FR clean pour Qwen Edit>",
  "explanation_fr": "<phrase FR commençant par 'Je vais…'>",
  "confidence": "high" | "medium" | "low",
  "warnings": [{ "type": "unknown_character" | "ambiguous", "message": "<FR>" }]
}`

// ── Mistral call (small, JSON mode) ────────────────────────────────────────

interface MistralCallResult {
  content: string
  finishReason?: string
}

function callMistralSmallJson(systemPrompt: string, userPrompt: string): Promise<MistralCallResult> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('MISTRAL_API_KEY manquante dans .env.local')

  const body = JSON.stringify({
    model: 'mistral-small-latest',
    max_tokens: 1024,
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
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
              choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
              message?: string
              error?: { message?: string }
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
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout Mistral (28s)')) })
    req.write(body)
    req.end()
  })
}

// ── Sanitization du JSON renvoyé par le LLM ───────────────────────────────

const VALID_ACTIONS: ReadonlySet<IntentActionType> = new Set([
  'modify_scene', 'modify_character', 'remove_element', 'add_object',
])

function sanitizeIntent(raw: unknown, charsInScene: IntentContextChar[]): IntentResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Output Mistral non-objet')
  }
  const r = raw as Record<string, unknown>

  const action_type = String(r.action_type ?? '') as IntentActionType
  if (!VALID_ACTIONS.has(action_type)) {
    throw new Error(`action_type invalide: ${action_type}`)
  }

  // target_character_id : null OU id valide depuis charsInScene
  let target_character_id: string | null = null
  if (typeof r.target_character_id === 'string' && r.target_character_id) {
    const found = charsInScene.find(c => c.id === r.target_character_id)
    target_character_id = found ? found.id : null
  }

  // is_narrative_object : true / false / null
  let is_narrative_object: boolean | null = null
  if (action_type === 'add_object') {
    is_narrative_object = r.is_narrative_object === false ? false : true  // défaut narratif si pas de réponse claire
  }

  const object_name = typeof r.object_name === 'string' && r.object_name ? r.object_name : null
  const edit_prompt = typeof r.edit_prompt === 'string' ? r.edit_prompt : ''
  const explanation_fr = typeof r.explanation_fr === 'string' ? r.explanation_fr : ''
  const confidence = (['high', 'medium', 'low'] as const).includes(r.confidence as 'high' | 'medium' | 'low')
    ? (r.confidence as 'high' | 'medium' | 'low')
    : 'medium'

  const warnings: IntentResponse['warnings'] = []
  if (Array.isArray(r.warnings)) {
    for (const w of r.warnings) {
      if (w && typeof w === 'object') {
        const ww = w as Record<string, unknown>
        const type = ww.type === 'ambiguous' || ww.type === 'unknown_character' ? ww.type : null
        const message = typeof ww.message === 'string' ? ww.message : ''
        if (type && message) warnings.push({ type, message })
      }
    }
  }

  if (!edit_prompt || !explanation_fr) {
    throw new Error('edit_prompt ou explanation_fr manquant dans output Mistral')
  }

  return {
    action_type, target_character_id, is_narrative_object, object_name,
    edit_prompt, explanation_fr, confidence, warnings,
  }
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: IntentRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON body invalide' }, { status: 400 })
  }

  if (!body.userPrompt || typeof body.userPrompt !== 'string') {
    return NextResponse.json({ error: 'userPrompt manquant' }, { status: 400 })
  }
  const charsInScene = Array.isArray(body.charactersInScene) ? body.charactersInScene : []

  // Compose le user message pour Mistral
  const userBlock = JSON.stringify({
    userPrompt: body.userPrompt.trim(),
    planSummary: body.planSummary ?? null,
    charactersInScene: charsInScene.map(c => ({
      id: c.id, name: c.name, description: c.description ?? null,
    })),
  }, null, 2)

  try {
    const { content, finishReason } = await callMistralSmallJson(SYSTEM_PROMPT, userBlock)
    if (finishReason === 'length') {
      console.warn('[edit-plan-intent] Mistral hit max_tokens — output peut être tronqué')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      console.error('[edit-plan-intent] JSON parse fail. Raw:', content.slice(0, 500))
      return NextResponse.json({ error: 'IA: JSON invalide' }, { status: 502 })
    }
    const intent = sanitizeIntent(parsed, charsInScene)
    return NextResponse.json(intent)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[edit-plan-intent] erreur:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
