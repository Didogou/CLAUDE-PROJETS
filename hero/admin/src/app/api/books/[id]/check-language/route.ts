import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 180

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const LT_URL = 'https://api.languagetool.org/v2/check'

// Règles LanguageTool trop bruyantes pour de la fiction
const LT_DISABLED_RULES = [
  'TOO_LONG_SENTENCE',
  'PHRASE_REPETITION',
  'CONSECUTIVE_SPACES',
  'WHITESPACE_RULE',
  'COMMA_PARENTHESIS_WHITESPACE',
  'WORD_REPEAT_RULE',
  'APOS_TYP',
].join(',')

// Détection grossière de dialogue : le match est précédé de « ou —
function isInDialogue(text: string, offset: number): boolean {
  const before = text.slice(Math.max(0, offset - 200), offset)
  const lastDialogueOpen  = Math.max(before.lastIndexOf('«'), before.lastIndexOf('—'), before.lastIndexOf('"'))
  const lastDialogueClose = Math.max(before.lastIndexOf('»'), before.lastIndexOf('"'))
  return lastDialogueOpen > lastDialogueClose
}

async function runLanguageTool(
  sections: { id: string; number: number; content: string | null }[],
  language: string
): Promise<{ number: number; errors: { type: string; original: string; correction: string; context: string }[] }[]> {
  // Construire un texte combiné et mémoriser les offsets de chaque section
  let combined = ''
  const offsets: { number: number; start: number; end: number }[] = []

  for (const s of sections) {
    const text = s.content ?? ''
    const start = combined.length
    combined += text + '\n\n'
    offsets.push({ number: s.number, start, end: start + text.length })
  }

  // Découper en morceaux ≤ 19 000 caractères en coupant entre sections
  const CHUNK = 19000
  const chunks: { text: string; baseOffset: number }[] = []
  let pos = 0

  while (pos < combined.length) {
    let end = pos + CHUNK
    if (end < combined.length) {
      // Reculer jusqu'au dernier \n\n pour ne pas couper au milieu d'une section
      const cutAt = combined.lastIndexOf('\n\n', end)
      if (cutAt > pos) end = cutAt + 2
    }
    chunks.push({ text: combined.slice(pos, end), baseOffset: pos })
    pos = end
  }

  const allMatches: { offset: number; length: number; replacement: string; context: string; ruleId: string; categoryId: string }[] = []

  for (const chunk of chunks) {
    try {
      const body = new URLSearchParams({
        text: chunk.text,
        language,
        disabledRules: LT_DISABLED_RULES,
        disabledCategories: 'SPELLING,TYPOGRAPHY',
      })
      const res = await fetch(LT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body,
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const m of (data.matches ?? [])) {
        if (!m.replacements?.length) continue
        allMatches.push({
          offset: chunk.baseOffset + m.offset,
          length: m.length,
          replacement: m.replacements[0].value,
          context: m.context?.text ?? '',
          ruleId: m.rule?.id ?? '',
          categoryId: m.rule?.category?.id ?? '',
        })
      }
    } catch { /* ignorer les erreurs réseau */ }
  }

  // Grouper les matches par section
  const bySection = new Map<number, { type: string; original: string; correction: string; context: string }[]>()

  for (const match of allMatches) {
    const sec = offsets.find(o => match.offset >= o.start && match.offset < o.end)
    if (!sec) continue
    if (isInDialogue(combined, match.offset)) continue

    const original = combined.slice(match.offset, match.offset + match.length).trim()
    if (!original || original === match.replacement) continue

    const type = match.categoryId === 'GRAMMAR' ? 'grammar' : 'style'
    const list = bySection.get(sec.number) ?? []
    list.push({ type, original, correction: match.replacement, context: match.context })
    bySection.set(sec.number, list)
  }

  return [...bySection.entries()].map(([number, errors]) => ({ number, errors }))
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const [{ data: book }, { data: sections }] = await Promise.all([
      supabaseAdmin.from('books').select('title, theme, language').eq('id', id).single(),
      supabaseAdmin.from('sections').select('id, number, content').eq('book_id', id).order('number'),
    ])

    if (!book || !sections?.length) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

    const langLabel = book.language === 'en' ? 'anglaise' : 'française'
    const ltLang    = book.language === 'en' ? 'en-US' : 'fr'

    // ── Passe 1 : Claude (ortho + grammaire, 25 sections à la fois) ──────────
    const BATCH = 25
    const claudeErrors: { number: number; errors: { type: string; original: string; correction: string; context: string }[] }[] = []

    for (let i = 0; i < sections.length; i += BATCH) {
      const batch = sections.slice(i, i + BATCH)
      const sectionText = batch.map(s => `§${s.number}:\n${s.content ?? ''}`).join('\n\n---\n\n')

      const prompt = `Tu es un correcteur professionnel de langue ${langLabel}. Analyse les sections suivantes d'un livre "Dont Vous Êtes le Héros" intitulé "${book.title}".

${sectionText}

RÈGLES IMPORTANTES :
- Les dialogues entre personnages (texte entre guillemets « », " " ou précédé d'un tiret —) ont leurs propres règles : phrases incomplètes, fragments, interjections, argot, niveaux de langue variés — TOUT cela est NORMAL et ne doit PAS être signalé.
- Ne signale que les erreurs dans le texte NARRATIF (hors dialogues).
- Les fautes d'orthographe dans le discours d'un personnage (ex: « Ché pas moi... ») sont volontaires — NE PAS corriger.
- Les phrases courtes ou nominales dans la narration (style Pierre Bordage) sont intentionnelles — NE PAS corriger.
- Ne signale QUE : fautes d'orthographe réelles dans la narration, erreurs de conjugaison dans la narration, accords oubliés (genre/nombre) dans la narration.

Pour chaque erreur trouvée, identifie :
- Le numéro de section
- Le type : "ortho" (faute d'orthographe) ou "grammar" (faute de grammaire/conjugaison/accord)
- Le mot ou groupe de mots erroné (original)
- La correction
- Le contexte (phrase ou fragment contenant l'erreur)
- Le champ "dialogue" à true si tu as un doute sur le fait que ce soit du dialogue

Si une section est correcte (ou n'a que des imperfections dans les dialogues), ne la mentionne pas.

Réponds UNIQUEMENT en JSON valide :
{"sections":[{"number":N,"errors":[{"type":"ortho","original":"mot erroné","correction":"mot corrigé","context":"...fragment...","dialogue":false}]}]}`

      const stream = anthropic.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      })
      const message = await stream.finalMessage()
      const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

      try {
        const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
        if (start !== -1 && end !== -1) {
          const parsed = JSON.parse(raw.slice(start, end + 1))
          for (const sec of (parsed.sections ?? [])) {
            const realErrors = (sec.errors ?? []).filter((e: any) => !e.dialogue)
            if (realErrors.length) claudeErrors.push({ number: sec.number, errors: realErrors })
          }
        }
      } catch { /* ignorer */ }
    }

    // ── Passe 2 : LanguageTool (style + grammaire structurelle) ──────────────
    const ltErrors = await runLanguageTool(sections, ltLang)

    // ── Fusionner les résultats ───────────────────────────────────────────────
    const allSectionNums = new Set([
      ...claudeErrors.map(s => s.number),
      ...ltErrors.map(s => s.number),
    ])

    const allErrors = [...allSectionNums].sort((a, b) => a - b).map(num => {
      const c = claudeErrors.find(s => s.number === num)?.errors ?? []
      const lt = ltErrors.find(s => s.number === num)?.errors ?? []
      // Dédupliquer : ignorer LT si Claude a déjà signalé le même mot
      const claudeOriginals = new Set(c.map(e => e.original.toLowerCase()))
      const filteredLt = lt.filter(e => !claudeOriginals.has(e.original.toLowerCase()))
      return { number: num, errors: [...c, ...filteredLt] }
    }).filter(s => s.errors.length > 0)

    // ── Rapport markdown ─────────────────────────────────────────────────────
    const totalErrors  = allErrors.reduce((n, s) => n + s.errors.length, 0)
    const orthoCount   = allErrors.reduce((n, s) => n + s.errors.filter((e: any) => e.type === 'ortho').length, 0)
    const grammarCount = allErrors.reduce((n, s) => n + s.errors.filter((e: any) => e.type === 'grammar').length, 0)
    const styleCount   = allErrors.reduce((n, s) => n + s.errors.filter((e: any) => e.type === 'style').length, 0)

    let report = `## Bilan\n`
    if (totalErrors === 0) {
      report += 'Aucune erreur détectée dans le texte narratif.'
    } else {
      report += `${totalErrors} erreur(s) — ${orthoCount} orthographe, ${grammarCount} grammaire, ${styleCount} style`
    }
    report += '\nNote : les dialogues entre personnages sont exclus de la vérification.\n\n'

    if (allErrors.length > 0) {
      report += `## Erreurs par section\n`
      for (const sec of allErrors) {
        report += `\n### §${sec.number}\n`
        for (const err of sec.errors) {
          const badge = err.type === 'ortho' ? '🔤' : err.type === 'grammar' ? '📝' : '✏️'
          report += `- ${badge} **${err.original}** → \`${err.correction}\`\n  _${err.context}_\n`
        }
      }
    }

    await supabaseAdmin.from('books').update({ lang_analysis: report }).eq('id', id)

    return NextResponse.json({ report, errors: allErrors, total: totalErrors })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Erreur inconnue' }, { status: 500 })
  }
}
