import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic, extractJson } from '@/lib/ai-utils'

export const maxDuration = 300

const MAX_PATHS   = 30   // chemins distincts max avant déduplication
const MAX_DEPTH   = 450  // profondeur max par chemin (> num_sections pour avoir de la marge)

// ── Types ─────────────────────────────────────────────────────────────────────

type SectionType = 'narration' | 'combat' | 'chance' | 'enigme' | 'dialogue' | 'magie' | 'ending'

interface PathSection {
  number:      number
  summary:     string
  type:        SectionType
  ending_type: string | null
  discussion?: string   // résumé condensé de la discussion si présente
}

interface NarrativePath {
  id:       string
  sections: PathSection[]
  ending:   { number: number; type: string | null }
}

interface NarrativeIssue {
  path_ids:    string[]       // chemins concernés ('all' si global)
  sections:    number[]       // sections impliquées
  type:        'logic_gap' | 'character_inconsistency' | 'pacing' | 'setup_no_payoff' | 'contradiction' | 'missing_setup'
  severity:    'critique' | 'important' | 'mineur'
  description: string
  fix?:        { number: number; summary: string }  // correction suggérée (sur le résumé)
}

// ── BFS exhaustif de couverture (sans cap) ────────────────────────────────────

function computeReachable(
  sectionByNumber: Map<number, any>,
  sectionById:     Map<string, any>,
  choicesBySecId:  Map<string, { target_id: string; is_back: boolean }[]>
): { reachable: Set<string>; onlyViaFailure: Set<string> } {
  const startSec = sectionByNumber.get(1)
  if (!startSec) return { reachable: new Set(), onlyViaFailure: new Set() }

  // Passe 1 : BFS complet (success + failure + choices)
  const reachable = new Set<string>([startSec.id])
  const queue1: string[] = [startSec.id]
  while (queue1.length > 0) {
    const id = queue1.shift()!
    const sec = sectionById.get(id)
    if (!sec || sec.is_ending) continue
    const trial = sec.trial as any
    for (const nextId of [trial?.success_section_id, trial?.failure_section_id].filter((x): x is string => !!x)) {
      if (!reachable.has(nextId)) { reachable.add(nextId); queue1.push(nextId) }
    }
    for (const c of (choicesBySecId.get(id) ?? []).filter(c => !c.is_back)) {
      if (c.target_id && !reachable.has(c.target_id)) { reachable.add(c.target_id); queue1.push(c.target_id) }
    }
  }

  // Passe 2 : BFS sans failure (pour isoler les sections uniquement accessibles via échec)
  const reachableWithoutFailure = new Set<string>([startSec.id])
  const queue2: string[] = [startSec.id]
  while (queue2.length > 0) {
    const id = queue2.shift()!
    const sec = sectionById.get(id)
    if (!sec || sec.is_ending) continue
    const trial = sec.trial as any
    if (trial?.success_section_id && !reachableWithoutFailure.has(trial.success_section_id)) {
      reachableWithoutFailure.add(trial.success_section_id)
      queue2.push(trial.success_section_id)
    }
    for (const c of (choicesBySecId.get(id) ?? []).filter(c => !c.is_back)) {
      if (c.target_id && !reachableWithoutFailure.has(c.target_id)) {
        reachableWithoutFailure.add(c.target_id); queue2.push(c.target_id)
      }
    }
  }

  const onlyViaFailure = new Set([...reachable].filter(id => !reachableWithoutFailure.has(id)))
  return { reachable, onlyViaFailure }
}

// ── Traversée narrative ────────────────────────────────────────────────────────

