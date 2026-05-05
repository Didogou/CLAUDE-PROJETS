/**
 * Hook de pré-analyse de l'image courante du Studio Designer (opt-in).
 *
 * Comportement (refacto 2026-05-04) :
 *   - À chaque changement d'imageUrl, GET /api/comfyui/analyze-scene/cache-check
 *   - Si cache hit → runAnalysis() direct (sera quasi-instant via cache DB)
 *   - Si cache miss → expose needsConfirmation=true → un composant <SceneAnalysisPrompt>
 *     affichera la popup. L'utilisateur clique Analyser ou Annuler.
 *
 * Le résultat (post-split) alimente `state.sceneAnalysis` qui est consommé par :
 *   - le panneau Découpe (liste des objets cliquables)
 *   - les overlays canvas (hover marching ants, sélection)
 *   - la future IA Creator (résolution de commandes spatiales)
 *
 * Activation : le hook ne fait rien tant que `enabled === false`.
 *   - Phase A (création) : enabled=false
 *   - Phase B (editing)  : enabled=true → check cache + popup si miss
 *
 * Pendant l'analyse réelle : `setBakeStatus({ kind: 'sam_cut', ... })` →
 * BakeProgressModal full-screen (cohérent avec les autres ops longues du Studio).
 */

import { useEffect, useRef, useState, useCallback } from 'react'
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

export interface UsePreAnalyzeImageResult {
  /** True si une popup doit être affichée pour demander confirmation à l'utilisateur. */
  needsConfirmation: boolean
  /** L'utilisateur clique "Analyser" → lance l'analyse + BakeProgressModal. */
  confirm: () => void
  /** L'utilisateur clique "Annuler" → ferme la popup, pas d'analyse cette session. */
  skip: () => void
  /** L'image en attente de confirmation (pour debug / affichage). */
  pendingImageUrl: string | null
}

export function usePreAnalyzeImage(enabled: boolean = true): UsePreAnalyzeImageResult {
  const {
    imageUrl,
    sceneAnalysis,
    setSceneAnalysisBusy,
    setSceneAnalysisResult,
    setSceneAnalysisError,
    clearSceneAnalysis,
    setBakeStatus,
  } = useEditorState()

  const abortRef = useRef<AbortController | null>(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null)
  /** Set des URLs que l'user a déjà skippées dans cette session — évite de
   *  re-popup s'il revient sur le même plan. Reset au refresh page. */
  const skippedUrlsRef = useRef<Set<string>>(new Set())

  /** Lance la vraie analyse (POST /api/comfyui/analyze-scene).
   *  @param silent Si true, n'affiche PAS la BakeProgressModal (cas cache hit
   *                où la route répond en ~1s, pas la peine de flasher la modale).
   *                Défaut false = affiche la modale (vraie analyse). */
  const runAnalysis = useCallback(async (urlToAnalyze: string, silent = false) => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setSceneAnalysisBusy(true, urlToAnalyze)
    if (!silent) {
      setBakeStatus({
        startedAt: Date.now(),
        phase: 'Détection des objets et personnages…',
        kind: 'sam_cut',
        estimatedTotalSec: 60,
      })
    }

    try {
      const res = await fetch('/api/comfyui/analyze-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: urlToAnalyze,
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

        if (split.stats.split_parents > 0) {
          const persistRes = await fetch('/api/comfyui/analyze-scene/split', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: urlToAnalyze,
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
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn('[usePreAnalyzeImage] split skipped (error):', err)
      }

      setSceneAnalysisResult(urlToAnalyze, finalDetections, data.analyzed_at ?? Date.now())
    } catch (err: unknown) {
      if (controller.signal.aborted) return
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[usePreAnalyzeImage] error:', msg)
      setSceneAnalysisError(msg)
    } finally {
      // Ferme BakeProgressModal seulement si on l'avait ouverte
      if (!silent) setBakeStatus(null)
    }
  }, [setSceneAnalysisBusy, setSceneAnalysisResult, setSceneAnalysisError, setBakeStatus])

  // Effect principal : check cache + décide popup ou auto-run
  useEffect(() => {
    if (!enabled) return

    if (!imageUrl) {
      if (sceneAnalysis.imageUrl !== null) clearSceneAnalysis()
      setNeedsConfirmation(false)
      setPendingImageUrl(null)
      return
    }

    // Déjà analysée en mémoire pour cette session → skip
    if (sceneAnalysis.imageUrl === imageUrl && sceneAnalysis.detections.length > 0) {
      setNeedsConfirmation(false)
      setPendingImageUrl(null)
      return
    }

    // L'utilisateur a skippé cette URL dans cette session → ne re-popup pas
    if (skippedUrlsRef.current.has(imageUrl)) {
      setNeedsConfirmation(false)
      setPendingImageUrl(null)
      return
    }

    // Check cache DB
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/comfyui/analyze-scene/cache-check?image_url=${encodeURIComponent(imageUrl)}`,
        )
        const data = await res.json() as { cached?: boolean }
        if (cancelled) return

        if (data.cached) {
          // Cache DB hit → load silencieux (pas de modale d'attente, ~1s)
          console.log('[usePreAnalyzeImage] cache DB hit, load silencieux')
          setNeedsConfirmation(false)
          setPendingImageUrl(null)
          await runAnalysis(imageUrl, true)
        } else {
          // Cache miss → ne lance PAS, attend confirmation user
          console.log('[usePreAnalyzeImage] cache DB miss → popup confirmation')
          setNeedsConfirmation(true)
          setPendingImageUrl(imageUrl)
        }
      } catch (err) {
        if (cancelled) return
        // Cache check fail → on assume cache miss (popup) plutôt que de bloquer
        console.warn('[usePreAnalyzeImage] cache-check failed, fallback popup:', err)
        setNeedsConfirmation(true)
        setPendingImageUrl(imageUrl)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, imageUrl, sceneAnalysis.imageUrl, sceneAnalysis.detections.length])

  const confirm = useCallback(() => {
    if (!pendingImageUrl) return
    setNeedsConfirmation(false)
    void runAnalysis(pendingImageUrl)
    setPendingImageUrl(null)
  }, [pendingImageUrl, runAnalysis])

  const skip = useCallback(() => {
    if (pendingImageUrl) {
      skippedUrlsRef.current.add(pendingImageUrl)
    }
    setNeedsConfirmation(false)
    setPendingImageUrl(null)
  }, [pendingImageUrl])

  return { needsConfirmation, confirm, skip, pendingImageUrl }
}
