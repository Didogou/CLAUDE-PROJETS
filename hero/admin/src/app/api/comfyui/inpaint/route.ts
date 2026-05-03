import { NextRequest, NextResponse } from 'next/server'
import { isServerRunning, uploadUrlToComfyUI, queuePrompt, getHistory, getImage, generateMaskPng, uploadImageToComfyUI, freeComfyVram } from '@/lib/comfyui'
import { buildInpaintWorkflow } from '@/lib/comfyui-inpaint'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 180

/**
 * POST /api/comfyui/inpaint
 *
 * Body : {
 *   image_url: string,        // image source (URL Supabase ou autre)
 *   mask_url: string,         // mask blanc/noir (URL Supabase)
 *   checkpoint: string,       // filename SDXL
 *   prompt_positive: string,
 *   prompt_negative?: string,
 *   storage_path: string,     // chemin Supabase de stockage du résultat
 *   steps?: number, cfg?: number, denoise?: number,
 * }
 *
 * Upload image + mask dans ComfyUI input, lance workflow inpaint, poll,
 * récupère le résultat et upload dans Supabase. Renvoie { image_url }.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      image_url: string
      mask_url: string
      checkpoint: string
      prompt_positive: string
      prompt_negative?: string
      storage_path: string
      steps?: number
      cfg?: number
      denoise?: number
      /** Persos à injecter via FaceID dans la zone inpainted (bake de scène). */
      characters?: Array<{ portraitUrl: string; weight?: number; name?: string }>
      /** Référence de style/ambiance via IPAdapter classique.
       *  - `style_reference_url` null/absent → défaut : utilise image_url comme ref (self).
       *    → "off" si explicitement false pour désactiver.
       *  - `style_reference_weight` défaut 0.6. */
      style_reference_url?: string | null | false
      style_reference_weight?: number
    }
    if (!body.image_url || !body.mask_url || !body.checkpoint || !body.prompt_positive || !body.storage_path) {
      return NextResponse.json({ error: 'image_url, mask_url, checkpoint, prompt_positive et storage_path requis' }, { status: 400 })
    }

    if (!(await isServerRunning())) {
      return NextResponse.json({ error: 'ComfyUI n\'est pas démarré.' }, { status: 503 })
    }

    // 1. Upload image + mask dans ComfyUI input
    const imgFilename = await uploadUrlToComfyUI(body.image_url, 'inpaint_src')
    const maskFilename = await uploadUrlToComfyUI(body.mask_url, 'inpaint_mask')

    // 1b. Upload style-ref (défaut = self = image source) sauf si désactivé
    //     explicitement (`style_reference_url === false`) OU si le poids est 0
    //     (skip compute inutile).
    const styleWeight = body.style_reference_weight ?? 0.6
    let styleRefFilename: string | undefined
    if (body.style_reference_url !== false && styleWeight > 0) {
      const styleRefUrl = body.style_reference_url ?? body.image_url
      try {
        // Si la ref = la source, on réutilise le filename déjà uploadé (évite double upload)
        styleRefFilename = styleRefUrl === body.image_url
          ? imgFilename
          : await uploadUrlToComfyUI(styleRefUrl, 'inpaint_styleref')
      } catch (err) {
        console.warn('[inpaint] style-ref upload failed, generating without:', err)
      }
    }

    // 1b. Upload portraits des persos + génère un mask full pour FaceID (si characters fournis)
    let characters: Array<{ portrait_filename: string; mask_filename: string; weight?: number }> | undefined
    if (body.characters && body.characters.length > 0) {
      // Le mask FaceID est un "full" de la taille de la source crop — on doit
      // le dimensionner à la crop. On prend 1024×1024 par défaut (taille typique).
      // Si la source fait une autre taille le mask sera rescalé par ComfyUI.
      const faceMaskBuffer = await generateMaskPng('full', 1024, 1024)
      const faceMaskFilename = await uploadImageToComfyUI(faceMaskBuffer, `inpaint_face_mask_full_${Date.now()}.png`)

      characters = []
      for (const c of body.characters) {
        try {
          const portraitFilename = await uploadUrlToComfyUI(c.portraitUrl, `inpaint_face_${(c.name ?? 'npc').replace(/[^a-z0-9]/gi, '_')}_${Date.now()}`)
          characters.push({
            portrait_filename: portraitFilename,
            mask_filename: faceMaskFilename,
            weight: c.weight ?? 0.7,
          })
        } catch (err) {
          console.warn('[inpaint] char upload failed:', c.name, err)
        }
      }
    }

    // 2. Build + queue
    const workflow = buildInpaintWorkflow({
      source_filename: imgFilename,
      mask_filename: maskFilename,
      checkpoint: body.checkpoint,
      prompt_positive: body.prompt_positive,
      prompt_negative: body.prompt_negative,
      steps: body.steps,
      cfg: body.cfg,
      denoise: body.denoise,
      characters,
      style_reference: styleRefFilename ? {
        filename: styleRefFilename,
        weight: styleWeight,
      } : undefined,
    })
    const result = await queuePrompt(workflow)
    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      return NextResponse.json({ error: 'Workflow inpaint rejeté par ComfyUI', details: result.node_errors }, { status: 500 })
    }

    // 3. Poll jusqu'à complétion
    const startT = Date.now()
    const MAX_WAIT = 3 * 60 * 1000
    let imageInfo: { filename: string; subfolder: string; type: string } | null = null
    while (Date.now() - startT < MAX_WAIT) {
      await new Promise(r => setTimeout(r, 2500))
      const history = await getHistory(result.prompt_id)
      if (!history) continue
      if (history.status.completed) {
        for (const output of Object.values(history.outputs)) {
          if (output.images && output.images.length > 0) { imageInfo = output.images[0]; break }
        }
        break
      }
      if (history.status.status_str === 'error') {
        return NextResponse.json({ error: 'ComfyUI a renvoyé une erreur pendant inpaint' }, { status: 500 })
      }
    }
    if (!imageInfo) return NextResponse.json({ error: 'Timeout inpaint (3 min)' }, { status: 504 })

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
    console.error('[comfyui/inpaint] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
