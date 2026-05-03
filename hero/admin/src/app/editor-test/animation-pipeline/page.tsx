'use client'
/**
 * POC Animation Pipeline complète — bench standalone, pas câblé au Designer.
 *
 * Pipeline en 4 étapes :
 *   1. Prompt → image AI (reuse useImageGeneration → Juggernaut XL via ComfyUI)
 *   2. Auto-découpe (Scene Analyzer F + split client) → liste de détections
 *   3. User pick UNE détection (le chat) → cutout cropped à sa bbox, fond noir,
 *      dimensions snappées à des multiples de 32 (compat Wan)
 *   4. Wan 2.2 image-to-video animate → vidéo affichée + historique
 *
 * Vise à valider visuellement : "est-ce que Wan 2.2 anime correctement un chat
 * isolé en cutout, avec étirement anatomique propre ?"
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useImageGeneration } from '@/components/image-editor/hooks/useImageGeneration'

// ── Types ─────────────────────────────────────────────────────────────────

interface Detection {
  id: string
  label: string
  bbox: [number, number, number, number]
  bbox_pixels: [number, number, number, number]
  mask_url: string | null
  source?: 'dense' | 'od'
}

type AnimWorkflow = 'wan_animate' | 'tooncrafter' | 'ltx_video'

interface AnimRun {
  id: string
  workflow: AnimWorkflow
  prompt: string
  detectionLabel: string
  cutoutUrl: string
  endCutoutUrl?: string  // ToonCrafter only
  frames: number
  fps: number
  steps: number
  cfg: number
  denoise: number
  width: number
  height: number
  status: 'queuing' | 'uploading' | 'generating' | 'done' | 'error'
  promptId?: string
  videoUrl?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

// ── Presets ───────────────────────────────────────────────────────────────

const PROMPT_PRESETS = [
  { label: '🐱 Stretch', prompt: 'the cat slowly stretches its body, extending its front paws forward, gentle organic motion, painterly style', denoise: 0.7, frames: 25 },
  { label: '🌬 Respiration', prompt: 'subtle breathing motion, body slightly rises and falls, very gentle, eyes blinking once', denoise: 0.4, frames: 17 },
  { label: '👀 Tête tourne', prompt: 'the subject slowly turns its head from left to right, gentle attentive gaze', denoise: 0.6, frames: 25 },
  { label: '✋ Manuel', prompt: '', denoise: 0.7, frames: 25 },
] as const

const NEGATIVE_DEFAULT = 'static, blurred, worst quality, low quality, watermark, deformed, extra limbs'

// ── Helpers ───────────────────────────────────────────────────────────────

/** Free la VRAM ComfyUI (best-effort). Appelé entre chaque workflow lourd
 *  pour éviter les OOM sur GPU 8 Go (Wan + ToonCrafter + Juggernaut s'empilent
 *  sinon en VRAM si rien ne décharge entre eux). */
async function freeVram(reason: string): Promise<void> {
  try {
    await fetch('/api/comfyui/free', { method: 'POST' })
    // ComfyUI's /free POST returns immédiatement mais l'unload réel des
    // modèles peut prendre 1-2s. On attend explicitement avant de continuer
    // pour s'assurer que la VRAM est vraiment libérée avant le workflow suivant.
    await new Promise(r => setTimeout(r, 2000))
    console.log(`[freeVram] ${reason} — done`)
  } catch (err) {
    console.warn(`[freeVram] ${reason} — failed:`, err)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`load failed: ${url.slice(0, 80)}`))
    img.src = url
  })
}

/**
 * Extrait un cutout cropped : bbox de la détection + padding, mask appliqué
 * via destination-in pour transparence, puis composite sur fond noir (Wan
 * VAE attend RGB). Dimensions snappées à des multiples de 32.
 *
 * Retourne le blob PNG prêt à upload.
 */
