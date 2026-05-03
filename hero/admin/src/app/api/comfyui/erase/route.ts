import { NextRequest, NextResponse } from 'next/server'
import { isServerRunning, uploadUrlToComfyUI, queuePrompt, getHistory, getImage, freeComfyVram } from '@/lib/comfyui'
import { buildEraseWorkflow } from '@/lib/comfyui-erase'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120

/**
 * POST /api/comfyui/erase
 *
 * Efface une zone d'une image via LAMA (grand modèle d'inpainting dédié à la
 * suppression d'objet, zéro hallucination de persos). Ni diffusion ni prompt :
 *   (image + mask blanc-noir) → image sans l'objet.
 *
 * Body : {
 *   image_url: string,    // source (URL publique)
 *   mask_url: string,     // mask (blanc = effacer, noir = garder)
 *   storage_path: string, // chemin Supabase pour sauver le résultat
 *   inpaint_model?: string // défaut : big-lama.pt
 * }
 *
 * Pré-requis ComfyUI :
 *   - comfyui-inpaint-nodes (Acly)
 *   - models/inpaint/big-lama.pt
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      image_url: string
      mask_url: string
      storage_path: string
      inpaint_model?: string
    }
    if (!body.image_url || !body.mask_url || !body.storage_path) {
      return NextResponse.json({ error: 'image_url, mask_url et storage_path requis' }, { status: 400 })
    }

    if (!(await isServerRunning())) {
      return NextResponse.json({ error: 'ComfyUI n\'est pas démarré.' }, { status: 503 })
    }

    // 1. Upload image + mask dans ComfyUI input
    const imgFilename = await uploadUrlToComfyUI(body.image_url, 'erase_src')
    const maskFilename = await uploadUrlToComfyUI(body.mask_url, 'erase_mask')

    // 2. Build + queue
    const workflow = buildEraseWorkflow({
      source_filename: imgFilename,
      mask_filename: maskFilename,
      inpaint_model: body.inpaint_model,
    })
    const result = await queuePrompt(workflow)
    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      const detailsStr = JSON.stringify(result.node_errors)
      if (detailsStr.includes('INPAINT_LoadInpaintModel') || detailsStr.includes('INPAINT_InpaintWithModel')) {
        return NextResponse.json({
          error: 'Custom node "comfyui-inpaint-nodes" non installé. Clone https://github.com/Acly/comfyui-inpaint-nodes dans ComfyUI/custom_nodes puis redémarre.',
          details: result.node_errors,
        }, { status: 501 })
      }
      if (detailsStr.includes('InpaintCropImproved') || detailsStr.includes('InpaintStitchImproved')) {
        return NextResponse.json({
          error: 'Custom node "ComfyUI-Inpaint-CropAndStitch" non installé. Clone https://github.com/lquesada/ComfyUI-InpaintCropAndStitch dans ComfyUI/custom_nodes puis redémarre.',
          details: result.node_errors,
        }, { status: 501 })
      }
      if (detailsStr.includes('big-lama')) {
        return NextResponse.json({
          error: 'Modèle big-lama.pt manquant dans ComfyUI/models/inpaint/. Télécharge-le depuis https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt',
          details: result.node_errors,
        }, { status: 501 })
      }
      return NextResponse.json({ error: 'Workflow erase rejeté', details: result.node_errors }, { status: 500 })
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
        return NextResponse.json({ error: 'ComfyUI a renvoyé une erreur pendant erase' }, { status: 500 })
      }
    }
    if (!imageInfo) return NextResponse.json({ error: 'Timeout erase (2 min)' }, { status: 504 })

    // 4. Téléchargement + upload Supabase
    const buffer = await getImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const fullPath = `${body.storage_path}.png`
    const { error: upErr } = await supabase.storage.from('images').upload(fullPath, buffer, {
      contentType: 'image/png',
      upsert: true,
    })
    if (upErr) throw new Error(`Upload Supabase échoué : ${upErr.message}`)

    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fullPath)
    void freeComfyVram()
    return NextResponse.json({ image_url: publicUrl })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[comfyui/erase] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
