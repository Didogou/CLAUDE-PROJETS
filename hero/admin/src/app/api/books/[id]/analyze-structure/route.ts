import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const VALID_TRIAL_TYPES = new Set(['combat', 'agilite', 'intelligence', 'magie', 'chance', 'crochetage', 'dialogue', 'enigme'])

interface DbSection {
  id: string
  number: number
  is_ending: boolean
  ending_type: string | null
  trial: { type: string; success_section_id: string | null; failure_section_id: string | null; enemy?: any; npc_id?: string } | null
}

interface DbChoice {
  id: string
  section_id: string
  target_section_id: string | null
  label: string
  sort_order: number
}

export interface StructureIssue {
  id: string
  severity: 'critical' | 'important' | 'narrative'
  type: string
  sections: number[]
  description: string
  section_id?: string
  choice_id?: string
  autofix?: { label: string; action: string; params: Record<string, any> }
  manual?: { fields: { key: string; label: string; placeholder: string }[]; action: string; static_params?: Record<string, any> }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: sections } = await supabaseAdmin
    .from('sections')
    .select('id, number, is_ending, ending_type, trial')
    .eq('book_id', id)
    .order('number')

  if (!sections) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const sectionIds = sections.map((s: any) => s.id)
  const { data: choices } = await supabaseAdmin
    .from('choices')
    .select('id, section_id, target_section_id, label, sort_order')
    .in('section_id', sectionIds)

  const choicesArr: DbChoice[] = choices ?? []
  const sectionsArr: DbSection[] = sections as DbSection[]

  const sectionById = new Map(sectionsArr.map(s => [s.id, s]))
  const outgoing = new Map<string, DbChoice[]>()
  for (const s of sectionsArr) outgoing.set(s.id, [])
  for (const c of choicesArr) {
    if (!outgoing.has(c.section_id)) outgoing.set(c.section_id, [])
    outgoing.get(c.section_id)!.push(c)
  }

  const issues: StructureIssue[] = []

  for (const sec of sectionsArr) {
    const out = outgoing.get(sec.id) ?? []
    const trial = sec.trial

    // 1. Self-loop
    for (const c of out) {
      if (c.target_section_id === sec.id) {
        issues.push({
          id: `self_loop_${sec.number}_${c.id}`,
          severity: 'critical',
          type: 'self_loop',
          sections: [sec.number],
          section_id: sec.id,
          choice_id: c.id,
          description: `§${sec.number} : le choix "${c.label}" pointe sur lui-même (boucle infinie).`,
          autofix: { label: 'Supprimer ce choix', action: 'delete_choice', params: { choice_id: c.id } },
          manual: { fields: [{ key: 'target_section_number', label: 'Rediriger vers la section n°', placeholder: 'ex: 91' }], action: 'fix_choice_target', static_params: { choice_id: c.id } },
        })
      }
    }

    if (!sec.is_ending) {
      const hasChoices = out.length > 0
      const hasTrialRouting = trial && (trial.success_section_id || trial.failure_section_id)

      // 2. Dead end
      if (!hasChoices && !hasTrialRouting) {
        issues.push({
          id: `dead_end_${sec.number}`,
          severity: 'critical',
          type: 'dead_end',
          sections: [sec.number],
          section_id: sec.id,
          description: `§${sec.number} : cul-de-sac — aucun choix sortant${trial ? ' et épreuve sans routage succès/échec' : ''}.`,
          manual: trial
            ? { fields: [{ key: 'success_number', label: 'Section succès', placeholder: 'ex: 77' }, { key: 'failure_number', label: 'Section échec', placeholder: 'ex: 78' }], action: 'add_trial_route', static_params: { section_id: sec.id } }
            : { fields: [{ key: 'target_section_number', label: 'Aller à la section n°', placeholder: 'ex: 16' }, { key: 'label', label: 'Texte du choix', placeholder: 'ex: Continuer' }], action: 'add_choice', static_params: { section_id: sec.id } },
        })
      }

      // 3. Trial routing incomplete
      if (trial && trial.success_section_id && !trial.failure_section_id) {
        issues.push({
          id: `trial_no_failure_${sec.number}`,
          severity: 'important',
          type: 'trial_incomplete',
          sections: [sec.number],
          section_id: sec.id,
          description: `§${sec.number} : épreuve "${trial.type}" — section d'échec manquante.`,
          manual: { fields: [{ key: 'failure_number', label: 'Section en cas d\'échec', placeholder: 'ex: 99' }], action: 'set_trial_failure', static_params: { section_id: sec.id } },
        })
      }
      if (trial && !trial.success_section_id && trial.failure_section_id) {
        issues.push({
          id: `trial_no_success_${sec.number}`,
          severity: 'important',
          type: 'trial_incomplete',
          sections: [sec.number],
          section_id: sec.id,
          description: `§${sec.number} : épreuve "${trial.type}" — section de succès manquante.`,
          manual: { fields: [{ key: 'success_number', label: 'Section en cas de succès', placeholder: 'ex: 77' }], action: 'set_trial_success', static_params: { section_id: sec.id } },
        })
      }
    }

    // 4. Invalid trial type
    if (trial?.type && !VALID_TRIAL_TYPES.has(trial.type)) {
      const suggested = trial.type === 'intel' ? 'intelligence' : trial.type.startsWith('enigm') ? 'enigme' : null
      issues.push({
        id: `invalid_trial_${sec.number}`,
        severity: 'important',
        type: 'invalid_trial_type',
        sections: [sec.number],
        section_id: sec.id,
        description: `§${sec.number} : type d'épreuve invalide "${trial.type}"${suggested ? ` (suggéré : "${suggested}")` : ''}.`,
        ...(suggested ? { autofix: { label: `Corriger en "${suggested}"`, action: 'fix_trial_type', params: { section_id: sec.id, value: suggested } } } : {}),
        manual: { fields: [{ key: 'value', label: 'Nouveau type', placeholder: 'combat, enigme, chance…' }], action: 'fix_trial_type', static_params: { section_id: sec.id } },
      })
    }

    // 5. Combat without enemy
    if (trial?.type === 'combat' && !trial.enemy && !trial.npc_id) {
      issues.push({
        id: `combat_no_enemy_${sec.number}`,
        severity: 'important',
        type: 'combat_no_enemy',
        sections: [sec.number],
        section_id: sec.id,
        description: `§${sec.number} : combat sans ennemi défini (ni stats d'ennemi, ni PNJ lié).`,
      })
    }

    // 6. Ending without type
    if (sec.is_ending && !sec.ending_type) {
      issues.push({
        id: `ending_no_type_${sec.number}`,
        severity: 'important',
        type: 'ending_no_type',
        sections: [sec.number],
        section_id: sec.id,
        description: `§${sec.number} : section de fin sans type (victoire ou mort).`,
        autofix: { label: 'Marquer comme Mort', action: 'fix_ending_type', params: { section_id: sec.id, value: 'death' } },
      })
    }
  }

  // 7. Significant backward links (>15 sections back)
  for (const c of choicesArr) {
    const from = sectionById.get(c.section_id)
    const to = c.target_section_id ? sectionById.get(c.target_section_id) : null
    if (from && to && from.number - to.number > 15) {
      issues.push({
        id: `backward_${from.number}_${c.id}`,
        severity: 'narrative',
        type: 'backward_link',
        sections: [from.number, to.number],
        choice_id: c.id,
        description: `§${from.number} → §${to.number} : lien très en arrière (−${from.number - to.number} sections). Vérifier la cohérence narrative.`,
        manual: { fields: [{ key: 'target_section_number', label: 'Rediriger vers la section n°', placeholder: 'ex: 91' }], action: 'fix_choice_target', static_params: { choice_id: c.id } },
      })
    }
  }

  // 8. Mutual cycles (A→B→A, not self-loops)
  const targetMap = new Map<string, string[]>()
  for (const c of choicesArr) {
    if (c.target_section_id && c.target_section_id !== c.section_id) {
      if (!targetMap.has(c.section_id)) targetMap.set(c.section_id, [])
      targetMap.get(c.section_id)!.push(c.target_section_id)
    }
  }
  const reportedCycles = new Set<string>()
  for (const [sId, targets] of targetMap) {
    for (const tId of targets) {
      if ((targetMap.get(tId) ?? []).includes(sId)) {
        const sN = sectionById.get(sId)?.number ?? 0
        const tN = sectionById.get(tId)?.number ?? 0
        const key = `${Math.min(sN, tN)}_${Math.max(sN, tN)}`
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key)
          issues.push({
            id: `cycle_${key}`,
            severity: 'narrative',
            type: 'cycle',
            sections: [Math.min(sN, tN), Math.max(sN, tN)],
            description: `§${sN} ↔ §${tN} : cycle réciproque — les deux sections se pointent mutuellement.`,
          })
        }
      }
    }
  }

  const order = { critical: 0, important: 1, narrative: 2 } as const
  issues.sort((a, b) => {
    const d = order[a.severity] - order[b.severity]
    return d !== 0 ? d : (a.sections[0] ?? 0) - (b.sections[0] ?? 0)
  })

  return NextResponse.json({ issues, total: issues.length })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { action, params: p } = await req.json()

  try {
    switch (action) {
      case 'delete_choice': {
        const { error } = await supabaseAdmin.from('choices').delete().eq('id', p.choice_id)
        if (error) throw error
        return NextResponse.json({ ok: true })
      }
      case 'fix_ending_type': {
        const { error } = await supabaseAdmin.from('sections').update({ ending_type: p.value }).eq('id', p.section_id).eq('book_id', id)
        if (error) throw error
        return NextResponse.json({ ok: true })
      }
      case 'fix_trial_type': {
        const { data: sec, error: e1 } = await supabaseAdmin.from('sections').select('trial').eq('id', p.section_id).single()
        if (e1) throw e1
        const { error } = await supabaseAdmin.from('sections').update({ trial: { ...(sec.trial as object ?? {}), type: p.value } }).eq('id', p.section_id)
        if (error) throw error
        return NextResponse.json({ ok: true })
      }
      case 'fix_choice_target': {
        const { data: tSec, error: e1 } = await supabaseAdmin.from('sections').select('id').eq('book_id', id).eq('number', Number(p.target_section_number)).single()
        if (e1 || !tSec) return NextResponse.json({ error: `Section §${p.target_section_number} introuvable` }, { status: 404 })
        const { error } = await supabaseAdmin.from('choices').update({ target_section_id: tSec.id }).eq('id', p.choice_id)
        if (error) throw error
        return NextResponse.json({ ok: true })
      }
      case 'add_trial_route': {
        const [{ data: s1, error: e1 }, { data: s2, error: e2 }] = await Promise.all([
          supabaseAdmin.from('sections').select('id').eq('book_id', id).eq('number', Number(p.success_number)).single(),
          supabaseAdmin.from('sections').select('id').eq('book_id', id).eq('number', Number(p.failure_number)).single(),
        ])
        if (e1 || !s1) return NextResponse.json({ error: `Section succès §${p.success_number} introuvable` }, { status: 404 })
        if (e2 || !s2) return NextResponse.json({ error: `Section échec §${p.failure_number} introuvable` }, { status: 404 })
        const { data: sec, error: e3 } = await supabaseAdmin.from('sections').select('trial').eq('id', p.section_id).single()
        if (e3) throw e3
        const { error } = await supabaseAdmin.from('sections').update({ trial: { ...(sec.trial as object ?? {}), success_section_id: s1.id, failure_section_id: s2.id } }).eq('id', p.section_id)
        if (error) throw error
        return NextResponse.json({ ok: true })
      }
      case 'set_trial_success': {
        const { data: s, error: e1 } = await supabaseAdmin.from('sections').select('id').eq('book_id', id).eq('number', Number(p.success_number)).single()
        if (e1 || !s) return NextResponse.json({ error: `Section §${p.success_number} introuvable` }, { status: 404 })
        const { data: sec, error: e2 } = await supabaseAdmin.from('sections').select('trial').eq('id', p.section_id).single()
        if (e2) throw e2
        const { error } = await supabaseAdmin.from('sections').update({ trial: { ...(sec.trial as object ?? {}), success_section_id: s.id } }).eq('id', p.section_id)
        if (error) throw error
        return NextResponse.json({ ok: true })
      }
      case 'set_trial_failure': {
        const { data: s, error: e1 } = await supabaseAdmin.from('sections').select('id').eq('book_id', id).eq('number', Number(p.failure_number)).single()
        if (e1 || !s) return NextResponse.json({ error: `Section §${p.failure_number} introuvable` }, { status: 404 })
        const { data: sec, error: e2 } = await supabaseAdmin.from('sections').select('trial').eq('id', p.section_id).single()
        if (e2) throw e2
        const { error } = await supabaseAdmin.from('sections').update({ trial: { ...(sec.trial as object ?? {}), failure_section_id: s.id } }).eq('id', p.section_id)
        if (error) throw error
        return NextResponse.json({ ok: true })
      }
      case 'add_choice': {
        const { data: tSec, error: e1 } = await supabaseAdmin.from('sections').select('id').eq('book_id', id).eq('number', Number(p.target_section_number)).single()
        if (e1 || !tSec) return NextResponse.json({ error: `Section §${p.target_section_number} introuvable` }, { status: 404 })
        const { data: existing } = await supabaseAdmin.from('choices').select('sort_order').eq('section_id', p.section_id).order('sort_order', { ascending: false }).limit(1)
        const nextOrder = ((existing?.[0]?.sort_order ?? -1) + 1)
        const { error } = await supabaseAdmin.from('choices').insert({ section_id: p.section_id, target_section_id: tSec.id, label: p.label || 'Continuer', requires_trial: false, sort_order: nextOrder, is_back: false })
        if (error) throw error
        return NextResponse.json({ ok: true })
      }
      default:
        return NextResponse.json({ error: `Action inconnue: ${action}` }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
