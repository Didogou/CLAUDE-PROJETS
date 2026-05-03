'use client'
/**
 * POC Insert Anything (song-wensong/insert-anything) — insertion preservant l'identite.
 *
 * Pipeline :
 *   1. Upload scene cible + image de reference (sujet a inserer)
 *   2. RMBG transparent sur la reference -> alpha = ref_mask (silhouette du sujet)
 *   3. Source mask : auto via Grounded-SAM (l'auteur tape "barrel"), ou upload manuel
 *   4. Insert Anything workflow :
 *      - ReduxProcess prepare la reference
 *      - CLIPVision + Flux Redux StyleModel injecte l'identite dans le conditioning
 *      - FillProcess cree le diptych [ref | scene] + diptych mask
 *      - KSampler regenere la moitie droite en s'inspirant de la moitie gauche
 *      - CropBack recolle le resultat dans la scene originale
 *
 * Avantage VS Flux Fill seul : identite preservee (pas une approximation par texte).
 * Avantage VS IPAdapter : marche pour TOUT (animal, objet, perso non-humain).
 *
 * Stack : Flux Fill GGUF Q4 + Insert Anything LoRA + Flux Redux + SigLIP.
 * Custom node : mo230761/InsertAnything-ComfyUI-official + city96/ComfyUI-GGUF.
 */

import React, { useCallback, useEffect, useState } from 'react'

interface PipelineStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  resultText?: string
  resultImageUrl?: string
  error?: string
  durationMs?: number
}

interface Run {
  id: string
  refUrl: string
  refTransparentUrl: string
  srcUrl: string
  srcMaskUrl: string
  srcMaskPrompt: string
  steps: number
  guidance: number
  marginPx: number
  status: 'uploading' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  promptId?: string
  resultUrl?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

export default function InsertAnythingTestPage() {
  // ── Inputs ──
  const [srcUrl, setSrcUrl] = useState('')
  const [refUrl, setRefUrl] = useState('')
  const [refTransparentUrl, setRefTransparentUrl] = useState('')
  const [srcMaskPrompt, setSrcMaskPrompt] = useState('')
  const [srcMaskUrl, setSrcMaskUrl] = useState<string | null>(null)
  const [refMaskUrl, setRefMaskUrl] = useState<string | null>(null)  // PNG du masque ref généré côté client depuis l'alpha

  const [uploading, setUploading] = useState<'src' | 'ref' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [removingRefBg, setRemovingRefBg] = useState(false)
  const [refBgError, setRefBgError] = useState<string | null>(null)
  const [detectingSrcMask, setDetectingSrcMask] = useState(false)
  const [srcMaskError, setSrcMaskError] = useState<string | null>(null)

  // ── Génération source ET référence depuis prompt (T2I via Juggernaut) ──
  // Évite à l'auteur de devoir naviguer vers le Studio pour préparer ses images.
  // Tout le pipeline tient dans la POC.
  const [srcPrompt, setSrcPrompt] = useState('')
  const [generatingSrc, setGeneratingSrc] = useState(false)
  const [srcGenError, setSrcGenError] = useState<string | null>(null)
  const [refPrompt, setRefPrompt] = useState('')
  const [generatingRef, setGeneratingRef] = useState(false)
  const [refGenError, setRefGenError] = useState<string | null>(null)

  // ── Analyse pose/orientation auto (Claude Vision) ──
  // Étape critique du pipeline prod : avant de générer la référence, on analyse
  // la pose/orientation du sujet à remplacer dans la scène source. Le résultat
  // est injecté dans le prompt de la référence pour garantir la cohérence pose
  // (règle critique d'Insert Anything, cf. mémoire test_suite).
  const [analyzingPose, setAnalyzingPose] = useState(false)
  const [poseAnalysis, setPoseAnalysis] = useState<{
    pose: string
    orientation: string
    view_position: string
    prompt_attributes: string
    provider?: 'local' | 'cloud'  // 'local' = Qwen VL Ollama, 'cloud' = Claude
  } | null>(null)
  const [poseError, setPoseError] = useState<string | null>(null)

  // ── Mode auto pipeline ──
  // L'auteur écrit un prompt naturel ("Remplace l'homme par une elfe blonde")
  // et tout s'enchaîne automatiquement avec affichage des étapes.
  const [authorPrompt, setAuthorPrompt] = useState('')
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([])
  // Force ControlNet OpenPose même si l'heuristique ne détecte pas humain
  // (utile pour debug / forcer le test du mode pose)
  const [forceControlNetPose, setForceControlNetPose] = useState(false)

  // ── Run config (defaults du workflow officiel) ──
  const [steps, setSteps] = useState(28)
  const [guidance, setGuidance] = useState(30)
  // marginPx = marge en pixels autour de la zone d'insertion détectée.
  // Insert Anything REMPLACE la zone détectée par le sujet. Pour avoir
  // "chat SUR le tonneau" (vs "chat À LA PLACE du tonneau"), il faut étendre
  // le mask au-dessus du tonneau. Internement converti en `iterations`
  // FillProcess (kernel 7×7, ~7px par iteration).
  const [marginPx, setMarginPx] = useState(50)
  const [runs, setRuns] = useState<Run[]>([])

  // ── Upload src/ref ──
  async function handleUpload(slot: 'src' | 'ref', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(slot)
    setUploadError(null)
    if (slot === 'src') { setSrcUrl(''); setSrcMaskUrl(null) }
    else { setRefUrl(''); setRefTransparentUrl(''); setRefMaskUrl(null) }
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('path', `test/insert-anything/${slot}_${Date.now()}`)
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'upload failed')
      if (slot === 'src') setSrcUrl(data.url)
      else setRefUrl(data.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(null)
    }
  }

  // ── Génère la SCÈNE SOURCE à la volée via T2I (workflow background Juggernaut) ──
  // Pour scènes complexes : pas de suffixe "white background centered" cette fois,
  // on veut un environnement narratif détaillé.
  async function handleGenerateSrc() {
    if (!srcPrompt.trim()) return
    setGeneratingSrc(true)
    setSrcGenError(null)
    setSrcUrl('')
    setSrcMaskUrl(null)
    try {
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1000))

