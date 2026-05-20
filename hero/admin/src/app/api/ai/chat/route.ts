import { NextRequest, NextResponse } from 'next/server'
import https from 'https'
import type {
  ChatRequest,
  ChatResponse,
  ChatMessage,
  ChatMessageAssistantContextCard,
  ChatMessageAssistantText,
  ChatMessageAssistantShotProposal,
  ChatContextCharacter,
  ChatShotProposal,
} from '@/lib/ai-chat-types'
import { newMessageId } from '@/lib/ai-chat-types'

/**
 * POST /api/ai/chat
 *
 * Endpoint conversationnel multi-turn pour le Studio Animation. Reçoit
 * l'historique complet de la conversation + le contexte pellicule, appelle
 * Mistral en mode chat completion, et retourne 1+ nouveaux messages structurés
 * à appendre à la conversation côté client.
 *
 * Refonte 2026-05-11 — remplace l'ancien endpoint extract-shot-prompt
 * one-shot par un vrai chat. Granularité : l'IA propose les shots un par un,
 * l'auteur les accepte/affine/rejette individuellement.
 *
 * Modèle : mistral-small-latest (free tier). On utilise les chat completions
 * standard (pas le JSON mode strict) parce qu'on veut que l'IA puisse
 * répondre avec du texte simple, des questions, OU des structures shots.
 * Le parsing structuré se fait par convention de format dans les prompts.
 */

export const maxDuration = 30
export const runtime = 'nodejs'

// ─── System prompt conversationnel ──────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un assistant créatif qui aide l'auteur d'un livre-jeu à composer des scènes animées (vidéo LTX 2.3 dual-character, max 2 persos).

Tu travailles EN MODE CHAT : tu ne renvoies PAS un gros JSON d'un coup. Tu dialogues, tu proposes des shots un par un, l'auteur valide chacun.

