import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readFile } from 'fs/promises'
import path from 'path'

/**
 * POST /api/books/import-duke-duo
 *
 * One-shot dev : importe le livre Duke Duo (113 sections) depuis le fichier
 * `hero/duke_duo_livre1_sections.json` (relatif à la racine repo).
 *
 * Body optionnel : { force?: boolean } — si true, supprime le livre existant
 * avant de réimporter (cascade vers sections/choices/items/npcs). Sans force,
 * idempotent (si livre existe → retourne son id sans toucher).
 *
 * Mapping :
 *  - json.titre        → books.title
 *  - json.introduction → books.description (tronqué 500 chars)
 *  - tronc_commun[]    → sections renumérotées 1..N (preserve l'id original
 *                        dans `sections.summary` pour traçabilité)
 *  - section.choix[]   → choices, target résolu via map id_original → number
 *  - section.objets[]  → items dédupliqués par nom (case-insensitive),
 *                        sections_used = array des section ids où l'objet apparaît
 *  - section.npcs[]    → npcs dédupliqués par nom (case-insensitive),
 *                        type='neutre' par défaut (à affiner par l'auteur ensuite)
 */

interface DukeJsonChoice {
  label: string
  cible: string | null
  epreuve: unknown
}
interface DukeJsonSection {
  id: string
  type: string
  lieu: string
  npcs: string[]
  objets: string[]
  resume: string
  notes_dev: string
  choix: DukeJsonChoice[]
}
interface DukeJson {
  titre: string
  introduction: string
  tronc_commun: DukeJsonSection[]
}

