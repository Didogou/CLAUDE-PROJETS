'use client'
/**
 * Fold « Bake » — génère l'animation du calque actif via ComfyUI.
 *
 * Premier kind implémenté : **motion_brush** (AnimateDiff avec mask).
 * Pipeline :
 *   1. Convertit l'alpha du PNG RGBA du calque en mask B&W opaque
 *   2. Upload source (Base image) + mask dans ComfyUI input
 *   3. POST /api/comfyui avec workflow_type='motion_brush' + prompt auto-généré
 *   4. Poll /api/comfyui?prompt_id=X toutes les 3s
 *   5. Récupère l'URL vidéo → met à jour `layer.baked_url` → affichage auto
 *      en <video> dans Canvas
 *
 * Les autres kinds (travelling, video_wan, etc.) seront câblés dans des steps
 * suivants — pour l'instant : bouton disabled avec label "bientôt".
 */
import React, { useEffect, useRef, useState } from 'react'
import { Film, Loader2, Play } from 'lucide-react'
import { useEditorState } from '../EditorStateContext'
import { layerAlphaToMask } from '../helpers/extractZones'
import { CHECKPOINTS } from '@/lib/comfyui'
import { ANIMATION_KIND_LABELS } from '../types'
import { MOTION_BRUSH_DEFAULTS } from './FoldAnimationParams'

// Fallback prompt si l'utilisateur n'a rien saisi dans FoldAnimationParams.
const FALLBACK_PROMPT = 'gentle natural motion, subtle movement, organic animation'

export default function FoldAnimationBake() {
  const { layers, activeLayerIdx, imageUrl, updateLayer, bakeStatus, setBakeStatus } = useEditorState()
  const layer = layers[activeLayerIdx]
  const kind = layer?.animation?.kind
  const busy = bakeStatus !== null
  const [error, setError] = useState<string | null>(null)
  // Cleanup unmount-safe : le polling continue si le fold se démonte
  // (changement de calque pendant un bake) → on track isMounted.
  const isMountedRef = useRef(true)
  useEffect(() => () => { isMountedRef.current = false }, [])

  // Storage prefix pour l'upload des masks intermédiaires
  const storagePrefix = `image-editor/anim_${layer?._uid ?? 'layer'}`

  const bakedUrl = layer?.baked_url
  // Lenient : matche l'extension partout (URL directe, proxy /api/comfyui/media?filename=X.mp4&…)
  const isVideo = bakedUrl && /\.(mp4|webm|mov)/i.test(bakedUrl)
  // Le calque a été "bakke" comme vidéo si l'URL est .mp4/.webm ; sinon le
  // baked_url est le PNG d'extraction initial (non-animé).
  const hasAnimation = isVideo

  const isSupportedKind = kind === 'motion_brush' || kind === 'cinemagraph'
  const canBake = isSupportedKind && !busy && imageUrl && layer?.type === 'image' && layer.media_url

  async function runBake() {
    if (!layer || !imageUrl || !layer.media_url) return
    setError(null)
    try {
      // Tous les params lus depuis `layer.animation.params` (éditables dans
      // FoldAnimationParams). Fallback sur defaults sensibles si vide.
      const layerParams = (layer.animation?.params ?? {}) as {
        prompt_positive?: string
        prompt_negative?: string
        denoise?: number
        frames?: number
        steps?: number
        fps?: number
      }
      const motionPrompt = layerParams.prompt_positive?.trim() || FALLBACK_PROMPT
      const motionNegative = layerParams.prompt_negative?.trim() || MOTION_BRUSH_DEFAULTS.prompt_negative
      const effDenoise = layerParams.denoise ?? MOTION_BRUSH_DEFAULTS.denoise
      // Defaults centralisés dans FoldAnimationParams (presets Rapide/Qualité).
      const effFrames = layerParams.frames ?? MOTION_BRUSH_DEFAULTS.frames
      const effSteps = layerParams.steps ?? MOTION_BRUSH_DEFAULTS.steps
      const effFps = layerParams.fps ?? MOTION_BRUSH_DEFAULTS.fps

      // Estimation basée sur 0.94s/(step·frame) mesuré sur laptop RTX 5060 8 Go.
      // La barre du modal est indicative — elle passe en warning si overtime.
      const estimatedTotalSec = Math.round(effSteps * effFrames * 0.94 + 30)
      const bakeKind: 'motion_brush' | 'cinemagraph' = kind === 'cinemagraph' ? 'cinemagraph' : 'motion_brush'
      const startedAt = Date.now()
      const updatePhase = (phase: string) => setBakeStatus({ startedAt, phase, kind: bakeKind, estimatedTotalSec })
      updatePhase('Préparation du mask…')

      // 2. Convertit l'alpha du layer en mask B&W
      const maskBwUrl = await layerAlphaToMask(layer.media_url, storagePrefix)
      updatePhase('Upload dans ComfyUI…')

      // 3. Upload source + mask dans ComfyUI input
      const upSrc = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: imageUrl, name: `mbrush_src_${Date.now()}` }),
      })
      const upSrcData = await upSrc.json()
      if (!upSrc.ok) throw new Error(upSrcData.error ?? 'Upload source échoué')

      const upMask = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: maskBwUrl, name: `mbrush_mask_${Date.now()}` }),
      })
      const upMaskData = await upMask.json()
      if (!upMask.ok) throw new Error(upMaskData.error ?? 'Upload mask échoué')

      updatePhase('Lancement AnimateDiff…')

      // 3. Lance le workflow motion_brush
      const checkpoint = CHECKPOINTS.find(c => c.key === 'juggernaut')?.filename
        ?? CHECKPOINTS[0].filename
      // Dispatch sur le kind — les deux workflows ont la même signature (source + mask + prompt)
      // mais des pipelines différents (motion_brush = composite simple ; cinemagraph =
      // SEGSDetailerForAnimateDiff + SEGSPaste avec loop pingpong seamless).
      const workflowType = kind === 'cinemagraph' ? 'cinemagraph' : 'motion_brush'

      // Trace complet des params envoyés à ComfyUI — utile pour debug color shift
      // ou quand le résultat n'est pas celui attendu. Visible dans console DevTools.
      // Note : pour cinemagraph, le checkpoint client (Juggernaut XL) est
      // IGNORÉ — le workflow force Realistic_Vision_V6.0 (SD 1.5) en interne.
      // On log ce qui sera effectivement utilisé pour éviter la confusion.
      const effectiveCheckpoint = kind === 'cinemagraph'
        ? 'Realistic_Vision_V6.0_NV_B1_fp16.safetensors (forcé, SD 1.5 requis par mm_sd_v14)'
        : checkpoint
      console.log(`[Bake ${workflowType}] Params envoyés à ComfyUI:`, {
        workflow_type: workflowType,
        prompt_positive: motionPrompt,
        prompt_negative: motionNegative,
        frames: effFrames,
        steps: effSteps,
        denoise: effDenoise,
        fps: effFps,
        cfg: 7,
        checkpoint: effectiveCheckpoint,
        motion_module: kind === 'cinemagraph' ? 'mm_sd_v14.ckpt' : 'mm_sdxl_v10_beta.ckpt',
        layer_uid: layer._uid,
      })

      const res = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: workflowType,
          source_image: upSrcData.filename,
          mask_image: upMaskData.filename,
          prompt_positive: motionPrompt,
          prompt_negative: motionNegative,
          frames: effFrames,
          fps: effFps,
          steps: effSteps,
          cfg: 7,
          denoise: effDenoise,
          seed: -1,
          checkpoint,
        }),
      })
      const d = await res.json()
      if (!d.prompt_id) throw new Error(d.error ?? 'Erreur motion_brush')

      updatePhase('Génération en cours…')

      // 4. Poll jusqu'à complétion (max 10 min). Le phase text est mis à jour
      // via setBakeStatus (qui survit au démontage du fold) — le BakeProgressModal
      // affiche le compteur écoulé en continu, pas besoin de re-push depuis ici.
      const MAX_WAIT_MS = 10 * 60 * 1000
      let videoUrl: string | null = null
      let pollCount = 0
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        await new Promise(r => setTimeout(r, 3000))
        pollCount++
        let pd: { status?: string; error?: string } = {}
        try {
          const poll = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}`)
          pd = await poll.json() as { status?: string; error?: string }
        } catch (pollErr) {
          // Le polling peut échouer (serveur Next.js recompile, réseau…) —
          // on log et on continue, sinon une glitch réseau tuerait le bake.
          console.warn(`[Bake poll #${pollCount}] fetch error, retrying:`, pollErr)
          continue
        }
        // Log périodique pour debug — utile si le modal reste bloqué.
        if (pollCount % 10 === 1) {
          console.log(`[Bake poll #${pollCount}] prompt_id=${d.prompt_id} status=${pd.status}`)
        }
        if (pd.status === 'succeeded') {
          updatePhase('Téléchargement de la vidéo…')
          // Récupère l'URL vidéo stockée
          const storagePath = `${storagePrefix}_motion_${Date.now()}`
          const hist = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}&action=video_info&storage_path=${encodeURIComponent(storagePath)}`)
          const histData = await hist.json()
          if (histData.video_url) {
            videoUrl = histData.video_url
            break
          }
          throw new Error('Workflow réussi mais pas de video_url retournée')
        }
        if (pd.status === 'failed') throw new Error(pd.error ?? 'Bake échoué')
      }
      if (!videoUrl) throw new Error('Timeout après 10 min')

      // 5. Met à jour le calque → baked_url = vidéo → Canvas render auto en <video>
      // updateLayer passe par le context → pas de risque de setState après unmount.
      updateLayer(activeLayerIdx, { baked_url: videoUrl })
    } catch (err) {
      // setError est local : skip si le fold a été démonté.
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : String(err))
      } else {
        console.error('[Bake] error after unmount:', err)
      }
    } finally {
      // Clear bakeStatus dans tous les cas → ferme le modal.
      setBakeStatus(null)
    }
  }

  if (!layer) return null
  if (!kind) {
    return (
      <div style={{ padding: 'var(--ie-space-3)', fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-muted)', fontStyle: 'italic' }}>
        Sélectionne d&apos;abord un type d&apos;animation.
      </div>
    )
  }

  // Kinds pas encore implémentés : affiche un message clair
  if (!isSupportedKind) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)' }}>
        <div style={{ padding: 'var(--ie-space-3)', fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-muted)', background: 'var(--ie-surface-2)', borderRadius: 'var(--ie-radius)' }}>
          Le bake <b>{ANIMATION_KIND_LABELS[kind]}</b> arrive bientôt. Pour l&apos;instant : <b>Motion Brush</b> (rapide) et <b>Cinemagraph</b> (qualité supérieure) sont câblés.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)' }}>
      {/* Les presets Rapide / Qualité et les sliders (denoise, frames, steps, fps)
          sont dans le fold « Paramètres ». On évite le doublon ici. */}

      <button
        onClick={() => void runBake()}
        disabled={!canBake}
        style={{
          padding: 'var(--ie-space-3)',
          background: canBake ? 'var(--ie-accent)' : 'var(--ie-surface-2)',
          color: canBake ? 'white' : 'var(--ie-text-faint)',
          border: 'none',
          borderRadius: 'var(--ie-radius)',
          cursor: canBake ? 'pointer' : 'not-allowed',
          fontSize: 'var(--ie-text-base)',
          fontWeight: 600,
          fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-2)',
          transition: 'all var(--ie-transition)',
        }}
      >
        {busy ? <Loader2 size={14} className="ie-spin" /> : <Film size={14} />}
        {busy ? 'Génération…' : hasAnimation ? 'Re-générer l\'animation' : 'Générer l\'animation'}
      </button>

      {/* Progression affichée dans le BakeProgressModal plein-écran
          (phase + compteur live + barre) — pas de doublon dans le fold. */}

      {error && (
        <div style={{
          padding: 'var(--ie-space-2) var(--ie-space-3)',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid var(--ie-danger)',
          borderRadius: 'var(--ie-radius)',
          color: 'var(--ie-danger)',
          fontSize: 'var(--ie-text-sm)',
          lineHeight: 1.4,
        }}>⚠ {error}</div>
      )}

      {hasAnimation && bakedUrl && !busy && (
        <div style={{
          padding: 'var(--ie-space-2)',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid var(--ie-success)',
          borderRadius: 'var(--ie-radius)',
          fontSize: 'var(--ie-text-xs)',
          color: 'var(--ie-text)',
          display: 'flex', alignItems: 'center', gap: 'var(--ie-space-2)',
        }}>
          <Play size={12} style={{ color: 'var(--ie-success)' }} />
          Animation prête — visible en live sur le canvas (calque au-dessus de la Base)
        </div>
      )}
    </div>
  )
}