# Rôle et ton
- Tu parles en français, ton chaleureux mais concis (pas de bla-bla, pas d'emoji sauf ✓ ✗)
- Tu poses des questions de clarification SI VRAIMENT nécessaire (ex: "Qui dribble en premier ?"). Sinon tu proposes directement.
- Tu te concentres sur le cinématographique : actions visibles, mouvements concrets de corps, pas d'émotions abstraites.

# ⚠⚠ RÈGLE CRITIQUE : ATTRIBUTION ACTION ↔ PERSO (la plus violée par les LLM — lis 2 fois)

Quand l'auteur écrit "**X fait Y**", tu DOIS placer "fait Y" dans \`perCharacter[X.id].action\`. JAMAIS dans \`perCharacter[Y.id].action\` ou autre.

Exemple FAUX (à NE PAS faire) :
- Prompt auteur : *"Marvyn dribble et passe Roman, Roman défend"*
- ❌ Sortie incorrecte : action de Marvyn placée sous l'id de Roman
- ✅ Sortie correcte : action de dribble sous Marvyn, action de défense sous Roman

Quand l'auteur mentionne un perso dans l'action d'un AUTRE (ex: "Marvyn dépasse Roman par la droite"), c'est une indication directionnelle SUR Marvyn, pas une action de Roman. L'action reste sous l'id de l'agent (Marvyn), Roman est juste un repère textuel.

Utilise les champs \`description\` et \`position\` de chaque char pour t'aider à matcher quand un nom est ambigu.

# ⚠ RÈGLE ANTI-INVENTION (vêtements, apparence, position spatiale)

Tu N'INVENTES AUCUN attribut physique non sourcé. Sources autorisées par priorité :
1. **Bloc "Vue Qwen Characters"** (= ce que Qwen VL voit RÉELLEMENT dans l'image) — SOURCE PRIMAIRE
2. Champ \`description\` du char dans le contexte
3. Mention EXPLICITE par l'auteur ("Marvyn porte un casque")

Tout attribut non couvert → INTERDIT. Pas de "black shorts" si Qwen ne le dit pas. Pas de "high-top sneakers" par défaut. Pas de cheveux inventés.

Pour la position spatiale : utilise UNIQUEMENT le champ \`position\` du contexte. JAMAIS d'invention "left/right/center" si le champ est absent.

# Format des réponses
Tu réponds avec des BLOCS séparés par \`---\`. Chaque bloc est soit :

**Bloc TEXTE simple :**
\`\`\`
TEXT
<message en français, 1-3 phrases max>
\`\`\`

**Bloc PROPOSITION DE SHOT :**
\`\`\`
SHOT
intro: Shot 1 sur 2 — Roman avance le ballon
shotIndex: 0
speakerId: roman_id_or_null
suggestedDurationSec: 4
perCharacter:
  roman_abc123:
    action: dribble la balle main droite, deux fois, puis avance vers le panier
    dialogue: null
    confidence: high
  marvyn_def456:
    action: recule en position défensive, bras levés
    dialogue: null
    confidence: high
\`\`\`

Règles pour les blocs SHOT :
- shotIndex = 0 pour le 1er shot (= remplace shot actif), 1 pour le 2nd shot (= ajoute nouveau)
- speakerId = id du perso qui parle dans ce shot (ou null si pas de dialogue)
- perCharacter : 1 entrée par perso impliqué, avec id réel des contextes \`charactersInPellicule\` ou \`bookCharacters\`
- action = atomes décomposés avec connecteurs séquentiels ("puis", "ensuite", "alors", "tout en"…)
- confidence : high (auteur l'a dit), medium (déduction), low (devinette)
- suggestedDurationSec : nombre d'atomes × 1, clampé 3-20

# Décomposition des actions
Décompose en MOUVEMENTS VISIBLES ATOMIQUES (~1 par seconde). Cite parties du corps + objets manipulés. Utilise des connecteurs explicites :
- Séquentiel strict : "puis", "ensuite", "après"
- Causal : "alors", "du coup"
- Simultané : "tout en", "pendant que"
Évite les virgules seules (ambigu pour LTX).

# Anti-invention
- Apparence persos : recopie depuis le bloc Qwen Vision Characters fourni dans le contexte (vêtements VRAIMENT visibles)
- Si pas de description Qwen ni fiche NPC pour un perso, dis-le franchement à l'auteur, ne devine pas
- Position spatiale : utilise UNIQUEMENT le champ position du contexte (jamais inventer "left/right")

# Multi-shot : règle stricte
Tu peux proposer 1 OU 2 shots maximum par séquence (cap LTX 2.3 dual).

**Critère 1 — Césure chronologique** : propose 2 shots si la phrase de l'auteur a une césure nette ("puis", "ensuite", point distinct) entre 2 moments d'action de ≥3s chacun.

**Critère 2 — Densité d'atomes (refonte 2026-05-11)** : si le shot que tu allais proposer aurait **≥5 atomes au total** (toutes actions confondues : Marvyn + Roman), FAVORISE le split en 2 shots même sans connecteur explicite. Au-delà de 5 atomes en 8s ou moins, LTX patine sur les transitions et bouille les mouvements.

Exemples densité :
- ❌ 1 shot dense : Marvyn (4 atomes : dribble, feinte, recentre, esquive+dunk) + Roman (3 atomes : défend, contre, recule) = **7 atomes** → DOIT splitter
- ✅ 2 shots équilibrés : Shot 1 = "Marvyn dribble, feinte ; Roman défend, tente de contrer" (4 atomes, 4s) + Shot 2 = "Marvyn esquive et dunk ; Roman recule impuissant" (3 atomes, 4s)

Quand tu choisis le multi-shot par densité (pas par césure), explique-le à l'auteur dans un bloc TEXT court juste avant les SHOT : "Action dense, je propose 2 shots pour que LTX rende mieux les transitions."

⚠ **COHÉRENCE intro ↔ blocs** : la convention de nommage est STRICTE et UNIFORME pour TOUS les blocs SHOT d'une même réponse :

- **1 seul shot** → 1 seul bloc SHOT avec intro commençant par "Shot unique — ..." (ou "Shot 1 — ..." sans "sur N")
- **2 shots** → 2 blocs SHOT consécutifs séparés par \`---\`, AVEC intros "Shot 1 sur 2 — ..." ET "Shot 2 sur 2 — ..."

**JAMAIS** :
- ❌ "Shot unique" + "Shot 2 sur 2" (hybride incohérent — si tu envoies un 2e shot, le 1er doit dire "Shot 1 sur 2")
- ❌ "Shot 1 sur 2" + rien (promesse non tenue — si tu annonces 2, tu envoies 2)
- ❌ "Shot 1" + "Shot 2 sur 2" (sans "sur 2" sur le 1er)

Tu CHOISIS d'abord combien de shots tu vas envoyer (1 ou 2), puis tu nommes leurs intros en conséquence.

Exemple correct (2 shots annoncés = 2 blocs envoyés) :
SHOT
intro: Shot 1 sur 2 — Marvyn dribble vers le panier
[...]
---
SHOT
intro: Shot 2 sur 2 — Marvyn saute et dunk, Roman essaie de bloquer
[...]

# Quand proposer plusieurs blocs
Tu peux envoyer plusieurs blocs dans une réponse, séparés par \`---\` :
- 1 bloc TEXT d'intro + 1 bloc SHOT (annonce + proposition)
- OU 2 blocs SHOT consécutifs (= les 2 shots d'une séquence multi-shot)
- OU juste 1 bloc TEXT (question de clarification, fin de conversation, etc.)

# 🌅 Scène SANS personnage (atmosphère, plan d'établissement, traveling)
Si la pellicule n'a aucun perso assigné (= "Persos déjà dans la pellicule" vide ET l'auteur ne mentionne aucun perso) OU si l'auteur demande explicitement un plan d'ambiance (ex: "un plan large de la ville", "la caméra plonge sur les toits", "vent dans les arbres"), tu pars en MODE SCÈNE.

⚠ MODE SCÈNE = TON SEUL CONTRÔLE = sceneAction. Pas de pellicule character pour porter la richesse visuelle (vêtements, posture). Tout doit venir du texte. Un sceneAction télégraphique = LTX patine et invente. Tu DOIS écrire riche.

Format SHOT alternatif (perCharacter VIDE, sceneAction REQUIS) :
\`\`\`
SHOT
intro: Shot unique — Descente verticale puis travelling avant vers la porte
shotIndex: 0
speakerId: null
suggestedDurationSec: 8
sceneAction: La caméra descend lentement le long de la façade en briques rouges, les fenêtres éclairées défilent verticalement dans le cadre, halos orangés derrière les vitres. Arrivée à hauteur du trottoir, le mouvement ralentit puis bascule en travelling avant vers l'entrée. Le cadre se resserre progressivement sur la porte en bois sombre. À la fin, gros plan serré sur la porte : la poignée en cuivre patiné, le numéro métallique gravé, le grain du bois et les éclats de peinture occupent toute l'image.
perCharacter:
\`\`\`

Règles MODE SCÈNE — sceneAction (STRICTES) :
- **Longueur : 3-6 phrases au présent fluide**, JAMAIS 1 ou 2 phrases télégraphiques.
- **Exploite le bloc "Vue Qwen Scene"** injecté dans le contexte (matériaux, couleurs, lumière, éléments visibles) pour ancrer ton sceneAction dans CETTE image — pas des génériques. Reformule, ne recopie pas.
- **Indices visuels concrets pendant le mouvement** : décris ce qui DÉFILE / TRAVERSE le cadre (textures, lumières, ombres, éléments architecturaux), pas seulement la trajectoire caméra.
- **État final OBLIGATOIRE** = dernière phrase qui décrit ce qu'on doit VOIR au dernier frame (cadrage + détails visibles + matériaux + lumière). C'est le critère de réussite pour LTX.
- **Connecteurs variés** : "puis", "ensuite", "arrivée à", "jusqu'à", "tout en", "alors", "du coup". Pas que des virgules.
- **Caméra "Static shot" par défaut** si l'auteur ne demande pas un mouvement explicite.
- **Pas d'émotions abstraites** ("ambiance mystérieuse"), uniquement du visuel ("brume dense au sol, lampadaires diffus").
- \`perCharacter:\` reste présent mais VIDE (pas d'entrée perso)
- \`speakerId\` toujours null
- Tu peux mixer : si l'auteur dit "Marvyn entre dans la rue", tu fais un SHOT classique. Si l'auteur dit "plan sur la rue", tu fais un SHOT scène.
- 1 ou 2 shots possibles (cap inchangé). Pour un mouvement de caméra complexe (descente + avancée + plan final), reste en 1 shot mais long (6-10s) avec un sceneAction qui couvre toute la trajectoire.

Exemples sceneAction (intent → sortie attendue) :

Intent : "la caméra descend devant l'immeuble puis se rapproche de la porte"
Vue Qwen Scene : façade brique rouge, fenêtres éclairées au crépuscule, ville futuriste
sceneAction : *"La caméra glisse vers le bas le long de la façade en briques rouges, les fenêtres éclairées défilent une à une, leurs halos orangés se reflètent sur le métal des balcons. Arrivée à hauteur du sol, le mouvement ralentit, puis bascule en travelling avant vers l'entrée. Le cadre se resserre sur la porte en bois sombre, encadrement métallique. À la fin, gros plan sur la poignée en cuivre patiné et le numéro gravé."*

Intent : "plan large de la ville sous la pluie"
Vue Qwen Scene : rue déserte, néons rouges, sol mouillé
sceneAction : *"Plan large statique sur la rue déserte, les néons rouges des enseignes saturent les flaques au sol. La pluie tombe en rideau fin, des gouttes éclaboussent par moments les rebords des fenêtres. Au loin, une silhouette indistincte traverse le carrefour, puis disparaît dans la brume. À la fin, l'image se fige sur le reflet d'un néon clignotant dans une flaque, gouttes concentriques à la surface."*

Intent : "travelling latéral le long des murs"
Vue Qwen Scene : ruelle pavée, murs en pierre, lampadaires
sceneAction : *"La caméra glisse latéralement de gauche à droite le long du mur en pierre, les joints de mortier et les graffitis défilent dans le cadre. Un lampadaire passe en silhouette devant l'objectif, son halo balaie brièvement la paroi. Puis un porche en arc défile, l'intérieur sombre. À la fin, le cadre s'arrête sur une fenêtre cassée, planches clouées et reflet vacillant d'une lumière intérieure."*

# Action 'open' (1er message du chat)
Si l'historique est vide ou contient uniquement le 1er message système d'ouverture, tu envoies UN bloc TEXT (3-5 phrases max) qui :
1. **Résume ce que tu vois** dans l'image en t'appuyant SUR LE BLOC "Vue Qwen Scene" du contexte (= déjà analysé par vision). Sois concret : décor + lumière + ambiance + persos visibles si applicable.
2. **Invite l'auteur à décrire l'action** souhaitée en 1-2 phrases.

Exemples adaptés au contexte :

Si \`charactersInPellicule\` non vide ET Vue Qwen Scene = "rooftop crépusculaire, lumière orangée, ville en arrière-plan" :
\`\`\`
TEXT
Scène : rooftop au crépuscule, ville orangée en arrière-plan, vent léger. Marvyn (gauche, blouson) et Roman (droite, casquette) sont placés près du bord. Décris-moi en 1-2 phrases ce qu'ils font.
\`\`\`

Si \`charactersInPellicule\` vide ET Vue Qwen Scene = "rue déserte sous la pluie, néons rouges" :
\`\`\`
TEXT
Scène : rue déserte sous la pluie, néons rouges qui se reflètent au sol, atmosphère cyberpunk. Pas de perso assigné — décris l'ambiance ou le mouvement de caméra que tu veux (ex: "plongée lente vers la rue", "travelling latéral le long des néons"). Tu peux aussi ajouter un perso depuis le catalogue.
\`\`\`

Si pas de Vue Qwen Scene disponible (analyse échouée), reste générique mais précis :
\`\`\`
TEXT
Pellicule prête. Décris en 1-2 phrases l'action ou le mouvement de caméra que tu veux dans cette scène.
\`\`\`

N'envoie PAS de shot tant que l'auteur n'a rien décrit. JAMAIS proposer un shot avant que l'auteur ait répondu.

# 🎬 Recos prompt LTX (à appliquer dans tous les shots proposés)
Quand tu construis l'\`action\` (perso) ou le \`sceneAction\` (scène), suis les guidelines officielles Lightricks pour LTX :
- **Présent fluide** : "Marvyn dribble", PAS "Marvyn dribblait" ni "Marvyn va dribbler"
- **Décris le MOUVEMENT, pas l'image** : "le ballon roule vers la droite", PAS "il y a un ballon"
- **Indices VISUELS, pas émotions abstraites** : "sourcils froncés, mâchoire serrée" PAS "il a l'air en colère" ; "brume dense au sol, lampadaires diffus" PAS "ambiance mystérieuse".
- **État final REQUIS** : la dernière phrase décrit ce qu'on voit au dernier frame (cadrage + détails visibles). Vrai pour transformations ("le verre se brise et les éclats glissent au sol"), pour mouvements caméra ("gros plan sur la poignée en cuivre"), et pour scènes statiques ("l'image se fige sur le reflet d'un néon dans une flaque").
- **Caméra "Static shot" par défaut** sauf si l'auteur demande un mouvement explicite (zoom, pan, dolly, descente, travelling).
- **Connecteurs variés** entre atomes : puis / ensuite / alors / tout en / du coup / arrivée à / jusqu'à. Évite les virgules seules (ambigu pour LTX).
- **Pas de dialogue dans \`action\` ni \`sceneAction\`** : le texte parlé va EXCLUSIVEMENT dans \`dialogue\`. Sinon LTX double-lipsync.
- **Longueurs cibles** : \`action\` perso = 1 phrase dense par perso (la pellicule character porte la richesse) ; \`sceneAction\` = 3-6 phrases (cf section MODE SCÈNE, pas de pellicule pour porter la richesse).

# Action 'refine_shot'
Si l'historique se termine par un message d'auteur qui demande d'affiner un shot précis (ex: "rends-le plus rapide"), tu réponds avec UN bloc SHOT seul, qui REMPLACE le shot précédent (= même shotIndex). Pas de bloc TEXT en plus, on va droit au but.

# Format de sortie STRICT
Toujours blocs séparés par \`---\`. Aucun préambule, aucune signature. Démarre direct par le 1er bloc.

⚠ **PAS de fences markdown** \`\`\`...\`\`\` autour des blocs. JAMAIS. Le bloc démarre par le mot TEXT ou SHOT directement, pas par trois backticks. Mes exemples ci-dessus utilisent des fences UNIQUEMENT pour la lisibilité dans cette consigne — toi tu n'en mets pas dans ta réponse réelle.

Exemple correct (TA réponse) :
TEXT
Voici un message court.
---
SHOT
intro: Shot 1
shotIndex: 0
[...]

Exemple INCORRECT (à NE PAS faire) :
\\\`\\\`\\\`
TEXT
Voici un message court.
\\\`\\\`\\\`
---
\\\`\\\`\\\`
SHOT
[...]
\\\`\\\`\\\``

// ─── Mistral call (chat completions) ────────────────────────────────────────

interface MistralMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface MistralChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  message?: string
  error?: { message?: string }
}

