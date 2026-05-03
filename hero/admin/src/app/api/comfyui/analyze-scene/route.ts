import { NextRequest, NextResponse } from 'next/server'
import { isServerRunning, uploadUrlToComfyUI, uploadImageToComfyUI, queuePrompt, getHistory, getImage } from '@/lib/comfyui'
import { buildSceneFlorenceWorkflow, buildSceneFlorenceODWorkflow, buildSceneFlorenceCTPGWorkflow, buildSceneDinoWorkflow, buildSceneDinoSAM1Workflow, buildSceneSAMSingleBboxWorkflow, buildSceneSAMMultiBboxWorkflow, buildSceneSAMPointWorkflow, buildSceneSAMBboxPointWorkflow } from '@/lib/comfyui-scene-analyzer'
import { ollamaJSON } from '@/lib/ollama'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { unlinkComfyOutput } from '@/lib/comfyui-output-cleanup'

export const maxDuration = 600
export const dynamic = 'force-dynamic'

interface ComfyImage { filename: string; subfolder: string; type: string }

/**
 * Wrapper local : récupère un fichier ComfyUI/output via HTTP, puis le supprime
 * du disque local immédiatement après. Garantit que rien ne s'accumule.
 *
 * Utilisé partout à la place de getImage() direct dans cette route.
 */
async function fetchAndDispose(filename: string, subfolder: string, type: string): Promise<Buffer> {
  const buf = await getImage(filename, subfolder, type)
  await unlinkComfyOutput(filename, subfolder)
  return buf
}

/**
 * Déduit le path prefix Supabase pour les masks d'analyse d'une image source.
 * On les place dans un sous-dossier "analyses/{nom_fichier_source}" au même
 * niveau que l'image, pour scoper les analyses par scène/projet.
 *
 * Exemples :
 *   "projects/X/scenes/Y/variants/abc.png" → "projects/X/scenes/Y/analyses/abc"
 *   "projects/X/scenes/Y/base.png"          → "projects/X/scenes/Y/analyses/base"
 *   "test/new-layout/scene-123/abc.png"     → "test/new-layout/scene-123/analyses/abc"
 *
 * Si l'image_url ne ressemble pas à du Supabase storage public, fallback sur
 * un hash court de l'URL pour éviter les collisions.
 */
function deriveAnalysisPrefix(imageUrl: string): string {
  const m = imageUrl.match(/\/object\/public\/images\/(.+)$/)
  if (!m) {
    // Fallback : hash court (8 chars) basé sur l'URL pour scope unique
    let h = 0
    for (let i = 0; i < imageUrl.length; i++) h = ((h << 5) - h + imageUrl.charCodeAt(i)) | 0
    return `analyses/url_${(h >>> 0).toString(36).slice(0, 8)}`
  }
  const parts = m[1].split('/')
  const filename = (parts[parts.length - 1] ?? 'unknown').replace(/\.[^.]+$/, '')
  // Remplace 'variants' par 'analyses' si présent, sinon ajoute 'analyses' au path
  const dirParts = parts.slice(0, -1)
  if (dirParts.length > 0 && dirParts[dirParts.length - 1] === 'variants') {
    dirParts[dirParts.length - 1] = 'analyses'
  } else {
    dirParts.push('analyses')
  }
  dirParts.push(filename)
  return dirParts.join('/')
}

/**
 * POST /api/comfyui/analyze-scene
 *
 * Pipeline initial :
 *   1. Florence-2 dense_region_caption → liste de labels + bboxes
 *   2. Pour chaque bbox : SAM 2 (via HeroBboxFromJson) → 1 mask PNG par objet
 *
 * Body : { image_url, model?: 'base'|'large' }
 */
type FilterMode = 'baseline' | 'area_strict' | 'keywords' | 'combined'
type ExtractionStrategy = 'none' | 'florence_od' | 'a_pure' | 'a_baseline' | 'b_qwen' | 'c_erase' | 'd_dino' | 'e_qwen_dino' | 'f_qwen_sam1hq' | 'g_florence_centerpoint' | 'h_florence_bbox_point'

