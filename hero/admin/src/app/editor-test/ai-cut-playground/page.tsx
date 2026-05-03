'use client'
/**
 * AI Cut Playground — outil de debug pour itérer sur les combos
 * (modèle + mode + prompt) jusqu'à trouver ce qui marche pour une image donnée.
 *
 * URL : /editor-test/ai-cut-playground
 *
 * Pas de Qwen ici — on tape directement le prompt EN qu'on enverrait à
 * GroundingDINO ou Florence-2. But : isoler les bugs LLM des bugs vision.
 */

import React, { useState } from 'react'

type EngineKey =
  | 'dino'
  | 'florence_base_res'
  | 'florence_base_ctpg'
  | 'florence_large_res'
  | 'florence_large_ctpg'
  | 'bbox_filter_dino'
  | 'composite_dino'
  | 'spatial_filter_dino'

const ENGINES: Array<{ key: EngineKey; label: string; hint: string }> = [
  { key: 'dino',                label: '🎯 DINO + SAM 1',           hint: 'Format : "sofa . cushions" — multi-classes simples' },
  { key: 'florence_base_res',   label: '🪄 Florence-2 base · RES',  hint: 'Référing expression UN sujet : "the cushions on the sofa"' },
  { key: 'florence_base_ctpg',  label: '🪄 Florence-2 base · CTPG', hint: 'Multi-phrases serveur split : "sofa. cushions on the sofa."' },
  { key: 'florence_large_res',  label: '🌟 Florence-2 large · RES', hint: 'Idem RES mais 770MB' },
  { key: 'florence_large_ctpg', label: '🌟 Florence-2 large · CTPG', hint: 'Idem CTPG mais 770MB' },
  { key: 'bbox_filter_dino',    label: '🔀 DINO bbox-filter (subject ∩ container)',
    hint: 'Trouve "subject" dans toute l\'image, garde seulement les instances dont le centre est dans la bbox du "container". Ex: pillows ∩ sofa.' },
  { key: 'composite_dino',      label: '➕ DINO composite (container + subject∩container)',
    hint: 'Union du container ENTIER + des subjects qui sont dedans. Ex: sofa + pillows on sofa = canapé + coussins dessus.' },
  { key: 'spatial_filter_dino', label: '📍 DINO spatial filter (subject + position)',
    hint: 'Trouve "subject" puis garde uniquement les instances dans une zone géométrique de l\'image (left/right/top/bottom/center).' },
]

type SpatialDirection = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'

const SAMPLE_IMAGES = [
  {
    label: 'Salon canapé baie vitrée',
    url: 'https://mgdaydimtlletsoedntn.supabase.co/storage/v1/object/public/images/test-scenes/int_living_bay_day_juggernaut_1777096855927.png',
  },
]