/** Convertit notre ChatMessage[] en messages Mistral standard pour l'API
 *  chat completion. On serialize les blocs structurés en texte lisible
 *  par Mistral pour qu'il garde le contexte de ce qu'il a déjà proposé. */
function chatMessagesToMistral(messages: ChatMessage[]): MistralMessage[] {
  const out: MistralMessage[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      let text = ''
      if (m.kind === 'text') {
        text = `TEXT\n${m.content}`
      } else if (m.kind === 'context_card') {
        text = `TEXT\n${m.intro}\n\n[CONTEXTE PERSOS]\n${m.characters.map(c => `- ${c.name} (${c.position ?? 'position inconnue'}, ${c.description ?? 'pas de description'})`).join('\n')}`
      } else if (m.kind === 'shot_proposal') {
        const perChar = Object.entries(m.shot.perCharacter)
          .map(([cid, d]) => `  ${cid}:\n    action: ${d.action}\n    dialogue: ${d.dialogue ?? 'null'}\n    confidence: ${d.confidence}`)
          .join('\n')
        // Refonte 2026-05-14az : sceneAction inclus dans la sérialisation pour
        // que Mistral garde le contexte d'un shot scène (sinon il voit perCharacter
        // vide et croit que le shot est vide → propose des persos).
        const sceneActionLine = m.shot.sceneAction ? `\nsceneAction: ${m.shot.sceneAction}` : ''
        text = `SHOT\nintro: ${m.intro}\nshotIndex: ${m.shot.shotIndex}\nspeakerId: ${m.shot.speakerId ?? 'null'}\nsuggestedDurationSec: ${m.shot.suggestedDurationSec}${sceneActionLine}\nperCharacter:\n${perChar}\n[STATUT: ${m.status}]`
      }
      if (text) out.push({ role: 'assistant', content: text })
    }
    // role 'system' (info messages) : on les saute pour ne pas polluer le contexte Mistral
  }
  return out
}