function buildNarrativePaths(
  sectionById: Map<string, any>,
  sectionByNumber: Map<number, any>,
  choicesBySecId: Map<string, { target_id: string; is_back: boolean }[]>,
  npcById: Map<string, any>
): NarrativePath[] {
  const paths: NarrativePath[] = []
  const startSec = sectionByNumber.get(1)
  if (!startSec) return paths

  function sectionType(sec: any): SectionType {
    if (sec.is_ending) return 'ending'
    const t = sec.trial as any
    if (!t) return 'narration'
    const map: Record<string, SectionType> = {
      combat: 'combat', chance: 'chance', enigme: 'enigme',
      dialogue: 'dialogue', magie: 'magie', crochetage: 'enigme',
      agilite: 'chance', intelligence: 'enigme',
    }
    return map[t.type] ?? 'narration'
  }

  function dfs(secId: string, pathSecs: PathSection[], visited: Set<string>) {
    if (paths.length >= MAX_PATHS || pathSecs.length > MAX_DEPTH) return
    const sec = sectionById.get(secId)
    if (!sec) return

    const ps: PathSection = {
      number:      sec.number,
      summary:     sec.summary ?? '',
      type:        sectionType(sec),
      ending_type: sec.ending_type ?? null,
      discussion:  condenseDiscussion(sec.discussion_scene, npcById),
    }
    const newPath = [...pathSecs, ps]

    if (sec.is_ending) {
      paths.push({ id: `path_${paths.length + 1}`, sections: newPath, ending: { number: sec.number, type: sec.ending_type ?? null } })
      return
    }

    visited.add(secId)

    // Pour toutes les épreuves : branche succès = continuation narrative principale
    // Branche échec = chemin alternatif (mort sur combat, raté sur énigme/dialogue…)
    const trial = sec.trial as any
    if (trial?.success_section_id && !visited.has(trial.success_section_id)) {
      dfs(trial.success_section_id, newPath, new Set(visited))
    }
    if (trial?.failure_section_id
        && trial.failure_section_id !== trial.success_section_id
        && !visited.has(trial.failure_section_id)) {
      dfs(trial.failure_section_id, newPath, new Set(visited))
    }

    // Suivre tous les choix sortants (hors retours en arrière)
    const secChoices = (choicesBySecId.get(secId) ?? []).filter(c => !c.is_back)
    for (const c of secChoices) {
      if (paths.length >= MAX_PATHS) break
      if (!visited.has(c.target_id)) {
        dfs(c.target_id, newPath, new Set(visited))
      }
    }

    visited.delete(secId)
  }

  dfs(startSec.id, [], new Set())
  return paths
}

// ── Déduplication : supprimer les chemins quasi-identiques ────────────────────

function deduplicatePaths(paths: NarrativePath[]): NarrativePath[] {
  const unique: NarrativePath[] = []
  for (const p of paths) {
    const nums = p.sections.map(s => s.number).join(',')
    const isDuplicate = unique.some(u => {
      const uNums = u.sections.map(s => s.number).join(',')
      // Même fin ET 80%+ de sections communes
      if (u.ending.number !== p.ending.number) return false
      const setA = new Set(p.sections.map(s => s.number))
      const setB = new Set(u.sections.map(s => s.number))
      const intersection = [...setA].filter(n => setB.has(n)).length
      return intersection / Math.max(setA.size, setB.size) > 0.8
    })
    if (!isDuplicate) unique.push(p)
  }
  return unique
}

// ── Chargement DB commun ──────────────────────────────────────────────────────

// ── Condenseur de discussion ──────────────────────────────────────────────────

function condenseDiscussion(disc: any, npcById: Map<string, any>): string | undefined {
  if (!disc) return undefined
  const npcName = npcById.get(disc.npc_id)?.name ?? 'PNJ'
  const lines: string[] = [`[Discussion avec ${npcName}]`]
  if (disc.npc_opening) lines.push(`  ${npcName} : "${disc.npc_opening.slice(0, 100)}"`)
  for (const c of (disc.choices ?? []).slice(0, 3)) {
    lines.push(`  Joueur [${c.emotion_label ?? ''}] : "${c.player_text?.slice(0, 80)}"`)
    if (c.npc_response) lines.push(`  ${npcName} : "${c.npc_response.slice(0, 80)}"`)
    for (const sc of (c.sub_choices ?? []).slice(0, 2)) {
      lines.push(`    → Joueur : "${sc.player_text?.slice(0, 60)}"`)
      if (sc.npc_response) lines.push(`    → ${npcName} cède : "${sc.npc_response.slice(0, 60)}"`)
    }
  }
  return lines.join('\n')
}

// ── Chargement DB commun ──────────────────────────────────────────────────────

