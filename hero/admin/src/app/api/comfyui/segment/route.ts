import { NextRequest, NextResponse } from 'next/server'
import { isServerRunning, uploadUrlToComfyUI, queuePrompt, getHistory, getImage } from '@/lib/comfyui'
import { buildSAM2Workflow, type SAMPoint } from '@/lib/comfyui-sam'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120

/**
 * POST /api/comfyui/segment
 *
 * Body : { image_url: string, points: SAMPoint[] }
 *
 * Upload l'image source dans ComfyUI, lance un workflow SAM 2 (kijai), poll
 * jusqu'à complétion, récupère le PNG mask, upload dans Supabase Storage et
 * renvoie { mask_url }.
 *
 * Erreurs gérées :
 *   - ComfyUI pas démarré           → 503 "ComfyUI not running"
 *   - Nodes SAM 2 pas installés     → 501 avec lien d'install
 *   - Génération échouée (timeout)  → 504
 *
 * Note : le ComfyUI-SAM2 de kijai doit être installé côté ComfyUI.
 * Voir src/lib/comfyui-sam.ts pour les instructions.
 */
export async function POST(req: NextRequest) {
  try {
    const { image_url, points } = await req.json() as { image_url: string; points: SAMPoint[] }
    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })
    if (!points || points.length === 0) return NextResponse.json({ error: 'au moins 1 point requis' }, { status: 400 })
    if (!points.some(p => p.positive)) {
      return NextResponse.json({ error: 'au moins 1 point positif requis' }, { status: 400 })
    }

    if (!(await isServerRunning())) {
      return NextResponse.json({ error: 'ComfyUI n\'est pas démarré. Lancez-le puis réessayez.' }, { status: 503 })
    }

    // 1. Upload de l'image source dans ComfyUI input folder.
    // Nom timestampé : évite la collision overwrite avec un fichier encore
    // ouvert par un process précédent (symptôme = "broken PNG file" au LoadImage).
    const imageFilename = await uploadUrlToComfyUI(image_url, `sam_source_${Date.now()}`)

    // 2. Construit et soumet le workflow SAM
    const workflow = buildSAM2Workflow({ image_filename: imageFilename, points })
    const result = await queuePrompt(workflow)

    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      const errStr = JSON.stringify(result.node_errors)
      const isMissingNode = /unknown node|NodeClass|not found|missing/i.test(errStr)
      return NextResponse.json({
        error: isMissingNode
          ? 'Nodes SAM 2 non installés côté ComfyUI. Installe ComfyUI-SAM2 de kijai : cd ComfyUI/custom_nodes && git clone https://github.com/kijai/ComfyUI-segment-anything-2 && pip install -r ComfyUI-SAM2/requirements.txt, puis redémarre ComfyUI.'
          : 'Workflow SAM rejeté par ComfyUI',
        details: result.node_errors,
      }, { status: 501 })
    }

    // 3. Poll jusqu'à complétion (max 2 min — SAM est plus rapide qu'une génération)
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
        // Extrait les messages d'erreur détaillés de history.status.messages
        // (ComfyUI pousse des tuples ['execution_error', {...}] ici)
        const messages = (history.status as unknown as { messages?: unknown[] }).messages ?? []
        const errorDetails = messages
          .filter(m => Array.isArray(m) && (m[0] === 'execution_error' || m[0] === 'execution_interrupted'))
          .map(m => JSON.stringify(m))
          .join(' | ')
          .slice(0, 600)
        return NextResponse.json({
          error: `ComfyUI a renvoyé une erreur pendant SAM${errorDetails ? ' : ' + errorDetails : ''}`,
        }, { status: 500 })
      }
    }
    if (!imageInfo) return NextResponse.json({ error: 'Timeout SAM (2 min)' }, { status: 504 })

    // 4. Télécharge le PNG mask + upload Supabase (temp path)
    const maskBuffer = await getImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const storagePath = `temp/sam_mask_${Date.now()}.png`
    const { error: upErr } = await supabase.storage.from('images').upload(storagePath, maskBuffer, {
      contentType: 'image/png',
      upsert: true,
    })
    if (upErr) throw new Error(`Upload mask Supabase échoué : ${upErr.message}`)

    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath)
    return NextResponse.json({ mask_url: publicUrl })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[comfyui/segment] error:', msg)
    // Détection "nodes SAM non installés" — queuePrompt peut throw avec un payload
    // ComfyUI contenant `missing_node_type` ou `not found`. Dans ce cas on renvoie
    // un 501 avec la commande d'install, sans pourrir l'UI avec le stack technique.
    const isMissingNode = /missing_node_type|not found|unknown node|custom node may not be installed/i.test(msg)
    if (isMissingNode) {
      return NextResponse.json({
        error:
          'Nodes SAM 2 non installés côté ComfyUI.\n\n' +
          'Pour activer le mode Points SAM, installe ComfyUI-segment-anything-2 de kijai :\n' +
          '  cd ComfyUI/custom_nodes\n' +
          '  git clone https://github.com/kijai/ComfyUI-segment-anything-2\n' +
          'puis redémarre ComfyUI (pas de pip install, dépendances bundlées).\n' +
          'Le modèle sam2_hiera_large sera téléchargé automatiquement au 1er usage.\n\n' +
          'En attendant, utilise le mode 📦 Rectangle.',
      }, { status: 501 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