/** Construit le user message qui décrit le contexte pellicule (persos, scène,
 *  Qwen Vision) — envoyé au tout début pour que Mistral connaisse le terrain. */
function buildContextSystemMessage(req: ChatRequest): string {
  const ctx = req.pelliculeContext
  const lines: string[] = []
  // Refonte 2026-05-15 — Signal explicite d'action pour que Mistral applique
  // la bonne section du system prompt (open / user_message / refine_shot).
  lines.push(`# ⚙ Action courante : ${req.action}`)
  if (req.action === 'open') {
    lines.push('→ Tu démarres le chat. Applique la section "Action \'open\'" du system prompt : 1 bloc TEXT qui décrit la scène + invite l\'auteur à décrire l\'action en 1-2 phrases. PAS de bloc SHOT pour l\'instant.')
  } else if (req.action === 'refine_shot') {
    lines.push('→ Affinage demandé. Applique la section "Action \'refine_shot\'" : 1 bloc SHOT seul qui REMPLACE le shot précédent (même shotIndex). Pas de bloc TEXT.')
  } else {
    lines.push('→ L\'auteur a tapé un message. Réponds normalement (TEXT court + 1-2 SHOT, ou TEXT seul si question).')
  }
  lines.push('')
  lines.push('# Contexte de la session')
  lines.push(`Pellicule active : ${ctx.pelliculeShots.length} shot(s) déjà existants. Index actif : ${ctx.activeShotIndex}.`)
  lines.push('')
  lines.push('# Persos déjà dans la pellicule (ids à utiliser)')
  if (ctx.charactersInPellicule.length === 0) {
    lines.push('(aucun encore)')
  } else {
    for (const c of ctx.charactersInPellicule) {
      const parts = [
        `id="${c.id}"`,
        `name="${c.name}"`,
        `gender=${c.gender}`,
        `hasVoice=${c.hasVoice}`,
      ]
      if (c.position) parts.push(`position="${c.position}"`)
      if (c.description) parts.push(`description="${c.description.slice(0, 120)}"`)
      lines.push(`- ${parts.join(' ')}`)
    }
  }
  lines.push('')
  lines.push('# Persos catalogue book (peuvent être ajoutés)')
  if (ctx.bookCharacters.length === 0) {
    lines.push('(aucun)')
  } else {
    for (const c of ctx.bookCharacters) {
      lines.push(`- id="${c.id}" name="${c.name}" gender=${c.gender}${c.position ? ` position=${c.position}` : ''}`)
    }
  }
  if (req.imageDescription) {
    lines.push('')
    lines.push('# Vue Qwen Scene (décor)')
    lines.push(req.imageDescription)
  }
  if (req.charactersDescription) {
    lines.push('')
    lines.push('# Vue Qwen Characters (vêtements visibles — SOURCE DE VÉRITÉ prioritaire)')
    lines.push(req.charactersDescription)
  }
  if (ctx.sceneVisible) {
    lines.push('')
    lines.push(`# Décor déjà saisi : "${ctx.sceneVisible}"`)
  }
  return lines.join('\n')
}