async function loadBook(id: string) {
  const [{ data: book }, { data: sections }, { data: npcs }, { data: items }] = await Promise.all([
    supabaseAdmin.from('books').select('title, theme, context_type, synopsis, difficulty').eq('id', id).single(),
    supabaseAdmin.from('sections').select('id, number, summary, content, is_ending, ending_type, trial, discussion_scene').eq('book_id', id).order('number'),
    supabaseAdmin.from('npcs').select('id, name, type').eq('book_id', id),
    supabaseAdmin.from('items').select('id, name').eq('book_id', id),
  ])
  if (!book || !sections?.length) return null

  const sectionIds = sections.map((s: any) => s.id)
  const { data: choices } = await supabaseAdmin
    .from('choices').select('section_id, target_section_id, is_back')
    .in('section_id', sectionIds)

  const sectionById    = new Map(sections.map((s: any) => [s.id, s]))
  const sectionByNumber = new Map(sections.map((s: any) => [s.number, s]))

  const choicesBySecId = new Map<string, { target_id: string; is_back: boolean }[]>()
  for (const c of choices ?? []) {
    if (!c.target_section_id) continue
    const list = choicesBySecId.get(c.section_id) ?? []
    list.push({ target_id: c.target_section_id, is_back: c.is_back ?? false })
    choicesBySecId.set(c.section_id, list)
  }

  const npcById = new Map((npcs ?? []).map((n: any) => [n.id, n]))

  return { book, sections, npcs: npcs ?? [], items: items ?? [], sectionById, sectionByNumber, choicesBySecId, npcById }
}

// ── GET : construction des chemins (sans IA) ──────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await loadBook(id)
  if (!db) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  // BFS exhaustif pour les stats de couverture (précis, sans cap)
  const { reachable, onlyViaFailure } = computeReachable(db.sectionByNumber, db.sectionById, db.choicesBySecId)

  // DFS capé pour la représentation des chemins narratifs (analyse Opus)
  const rawPaths = buildNarrativePaths(db.sectionById, db.sectionByNumber, db.choicesBySecId, db.npcById)
  const paths    = deduplicatePaths(rawPaths)

  const reachableNums  = new Set([...reachable].map(id => db.sectionById.get(id)?.number).filter(Boolean))
  const failureOnlyNums = new Set([...onlyViaFailure].map(id => db.sectionById.get(id)?.number).filter(Boolean))

  const stats = {
    total_sections:    db.sections.length,
    reachable:         reachable.size,
    paths_found:       paths.length,
    victory_endings:   paths.filter(p => p.ending.type === 'victory').length,
    death_endings:     paths.filter(p => p.ending.type === 'death').length,
    unreachable:       db.sections
      .filter((s: any) => !reachable.has(s.id) && !s.is_ending)
      .map((s: any) => s.number),
    only_via_failure:  db.sections
      .filter((s: any) => onlyViaFailure.has(s.id))
      .map((s: any) => s.number),
  }

  return NextResponse.json({ paths, stats })
}

// ── POST : analyse IA ────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const db = await loadBook(id)
  if (!db) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const rawPaths = buildNarrativePaths(db.sectionById, db.sectionByNumber, db.choicesBySecId, db.npcById)
  const paths    = deduplicatePaths(rawPaths)

  if (paths.length === 0) return NextResponse.json({ error: 'Aucun chemin narratif trouvé depuis §1' }, { status: 422 })

  const npcNames  = db.npcs.map((n: any) => `${n.name} (${n.type})`).join(', ')
  const itemNames = db.items.map((i: any) => i.name).join(', ')

  // ── Construire la représentation condensée de chaque chemin ───────────────
  const hasDiscussions = paths.some(p => p.sections.some(s => s.discussion))
  const pathsText = paths.map(p => {
    const narrative = p.sections
      .filter(s => s.summary)
      .map(s => {
        const tag = s.type !== 'narration' ? ` [${s.type.toUpperCase()}]` : ''
        const end = s.type === 'ending' ? ` ← FIN ${(s.ending_type ?? '').toUpperCase()}` : ''
        const disc = s.discussion ? `\n${s.discussion}` : ''
        return `§${s.number}${tag}${end} : ${s.summary}${disc}`
      })
      .join('\n')
    return `=== ${p.id.toUpperCase()} (${p.sections.length} sections → FIN ${(p.ending.type ?? '?').toUpperCase()} §${p.ending.number}) ===\n${narrative}`
  }).join('\n\n')

  // ── Sections non atteintes (orphelines) ───────────────────────────────────
  const reachableNums = new Set(paths.flatMap(p => p.sections.map(s => s.number)))
  const unreachable   = db.sections
    .filter((s: any) => !reachableNums.has(s.number) && !s.is_ending)
    .map((s: any) => `§${s.number}: ${s.summary ?? '(sans résumé)'}`)
    .join('\n')

  const prompt = `Tu es un éditeur littéraire expert en livres "Dont Vous Êtes le Héros" (LDVELH).
Analyse les chemins narratifs du livre ci-dessous d'un point de vue TEXTUEL ET LOGIQUE.

LIVRE : "${db.book.title}" (${db.book.theme}, ${db.book.context_type})
Difficulté : ${db.book.difficulty ?? 'non définie'}
PNJ : ${npcNames || 'aucun'}
Objets : ${itemNames || 'aucun'}

${db.book.synopsis ? `SYNOPSIS :\n${db.book.synopsis.slice(0, 1500)}\n` : ''}

════════════════════════════════════════
CHEMINS NARRATIFS (depuis §1 jusqu'aux fins)
Les épreuves [COMBAT], [CHANCE], [ENIGME], [DIALOGUE]… sont traversées (succès ET échec) mais leur mécanique est ignorée — seule la narration compte.
════════════════════════════════════════
${pathsText}

${unreachable ? `════════════════════════════════════════\nSECTIONS NON ATTEINTES (jamais visitées depuis §1) :\n${unreachable}\n` : ''}

════════════════════════════════════════
MISSION : Analyse chaque chemin ET les incohérences inter-chemins.
Pour chaque problème détecté, propose une correction du résumé (summary) de la section concernée.

Critères d'analyse :
1. LOGIQUE : les événements s'enchaînent logiquement ? Les causes précèdent les effets ?
2. PERSONNAGES : les PNJ se comportent de manière cohérente entre les différents chemins ?
3. RYTHME : accumulation de scènes du même type ? Creux narratifs ?
4. SETUP/PAYOFF : tout élément introduit a-t-il une résolution ? Tout payoff a-t-il un setup ?
5. CONTRADICTIONS INTER-CHEMINS : deux branches se contredisent-elles sur un fait ?
6. SECTIONS NON ATTEINTES : leur absence crée-t-elle un vide narratif ?${hasDiscussions ? `
7. DISCUSSIONS : les conversations sont-elles cohérentes avec le caractère du PNJ et le contexte narratif de la section ? Les arguments du joueur sont-ils logiques par rapport à ce qui s'est passé avant ? Un PNJ dit-il la même chose dans des chemins différents alors que le contexte a changé ?` : ''}

