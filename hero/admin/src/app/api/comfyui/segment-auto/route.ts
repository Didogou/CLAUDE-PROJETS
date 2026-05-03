import { NextRequest, NextResponse } from 'next/server'
import { isServerRunning, uploadUrlToComfyUI, queuePrompt, getHistory, getImage, freeComfyVram } from '@/lib/comfyui'
import { buildSAM2AutoWorkflow } from '@/lib/comfyui-sam'
import { createClient } from '@supabase/supabase-js'

// 6 min : le 1er run télécharge/init le wrapper automaskgenerator (lent),
// runs suivants ~30-60s. Valide pour Next.js self-hosted.
export const maxDuration = 360

/**
 * POST /api/comfyui/segment-auto
 *
 * Body : { image_url: string, min_mask_region_area?: number }
 *
 * Lance SAM 2 en mode "automaskgenerator" sur l'image entière : découpe en
 * ~10-30 candidats objets. Sauvegarde N PNGs dans ComfyUI output puis
 * uploade chacun dans Supabase Storage.
 *
 * Retour : { masks: Array<{ url: string, index: number }> }
 *
 * Usage typique (mode "baguette magique") :
 *   - Appel unique à l'entrée du mode
 *   - Client load chaque mask, détecte au hover quel objet est survolé,
 *     affiche marching ants, clique → extraction via extractByMaskUrl
 */
export async function POST(req: NextRequest) {
  try {
    const {
      image_url,
      min_mask_region_area,
      points_per_side,
      pred_iou_thresh,
      stability_score_thresh,
    } = await req.json() as {
      image_url: string
      min_mask_region_area?: number
      points_per_side?: number
      pred_iou_thresh?: number
      stability_score_thresh?: number
    }
    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })

    if (!(await isServerRunning())) {
      return NextResponse.json({ error: 'ComfyUI n\'est pas démarré.' }, { status: 503 })
    }

    // 1. Upload source dans ComfyUI input.
    // Nom timestampé pour éviter les collisions (overwrite=true sur un fichier
    // encore ouvert par un process précédent → PNG corrompu au load).
    const imageFilename = await uploadUrlToComfyUI(image_url, `sam_auto_source_${Date.now()}`)

    // 2. Soumet workflow auto-seg (tous les params SAM sont optionnels,
    //    buildSAM2AutoWorkflow applique les défauts si undefined)
    const workflow = buildSAM2AutoWorkflow({
      image_filename: imageFilename,
      min_mask_region_area,
      points_per_side,
      pred_iou_thresh,
      stability_score_thresh,
    })
    const result = await queuePrompt(workflow)

    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      const errStr = JSON.stringify(result.node_errors)
      const isMissingNode = /unknown node|NodeClass|not found|missing/i.test(errStr)
      return NextResponse.json({
        error: isMissingNode
          ? 'Nodes SAM 2 non installés. Installe ComfyUI-segment-anything-2 de kijai puis redémarre ComfyUI.'
          : 'Workflow SAM auto rejeté par ComfyUI',
        details: result.node_errors,
      }, { status: 501 })
    }

    // 3. Poll : 1er run ~2-4 min (init du wrapper automaskgenerator + 1er inference),
    //    suivants ~30-60s. On donne 5 min pour être tranquille.
    const startT = Date.now()
    const MAX_WAIT = 5 * 60 * 1000
    let imageList: Array<{ filename: string; subfolder: string; type: string }> = []
    let completedSuccessfully = false
    let lastHistory: Awaited<ReturnType<typeof getHistory>> | null = null
    while (Date.now() - startT < MAX_WAIT) {
      await new Promise(r => setTimeout(r, 2500))
      const history = await getHistory(result.prompt_id)
      if (!history) continue
      lastHistory = history
      if (history.status.completed) {
        completedSuccessfully = true
        for (const output of Object.values(history.outputs)) {
          if (output.images && output.images.length > 0) imageList = output.images
        }
        break
      }
      if (history.status.status_str === 'error') {
        const messages = (history.status as unknown as { messages?: unknown[] }).messages ?? []
        const details = messages
          .filter(m => Array.isArray(m) && (m[0] === 'execution_error' || m[0] === 'execution_interrupted'))
          .map(m => JSON.stringify(m)).join(' | ').slice(0, 600)
        return NextResponse.json({ error: `ComfyUI a renvoyé une erreur pendant SAM auto${details ? ' : ' + details : ''}` }, { status: 500 })
      }
    }
    // Distingue les 2 cas pour un message plus utile côté UI
    if (!completedSuccessfully) {
      return NextResponse.json({
        error: `Timeout SAM auto (5 min). Prompt ID ComfyUI : ${result.prompt_id}. Le 1er run télécharge le modèle — relance une fois le download terminé.`,
      }, { status: 504 })
    }
    if (imageList.length === 0) {
      // Log le contenu brut de history.outputs pour diagnostiquer ce qui manque
      console.error('[segment-auto] 0 masks retournés. history.outputs :', JSON.stringify(lastHistory?.outputs ?? {}).slice(0, 2000))
      const outputKeys = lastHistory?.outputs ? Object.keys(lastHistory.outputs).join(', ') : '(vide)'
      return NextResponse.json({
        error: `SAM auto a fini mais aucun mask dans la sortie SaveImage. Clés d'output disponibles : ${outputKeys}. Vérifie les logs ComfyUI — c'est peut-être un souci de workflow ou l'image est trop simple (fond uni).`,
      }, { status: 502 })
    }

    // 4. Télécharge + upload chaque mask dans Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const batchId = Date.now()
    const masks: Array<{ url: string; index: number }> = []
    for (let i = 0; i < imageList.length; i++) {
      const info = imageList[i]
      try {
        const buffer = await getImage(info.filename, info.subfolder, info.type)
        const storagePath = `temp/sam_auto_${batchId}_${i}.png`
        const { error: upErr } = await supabase.storage.from('images').upload(storagePath, buffer, {
          contentType: 'image/png',
          upsert: true,
        })
        if (upErr) {
          console.warn(`[segment-auto] mask ${i} upload err:`, upErr.message)
          continue
        }
        const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath)
        masks.push({ url: publicUrl, index: i })
      } catch (e) {
        console.warn(`[segment-auto] mask ${i} fetch err:`, e instanceof Error ? e.message : String(e))
      }
    }

    void freeComfyVram()
    return NextResponse.json({ masks, count: masks.length })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[comfyui/segment-auto] error:', msg)
    const isMissingNode = /missing_node_type|not found|unknown node|custom node may not be installed/i.test(msg)
    if (isMissingNode) {
      // Distingue si c'est notre node maison ou le pack kijai qui manque
      const isOurCustomNode = /HeroSam2AutoIndividual/i.test(msg)
      return NextResponse.json({
        error: isOurCustomNode
          ? 'Custom node "HeroSam2AutoIndividual" manquant dans ComfyUI.\n\n' +
            'Installation : copie le dossier `ComfyUI/custom_nodes/HeroSAM2Individual/` ' +
            '(fourni dans le projet) vers ton install ComfyUI et redémarre.\n\n' +
            'Ce node wrappe kijai\'s SAM2 pour retourner des masks individuels ' +
            '(l\'officiel combine tout en un seul).'
          : 'Nodes SAM 2 non installés côté ComfyUI.\n\nInstalle ComfyUI-segment-anything-2 de kijai puis redémarre ComfyUI.',
      }, { status: 501 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