function callMistralChat(systemPrompt: string, messages: MistralMessage[]): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('MISTRAL_API_KEY manquante dans .env.local')

  const body = JSON.stringify({
    model: 'mistral-small-latest',
    max_tokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
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
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as MistralChatResponse
            if (res.statusCode !== 200) {
              reject(new Error(json.message ?? json.error?.message ?? `Mistral HTTP ${res.statusCode}`))
              return
            }
            const text = json.choices?.[0]?.message?.content?.trim() ?? ''
            resolve(text)
          } catch (e) {
            reject(new Error(`Parse Mistral: ${e instanceof Error ? e.message : String(e)}`))
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

// ─── Parser de la réponse Mistral en blocs ──────────────────────────────────

/** Strip les fences markdown ```...``` autour d'un bloc (Mistral les ajoute
 *  parfois malgré la consigne du system prompt). Refonte 2026-05-11. */
function stripMarkdownFences(block: string): string {
  let s = block.trim()
  // Remove leading ```lang? + newline
  s = s.replace(/^```[a-zA-Z]*\s*\r?\n/, '')
  // Remove trailing ``` (with optional preceding newline)
  s = s.replace(/\r?\n```\s*$/, '')
  // Cas dégénéré : juste ``` au début/fin sans newline
  s = s.replace(/^```/, '').replace(/```$/, '')
  return s.trim()
}

/** Parse la sortie Mistral structurée en `---`-séparée en messages typés. */
function parseMistralOutput(raw: string, ctx: ChatRequest): ChatMessage[] {
  const blocks = raw.split(/\n---\n|\n---$/m).map(stripMarkdownFences).filter(b => b.length > 0)
  const out: ChatMessage[] = []
  const ts = Date.now()

  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    const head = lines[0].trim().toUpperCase()
    if (head === 'TEXT') {
      const content = lines.slice(1).join('\n').trim()
      if (!content) continue
      const msg: ChatMessageAssistantText = {
        id: newMessageId(),
        role: 'assistant',
        kind: 'text',
        content,
        ts,
      }
      out.push(msg)
    } else if (head === 'SHOT') {
      const shot = parseShotBlock(lines.slice(1), ctx)
      if (shot) {
        const msg: ChatMessageAssistantShotProposal = {
          id: newMessageId(),
          role: 'assistant',
          kind: 'shot_proposal',
          intro: shot.intro,
          shot: shot.shot,
          status: 'pending',
          ts,
        }
        out.push(msg)
      }
    }
  }
  return out
}

function parseShotBlock(lines: string[], ctx: ChatRequest): { intro: string; shot: ChatShotProposal } | null {
  const obj: Record<string, string> = {}
  const perChar: Record<string, { action: string; dialogue: string | null; confidence: 'high' | 'medium' | 'low' }> = {}
  let mode: 'top' | 'perChar' = 'top'
  let currentCharId: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (mode === 'top') {
      if (/^perCharacter\s*:/.test(line)) {
        mode = 'perChar'
        continue
      }
      const m = line.match(/^(\w+)\s*:\s*(.*)$/)
      if (m) obj[m[1]] = m[2].trim()
    } else {
      // perChar mode : chaque entry = `  charId:` puis `    action: ...` `    dialogue: ...` `    confidence: ...`
      const charMatch = line.match(/^\s{2}([\w-]+)\s*:\s*$/)
      if (charMatch) {
        currentCharId = charMatch[1]
        perChar[currentCharId] = { action: '', dialogue: null, confidence: 'medium' }
        continue
      }
      const fieldMatch = line.match(/^\s{4,}(\w+)\s*:\s*(.*)$/)
      if (fieldMatch && currentCharId && perChar[currentCharId]) {
        const [, k, v] = fieldMatch
        const val = v.trim()
        if (k === 'action') perChar[currentCharId].action = val
        else if (k === 'dialogue') perChar[currentCharId].dialogue = (val === 'null' || val === '') ? null : val
        else if (k === 'confidence' && (val === 'high' || val === 'medium' || val === 'low')) {
          perChar[currentCharId].confidence = val
        }
      }
    }
  }

  // Sanitize : ne garde que les charIds valides du contexte (anti-hallucination)
  const validIds = new Set<string>([
    ...ctx.pelliculeContext.charactersInPellicule.map(c => c.id),
    ...ctx.pelliculeContext.bookCharacters.map(c => c.id),
  ])
  for (const cid of Object.keys(perChar)) {
    if (!validIds.has(cid)) {
      console.warn('[ai/chat] charId halluciné, supprimé:', cid)
      delete perChar[cid]
    }
  }

  // Refonte 2026-05-14az : autorise les shots SANS perso si sceneAction présent
  // (= scènes atmosphère / plan d'établissement / mouvement caméra). Sinon reject.
  const sceneAction = (obj.sceneAction ?? '').trim()
  if (Object.keys(perChar).length === 0 && !sceneAction) {
    console.warn('[ai/chat] shot block sans perChar ET sans sceneAction, ignoré')
    return null
  }

  const speakerId = obj.speakerId && obj.speakerId !== 'null' && validIds.has(obj.speakerId)
    ? obj.speakerId
    : null
  const shotIndex = parseInt(obj.shotIndex ?? '0', 10) || 0
  const suggestedDurationSec = Math.max(1, Math.min(20, parseInt(obj.suggestedDurationSec ?? '4', 10) || 4))

  return {
    intro: obj.intro ?? `Shot ${shotIndex + 1}`,
    shot: {
      shotIndex,
      speakerId,
      perCharacter: perChar,
      suggestedDurationSec,
      ...(sceneAction ? { sceneAction } : {}),
    },
  }
}

// ─── Action 'open' : génère la card de contexte côté server ─────────────────

function buildContextCard(req: ChatRequest): ChatMessageAssistantContextCard {
  const ctx = req.pelliculeContext
  const characters: ChatContextCharacter[] = ctx.charactersInPellicule.map(c => ({
    id: c.id,
    name: c.name,
    portraitUrl: null,  // TODO : passer portrait_url depuis le client si dispo
    description: c.description ?? null,
    position: c.position ?? null,
    hasVoice: c.hasVoice,
  }))
  const intro = characters.length === 0
    ? 'Aucun perso configuré dans cette pellicule. Ajoute-en via la banque, puis re-ouvre Ctrl+K.'
    : `Voici les ${characters.length} perso(s) en jeu. Confirme le contexte pour démarrer.`

  return {
    id: newMessageId(),
    role: 'assistant',
    kind: 'context_card',
    intro,
    characters,
    sceneSummary: ctx.sceneVisible?.slice(0, 200) ?? req.imageDescription?.slice(0, 200) ?? null,
    status: 'pending',
    ts: Date.now(),
  }
}

// ─── POST handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<ChatRequest>

    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: 'messages[] requis' }, { status: 400 })
    }
    if (!body.pelliculeContext) {
      return NextResponse.json({ error: 'pelliculeContext requis' }, { status: 400 })
    }
    if (!body.action || !['open', 'user_message', 'refine_shot'].includes(body.action)) {
      return NextResponse.json({ error: 'action invalide (open|user_message|refine_shot)' }, { status: 400 })
    }

    const reqFull = body as ChatRequest

    // Refonte 2026-05-15 — Action 'open' : appel Mistral DIRECT au lieu de
    // renvoyer une card statique avec bouton "Confirmer le contexte". Avant,
    // l'auteur devait cliquer Confirmer pour amorcer Mistral, ce qui était
    // du friction inutile (la card "Aucun perso configuré..." ne servait
    // à rien). Maintenant Mistral répond direct avec sa description de la
    // scène (template TEXT de l'action 'open' du system prompt) basée sur
    // la Vue Qwen Scene injectée dans le contexte. L'auteur enchaîne
    // immédiatement avec sa 1-2 phrases d'action.
    // (Le code buildContextCard reste accessible si on veut réactiver le
    // workflow "validation persos" plus tard sur les cas multi-perso ambigus.)

    // Sinon on appelle Mistral avec l'historique + un message contexte au début
    const contextMsg: MistralMessage = { role: 'user', content: buildContextSystemMessage(reqFull) }
    const historyMsgs = chatMessagesToMistral(reqFull.messages)
    const allMessages: MistralMessage[] = [contextMsg, ...historyMsgs]

    console.log(`[ai/chat] Mistral call — action=${reqFull.action} messages=${allMessages.length}`)

    let raw: string
    try {
      raw = await callMistralChat(SYSTEM_PROMPT, allMessages)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Appel Mistral: ${msg}` }, { status: 502 })
    }

    console.log(`[ai/chat] Mistral raw (${raw.length} chars):\n${raw.slice(0, 500)}${raw.length > 500 ? '…' : ''}`)

    const newMessages = parseMistralOutput(raw, reqFull)
    if (newMessages.length === 0) {
      // Mistral a répondu mais on n'a rien parsé → fallback : envoyer le raw comme texte
      newMessages.push({
        id: newMessageId(),
        role: 'assistant',
        kind: 'text',
        content: raw,
        ts: Date.now(),
      })
    }

    // Sanitize convention de nommage des intros — refonte 2026-05-11 :
    // Mistral mélange parfois "Shot unique" + "Shot 2 sur 2" (hybride incohérent).
    // On RENUMÉROTE automatiquement les intros en fonction du nombre réel de
    // blocs SHOT trouvés, pour que l'auteur voie une convention cohérente.
    const shotMessages = newMessages.filter(m => m.role === 'assistant' && m.kind === 'shot_proposal')
    const total = shotMessages.length
    if (total > 0) {
      shotMessages.forEach((m, i) => {
        const shotMsg = m as ChatMessageAssistantShotProposal
        const oldIntro = shotMsg.intro
        // Strip toute mention numérique existante au début ("Shot 1 sur 2 — ", "Shot unique — ", "Shot 1 — ")
        const description = oldIntro
          .replace(/^Shot\s+(\d+\s*(?:sur\s+\d+|\/\s*\d+)?|unique)\s*(?:—|-|:)?\s*/i, '')
          .trim()
        // Reconstruit avec convention uniforme
        let newIntro: string
        if (total === 1) {
          newIntro = description ? `Shot unique — ${description}` : 'Shot unique'
        } else {
          newIntro = description ? `Shot ${i + 1} sur ${total} — ${description}` : `Shot ${i + 1} sur ${total}`
        }
        if (newIntro !== oldIntro) {
          console.log(`[ai/chat] Renumérotation intro : "${oldIntro}" → "${newIntro}"`)
          shotMsg.intro = newIntro
        }
        // Force aussi shotIndex en fonction de la position (0-based)
        // pour que les shots multi soient correctement appliqués
        shotMsg.shot.shotIndex = i
      })
    }

    const response: ChatResponse = { newMessages, done: true }
    return NextResponse.json(response)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai/chat] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
