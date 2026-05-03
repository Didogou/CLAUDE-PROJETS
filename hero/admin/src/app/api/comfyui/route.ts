import { NextRequest, NextResponse } from 'next/server'
import {
  type ComfyUIGenerateParams,
  buildWorkflow,
  queuePrompt,
  getHistory,
  getImage,
  isServerRunning,
  applyCheckpointPromptTemplate,
  findCheckpointDef,
  freeComfyVram,
} from '@/lib/comfyui'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

// Supabase admin client for uploading images
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Libération VRAM : utilise le helper partagé dans lib/comfyui.ts
// (`freeComfyVram` avec mode aggressive par défaut pour GPU ≤ 8 Go).

// ── POST — queue a ComfyUI generation ─────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const params = await req.json() as ComfyUIGenerateParams

    if (!params.workflow_type) {
      return NextResponse.json({ error: 'workflow_type requis' }, { status: 400 })
    }
    // Insert Anything n'utilise pas de prompt texte (Flux Redux injecte l'identité
    // depuis l'image de référence). Tous les autres workflows demandent un prompt.
    const promptOptional = params.workflow_type === 'insert_anything'
    if (!promptOptional && !params.prompt_positive) {
      return NextResponse.json({ error: 'prompt_positive requis pour ce workflow_type' }, { status: 400 })
    }
    // Force string vide si manquant pour les workflows qui le tolèrent
    if (!params.prompt_positive) params.prompt_positive = ''

    // Check ComfyUI is running
    const running = await isServerRunning()
    if (!running) {
      return NextResponse.json(
        { error: 'ComfyUI n\'est pas démarré. Lancez ComfyUI puis réessayez.' },
        { status: 503 },
      )
    }

    // Cinemagraph force Realistic Vision SD 1.5 en interne (voir
    // comfyui-cinemagraph.ts:SD15_DEFAULT_CHECKPOINT). Les templates XL/Pony
    // (score_9, masterpiece…) ne correspondent pas au tokenizer SD 1.5 → on
    // saute le template + on n'essaie pas de résoudre le checkpoint client.
    const isCinemagraph = params.workflow_type === 'cinemagraph'

    // Auto-injection des préfixes/suffixes obligatoires selon le checkpoint.
    // Pony XL → score_9 etc. obligatoires. Animagine → masterpiece + negative renforcé.
    // L'utilisateur écrit son prompt naturel, on ajoute les tags du modèle ici.
    const templated = isCinemagraph
      ? { positive: params.prompt_positive, negative: params.prompt_negative ?? '' }
      : applyCheckpointPromptTemplate(
          params.checkpoint,
          params.prompt_positive,
          params.prompt_negative,
        )
    params.prompt_positive = templated.positive
    params.prompt_negative = templated.negative

    // Safety net : si le client envoie une CLÉ ('juggernaut') au lieu du FILENAME,
    // on auto-résout via CHECKPOINTS. Évite l'erreur "value_not_in_list" côté ComfyUI.
    // Skip pour cinemagraph : le builder ignore de toute façon params.checkpoint.
    if (!isCinemagraph) {
      const def = findCheckpointDef(params.checkpoint)
      if (def && params.checkpoint !== def.filename) {
        console.log('[comfyui] Auto-resolved checkpoint key', params.checkpoint, '→', def.filename)
        params.checkpoint = def.filename
      }
    }
    // Trace complet des params envoyés au workflow ComfyUI — utile pour debug
    // color shift, prompts qui dérivent, etc. Visible dans le terminal Next.js.
    // Pour cinemagraph, on affiche le checkpoint réellement utilisé par le
    // builder (SD 1.5 forcé) et non la valeur reçue du client, qui est ignorée.
    const effectiveCheckpoint = isCinemagraph
      ? 'Realistic_Vision_V6.0_NV_B1_fp16.safetensors (SD 1.5 forcé par cinemagraph)'
      : params.checkpoint
    console.log('\n━━━━━━━━━━━ [comfyui] ━━━━━━━━━━━')
    console.log('  workflow_type  :', params.workflow_type)
    console.log('  checkpoint     :', effectiveCheckpoint)
    console.log('  prompt_positive:', templated.positive)
    console.log('  prompt_negative:', templated.negative)
    if (params.denoise !== undefined)  console.log('  denoise        :', params.denoise)
    if (params.steps !== undefined)    console.log('  steps          :', params.steps)
    if (params.cfg !== undefined)      console.log('  cfg            :', params.cfg)
    if (params.frames !== undefined)   console.log('  frames         :', params.frames)
    if (params.fps !== undefined)      console.log('  fps            :', params.fps)
    if (params.source_image)    console.log('  source_image   :', params.source_image)
    if (params.reference_image) console.log('  reference_image:', params.reference_image)
    if (params.mask_image)      console.log('  mask_image     :', params.mask_image)
    if (params.ipa_weight !== undefined)         console.log('  ipa_weight     :', params.ipa_weight)
    if (params.ipa_weight_type)                  console.log('  ipa_weight_type:', params.ipa_weight_type)
    if (params.ipa_preset)                       console.log('  ipa_preset     :', params.ipa_preset)
    if (params.controlnet_strength !== undefined) console.log('  cn_strength    :', params.controlnet_strength)
    if (params.mask_grow !== undefined) console.log('  mask_grow      :', params.mask_grow)
    if (params.mask_blur !== undefined) console.log('  mask_blur      :', params.mask_blur)
    if (params.enable_face_detailer)    console.log('  face_detailer  : ENABLED (face_weight', params.face_weight, '· face_denoise', params.face_denoise, ')')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    // Build the workflow
    const workflow = buildWorkflow(params)

    // Queue on ComfyUI
    const result = await queuePrompt(workflow)

    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      console.error('[comfyui] Node errors:', JSON.stringify(result.node_errors))
      return NextResponse.json(
        { error: 'Erreurs dans le workflow ComfyUI', details: result.node_errors },
        { status: 500 },
      )
    }

    return NextResponse.json({
      prompt_id: result.prompt_id,
      meta: {
        prompt_used: params.prompt_positive,
        style_used: params.style ?? 'realistic',
        workflow_type: params.workflow_type,
        width: params.width,
        height: params.height,
        steps: params.steps ?? 35,
        cfg: params.cfg ?? 7,
        seed: params.seed ?? -1,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[comfyui] POST error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── GET — poll for result or fetch image ──────────────────────────────────

export async function GET(req: NextRequest) {
  const promptId = req.nextUrl.searchParams.get('prompt_id')
  const action = req.nextUrl.searchParams.get('action') // 'status' | 'image'

  if (!promptId) {
    // Health check
    const running = await isServerRunning()
    return NextResponse.json({ running })
  }

  try {
    // ── Get video/GIF info → télécharge depuis ComfyUI et upload sur Supabase ──
    // (rend la vidéo persistante : le client n'a plus besoin que ComfyUI tourne)
    // Optionnellement skip l'upload si ?storage_path manquant ET ?direct=1 → URL ComfyUI brute
    if (action === 'gif_info' || action === 'video_info') {
      const history = await getHistory(promptId)
      if (!history) return NextResponse.json({ error: 'Prompt non trouvé' }, { status: 404 })

      const comfyUrl = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188'
      const storagePath = req.nextUrl.searchParams.get('storage_path')
      const direct = req.nextUrl.searchParams.get('direct') === '1'

      for (const output of Object.values(history.outputs)) {
        // Détection tolérante : on prend le premier array de cet output qui
        // ressemble à une liste de médias (entrées avec filename/subfolder/type).
        // VHS_VideoCombine sort historiquement sous `gifs` même pour MP4, mais
        // selon les versions ça peut être `videos`, `files`… — on supporte tout.
        let mediaList: Array<{ filename: string; subfolder: string; type: string }> = []
        if (output && typeof output === 'object') {
          for (const value of Object.values(output as Record<string, unknown>)) {
            if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object' && 'filename' in value[0]) {
              mediaList = value as typeof mediaList
              break
            }
          }
        }
        if (mediaList.length > 0) {
          const media = mediaList[0]
          const mediaUrl = `${comfyUrl}/api/view?filename=${encodeURIComponent(media.filename)}&subfolder=${encodeURIComponent(media.subfolder)}&type=${media.type}`

          // URL via proxy Next.js (bypass CORS ComfyUI récent)
          const proxyUrl = `/api/comfyui/media?filename=${encodeURIComponent(media.filename)}&subfolder=${encodeURIComponent(media.subfolder)}&type=${encodeURIComponent(media.type)}`

          // Mode legacy : pas d'upload, on renvoie le proxy (évite les 403 ComfyUI)
          if (direct || !storagePath) {
            return NextResponse.json({ filename: media.filename, gif_url: proxyUrl, video_url: proxyUrl })
          }

          // Mode persist : télécharge depuis ComfyUI puis upload Supabase
          try {
            console.log(`[comfyui] Fetching video ${media.filename} (${media.type})`)
            const fetchRes = await fetch(mediaUrl)
            if (!fetchRes.ok) throw new Error(`ComfyUI fetch failed: ${fetchRes.status}`)
            const buffer = Buffer.from(await fetchRes.arrayBuffer())
            console.log(`[comfyui] Downloaded video: ${buffer.length} bytes`)

            const ext = media.filename.split('.').pop()?.toLowerCase() ?? 'mp4'
            const contentType =
              ext === 'gif' ? 'image/gif' :
              ext === 'webm' ? 'video/webm' :
              'video/mp4'
            const fullPath = `${storagePath}.${ext}`

            const supabase = getSupabaseAdmin()
            console.log(`[comfyui] Uploading video to Supabase: ${fullPath} (${contentType}, ${buffer.length} bytes)`)
            const { error: uploadError } = await supabase.storage.from('images').upload(fullPath, buffer, {
              contentType,
              upsert: true,
            })
            if (uploadError) throw new Error(`Upload Supabase échoué: ${uploadError.message}`)

            const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fullPath)
            // Vide le cache VRAM de ComfyUI (torch.cuda.empty_cache) après chaque workflow
            void freeComfyVram()
            return NextResponse.json({ filename: media.filename, gif_url: publicUrl, video_url: publicUrl, persisted: true })
          } catch (uploadErr: unknown) {
            const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr)
            console.error(`[comfyui] Video upload failed, falling back to proxy URL: ${msg}`)
            // Fallback sur le proxy Next.js (pas d'URL ComfyUI directe → évite les 403 cross-origin)
            return NextResponse.json({ filename: media.filename, gif_url: proxyUrl, video_url: proxyUrl, persisted: false, upload_error: msg })
          }
        }
      }
      return NextResponse.json({ error: 'Aucun média trouvé' }, { status: 404 })
    }

    // ── Fetch generated image and upload to Supabase ──
    if (action === 'image') {
      const storagePath = req.nextUrl.searchParams.get('storage_path')
      if (!storagePath) {
        return NextResponse.json({ error: 'storage_path requis' }, { status: 400 })
      }

      const history = await getHistory(promptId)
      if (!history) {
        return NextResponse.json({ error: 'Prompt non trouvé' }, { status: 404 })
      }

      // Find first output image or gif
      let imageInfo: { filename: string; subfolder: string; type: string } | null = null
      for (const output of Object.values(history.outputs)) {
        if (output.images && output.images.length > 0) {
          imageInfo = output.images[0]
          break
        }
        if (output.gifs && output.gifs.length > 0) {
          imageInfo = output.gifs[0]
          break
        }
      }

      if (!imageInfo) {
        return NextResponse.json({ error: 'Aucune image générée' }, { status: 404 })
      }

      // Download from ComfyUI
      console.log(`[comfyui] Fetching ${imageInfo.filename} (${imageInfo.type})`)
      const imageBuffer = await getImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type)
      console.log(`[comfyui] Downloaded ${imageBuffer.length} bytes`)

      // Upload to Supabase Storage
      const supabase = getSupabaseAdmin()
      const ext = imageInfo.filename.split('.').pop() ?? 'png'
      const contentType = ext === 'gif' ? 'image/gif' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
      const fullPath = `${storagePath}.${ext}`

      console.log(`[comfyui] Uploading to Supabase: ${fullPath} (${contentType}, ${imageBuffer.length} bytes)`)
      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(fullPath, imageBuffer, {
          contentType,
          upsert: true,
        })

      if (uploadError) throw new Error(`Upload Supabase échoué: ${uploadError.message}`)

      const { data: { publicUrl } } = supabase.storage
        .from('images')
        .getPublicUrl(fullPath)

      // Vide le cache VRAM de ComfyUI (torch.cuda.empty_cache) après chaque workflow
      void freeComfyVram()

      return NextResponse.json({ status: 'succeeded', image_url: publicUrl })
    }

    // ── Status polling ──
    const history = await getHistory(promptId)

    if (!history) {
      return NextResponse.json({ status: 'processing' })
    }

    if (history.status.completed) {
      // Détection tolérante : on considère le workflow réussi dès qu'UN node
      // a un array non vide dont les entrées ressemblent à du média
      // (présence d'un `filename`). Couvre images, gifs, videos, audio, et
      // les clés non-standard que VHS_VideoCombine peut utiliser selon la
      // version installée (gifs pour MP4 historiquement, mais peut changer).
      let hasOutput = false
      for (const output of Object.values(history.outputs)) {
        if (!output || typeof output !== 'object') continue
        for (const value of Object.values(output as Record<string, unknown>)) {
          if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object' && 'filename' in value[0]) {
            hasOutput = true
            break
          }
        }
        if (hasOutput) break
      }

      if (hasOutput) {
        return NextResponse.json({ status: 'succeeded' })
      }
      // Log la structure exacte pour debug quand la détection échoue
      console.warn('[comfyui] history completed but no output detected. Structure:',
        JSON.stringify(Object.fromEntries(
          Object.entries(history.outputs).map(([k, v]) => [k, Object.keys(v as object)])
        )))
      return NextResponse.json({ status: 'failed', error: 'Génération terminée sans média détecté' })
    }

    if (history.status.status_str === 'error') {
      return NextResponse.json({ status: 'failed', error: 'Erreur ComfyUI' })
    }

    return NextResponse.json({ status: 'processing' })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[comfyui] GET error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
