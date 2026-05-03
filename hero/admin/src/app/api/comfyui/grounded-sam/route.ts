import { NextRequest, NextResponse } from 'next/server'
import { isServerRunning, uploadUrlToComfyUI, queuePrompt, getHistory, getImage } from '@/lib/comfyui'
import { buildGroundedSAMWorkflow } from '@/lib/comfyui-grounded-sam'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120

/**
 * POST /api/comfyui/grounded-sam
 *
 * Body : { image_url: string, prompt_text: string, threshold?: number }
 *   - image_url   : URL publique de l'image à analyser
 *   - prompt_text : texte EN pour GroundingDINO ("sofa", "red car", "person")
 *   - threshold   : confiance min (0-1, default 0.30)
 *
 * Pipeline :
 *   1. Upload image dans ComfyUI input
 *   2. Workflow Grounded-SAM (DINO + SAM 2 combinés)
 *   3. Récupère le PNG mask (binaire, blanc = zones détectées)
 *   4. Upload Supabase
 *   5. Renvoie { mask_url } — V1 = un seul mask agrégé pour tous les matches
 *
 * Erreurs gérées :
 *   - 503 ComfyUI down
 *   - 501 Nodes GroundingDINO non installés (avec instructions)
 *   - 504 Timeout SAM
 *   - 422 Aucun objet trouvé (DINO retourne mask vide)
 *
 * Note V1 : la sortie est un mask UNIQUE qui combine toutes les détections.
 *   Pour différencier les bboxes individuelles ("3 canapés détectés"), il
 *   faudra un workflow custom qui expose les bboxes — V2.
 */
export async function POST(req: NextRequest) {
  try {
    const { image_url, prompt_text, threshold = 0.30 } = await req.json() as {
      image_url: string; prompt_text: string; threshold?: number
    }

    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })
    if (!prompt_text || !prompt_text.trim()) {
      return NextResponse.json({ error: 'prompt_text requis (texte en anglais pour GroundingDINO)' }, { status: 400 })
    }

    if (!(await isServerRunning())) {
      return NextResponse.json({ error: 'ComfyUI n\'est pas démarré. Lancez-le puis réessayez.' }, { status: 503 })
    }

    // 1. Upload image source
    const imageFilename = await uploadUrlToComfyUI(image_url, `grounded_sam_${Date.now()}`)

    // 2. Build + queue workflow
    const workflow = buildGroundedSAMWorkflow({
      image_filename: imageFilename,
      prompt_text: prompt_text.trim(),
      threshold,
    })
    const result = await queuePrompt(workflow)

    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      const errStr = JSON.stringify(result.node_errors)
      const isMissingNode = /unknown node|NodeClass|not found|missing|GroundingDino/i.test(errStr)
      return NextResponse.json({
        error: isMissingNode
          ? installInstructions()
          : 'Workflow Grounded-SAM rejeté par ComfyUI',
        details: result.node_errors,
      }, { status: 501 })
    }

    // 3. Poll
    const startT = Date.now()
    const MAX_WAIT = 2 * 60 * 1000
    let imageInfo: { filename: string; subfolder: string; type: string } | null = null
    while (Date.now() - startT < MAX_WAIT) {
      await new Promise(r => setTimeout(r, 2000))
      const history = await getHistory(result.prompt_id)
      if (!history) continue
      if (history.status.completed) {
        for (const output of Object.values(history.outputs)) {
          if (output.images && output.images.length > 0) { imageInfo = output.images[0]; break }
        }
        break
      }
      if (history.status.status_str === 'error') {
        const messages = (history.status as unknown as { messages?: unknown[] }).messages ?? []
        const errorDetails = messages
          .filter(m => Array.isArray(m) && (m[0] === 'execution_error' || m[0] === 'execution_interrupted'))
          .map(m => JSON.stringify(m))
          .join(' | ')
          .slice(0, 600)
        return NextResponse.json({
          error: `ComfyUI a renvoyé une erreur Grounded-SAM${errorDetails ? ' : ' + errorDetails : ''}`,
        }, { status: 500 })
      }
    }
    if (!imageInfo) return NextResponse.json({ error: 'Timeout Grounded-SAM (2 min)' }, { status: 504 })

    // 4. Récupère le PNG + check qu'il n'est pas vide (= rien trouvé)
    const maskBuffer = await getImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type)

    // Heuristique simple : si le PNG est très petit (< 1KB), DINO n'a probablement
    // rien trouvé (mask noir entier compresse beaucoup). Plus robuste = check
    // pixels mais ça nécessite un decoder PNG côté serveur.
    if (maskBuffer.length < 800) {
      return NextResponse.json({
        error: 'not_found',
        message: `Aucun "${prompt_text.trim()}" détecté dans l'image. Essaie un terme plus générique.`,
      }, { status: 422 })
    }

    // 5. Upload Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const storagePath = `temp/grounded_sam_mask_${Date.now()}.png`
    const { error: upErr } = await supabase.storage.from('images').upload(storagePath, maskBuffer, {
      contentType: 'image/png',
      upsert: true,
    })
    if (upErr) throw new Error(`Upload mask Supabase échoué : ${upErr.message}`)

    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath)
    return NextResponse.json({
      mask_url: publicUrl,
      prompt_text: prompt_text.trim(),
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[comfyui/grounded-sam] error:', msg)
    const isMissingNode = /missing_node_type|not found|unknown node|GroundingDino|custom node may not be installed/i.test(msg)
    if (isMissingNode) {
      return NextResponse.json({ error: installInstructions() }, { status: 501 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function installInstructions(): string {
  return [
    'Nodes GroundingDINO non installés côté ComfyUI.',
    '',
    'Installation :',
    '  cd ComfyUI/custom_nodes',
    '  git clone https://github.com/storyicon/comfyui_segment_anything',
    '  pip install -r comfyui_segment_anything/requirements.txt',
    '',
    'Puis redémarre ComfyUI. Les modèles GroundingDINO + SAM seront',
    'téléchargés automatiquement au 1er run depuis HuggingFace (~3GB total).',
  ].join('\n')
}