export async function POST(req: NextRequest) {
  try {
    const {
      image_url,
      model = 'large',
      filter_mode = 'baseline',
      extraction_strategy = 'a_baseline',
      group_by_class = false,
      force_reanalyze = false,
      mode = 'fresh',
    } = await req.json() as {
      image_url: string
      model?: 'base' | 'large'
      filter_mode?: FilterMode
      extraction_strategy?: ExtractionStrategy
      group_by_class?: boolean
      /** Si true : ignore le cache scene_analyses et re-analyse. Utile quand
       *  l'utilisateur veut explicitement re-faire la pré-analyse (ex: après
       *  édition de l'image). Défaut false → on retourne le cache si dispo. */
      force_reanalyze?: boolean
      /** 'fresh' = analyse complète sur l'image entière (défaut)
       *  'drilldown' = pour chaque détection plurale/compound existante, crop
       *  l'image à sa bbox et re-analyse pour découvrir des sous-objets.
       *  Singular detections gardées telles quelles. */
      mode?: 'fresh' | 'drilldown'
    }

    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })

    // ── Mode drill-down : itère sur les détections existantes plural/compound ─
    if (mode === 'drilldown') {
      return await handleDrilldown({
        image_url,
        model,
        filter_mode,
        extraction_strategy,
      })
    }

    // ── Cache check : table scene_analyses ──────────────────────────────
    // Si une analyse existe déjà pour cette image_url avec la stratégie demandée,
    // on retourne directement sans appeler ComfyUI (~80-100s économisées).
    const supabaseCache = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    if (!force_reanalyze) {
      const { data: cached } = await supabaseCache
        .from('scene_analyses')
        .select('detections, image_width, image_height, analyzed_at, strategy')
        .eq('image_url', image_url)
        .maybeSingle()
      if (cached && cached.strategy === extraction_strategy) {
        // Re-applique le filtre sur les détections cachées : permet aux nouvelles
        // règles (structurels, gros objets non-personnages) de prendre effet
        // immédiatement sur les images analysées AVANT l'ajout de ces filtres,
        // sans nécessiter une re-analyse complète.
        const rawCached = cached.detections as Array<{
          label: string
          bbox: [number, number, number, number]
          source?: 'dense' | 'od'
          [k: string]: unknown
        }>
        const filteredCached = rawCached.filter(d => {
          const [x1, y1, x2, y2] = d.bbox
          const area = (x2 - x1) * (y2 - y1)
          if (area < 0.001) return false
          if (STRUCTURAL_KEYWORDS_RE.test(d.label)) return false
          const isCharacter = CHARACTER_KEYWORDS_RE.test(d.label)
          if (area > 0.25 && !isCharacter) return false
          return true
        })
        return NextResponse.json({
          detections: filteredCached,
          image_url,
          analyzed_at: new Date(cached.analyzed_at as string).getTime(),
          image_size: { width: cached.image_width ?? 0, height: cached.image_height ?? 0 },
          extraction_strategy: cached.strategy,
          filter_mode,
          from_cache: true,
          cache_filter_applied: rawCached.length !== filteredCached.length
            ? `${rawCached.length - filteredCached.length} drop(s) sur cache (structural ou gros non-character)`
            : undefined,
        })
      }
    } else {
      // force_reanalyze : on supprime les anciens masks PNG de Supabase storage
      // avant de relancer l'analyse, pour pas accumuler de fichiers orphelins.
      const { data: oldRow } = await supabaseCache
        .from('scene_analyses')
        .select('detections')
        .eq('image_url', image_url)
        .maybeSingle()
      if (oldRow && Array.isArray(oldRow.detections)) {
        const pathsToRemove: string[] = []
        for (const d of oldRow.detections as Array<{ mask_url?: string }>) {
          if (!d.mask_url) continue
          // Extraire le path après "/object/public/images/" pour l'API storage.remove
          const m = d.mask_url.match(/\/object\/public\/images\/(.+)$/)
          if (m) pathsToRemove.push(m[1])
        }
        if (pathsToRemove.length > 0) {
          const { error: delErr } = await supabaseCache.storage.from('images').remove(pathsToRemove)
          if (delErr) {
            console.warn('[analyze-scene] cleanup old masks failed:', delErr.message)
          } else {
            console.log(`[analyze-scene] cleanup : ${pathsToRemove.length} anciens masks supprimés`)
          }
        }
      }
    }

    if (!(await isServerRunning())) {
      return NextResponse.json({ error: 'ComfyUI n\'est pas démarré.' }, { status: 503 })
    }

    const imageFilename = await uploadUrlToComfyUI(image_url, `scene_${Date.now()}`)

    // [1] Florence dense_region_caption
    const florenceWf = buildSceneFlorenceWorkflow({ image_filename: imageFilename, florence_model: model })
    const florenceResult = await queuePrompt(florenceWf)
    if (florenceResult.node_errors && Object.keys(florenceResult.node_errors).length > 0) {
      const errStr = JSON.stringify(florenceResult.node_errors)
      return NextResponse.json({ error: `Workflow Florence rejeté : ${errStr.slice(0, 500)}` }, { status: 501 })
    }
    const florenceHistory = await pollUntilDone(florenceResult.prompt_id, 120 * 1000)
    if (!florenceHistory) {
      return NextResponse.json({ error: 'Timeout Florence (120s)' }, { status: 504 })
    }

    const textNodeOutput = (florenceHistory.outputs['4'] as unknown as { text_files?: ComfyImage[] }) ?? {}
    const textFiles = textNodeOutput.text_files ?? []
    if (textFiles.length === 0) {
      return NextResponse.json({ error: 'Pas de caption récupérée.' }, { status: 500 })
    }
    const captionBuffer = await fetchAndDispose(textFiles[0].filename, textFiles[0].subfolder, textFiles[0].type)
    const captionText = captionBuffer.toString('utf-8')
    const detections0 = parseFlorenceCaptionWithLocs(captionText)

    if (detections0.length === 0) {
      return NextResponse.json({
        detections: [],
        message: 'Aucune détection parsée depuis Florence',
        image_url,
        raw_caption: captionText.slice(0, 500),
      })
    }

    // [1b] 2ème pass Florence pour récupérer les petits objets que
    //      dense_region_caption regroupe dans une description englobante
    //      (pillows dans sofa, cushions dans rocking chair, etc.).
    //
    // Stratégies disponibles via `extraction_strategy` :
    //   - 'none'        : pas de 2ème pass (juste dense_region)
    //   - 'florence_od' : task <OD> Florence (limité à COCO, sans pillow)
    //   - 'a_pure'      : CTPG avec prompt extrait des descriptions Florence (regex "with X")
    //   - 'a_baseline'  : a_pure + baseline d'objets d'intérieur (pillow, cushion, lamp, vase…)
    //   - 'b_qwen'      : CTPG avec prompt extrait par Qwen via Ollama (sémantique)
    const sourceMetaEarly = await getImageDimensions(image_url)
    const Wsrc = sourceMetaEarly?.width ?? 1
    const Hsrc = sourceMetaEarly?.height ?? 1

    // Supabase + ts créés tôt pour que la stratégie f_qwen_sam1hq puisse
    // uploader directement ses masks pendant son pipeline.
    const supabaseEarly = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const tsEarly = Date.now()

    // Détections pré-complétées (avec masks déjà uploadés) pour les stratégies
    // qui font tout le pipeline d'un coup (cf f_qwen_sam1hq).
    const preCompletedDetections: Array<{
      id: string
      label: string
      source: 'dense' | 'od'
      bbox: [number, number, number, number]
      bbox_pixels: [number, number, number, number]
      mask_url: string | null
      error?: string
    }> = []

    let secondaryDetections: ParsedDetection[] = []
    let extractedPromptInfo: { prompt: string; extracted: string[]; method: string } = {
      prompt: '', extracted: [], method: extraction_strategy,
    }

    if (extraction_strategy === 'florence_od') {
      // Garde l'ancien path OD pour comparaison (limité à COCO, ne trouve pas les pillows)
      try {
        const odWf = buildSceneFlorenceODWorkflow({ image_filename: imageFilename, florence_model: model })
        const odResult = await queuePrompt(odWf)
        if (odResult.node_errors && Object.keys(odResult.node_errors).length > 0) {
          throw new Error(`OD workflow rejected: ${JSON.stringify(odResult.node_errors).slice(0, 200)}`)
        }
        const odHistory = await pollUntilDone(odResult.prompt_id, 60 * 1000)
        if (odHistory) {
          const textNodeOutput = (odHistory.outputs['4'] as unknown as { text_files?: ComfyImage[] }) ?? {}
          const textFiles = textNodeOutput.text_files ?? []
          if (textFiles.length > 0) {
            const odBuf = await fetchAndDispose(textFiles[0].filename, textFiles[0].subfolder, textFiles[0].type)
            const odCaption = odBuf.toString('utf-8')
            secondaryDetections = parseFlorenceCaptionWithLocs(odCaption).map(d => ({ ...d, source: 'od' as const }))
          }
        }
      } catch (err) {
        console.warn('[analyze-scene] Florence <OD> pass failed:', err)
      }
    } else if (extraction_strategy === 'a_pure' || extraction_strategy === 'a_baseline' || extraction_strategy === 'b_qwen') {
      // CTPG strategies : on construit un prompt à partir des descriptions Florence
      try {
        const denseLabels = detections0.map(d => d.label)
        extractedPromptInfo = await buildSmallObjectsPrompt(denseLabels, extraction_strategy)
        if (extractedPromptInfo.prompt) {
          const ctpgWf = buildSceneFlorenceCTPGWorkflow({
            image_filename: imageFilename,
            florence_model: model,
            prompt_text: extractedPromptInfo.prompt,
          })
          const ctpgResult = await queuePrompt(ctpgWf)
          if (ctpgResult.node_errors && Object.keys(ctpgResult.node_errors).length > 0) {
            throw new Error(`CTPG workflow rejected: ${JSON.stringify(ctpgResult.node_errors).slice(0, 200)}`)
          }
          const ctpgHistory = await pollUntilDone(ctpgResult.prompt_id, 60 * 1000)
          if (ctpgHistory) {
            const textNodeOutput = (ctpgHistory.outputs['4'] as unknown as { text_files?: ComfyImage[] }) ?? {}
            const textFiles = textNodeOutput.text_files ?? []
            if (textFiles.length > 0) {
              const ctpgBuf = await fetchAndDispose(textFiles[0].filename, textFiles[0].subfolder, textFiles[0].type)
              const ctpgCaption = ctpgBuf.toString('utf-8')
              secondaryDetections = parseFlorenceCaptionWithLocs(ctpgCaption).map(d => ({ ...d, source: 'od' as const }))
            }
          }
        }
      } catch (err) {
        console.warn('[analyze-scene] CTPG pass failed:', err)
      }
    } else if (extraction_strategy === 'd_dino' || extraction_strategy === 'e_qwen_dino') {
      // DINO open-vocab multi-instance : 1 appel DINO PAR phrase pour avoir
      // des bboxes labellées per-class. La phrase devient le label de toutes
      // les bboxes qu'elle retourne.
      //
      //   - d_dino       : phrases extraites via regex "with X" + baseline (a_baseline)
      //   - e_qwen_dino  : phrases extraites par Qwen (objets purs sans couleurs/matériaux)
      try {
        const denseLabels = detections0.map(d => d.label)
        if (extraction_strategy === 'e_qwen_dino') {
          extractedPromptInfo = await extractObjectsViaQwen(denseLabels)
        } else {
          extractedPromptInfo = await buildSmallObjectsPrompt(denseLabels, 'a_baseline')
        }
        const phrases = extractedPromptInfo.extracted

        for (const phrase of phrases) {
          const dinoWf = buildSceneDinoWorkflow({
            image_filename: imageFilename,
            prompt: phrase,
            threshold: 0.40,
          })
          const dinoResult = await queuePrompt(dinoWf)
          if (dinoResult.node_errors && Object.keys(dinoResult.node_errors).length > 0) {
            console.warn(`[analyze-scene] DINO rejected for "${phrase}":`, dinoResult.node_errors)
            continue
          }
          const dinoHistory = await pollUntilDone(dinoResult.prompt_id, 60 * 1000)
          if (!dinoHistory) continue

          const textNode = (dinoHistory.outputs['4'] as unknown as { text_files?: ComfyImage[] }) ?? {}
          const textFiles = textNode.text_files ?? []
          if (textFiles.length === 0) continue

          const buf = await fetchAndDispose(textFiles[0].filename, textFiles[0].subfolder, textFiles[0].type)
          const txt = buf.toString('utf-8').trim()
          let bboxesPx: number[][] = []
          try { bboxesPx = JSON.parse(txt) as number[][] } catch { continue }

          // Normalise pixels DINO → 0-1 et label = phrase
          for (const b of bboxesPx) {
            if (!Array.isArray(b) || b.length !== 4) continue
            secondaryDetections.push({
              label: phrase,
              bbox: [b[0] / Wsrc, b[1] / Hsrc, b[2] / Wsrc, b[3] / Hsrc] as [number, number, number, number],
              source: 'od',
            })
          }
        }
      } catch (err) {
        console.warn('[analyze-scene] DINO pass failed:', err)
      }
    } else if (extraction_strategy === 'f_qwen_sam1hq') {
      // Pipeline aligné sur ai-cut-playground : Florence (descriptions) →
      // Qwen (objets purs) → DINO+SAM 1 HQ combinés via storyicon → N masks
      // par phrase. JETTE les Florence dense_region.
      try {
        const denseLabels = detections0.map(d => d.label)
        extractedPromptInfo = await extractObjectsViaQwen(denseLabels)
        const phrases = extractedPromptInfo.extracted

        for (const phrase of phrases) {
          const wf = buildSceneDinoSAM1Workflow({
            image_filename: imageFilename,
            prompt: phrase,
            threshold: 0.20,
          })
          const wfResult = await queuePrompt(wf)
          if (wfResult.node_errors && Object.keys(wfResult.node_errors).length > 0) {
            console.warn(`[f_qwen_sam1hq] rejected for "${phrase}":`, wfResult.node_errors)
            continue
          }
          const wfHistory = await pollUntilDone(wfResult.prompt_id, 90 * 1000)
          if (!wfHistory) continue

          // SaveImage retourne un BATCH d'images (1 par bbox détectée)
          const outputs = wfHistory.outputs['6'] as unknown as { images?: ComfyImage[] }
          const imgs = outputs?.images ?? []

          for (let i = 0; i < imgs.length; i++) {
            const img = imgs[i]
            const maskBuf = await fetchAndDispose(img.filename, img.subfolder, img.type)
            const bboxPx = await bboxFromMaskBuffer(maskBuf, Wsrc, Hsrc)
            if (!bboxPx) continue

            const safePhrase = phrase.replace(/[^a-z0-9]+/gi, '_')
            const path = `temp/scene_${tsEarly}_${safePhrase}_${i}.png`
            const { error: upErr } = await supabaseEarly.storage.from('images').upload(path, maskBuf, {
              contentType: 'image/png', upsert: true,
            })
            if (upErr) {
              console.warn(`[f_qwen_sam1hq] supabase upload failed for ${path}:`, upErr.message)
              continue
            }
            const maskUrl = supabaseEarly.storage.from('images').getPublicUrl(path).data.publicUrl

            preCompletedDetections.push({
              id: `obj_${tsEarly}_${safePhrase}_${i}`,
              label: phrase,
              source: 'od',
              bbox: [bboxPx[0] / Wsrc, bboxPx[1] / Hsrc, bboxPx[2] / Wsrc, bboxPx[3] / Hsrc],
              bbox_pixels: bboxPx,
              mask_url: maskUrl,
            })
          }
        }
      } catch (err) {
        console.warn('[analyze-scene] f_qwen_sam1hq pipeline failed:', err)
      }
    }

    // Merge : dense_region_caption (descriptions riches) PRIORITAIRES,
    // secondaires (CTPG/OD = objets individuels) ajoutés seulement si non-recouvrants.
    //
    // Cas spéciaux qui bypass le merge :
    //   - e_qwen_dino    : on JETTE les Florence dense_region, on garde DINO seul
    //   - f_qwen_sam1hq  : pipeline complet déjà fait (preCompletedDetections),
    //                       mergedDetections vide → SAM loop ne tourne pas
    let mergedDetections: ParsedDetection[]
    if (extraction_strategy === 'f_qwen_sam1hq') {
      mergedDetections = []
    } else if (extraction_strategy === 'e_qwen_dino') {
      mergedDetections = secondaryDetections
    } else {
      mergedDetections = mergeWithIoU(detections0, secondaryDetections, 0.5)
    }

    // Filtres selon le mode :
    //   - baseline    : area < 0.85 (élimine juste la caption globale 100%)
    //   - area_strict : area < 0.4 (élimine aussi la "scène réduite" 44% type "modern living room")
    //   - keywords    : détecte les labels scéniques (qui commencent par adj? + room/view/...)
    //                   sans matcher "in living room" en fin de phrase
    //   - combined    : area < 0.4 + pas de label scénique
    //
    // SCENE_START_RE : le label COMMENCE par un adjectif optionnel + un nom de scène.
    //   ✓ "modern living room with garden view" → match
    //   ✗ "beige leather sofa with blue throw pillows in living room" → no match
    //                                                                    (commence par "beige")
    const filteredDetections = applyDetectionFilter(mergedDetections, filter_mode)

    const W = Wsrc
    const H = Hsrc

    // Réutilise les variables déclarées tôt (supabaseEarly + tsEarly)
    const supabase = supabaseEarly
    const ts = tsEarly
    const detections: Array<{
      id: string
      label: string
      source: 'dense' | 'od'
      bbox: [number, number, number, number]
      bbox_pixels: [number, number, number, number]
      mask_url: string | null
      error?: string
    }> = []

    // Si une stratégie a déjà tout pré-rempli (cf f_qwen_sam1hq), on ajoute
    // ses détections au résultat final. mergedDetections est vide pour ces
    // stratégies, donc le SAM loop plus bas ne tournera pas.
    if (preCompletedDetections.length > 0) {
      detections.push(...preCompletedDetections)
    }

    // [2] SAM : per-instance OU groupé par classe selon group_by_class
    const primaryMaskBufs: Buffer[] = []

    if (group_by_class) {
      // Groupe les détections par label, puis 1 SAM call par groupe avec
      // toutes les bboxes en input (Sam2Segmentation retourne 1 mask agrégé).
      const groups = new Map<string, ParsedDetection[]>()
      for (const d of filteredDetections) {
        const arr = groups.get(d.label) ?? []
        arr.push(d)
        groups.set(d.label, arr)
      }

      let groupIdx = 0
      for (const [label, group] of groups) {
        const bboxesPx: Array<[number, number, number, number]> = group.map(d => [
          Math.round(d.bbox[0] * W),
          Math.round(d.bbox[1] * H),
          Math.round(d.bbox[2] * W),
          Math.round(d.bbox[3] * H),
        ])
        // Bbox englobante pour l'affichage UI
        const unionBboxPx: [number, number, number, number] = [
          Math.min(...bboxesPx.map(b => b[0])),
          Math.min(...bboxesPx.map(b => b[1])),
          Math.max(...bboxesPx.map(b => b[2])),
          Math.max(...bboxesPx.map(b => b[3])),
        ]
        const unionBbox: [number, number, number, number] = [
          unionBboxPx[0] / W, unionBboxPx[1] / H,
          unionBboxPx[2] / W, unionBboxPx[3] / H,
        ]

        const r = await runSamForBboxes({
          imageFilename, bboxes: bboxesPx, supabase, ts,
          label: `${label} (×${group.length})`,
          key: `${ts}_g${groupIdx}`,
        })
        if (r.maskBuf) primaryMaskBufs.push(r.maskBuf)

        detections.push({
          id: `obj_${ts}_g${groupIdx}`,
          label: group.length > 1 ? `${label} (×${group.length})` : label,
          source: group[0].source ?? 'dense',
          bbox: unionBbox,
          bbox_pixels: unionBboxPx,
          mask_url: r.maskUrl,
          error: r.error,
        })
        groupIdx++
      }
    } else {
      // Per-instance (comportement par défaut) : 1 SAM call par bbox
      for (let i = 0; i < filteredDetections.length; i++) {
        const det = filteredDetections[i]
        const [nx1, ny1, nx2, ny2] = det.bbox
        const bboxPx: [number, number, number, number] = [
          Math.round(nx1 * W),
          Math.round(ny1 * H),
          Math.round(nx2 * W),
          Math.round(ny2 * H),
        ]

        // Dispatcher selon la stratégie : SAM bbox / SAM point / SAM bbox+point
        let r: { maskUrl: string | null; maskBuf: Buffer | null; error?: string }
        if (extraction_strategy === 'g_florence_centerpoint') {
          // Option 1 : SAM avec POINT au centre uniquement (bbox ignorée)
          const cx = Math.round((bboxPx[0] + bboxPx[2]) / 2)
          const cy = Math.round((bboxPx[1] + bboxPx[3]) / 2)
          r = await runSamForPoint({
            imageFilename, point: [cx, cy], supabase, ts, label: det.label, key: `${ts}_${i}_pt`,
          })
        } else if (extraction_strategy === 'h_florence_bbox_point') {
          // Option 3 : SAM avec BBOX + POINT au centre combinés
          const cx = Math.round((bboxPx[0] + bboxPx[2]) / 2)
          const cy = Math.round((bboxPx[1] + bboxPx[3]) / 2)
          r = await runSamForBboxPoint({
            imageFilename, bboxPx, point: [cx, cy], supabase, ts, label: det.label, key: `${ts}_${i}_bp`,
          })
        } else {
          // Default : SAM avec bbox uniquement (Option 2 = stratégie 'none')
          r = await runSamForBbox({
            imageFilename, bboxPx, supabase, ts, label: det.label, key: `${ts}_${i}`,
          })
        }
        if (r.maskBuf) primaryMaskBufs.push(r.maskBuf)

        detections.push({
          id: `obj_${ts}_${i}`,
          label: det.label,
          source: det.source ?? 'dense',
          bbox: det.bbox,
          bbox_pixels: bboxPx,
          mask_url: r.maskUrl,
          error: r.error,
        })
      }
    }

    // ── c_erase : 2ème pass Florence sur image cleanée ────────────────
    let cleanedImageUrl: string | undefined
    let eraseDebug: {
      step: string
      raw_caption?: string
      parsed_count?: number
      after_filter_count?: number
      after_iou_count?: number
      florence_errors?: unknown
      error?: string
    } = { step: 'not_started' }
    if (extraction_strategy === 'c_erase' && primaryMaskBufs.length > 0) {
      try {
        eraseDebug = { step: 'composing_image' }
        const cleanedBuf = await composeCleanedImage(image_url, primaryMaskBufs, W, H)
        const cleanedPath = `temp/scene_${ts}_cleaned.png`
        const { error: upErrC } = await supabase.storage.from('images').upload(cleanedPath, cleanedBuf, {
          contentType: 'image/png', upsert: true,
        })
        if (!upErrC) cleanedImageUrl = supabase.storage.from('images').getPublicUrl(cleanedPath).data.publicUrl

        eraseDebug = { step: 'uploading_to_comfyui' }
        const cleanedFilename = await uploadImageToComfyUI(cleanedBuf, `cleaned_${ts}.png`)

        eraseDebug = { step: 'running_florence_2' }
        const florence2Wf = buildSceneFlorenceWorkflow({ image_filename: cleanedFilename, florence_model: model })
        const florence2Result = await queuePrompt(florence2Wf)
        if (florence2Result.node_errors && Object.keys(florence2Result.node_errors).length > 0) {
          eraseDebug = { step: 'florence_2_node_errors', florence_errors: florence2Result.node_errors }
        } else {
          const florence2History = await pollUntilDone(florence2Result.prompt_id, 120 * 1000)
          if (!florence2History) {
            eraseDebug = { step: 'florence_2_timeout' }
          } else {
            const text2 = (florence2History.outputs['4'] as unknown as { text_files?: ComfyImage[] }) ?? {}
            const text2Files = text2.text_files ?? []
            if (text2Files.length === 0) {
              eraseDebug = { step: 'florence_2_no_text_output' }
            } else {
              const cap2Buf = await fetchAndDispose(text2Files[0].filename, text2Files[0].subfolder, text2Files[0].type)
              const cap2Text = cap2Buf.toString('utf-8')
              const parsed = parseFlorenceCaptionWithLocs(cap2Text)
              // Applique le MÊME filtre que pour le 1er pass (le user a choisi un mode)
              const afterFilter = applyDetectionFilter(parsed, filter_mode)
                .map(d => ({ ...d, source: 'od' as const }))
              const reallyNew = afterFilter.filter(nd =>
                !filteredDetections.some(p => iou(nd.bbox, p.bbox) >= 0.5)
              )
              eraseDebug = {
                step: 'done',
                raw_caption: cap2Text.slice(0, 1500),
                parsed_count: parsed.length,
                after_filter_count: afterFilter.length,
                after_iou_count: reallyNew.length,
              }

              // SAM chaque nouvelle détection sur l'image ORIGINALE
              for (let i = 0; i < reallyNew.length; i++) {
                const det = reallyNew[i]
                const [nx1, ny1, nx2, ny2] = det.bbox
                const bboxPx: [number, number, number, number] = [
                  Math.round(nx1 * W), Math.round(ny1 * H),
                  Math.round(nx2 * W), Math.round(ny2 * H),
                ]
                const r = await runSamForBbox({
                  imageFilename, bboxPx, supabase, ts, label: det.label, key: `${ts}_erase_${i}`,
                })
                detections.push({
                  id: `obj_erase_${ts}_${i}`,
                  label: det.label,
                  source: 'od',
                  bbox: det.bbox,
                  bbox_pixels: bboxPx,
                  mask_url: r.maskUrl,
                  error: r.error,
                })
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[analyze-scene] c_erase pipeline failed:', msg)
        eraseDebug = { ...eraseDebug, error: msg }
      }
    }

    // ── Persistance dans scene_analyses (cache pour reload + cross-scene) ─
    // Upsert par image_url. Ignoré silencieusement si erreur DB (pas bloquant).
    try {
      const { error: cacheUpsertErr } = await supabaseEarly
        .from('scene_analyses')
        .upsert({
          image_url,
          strategy: extraction_strategy,
          detections: detections,
          image_width: W,
          image_height: H,
          analyzed_at: new Date(ts).toISOString(),
        }, { onConflict: 'image_url' })
      if (cacheUpsertErr) {
        console.warn('[analyze-scene] cache upsert failed:', cacheUpsertErr.message)
      }
    } catch (err) {
      console.warn('[analyze-scene] cache upsert exception:', err)
    }

    return NextResponse.json({
      detections,
      image_url,
      analyzed_at: ts,
      image_size: { width: W, height: H },
      filter_mode,
      extraction_strategy,
      extraction_prompt: extractedPromptInfo.prompt,
      extraction_extracted_words: extractedPromptInfo.extracted,
      cleaned_image_url: cleanedImageUrl,
      erase_debug: eraseDebug,
      kept: filteredDetections.length,
      total_florence: detections0.length,
      total_od: secondaryDetections.length,
      total_merged: mergedDetections.length,
      from_cache: false,
      // Debug : expose les détections OD/CTPG brutes + leur status après merge
      od_raw: secondaryDetections.map(d => {
        const dropped = !mergedDetections.some(m => m.label === d.label && m.source === 'od' &&
          m.bbox[0] === d.bbox[0] && m.bbox[1] === d.bbox[1])
        return { label: d.label, bbox: d.bbox, dropped_by_iou: dropped }
      }),
      dense_raw: detections0.map(d => ({ label: d.label, bbox: d.bbox })),
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[comfyui/analyze-scene] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * DELETE /api/comfyui/analyze-scene
 *
 * Supprime l'analyse complète d'une image :
 *   - Tous les mask PNG dans Supabase storage (extraits des mask_urls)
 *   - La ligne scene_analyses pour cette image_url
 *
 * Body : { image_url: string }
 *
 * Cas d'usage : clic "Nouvelle base" en Phase B → l'utilisateur veut repartir
 * de zéro, on libère le storage et la DB de l'ancienne analyse.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { image_url } = await req.json() as { image_url?: string }
    if (!image_url) {
      return NextResponse.json({ error: 'image_url requis' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // 1. Récupère les détections existantes pour extraire les paths storage
    const { data: row } = await supabase
      .from('scene_analyses')
      .select('detections')
      .eq('image_url', image_url)
      .maybeSingle()

    let removedFiles = 0
    if (row && Array.isArray(row.detections)) {
      const paths: string[] = []
      for (const d of row.detections as Array<{ mask_url?: string }>) {
        if (!d.mask_url) continue
        const m = d.mask_url.match(/\/object\/public\/images\/(.+)$/)
        if (m) paths.push(m[1])
      }
      if (paths.length > 0) {
        const { error: delStorageErr } = await supabase.storage.from('images').remove(paths)
        if (delStorageErr) {
          console.warn('[DELETE analyze-scene] storage cleanup failed:', delStorageErr.message)
        } else {
          removedFiles = paths.length
        }
      }
    }

    // 2. Supprime la ligne DB
    const { error: delDbErr } = await supabase
      .from('scene_analyses')
      .delete()
      .eq('image_url', image_url)

    if (delDbErr) {
      console.warn('[DELETE analyze-scene] db row delete failed:', delDbErr.message)
    }

    console.log(`[DELETE analyze-scene] cleaned : ${removedFiles} mask(s) + 1 row pour ${image_url.slice(-40)}`)
    return NextResponse.json({
      ok: true,
      removed_files: removedFiles,
      removed_db_row: !delDbErr,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[DELETE analyze-scene] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function pollUntilDone(promptId: string, maxWaitMs: number) {
  const startT = Date.now()
  while (Date.now() - startT < maxWaitMs) {
    await new Promise(r => setTimeout(r, 1500))
    const history = await getHistory(promptId)
    if (!history) continue
    if (history.status.completed) return history
    if (history.status.status_str === 'error') return null
  }
  return null
}

interface ParsedDetection {
  label: string
  bbox: [number, number, number, number]   // normalisé 0-1
  source?: 'dense' | 'od'
}

function parseFlorenceCaptionWithLocs(caption: string): ParsedDetection[] {
  const cleaned = caption.replace(/<\/?s>/g, '').trim()
  const regex = /([^<]+?)<loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)>/g
  const results: ParsedDetection[] = []
  let match
  while ((match = regex.exec(cleaned)) !== null) {
    const label = match[1].trim()
    if (!label) continue
    const x1 = parseInt(match[2], 10) / 1000
    const y1 = parseInt(match[3], 10) / 1000
    const x2 = parseInt(match[4], 10) / 1000
    const y2 = parseInt(match[5], 10) / 1000
    results.push({ label, bbox: [x1, y1, x2, y2], source: 'dense' })
  }
  return results
}

/**
 * Merge deux listes de détections en gardant les "primary" (dense) prioritaires.
 * Les détections "secondary" (od) sont ajoutées seulement si IoU < threshold
 * avec toutes les primary (= elles apportent un objet nouveau).
 */
function mergeWithIoU(
  primary: ParsedDetection[],
  secondary: ParsedDetection[],
  iouThreshold = 0.5,
): ParsedDetection[] {
  const result: ParsedDetection[] = primary.map(d => ({ ...d, source: d.source ?? 'dense' }))
  for (const s of secondary) {
    const overlapsExisting = result.some(p => iou(s.bbox, p.bbox) >= iouThreshold)
    if (!overlapsExisting) {
      result.push({ ...s, source: 'od' })
    }
  }
  return result
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const [ax1, ay1, ax2, ay2] = a
  const [bx1, by1, bx2, by2] = b
  const ix1 = Math.max(ax1, bx1)
  const iy1 = Math.max(ay1, by1)
  const ix2 = Math.min(ax2, bx2)
  const iy2 = Math.min(ay2, by2)
  if (ix2 <= ix1 || iy2 <= iy1) return 0
  const inter = (ix2 - ix1) * (iy2 - iy1)
  const areaA = (ax2 - ax1) * (ay2 - ay1)
  const areaB = (bx2 - bx1) * (by2 - by1)
  return inter / (areaA + areaB - inter)
}

/**
 * Construit un prompt CTPG (multi-objets séparés par ". ") selon la stratégie :
 *
 * - 'a_pure'     : extraction regex "with X" depuis les descriptions Florence,
 *                  filtrée via stop list de sous-parties (frame, leg, top, leaves…)
 * - 'a_baseline' : a_pure + baseline d'objets d'intérieur courants
 * - 'b_qwen'     : Qwen analyse les descriptions et liste les objets standalone
 *
 * Retour : { prompt, extracted, method } où extracted est la liste des phrases
 * pour debug dans l'UI.
 */
async function buildSmallObjectsPrompt(
  descriptions: string[],
  strategy: ExtractionStrategy,
): Promise<{ prompt: string; extracted: string[]; method: string }> {
  // Mots qui désignent des sous-parties de meubles (à exclure de l'extraction).
  // Important : pas de "cushion" ici car c'est un objet standalone (sur un fauteuil).
  const SUBPART_WORDS = new Set([
    'frame', 'frames', 'leg', 'legs', 'top', 'tops', 'leaves', 'leaf',
    'view', 'views', 'pot', 'pots', 'handle', 'handles', 'edge', 'edges',
    'side', 'sides', 'corner', 'corners', 'arm', 'arms', 'back', 'backs',
    'seat', 'seats', 'base', 'bases', 'lid', 'lids', 'shelf', 'shelves',
    'bottom', 'bottoms', 'panel', 'panels',
  ])

  // Petits objets d'intérieur courants (utilisés en a_baseline)
  const BASELINE = ['pillow', 'cushion', 'lamp', 'vase', 'painting', 'candle', 'book', 'mirror', 'clock', 'flower']

  if (strategy === 'b_qwen') {
    try {
      const result = await ollamaJSON<{ objects?: string[] }>({
        system: `You are a vision assistant helping an open-vocabulary object detector find SMALL STANDALONE OBJECTS.
You'll receive a list of dense region descriptions of a scene.
Your job: extract the small objects mentioned WITHIN the descriptions that are NOT the main subject and ARE standalone things (not sub-parts of furniture).

Rules:
- INCLUDE small objects: pillow, cushion, lamp, vase, candle, book, mirror, clock, painting, frame (when standalone like picture frame), flower, blanket, throw.
- EXCLUDE sub-parts of furniture: frame (when of a chair), legs, top, back, seat, arms, base, edges, sides, corners, handles, leaves (of plant), pot.
- EXCLUDE non-object terms: view, scene, landscape, room, garden.
- Output JSON: {"objects": ["pillow", "cushion", ...]} lowercased, deduped, max 8 items.`,
        prompt: `Descriptions:\n${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\nReply ONLY with JSON.`,
        timeoutMs: 30_000,
      })
      const objects = (result.objects ?? []).map(s => String(s).trim().toLowerCase()).filter(Boolean)
      const dedup = Array.from(new Set(objects))
      return {
        prompt: dedup.join('. '),
        extracted: dedup,
        method: 'b_qwen',
      }
    } catch (err) {
      console.warn('[analyze-scene] Qwen extraction failed, fallback to a_baseline:', err)
      // Fallback heuristique
      strategy = 'a_baseline'
    }
  }

  // a_pure / a_baseline : regex extraction
  const extracted: string[] = []
  const seen = new Set<string>()
  const ADD_PATTERN = /\bwith\s+([a-z\s]+?)(?:\s+(?:in|on|of|and|that|which|by|under|over|near|inside)\b|$)/gi

  for (const desc of descriptions) {
    const lower = desc.toLowerCase()
    let m: RegExpExecArray | null
    ADD_PATTERN.lastIndex = 0
    while ((m = ADD_PATTERN.exec(lower)) !== null) {
      const phrase = m[1].trim()
      if (!phrase) continue
      const lastWord = phrase.split(/\s+/).pop() ?? ''
      if (SUBPART_WORDS.has(lastWord)) continue
      // Limite à phrases de 1-3 mots (DINO/CTPG préfèrent du concis)
      const tokens = phrase.split(/\s+/)
      const trimmed = tokens.length > 3 ? tokens.slice(-3).join(' ') : phrase
      if (!seen.has(trimmed)) {
        seen.add(trimmed)
        extracted.push(trimmed)
      }
    }
  }

  if (strategy === 'a_baseline') {
    for (const b of BASELINE) {
      // N'ajoute que si pas déjà présent (in extracted) ni mentionné dans dense
      const alreadyIn = extracted.some(e => e.includes(b))
      const inDense = descriptions.some(d => d.toLowerCase().includes(b))
      if (!alreadyIn && !inDense && !seen.has(b)) {
        seen.add(b)
        extracted.push(b)
      }
    }
  }

  return {
    prompt: extracted.join('. '),
    extracted,
    method: strategy,
  }
}

/**
 * MODE DRILL-DOWN : pour chaque détection existante dont le label est pluriel
 * ou compound (ex: "throw pillows", "shelf with bottles", "table of bowls"),
 * crop l'image source à sa bbox et re-analyse le crop pour découvrir des
 * sous-objets plus fins. Replace l'originale par les nouvelles détections
 * trouvées (ou garde l'originale si rien trouvé).
 *
 * Singular labels (atomic, ex: "wooden chair", "houseplant") sont gardées
 * telles quelles sans drill-down.
 */
async function handleDrilldown(params: {
  image_url: string
  model: 'base' | 'large'
  filter_mode: FilterMode
  extraction_strategy: ExtractionStrategy
}): Promise<NextResponse> {
  const { image_url, model, filter_mode, extraction_strategy } = params

  if (!(await isServerRunning())) {
    return NextResponse.json({ error: 'ComfyUI n\'est pas démarré.' }, { status: 503 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1. Récupère les détections existantes depuis scene_analyses
  const { data: cachedRow } = await supabase
    .from('scene_analyses')
    .select('detections, image_width, image_height')
    .eq('image_url', image_url)
    .maybeSingle()

  if (!cachedRow || !Array.isArray(cachedRow.detections) || cachedRow.detections.length === 0) {
    return NextResponse.json({
      error: 'Aucune détection existante. Lance d\'abord une analyse fresh.',
    }, { status: 400 })
  }

  const existing = cachedRow.detections as Array<{
    id: string
    label: string
    source?: 'dense' | 'od'
    bbox: [number, number, number, number]
    bbox_pixels: [number, number, number, number]
    mask_url: string | null
  }>
  const sourceW = (cachedRow.image_width as number) || 1
  const sourceH = (cachedRow.image_height as number) || 1
  const ts = Date.now()

  // 2. Charge l'image source UNE FOIS en mémoire (ré-utilisée pour les crops)
  const sourceBuf = await fetchImageAsBuffer(image_url)

  // 3. Loop sur chaque détection
  const result: typeof existing = []
  const oldMasksToDelete: string[] = []
  let drillCount = 0
  let keptCount = 0

  for (const det of existing) {
    if (!shouldDrilldown(det.label)) {
      // Atomique → garde tel quel
      result.push(det)
      keptCount++
      continue
    }

    const [x1, y1, x2, y2] = det.bbox_pixels
    const cropW = x2 - x1
    const cropH = y2 - y1

    // Skip si crop trop petit (Florence/DINO ne donneraient rien d'utile)
    if (cropW < 100 || cropH < 100) {
      result.push(det)
      keptCount++
      continue
    }

    console.log(`[drilldown] ${det.label} (bbox ${cropW}×${cropH}) → analyse du crop…`)

    let newDetections: typeof existing = []
    try {
      // Crop l'image à la bbox
      const cropBuf = await sharp(sourceBuf)
        .extract({ left: x1, top: y1, width: cropW, height: cropH })
        .png()
        .toBuffer()
      const cropFilename = await uploadImageToComfyUI(cropBuf, `drill_${det.id}_${ts}.png`)

      // Florence dense_region_caption sur le crop
      const florenceWf = buildSceneFlorenceWorkflow({ image_filename: cropFilename, florence_model: model })
      const florenceResult = await queuePrompt(florenceWf)
      const florenceHistory = await pollUntilDone(florenceResult.prompt_id, 90 * 1000)
      if (!florenceHistory) throw new Error('Timeout Florence sur crop')

      const text = (florenceHistory.outputs['4'] as unknown as { text_files?: ComfyImage[] })?.text_files ?? []
      if (text.length === 0) throw new Error('Pas de caption Florence')
      const captionBuf = await fetchAndDispose(text[0].filename, text[0].subfolder, text[0].type)
      const captionText = captionBuf.toString('utf-8')
      const subDetections = parseFlorenceCaptionWithLocs(captionText)
        .filter(d => {
          const [bx1, by1, bx2, by2] = d.bbox
          const area = (bx2 - bx1) * (by2 - by1)
          return area < 0.85   // drop la caption globale du crop
        })

      // Qwen extrait les mots-objets purs
      const denseLabels = subDetections.map(d => d.label)
      const extracted = await extractObjectsViaQwen(denseLabels)
      const phrases = extracted.extracted

      // Pour chaque phrase, DINO+SAM 1 HQ sur le crop → masks crop-relatifs
      for (const phrase of phrases) {
        const wf = buildSceneDinoSAM1Workflow({
          image_filename: cropFilename,
          prompt: phrase,
          threshold: 0.30,
        })
        const wfResult = await queuePrompt(wf)
        if (wfResult.node_errors && Object.keys(wfResult.node_errors).length > 0) continue
        const wfHistory = await pollUntilDone(wfResult.prompt_id, 90 * 1000)
        if (!wfHistory) continue
        const imgs = ((wfHistory.outputs['6'] as unknown as { images?: ComfyImage[] })?.images) ?? []

        for (let i = 0; i < imgs.length; i++) {
          const cropMaskBuf = await fetchAndDispose(imgs[i].filename, imgs[i].subfolder, imgs[i].type)
          // Compose un mask full-size (sourceW × sourceH) en collant le crop mask à l'offset
          const fullMaskBuf = await sharp({
            create: { width: sourceW, height: sourceH, channels: 3, background: { r: 0, g: 0, b: 0 } },
          })
            .composite([{ input: cropMaskBuf, left: x1, top: y1 }])
            .png()
            .toBuffer()

          const bboxPx = await bboxFromMaskBuffer(fullMaskBuf, sourceW, sourceH)
          if (!bboxPx) continue

          const safePhrase = phrase.replace(/[^a-z0-9]+/gi, '_')
          const path = `temp/scene_${ts}_drill_${det.id}_${safePhrase}_${i}.png`
          const { error: upErr } = await supabase.storage.from('images').upload(path, fullMaskBuf, {
            contentType: 'image/png', upsert: true,
          })
          if (upErr) continue
          const maskUrl = supabase.storage.from('images').getPublicUrl(path).data.publicUrl

          newDetections.push({
            id: `obj_drill_${ts}_${det.id}_${safePhrase}_${i}`,
            label: phrase,
            source: 'od',
            bbox: [bboxPx[0] / sourceW, bboxPx[1] / sourceH, bboxPx[2] / sourceW, bboxPx[3] / sourceH],
            bbox_pixels: bboxPx,
            mask_url: maskUrl,
          })
        }
      }
    } catch (err) {
      console.warn(`[drilldown] failed for ${det.label}:`, err)
      newDetections = []
    }

    if (newDetections.length === 0) {
      // Q1 : aucun nouveau trouvé → garde l'originale
      result.push(det)
      keptCount++
    } else {
      // Marque l'ancien mask pour suppression Supabase storage
      if (det.mask_url) {
        const m = det.mask_url.match(/\/object\/public\/images\/(.+)$/)
        if (m) oldMasksToDelete.push(m[1])
      }
      result.push(...newDetections)
      drillCount++
    }
  }

  // 4. Filter combined sur le résultat final
  const filtered = applyDetectionFilter(
    result.map(d => ({ label: d.label, bbox: d.bbox, source: d.source })),
    filter_mode,
  )
  const filteredIds = new Set(filtered.map((_, i) => i))
  const finalResult = result.filter((_, i) => filteredIds.has(i))

  // 5. Cleanup : supprime les anciens masks remplacés
  if (oldMasksToDelete.length > 0) {
    const { error: delErr } = await supabase.storage.from('images').remove(oldMasksToDelete)
    if (!delErr) console.log(`[drilldown] cleanup : ${oldMasksToDelete.length} anciens masks supprimés`)
  }

  // 6. UPSERT dans scene_analyses
  await supabase.from('scene_analyses').upsert({
    image_url,
    strategy: extraction_strategy,
    detections: finalResult,
    image_width: sourceW,
    image_height: sourceH,
    analyzed_at: new Date(ts).toISOString(),
  }, { onConflict: 'image_url' })

  console.log(`[drilldown] terminé : ${drillCount} drillées, ${keptCount} gardées (atomic ou skip), ${finalResult.length} total`)

  return NextResponse.json({
    detections: finalResult,
    image_url,
    analyzed_at: ts,
    image_size: { width: sourceW, height: sourceH },
    extraction_strategy,
    filter_mode,
    mode: 'drilldown',
    drill_stats: { drilled: drillCount, kept: keptCount, total: finalResult.length },
  })
}

/**
 * Heuristique : drill-down si label compound (with/and/of) OU pluriel (ends in 's'
 * mais pas 'ss', 'us', 'is' qui sont des singuliers terminés en 's').
 */
function shouldDrilldown(label: string): boolean {
  const lower = label.toLowerCase().trim()
  // Compound : présence d'un connecteur indiquant un objet contenant un autre
  if (/\b(with|and|of)\b/.test(lower)) return true
  // Pluriel : dernier mot finit par 's' (sauf cas piège)
  const lastWord = lower.split(/\s+/).pop() ?? ''
  if (lastWord.length > 2 && lastWord.endsWith('s') &&
      !lastWord.endsWith('ss') &&
      !lastWord.endsWith('us') &&
      !lastWord.endsWith('is')) {
    return true
  }
  return false
}

/** Charge une image source (URL Supabase ou autre) en Buffer pour cropping. */
async function fetchImageAsBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch source image failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Mots indiquant qu'une détection est un personnage (humain ou créature
 *  agentique) → toujours gardée même si grosse, car c'est le sujet du plan. */
const CHARACTER_KEYWORDS_RE = /\b(person|people|man|men|woman|women|child|children|kid|kids|baby|character|figure|human|knight|warrior|wizard|sorcerer|sorceress|hero|heroine|villain|npc|guard|soldier|king|queen|princess|prince|lord|lady|monk|priest|priestess|merchant|innkeeper|barmaid|barman|bartender|adventurer|fighter|mage|archer|paladin|rogue|thief|bard|druid|necromancer|ranger|noble|peasant|farmer|blacksmith|orc|elf|dwarf|goblin|troll|dragon|demon|ghost|spirit|skeleton|zombie|cat|dog|horse|wolf|bear|bird|fish|creature|beast|monster|animal)\b/i

/** Mots d'objets architecturaux/structurels → toujours filtrés (décor de la
 *  scène, pas des objets manipulables individuellement). */
const STRUCTURAL_KEYWORDS_RE = /\b(wall|walls|ceiling|ceilings|beam|beams|rafter|rafters|floor|floors|ground|roof|sky|background|archway|arch|arches|pillar|pillars|column|columns|stonework|masonry|brickwork|brick|bricks|tile|tiles|paving|pavement|cobblestone|cobblestones|fireplace|chimney|window|windows|door|doors|doorway|window\s+frame|window\s+pane|window\s+sill|stone\s+wall|wooden\s+beam|wooden\s+beams|ceiling\s+beam|ceiling\s+beams|stone|stones|wood|woods)\b/i

/**
 * Filtre commun appliqué sur toutes les listes de détections (primaire + 2ème pass).
 *   - baseline    : area < 0.85
 *   - area_strict : area < 0.4
 *   - keywords    : area < 0.85 + label ne commence pas par un mot scénique
 *   - combined    : area < 0.4 + non-scénique
 * + drop des bboxes minuscules (< 0.001) qui sont du bruit.
 *
 * Filtre additionnel automatique (toutes les modes) :
 *   - Drop si label STRUCTURAL (wall, ceiling, beam, window, etc.)
 *     → ces éléments sont du décor, pas des objets manipulables
 *   - Drop si area > 0.25 ET label N'EST PAS un personnage (character, knight,
 *     person, etc.) → les gros objets non-personnages sont du fond
 */
function applyDetectionFilter(detections: ParsedDetection[], mode: FilterMode): ParsedDetection[] {
  const SCENE_START_RE = /^(modern\s+|contemporary\s+|traditional\s+|rustic\s+|luxurious\s+|minimalist\s+|luxury\s+|cozy\s+|spacious\s+|stylish\s+|elegant\s+)*(living\s+room|bedroom|kitchen|bathroom|dining\s+room|hallway|interior|landscape|garden\s+view|view\s+of|scene)\b/i
  return detections.filter(d => {
    const [x1, y1, x2, y2] = d.bbox
    const area = (x2 - x1) * (y2 - y1)
    if (area < 0.001) return false

    // Drop les labels structurels/architecturaux (décor, pas objets)
    if (STRUCTURAL_KEYWORDS_RE.test(d.label)) return false

    // Drop les gros objets non-personnages (area > 0.25 sauf character)
    const isCharacter = CHARACTER_KEYWORDS_RE.test(d.label)
    if (area > 0.25 && !isCharacter) return false

    const isScenic = SCENE_START_RE.test(d.label)
    switch (mode) {
      case 'area_strict': return area < 0.4
      case 'keywords':    return area < 0.85 && !isScenic
      case 'combined':    return area < 0.4 && !isScenic
      case 'baseline':
      default:            return area < 0.85
    }
  })
}

/**
 * Lance SAM 2 pour N bboxes et retourne 1 mask agrégé (union des N segmentations).
 * Utilisé en mode group_by_class pour fusionner toutes les instances d'une classe.
 */
async function runSamForBboxes(p: {
  imageFilename: string
  bboxes: Array<[number, number, number, number]>
  supabase: ReturnType<typeof createClient>
  label: string
  path: string
}): Promise<{ maskUrl: string | null; maskBuf: Buffer | null; error?: string }> {
  try {
    const samWf = buildSceneSAMMultiBboxWorkflow({ image_filename: p.imageFilename, bboxes: p.bboxes })
    const samResult = await queuePrompt(samWf)
    if (samResult.node_errors && Object.keys(samResult.node_errors).length > 0) {
      throw new Error(`SAM rejected: ${JSON.stringify(samResult.node_errors).slice(0, 200)}`)
    }
    const samHistory = await pollUntilDone(samResult.prompt_id, 90 * 1000)
    if (!samHistory) throw new Error('Timeout SAM')

    const outputs = samHistory.outputs['6'] as unknown as { images?: ComfyImage[] }
    const imgInfo = outputs?.images?.[0]
    if (!imgInfo) throw new Error(`Pas d'image dans history.outputs['6']`)

    const maskBuf = await fetchAndDispose(imgInfo.filename, imgInfo.subfolder, imgInfo.type)
    const path = p.path
    const { error: upErr } = await p.supabase.storage.from('images').upload(path, maskBuf, {
      contentType: 'image/png', upsert: true,
    })
    if (upErr) throw new Error(`Supabase upload failed: ${upErr.message}`)
    const maskUrl = p.supabase.storage.from('images').getPublicUrl(path).data.publicUrl
    return { maskUrl, maskBuf }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[analyze-scene] SAM grouped ("${p.label}") failed:`, msg)
    return { maskUrl: null, maskBuf: null, error: msg }
  }
}

/**
 * Lance SAM 2 avec POINT prompt seul (Option 1) — bbox Florence ignorée,
 * on passe juste le centre comme point positif.
 */
async function runSamForPoint(p: {
  imageFilename: string
  point: [number, number]
  supabase: ReturnType<typeof createClient>
  label: string
  path: string
}): Promise<{ maskUrl: string | null; maskBuf: Buffer | null; error?: string }> {
  try {
    const samWf = buildSceneSAMPointWorkflow({ image_filename: p.imageFilename, point: p.point })
    const samResult = await queuePrompt(samWf)
    if (samResult.node_errors && Object.keys(samResult.node_errors).length > 0) {
      throw new Error(`SAM rejected: ${JSON.stringify(samResult.node_errors).slice(0, 200)}`)
    }
    const samHistory = await pollUntilDone(samResult.prompt_id, 90 * 1000)
    if (!samHistory) throw new Error('Timeout SAM')
    // SaveImage est au node '5' dans le workflow point (pas '6' comme bbox)
    const outputs = samHistory.outputs['5'] as unknown as { images?: ComfyImage[] }
    const imgInfo = outputs?.images?.[0]
    if (!imgInfo) throw new Error(`Pas d'image dans history.outputs['5']`)
    const maskBuf = await fetchAndDispose(imgInfo.filename, imgInfo.subfolder, imgInfo.type)
    const path = p.path
    const { error: upErr } = await p.supabase.storage.from('images').upload(path, maskBuf, {
      contentType: 'image/png', upsert: true,
    })
    if (upErr) throw new Error(`Supabase upload failed: ${upErr.message}`)
    const maskUrl = p.supabase.storage.from('images').getPublicUrl(path).data.publicUrl
    return { maskUrl, maskBuf }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[analyze-scene] SAM point ("${p.label}") failed:`, msg)
    return { maskUrl: null, maskBuf: null, error: msg }
  }
}

/**
 * Lance SAM 2 avec BBOX + POINT combinés (Option 3) — best of both.
 * SAM 2 utilise les 2 signaux : bbox contraint la zone, point identifie
 * l'objet dominant dans cette zone.
 */
async function runSamForBboxPoint(p: {
  imageFilename: string
  bboxPx: [number, number, number, number]
  point: [number, number]
  supabase: ReturnType<typeof createClient>
  label: string
  path: string
}): Promise<{ maskUrl: string | null; maskBuf: Buffer | null; error?: string }> {
  try {
    const samWf = buildSceneSAMBboxPointWorkflow({
      image_filename: p.imageFilename, bbox: p.bboxPx, point: p.point,
    })
    const samResult = await queuePrompt(samWf)
    if (samResult.node_errors && Object.keys(samResult.node_errors).length > 0) {
      throw new Error(`SAM rejected: ${JSON.stringify(samResult.node_errors).slice(0, 200)}`)
    }
    const samHistory = await pollUntilDone(samResult.prompt_id, 90 * 1000)
    if (!samHistory) throw new Error('Timeout SAM')
    // SaveImage est au node '6' (avec HeroBboxFromJson + Sam2 = pareil que bbox-only)
    const outputs = samHistory.outputs['6'] as unknown as { images?: ComfyImage[] }
    const imgInfo = outputs?.images?.[0]
    if (!imgInfo) throw new Error(`Pas d'image dans history.outputs['6']`)
    const maskBuf = await fetchAndDispose(imgInfo.filename, imgInfo.subfolder, imgInfo.type)
    const path = p.path
    const { error: upErr } = await p.supabase.storage.from('images').upload(path, maskBuf, {
      contentType: 'image/png', upsert: true,
    })
    if (upErr) throw new Error(`Supabase upload failed: ${upErr.message}`)
    const maskUrl = p.supabase.storage.from('images').getPublicUrl(path).data.publicUrl
    return { maskUrl, maskBuf }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[analyze-scene] SAM bbox+point ("${p.label}") failed:`, msg)
    return { maskUrl: null, maskBuf: null, error: msg }
  }
}

/**
 * Lance SAM 2 pour 1 bbox et upload le mask sur Supabase.
 * Retourne le buffer du mask + l'URL publique (les deux nullables si erreur).
 */
async function runSamForBbox(p: {
  imageFilename: string
  bboxPx: [number, number, number, number]
  supabase: ReturnType<typeof createClient>
  label: string
  path: string
}): Promise<{ maskUrl: string | null; maskBuf: Buffer | null; error?: string }> {
  try {
    const samWf = buildSceneSAMSingleBboxWorkflow({ image_filename: p.imageFilename, bbox: p.bboxPx })
    const samResult = await queuePrompt(samWf)
    if (samResult.node_errors && Object.keys(samResult.node_errors).length > 0) {
      throw new Error(`SAM rejected: ${JSON.stringify(samResult.node_errors).slice(0, 200)}`)
    }
    const samHistory = await pollUntilDone(samResult.prompt_id, 90 * 1000)
    if (!samHistory) throw new Error('Timeout SAM')

    const outputs = samHistory.outputs['6'] as unknown as { images?: ComfyImage[] }
    const imgInfo = outputs?.images?.[0]
    if (!imgInfo) throw new Error(`Pas d'image dans history.outputs['6']`)

    const maskBuf = await fetchAndDispose(imgInfo.filename, imgInfo.subfolder, imgInfo.type)
    const path = p.path
    const { error: upErr } = await p.supabase.storage.from('images').upload(path, maskBuf, {
      contentType: 'image/png', upsert: true,
    })
    if (upErr) throw new Error(`Supabase upload failed: ${upErr.message}`)
    const maskUrl = p.supabase.storage.from('images').getPublicUrl(path).data.publicUrl
    return { maskUrl, maskBuf }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[analyze-scene] SAM ("${p.label}") failed:`, msg)
    return { maskUrl: null, maskBuf: null, error: msg }
  }
}

/**
 * Compose une image "cleanée" : pour chaque pixel, si AU MOINS UN des masks
 * est blanc (>128), on remplace par #808080 (gris neutre). Sinon on garde
 * la valeur de l'image source.
 *
 * Le but : effacer les gros objets déjà détectés pour que Florence revoit
 * la scène et trouve les petits objets "cachés" (pillows sur le sofa).
 */
async function composeCleanedImage(sourceUrl: string, maskBufs: Buffer[], W: number, H: number): Promise<Buffer> {
  // Source en RGB raw (3 channels garantis grâce à removeAlpha)
  const srcResp = await fetch(sourceUrl)
  if (!srcResp.ok) throw new Error(`Cannot fetch source: HTTP ${srcResp.status}`)
  const sourceBuf = Buffer.from(await srcResp.arrayBuffer())
  const srcRaw = await sharp(sourceBuf).removeAlpha().raw().toBuffer()

  // Chaque mask en GREYSCALE 1-CHANNEL garanti :
  //   - removeAlpha() vire le canal alpha si présent
  //   - extractChannel(0) garantit 1 seul canal en sortie raw, peu importe le format
  //     (sinon .greyscale() peut laisser un canal alpha → raw a 2 bytes/pixel
  //      et l'indexation [i] devient fausse pour 50% des pixels)
  const maskRaws = await Promise.all(maskBufs.map(mb =>
    sharp(mb)
      .removeAlpha()
      .resize(W, H, { fit: 'fill' })
      .extractChannel(0)
      .raw()
      .toBuffer()
  ))

  // Sanity check : chaque maskRaw doit faire exactement W*H bytes (1 byte/pixel)
  const expectedLen = W * H
  for (let m = 0; m < maskRaws.length; m++) {
    if (maskRaws[m].length !== expectedLen) {
      throw new Error(`Mask ${m} has wrong length: ${maskRaws[m].length} vs expected ${expectedLen} (W=${W}, H=${H})`)
    }
  }

  // Per-pixel : si AU MOINS un mask > 128 → gris #808080. Sinon → source.
  const pixelCount = W * H
  const out = Buffer.alloc(pixelCount * 3)
  let maskedCount = 0
  for (let i = 0; i < pixelCount; i++) {
    let masked = false
    for (let m = 0; m < maskRaws.length; m++) {
      if (maskRaws[m][i] > 128) { masked = true; break }
    }
    if (masked) {
      maskedCount++
      out[i * 3]     = 128
      out[i * 3 + 1] = 128
      out[i * 3 + 2] = 128
    } else {
      out[i * 3]     = srcRaw[i * 3]
      out[i * 3 + 1] = srcRaw[i * 3 + 1]
      out[i * 3 + 2] = srcRaw[i * 3 + 2]
    }
  }

  console.log(`[c_erase] composed cleaned image: ${maskedCount}/${pixelCount} pixels grisés (${(maskedCount * 100 / pixelCount).toFixed(1)}%)`)

  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()
}

/**
 * Qwen extrait les OBJETS purs des descriptions Florence — sans couleurs,
 * matériaux, modificateurs. Multi-objets par description possible.
 *
 * Fallback en cas d'échec Qwen : buildSmallObjectsPrompt en a_baseline.
 */
async function extractObjectsViaQwen(
  descriptions: string[],
): Promise<{ prompt: string; extracted: string[]; method: string }> {
  if (descriptions.length === 0) {
    return { prompt: '', extracted: [], method: 'e_qwen_dino' }
  }

  const SYSTEM = `You are a vision pipeline assistant.
You receive a list of dense region descriptions of a scene.
Extract ALL OBJECTS mentioned (nouns referring to physical things).
A single description can mention MULTIPLE objects (e.g. "sofa with throw pillows" → ["sofa", "throw pillows"]).

Rules:
- Output PURE OBJECT NOUNS, lowercased.
- REMOVE adjectives: colors (beige, blue, brown, tan, gold, white, gray, green), materials (leather, wooden, metal, plastic, cotton), styles (modern, contemporary, vintage, rustic, cozy).
- REMOVE sub-parts of furniture: frame, leg, seat, back, top, arm, edge, side, base, shelf, panel, drawer, knob, handle, lid.
- REMOVE non-object terms: room, view, scene, landscape, background, garden, interior, setting.
- Use plural form ("pillows", "books") if the description suggests multiple instances; singular ("pillow") otherwise.
- Keep multi-word objects as one entry: "rocking chair", "coffee table", "side table", "throw pillows", "potted plant".
- DEDUPLICATE the output list.
- Output JSON: {"objects": ["sofa", "throw pillows", "armchair", ...]}.

Example:
Input:
1. "beige leather sofa with blue throw pillows in living room"
2. "modern brown leather armchair with wooden frame"
3. "houseplant"
Output: {"objects": ["sofa", "throw pillows", "armchair", "houseplant"]}`

  try {
    const result = await ollamaJSON<{ objects?: string[] }>({
      system: SYSTEM,
      prompt: descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n') + '\n\nReply ONLY with JSON.',
      timeoutMs: 30_000,
    })
    const raw = result.objects ?? []
    const cleaned = raw
      .map(s => String(s).trim().toLowerCase())
      .filter(s => s.length > 0 && s.length < 40)
    const qwenSet = new Set(cleaned)

    // Fallback regex : Qwen 1.5B oublie parfois le sujet principal des
    // descriptions (ex: "beige leather sofa with blue throw pillows" → garde
    // les pillows, oublie le sofa). On extrait le main noun de chaque
    // description et on l'ajoute si manquant.
    for (const desc of descriptions) {
      const mainNoun = extractMainNounFromDescription(desc)
      if (mainNoun && !MAIN_NOUN_SCENIC_RE.test(mainNoun) && mainNoun.length > 1) {
        qwenSet.add(mainNoun)
      }
    }

    const finalList = Array.from(qwenSet)
    return {
      prompt: finalList.join('. '),
      extracted: finalList,
      method: 'e_qwen_dino',
    }
  } catch (err) {
    console.warn('[analyze-scene] Qwen extractObjectsViaQwen failed, fallback a_baseline:', err)
    return buildSmallObjectsPrompt(descriptions, 'a_baseline')
  }
}

// ── Helpers pour le fallback regex (extraction du main noun) ──────────────

const ADJECTIVES_TO_SKIP = new Set([
  // Styles
  'modern', 'contemporary', 'traditional', 'rustic', 'luxurious', 'minimalist', 'luxury',
  'cozy', 'spacious', 'stylish', 'elegant', 'simple', 'sleek', 'vintage', 'antique',
  // Colors
  'beige', 'blue', 'brown', 'tan', 'gold', 'golden', 'white', 'gray', 'grey', 'green',
  'red', 'black', 'yellow', 'purple', 'orange', 'pink', 'navy', 'teal', 'cream', 'ivory',
  'silver', 'bronze', 'copper',
  // Materials
  'leather', 'wooden', 'wood', 'metal', 'metallic', 'plastic', 'cotton', 'wool', 'fabric',
  'glass', 'ceramic', 'stone', 'velvet', 'silk', 'marble', 'concrete',
])

const STOP_WORDS = new Set([
  'with', 'in', 'on', 'of', 'and', 'that', 'which', 'by', 'under', 'over', 'near',
  'inside', 'beside', 'behind', 'next', 'between', 'against', 'around',
])

const MAIN_NOUN_SCENIC_RE = /^(living\s+room|bedroom|kitchen|bathroom|dining\s+room|hallway|interior|landscape|garden\s+view|view|scene|background|setting|space|area|room)$/i

/**
 * Extrait le noun phrase principal d'une description Florence.
 * Saute les adjectifs en tête (couleurs, matériaux, styles) et prend les
 * 1-2 mots qui suivent comme noun phrase, jusqu'au prochain stop word.
 *
 * Exemples :
 *   "beige leather sofa with blue throw pillows" → "sofa"
 *   "modern white coffee table with gold metal frame" → "coffee table"
 *   "modern wooden side table with round top" → "side table"
 *   "houseplant" → "houseplant"
 *   "modern living room with garden view" → "living room" (filtré ensuite)
 */
function extractMainNounFromDescription(description: string): string | null {
  const tokens = description.toLowerCase().trim().split(/\s+/)
  let i = 0
  while (i < tokens.length && ADJECTIVES_TO_SKIP.has(tokens[i])) i++
  const nouns: string[] = []
  while (i < tokens.length && nouns.length < 2) {
    const t = tokens[i]
    if (STOP_WORDS.has(t)) break
    nouns.push(t)
    i++
  }
  return nouns.length > 0 ? nouns.join(' ') : null
}

/**
 * Calcule la bbox englobante d'un mask binaire (PNG noir & blanc) :
 * trouve les min/max x,y des pixels au-dessus de 128 (la zone "blanche").
 * Retourne null si le mask est entièrement noir.
 */
async function bboxFromMaskBuffer(
  maskBuf: Buffer,
  W: number,
  H: number,
): Promise<[number, number, number, number] | null> {
  const raw = await sharp(maskBuf)
    .removeAlpha()
    .resize(W, H, { fit: 'fill' })
    .extractChannel(0)
    .raw()
    .toBuffer()
  if (raw.length !== W * H) {
    console.warn(`[bboxFromMask] unexpected raw length ${raw.length} vs ${W * H}`)
    return null
  }
  let minX = W, minY = H, maxX = -1, maxY = -1
  for (let y = 0; y < H; y++) {
    const rowOffset = y * W
    for (let x = 0; x < W; x++) {
      if (raw[rowOffset + x] > 128) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return [minX, minY, maxX, maxY]
}

async function getImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-31' } })
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16)
      const height = buf.readUInt32BE(20)
      return { width, height }
    }
    return null
  } catch {
    return null
  }
}
