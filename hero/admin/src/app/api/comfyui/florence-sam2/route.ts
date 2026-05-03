import { NextRequest, NextResponse } from 'next/server'
import { isServerRunning, uploadUrlToComfyUI, queuePrompt, getHistory, getImage } from '@/lib/comfyui'
import { buildFlorenceSAM2Workflow } from '@/lib/comfyui-florence-sam2'
import { buildGroundedSAMWorkflow } from '@/lib/comfyui-grounded-sam'
import { createClient } from '@supabase/supabase-js'

/** Mots-clés relation spatiale — pour router chaque phrase ctpg vers le bon
 *  engine (DINO si nom seul, Florence RES si phrase avec relation). */
const RELATION_RE = /\b(on|on top of|under|underneath|behind|in front of|next to|beside|between|inside|outside|near|over|above|below|sur|dessus|dessous|sous|devant|derrière|à côté|près de|entre|dans)\b/i

export const maxDuration = 180

/**
 * POST /api/comfyui/florence-sam2
 *
 * Variante Florence-2 pour les requêtes complexes avec relations spatiales.
 *
 * Body : { image_url, prompt_text, model?: 'base'|'large', mode?: 'res'|'ctpg' }
 *
 * Modes :
 *   - 'res'  (default) : Referring Expression Segmentation. Une SEULE phrase
 *      relationnelle ("the cushions on the sofa") → mask du sujet désigné.
 *   - 'ctpg' : Multi-query. Le prompt est de la forme "phrase1. phrase2. ...",
 *      on split en N phrases et on lance Florence RES pour CHAQUE phrase
 *      séparément. Le client fait l'union des N masks via combineMasksMulti.
 *      Beaucoup plus robuste que CTPG natif sur objets imbriqués (cushions
 *      dans sofa) où Florence retourne souvent la même bbox pour les deux.
 *
 * Réponse :
 *   - mode='res'  : { mask_url, prompt_text, engine: 'florence-2-res' }
 *   - mode='ctpg' : { mask_urls: string[], prompts: string[], engine: 'florence-2-ctpg-multi' }
 *                   Le client doit unionner les N masks (combineMasksMulti).
 */