async function buildCutout(
  sourceUrl: string,
  maskUrl: string,
  bbox: [number, number, number, number],
  padding = 0.08,
): Promise<{ blob: Blob; width: number; height: number; previewUrl: string }> {
  const [src, mask] = await Promise.all([loadImage(sourceUrl), loadImage(maskUrl)])
  const W = src.naturalWidth
  const H = src.naturalHeight

  const [x1, y1, x2, y2] = bbox
  const padX = (x2 - x1) * padding
  const padY = (y2 - y1) * padding
  const cropX = Math.max(0, (x1 - padX) * W)
  const cropY = Math.max(0, (y1 - padY) * H)
  const cropW = Math.min(W - cropX, (x2 - x1 + 2 * padX) * W)
  const cropH = Math.min(H - cropY, (y2 - y1 + 2 * padY) * H)

  // Snap à multiples de 32, min 64
  const targetW = Math.max(64, Math.round(cropW / 32) * 32)
  const targetH = Math.max(64, Math.round(cropH / 32) * 32)

  // Étape 1 : draw source cropped sur le canvas final
  const finalCanvas = document.createElement('canvas')
  finalCanvas.width = targetW
  finalCanvas.height = targetH
  const fctx = finalCanvas.getContext('2d')!
  fctx.drawImage(src, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH)
  const srcData = fctx.getImageData(0, 0, targetW, targetH)

  // Étape 2 : draw mask cropped sur un canvas tampon, lis sa luminance
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = targetW
  maskCanvas.height = targetH
  const mctx = maskCanvas.getContext('2d')!
  mctx.drawImage(mask, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH)
  const maskData = mctx.getImageData(0, 0, targetW, targetH)

  // Étape 3 : pour chaque pixel, si mask=noir → on remplace le pixel source
  // par du noir (Wan VAE = RGB, pas RGBA). Si mask=blanc → on garde la source.
  // Seuil 128 sur la luminance mask (blanc>128 = inside).
  for (let i = 0; i < srcData.data.length; i += 4) {
    const lum = (maskData.data[i] + maskData.data[i + 1] + maskData.data[i + 2]) / 3
    if (lum < 128) {
      srcData.data[i] = 0       // R
      srcData.data[i + 1] = 0   // G
      srcData.data[i + 2] = 0   // B
      // alpha reste 255 (opaque) — Wan attend RGB
    }
  }
  fctx.putImageData(srcData, 0, 0)

  const blob = await new Promise<Blob>((resolve, reject) => {
    finalCanvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  const previewUrl = finalCanvas.toDataURL('image/png')

  return { blob, width: targetW, height: targetH, previewUrl }
}

async function uploadCutout(blob: Blob, prefix: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'cutout.png')
  form.append('path', `${prefix}/cutout_${Date.now()}`)
  const res = await fetch('/api/upload-image', { method: 'POST', body: form })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`upload échoué (${res.status}) : ${txt.slice(0, 200)}`)
  }
  const d = await res.json()
  if (!d.url) throw new Error('upload : URL manquante')
  return d.url as string
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AnimationPipelinePage() {
  // Étape 1 : génération image
  const [imagePrompt, setImagePrompt] = useState('a fluffy ginger cat lying on a wooden barrel, medieval tavern, painterly digital art, cinematic lighting')
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const { statuses: genStatuses, isRunning: genIsRunning, start: startGeneration } = useImageGeneration()

  function handleGenerateImage() {
    if (!imagePrompt.trim() || genIsRunning) return
    setGeneratedImageUrl(null)
    setImageSize(null)
    setDetections([])
    setSelectedDet(null)
    setCutoutPreview(null)
    setCutoutUrl(null)
    void startGeneration({
      promptFr: imagePrompt,
      type: 'plan_standard',
      format: '1:1',
      modelKeys: ['juggernaut'],
      storagePathPrefix: 'test/animation-pipeline',
      steps: 30,
      cfg: 7,
    })
  }

  // Récupère l'image dès que la 1ère variante est done
  useEffect(() => {
    const first = genStatuses[0]
    if (!first || first.stage !== 'done' || !first.url) return
    if (generatedImageUrl === first.url) return
    setGeneratedImageUrl(first.url)
  }, [genStatuses, generatedImageUrl])

  // Étape 2 : analyse + split
  const [detections, setDetections] = useState<Detection[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  useEffect(() => {
    if (!generatedImageUrl) return
    let cancelled = false
    setAnalyzing(true)
    setAnalyzeError(null)

    ;(async () => {
      try {
        const analyzeRes = await fetch('/api/comfyui/analyze-scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: generatedImageUrl,
            model: 'large',
            filter_mode: 'combined',
            extraction_strategy: 'f_qwen_sam1hq',
            group_by_class: false,
          }),
        })
        const data = await analyzeRes.json()
        if (cancelled) return
        if (!analyzeRes.ok || data.error) throw new Error(data.error ?? `analyse HTTP ${analyzeRes.status}`)
        const W = data.image_size?.width ?? 1024
        const H = data.image_size?.height ?? 1024
        setImageSize({ w: W, h: H })

        // Split client
        const { splitDetectionsByContour } = await import('@/components/image-editor/helpers/splitDetectionsByContour')
        const splitInput = (data.detections ?? []).map((d: Detection) => ({
          id: d.id, label: d.label, bbox: d.bbox, bbox_pixels: d.bbox_pixels,
          mask_url: d.mask_url, source: d.source,
        }))
        const split = await splitDetectionsByContour(splitInput, W, H)
        if (cancelled) return

        let final: Detection[] = data.detections ?? []
        if (split.stats.split_parents > 0) {
          const persistRes = await fetch('/api/comfyui/analyze-scene/split', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: generatedImageUrl,
              image_width: W,
              image_height: H,
              detections: split.detections,
              obsolete_mask_urls: split.obsolete_mask_urls,
            }),
          })
          const persistData = await persistRes.json()
          if (cancelled) return
          if (persistRes.ok && persistData.detections) final = persistData.detections
        }
        setDetections(final.filter((d: Detection) => d.mask_url))
        // Scene Analyzer charge Florence + Qwen + DINO + SAM HQ (~4-5GB) →
        // free VRAM avant la prochaine étape (cutout/animation) sinon OOM.
        await freeVram('after scene analyzer')
      } catch (err) {
        if (cancelled) return
        setAnalyzeError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setAnalyzing(false)
      }
    })()
    return () => { cancelled = true }
  }, [generatedImageUrl])

  // Étape 3 : pick detection + build cutout
  const [selectedDet, setSelectedDet] = useState<Detection | null>(null)
  const [cutoutPreview, setCutoutPreview] = useState<string | null>(null)
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null)
  const [cutoutDims, setCutoutDims] = useState<{ w: number; h: number } | null>(null)
  const [buildingCutout, setBuildingCutout] = useState(false)

  const handlePickDetection = useCallback(async (det: Detection) => {
    if (!generatedImageUrl || !det.mask_url) return
    setSelectedDet(det)
    setCutoutPreview(null)
    setCutoutUrl(null)
    setCutoutDims(null)
    setBuildingCutout(true)
    try {
      const { blob, width, height, previewUrl } = await buildCutout(
        generatedImageUrl, det.mask_url, det.bbox, 0.1,
      )
      setCutoutPreview(previewUrl)
      setCutoutDims({ w: width, h: height })
      const url = await uploadCutout(blob, 'test/animation-pipeline')
      setCutoutUrl(url)
    } catch (err) {
      console.error('[buildCutout]', err)
    } finally {
      setBuildingCutout(false)
    }
  }, [generatedImageUrl])

  // Étape 4 : animation form + run
  const [workflow, setWorkflow] = useState<AnimWorkflow>('wan_animate')
  const [animPreset, setAnimPreset] = useState(0)
  const [animPrompt, setAnimPrompt] = useState<string>(PROMPT_PRESETS[0].prompt)
  const [frames, setFrames] = useState<number>(PROMPT_PRESETS[0].frames)
  const [fps, setFps] = useState(12)
  const [steps, setSteps] = useState(30)
  const [cfg, setCfg] = useState(5)
  const [denoise, setDenoise] = useState<number>(PROMPT_PRESETS[0].denoise)
  const [runs, setRuns] = useState<AnimRun[]>([])
  // ToonCrafter : 2ème keyframe (URL paste OU générée via img2img depuis le cutout)
  const [endFrameUrl, setEndFrameUrl] = useState('')
  const [endPrompt, setEndPrompt] = useState('the cat fully stretched, body elongated, paws extended forward, painterly')
  // Denoise 0.5 = quasi-identique au cutout (juste variations de texture).
  // 0.75 = vrai changement de pose mais perso/style préservés. 0.9+ = forte
  // variation, risque que ce ne soit plus le même chat.
  const [endDenoise, setEndDenoise] = useState(0.75)
  const [endGenerating, setEndGenerating] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)

  // Génère la 2ème keyframe via workflow `transition` (img2img low denoise)
  // depuis le cutout. Préserve le perso/style du chat, change la pose selon le prompt.
  const handleGenerateEndFrame = useCallback(async () => {
    if (!cutoutUrl || !endPrompt.trim()) return
    setEndGenerating(true)
    setEndError(null)
    // Free VRAM AVANT pour avoir un GPU propre (au cas où Wan/scene analyzer
    // aurait laissé des résidus). Juggernaut XL ~6GB sur 8GB total = pas de marge.
    await freeVram('before end-frame img2img')
    try {
      // 1. Upload cutout vers ComfyUI input
      const upRes = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: cutoutUrl, name: 'tc_endframe_src' }),
      })
      const upData = await upRes.json()
      if (!upRes.ok || !upData.filename) throw new Error(upData.error ?? 'upload failed')

      // 2. Queue workflow transition (img2img Juggernaut XL, denoise paramétrable)
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'transition',
          source_image: upData.filename,
          checkpoint: 'juggernaut',
          prompt_positive: endPrompt,
          prompt_negative: NEGATIVE_DEFAULT,
          steps: 25,
          cfg: 7,
          seed: -1,
          denoise: endDenoise,
        }),
      })
      const queueData = await queueRes.json()
      if (!queueRes.ok || !queueData.prompt_id) throw new Error(queueData.error ?? 'queue failed')

      // 3. Poll status → succeeded
      const maxWait = Date.now() + 5 * 60 * 1000
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sRes = await fetch(`/api/comfyui?prompt_id=${queueData.prompt_id}`)
        const sData = await sRes.json()
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error('génération échouée')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout')

      // 4. Récupère l'image (action='image' persiste sur Supabase + retourne URL)
      const storagePath = `test/animation-pipeline/endframe_${Date.now()}`
      const iRes = await fetch(`/api/comfyui?prompt_id=${queueData.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`)
      const iData = await iRes.json()
      if (!iRes.ok || !iData.image_url) throw new Error(iData.error ?? 'image_url manquante')
      setEndFrameUrl(iData.image_url)
      // L'action='image' du GET appelle déjà freeComfyVram, mais on rappelle
      // explicitement pour être safe (la prochaine étape = ToonCrafter 10GB).
      await freeVram('after end-frame img2img')
    } catch (err) {
      setEndError(err instanceof Error ? err.message : String(err))
    } finally {
      setEndGenerating(false)
    }
  }, [cutoutUrl, endPrompt, endDenoise])

  function applyAnimPreset(idx: number) {
    setAnimPreset(idx)
    const p = PROMPT_PRESETS[idx]
    setAnimPrompt(p.prompt)
    setFrames(p.frames)
    setDenoise(p.denoise)
  }

  const handleRunAnimation = useCallback(async () => {
    if (!cutoutUrl || !cutoutDims || !animPrompt.trim() || !selectedDet) return
    if (workflow === 'tooncrafter' && !endFrameUrl.trim()) {
      alert('ToonCrafter requires une 2ème keyframe (URL de l\'image de fin).')
      return
    }
    const id = `run-${Date.now()}`
    const newRun: AnimRun = {
      id, workflow,
      prompt: animPrompt, detectionLabel: selectedDet.label,
      cutoutUrl, endCutoutUrl: workflow === 'tooncrafter' ? endFrameUrl : undefined,
      frames, fps, steps, cfg, denoise,
      width: cutoutDims.w, height: cutoutDims.h,
      status: 'uploading', startedAt: Date.now(),
    }
    setRuns(prev => [newRun, ...prev])

    // Free VRAM avant un workflow lourd (ToonCrafter 10GB ou Wan ~6GB)
    await freeVram(`before ${workflow}`)

    try {
      // Upload start frame (cutout) vers ComfyUI/input
      const upRes = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: cutoutUrl, name: 'anim_start' }),
      })
      const upData = await upRes.json()
      if (!upRes.ok || !upData.filename) throw new Error(upData.error ?? `upload start HTTP ${upRes.status}`)

      // ToonCrafter : upload aussi la 2ème keyframe
      let endFilename: string | undefined
      if (workflow === 'tooncrafter') {
        const upRes2 = await fetch('/api/comfyui/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'url', url: endFrameUrl, name: 'anim_end' }),
        })
        const upData2 = await upRes2.json()
        if (!upRes2.ok || !upData2.filename) throw new Error(upData2.error ?? `upload end HTTP ${upRes2.status}`)
        endFilename = upData2.filename
      }

      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'queuing' } : r))

      // Compose le payload selon le workflow.
      // Contraintes 8GB :
      //   - ToonCrafter : cap frames 16, steps 25 (vram_opt=low pour offload RAM)
      //   - LTX 0.9.5 : frames doivent être 8N+1 (auto-snap), CFG 3 (LTX préfère bas)
      //   - Wan 2.2 : config standard
      let payload: Record<string, unknown>
      if (workflow === 'tooncrafter') {
        payload = {
          workflow_type: 'tooncrafter',
          source_image: upData.filename,
          end_image: endFilename,
          prompt_positive: animPrompt,
          seed: -1,
          steps: Math.min(25, steps),
          cfg_scale: cfg,
          eta: 1.0,
          frame_count: Math.min(16, Math.max(5, frames)),
          fps,
          vram_opt: 'low',
        }
      } else if (workflow === 'ltx_video') {
        // LTX 0.9.8 distilled fp8 :
        //   - frames de la forme 8N+1 (9, 17, 25, 33, 41, 49…)
        //   - distilled = 4-8 steps suffisent (vs 30 pour full), bcp plus rapide
        //   - cfg bas (3) — LTX préfère <5 contrairement SDXL
        //   - fps natif 24
        const ltxFrames = Math.round((frames - 1) / 8) * 8 + 1
        payload = {
          workflow_type: 'ltx_video',
          source_image: upData.filename,
          prompt_positive: animPrompt,
          prompt_negative: NEGATIVE_DEFAULT,
          frames: ltxFrames,
          fps: Math.max(fps, 24),
          steps: Math.min(12, steps),  // distilled cap à 12, idéal 6-8
          cfg: 3,
          seed: -1,
          // Cap dimensions pour 8GB — LTX scale linéairement avec resolution
          width: Math.min(cutoutDims.w, 768),
          height: Math.min(cutoutDims.h, 512),
        }
      } else {
        // wan_animate
        payload = {
          workflow_type: 'wan_animate',
          source_image: upData.filename,
          prompt_positive: animPrompt,
          prompt_negative: NEGATIVE_DEFAULT,
          frames, fps, steps, cfg, seed: -1,
          denoise,
          width: cutoutDims.w, height: cutoutDims.h,
        }
      }

      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const queueData = await queueRes.json()
      if (!queueRes.ok || !queueData.prompt_id) throw new Error(queueData.error ?? `queue HTTP ${queueRes.status}`)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, promptId: queueData.prompt_id, status: 'generating' } : r))

      // Poll #1 : attend que le workflow se termine (status='succeeded')
      const maxWait = Date.now() + 10 * 60 * 1000
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sRes = await fetch(`/api/comfyui?prompt_id=${queueData.prompt_id}`)
        const sData = await sRes.json()
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'génération échouée')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout (10min)')

      // Poll #2 : récupère l'URL de la vidéo + persist Supabase
      const storagePath = `test/animation-pipeline/run_${id}`
      const vRes = await fetch(`/api/comfyui?prompt_id=${queueData.prompt_id}&action=video_info&storage_path=${encodeURIComponent(storagePath)}`)
      const vData = await vRes.json()
      if (!vRes.ok || !vData.video_url) throw new Error(vData.error ?? 'video_url manquante')
      setRuns(prev => prev.map(r =>
        r.id === id ? { ...r, status: 'done', videoUrl: vData.video_url, finishedAt: Date.now() } : r,
      ))
      // Free VRAM après le workflow pour libérer le GPU pour la prochaine action
      await freeVram(`after ${workflow}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: msg, finishedAt: Date.now() } : r))
    }
  }, [cutoutUrl, cutoutDims, animPrompt, selectedDet, frames, fps, steps, cfg, denoise, workflow, endFrameUrl])

  const isAnyAnimRunning = runs.some(r => r.status !== 'done' && r.status !== 'error')
  const genStage = genStatuses[0]?.stage ?? 'idle'

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1500, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Animation Pipeline — prompt → cutout → Wan 2.2
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Pipeline complète : prompt génère une image, scene analyzer découpe,
          tu pickes une détection, le cutout (cropped + fond noir) est envoyé à
          Wan 2.2 pour animation.
        </p>

        {/* ── Étape 1 : prompt + image ────────────────────────── */}
        <Section title="① Prompt → image AI">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={imagePrompt}
              onChange={e => setImagePrompt(e.target.value)}
              disabled={genIsRunning}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Décris l'image à générer (FR, sera traduit en EN)"
            />
            <button
              onClick={handleGenerateImage}
              disabled={genIsRunning || !imagePrompt.trim()}
              style={{ ...btnStyle, background: '#EC4899', minWidth: 160 }}
            >
              {genIsRunning ? `⏳ ${genStage}…` : '🎨 Générer image'}
            </button>
          </div>
          {generatedImageUrl && (
            <div style={{
              marginTop: 8, aspectRatio: imageSize ? `${imageSize.w}/${imageSize.h}` : '1/1',
              backgroundImage: `url(${generatedImageUrl})`,
              backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
              background: '#1a1a1e',
              maxHeight: 320,
              border: '1px solid #2a2a30', borderRadius: 4,
            }}>
              <img src={generatedImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          )}
        </Section>

        {/* ── Étape 2 : détections ──────────────────────────────── */}
        {(generatedImageUrl || analyzing) && (
          <Section title={`② Détections${analyzing ? ' (analyse en cours…)' : detections.length ? ` (${detections.length})` : ''}`}>
            {analyzing && <div style={{ fontSize: 12, color: '#9898b4' }}>Scene Analyzer F (Qwen + DINO + SAM 1 HQ)… ~80-120s</div>}
            {analyzeError && <div style={{ padding: 8, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {analyzeError}</div>}
            {detections.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                {detections.map(d => {
                  const isSel = selectedDet?.id === d.id
                  return (
                    <button
                      key={d.id}
                      onClick={() => handlePickDetection(d)}
                      disabled={buildingCutout}
                      style={{
                        ...btnStyle,
                        padding: 4, fontSize: 10,
                        background: isSel ? '#EC4899' : '#1a1a1e',
                        textAlign: 'left',
                      }}
                    >
                      {d.mask_url && generatedImageUrl && (
                        <div style={{
                          aspectRatio: '1/1',
                          backgroundColor: '#000',
                          backgroundImage: `url(${generatedImageUrl})`,
                          backgroundSize: '100% 100%',
                          WebkitMaskImage: `url(${d.mask_url})`,
                          maskImage: `url(${d.mask_url})`,
                          WebkitMaskSize: '100% 100%',
                          maskSize: '100% 100%',
                          ...({ WebkitMaskMode: 'luminance', maskMode: 'luminance' } as React.CSSProperties),
                          marginBottom: 4,
                          borderRadius: 2,
                        }} />
                      )}
                      <div style={{ fontWeight: 600 }}>{d.label}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </Section>
        )}

        {/* ── Étape 3 : preview cutout ──────────────────────────── */}
        {selectedDet && (
          <Section title={`③ Cutout : ${selectedDet.label}`}>
            {buildingCutout && <div style={{ fontSize: 12, color: '#9898b4' }}>Crop + mask + upload…</div>}
            {cutoutPreview && cutoutDims && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <img
                  src={cutoutPreview}
                  alt="cutout"
                  style={{
                    maxWidth: 400, maxHeight: 400,
                    border: '1px solid #2a2a30', borderRadius: 4,
                    background: '#000',
                  }}
                />
                <div style={{ fontSize: 11, color: '#9898b4' }}>
                  <div><code>{cutoutDims.w} × {cutoutDims.h}</code> (snap multiples de 32)</div>
                  <div style={{ marginTop: 4 }}>Fond noir (Wan VAE = RGB)</div>
                  {cutoutUrl && <div style={{ marginTop: 4, color: '#10B981' }}>✓ Uploadé Supabase</div>}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* ── Étape 4 : animation ──────────────────────────────── */}
        {cutoutUrl && (
          <Section title={`④ Animation — ${workflow === 'tooncrafter' ? 'ToonCrafter' : 'Wan 2.2'}`}>
            <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Field label="Workflow">
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {([
                      { id: 'wan_animate', label: '🎬 Wan 2.2', hint: 'I2V général, photoreal' },
                      { id: 'tooncrafter', label: '🎨 ToonCrafter', hint: 'Interpolation cartoon entre 2 keyframes' },
                      { id: 'ltx_video',   label: '⚡ LTX 0.9.5',  hint: 'Lightricks LTX, rapide, fp16 ~5GB' },
                    ] as { id: AnimWorkflow; label: string; hint: string }[]).map(w => (
                      <button key={w.id} onClick={() => setWorkflow(w.id)}
                        title={w.hint}
                        style={{ ...btnStyle, flex: '1 1 100px', fontSize: 11,
                          background: workflow === w.id ? '#EC4899' : '#1a1a1e' }}>
                        {w.label}
                      </button>
                    ))}
                  </div>
                </Field>

                {workflow === 'tooncrafter' && (
                  <>
                    <Field label="2ème keyframe — URL (manuel)">
                      <input
                        type="text"
                        value={endFrameUrl}
                        onChange={e => setEndFrameUrl(e.target.value)}
                        placeholder="https://… ou utilise le générateur ci-dessous"
                        style={inputStyle}
                      />
                    </Field>

                    <Field label="✨ Générer la 2ème keyframe via img2img">
                      <textarea
                        value={endPrompt}
                        onChange={e => setEndPrompt(e.target.value)}
                        rows={3}
                        placeholder="Décris la pose finale du sujet (en EN)…"
                        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                      />
                      <div style={{ marginTop: 6 }}>
                        <label style={{ fontSize: 10, color: '#9898b4' }}>
                          Denoise : <code>{endDenoise.toFixed(2)}</code>
                          <span style={{ marginLeft: 6, color: '#666' }}>
                            (0.5 = quasi identique · 0.75 = pose change · 0.9 = forte variation)
                          </span>
                        </label>
                        <input
                          type="range" min={0.5} max={0.95} step={0.05} value={endDenoise}
                          onChange={e => setEndDenoise(Number(e.target.value))}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <button
                        onClick={handleGenerateEndFrame}
                        disabled={!cutoutUrl || endGenerating || !endPrompt.trim()}
                        style={{ ...btnStyle, background: '#3b82f6', marginTop: 6, padding: 8, fontSize: 12 }}
                      >
                        {endGenerating ? '⏳ Génération…' : '🪄 Générer 2ème keyframe'}
                      </button>
                      {endError && (
                        <div style={{ marginTop: 4, padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 10 }}>
                          ❌ {endError}
                        </div>
                      )}
                    </Field>

                    {endFrameUrl && (
                      <div>
                        <div style={{ fontSize: 10, color: '#9898b4', marginBottom: 4 }}>
                          Preview 2ème keyframe :
                        </div>
                        <div style={{
                          height: 140, aspectRatio: '1/1',
                          background: `url(${endFrameUrl}) center/contain no-repeat #1a1a1e`,
                          border: '1px solid #2a2a30', borderRadius: 4,
                        }} />
                      </div>
                    )}

                    <div style={{ fontSize: 10, color: '#666' }}>
                      ToonCrafter interpole entre cutout (début) et 2ème keyframe (fin).
                    </div>
                  </>
                )}

                <Field label="Preset prompt">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {PROMPT_PRESETS.map((p, i) => (
                      <button key={p.label} onClick={() => applyAnimPreset(i)}
                        style={{ ...btnStyle, fontSize: 11, padding: '6px 8px',
                          background: i === animPreset ? '#EC4899' : '#1a1a1e' }}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Prompt animation">
                  <textarea value={animPrompt} onChange={e => setAnimPrompt(e.target.value)} rows={3}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                </Field>
                <Field label={`Frames : ${frames} (${(frames / fps).toFixed(1)}s @ ${fps}fps)`}>
                  <input type="range" min={5} max={49} step={4} value={frames}
                    onChange={e => setFrames(Number(e.target.value))} style={{ width: '100%' }} />
                  {workflow === 'tooncrafter' && frames > 16 && (
                    <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 2 }}>
                      ⚠ ToonCrafter sera clampé à 16 frames max (limite VRAM 8GB)
                    </div>
                  )}
                </Field>
                <Field label={`FPS : ${fps}`}>
                  <input type="range" min={6} max={24} step={1} value={fps}
                    onChange={e => setFps(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
                {workflow === 'wan_animate' && (
                  <Field label={`Denoise : ${denoise.toFixed(2)}`}>
                    <input type="range" min={0.2} max={1} step={0.05} value={denoise}
                      onChange={e => setDenoise(Number(e.target.value))} style={{ width: '100%' }} />
                  </Field>
                )}
                <Field label={`Steps : ${steps}`}>
                  <input type="range" min={15} max={50} step={1} value={steps}
                    onChange={e => setSteps(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
                <Field label={`CFG : ${cfg}`}>
                  <input type="range" min={1} max={10} step={0.5} value={cfg}
                    onChange={e => setCfg(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
                <button
                  onClick={handleRunAnimation}
                  disabled={isAnyAnimRunning || !animPrompt.trim()}
                  style={{ ...btnStyle, background: '#10B981', padding: 10, fontSize: 13, fontWeight: 600 }}
                >
                  {isAnyAnimRunning ? '⏳ Animation en cours…' : '🎬 Générer animation'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase' }}>
                  Historique ({runs.length})
                </div>
                {runs.length === 0 && (
                  <div style={{ padding: 16, background: '#0f0f13', border: '1px dashed #2a2a30', borderRadius: 6, fontSize: 12, color: '#666', textAlign: 'center' }}>
                    Lance une animation pour voir les résultats ici.
                    <br />Compte ~3-6 min selon frames + steps.
                  </div>
                )}
                {runs.map(run => <RunCard key={run.id} run={run} />)}
              </div>
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

// ── Composants ────────────────────────────────────────────────────────────

function RunCard({ run }: { run: AnimRun }) {
  const elapsed = Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)
  return (
    <div style={{ padding: 10, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: '#9898b4' }}>
          <code style={{ color: '#10B981', marginRight: 6 }}>
            {run.workflow === 'tooncrafter' ? '🎨 TC' : '🎬 Wan'}
          </code>
          <code style={{ color: '#d4a84c' }}>{run.detectionLabel}</code>
          <span style={{ marginLeft: 6 }}>{run.frames}f</span>
          {run.workflow === 'wan_animate' && <span style={{ marginLeft: 6 }}>denoise <code>{run.denoise.toFixed(2)}</code></span>}
          <span style={{ marginLeft: 6 }}>{run.width}×{run.height}</span>
        </span>
        <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
          background: run.status === 'done' ? '#10B981' : run.status === 'error' ? '#7f1d1d' : '#EC4899', color: '#fff' }}>
          {run.status} · {elapsed}s
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#9898b4', fontStyle: 'italic' }}>&ldquo;{run.prompt}&rdquo;</div>
      {run.status === 'done' && run.videoUrl && (
        <video src={run.videoUrl} controls autoPlay loop muted style={{ width: '100%', maxHeight: 400, borderRadius: 4, background: '#000' }} />
      )}
      {run.status === 'error' && (
        <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {run.error}</div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: 11, color: '#9898b4' }}>{label}</label>
      {children}
    </div>
  )
}

const pageStyle: React.CSSProperties = { minHeight: '100vh', padding: '2rem', background: '#0d0d0d', color: '#ede9df', fontFamily: 'Inter, -apple-system, sans-serif' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', background: '#1a1a1e', border: '1px solid #2a2a30', borderRadius: 4, color: '#ede9df', fontSize: 12 }
const btnStyle: React.CSSProperties = { padding: '8px 12px', background: '#1a1a1e', border: '1px solid #2a2a30', borderRadius: 4, color: '#ede9df', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }
