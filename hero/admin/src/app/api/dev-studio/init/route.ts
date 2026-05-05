import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import testScenesData from '@/data/test-scenes.json'
import type { SectionImage } from '@/types'

export const maxDuration = 30

/**
 * POST /api/dev-studio/init
 *
 * Idempotent. Initialise le book "Dev-Studio" en Supabase si pas existant :
 *   - 1 book "Dev-Studio" (titre exact comme clé d'unicité)
 *   - 4 sections thématiques
 *   - Chaque section a 3 plans pré-remplis avec les 12 prompts de
 *     test-scenes.json (intent : ouvrir le book Dev-Studio = avoir
 *     immédiatement 12 plans avec prompts prêts à générer).
 *
 * Si le book existe déjà → retourne juste son ID + ses 4 sections.
 *
 * Pas de transaction stricte : si le crash arrive entre book et sections,
 * on aurait un book orphelin. Acceptable V1 (env dev, on peut clean à la
 * main). À durcir si besoin V2 avec une RPC Postgres.
 *
 * Retour : { bookId, sections: [{ id, number, name, plans: [...] }] }
 */

const BOOK_TITLE = 'Dev-Studio'

const SECTION_DEFS: Array<{ name: string; planSceneIds: string[] }> = [
  { name: 'Extérieurs',           planSceneIds: ['ext_city_day', 'ext_city_night', 'ext_forest_night'] },
  { name: 'Salons modernes',      planSceneIds: ['int_victorian_parlor', 'int_living_bay_day', 'int_living_bay_night'] },
  { name: 'Aventure',             planSceneIds: ['ext_countryside_day', 'ext_desert_dusk', 'int_dungeon'] },
  { name: 'Univers spécifiques',  planSceneIds: ['int_medieval_tavern', 'int_detective_office', 'int_scifi_cockpit'] },
]

interface TestScene {
  id: string
  name: string
  prompt: string
  negative: string
  usage?: string[]
}

/** Construit un SectionImage placeholder à partir d'une test scene mock. */
function buildPlanFromTestScene(scene: TestScene): SectionImage {
  return {
    url: undefined,  // pas d'image générée encore
    description: scene.name,
    prompt_fr: scene.name,
    prompt_en: scene.prompt,
    kind: 'image',  // défaut, l'auteur pourra basculer en animation après
    tags: {
      kind: 'image',
      sections: [],  // sera rempli au save par auto-tag (cf POST /sections/[id]/plans)
      effects: [],
      characters: [],
      objects: [],
      manual_overrides: [],
    },
    comfyui_settings: {
      negative: scene.negative,
    },
  }
}

export async function POST() {
  try {
    // ── 1. Cherche le book existant par titre ─────────────────────────────
    // .limit(1) au lieu de .maybeSingle() : en V1 dev, des doublons peuvent
    // exister si l'init a été appelé en race condition (pas de UNIQUE
    // constraint sur books.title). On prend le 1er trouvé + warn.
    const { data: existingList, error: findErr } = await supabaseAdmin
      .from('books')
      .select('id, created_at')
      .eq('title', BOOK_TITLE)
      .order('created_at', { ascending: true })
      .limit(10)

    if (findErr) throw new Error(`books fetch: ${findErr.message}`)

    let bookId: string

    if (existingList && existingList.length > 0) {
      bookId = existingList[0].id
      if (existingList.length > 1) {
        console.warn(
          `[dev-studio/init] ${existingList.length} books "Dev-Studio" trouvés en DB ` +
          `(race condition passée). On utilise le plus ancien : ${bookId}. ` +
          `Pour cleanup, supprime manuellement les autres dans Supabase ` +
          `(IDs : ${existingList.slice(1).map(b => b.id).join(', ')})`
        )
      } else {
        console.log('[dev-studio/init] book existant réutilisé:', bookId)
      }
    } else {
      // ── 2a. Création du book (champs minimum requis par schema 001) ────
      const { data: created, error: createErr } = await supabaseAdmin
        .from('books')
        .insert({
          title: BOOK_TITLE,
          theme: 'Studio Designer Workspace (dev)',
          age_range: '18+',
          context_type: 'dev_workspace',
          language: 'fr',
          status: 'draft',
          description: 'Book de dev pour le Studio Designer. 4 sections × 3 plans pré-remplis avec les prompts test-scenes.',
        })
        .select('id')
        .single()

      if (createErr || !created) throw new Error(`book create: ${createErr?.message ?? 'unknown'}`)
      bookId = created.id
      console.log('[dev-studio/init] book créé:', bookId)
    }

    // ── 3. Récupère les sections existantes du book ───────────────────────
    const { data: existingSections, error: secErr } = await supabaseAdmin
      .from('sections')
      .select('id, number, content, summary, images')
      .eq('book_id', bookId)
      .order('number', { ascending: true })

    if (secErr) throw new Error(`sections fetch: ${secErr.message}`)

    const sectionsToReturn: Array<{ id: string; number: number; name: string; plans: SectionImage[] }> = []

    // ── 4. Pour chaque section attendue (1..4), upsert si manquante ──────
    const scenesById = new Map<string, TestScene>(
      (testScenesData.scenes as TestScene[]).map(s => [s.id, s])
    )

    for (let i = 0; i < SECTION_DEFS.length; i++) {
      const def = SECTION_DEFS[i]
      const number = i + 1
      const existing = existingSections?.find(s => s.number === number)

      // Build les plans à partir des test scenes mappées
      const expectedPlans = def.planSceneIds.map(sid => {
        const scene = scenesById.get(sid)
        if (!scene) {
          console.warn('[dev-studio/init] test scene introuvable:', sid)
          return { url: undefined, description: sid } as SectionImage
        }
        return buildPlanFromTestScene(scene)
      })

      if (existing) {
        // Si la section existe MAIS sans plans (images vide), on les pré-remplit.
        // Si elle a déjà des plans, on respecte l'état (l'auteur a peut-être bossé dessus).
        const currentImages = (existing.images as SectionImage[] | null) ?? []
        if (currentImages.length === 0) {
          const { error: upErr } = await supabaseAdmin
            .from('sections')
            .update({ images: expectedPlans })
            .eq('id', existing.id)
          if (upErr) console.warn('[dev-studio/init] section update plans failed:', upErr.message)
        }
        sectionsToReturn.push({
          id: existing.id,
          number,
          name: def.name,
          plans: currentImages.length > 0 ? currentImages : expectedPlans,
        })
      } else {
        // Section pas encore créée → insert
        const { data: newSec, error: insErr } = await supabaseAdmin
          .from('sections')
          .insert({
            book_id: bookId,
            number,
            content: `[Dev workspace] ${def.name}`,
            summary: def.name,
            is_ending: false,
            status: 'draft',
            images: expectedPlans,
          })
          .select('id')
          .single()

        if (insErr || !newSec) {
          console.error('[dev-studio/init] section insert failed:', insErr?.message)
          continue
        }
        sectionsToReturn.push({
          id: newSec.id,
          number,
          name: def.name,
          plans: expectedPlans,
        })
        console.log(`[dev-studio/init] section ${number} (${def.name}) créée:`, newSec.id)
      }
    }

    return NextResponse.json({
      bookId,
      bookTitle: BOOK_TITLE,
      sections: sectionsToReturn,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[dev-studio/init]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