      const enrichedPrompt = `${srcPrompt.trim()}, painterly illustration style, detailed environment, dramatic warm lighting, cinematic composition`

      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'background',
          prompt_positive: enrichedPrompt,
          prompt_negative: 'blurry, low quality, watermark, text, signature, ugly composition',
          width: 1280, height: 720,  // ratio paysage pour scène
          steps: 30, cfg: 7, seed: -1,
        }),
      }).then(r => r.json())
      if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'queue T2I failed')

      const maxWait = Date.now() + 5 * 60 * 1000
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'generation failed')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout (5 min)')

      const storagePath = `test/insert-anything/src_gen_${Date.now()}`
      const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
      if (!iData.image_url) throw new Error(iData.error ?? 'image_url manquante')
      setSrcUrl(iData.image_url)
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    } catch (err) {
      setSrcGenError(err instanceof Error ? err.message : String(err))
    } finally {
      setGeneratingSrc(false)
    }
  }

  // ── Analyse la pose/orientation du sujet source via Claude Vision ──
  async function handleAnalyzePose() {
    if (!srcUrl) return
    setAnalyzingPose(true)
    setPoseError(null)
    setPoseAnalysis(null)
    try {
      const res = await fetch('/api/analyze-pose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: srcUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'analyze failed')
      setPoseAnalysis(data)
      // Si le user n'a pas encore tapé son prompt ref custom, on prepare
      // un placeholder enrichi pour qu'il n'ait qu'à modifier le sujet
      if (!refPrompt.trim()) {
        setRefPrompt(`[describe the subject here], ${data.prompt_attributes}`)
      }
    } catch (err) {
      setPoseError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnalyzingPose(false)
    }
  }

  // ── Génère la référence à la volée via T2I (workflow portrait Juggernaut) ──
  async function handleGenerateRef() {
    if (!refPrompt.trim()) return
    setGeneratingRef(true)
    setRefGenError(null)
    setRefUrl('')
    setRefTransparentUrl('')
    setRefMaskUrl(null)
    try {
      // Free VRAM avant (Insert Anything modèles peuvent rester chargés)
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1000))

      // Suffixe auto pour favoriser une référence propre :
      // - fond blanc → facile à détourer ensuite
      // - sujet centré et entier → bbox extraction propre par ReduxProcess
      const enrichedPrompt = `${refPrompt.trim()}, white background, centered, full subject visible, painterly illustration style`

      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'portrait',
          prompt_positive: enrichedPrompt,
          prompt_negative: 'blurry, low quality, multiple subjects, cluttered background, watermark',
          width: 1024, height: 1024,
          steps: 30, cfg: 7, seed: -1,
        }),
      }).then(r => r.json())
      if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'queue T2I failed')

      const maxWait = Date.now() + 5 * 60 * 1000
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'generation failed')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout (5 min)')

      const storagePath = `test/insert-anything/ref_gen_${Date.now()}`
      const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
      if (!iData.image_url) throw new Error(iData.error ?? 'image_url manquante')
      setRefUrl(iData.image_url)
      // Free VRAM avant la suite (Insert Anything va recharger ses modèles)
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    } catch (err) {
      setRefGenError(err instanceof Error ? err.message : String(err))
    } finally {
      setGeneratingRef(false)
    }
  }

  // ── Détourer ref via rembg transparent ──
  async function handleRemoveRefBg() {
    if (!refUrl) return
    setRemovingRefBg(true)
    setRefBgError(null)
    setRefTransparentUrl('')
    setRefMaskUrl(null)
    try {
      const res = await fetch('/api/remove-bg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: refUrl, transparent: true }),
      })
      const data = await res.json()
      if (!res.ok || !data.image_url) throw new Error(data.error ?? 'rembg failed')
      setRefTransparentUrl(data.image_url)
    } catch (err) {
      setRefBgError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemovingRefBg(false)
    }
  }

  // ── Génère le ref_mask depuis l'alpha du PNG transparent ──
  // Charge le transparent dans un canvas, extrait alpha → mask binaire blanc/noir,
  // upload comme nouveau PNG dans Supabase
  useEffect(() => {
    if (!refTransparentUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = async () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const d = data.data
        for (let i = 0; i < d.length; i += 4) {
          const isOpaque = d[i + 3] > 10
          d[i] = d[i + 1] = d[i + 2] = isOpaque ? 255 : 0
          d[i + 3] = 255
        }
        ctx.putImageData(data, 0, 0)
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('blob failed')), 'image/png'))
        const url = await uploadBlob(blob, `test/insert-anything/ref_mask_${Date.now()}.png`)
        setRefMaskUrl(url)
      } catch (err) {
        setRefBgError(`ref_mask generation failed: ${err}`)
      }
    }
    img.onerror = () => setRefBgError('Failed to load transparent ref for mask extraction')
    img.src = refTransparentUrl
  }, [refTransparentUrl])

  // ── Filtre le mask : ne garde que la plus grande blob blanche connectée ──
  // Utile quand Grounded-SAM détecte plusieurs zones (multi-instances) et qu'on
  // ne veut garder que l'objet principal. Flood-fill côté client, pas de backend.
  const [filteringMask, setFilteringMask] = useState(false)
  async function handleKeepLargestZone() {
    if (!srcMaskUrl) return
    setFilteringMask(true)
    try {
      const img = await loadImg(srcMaskUrl)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const w = canvas.width
      const h = canvas.height
      const visited = new Uint8Array(w * h)
      const blobs: { pixels: number[] }[] = []

      // Flood-fill itératif sur chaque pixel blanc non visité → trouve les blobs
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x
          if (visited[idx]) continue
          if (data.data[idx * 4] < 128) { visited[idx] = 1; continue }
          const blob: number[] = []
          const queue: [number, number][] = [[x, y]]
          while (queue.length > 0) {
            const [cx, cy] = queue.pop()!
            if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue
            const cidx = cy * w + cx
            if (visited[cidx]) continue
            if (data.data[cidx * 4] < 128) { visited[cidx] = 1; continue }
            visited[cidx] = 1
            blob.push(cidx)
            queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
          }
          if (blob.length > 0) blobs.push({ pixels: blob })
        }
      }

      if (blobs.length === 0) {
        setSrcMaskError('Aucune zone détectée dans le mask')
        return
      }
      if (blobs.length === 1) {
        // Déjà une seule zone, rien à filtrer
        setSrcMaskError('Une seule zone déjà — pas de filtrage nécessaire')
        return
      }

      // Trie par taille décroissante, garde la plus grande
      blobs.sort((a, b) => b.pixels.length - a.pixels.length)
      const largest = blobs[0]

      // Reconstruit le mask : noir partout, blanc uniquement sur la plus grande blob
      const newCanvas = document.createElement('canvas')
      newCanvas.width = w
      newCanvas.height = h
      const newCtx = newCanvas.getContext('2d')!
      newCtx.fillStyle = 'black'
      newCtx.fillRect(0, 0, w, h)
      const newData = newCtx.getImageData(0, 0, w, h)
      for (const idx of largest.pixels) {
        const pi = idx * 4
        newData.data[pi] = 255
        newData.data[pi + 1] = 255
        newData.data[pi + 2] = 255
        newData.data[pi + 3] = 255
      }
      newCtx.putImageData(newData, 0, 0)

      const newBlob = await new Promise<Blob>((resolve, reject) =>
        newCanvas.toBlob(b => b ? resolve(b) : reject(new Error('blob failed')), 'image/png'))
      const url = await uploadBlob(newBlob, `test/insert-anything/src_mask_filtered_${Date.now()}.png`)
      setSrcMaskUrl(url)
    } catch (err) {
      setSrcMaskError(err instanceof Error ? err.message : `filter failed: ${err}`)
    } finally {
      setFilteringMask(false)
    }
  }

  // ── Détecter source mask via Grounded-SAM ──
  async function handleDetectSrcMask() {
    if (!srcUrl || !srcMaskPrompt.trim()) return
    setDetectingSrcMask(true)
    setSrcMaskError(null)
    setSrcMaskUrl(null)
    try {
      const res = await fetch('/api/comfyui/grounded-sam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: srcUrl, prompt_text: srcMaskPrompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.mask_url) throw new Error(data.error ?? data.message ?? 'detection failed')
      setSrcMaskUrl(data.mask_url)
    } catch (err) {
      setSrcMaskError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetectingSrcMask(false)
    }
  }

  // ── Reset masks quand on change les images ──
  useEffect(() => { setSrcMaskUrl(null); setSrcMaskError(null) }, [srcUrl])

  // ── Helper : crop l'image source au bbox du mask + padding ──
  // Permet d'envoyer à Qwen VL une image où le sujet remplit ~70-90% au lieu
  // de l'image source entière (qui contient beaucoup de contexte parasite).
  // Améliore drastiquement la précision pose/orientation/view détectée.
  async function cropImageToMaskBbox(imageUrl: string, maskUrl: string, paddingRatio = 0.15): Promise<string> {
    const img = await loadImg(imageUrl)
    const mask = await loadImg(maskUrl)
    const w = img.naturalWidth
    const h = img.naturalHeight

    // Charge le mask au size de l'image (resize si différent)
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = w
    maskCanvas.height = h
    const maskCtx = maskCanvas.getContext('2d')!
    maskCtx.drawImage(mask, 0, 0, w, h)
    const maskData = maskCtx.getImageData(0, 0, w, h).data

    // Trouve le bbox des pixels blancs
    let minX = w, minY = h, maxX = 0, maxY = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        if (maskData[idx] > 128) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (minX > maxX || minY > maxY) throw new Error('Mask vide — bbox impossible à calculer')

    // Padding autour du bbox
    const bboxW = maxX - minX
    const bboxH = maxY - minY
    const padX = Math.round(bboxW * paddingRatio)
    const padY = Math.round(bboxH * paddingRatio)
    const x0 = Math.max(0, minX - padX)
    const y0 = Math.max(0, minY - padY)
    const x1 = Math.min(w, maxX + padX)
    const y1 = Math.min(h, maxY + padY)
    const cropW = x1 - x0
    const cropH = y1 - y0

    // Crop
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = cropW
    cropCanvas.height = cropH
    const cropCtx = cropCanvas.getContext('2d')!
    cropCtx.drawImage(img, x0, y0, cropW, cropH, 0, 0, cropW, cropH)

    const blob = await new Promise<Blob>((resolve, reject) =>
      cropCanvas.toBlob(b => b ? resolve(b) : reject(new Error('crop blob failed')), 'image/png'))
    return await uploadBlob(blob, `test/insert-anything/sub_crop_${Date.now()}.png`)
  }

  // ── Auto Pipeline orchestrateur ──
  // Enchaîne TOUTES les étapes :
  //   1. NLU parse intention auteur
  //   2. Grounded-SAM detect zone source
  //   3. Filter largest zone (si multi)
  //   4. Crop sujet pour analyse VLM
  //   5. Qwen VL analyse pose/orientation sur le crop
  //   6. Construction prompt enrichi auto
  //   7. T2I (Juggernaut) génère référence
  //   8. RMBG transparent + extraction silhouette
  //   9. Insert Anything → résultat
  async function runAutoPipeline() {
    if (!srcUrl || !authorPrompt.trim()) return
    setPipelineRunning(true)

    const initSteps: PipelineStep[] = [
      { id: 'nlu', label: '1. NLU — analyse intention auteur (Ollama Qwen)', status: 'pending' },
      { id: 'detect', label: '2. Détection zone source (Grounded-SAM)', status: 'pending' },
      { id: 'filter', label: '3. Filtre plus grande zone si multi', status: 'pending' },
      { id: 'crop', label: '4. Crop sujet (focus pour VLM)', status: 'pending' },
      { id: 'pose', label: '5. Analyse pose/orientation (Qwen VL 3B)', status: 'pending' },
      { id: 'enrich', label: '6. Construction prompt enrichi', status: 'pending' },
      { id: 't2i', label: '7. Génération T2I de la référence (Juggernaut)', status: 'pending' },
      { id: 'rmbg', label: '8. Détourage référence (rembg + silhouette)', status: 'pending' },
      { id: 'insert', label: '9. Insert Anything (Flux Fill + Redux + LoRA)', status: 'pending' },
      { id: 'iclight', label: '10. IC-Light V2 — harmonisation lumière + ombres', status: 'pending' },
    ]
    setPipelineSteps(initSteps)

    // Helper : update une étape spécifique
    const updateStep = (id: string, patch: Partial<PipelineStep>) => {
      setPipelineSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    }

    let activeStepId = 'nlu'
    try {
      // ─── 1. NLU ───
      activeStepId = 'nlu'
      let t0 = Date.now()
      updateStep('nlu', { status: 'running' })
      const nluRes = await fetch('/api/ai/parse-replace-command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: authorPrompt.trim() }),
      })
      const nlu = await nluRes.json()
      if (!nluRes.ok) throw new Error(nlu.message ?? nlu.error ?? 'NLU failed')
      updateStep('nlu', {
        status: 'done',
        resultText: `source: "${nlu.source_keyword}"${nlu.source_spatial ? ` (${nlu.source_spatial})` : ''} → target: "${nlu.target_description}"`,
        durationMs: Date.now() - t0,
      })
      const sourceKeyword: string = nlu.source_keyword
      const targetDescription: string = nlu.target_description

      // ─── 2. Grounded-SAM ───
      activeStepId = 'detect'
      t0 = Date.now()
      updateStep('detect', { status: 'running' })
      const dRes = await fetch('/api/comfyui/grounded-sam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: srcUrl, prompt_text: sourceKeyword }),
      })
      const dData = await dRes.json()
      if (!dRes.ok || !dData.mask_url) throw new Error(dData.message ?? dData.error ?? 'detection failed')
      let currentMaskUrl: string = dData.mask_url
      setSrcMaskUrl(currentMaskUrl)
      setSrcMaskPrompt(sourceKeyword)
      updateStep('detect', { status: 'done', resultImageUrl: currentMaskUrl, durationMs: Date.now() - t0 })

      // ─── 3. Filter largest zone (toujours, ne peut pas faire de mal si 1 zone) ───
      activeStepId = 'filter'
      t0 = Date.now()
      updateStep('filter', { status: 'running' })
      try {
        const img = await loadImg(currentMaskUrl)
        const cv = document.createElement('canvas')
        cv.width = img.naturalWidth
        cv.height = img.naturalHeight
        const ctx = cv.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, cv.width, cv.height)
        const w = cv.width, h = cv.height
        const visited = new Uint8Array(w * h)
        const blobs: { pixels: number[] }[] = []
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = y * w + x
            if (visited[idx]) continue
            if (data.data[idx * 4] < 128) { visited[idx] = 1; continue }
            const blob: number[] = []
            const queue: [number, number][] = [[x, y]]
            while (queue.length > 0) {
              const [cx, cy] = queue.pop()!
              if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue
              const cidx = cy * w + cx
              if (visited[cidx]) continue
              if (data.data[cidx * 4] < 128) { visited[cidx] = 1; continue }
              visited[cidx] = 1
              blob.push(cidx)
              queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
            }
            if (blob.length > 0) blobs.push({ pixels: blob })
          }
        }
        if (blobs.length > 1) {
          blobs.sort((a, b) => b.pixels.length - a.pixels.length)
          const largest = blobs[0]
          const newCv = document.createElement('canvas')
          newCv.width = w
          newCv.height = h
          const newCtx = newCv.getContext('2d')!
          newCtx.fillStyle = 'black'
          newCtx.fillRect(0, 0, w, h)
          const newData = newCtx.getImageData(0, 0, w, h)
          for (const idx of largest.pixels) {
            const pi = idx * 4
            newData.data[pi] = newData.data[pi + 1] = newData.data[pi + 2] = 255
            newData.data[pi + 3] = 255
          }
          newCtx.putImageData(newData, 0, 0)
          const newBlob = await new Promise<Blob>((res, rej) =>
            newCv.toBlob(b => b ? res(b) : rej(new Error('filter blob failed')), 'image/png'))
          currentMaskUrl = await uploadBlob(newBlob, `test/insert-anything/auto_mask_filtered_${Date.now()}.png`)
          setSrcMaskUrl(currentMaskUrl)
          updateStep('filter', { status: 'done', resultText: `${blobs.length} zones → 1 conservée (la plus grande)`, resultImageUrl: currentMaskUrl, durationMs: Date.now() - t0 })
        } else {
          updateStep('filter', { status: 'skipped', resultText: '1 seule zone détectée — pas de filtrage', durationMs: Date.now() - t0 })
        }
      } catch (e) {
        updateStep('filter', { status: 'error', error: String(e) })
        throw e
      }

      // ─── 4. Crop sujet pour VLM ───
      activeStepId = 'crop'
      t0 = Date.now()
      updateStep('crop', { status: 'running' })
      const cropUrl = await cropImageToMaskBbox(srcUrl, currentMaskUrl, 0.15)
      updateStep('crop', { status: 'done', resultImageUrl: cropUrl, durationMs: Date.now() - t0 })

      // ─── 5. Qwen VL pose analysis sur le crop ───
      activeStepId = 'pose'
      t0 = Date.now()
      updateStep('pose', { status: 'running' })
      const pRes = await fetch('/api/analyze-pose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: cropUrl }),
      })
      const pData = await pRes.json()
      if (!pRes.ok) throw new Error(pData.error ?? 'pose analysis failed')
      setPoseAnalysis(pData)
      updateStep('pose', {
        status: 'done',
        resultText: `${pData.pose} / ${pData.orientation} / ${pData.view_position} → "${pData.prompt_attributes}" (via ${pData.provider})`,
        durationMs: Date.now() - t0,
      })

      // ─── 6. Construction prompt enrichi ───
      activeStepId = 'enrich'
      t0 = Date.now()
      updateStep('enrich', { status: 'running' })
      const enrichedRefPrompt = `${targetDescription}, ${pData.prompt_attributes}`
      setRefPrompt(enrichedRefPrompt)
      updateStep('enrich', { status: 'done', resultText: enrichedRefPrompt, durationMs: Date.now() - t0 })

      // ─── 7. T2I de la référence ───
      // Branche conditionnelle :
      //   - Si target est HUMAIN → ControlNet OpenPose (squelette extrait du crop
      //     source impose la pose géométrique, plus précis que texte)
      //   - Sinon (animal/objet) → T2I texte simple (OpenPose ne marche pas)
      activeStepId = 't2i'
      t0 = Date.now()
      updateStep('t2i', { status: 'running' })
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1000))
      const refSuffix = ', white background, centered, full subject visible, painterly illustration style'
      // Heuristique humain : check si target_description matche un mot-clé humain
      // (le NLU pourrait passer un flag explicite plus tard)
      const humanKeywords = /\b(person|man|woman|girl|boy|child|lady|gentleman|knight|warrior|wizard|mage|elf|dwarf|orc|blacksmith|villager|merchant|soldier|king|queen|prince|princess|hero|character|humain|homme|femme|personne)\b/i
      const isHuman = forceControlNetPose || humanKeywords.test(targetDescription) || humanKeywords.test(sourceKeyword)
      // Affichage immédiat du mode utilisé pour transparence debug
      updateStep('t2i', { resultText: isHuman
        ? `✨ Mode ControlNet OpenPose (humain détecté${forceControlNetPose ? ' - FORCÉ' : ''})`
        : `📝 Mode T2I texte simple (sujet non-humain : "${targetDescription.slice(0, 40)}...")` })
      const t2iQueue = await fetch('/api/comfyui', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isHuman ? {
          // ControlNet OpenPose : impose la pose géométrique du sujet source
          workflow_type: 'posed_ref_t2i',
          source_image: await uploadToComfy(cropUrl, 'pose_src'),
          prompt_positive: enrichedRefPrompt + refSuffix,
          prompt_negative: 'blurry, low quality, multiple subjects, cluttered background, watermark, deformed pose',
          width: 1024, height: 1024, steps: 30, cfg: 7, seed: -1,
        } : {
          // T2I texte simple pour non-humains
          workflow_type: 'portrait',
          prompt_positive: enrichedRefPrompt + refSuffix,
          prompt_negative: 'blurry, low quality, multiple subjects, cluttered background, watermark',
          width: 1024, height: 1024, steps: 30, cfg: 7, seed: -1,
        }),
      }).then(r => r.json())
      if (!t2iQueue.prompt_id) throw new Error(t2iQueue.error ?? 'T2I queue failed')
      // Poll
      let succeeded = false
      const maxWait = Date.now() + 5 * 60 * 1000
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sData = await fetch(`/api/comfyui?prompt_id=${t2iQueue.prompt_id}`).then(r => r.json())
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'T2I failed')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('T2I timeout')
      const t2iImg = await fetch(`/api/comfyui?prompt_id=${t2iQueue.prompt_id}&action=image&storage_path=${encodeURIComponent(`test/insert-anything/auto_ref_gen_${Date.now()}`)}`).then(r => r.json())
      if (!t2iImg.image_url) throw new Error('T2I image_url manquante')
      const generatedRefUrl: string = t2iImg.image_url
      setRefUrl(generatedRefUrl)
      updateStep('t2i', {
        status: 'done',
        resultImageUrl: generatedRefUrl,
        resultText: isHuman ? '✨ ControlNet OpenPose (pose squelette imposée)' : 'T2I texte simple (sujet non-humain)',
        durationMs: Date.now() - t0,
      })

      // ─── 8. RMBG transparent + extraction silhouette ───
      activeStepId = 'rmbg'
      t0 = Date.now()
      updateStep('rmbg', { status: 'running' })
      const rmbgRes = await fetch('/api/remove-bg', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: generatedRefUrl, transparent: true }),
      })
      const rmbgData = await rmbgRes.json()
      if (!rmbgRes.ok || !rmbgData.image_url) throw new Error(rmbgData.error ?? 'rmbg failed')
      const transparentRefUrl: string = rmbgData.image_url
      setRefTransparentUrl(transparentRefUrl)
      // Extraction silhouette client (sera générée par useEffect → setRefMaskUrl)
      // On attend que ce soit prêt
      const transparentImg = await loadImg(transparentRefUrl)
      const silCv = document.createElement('canvas')
      silCv.width = transparentImg.naturalWidth
      silCv.height = transparentImg.naturalHeight
      const silCtx = silCv.getContext('2d')!
      silCtx.drawImage(transparentImg, 0, 0)
      const silData = silCtx.getImageData(0, 0, silCv.width, silCv.height)
      const sd = silData.data
      for (let i = 0; i < sd.length; i += 4) {
        const isOpaque = sd[i + 3] > 10
        sd[i] = sd[i + 1] = sd[i + 2] = isOpaque ? 255 : 0
        sd[i + 3] = 255
      }
      silCtx.putImageData(silData, 0, 0)
      const silBlob = await new Promise<Blob>((res, rej) =>
        silCv.toBlob(b => b ? res(b) : rej(new Error('silhouette blob failed')), 'image/png'))
      const computedRefMaskUrl = await uploadBlob(silBlob, `test/insert-anything/auto_ref_mask_${Date.now()}.png`)
      setRefMaskUrl(computedRefMaskUrl)
      updateStep('rmbg', { status: 'done', resultImageUrl: computedRefMaskUrl, durationMs: Date.now() - t0 })

      // ─── 9. Insert Anything ───
      activeStepId = 'insert'
      t0 = Date.now()
      updateStep('insert', { status: 'running' })
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))
      const upSrc = await uploadToComfy(srcUrl, 'auto_src')
      const upSrcMask = await uploadToComfy(currentMaskUrl, 'auto_src_mask')
      const upRef = await uploadToComfy(generatedRefUrl, 'auto_ref')
      const upRefMask = await uploadToComfy(computedRefMaskUrl, 'auto_ref_mask')
      const insQueue = await fetch('/api/comfyui', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'insert_anything',
          source_image: upSrc,
          mask_image: upSrcMask,
          reference_image: upRef,
          reference_mask_image: upRefMask,
          prompt_positive: '',
          prompt_negative: '',
          steps, cfg: guidance,
          mask_grow: marginPx,
          seed: -1,
        }),
      }).then(r => r.json())
      if (!insQueue.prompt_id) throw new Error(insQueue.error ?? 'Insert queue failed')
      const maxWait2 = Date.now() + 10 * 60 * 1000
      let insSucceeded = false
      while (Date.now() < maxWait2) {
        await new Promise(r => setTimeout(r, 3000))
        const sData = await fetch(`/api/comfyui?prompt_id=${insQueue.prompt_id}`).then(r => r.json())
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'Insert failed')
        if (sData.status === 'succeeded') { insSucceeded = true; break }
      }
      if (!insSucceeded) throw new Error('Insert Anything timeout')
      const finalImg = await fetch(`/api/comfyui?prompt_id=${insQueue.prompt_id}&action=image&storage_path=${encodeURIComponent(`test/insert-anything/auto_result_${Date.now()}`)}`).then(r => r.json())
      if (!finalImg.image_url) throw new Error('Insert image_url manquante')
      const insertResultUrl: string = finalImg.image_url
      updateStep('insert', { status: 'done', resultImageUrl: insertResultUrl, durationMs: Date.now() - t0 })
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})

      // ─── 10. IC-Light V2 — harmonisation lumière + ombres ───
      // Reprend le résultat Insert Anything + scène originale → relighting
      // cohérent avec ombres au sol. Étape qui transforme un "collage IA" en
      // "intégration narrative crédible".
      activeStepId = 'iclight'
      t0 = Date.now()
      updateStep('iclight', { status: 'running' })
      try {
        await new Promise(r => setTimeout(r, 1000))
        const upInsResult = await uploadToComfy(insertResultUrl, 'iclight_src')
        const upBgScene = await uploadToComfy(srcUrl, 'iclight_bg')
        const icQueue = await fetch('/api/comfyui', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflow_type: 'ic_light_harmonize',
            source_image: upInsResult,         // résultat Insert Anything (foreground à relighter)
            background_image: upBgScene,       // scène originale (background guide la lumière)
            prompt_positive: 'seamless integration, realistic shadows on the ground, ambient occlusion, harmonized lighting matching the warm candlelight environment, soft natural light, painterly style',
            prompt_negative: 'artifacts, blurry, distorted, harsh edges, glitchy lighting',
            steps: 25, cfg: 2.0, seed: -1,
          }),
        }).then(r => r.json())
        if (!icQueue.prompt_id) throw new Error(icQueue.error ?? 'IC-Light queue failed')
        const maxWait3 = Date.now() + 5 * 60 * 1000
        let icSucceeded = false
        while (Date.now() < maxWait3) {
          await new Promise(r => setTimeout(r, 3000))
          const sData = await fetch(`/api/comfyui?prompt_id=${icQueue.prompt_id}`).then(r => r.json())
          if (sData.error) throw new Error(sData.error)
          if (sData.status === 'failed') throw new Error(sData.error ?? 'IC-Light failed')
          if (sData.status === 'succeeded') { icSucceeded = true; break }
        }
        if (!icSucceeded) throw new Error('IC-Light timeout')
        const icImg = await fetch(`/api/comfyui?prompt_id=${icQueue.prompt_id}&action=image&storage_path=${encodeURIComponent(`test/insert-anything/auto_iclight_${Date.now()}`)}`).then(r => r.json())
        if (!icImg.image_url) throw new Error('IC-Light image_url manquante')
        updateStep('iclight', { status: 'done', resultImageUrl: icImg.image_url, durationMs: Date.now() - t0 })
        await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})

        // Le RÉSULTAT FINAL est l'image IC-Light (avec ombres + lumière harmonisée)
        setRuns(prev => [{
          id: `auto-${Date.now()}`, srcUrl, refUrl: generatedRefUrl, refTransparentUrl: transparentRefUrl,
          srcMaskUrl: currentMaskUrl, srcMaskPrompt: sourceKeyword,
          steps, guidance, marginPx,
          status: 'done', resultUrl: icImg.image_url,
          startedAt: Date.now(), finishedAt: Date.now(),
        }, ...prev])
      } catch (icErr) {
        // Si IC-Light plante, on garde au moins le résultat Insert Anything
        updateStep('iclight', { status: 'error', error: icErr instanceof Error ? icErr.message : String(icErr) })
        setRuns(prev => [{
          id: `auto-${Date.now()}`, srcUrl, refUrl: generatedRefUrl, refTransparentUrl: transparentRefUrl,
          srcMaskUrl: currentMaskUrl, srcMaskPrompt: sourceKeyword,
          steps, guidance, marginPx,
          status: 'done', resultUrl: insertResultUrl,
          startedAt: Date.now(), finishedAt: Date.now(),
        }, ...prev])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      updateStep(activeStepId, { status: 'error', error: msg })
    } finally {
      setPipelineRunning(false)
    }
  }

  // ── Generate ──
  const handleGenerate = useCallback(async () => {
    if (!srcUrl || !srcMaskUrl || !refUrl || !refMaskUrl) return
    const id = `run-${Date.now()}`
    const newRun: Run = {
      id, srcUrl, refUrl, refTransparentUrl,
      srcMaskUrl, srcMaskPrompt,
      steps, guidance, marginPx,
      status: 'uploading', startedAt: Date.now(),
    }
    setRuns(prev => [newRun, ...prev])

    try {
      // Free VRAM avant
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))

      // Upload 4 images vers ComfyUI input : src, src_mask, ref, ref_mask
      const upSrc = await uploadToComfy(srcUrl, 'ia_src')
      const upSrcMask = await uploadToComfy(srcMaskUrl, 'ia_src_mask')
      const upRef = await uploadToComfy(refUrl, 'ia_ref')
      const upRefMask = await uploadToComfy(refMaskUrl, 'ia_ref_mask')

      // Queue Insert Anything
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'queuing' } : r))
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'insert_anything',
          source_image: upSrc,
          mask_image: upSrcMask,
          reference_image: upRef,
          reference_mask_image: upRefMask,
          prompt_positive: '',
          prompt_negative: '',
          steps,
          cfg: guidance,
          mask_grow: marginPx,  // workflow convertit en iterations FillProcess (px/24)
          seed: -1,
        }),
      }).then(r => r.json())
      if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'queue failed')
      setRuns(prev => prev.map(r => r.id === id ? { ...r, promptId: queueRes.prompt_id, status: 'generating' } : r))

      // Poll
      const maxWait = Date.now() + 8 * 60 * 1000
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'generation failed')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout (8 min)')

      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'fetching' } : r))
      const storagePath = `test/insert-anything/result_${id}`
      const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
      if (!iData.image_url) throw new Error(iData.error ?? 'image_url manquante')
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'done', resultUrl: iData.image_url, finishedAt: Date.now() } : r))
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: msg, finishedAt: Date.now() } : r))
    }
  }, [srcUrl, srcMaskUrl, refUrl, refMaskUrl, refTransparentUrl, srcMaskPrompt, steps, guidance, marginPx])

  const isAnyRunning = runs.some(r => r.status !== 'done' && r.status !== 'error')
  const ready = srcUrl && srcMaskUrl && refUrl && refMaskUrl

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1500, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Insert Anything — insertion préservant l&apos;identité
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Pattern diptyque : la <strong style={{ color: '#10B981' }}>référence</strong> guide l&apos;identité,
          Flux Redux injecte la signature visuelle, Flux Fill remplit la zone masquée.
          Marche pour <strong>tout sujet</strong> (animal, objet, perso), pas seulement les visages humains.
        </p>

        {/* ── 🚀 AUTO PIPELINE — l'auteur écrit, tout s'enchaîne ── */}
        <div style={{
          marginBottom: 16,
          padding: 14,
          background: 'linear-gradient(135deg, #1a0d2e 0%, #0d2818 100%)',
          border: '2px solid #10B981',
          borderRadius: 8,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#10B981' }}>
            🚀 AUTO PIPELINE — pipeline complet automatisé
          </div>
          <div style={{ fontSize: 11, color: '#9898b4', lineHeight: 1.5 }}>
            <strong>Mode prod cible</strong> — l&apos;auteur upload une scène (① ci-dessous) puis écrit son intention en
            langage naturel. Hero exécute toute la chaîne : NLU → détection → analyse pose VLM → génération réf →
            détourage → Insert Anything. Toutes les étapes s&apos;affichent en temps réel.
          </div>
          <textarea value={authorPrompt} onChange={e => setAuthorPrompt(e.target.value)}
            placeholder='Ex: "Remplace l&apos;homme assis par une elfe blonde avec une robe verte"'
            rows={2} disabled={pipelineRunning}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#9898b4', cursor: 'pointer' }}>
            <input type="checkbox" checked={forceControlNetPose}
              onChange={e => setForceControlNetPose(e.target.checked)}
              disabled={pipelineRunning} />
            <strong style={{ color: '#10B981' }}>✨ Forcer ControlNet OpenPose</strong>
            <span>(override l&apos;heuristique humain — utile pour debug)</span>
          </label>
          <button onClick={runAutoPipeline}
            disabled={!srcUrl || !authorPrompt.trim() || pipelineRunning}
            style={{
              ...btnStyle,
              background: (!srcUrl || !authorPrompt.trim() || pipelineRunning) ? '#444' : '#10B981',
              padding: 12, fontSize: 14, fontWeight: 700,
            }}>
            {pipelineRunning ? '⏳ Pipeline en cours…'
              : !srcUrl ? '⚠ Upload une scène source d\'abord (Section ①)'
              : !authorPrompt.trim() ? '⚠ Décris ton intention'
              : '🚀 Lancer le pipeline complet'}
          </button>
          {pipelineSteps.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              {pipelineSteps.map(step => <PipelineStepCard key={step.id} step={step} />)}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            <Section title="① Image source (la scène cible)">
              {/* ── 1a : Génération depuis prompt (T2I via Juggernaut, workflow background) ── */}
              <div style={{ fontSize: 11, color: '#9898b4', fontWeight: 600, marginTop: -2 }}>
                🎨 Option A — Générer depuis un prompt
              </div>
              <div style={{ fontSize: 10, color: '#666', lineHeight: 1.4, marginTop: -4 }}>
                Décris la scène (en EN). Suffixe painterly + éclairage + composition ajouté auto.
              </div>
              <textarea value={srcPrompt} onChange={e => setSrcPrompt(e.target.value)} rows={2}
                placeholder='ex: "medieval tavern interior with wooden barrels, warm candlelight"'
                disabled={generatingSrc}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              <button onClick={handleGenerateSrc}
                disabled={!srcPrompt.trim() || generatingSrc || uploading !== null}
                style={{
                  ...btnStyle,
                  background: (!srcPrompt.trim() || generatingSrc) ? '#444' : '#7C3AED',
                  fontWeight: 600,
                }}>
                {generatingSrc ? '⏳ Génération scène… (~30-60s)' : '🎨 Générer la scène'}
              </button>
              {srcGenError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {srcGenError}</div>}

              {/* ── 1b : OU upload manuel ── */}
              <div style={{ fontSize: 11, color: '#9898b4', fontWeight: 600, marginTop: 8 }}>
                📁 Option B — Upload une image existante
              </div>
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpload('src', e)} disabled={uploading !== null || generatingSrc}
                style={{ ...inputStyle, padding: 6 }} />
              {uploading === 'src' && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
              {srcUrl && <div style={{ marginTop: 6, background: `url(${srcUrl}) center/contain no-repeat #1a1a1e`, height: 120, border: '1px solid #2a2a30', borderRadius: 4 }} />}
            </Section>

            <Section title="② Zone d'insertion dans la scène">
              <div style={{ fontSize: 11, color: '#666', lineHeight: 1.5 }}>
                Tape un mot-clé EN (<code style={{ color: '#10B981' }}>barrel</code>, <code style={{ color: '#10B981' }}>stool</code>…)
                pour détecter via Grounded-SAM la zone où placer le sujet.
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={srcMaskPrompt} onChange={e => setSrcMaskPrompt(e.target.value)}
                  placeholder="ex: barrel" disabled={!srcUrl || detectingSrcMask}
                  style={{ ...inputStyle, flex: 1 }} />
                <button onClick={handleDetectSrcMask}
                  disabled={!srcUrl || !srcMaskPrompt.trim() || detectingSrcMask}
                  style={{ ...btnStyle, background: (!srcUrl || !srcMaskPrompt.trim() || detectingSrcMask) ? '#444' : '#7C3AED', fontWeight: 600 }}>
                  {detectingSrcMask ? '⏳' : '🎯 Détecter'}
                </button>
              </div>
              {srcMaskUrl && <div style={{ marginTop: 6, background: `url(${srcMaskUrl}) center/contain no-repeat #1a1a1e`, height: 100, border: '1px solid #10B981', borderRadius: 4 }} />}
              {srcMaskUrl && (
                <button onClick={handleKeepLargestZone} disabled={filteringMask}
                  style={{ ...btnStyle, background: filteringMask ? '#444' : '#1a1a1e', border: '1px solid #10B981', fontSize: 11 }}>
                  {filteringMask ? '⏳ Filtrage…' : '🎯 Conserver la plus grande zone (filtre flood-fill)'}
                </button>
              )}
              {srcMaskUrl && (
                <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                  Si Grounded-SAM a détecté plusieurs zones (multi-instances), garde la plus grande
                  (utile quand des petits objets parasites sont détectés à côté du sujet principal).
                </div>
              )}
              {srcMaskError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {srcMaskError}</div>}
            </Section>

            <Section title="🤖 Pose & orientation du sujet à remplacer (auto)">
              <div style={{ fontSize: 11, color: '#666', lineHeight: 1.5 }}>
                Avant de générer la référence, analyse le sujet source via Claude Vision.
                La pose et l&apos;orientation détectées seront <strong>injectées dans le prompt
                référence</strong> pour garantir la cohérence (règle critique Insert Anything).
              </div>
              <button onClick={handleAnalyzePose}
                disabled={!srcUrl || analyzingPose}
                style={{
                  ...btnStyle,
                  background: (!srcUrl || analyzingPose) ? '#444' : '#7C3AED',
                  fontWeight: 600,
                }}>
                {analyzingPose ? '⏳ Analyse Claude Vision…' : '🤖 Analyser pose & orientation auto'}
              </button>
              {poseError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {poseError}</div>}
              {poseAnalysis && (
                <div style={{ padding: 8, background: '#0d2818', border: '1px solid #10B981', borderRadius: 4, fontSize: 11, lineHeight: 1.6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <strong style={{ color: '#10B981' }}>Analyse VLM</strong>
                    {poseAnalysis.provider && (
                      <span style={{
                        fontSize: 9,
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: poseAnalysis.provider === 'local' ? '#10B981' : '#F97316',
                        color: '#fff',
                        fontWeight: 600,
                      }}>
                        {poseAnalysis.provider === 'local' ? '🟢 LOCAL (Qwen VL 3B)' : '☁ CLOUD (Claude Vision)'}
                      </span>
                    )}
                  </div>
                  <div><strong>pose:</strong> <code style={{ color: '#10B981' }}>{poseAnalysis.pose}</code></div>
                  <div><strong>orientation:</strong> <code style={{ color: '#10B981' }}>{poseAnalysis.orientation}</code></div>
                  <div><strong>view:</strong> <code style={{ color: '#10B981' }}>{poseAnalysis.view_position}</code></div>
                  <div style={{ marginTop: 6, fontSize: 10, color: '#9898b4' }}>
                    Attributs injectés : <em>&ldquo;{poseAnalysis.prompt_attributes}&rdquo;</em>
                  </div>
                  <button onClick={() => setRefPrompt(`[describe the subject here], ${poseAnalysis.prompt_attributes}`)}
                    style={{
                      ...btnStyle,
                      background: '#10B981',
                      fontSize: 11,
                      fontWeight: 600,
                      marginTop: 8,
                      width: '100%',
                    }}>
                    📝 Injecter ces attributs dans le prompt référence (écrase l&apos;actuel)
                  </button>
                </div>
              )}
            </Section>

            <Section title="③ Image de référence (le sujet à insérer)">
              {/* ── 3a : Génération depuis prompt (T2I via Juggernaut) ── */}
              <div style={{ fontSize: 11, color: '#9898b4', fontWeight: 600, marginTop: -2 }}>
                🎨 Option A — Générer depuis un prompt
              </div>
              <div style={{ fontSize: 10, color: '#666', lineHeight: 1.4, marginTop: -4 }}>
                Décris le sujet (en EN). Fond blanc + cadrage propre ajoutés auto pour
                faciliter le détourage qui suit.
              </div>
              <textarea value={refPrompt} onChange={e => setRefPrompt(e.target.value)} rows={2}
                placeholder='ex: "a brown labrador dog sitting, full body"'
                disabled={generatingRef}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              <button onClick={handleGenerateRef}
                disabled={!refPrompt.trim() || generatingRef || uploading !== null}
                style={{
                  ...btnStyle,
                  background: (!refPrompt.trim() || generatingRef) ? '#444' : '#7C3AED',
                  fontWeight: 600,
                }}>
                {generatingRef ? '⏳ Génération T2I… (~30-60s)' : '🎨 Générer la référence'}
              </button>
              {refGenError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {refGenError}</div>}

              {/* ── 3b : OU upload manuel ── */}
              <div style={{ fontSize: 11, color: '#9898b4', fontWeight: 600, marginTop: 8 }}>
                📁 Option B — Upload une image existante
              </div>
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpload('ref', e)} disabled={uploading !== null || generatingRef}
                style={{ ...inputStyle, padding: 6 }} />
              {uploading === 'ref' && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
              {refUrl && <div style={{ marginTop: 6, background: `url(${refUrl}) center/contain no-repeat #1a1a1e`, height: 100, border: '1px solid #2a2a30', borderRadius: 4 }} />}
              {refUrl && (
                <button onClick={handleRemoveRefBg} disabled={removingRefBg}
                  style={{ ...btnStyle, background: removingRefBg ? '#444' : '#7C3AED', fontWeight: 600 }}>
                  {removingRefBg ? '⏳ Détourage…' : '✂ Détourer (extrait silhouette)'}
                </button>
              )}
              {refBgError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {refBgError}</div>}
              {refTransparentUrl && (
                <div style={{ fontSize: 10, color: '#10B981' }}>
                  ✓ Détouré + silhouette (ref_mask) extraite{refMaskUrl ? ' et uploadée' : '…'}
                </div>
              )}
              {refTransparentUrl && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                  <div>
                    <div style={{ fontSize: 9, color: '#9898b4', marginBottom: 2 }}>PNG transparent</div>
                    <div style={{
                      // Damier pour bien voir la transparence
                      backgroundImage: `url(${refTransparentUrl}), linear-gradient(45deg, #2a2a30 25%, transparent 25%), linear-gradient(-45deg, #2a2a30 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a30 75%), linear-gradient(-45deg, transparent 75%, #2a2a30 75%)`,
                      backgroundSize: 'contain, 12px 12px, 12px 12px, 12px 12px, 12px 12px',
                      backgroundPosition: 'center, 0 0, 0 6px, 6px -6px, -6px 0',
                      backgroundRepeat: 'no-repeat, repeat, repeat, repeat, repeat',
                      backgroundColor: '#1a1a1e',
                      height: 90, border: '1px solid #10B981', borderRadius: 4,
                    }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: '#9898b4', marginBottom: 2 }}>Silhouette (ref_mask)</div>
                    <div style={{
                      background: refMaskUrl ? `url(${refMaskUrl}) center/contain no-repeat #1a1a1e` : '#1a1a1e',
                      height: 90, border: '1px solid #a78bfa', borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: '#666',
                    }}>
                      {!refMaskUrl && '⏳'}
                    </div>
                  </div>
                </div>
              )}
            </Section>

            {uploadError && <div style={{ padding: 8, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {uploadError}</div>}

            <Section title="④ Paramètres">
              <Field label={`Steps : ${steps}`}>
                <input type="range" min={10} max={40} step={1} value={steps}
                  onChange={e => setSteps(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>28 (default workflow officiel)</div>
              </Field>
              <Field label={`Guidance Flux : ${guidance}`}>
                <input type="range" min={5} max={50} step={1} value={guidance}
                  onChange={e => setGuidance(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>30 (default Flux Fill)</div>
              </Field>
              <Field label={`Marge zone d'insertion : ${marginPx}px`}>
                <input type="range" min={0} max={250} step={10} value={marginPx}
                  onChange={e => setMarginPx(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                  <strong>0-30px</strong> : remplace l&apos;objet détecté (chat À LA PLACE du tonneau)<br />
                  <strong>50-100px</strong> : étend autour (chat SUR ou AUTOUR du tonneau)<br />
                  <strong>150-250px</strong> : très large zone (sujet centré, contexte recomposé)
                </div>
              </Field>
            </Section>

            <button onClick={handleGenerate}
              disabled={!ready || isAnyRunning}
              style={{ ...btnStyle, background: (!ready || isAnyRunning) ? '#444' : '#10B981', padding: 12, fontSize: 14, fontWeight: 600 }}>
              {isAnyRunning ? '⏳ Génération…'
                : !srcUrl ? '⚠ Upload une scène'
                : !srcMaskUrl ? '⚠ Détecte zone d\'insertion'
                : !refUrl ? '⚠ Upload une référence'
                : !refMaskUrl ? '⚠ Détoure la référence'
                : '🎨 Insérer (Insert Anything)'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10B981', textTransform: 'uppercase' }}>
              Historique ({runs.length})
            </div>
            {runs.length === 0 && (
              <div style={{ padding: 24, background: '#0f0f13', border: '1px dashed #2a2a30', borderRadius: 6, fontSize: 12, color: '#666', textAlign: 'center' }}>
                Upload scène + référence, détecte zone et silhouette, insère.
                <br />
                ~60-180s sur 8 GB VRAM (Flux Fill GGUF Q4 + LoRA + Redux).
              </div>
            )}
            {runs.map(run => <RunCard key={run.id} run={run} />)}
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#10B981' }}>Pourquoi cette POC vs flux-fill-composite :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li><strong>Identité préservée par construction</strong> via Flux Redux (style model dédié), pas via prompt texte</li>
            <li><strong>Pas de drag-drop manuel</strong> — la position est déduite du source_mask (Grounded-SAM)</li>
            <li><strong>Pas de gestion des ombres séparée</strong> — Flux Fill harmonise nativement</li>
            <li><strong>Marche pour tout sujet</strong> — pas limité aux visages comme IPAdapter Plus Face</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──
function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`load failed: ${url}`))
    img.src = url
  })
}

async function uploadBlob(blob: Blob, path: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, path.split('/').pop() ?? 'file.png')
  form.append('path', path.replace(/\.png$/, ''))
  const res = await fetch('/api/upload-image', { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok || !data.url) throw new Error(data.error ?? 'upload blob failed')
  return data.url
}

async function uploadToComfy(url: string, name: string): Promise<string> {
  const res = await fetch('/api/comfyui/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'url', url, name }),
  })
  const data = await res.json()
  if (!res.ok || !data.filename) throw new Error(data.error ?? `comfy upload ${name} failed`)
  return data.filename
}

function PipelineStepCard({ step }: { step: PipelineStep }) {
  const statusBg = {
    pending: '#1a1a1e',
    running: '#7C3AED',
    done: '#10B981',
    error: '#7f1d1d',
    skipped: '#444',
  }[step.status]
  const statusIcon = {
    pending: '⏸',
    running: '⏳',
    done: '✓',
    error: '❌',
    skipped: '⊘',
  }[step.status]
  return (
    <div style={{
      padding: 8,
      background: '#0a0a0d',
      border: `1px solid ${statusBg}`,
      borderRadius: 4,
      display: 'flex', flexDirection: 'column', gap: 4,
      fontSize: 11,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ color: step.status === 'done' ? '#10B981' : step.status === 'error' ? '#fecaca' : '#9898b4', fontWeight: 600 }}>
          {statusIcon} {step.label}
        </span>
        {step.durationMs != null && (
          <code style={{ fontSize: 9, color: '#666' }}>{(step.durationMs / 1000).toFixed(1)}s</code>
        )}
      </div>
      {step.resultText && (
        <div style={{ fontSize: 10, color: '#9898b4', fontStyle: 'italic', paddingLeft: 16 }}>
          → {step.resultText}
        </div>
      )}
      {step.resultImageUrl && (
        <div style={{
          marginLeft: 16,
          background: `url(${step.resultImageUrl}) center/contain no-repeat #1a1a1e`,
          height: 80, border: '1px solid #2a2a30', borderRadius: 3,
        }} />
      )}
      {step.error && (
        <div style={{ padding: 4, background: '#7f1d1d', borderRadius: 3, fontSize: 10, color: '#fecaca', marginLeft: 16 }}>
          ❌ {step.error}
        </div>
      )}
    </div>
  )
}

function RunCard({ run }: { run: Run }) {
  const elapsed = Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)
  return (
    <div style={{ padding: 10, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: '#9898b4' }}>
          <code style={{ color: '#10B981' }}>{run.steps}st / g{run.guidance}</code>
          <span style={{ marginLeft: 6, color: '#a78bfa' }}>zone: &ldquo;{run.srcMaskPrompt}&rdquo;</span>
        </span>
        <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
          background: run.status === 'done' ? '#10B981' : run.status === 'error' ? '#7f1d1d' : '#F97316', color: '#fff' }}>
          {run.status} · {elapsed}s
        </span>
      </div>
      {run.status === 'done' && run.resultUrl && (
        <img src={run.resultUrl} alt="result" style={{ width: '100%', borderRadius: 4, background: '#000' }} />
      )}
      {run.status === 'error' && (
        <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {run.error}</div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#10B981', textTransform: 'uppercase' }}>{title}</div>
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
