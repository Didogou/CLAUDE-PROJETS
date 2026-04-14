import Anthropic from '@anthropic-ai/sdk'
import https from 'node:https'

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Traduction FR → EN via Haiku ──────────────────────────────────────────────

export async function translateToEnglish(text: string): Promise<string> {
  if (!text?.trim()) return text
  const frenchMarkers = /\b(le|la|les|un|une|des|et|est|dans|avec|pour|sur|qui|que|je|tu|il|elle|nous|vous|ils|elles|du|au|aux)\b/i
  if (!frenchMarkers.test(text)) return text
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: `Translate this image description to English. Return ONLY the translated text, nothing else:\n\n${text}` }],
    })
    return msg.content[0].type === 'text' ? msg.content[0].text.trim() : text
  } catch {
    return text
  }
}

// ── JSON sanitizer ────────────────────────────────────────────────────────────

export function fixJsonControlChars(raw: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { result += ch; escaped = false; continue }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString) {
      if      (ch === '\n') { result += '\\n';  continue }
      else if (ch === '\r') { result += '\\r';  continue }
      else if (ch === '\t') { result += '\\t';  continue }
      else if (ch.charCodeAt(0) < 0x20) { continue }
    }
    result += ch
  }
  return result
}

export function extractJson(raw: string): string {
  // Supprimer les blocs markdown où qu'ils soient dans la chaîne
  const stripped = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
  // Chercher un début JSON valide : { ou [{ ou [" ou [] — pas juste [ seul (évite [COMBAT], [FIN]…)
  const objStart = stripped.indexOf('{')
  const arrStart = stripped.search(/\[\s*[{\["'\-\d\]tf]/)  // [ suivi d'un caractère JSON valide
  let start: number
  if (objStart === -1 && arrStart === -1) return fixJsonControlChars(stripped)
  if (objStart === -1) start = arrStart
  else if (arrStart === -1) start = objStart
  else start = Math.min(objStart, arrStart)
  // Trouver la fin par comptage de brackets équilibrés (évite lastIndexOf sur contenu parasite)
  const opener = stripped[start]
  const closer = opener === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escape = false
  let end = -1
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === opener) depth++
    else if (ch === closer) { depth--; if (depth === 0) { end = i; break } }
  }
  const cleaned = end !== -1 ? stripped.slice(start, end + 1) : stripped.slice(start)
  return fixJsonControlChars(cleaned)
}

// ── Claude streaming avec retry ───────────────────────────────────────────────

export async function streamMessageWithRetry(
  params: Parameters<typeof anthropic.messages.stream>[0],
  maxRetries = 4
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const stream = anthropic.messages.stream(params)
      return await stream.finalMessage()
    } catch (err: any) {
      const isOverloaded = err?.status === 529 || err?.error?.type === 'overloaded_error'
      if (isOverloaded && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 30000)))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries reached')
}

// ── Mistral via node:https ────────────────────────────────────────────────────

const MISTRAL_MAX_TOKENS = 16000

export async function callMistral(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('Clé MISTRAL_API_KEY manquante dans .env.local')

  const body = JSON.stringify({
    model: 'mistral-large-latest',
    max_tokens: Math.min(maxTokens, MISTRAL_MAX_TOKENS),
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
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 360_000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
            if (res.statusCode !== 200) {
              reject(new Error(json.message ?? json.error?.message ?? `Mistral HTTP ${res.statusCode}`))
            } else {
              resolve((json.choices?.[0]?.message?.content as string ?? '').trim())
            }
          } catch (e) { reject(e) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Délai Mistral dépassé')) })
    req.write(body)
    req.end()
  })
}

// ── Dispatcher Claude / Mistral ───────────────────────────────────────────────

export async function generateText(
  model: 'claude' | 'opus' | 'mistral',
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  if (model === 'mistral') return callMistral(systemPrompt, userPrompt, maxTokens)
  const claudeModel = model === 'opus' ? 'claude-opus-4-6' : 'claude-sonnet-4-6'
  const msg = await streamMessageWithRetry({
    model: claudeModel,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  if (msg.stop_reason === 'max_tokens') {
    throw new Error(`TRONCATURE — modèle=${claudeModel} max_tokens=${maxTokens} atteint. Augmente max_tokens ou réduis la taille du lot.`)
  }
  return msg.content[0].type === 'text' ? msg.content[0].text : ''
}

// ── Normalisation ending_type ─────────────────────────────────────────────────

export function normalizeNpcType(raw: any): 'ennemi' | 'boss' | 'allié' | 'neutre' | 'marchand' {
  if (!raw) return 'ennemi'
  const v = String(raw).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  if (['allie', 'ally', 'allied', 'companion', 'compagnon', 'ami', 'friend'].includes(v)) return 'allié'
  if (['boss', 'chef', 'leader', 'antagonist', 'antagoniste'].includes(v)) return 'boss'
  if (['neutre', 'neutral', 'npc'].includes(v)) return 'neutre'
  if (['marchand', 'merchant', 'vendor', 'vendeur', 'trader'].includes(v)) return 'marchand'
  if (['ennemi', 'enemy', 'foe', 'hostile', 'villain'].includes(v)) return 'ennemi'
  // Correspondance exacte avec accents
  const VALID = ['ennemi', 'boss', 'allié', 'neutre', 'marchand'] as const
  if (VALID.includes(raw as any)) return raw as any
  return 'ennemi'
}

export function normalizeEndingType(raw: any): 'victory' | 'death' | null {
  if (!raw) return null
  const v = String(raw).toLowerCase().trim()
  if (['victory', 'victoire', 'win', 'succes', 'success'].includes(v)) return 'victory'
  if (['death', 'mort', 'lose', 'defeat', 'defaite', 'défaite'].includes(v)) return 'death'
  return null
}