Réponds UNIQUEMENT en JSON brut :
{
  "analysis": "<analyse globale en 3-5 paragraphes, sans §>",
  "path_summaries": [
    { "path_id": "path_1", "quality": 7, "note": "<1-2 phrases>" }
  ],
  "issues": [
    {
      "path_ids": ["path_1", "path_2"],
      "sections": [12, 15],
      "type": "character_inconsistency",
      "severity": "important",
      "description": "<description précise du problème>",
      "fix": { "number": 12, "summary": "<résumé corrigé de la section 12>" }
    }
  ]
}`

  let raw: string
  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      system: 'Tu es un analyseur narratif JSON. Réponds UNIQUEMENT en JSON brut valide, sans texte avant ou après. Sois concis dans les descriptions (1-2 phrases max par problème).',
      messages: [{ role: 'user', content: prompt }],
    })
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'max_tokens') {
      console.warn(`[narrative-paths] TRONCATURE — max_tokens=16000 atteint, JSON probablement incomplet`)
    }
    raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  } catch (err: any) {
    return NextResponse.json({ error: `Erreur Claude : ${err.message}` }, { status: 500 })
  }

  let result: { analysis: string; path_summaries: any[]; issues: NarrativeIssue[] }
  try {
    result = JSON.parse(extractJson(raw))
  } catch {
    return NextResponse.json({ error: 'Réponse Claude non parseable', raw: raw.slice(0, 500) }, { status: 500 })
  }

  const { reachable: bfsReachable, onlyViaFailure: bfsFailureOnly } = computeReachable(db.sectionByNumber, db.sectionById, db.choicesBySecId)

  return NextResponse.json({
    paths,
    stats: {
      total_sections:   db.sections.length,
      reachable:        bfsReachable.size,
      paths_found:      paths.length,
      victory_endings:  paths.filter(p => p.ending.type === 'victory').length,
      death_endings:    paths.filter(p => p.ending.type === 'death').length,
      unreachable:      db.sections.filter((s: any) => !bfsReachable.has(s.id) && !s.is_ending).map((s: any) => s.number),
      only_via_failure: db.sections.filter((s: any) => bfsFailureOnly.has(s.id)).map((s: any) => s.number),
    },
    analysis:      result.analysis ?? '',
    path_summaries: result.path_summaries ?? [],
    issues:        result.issues ?? [],
    corrections_available: (result.issues ?? []).filter(i => i.fix).length,
  })
}