export async function POST(req: NextRequest) {
  try {
    const { image_url, prompt_text, model, mode = 'res' } = await req.json() as {
      image_url: string
      prompt_text: string
      model?: 'base' | 'large'
      mode?: 'res' | 'ctpg'
    }
    const florence_model = model ?? 'base'

    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })
    if (!prompt_text || !prompt_text.trim()) {
      return NextResponse.json({ error: 'prompt_text requis' }, { status: 400 })
    }

    if (!(await isServerRunning())) {
      return NextResponse.json({ error: 'ComfyUI n\'est pas démarré.' }, { status: 503 })
    }

    // Upload image source UNE SEULE FOIS, réutilisée par toutes les sub-queries
    const imageFilename = await uploadUrlToComfyUI(image_url, `florence_${Date.now()}`)

    // Mode RES (single query)
    if (mode === 'res') {
      const maskUrl = await runFlorenceRES(imageFilename, prompt_text.trim(), florence_model)
      if (!maskUrl) {
        return NextResponse.json({
          error: 'not_found',
          message: `Florence-2 RES n'a rien trouvé pour : "${prompt_text.trim()}".`,
        }, { status: 422 })
      }
      return NextResponse.json({
        mask_url: maskUrl,
        prompt_text: prompt_text.trim(),
        engine: 'florence-2-res',
      })
    }

    // Mode CTPG = multi-query : split en N phrases et appel Florence RES pour chacune
    const phrases = prompt_text
      .split(/\.\s+|\.$/)        // split sur ". " ou point final
      .map(p => p.trim())
      .filter(p => p.length > 0)

    if (phrases.length === 0) {
      return NextResponse.json({ error: 'Aucune phrase parsée depuis prompt_text' }, { status: 400 })
    }

    // Routing par phrase : Florence RES n'est bon que sur expressions référentielles
    // ("the cushions on the sofa"). Pour les noms seuls ("sofa"), DINO est plus
    // précis. On route chaque phrase vers le bon engine.
    const results: Array<{ phrase: string; mask_url: string | null; engine: string }> = []
    for (const phrase of phrases) {
      const useFlorence = RELATION_RE.test(phrase)
      try {
        const maskUrl = useFlorence
          ? await runFlorenceRES(imageFilename, phrase, florence_model)
          : await runGroundedSAM(imageFilename, phrase)
        results.push({ phrase, mask_url: maskUrl, engine: useFlorence ? 'florence-res' : 'dino' })
      } catch (err) {
        console.error(`[florence-sam2 ctpg] phrase "${phrase}" failed:`, err)
        results.push({ phrase, mask_url: null, engine: useFlorence ? 'florence-res' : 'dino' })
      }
    }

    const successful = results.filter(r => r.mask_url)
    if (successful.length === 0) {
      return NextResponse.json({
        error: 'not_found',
        message: `Aucune phrase trouvée parmi : ${phrases.join(' / ')}`,
      }, { status: 422 })
    }

    return NextResponse.json({
      mask_urls: successful.map(r => r.mask_url),
      prompts: successful.map(r => r.phrase),
      missing: results.filter(r => !r.mask_url).map(r => r.phrase),
      engine: 'florence-2-ctpg-multi',
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[comfyui/florence-sam2] error:', msg)
    const isMissingNode = /missing_node_type|unknown node|custom node may not be installed/i.test(msg)
    if (isMissingNode) return NextResponse.json({ error: installInstructions() }, { status: 501 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * Run Florence-2 RES + SaveImage workflow pour UNE phrase. Retourne l'URL
 * Supabase du PNG mask, ou null si Florence n'a rien trouvé (mask vide).
 * Throw en cas d'erreur ComfyUI fatale (workflow rejected, timeout, etc.).
 */
async function runFlorenceRES(
  imageFilename: string,
  phrase: string,
  florence_model: 'base' | 'large',
): Promise<string | null> {
  const workflow = buildFlorenceSAM2Workflow({
    image_filename: imageFilename,
    prompt_text: phrase,
    florence_model,
    mode: 'res',
  })
  const result = await queuePrompt(workflow)
  if (result.node_errors && Object.keys(result.node_errors).length > 0) {
    const errStr = JSON.stringify(result.node_errors)
    throw new Error(`Workflow Florence RES rejeté : ${errStr.slice(0, 400)}`)
  }

  // Poll
  const startT = Date.now()
  const MAX_WAIT = 90 * 1000
  let imageInfo: { filename: string; subfolder: string; type: string } | null = null
  while (Date.now() - startT < MAX_WAIT) {
    await new Promise(r => setTimeout(r, 1500))
    const history = await getHistory(result.prompt_id)
    if (!history) continue
    if (history.status.completed) {
      for (const output of Object.values(history.outputs)) {
        if (output.images && output.images.length > 0) {
          imageInfo = output.images[0]
          break
        }
      }
      break
    }
    if (history.status.status_str === 'error') {
      const messages = (history.status as unknown as { messages?: unknown[] }).messages ?? []
      const errorDetails = messages
        .filter(m => Array.isArray(m) && (m[0] === 'execution_error' || m[0] === 'execution_interrupted'))
        .map(m => JSON.stringify(m))
        .join(' | ')
        .slice(0, 400)
      throw new Error(`Florence RES execution error : ${errorDetails || 'unknown'}`)
    }
  }
  if (!imageInfo) throw new Error(`Timeout Florence RES (${MAX_WAIT/1000}s) pour phrase "${phrase}"`)

  // Récupère le PNG + check non-vide (mask noir entier compresse < 1KB)
  const maskBuffer = await getImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type)
  if (maskBuffer.length < 800) return null

  // Upload Supabase
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const safe = phrase.replace(/[^a-z0-9]/gi, '_').slice(0, 30)
  const storagePath = `temp/florence_res_${safe}_${Date.now()}.png`
  const { error: upErr } = await supabase.storage.from('images').upload(storagePath, maskBuffer, {
    contentType: 'image/png',
    upsert: true,
  })
  if (upErr) throw new Error(`Upload mask Supabase échoué : ${upErr.message}`)

  const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath)
  return publicUrl
}

/**
 * Variant de runFlorenceRES qui appelle le workflow Grounded-SAM (DINO + SAM 1).
 * Utilisé en multi-query CTPG quand une phrase est un nom seul ("sofa"),
 * cas où Florence RES marche moins bien que DINO.
 */
async function runGroundedSAM(imageFilename: string, phrase: string): Promise<string | null> {
  const workflow = buildGroundedSAMWorkflow({
    image_filename: imageFilename,
    prompt_text: phrase,
    threshold: 0.30,
  })
  const result = await queuePrompt(workflow)
  if (result.node_errors && Object.keys(result.node_errors).length > 0) {
    const errStr = JSON.stringify(result.node_errors)
    throw new Error(`Workflow Grounded-SAM rejeté : ${errStr.slice(0, 400)}`)
  }
  const startT = Date.now()
  const MAX_WAIT = 90 * 1000
  let imageInfo: { filename: string; subfolder: string; type: string } | null = null
  while (Date.now() - startT < MAX_WAIT) {
    await new Promise(r => setTimeout(r, 1500))
    const history = await getHistory(result.prompt_id)
    if (!history) continue
    if (history.status.completed) {
      for (const output of Object.values(history.outputs)) {
        if (output.images && output.images.length > 0) {
          imageInfo = output.images[0]
          break
        }
      }
      break
    }
    if (history.status.status_str === 'error') {
      throw new Error('Grounded-SAM execution error')
    }
  }
  if (!imageInfo) throw new Error(`Timeout Grounded-SAM pour "${phrase}"`)

  const maskBuffer = await getImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type)
  if (maskBuffer.length < 800) return null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const safe = phrase.replace(/[^a-z0-9]/gi, '_').slice(0, 30)
  const storagePath = `temp/dino_${safe}_${Date.now()}.png`
  const { error: upErr } = await supabase.storage.from('images').upload(storagePath, maskBuffer, {
    contentType: 'image/png',
    upsert: true,
  })
  if (upErr) throw new Error(`Upload Supabase échoué : ${upErr.message}`)
  const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath)
  return publicUrl
}

function installInstructions(): string {
  return [
    'Nodes ComfyUI-Florence2 non installés.',
    '',
    'Installation :',
    '  cd ComfyUI/custom_nodes',
    '  git clone https://github.com/kijai/ComfyUI-Florence2',
    '  cd ComfyUI-Florence2',
    '  ../../venv/Scripts/python.exe -m pip install -r requirements.txt',
    '',
    'Puis redémarre ComfyUI.',
  ].join('\n')
}
