'use client'
/**
 * Petit bouton flottant en haut-droite du canvas pour relancer la pré-analyse
 * de scène (force_reanalyze=true).
 *
 * Comportement :
 *   - Visible uniquement quand on a déjà une image et un résultat d'analyse
 *   - Click : appelle /api/comfyui/analyze-scene avec force_reanalyze: true
 *   - Le backend supprime les anciens masks PNG de Supabase puis relance
 *   - Pendant l'analyse : icône spinner + désactivé
 *   - Au succès : sceneAnalysis state se met à jour automatiquement
 *
 * À déplacer/styler plus tard quand l'UX sera officialisée. Pour l'instant
 * = bouton de test simple.
 */
import React from 'react'
import { useEditorState, type SceneDetection } from './EditorStateContext'

interface ApiResponse {
  detections?: Array<{
    id: string
    label: string
    source?: 'dense' | 'od'
    bbox: [number, number, number, number]
    bbox_pixels: [number, number, number, number]
    mask_url: string | null
    error?: string
  }>
  error?: string
  analyzed_at?: number
}

export default function SceneAnalysisRefreshButton() {
  const {
    imageUrl,
    sceneAnalysis,
    setSceneAnalysisBusy,
    setSceneAnalysisResult,
    setSceneAnalysisError,
  } = useEditorState()

  // Pas affiché si pas d'image ou si pas encore d'analyse
  if (!imageUrl) return null
  if (sceneAnalysis.detections.length === 0 && !sceneAnalysis.busy) return null

  async function handleClick() {
    if (!imageUrl || sceneAnalysis.busy) return
    setSceneAnalysisBusy(true, imageUrl)
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
          // Drill-down : pour chaque détection plurale/compound,
          // crop à sa bbox et re-analyse pour trouver des sous-objets plus fins.
          // Singulars (ex: "wooden chair") gardés tels quels.
          mode: 'drilldown',
        }),
      })
      const data = (await res.json()) as ApiResponse
      if (!res.ok || data.error) {
        const msg = data.error ?? `HTTP ${res.status}`
        console.warn('[SceneAnalysisRefreshButton] failed:', msg)
        setSceneAnalysisError(msg)
        return
      }
      const detections: SceneDetection[] = (data.detections ?? []).map((d) => ({
        id: d.id,
        label: d.label,
        bbox: d.bbox,
        bbox_pixels: d.bbox_pixels,
        mask_url: d.mask_url,
        source: d.source,
        error: d.error,
      }))
      setSceneAnalysisResult(imageUrl, detections, data.analyzed_at ?? Date.now())
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[SceneAnalysisRefreshButton] error:', msg)
      setSceneAnalysisError(msg)
    }
  }

  const busy = sceneAnalysis.busy

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={busy ? 'Drill-down en cours…' : 'Drill-down : crop chaque détection plurale et re-analyse pour trouver des sous-objets'}
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 10,
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: '1px solid rgba(168, 85, 247, 0.6)',
        background: busy ? 'rgba(168, 85, 247, 0.85)' : 'rgba(255, 255, 255, 0.92)',
        color: busy ? '#fff' : '#a855f7',
        cursor: busy ? 'wait' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
        transition: 'all 160ms ease-out',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          animation: busy ? 'sceneAnalysisRefreshSpin 1s linear infinite' : 'none',
        }}
      >
        🔄
      </span>
      {/* Keyframes pour le spinner busy */}
      <style>{`
        @keyframes sceneAnalysisRefreshSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  )
}
