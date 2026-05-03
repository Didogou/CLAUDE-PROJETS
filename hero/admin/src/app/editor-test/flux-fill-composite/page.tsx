'use client'
/**
 * POC Flux Fill Composite — pattern d'insertion d'objet contrôlé.
 *
 * Workflow (cf vidéo Pixaroma "workflows in ComfyUI" du 28/04) :
 *   1. Upload background (scène) + foreground (l'objet, ex: chat)
 *   2. RMBG sur foreground → fond gris #808080
 *   3. Chroma key client-side sur le gris → image transparente du chat
 *   4. Drag-drop + scale par l'auteur sur la scène
 *   5. Composition côté client : drawImage(bg) puis drawImage(fg, x, y, w, h)
 *   6. Génération du mask (bbox du fg + marge pour les ombres)
 *   7. Flux Fill avec le composite + mask + prompt d'harmonisation
 *      → Flux Fill harmonise les bords, ajoute les ombres, lisse l'éclairage
 *
 * Avantage vs Flux Fill seul : apparence + position + taille du sujet inséré
 * sont 100% contrôlées par l'auteur. Flux Fill ne fait QUE l'harmonisation.
 *
 * Stack : RMBG local (fond gris) + canvas 2D + Flux Fill GGUF Q4 (déjà installé).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'

interface Run {
  id: string
  prompt: string
  compositeUrl: string
  maskUrl: string
  status: 'compositing' | 'uploading' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  promptId?: string
  resultUrl?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

// Deux prompts par défaut selon le mode mask :
// - 'fill'   : silhouette regénérée → décrire le sujet attendu
// - 'corona' : sujet préservé pixel-perfect → décrire l'effet (ombres seulement)
const PROMPT_FILL_DEFAULT = 'a small ginger tabby cat sitting on top of the wooden barrel, fluffy fur, calm pose, warm orange candlelight on its body, soft realistic shadow on the barrel surface, painterly style, medieval tavern interior'
const PROMPT_CORONA_DEFAULT = 'soft realistic shadow under the subject on the surface beneath, ambient occlusion, warm candlelight, painterly style, blend seamlessly with the surrounding environment'

type MaskMode = 'fill' | 'corona'

export default function FluxFillCompositePage() {
  // ── Inputs ──────────────────────────────────────────────
  const [bgUrl, setBgUrl] = useState('')
  const [fgUrl, setFgUrl] = useState('')                          // FG original (avant RMBG)
  const [fgTransparentUrl, setFgTransparentUrl] = useState('')    // FG transparent (sortie rembg mode transparent)
  const [uploading, setUploading] = useState<'bg' | 'fg' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [removingBg, setRemovingBg] = useState(false)
  const [rmbgError, setRmbgError] = useState<string | null>(null)

  // ── Placement (en % de la scène pour rester responsive) ─
  const [posX, setPosX] = useState(50)    // %, centre par défaut
  const [posY, setPosY] = useState(60)
  const [scale, setScale] = useState(40)  // % de la largeur de la scène
  const [bgDims, setBgDims] = useState<{ w: number, h: number } | null>(null)
  const [fgDims, setFgDims] = useState<{ w: number, h: number } | null>(null)

  // ── Drag state ──────────────────────────────────────────
  const dragRef = useRef<{ startX: number, startY: number, origX: number, origY: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // ── Run config ──────────────────────────────────────────
  // Mode mask :
  // - 'fill'   : mask = silhouette + dilation. Flux REGÉNÈRE le sujet → identité non préservée,
  //              prompt doit décrire le sujet attendu. Bon pour insertion guidée par texte.
  // - 'corona' : mask = couronne autour (silhouette dilatée MOINS silhouette stricte).
  //              Le sujet collé reste pixel-perfect. Flux ne peint QUE les ombres autour.
  //              Idéal pour préserver l'identité (perso récurrent, objet de référence).
  const [maskMode, setMaskMode] = useState<MaskMode>('corona')
  const [prompt, setPrompt] = useState(PROMPT_CORONA_DEFAULT)
  const [maskMargin, setMaskMargin] = useState(64)  // dilation autour de la silhouette
  const [maskBlur, setMaskBlur] = useState(16)
  const [steps, setSteps] = useState(20)
  const [guidance, setGuidance] = useState(30)
  const [runs, setRuns] = useState<Run[]>([])

  // Quand on switch de mode, on remplace le prompt par celui par défaut du nouveau mode
  // (uniquement si le user a laissé l'autre default — on ne force pas si custom)
  useEffect(() => {
    if (maskMode === 'corona' && prompt === PROMPT_FILL_DEFAULT) setPrompt(PROMPT_CORONA_DEFAULT)
    else if (maskMode === 'fill' && prompt === PROMPT_CORONA_DEFAULT) setPrompt(PROMPT_FILL_DEFAULT)
  }, [maskMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload BG / FG ──────────────────────────────────────
  async function handleUpload(slot: 'bg' | 'fg', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(slot)
    setUploadError(null)
    if (slot === 'bg') setBgUrl(''); else { setFgUrl(''); setFgTransparentUrl('') }
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('path', `test/flux-fill-composite/${slot}_${Date.now()}`)
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'upload failed')
      if (slot === 'bg') setBgUrl(data.url); else setFgUrl(data.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(null)
    }
  }

  // ── RMBG via endpoint Hero, mode TRANSPARENT (PNG RGBA natif, pas de
  // composite gris). On skip totalement le chroma key client qui foirait
  // sur les bords anti-aliasés (halos visibles sur fonds difficiles).
  async function handleRemoveBg() {
    if (!fgUrl) return
    setRemovingBg(true)
    setRmbgError(null)
    setFgTransparentUrl('')
    try {
      const res = await fetch('/api/remove-bg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: fgUrl, transparent: true }),
      })
      const data = await res.json()
      if (!res.ok || !data.image_url) throw new Error(data.error ?? 'rmbg failed')
      // Le PNG est déjà transparent côté serveur — directement utilisable
      setFgTransparentUrl(data.image_url)
    } catch (err) {
      setRmbgError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemovingBg(false)
    }
  }

  // Charge les dims du fg transparent quand il arrive (pour le compositing)
  useEffect(() => {
    if (!fgTransparentUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setFgDims({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = fgTransparentUrl
  }, [fgTransparentUrl])

  // ── Charge dims du BG quand il arrive ──
  useEffect(() => {
    if (!bgUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setBgDims({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = bgUrl
  }, [bgUrl])

  // ── Drag handlers ───────────────────────────────────────
  function onFgMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: posX, origY: posY,
    }
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current || !stageRef.current) return
      const stage = stageRef.current.getBoundingClientRect()
      const dx = ((e.clientX - dragRef.current.startX) / stage.width) * 100
      const dy = ((e.clientY - dragRef.current.startY) / stage.height) * 100
      setPosX(Math.max(0, Math.min(100, dragRef.current.origX + dx)))
      setPosY(Math.max(0, Math.min(100, dragRef.current.origY + dy)))
    }
    function onUp() { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Composition + mask + Flux Fill ──────────────────────
  const handleGenerate = useCallback(async () => {
    if (!bgUrl || !fgTransparentUrl || !bgDims || !fgDims) return
    const id = `run-${Date.now()}`
    const newRun: Run = {
      id, prompt, compositeUrl: '', maskUrl: '',
      status: 'compositing', startedAt: Date.now(),
    }
    setRuns(prev => [newRun, ...prev])

    try {
      // 1. Calcule la bbox du fg dans les coords du bg (pixels absolus)
      const targetW = (scale / 100) * bgDims.w
      const targetH = targetW * (fgDims.h / fgDims.w)
      const cx = (posX / 100) * bgDims.w
      const cy = (posY / 100) * bgDims.h
      const fgX = cx - targetW / 2
      const fgY = cy - targetH / 2

      // 2. Compose le PNG final (bg + fg à la position/taille choisies)
      const compCanvas = document.createElement('canvas')
      compCanvas.width = bgDims.w
      compCanvas.height = bgDims.h
      const compCtx = compCanvas.getContext('2d')!
      const bgImg = await loadImg(bgUrl)
      compCtx.drawImage(bgImg, 0, 0)
      const fgImg = await loadImg(fgTransparentUrl)
      compCtx.drawImage(fgImg, fgX, fgY, targetW, targetH)
      const compositeBlob = await new Promise<Blob>((res, rej) =>
        compCanvas.toBlob(b => b ? res(b) : rej(new Error('composite blob')), 'image/png'))

      // 3. Génère le mask selon le mode choisi :
      //    - 'fill'   : silhouette stricte du fg (Flux régénère le sujet)
      //    - 'corona' : couronne autour (silhouette dilatée MOINS stricte)
      //                 → le sujet collé reste pixel-perfect, Flux ne peint que les ombres
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = bgDims.w
      maskCanvas.height = bgDims.h
      const maskCtx = maskCanvas.getContext('2d')!
      maskCtx.fillStyle = 'black'
      maskCtx.fillRect(0, 0, bgDims.w, bgDims.h)

      // Étape 3a : silhouette stricte = pixels blancs là où alpha>seuil,
      //            transparents ailleurs. PAS de fond noir opaque, sinon
      //            destination-out efface partout au lieu de juste la silhouette.
      const canvasStrict = document.createElement('canvas')
      canvasStrict.width = bgDims.w
      canvasStrict.height = bgDims.h
      const strictCtx = canvasStrict.getContext('2d')!
      strictCtx.drawImage(fgImg, fgX, fgY, targetW, targetH)
      const strictData = strictCtx.getImageData(0, 0, bgDims.w, bgDims.h)
      const sd = strictData.data
      for (let i = 0; i < sd.length; i += 4) {
        if (sd[i + 3] > 10) {
          sd[i] = sd[i + 1] = sd[i + 2] = 255
          sd[i + 3] = 255
        } else {
          sd[i + 3] = 0  // garde transparent ailleurs
        }
      }
      strictCtx.putImageData(strictData, 0, 0)

      if (maskMode === 'fill') {
        // Mode fill : silhouette stricte sur fond noir (côté serveur fera GrowMask + Blur)
        maskCtx.drawImage(canvasStrict, 0, 0)
      } else {
        // Mode corona : couronne = (silhouette dilatée) - (silhouette stricte)
        //
        // 3b : silhouette DILATÉE via blur(margin/2). Le blur étale l'alpha
        //      vers l'extérieur. On seuille sur l'alpha pour récupérer la zone
        //      étendue en blanc opaque, le reste reste TRANSPARENT (pas noir).
        const canvasDilated = document.createElement('canvas')
        canvasDilated.width = bgDims.w
        canvasDilated.height = bgDims.h
        const dilCtx = canvasDilated.getContext('2d')!
        dilCtx.filter = `blur(${Math.max(2, maskMargin / 2)}px)`
        dilCtx.drawImage(canvasStrict, 0, 0)
        dilCtx.filter = 'none'
        const dilData = dilCtx.getImageData(0, 0, bgDims.w, bgDims.h)
        const dd = dilData.data
        for (let i = 0; i < dd.length; i += 4) {
          if (dd[i + 3] > 30) {
            // Pixel dans la zone dilatée → blanc opaque
            dd[i] = dd[i + 1] = dd[i + 2] = 255
            dd[i + 3] = 255
          } else {
            // Hors zone → transparent
            dd[i + 3] = 0
          }
        }
        dilCtx.putImageData(dilData, 0, 0)

        // 3c : couronne = dilated avec strict effacée
        //      maskCtx commence avec fond noir (fillRect plus haut).
        //      On dessine dilatée → la zone élargie devient blanche.
        //      destination-out de strict → efface uniquement les pixels là où
        //      strict est NON-TRANSPARENT (donc la silhouette du chat).
        //      Les pixels effacés deviennent transparents : on les rebascule en noir.
        maskCtx.drawImage(canvasDilated, 0, 0)
        maskCtx.globalCompositeOperation = 'destination-out'
        maskCtx.drawImage(canvasStrict, 0, 0)
        maskCtx.globalCompositeOperation = 'source-over'
        // Rebascule les pixels effacés (alpha=0) en noir opaque
        const finalData = maskCtx.getImageData(0, 0, bgDims.w, bgDims.h)
        const fd = finalData.data
        for (let i = 0; i < fd.length; i += 4) {
          if (fd[i + 3] < 255) {
            fd[i] = fd[i + 1] = fd[i + 2] = 0
            fd[i + 3] = 255
          }
        }
        maskCtx.putImageData(finalData, 0, 0)
      }
      const maskBlob = await new Promise<Blob>((res, rej) =>
        maskCanvas.toBlob(b => b ? res(b) : rej(new Error('mask blob')), 'image/png'))

      // 4. Upload composite + mask sur Supabase via /api/upload-image
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'uploading' } : r))
      const compUrl = await uploadBlob(compositeBlob, `test/flux-fill-composite/composite_${id}.png`)
      const maskUrl = await uploadBlob(maskBlob, `test/flux-fill-composite/mask_${id}.png`)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, compositeUrl: compUrl, maskUrl } : r))

      // 5. Free VRAM puis upload vers ComfyUI input
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))
      const upComp = await fetch('/api/comfyui/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: compUrl, name: 'composite' }),
      }).then(r => r.json())
      if (!upComp.filename) throw new Error(upComp.error ?? 'upload composite failed')
      const upMask = await fetch('/api/comfyui/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: maskUrl, name: 'mask' }),
      }).then(r => r.json())
      if (!upMask.filename) throw new Error(upMask.error ?? 'upload mask failed')

      // 6. Queue Flux Fill
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'queuing' } : r))
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'flux_fill',
          source_image: upComp.filename,
          mask_image: upMask.filename,
          // En mode 'corona', la dilation est déjà faite côté client (couronne XOR
          // calculée). Côté serveur on n'ajoute QUE le blur pour adoucir les bords.
          // En mode 'fill', côté serveur applique GrowMask sur la silhouette stricte.
          mask_grow: maskMode === 'fill' ? maskMargin : 0,
          mask_blur: maskBlur,
          prompt_positive: prompt,
          prompt_negative: '',
          steps,
          cfg: guidance,
          seed: -1,
        }),
      }).then(r => r.json())
      if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'queue failed')
      setRuns(prev => prev.map(r => r.id === id ? { ...r, promptId: queueRes.prompt_id, status: 'generating' } : r))

      // 7. Poll
      const maxWait = Date.now() + 8 * 60 * 1000
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'generation failed')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout')

      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'fetching' } : r))
      const storagePath = `test/flux-fill-composite/result_${id}`
      const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
      if (!iData.image_url) throw new Error(iData.error ?? 'image_url manquante')
      setRuns(prev => prev.map(r =>
        r.id === id ? { ...r, status: 'done', resultUrl: iData.image_url, finishedAt: Date.now() } : r,
      ))
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: msg, finishedAt: Date.now() } : r))
    }
  }, [bgUrl, fgTransparentUrl, bgDims, fgDims, posX, posY, scale, prompt, maskMode, maskMargin, maskBlur, steps, guidance])

  const isAnyRunning = runs.some(r => r.status !== 'done' && r.status !== 'error')
  const ready = bgUrl && fgTransparentUrl && bgDims && fgDims

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1500, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Flux Fill Composite — insertion contrôlée par drag-drop
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Composite layered : tu places ton chat où tu veux, à la taille que tu veux.
          Flux Fill <strong style={{ color: '#10B981' }}>harmonise seulement</strong> (ombres, lumière, bords) — il n&apos;invente plus le sujet.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
          {/* ── Form ───────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section title="① Background (la scène)">
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpload('bg', e)} disabled={uploading !== null}
                style={{ ...inputStyle, padding: 6 }} />
              {uploading === 'bg' && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
              {bgUrl && <div style={{
                marginTop: 6,
                background: `url(${bgUrl}) center/contain no-repeat #1a1a1e`,
                height: 120, border: '1px solid #2a2a30', borderRadius: 4,
              }} />}
            </Section>

            <Section title="② Foreground (objet à insérer)">
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpload('fg', e)} disabled={uploading !== null}
                style={{ ...inputStyle, padding: 6 }} />
              {uploading === 'fg' && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
              {fgUrl && <div style={{
                marginTop: 6,
                background: `url(${fgUrl}) center/contain no-repeat #1a1a1e`,
                height: 100, border: '1px solid #2a2a30', borderRadius: 4,
              }} />}
              {fgUrl && (
                <button onClick={handleRemoveBg} disabled={removingBg}
                  style={{ ...btnStyle, background: removingBg ? '#444' : '#7C3AED', fontWeight: 600 }}>
                  {removingBg ? '⏳ Détourage…' : '✂ Détourer le fond'}
                </button>
              )}
              {rmbgError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {rmbgError}</div>}
              {fgTransparentUrl && (
                <div style={{ fontSize: 10, color: '#10B981' }}>
                  ✓ Détouré et chroma key appliqué (transparent)
                </div>
              )}
            </Section>

            {ready && (
              <Section title="③ Placement & taille">
                <Field label={`Taille : ${scale}% de la scène`}>
                  <input type="range" min={10} max={80} step={1} value={scale}
                    onChange={e => setScale(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
                <div style={{ fontSize: 10, color: '#666' }}>
                  💡 Tu peux aussi <strong>drag &amp; drop</strong> directement sur l&apos;aperçu de droite.
                </div>
                <Field label={`Position X : ${posX.toFixed(0)}%`}>
                  <input type="range" min={0} max={100} step={1} value={posX}
                    onChange={e => setPosX(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
                <Field label={`Position Y : ${posY.toFixed(0)}%`}>
                  <input type="range" min={0} max={100} step={1} value={posY}
                    onChange={e => setPosY(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
              </Section>
            )}

            {ready && (
              <Section title="④ Prompt d'harmonisation">
                <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                <div style={{ fontSize: 10, color: '#666' }}>
                  Décris l&apos;intégration souhaitée (ombres, lumière, palette).
                  Pas besoin de décrire l&apos;objet — il est déjà collé.
                </div>
              </Section>
            )}

            {ready && (
              <Section title="⑤ Paramètres techniques">
                <Field label="Mode mask">
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setMaskMode('corona')}
                      style={{
                        ...btnStyle, flex: 1, padding: '8px 6px',
                        background: maskMode === 'corona' ? '#10B981' : '#1a1a1e',
                        fontWeight: maskMode === 'corona' ? 700 : 400,
                      }}>
                      🛡 Corona — préserve l&apos;identité
                    </button>
                    <button onClick={() => setMaskMode('fill')}
                      style={{
                        ...btnStyle, flex: 1, padding: '8px 6px',
                        background: maskMode === 'fill' ? '#7C3AED' : '#1a1a1e',
                        fontWeight: maskMode === 'fill' ? 700 : 400,
                      }}>
                      🔄 Fill — régénère
                    </button>
                  </div>
                  <div style={{ fontSize: 9, color: '#666' }}>
                    {maskMode === 'corona'
                      ? 'Le sujet collé reste pixel-perfect. Flux peint UNIQUEMENT les ombres autour. Idéal personnages récurrents.'
                      : 'Flux régénère le sujet depuis le prompt (perd l\'identité de la référence). Idéal pour insertion guidée par texte.'}
                  </div>
                </Field>
                <Field label={`Dilation autour de la silhouette : ${maskMargin}px`}>
                  <input type="range" min={0} max={150} step={4} value={maskMargin}
                    onChange={e => setMaskMargin(Number(e.target.value))} style={{ width: '100%' }} />
                  <div style={{ fontSize: 9, color: '#666' }}>
                    0 = silhouette stricte du sujet · 32-64 = place pour les ombres ·
                    le mask suit la forme exacte (n&apos;empiète plus sur les objets adjacents)
                  </div>
                </Field>
                <Field label={`Adoucissement bords : ${maskBlur}px`}>
                  <input type="range" min={0} max={32} step={1} value={maskBlur}
                    onChange={e => setMaskBlur(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
                <Field label={`Steps : ${steps}`}>
                  <input type="range" min={10} max={40} step={1} value={steps}
                    onChange={e => setSteps(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
                <Field label={`Guidance Flux : ${guidance}`}>
                  <input type="range" min={5} max={50} step={1} value={guidance}
                    onChange={e => setGuidance(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
              </Section>
            )}

            <button onClick={handleGenerate}
              disabled={!ready || isAnyRunning}
              style={{
                ...btnStyle,
                background: (!ready || isAnyRunning) ? '#444' : '#F97316',
                padding: 12, fontSize: 14, fontWeight: 600,
              }}>
              {isAnyRunning ? '⏳ Génération…'
                : !bgUrl ? '⚠ Upload une scène'
                : !fgUrl ? '⚠ Upload un objet'
                : !fgTransparentUrl ? '⚠ Détoure d\'abord'
                : '🪄 Composer & harmoniser via Flux Fill'}
            </button>
          </div>

          {/* ── Stage (drag-drop preview) + History ────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#F97316', textTransform: 'uppercase' }}>
              Aperçu placement (drag pour bouger)
            </div>
            <div ref={stageRef} style={{
              position: 'relative',
              width: '100%',
              aspectRatio: bgDims ? `${bgDims.w} / ${bgDims.h}` : '16/9',
              background: bgUrl ? `url(${bgUrl}) center/contain no-repeat #1a1a1e` : '#1a1a1e',
              border: '1px solid #2a2a30', borderRadius: 6,
              overflow: 'hidden',
              cursor: fgTransparentUrl ? 'move' : 'default',
              userSelect: 'none',
            }}>
              {fgTransparentUrl && bgDims && (
                <img src={fgTransparentUrl} alt="fg" draggable={false}
                  onMouseDown={onFgMouseDown}
                  style={{
                    position: 'absolute',
                    left: `${posX}%`,
                    top: `${posY}%`,
                    width: `${scale}%`,
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'auto',
                  }} />
              )}
              {!bgUrl && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12 }}>
                  Upload une scène pour commencer
                </div>
              )}
            </div>

            <div style={{ fontSize: 11, fontWeight: 600, color: '#F97316', textTransform: 'uppercase', marginTop: 6 }}>
              Historique ({runs.length})
            </div>
            {runs.length === 0 && (
              <div style={{ padding: 24, background: '#0f0f13', border: '1px dashed #2a2a30',
                borderRadius: 6, fontSize: 12, color: '#666', textAlign: 'center' }}>
                Place ton sujet à la taille voulue, lance la génération.
              </div>
            )}
            {runs.map(run => <RunCard key={run.id} run={run} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────
function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = () => rej(new Error(`load failed: ${url}`))
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

// ── Components ──────────────────────────────────────────────
function RunCard({ run }: { run: Run }) {
  const elapsed = Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)
  return (
    <div style={{ padding: 10, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: '#9898b4', fontStyle: 'italic' }}>&ldquo;{run.prompt.slice(0, 60)}…&rdquo;</span>
        <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
          background: run.status === 'done' ? '#10B981' : run.status === 'error' ? '#7f1d1d' : '#F97316', color: '#fff' }}>
          {run.status} · {elapsed}s
        </span>
      </div>
      {run.status === 'done' && run.resultUrl && (
        <img src={run.resultUrl} alt="result" style={{ width: '100%', borderRadius: 4, background: '#000' }} />
      )}
      {run.compositeUrl && run.status !== 'done' && (
        <div style={{ fontSize: 10, color: '#9898b4' }}>
          Composite envoyé. <a href={run.compositeUrl} target="_blank" rel="noopener" style={{ color: '#F97316' }}>voir</a>
          {run.maskUrl && <> · <a href={run.maskUrl} target="_blank" rel="noopener" style={{ color: '#F97316' }}>mask</a></>}
        </div>
      )}
      {run.status === 'error' && (
        <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {run.error}</div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#F97316', textTransform: 'uppercase' }}>{title}</div>
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
