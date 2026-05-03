/**
 * Hook de pré-analyse automatique de l'image courante du Studio Designer.
 *
 * Quand l'utilisateur charge une nouvelle image (state.imageUrl change),
 * on appelle /api/comfyui/analyze-scene avec la stratégie validée
 * `f_qwen_sam1hq` pour extraire un catalogue d'objets segmentés.
 *
 * Post-process automatique :
 *   - Split des détections multi-contour via splitDetectionsByContour (un
 *     tonneau groupé avec 2 autres → 3 détections individuelles)
 *   - Persistance via /api/comfyui/analyze-scene/split (upload masks splittés,
 *     PATCH DB, delete des masks groupés obsolètes)
 *
 * Le résultat (post-split) alimente `state.sceneAnalysis` qui est consommé par :
 *   - le panneau Découpe (liste des objets cliquables)
 *   - les overlays canvas (hover marching ants, sélection)
 *   - la future IA Creator (résolution de commandes spatiales)
 *
 * Activation : le hook ne déclenche l'analyse QUE quand `enabled === true`.
 *   - Phase A (création) : enabled=false, exploration de variantes sans coût
 *   - Phase B (editing)  : enabled=true, analyse de l'image validée
 *
 * Caractéristiques :
 *   - Idempotent : ne relance pas si imageUrl === sceneAnalysis.imageUrl
 *   - Annulable : si imageUrl change pendant un appel, le précédent est aborté
 *   - Background : ne bloque pas l'UI
 *   - Silencieux en cas d'échec (logged, l'utilisateur peut toujours faire manuel)
 */

import { useEffect, useRef } from 'react'
import { useEditorState, type SceneDetection } from '../EditorStateContext'
import { splitDetectionsByContour } from '../helpers/splitDetectionsByContour'

interface AnalysisApiResponse {
  detections?: Array<{
    id: string
    label: string
    source?: 'dense' | 'od'
    bbox: [number, number, number, number]
    bbox_pixels: [number, number, number, number]
    mask_url: string | null
    error?: string
  }>
  image_size?: { width: number; height: number }
  from_cache?: boolean
  error?: string
  analyzed_at?: number
}

interface SplitApiResponse {
  ok?: boolean
  detections?: Array<{
    id: string
    label: string
    source?: 'dense' | 'od'
    bbox: [number, number, number, number]
    bbox_pixels: [number, number, number, number]
    mask_url: string | null
  }>
  upload_errors?: number
  removed_files?: number
  error?: string
}

export function usePreAnalyzeImage(enabled: boolean = true) {
  const {
    imageUrl,
    sceneAnalysis,
    setSceneAnalysisBusy,
    setSceneAnalysisResult,
    setSceneAnalysisError,
    clearSceneAnalysis,
  } = useEditorState()

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!enabled) return

    if (!imageUrl) {
      if (sceneAnalysis.imageUrl !== null) clearSceneAnalysis()
      return
    }

    if (sceneAnalysis.imageUrl === imageUrl && sceneAnalysis.detections.length > 0) {
      return
    }

    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    setSceneAnalysisBusy(true, imageUrl)

    ;(async () => {
      try {
        const res = await fetch('/api/comfyui/analyze-scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: imageUrl,
            model: 'large',
            filter_mode: 'combined',
            extraction_strategy: 'f_qwen_sam1hq',
            group_by_class: false,
          }),
          signal: controller.signal,
        })
        const data = (await res.json()) as AnalysisApiResponse
        if (controller.signal.aborted) return

        if (!res.ok || data.error) {
          const msg = data.error ?? `HTTP ${res.status}`
          console.warn('[usePreAnalyzeImage] failed:', msg)
          setSceneAnalysisError(msg)
          return
        }

        const rawDetections: SceneDetection[] = (data.detections ?? []).map((d) => ({
          id: d.id,
          label: d.label,
          bbox: d.bbox,
          bbox_pixels: d.bbox_pixels,
          mask_url: d.mask_url,
          source: d.source,
          error: d.error,
        }))

        const W = data.image_size?.width ?? 1024
        const H = data.image_size?.height ?? 1024

        // ── Split client-side : tonneaux groupés → tonneaux individuels ───
        let finalDetections = rawDetections
        try {
          const split = await splitDetectionsByContour(rawDetections, W, H)
          if (controller.signal.aborted) return

          // Persistance UNIQUEMENT si on a effectivement splitté quelque chose
          // (sinon pas la peine de hit l'API, le DB est déjà propre)
          if (split.stats.split_parents > 0) {
            const persistRes = await fetch('/api/comfyui/analyze-scene/split', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image_url: imageUrl,
                image_width: W,
                image_height: H,
                detections: split.detections,
                obsolete_mask_urls: split.obsolete_mask_urls,
              }),
              signal: controller.signal,
            })
            if (controller.signal.aborted) return
            const persistData = (await persistRes.json()) as SplitApiResponse
            if (persistRes.ok && persistData.detections) {
              finalDetections = persistData.detections.map(d => ({
                id: d.id,
                label: d.label,
                bbox: d.bbox,
                bbox_pixels: d.bbox_pixels,
                mask_url: d.mask_url,
                source: d.source,
              }))
              console.log('[usePreAnalyzeImage] split persisted:', {
                input: split.stats.input,
                final: finalDetections.length,
                removed: persistData.removed_files,
              })
            } else {
              console.warn('[usePreAnalyzeImage] split persist failed:', persistData.error)
              // Fallback : on garde les détections originales (plus safe que
              // d'utiliser les data URLs côté client — non persistées).
            }
          }
        } catch (err) {
          if (controller.signal.aborted) return
          console.warn('[usePreAnalyzeImage] split skipped (error):', err)
        }

        setSceneAnalysisResult(imageUrl, finalDetections, data.analyzed_at ?? Date.now())
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[usePreAnalyzeImage] error:', msg)
        setSceneAnalysisError(msg)
      }
    })()

    return () => {
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, imageUrl, sceneAnalysis.imageUrl, sceneAnalysis.detections.length])
}