export async function POST(req: NextRequest) {
  try {
    // 0. Parse body pour le flag force (optionnel).
    let force = false
    try {
      const body = await req.json() as { force?: boolean } | undefined
      force = !!body?.force
    } catch {
      // Pas de body, défaut force=false.
    }

    // 1. Lecture du JSON depuis le disque (Next.js cwd = admin/, fichier à
    //    la racine du repo Hero).
    const jsonPath = path.join(process.cwd(), '..', 'duke_duo_livre1_sections.json')
    let raw: string
    try {
      raw = await readFile(jsonPath, 'utf-8')
    } catch (err) {
      return NextResponse.json(
        { error: `Fichier introuvable : ${jsonPath}`, detail: String(err) },
        { status: 404 },
      )
    }
    const data = JSON.parse(raw) as DukeJson
    const sections = data.tronc_commun
    if (!Array.isArray(sections) || sections.length === 0) {
      return NextResponse.json({ error: 'JSON invalide : tronc_commun vide ou manquant' }, { status: 400 })
    }

    // 2. Gestion existant : si livre avec ce titre existe et !force → retour
    //    sans toucher. Si force=true → DELETE en cascade (book → sections →
    //    choices → items → npcs grâce aux ON DELETE CASCADE).
    const { data: existing } = await supabaseAdmin
      .from('books')
      .select('id, title')
      .eq('title', data.titre)
      .maybeSingle()
    if (existing) {
      if (!force) {
        return NextResponse.json({
          already_exists: true,
          book_id: existing.id,
          title: existing.title,
          message: 'Livre déjà importé. Passe { force: true } dans le body pour wiper et réimporter.',
        })
      }
      // Force : delete cascade
      const { error: delErr } = await supabaseAdmin.from('books').delete().eq('id', existing.id)
      if (delErr) throw new Error(`delete existing book failed: ${delErr.message}`)
    }

    // 3. Création du livre. Champs requis (CHECK constraints) :
    //    age_range ∈ ('8-12','13-17','18+'), context_type, theme, language.
    //    Duke Duo = sci-fi noir adulte → 18+.
    const { data: book, error: bookErr } = await supabaseAdmin
      .from('books')
      .insert({
        title: data.titre,
        theme: 'Sci-fi détective (Duke Duo)',
        age_range: '18+',
        context_type: 'Sci-Fi',
        language: 'fr',
        status: 'draft',
        description: (data.introduction ?? '').slice(0, 500),
      })
      .select()
      .single()
    if (bookErr || !book) throw new Error(`book insert failed: ${bookErr?.message}`)

    // 4. Construire le mapping originalId (§10A) → number séquentiel (12).
    //    L'ordre du JSON est respecté.
    const idToNumber = new Map<string, number>()
    sections.forEach((s, i) => idToNumber.set(s.id, i + 1))

    // 5. Insert sections en batch. content = resume (+ notes_dev en bloc HR
    //    si présent). summary = trace de l'id original + métadonnées.
    const sectionsPayload = sections.map((s, i) => {
      const number = i + 1
      const npcs = s.npcs.length > 0 ? `\n\n**Persos présents :** ${s.npcs.join(', ')}` : ''
      const objets = s.objets.length > 0 ? `\n\n**Objets :** ${s.objets.join(', ')}` : ''
      const notes = s.notes_dev ? `\n\n---\n\n*Notes auteur : ${s.notes_dev}*` : ''
      return {
        book_id: book.id,
        number,
        content: `${s.resume}${npcs}${objets}${notes}`,
        summary: `[Original ${s.id}] ${s.type} — ${s.lieu}`,
      }
    })
    const { data: insertedSections, error: secErr } = await supabaseAdmin
      .from('sections')
      .insert(sectionsPayload)
      .select('id, number')
    if (secErr || !insertedSections) throw new Error(`sections insert failed: ${secErr?.message}`)

    // Map number → uuid pour résoudre les target_section_id des choix.
    const numberToUuid = new Map<number, string>()
    insertedSections.forEach(row => numberToUuid.set(row.number, row.id))

    // 6. Insert choices en batch. Résout target_section_id via le double
    //    mapping (cible "§10A" → number → uuid). Les cibles introuvables
    //    deviennent target_section_id=null + warning.
    const choicesPayload: {
      section_id: string
      label: string
      target_section_id: string | null
      sort_order: number
    }[] = []
    const warnings: string[] = []
    sections.forEach((s, i) => {
      const sectionUuid = numberToUuid.get(i + 1)!
      s.choix.forEach((c, j) => {
        let targetUuid: string | null = null
        if (c.cible) {
          const targetNumber = idToNumber.get(c.cible)
          if (targetNumber == null) {
            warnings.push(`Section ${s.id} : choix "${c.label.slice(0, 30)}…" pointe vers ${c.cible} introuvable`)
          } else {
            targetUuid = numberToUuid.get(targetNumber) ?? null
          }
        }
        choicesPayload.push({
          section_id: sectionUuid,
          label: c.label,
          target_section_id: targetUuid,
          sort_order: j,
        })
      })
    })
    let choicesCreated = 0
    if (choicesPayload.length > 0) {
      // Supabase a une limite ~1000 rows par insert. Duke Duo a probablement
      // ~200-400 choix max, donc ça passe. Si on dépasse, batch par 500.
      const { data: insertedChoices, error: chErr } = await supabaseAdmin
        .from('choices')
        .insert(choicesPayload)
        .select('id')
      if (chErr) throw new Error(`choices insert failed: ${chErr.message}`)
      choicesCreated = insertedChoices?.length ?? 0
    }

    // 7. Items : déduplique les `objets[]` de toutes les sections par nom
    //    (case-insensitive trim), 1 entrée items par nom unique avec
    //    sections_used = array de tous les section_ids où il apparaît.
    const itemMap = new Map<string, { name: string; sections_used: string[] }>()
    sections.forEach((s, i) => {
      const sectionUuid = numberToUuid.get(i + 1)!
      ;(s.objets ?? []).forEach(rawName => {
        const name = (rawName ?? '').trim()
        if (!name) return
        const key = name.toLowerCase()
        const existing = itemMap.get(key)
        if (existing) {
          if (!existing.sections_used.includes(sectionUuid)) existing.sections_used.push(sectionUuid)
        } else {
          itemMap.set(key, { name, sections_used: [sectionUuid] })
        }
      })
    })
    const itemsPayload = Array.from(itemMap.values()).map(it => ({
      book_id: book.id,
      name: it.name,
      item_type: 'outil' as const,  // défaut, l'auteur affinera dans la fiche
      sections_used: it.sections_used,
      effect: {},
    }))
    let itemsCreated = 0
    if (itemsPayload.length > 0) {
      const { data: insertedItems, error: itErr } = await supabaseAdmin
        .from('items')
        .insert(itemsPayload)
        .select('id')
      if (itErr) throw new Error(`items insert failed: ${itErr.message}`)
      itemsCreated = insertedItems?.length ?? 0
    }

    // 8. NPCs : déduplique les `npcs[]` de toutes les sections par nom
    //    (case-insensitive trim), 1 entrée npcs par nom unique. Pas de
    //    sections_used sur npcs (table sans ce champ V1) — l'auteur peut
    //    ajouter les portraits/stats ensuite.
    const npcSet = new Set<string>()
    const npcsList: string[] = []
    sections.forEach(s => {
      ;(s.npcs ?? []).forEach(rawName => {
        const name = (rawName ?? '').trim()
        if (!name) return
        const key = name.toLowerCase()
        if (!npcSet.has(key)) {
          npcSet.add(key)
          npcsList.push(name)
        }
      })
    })
    const npcsPayload = npcsList.map(name => ({
      book_id: book.id,
      name,
      type: 'neutre' as const,  // défaut, l'auteur affinera (ennemi/boss/allié)
    }))
    let npcsCreated = 0
    if (npcsPayload.length > 0) {
      const { data: insertedNpcs, error: npErr } = await supabaseAdmin
        .from('npcs')
        .insert(npcsPayload)
        .select('id')
      if (npErr) throw new Error(`npcs insert failed: ${npErr.message}`)
      npcsCreated = insertedNpcs?.length ?? 0
    }

    return NextResponse.json({
      success: true,
      book_id: book.id,
      title: book.title,
      stats: {
        sections_created: insertedSections.length,
        choices_created: choicesCreated,
        items_created: itemsCreated,
        npcs_created: npcsCreated,
        unresolved_targets: warnings.length,
      },
      warnings: warnings.slice(0, 20),  // tronqué pour pas saturer
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/books/import-duke-duo POST]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