export default function AICutPlaygroundPage() {
  const [imageUrl, setImageUrl] = useState(SAMPLE_IMAGES[0].url)
  const [engine, setEngine] = useState<EngineKey>('florence_base_res')
  const [prompt, setPrompt] = useState('the cushions on the sofa')
  const [containerPrompt, setContainerPrompt] = useState('sofa')
  const [spatialDirection, setSpatialDirection] = useState<SpatialDirection>('right')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    maskUrl: string | null
    maskUrls?: string[]
    prompts?: string[]
    elapsedMs: number
    requestPayload: Record<string, unknown>
    responsePayload: unknown
  } | null>(null)

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    const startedAt = performance.now()

    try {
      // ── Mode bbox-filter : 2 appels DINO + filtrage côté client ──────────
      if (engine === 'bbox_filter_dino') {
        const containerMaskUrl = await callDino(imageUrl, containerPrompt)
        const subjectMaskUrl = await callDino(imageUrl, prompt)
        const filteredMaskUrl = await filterSubjectByContainerBbox(subjectMaskUrl, containerMaskUrl)

        const elapsedMs = Math.round(performance.now() - startedAt)
        setResult({
          maskUrl: filteredMaskUrl,
          maskUrls: [containerMaskUrl, subjectMaskUrl, filteredMaskUrl],
          prompts: [`container: ${containerPrompt}`, `subject: ${prompt}`, 'filtered'],
          elapsedMs,
          requestPayload: { mode: 'bbox_filter', container: containerPrompt, subject: prompt },
          responsePayload: { containerMaskUrl, subjectMaskUrl, filteredMaskUrl },
        })
        return
      }

      // ── Mode composite : container ENTIER + subject ∩ container ──────────
      if (engine === 'composite_dino') {
        const containerMaskUrl = await callDino(imageUrl, containerPrompt)
        const subjectMaskUrl = await callDino(imageUrl, prompt)
        const filteredSubjectMaskUrl = await filterSubjectByContainerBbox(subjectMaskUrl, containerMaskUrl)
        // Union : container ENTIER + subjects filtrés
        const compositeMaskUrl = await unionMasks([containerMaskUrl, filteredSubjectMaskUrl])

        const elapsedMs = Math.round(performance.now() - startedAt)
        setResult({
          maskUrl: compositeMaskUrl,
          maskUrls: [containerMaskUrl, subjectMaskUrl, filteredSubjectMaskUrl, compositeMaskUrl],
          prompts: [`container: ${containerPrompt}`, `subject (all): ${prompt}`, `subject ∩ container`, 'union'],
          elapsedMs,
          requestPayload: { mode: 'composite', container: containerPrompt, subject: prompt },
          responsePayload: { containerMaskUrl, subjectMaskUrl, filteredSubjectMaskUrl, compositeMaskUrl },
        })
        return
      }

      // ── Mode spatial-filter : DINO + filtrage par zone géométrique ───────
      if (engine === 'spatial_filter_dino') {
        const subjectMaskUrl = await callDino(imageUrl, prompt)
        const filteredMaskUrl = await filterSubjectBySpatial(subjectMaskUrl, spatialDirection)

        const elapsedMs = Math.round(performance.now() - startedAt)
        setResult({
          maskUrl: filteredMaskUrl,
          maskUrls: [subjectMaskUrl, filteredMaskUrl],
          prompts: [`subject: ${prompt}`, `keep ${spatialDirection}`],
          elapsedMs,
          requestPayload: { mode: 'spatial_filter', subject: prompt, direction: spatialDirection },
          responsePayload: { subjectMaskUrl, filteredMaskUrl },
        })
        return
      }

      // ── Modes simples : 1 endpoint ─────────────────────────────────────
      let endpoint: string
      let body: Record<string, unknown>
      if (engine === 'dino') {
        endpoint = '/api/comfyui/grounded-sam'
        body = { image_url: imageUrl, prompt_text: prompt }
      } else {
        endpoint = '/api/comfyui/florence-sam2'
        const isCtpg = engine.endsWith('_ctpg')
        const isLarge = engine.includes('_large')
        body = {
          image_url: imageUrl,
          prompt_text: prompt,
          mode: isCtpg ? 'ctpg' : 'res',
          model: isLarge ? 'large' : 'base',
        }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      const elapsedMs = Math.round(performance.now() - startedAt)
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
        setResult({
          maskUrl: null,
          elapsedMs,
          requestPayload: body,
          responsePayload: data,
        })
        return
      }
      setResult({
        maskUrl: data.mask_url ?? (data.mask_urls?.[0] ?? null),
        maskUrls: data.mask_urls,
        prompts: data.prompts,
        elapsedMs,
        requestPayload: body,
        responsePayload: data,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const currentEngine = ENGINES.find(e => e.key === engine)!

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 8 }}>🧪 AI Cut Playground</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Tape directement le prompt EN qu'on enverrait à DINO ou Florence-2. Pas de Qwen NLU
        ici — pour isoler les bugs vision des bugs LLM.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left : controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Image source</label>
            <input
              type="text"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              style={inputStyle}
            />
            {SAMPLE_IMAGES.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SAMPLE_IMAGES.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setImageUrl(s.url)}
                    style={pillStyle}
                  >{s.label}</button>
                ))}
              </div>
            )}
            {imageUrl && (
              <div style={{ marginTop: 8 }}>
                <img src={imageUrl} alt="source" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e0e0e0' }} />
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Engine + mode</label>
            <select
              value={engine}
              onChange={e => setEngine(e.target.value as EngineKey)}
              style={inputStyle}
            >
              {ENGINES.map(e => (
                <option key={e.key} value={e.key}>{e.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4, fontStyle: 'italic' }}>
              {currentEngine.hint}
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              {engine === 'bbox_filter_dino' || engine === 'composite_dino' || engine === 'spatial_filter_dino'
                ? 'Subject (objet à isoler)'
                : 'Prompt (anglais, format selon le mode)'}
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={['bbox_filter_dino','composite_dino','spatial_filter_dino'].includes(engine) ? 1 : 3}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }}
            />
            {['bbox_filter_dino','composite_dino','spatial_filter_dino'].includes(engine) ? (
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                Exemples : <code>pillows</code>, <code>plants</code>, <code>books</code>, <code>chair</code>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                <strong>Exemples utiles :</strong>
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                  <li>DINO : <code>sofa . cushions</code> (espace point espace)</li>
                  <li>Florence RES : <code>the cushions on the sofa</code></li>
                  <li>Florence CTPG : <code>sofa. cushions on the sofa.</code> (point collé, espace après)</li>
                </ul>
              </div>
            )}
          </div>

          {(engine === 'bbox_filter_dino' || engine === 'composite_dino') && (
            <div>
              <label style={labelStyle}>Container (zone qui doit contenir les sujets)</label>
              <textarea
                value={containerPrompt}
                onChange={e => setContainerPrompt(e.target.value)}
                rows={1}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }}
              />
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                Exemples : <code>sofa</code>, <code>table</code>, <code>shelf</code>
                {engine === 'composite_dino' && ' — sera inclus dans le résultat final'}
              </div>
            </div>
          )}

          {engine === 'spatial_filter_dino' && (
            <div>
              <label style={labelStyle}>Zone géométrique à conserver</label>
              <select
                value={spatialDirection}
                onChange={e => setSpatialDirection(e.target.value as SpatialDirection)}
                style={inputStyle}
              >
                <option value="left">⬅ Gauche (x &lt; 0.5)</option>
                <option value="right">➡ Droite (x &gt; 0.5)</option>
                <option value="top">⬆ Haut (y &lt; 0.5)</option>
                <option value="bottom">⬇ Bas (y &gt; 0.5)</option>
                <option value="center">⊕ Centre (proche du milieu)</option>
                <option value="top_left">↖ Haut-gauche</option>
                <option value="top_right">↗ Haut-droite</option>
                <option value="bottom_left">↙ Bas-gauche</option>
                <option value="bottom_right">↘ Bas-droite</option>
              </select>
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                Filtre les instances dont le centroïde matche la zone choisie.
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={run}
            disabled={busy || !imageUrl || !prompt.trim()}
            style={{
              ...inputStyle,
              background: busy ? '#aaa' : '#a855f7',
              color: 'white',
              border: 'none',
              cursor: busy ? 'wait' : 'pointer',
              fontWeight: 600,
              padding: '10px',
            }}
          >
            {busy ? 'Recherche en cours… (peut prendre 30-60s au 1er run Florence)' : '▶ Lancer'}
          </button>

          {error && (
            <div style={{ background: '#fee', border: '1px solid #fcc', borderRadius: 6, padding: 10, fontSize: 12, color: '#900' }}>
              <strong>Erreur :</strong> <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{error}</pre>
            </div>
          )}
        </div>

        {/* Right : result */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Résultat</label>
            {!result && (
              <div style={emptyStateStyle}>Lance une requête pour voir le résultat ici.</div>
            )}
            {result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#666' }}>
                  ⏱ {result.elapsedMs} ms
                </div>

                {result.prompts && result.prompts.length > 0 && (
                  <div style={{ fontSize: 12, color: '#444' }}>
                    Phrases traitées :
                    <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                      {result.prompts.map((p, i) => <li key={i}><code>{p}</code></li>)}
                    </ul>
                  </div>
                )}

                {result.maskUrl ? (
                  <>
                    <div>
                      <div style={subLabelStyle}>Mask binaire</div>
                      <img src={result.maskUrl} alt="mask" style={previewStyle} />
                    </div>
                    <div>
                      <div style={subLabelStyle}>Extraction (source × mask)</div>
                      <div
                        style={{
                          ...previewStyle,
                          backgroundImage: `url("${imageUrl}")`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          WebkitMaskImage: `url("${result.maskUrl}")`,
                          maskImage: `url("${result.maskUrl}")`,
                          WebkitMaskSize: 'cover',
                          maskSize: 'cover',
                          WebkitMaskMode: 'luminance',
                          maskMode: 'luminance',
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <div style={{ ...emptyStateStyle, color: '#a00' }}>Pas de mask retourné.</div>
                )}

                {result.maskUrls && result.maskUrls.length > 1 && (
                  <div>
                    <div style={subLabelStyle}>Masks individuels (CTPG multi-query)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
                      {result.maskUrls.map((url, i) => (
                        <div key={i} style={{ textAlign: 'center' }}>
                          <img src={url} alt={`mask-${i}`} style={{ width: '100%', borderRadius: 4, border: '1px solid #ddd' }} />
                          <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                            <code>{result.prompts?.[i] ?? `#${i}`}</code>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <details style={{ marginTop: 8, fontSize: 11 }}>
                  <summary style={{ cursor: 'pointer', color: '#888' }}>Payload debug (request / response)</summary>
                  <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 200, fontSize: 10 }}>
                    {JSON.stringify({ request: result.requestPayload, response: result.responsePayload }, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#444',
  marginBottom: 6,
}

const subLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#666',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #ccc',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'system-ui, sans-serif',
  boxSizing: 'border-box',
}

const pillStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '4px 10px',
  border: '1px solid #ddd',
  borderRadius: 999,
  background: '#fff',
  cursor: 'pointer',
  color: '#444',
}

const previewStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 9',
  borderRadius: 6,
  border: '1px solid #ddd',
  objectFit: 'contain',
  backgroundColor: '#fff',
  backgroundImage:
    'linear-gradient(45deg, #e2e2e2 25%, transparent 25%), ' +
    'linear-gradient(-45deg, #e2e2e2 25%, transparent 25%), ' +
    'linear-gradient(45deg, transparent 75%, #e2e2e2 75%), ' +
    'linear-gradient(-45deg, transparent 75%, #e2e2e2 75%)',
  backgroundSize: '14px 14px',
  backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0',
}

const emptyStateStyle: React.CSSProperties = {
  border: '2px dashed #ddd',
  borderRadius: 8,
  padding: 32,
  textAlign: 'center',
  color: '#888',
  fontSize: 13,
}

// ── Helper : filtrage subject par bbox container ───────────────────────────
//
// Charge les 2 masks (subject + container), trouve les composantes connexes
// du subject mask via magic-wand-tool, calcule la bbox du container, garde
// seulement les composantes subject dont le centroïde est dans la bbox container.
// Reconstitue un mask filtré et l'upload via canvas + blob URL.
async function filterSubjectByContainerBbox(
  subjectMaskUrl: string,
  containerMaskUrl: string,
): Promise<string> {
  // @ts-expect-error : magic-wand-tool sans types
  const MagicWand = (await import('magic-wand-tool')).default

  const [subjectImg, containerImg] = await Promise.all([
    loadImage(subjectMaskUrl),
    loadImage(containerMaskUrl),
  ])
  const W = subjectImg.naturalWidth
  const H = subjectImg.naturalHeight

  // Décode les 2 masks en données binaires
  const subjectData = decodeMaskToBinary(subjectImg, W, H)
  const containerBbox = computeMaskBbox(containerImg, W, H)
  if (!containerBbox) throw new Error('Container mask vide')

  // Trace les contours du subject (composantes connexes)
  const mwMask = {
    data: subjectData,
    width: W, height: H,
    bounds: { minX: 0, minY: 0, maxX: W - 1, maxY: H - 1 },
  }
  const contours = MagicWand.traceContours(mwMask) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean
  }>

  // Filtre : composantes outer (pas inner) dont le centroïde est dans containerBbox
  const kept = contours.filter(c => {
    if (c.inner || c.points.length < 3) return false
    let sumX = 0, sumY = 0
    for (const p of c.points) { sumX += p.x; sumY += p.y }
    const cx = sumX / c.points.length
    const cy = sumY / c.points.length
    return cx >= containerBbox.x1 && cx <= containerBbox.x2
        && cy >= containerBbox.y1 && cy <= containerBbox.y2
  })

  // Rasterise les contours kept dans un nouveau canvas
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  for (const c of kept) {
    if (c.points.length < 3) continue
    ctx.beginPath()
    ctx.moveTo(c.points[0].x, c.points[0].y)
    for (let i = 1; i < c.points.length; i++) {
      ctx.lineTo(c.points[i].x, c.points[i].y)
    }
    ctx.closePath()
    ctx.fill()
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'),
  )
  return URL.createObjectURL(blob)
}

function decodeMaskToBinary(img: HTMLImageElement, W: number, H: number): Uint8Array {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data
  const binary = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    binary[i] = data[i * 4] > 128 ? 1 : 0
  }
  return binary
}

function computeMaskBbox(img: HTMLImageElement, W: number, H: number): { x1: number; y1: number; x2: number; y2: number } | null {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data
  let minX = W, minY = H, maxX = 0, maxY = 0
  let found = false
  for (let i = 0; i < W * H; i++) {
    if (data[i * 4] > 128) {
      const x = i % W
      const y = Math.floor(i / W)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      found = true
    }
  }
  if (!found) return null
  return { x1: minX, y1: minY, x2: maxX, y2: maxY }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load mask: ${url.slice(0, 80)}`))
    img.src = url
  })
}

/** Helper : appel DINO simple → mask URL. */
async function callDino(imageUrl: string, promptText: string): Promise<string> {
  const res = await fetch('/api/comfyui/grounded-sam', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, prompt_text: promptText }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`DINO "${promptText}" : ${data.error ?? 'failed'}`)
  }
  return data.mask_url as string
}

/** Helper : union pixel-OR de N masks → blob URL. */
async function unionMasks(maskUrls: string[]): Promise<string> {
  if (maskUrls.length === 0) throw new Error('No masks to union')
  if (maskUrls.length === 1) return maskUrls[0]
  const images = await Promise.all(maskUrls.map(loadImage))
  const W = images[0].naturalWidth
  const H = images[0].naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighten'  // pixel max = OR pour masks B&W
  for (const img of images) {
    ctx.drawImage(img, 0, 0, W, H)
  }
  ctx.globalCompositeOperation = 'source-over'
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'),
  )
  return URL.createObjectURL(blob)
}

/** Helper : filtre les composantes connexes d'un mask par zone géométrique
 *  (left/right/top/bottom/center/etc). Garde celles dont le centroïde
 *  satisfait la condition spatiale. */
async function filterSubjectBySpatial(
  subjectMaskUrl: string,
  direction: SpatialDirection,
): Promise<string> {
  // @ts-expect-error : magic-wand-tool sans types
  const MagicWand = (await import('magic-wand-tool')).default

  const img = await loadImage(subjectMaskUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight
  const binary = decodeMaskToBinary(img, W, H)
  const mwMask = {
    data: binary,
    width: W, height: H,
    bounds: { minX: 0, minY: 0, maxX: W - 1, maxY: H - 1 },
  }
  const contours = MagicWand.traceContours(mwMask) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean
  }>

  // Test position selon direction
  const inZone = (cx: number, cy: number): boolean => {
    const xn = cx / W
    const yn = cy / H
    switch (direction) {
      case 'left':         return xn < 0.5
      case 'right':        return xn > 0.5
      case 'top':          return yn < 0.5
      case 'bottom':       return yn > 0.5
      case 'top_left':     return xn < 0.5 && yn < 0.5
      case 'top_right':    return xn > 0.5 && yn < 0.5
      case 'bottom_left':  return xn < 0.5 && yn > 0.5
      case 'bottom_right': return xn > 0.5 && yn > 0.5
      case 'center':       return Math.abs(xn - 0.5) < 0.25 && Math.abs(yn - 0.5) < 0.25
    }
  }

  const kept = contours.filter(c => {
    if (c.inner || c.points.length < 3) return false
    let sx = 0, sy = 0
    for (const p of c.points) { sx += p.x; sy += p.y }
    const cx = sx / c.points.length
    const cy = sy / c.points.length
    return inZone(cx, cy)
  })

  // Rasterise les composantes filtrées
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  for (const c of kept) {
    if (c.points.length < 3) continue
    ctx.beginPath()
    ctx.moveTo(c.points[0].x, c.points[0].y)
    for (let i = 1; i < c.points.length; i++) {
      ctx.lineTo(c.points[i].x, c.points[i].y)
    }
    ctx.closePath()
    ctx.fill()
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'),
  )
  return URL.createObjectURL(blob)
}
