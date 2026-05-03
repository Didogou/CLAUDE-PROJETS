import { NextRequest, NextResponse } from 'next/server'
import { isServerRunning, queuePrompt, getHistory, getImage, uploadUrlToComfyUI, generateMaskPng, uploadImageToComfyUI, STYLE_SUFFIXES } from '@/lib/comfyui'
import { buildPanorama360Workflow, type Panorama360Character } from '@/lib/comfyui-panorama360'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 360

/**
 * POST /api/comfyui/panorama360
 *
 * Génère un panorama équirectangulaire 2048×1024 (ratio 2:1) avec wraparound
 * gauche/droite parfait. Utilise :
 *   - SeamlessTile + MakeCircularVAE (spinagon/ComfyUI-seamless-tiling)
 *   - LoRA 360Redmond optionnel (artificialguybr) pour meilleure cohérence
 *
 * Body : {
 *   checkpoint, prompt_positive, prompt_negative?,
 *   width?, height?, lora_360?, lora_strength_model?, lora_strength_clip?,
 *   steps?, cfg?, seed?,
 *   storage_path: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      checkpoint: string
      prompt_positive: string
      prompt_negative?: string
      style?: string
      width?: number
      height?: number
      lora_360?: string
      lora_strength_model?: number
      lora_strength_clip?: number
      /** Persos à injecter : array de { portraitUrl, weight?, name? }. */
      characters?: Array<{ portraitUrl: string; weight?: number; name?: string }>
      use_circular_vae?: boolean
      steps?: number
      cfg?: number
      seed?: number
      storage_path: string
    }
    if (!body.checkpoint || !body.prompt_positive || !body.storage_path) {
      return NextResponse.json({ error: 'checkpoint, prompt_positive et storage_path requis' }, { status: 400 })
    }

    if (!(await isServerRunning())) {
      return NextResponse.json({ error: 'ComfyUI n\'est pas démarré.' }, { status: 503 })
    }

    // Résout le style suffix depuis la clé de style
    const style_suffix = body.style ? STYLE_SUFFIXES[body.style as keyof typeof STYLE_SUFFIXES] : undefined

    // Upload des portraits NPC + génération du mask full 2048×1024 pour FaceID
    const width = body.width ?? 2048
    const height = body.height ?? 1024
    let characters: Panorama360Character[] | undefined
    if (body.characters && body.characters.length > 0) {
      // Génère/upload le mask full une seule fois (partagé entre tous les persos)
      const maskBuffer = await generateMaskPng('full', width, height)
      const maskFilename = await uploadImageToComfyUI(maskBuffer, `mask_full_${width}x${height}.png`)

      characters = []
      for (const char of body.characters) {
        try {
          const portraitFilename = await uploadUrlToComfyUI(char.portraitUrl, `pano360_char_${(char.name ?? 'npc').replace(/[^a-z0-9]/gi, '_')}_${Date.now()}`)
          characters.push({
            portrait_filename: portraitFilename,
            mask_filename: maskFilename,
            weight: char.weight ?? 0.7,
          })
        } catch (err) {
          console.warn('[panorama360] portrait upload failed for', char.name, err)
        }
      }
    }

    const workflow = buildPanorama360Workflow({
      ...body,
      style_suffix,
      characters,
    })
    const result = await queuePrompt(workflow)

    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      const errStr = JSON.stringify(result.node_errors)
      const missingSeamless = /SeamlessTile|MakeCircularVAE/i.test(errStr)
      const missingLora = /lora|LoraLoader/i.test(errStr) && /not found|does not exist/i.test(errStr)
      let errMsg = 'Workflow panorama 360° rejeté par ComfyUI'
      if (missingSeamless) {
        errMsg = 'Custom nodes "SeamlessTile" / "MakeCircularVAE" non installés.\n\n' +
          'Installation :\n' +
          '  cd ComfyUI/custom_nodes\n' +
          '  git clone https://github.com/spinagon/ComfyUI-seamless-tiling.git\n' +
          'puis redémarre ComfyUI.'
      } else if (missingLora) {
        errMsg = 'LoRA View360.safetensors introuvable.\n\n' +
          'Télécharge depuis : https://huggingface.co/artificialguybr/360Redmond/blob/main/View360.safetensors (913 Mo)\n' +
          'et place-le dans ComfyUI/models/loras/.\n\n' +
          'Ou décoche "Utiliser le LoRA 360Redmond" côté UI pour générer sans (moins bon résultat).'
      }
      return NextResponse.json({ error: errMsg, details: result.node_errors }, { status: 501 })
    }

    // Poll (SDXL 2048×1024 = long, ~2-4 min)
    const startT = Date.now()
    const MAX_WAIT = 5 * 60 * 1000
    let imageInfo: { filename: string; subfolder: string; type: string } | null = null
    while (Date.now() - startT < MAX_WAIT) {
      await new Promise(r => setTimeout(r, 3000))
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
        const details = messages
          .filter(m => Array.isArray(m) && m[0] === 'execution_error')
          .map(m => JSON.stringify(m)).join(' | ').slice(0, 600)
        return NextResponse.json({ error: `ComfyUI a renvoyé une erreur${details ? ' : ' + details : ''}` }, { status: 500 })
      }
    }
    if (!imageInfo) return NextResponse.json({ error: 'Timeout panorama 360° (5 min)' }, { status: 504 })

    // Download + upload Supabase
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
    return NextResponse.json({ image_url: publicUrl })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[comfyui/panorama360] error:', msg)
    const isMissingNode = /missing_node_type|SeamlessTile|MakeCircularVAE|not found/i.test(msg)
    if (isMissingNode) {
      return NextResponse.json({
        error: 'Custom node "SeamlessTile / MakeCircularVAE" non installé. cd ComfyUI/custom_nodes && git clone https://github.com/spinagon/ComfyUI-seamless-tiling.git puis redémarre ComfyUI.',
      }, { status: 501 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
