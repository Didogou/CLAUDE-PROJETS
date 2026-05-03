'use client'
/**
 * POC LTX Direct — image entière → animation. Pas de Scene Analyzer, pas de cutout.
 *
 * Tu fournis :
 *   - Une URL d'image (la scène complète, ex: chat sur tonneau dans taverne)
 *   - Un prompt simple décrivant l'action ("le chat baille")
 *
 * Sortie : vidéo MP4 où LTX anime le sujet dans son contexte (décor préservé,
 * éclairage cohérent, juste le sujet bouge selon le prompt).
 *
 * Idéal pour Hero : les plans d'un livre-jeu = scènes complètes qu'on veut
 * animer subtilement (chat qui baille, lampe qui vacille, vent dans rideaux).
 * Le résultat se ré-intègre directement, pas besoin de compositing.
 *
 * Workflow technique : LTX-Video 0.9.8 distilled fp8 (4.5GB), 8 steps suffisent,
 * cfg 3, frames 8N+1, fps 24. Cf project_ltx_video_setup.md.
 */

import React, { useCallback, useEffect, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────

interface AnimRun {
  id: string
  prompt: string
  imageUrl: string
  frames: number
  steps: number
  strength: number
  width: number
  height: number
  status: 'uploading' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  promptId?: string
  videoUrl?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

// ── Presets pour exemples rapides ──────────────────────────────────────────

// Presets construits selon les règles LTX officielles :
//   - décrire le MOUVEMENT, pas l'image
//   - présent fluide, 2-4 phrases
//   - indices visuels concrets (pas d'émotions abstraites)
//   - état FINAL après le mouvement
//   - caméra statique sauf besoin spécifique
const PROMPT_PRESETS = [
  {
    label: '🐱 Le chat baille',
    prompt: 'The cat slowly opens its mouth in a wide yawn, tongue curls upward, ears flatten momentarily. Eyes squint shut, then it settles back with a contented expression. Static shot, warm candlelight flickers softly.',
  },
  {
    label: '🐈 Le chat s\'étire',
    prompt: 'The cat extends its front paws forward, body elongating in a slow stretch, back arches downward. After the stretch, it relaxes with paws outstretched. Static shot, soft natural lighting, gentle organic motion.',
  },
  {
    label: '😺 Le chat respire',
    prompt: 'The cat\'s chest rises and falls in a calm breathing rhythm, eyes blink once slowly, ear tilts subtly. Very minimal motion, nothing else moves. Static shot.',
  },
  {
    label: '👀 Le chat regarde',
    prompt: 'The cat slowly turns its head from left to right, eyes following the motion, ears rotating attentively. After the turn, it holds its gaze forward. Static shot, soft ambient light.',
  },
  {
    label: '🔥 Bougie qui vacille',
    prompt: 'The candle flame dances and flickers, casting moving shadows on nearby surfaces. Wisps of smoke rise gently. Static shot, the rest of the scene remains still.',
  },
  {
    label: '💨 Atmosphère vivante',
    prompt: 'Subtle ambient motion, dust particles drift slowly through the warm light beams, candle flames flicker gently, very soft breath of air across fabrics. Static shot, painterly aesthetic preserved.',
  },
  { label: '✋ Manuel', prompt: '' },
]

const NEGATIVE_DEFAULT = 'static, frozen, blurry, low quality, watermark, deformed, extra limbs, morphing'

// Dimensions multiples de 32, capées 768×512 pour 8GB GPU
function snapDims(w: number, h: number): [number, number] {
  const maxW = 768
  const maxH = 512
  const ratio = w / h
  let tw = w, th = h
  if (tw > maxW) { tw = maxW; th = Math.round(maxW / ratio) }
  if (th > maxH) { th = maxH; tw = Math.round(maxH * ratio) }
  // Snap à 32
  tw = Math.round(tw / 32) * 32
  th = Math.round(th / 32) * 32
  return [Math.max(64, tw), Math.max(64, th)]
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function LtxDirectTestPage() {
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0].prompt)
  const [frames, setFrames] = useState(49)         // 8N+1 (49 = ~2s @ 24fps)
  const [steps, setSteps] = useState(8)            // distilled = 4-8 suffit
  const [strength, setStrength] = useState(1.0)    // 1.0 = image très respectée
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const [runs, setRuns] = useState<AnimRun[]>([])

  // Auto-detect image dimensions au changement d'URL
  useEffect(() => {
    if (!imageUrl) { setImageSize(null); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setImageSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => setImageSize(null)
    img.src = imageUrl
  }, [imageUrl])

  // Upload local file → Supabase, récupère URL pour l'utiliser comme source LTX
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    setImageUrl('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('path', `test/ltx-direct/upload_${Date.now()}`)
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? `upload HTTP ${res.status}`)
      setImageUrl(data.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  function applyPreset(idx: number) {
    setPrompt(PROMPT_PRESETS[idx].prompt)
  }

  const handleGenerate = useCallback(async () => {
    if (!imageUrl.trim() || !prompt.trim()) return

    const id = `run-${Date.now()}`
    const [width, height] = imageSize ? snapDims(imageSize.w, imageSize.h) : [768, 512]
    // Snap frames à 8N+1 (LTX requirement)
    const ltxFrames = Math.round((frames - 1) / 8) * 8 + 1

    const newRun: AnimRun = {
      id, prompt, imageUrl,
      frames: ltxFrames, steps, strength, width, height,
      status: 'uploading', startedAt: Date.now(),
    }
    setRuns(prev => [newRun, ...prev])

    try {
      // Free VRAM avant LTX
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))

      // 1. Upload image source vers ComfyUI input
      const upRes = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: imageUrl, name: 'ltx_direct_src' }),
      })
      const upData = await upRes.json()
      if (!upRes.ok || !upData.filename) throw new Error(upData.error ?? 'upload failed')

      // 2. Queue LTX
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'queuing' } : r))
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'ltx_video',
          source_image: upData.filename,
          prompt_positive: prompt,
          prompt_negative: NEGATIVE_DEFAULT,
          frames: ltxFrames,
          fps: 24,
          steps,
          cfg: 3,
          seed: -1,
          width, height,
        }),
      })
      const queueData = await queueRes.json()
      if (!queueRes.ok || !queueData.prompt_id) throw new Error(queueData.error ?? 'queue failed')
      setRuns(prev => prev.map(r => r.id === id ? { ...r, promptId: queueData.prompt_id, status: 'generating' } : r))

      // 3. Poll status
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

      // 4. Récupère l'URL vidéo + persiste Supabase
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'fetching' } : r))
      const storagePath = `test/ltx-direct/run_${id}`
      const vRes = await fetch(`/api/comfyui?prompt_id=${queueData.prompt_id}&action=video_info&storage_path=${encodeURIComponent(storagePath)}`)
      const vData = await vRes.json()
      if (!vRes.ok || !vData.video_url) throw new Error(vData.error ?? 'video_url manquante')
      setRuns(prev => prev.map(r =>
        r.id === id ? { ...r, status: 'done', videoUrl: vData.video_url, finishedAt: Date.now() } : r,
      ))

      // Free VRAM après
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: msg, finishedAt: Date.now() } : r))
    }
  }, [imageUrl, prompt, frames, steps, strength, imageSize])

  const isAnyRunning = runs.some(r => r.status !== 'done' && r.status !== 'error')

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC LTX Direct — image entière → animation
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Pas de découpe, pas de Scene Analyzer. Tu donnes une image + un prompt
          d&apos;action, LTX 0.9.8 distilled anime le sujet en place avec le décor préservé.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
          {/* ── Form ──────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section title="Image source">
              <Field label="Upload une image (PNG/JPG/WEBP)">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  style={{ ...inputStyle, padding: 6 }}
                />
                {uploading && (
                  <div style={{ fontSize: 11, color: '#9898b4', marginTop: 4 }}>
                    ⏳ Upload Supabase en cours…
                  </div>
                )}
                {uploadError && (
                  <div style={{ marginTop: 4, padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>
                    ❌ {uploadError}
                  </div>
                )}
              </Field>
              {imageUrl && (
                <>
                  <div style={{
                    marginTop: 6,
                    aspectRatio: imageSize ? `${imageSize.w}/${imageSize.h}` : '1/1',
                    background: `url(${imageUrl}) center/contain no-repeat #1a1a1e`,
                    border: '1px solid #2a2a30', borderRadius: 4,
                    maxHeight: 200,
                  }} />
                  <div style={{ fontSize: 10, color: '#10B981' }}>
                    ✓ Uploadé · <code style={{ wordBreak: 'break-all' }}>{imageUrl.slice(-60)}</code>
                  </div>
                </>
              )}
              {imageSize && (
                <div style={{ fontSize: 10, color: '#666' }}>
                  Source : <code>{imageSize.w}×{imageSize.h}</code> →
                  Output : <code>{snapDims(imageSize.w, imageSize.h).join('×')}</code>
                  (capé pour 8GB)
                </div>
              )}
            </Section>

            <Section title="Prompt">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {PROMPT_PRESETS.map((p, i) => (
                  <button key={p.label} onClick={() => applyPreset(i)}
                    style={{ ...btnStyle, fontSize: 11, padding: '6px 8px' }}
                    title={p.prompt || '(prompt vide — manuel)'}>
                    {p.label}
                  </button>
                ))}
              </div>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
                placeholder="Décris l'action à animer (en EN, plus stable pour LTX)…"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </Section>

            <Section title="Paramètres LTX">
              <Field label={`Frames : ${frames} (${(frames / 24).toFixed(1)}s @ 24fps)`}>
                <input type="range" min={9} max={97} step={8} value={frames}
                  onChange={e => setFrames(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 10, color: '#666' }}>
                  LTX requiert 8N+1 frames (auto-snap)
                </div>
              </Field>
              <Field label={`Steps : ${steps} (distilled = 4-8 idéal)`}>
                <input type="range" min={4} max={12} step={1} value={steps}
                  onChange={e => setSteps(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
              <Field label={`Strength : ${strength.toFixed(2)} (1.0 = image respectée, 0.5 = liberté)`}>
                <input type="range" min={0.5} max={1.0} step={0.05} value={strength}
                  onChange={e => setStrength(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
            </Section>

            <button onClick={handleGenerate}
              disabled={!imageUrl.trim() || !prompt.trim() || isAnyRunning || uploading}
              style={{
                ...btnStyle,
                background: (!imageUrl.trim() || !prompt.trim() || isAnyRunning || uploading) ? '#444' : '#EC4899',
                padding: 12, fontSize: 14, fontWeight: 600,
                cursor: (!imageUrl.trim() || !prompt.trim() || isAnyRunning || uploading) ? 'not-allowed' : 'pointer',
              }}>
              {uploading ? '📤 Upload…'
                : isAnyRunning ? '⏳ Génération…'
                : !imageUrl.trim() ? '⚠ Upload une image d\'abord'
                : !prompt.trim() ? '⚠ Ajoute un prompt'
                : '🎬 Générer animation'}
            </button>
          </div>

          {/* ── History ────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase' }}>
              Historique ({runs.length})
            </div>
            {runs.length === 0 && (
              <div style={{ padding: 24, background: '#0f0f13', border: '1px dashed #2a2a30',
                borderRadius: 6, fontSize: 12, color: '#666', textAlign: 'center' }}>
                Charge une image, choisis un preset, lance la génération.
                <br />Compte ~30-90s sur ton GPU 8GB.
              </div>
            )}
            {runs.map(run => <RunCard key={run.id} run={run} />)}
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>À évaluer :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>Le sujet (chat) bouge selon le prompt SANS que le décor drift ?</li>
            <li>Lighting / candlelight reste cohérent ?</li>
            <li>Les éléments statiques (tonneaux, mur) restent figés ?</li>
            <li>Strength 1.0 vs 0.7 : préservation vs liberté du modèle</li>
            <li>Steps 4 vs 8 vs 12 : qualité gain marginal après 8 ?</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Composants ────────────────────────────────────────────────────────────

function RunCard({ run }: { run: AnimRun }) {
  const elapsed = Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)
  return (
    <div style={{ padding: 10, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: '#9898b4' }}>
          <code style={{ color: '#d4a84c' }}>{run.frames}f / {run.steps}st</code>
          <span style={{ marginLeft: 6 }}>strength <code>{run.strength.toFixed(2)}</code></span>
          <span style={{ marginLeft: 6 }}>{run.width}×{run.height}</span>
        </span>
        <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
          background: run.status === 'done' ? '#10B981' : run.status === 'error' ? '#7f1d1d' : '#EC4899', color: '#fff' }}>
          {run.status} · {elapsed}s
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#9898b4', fontStyle: 'italic' }}>&ldquo;{run.prompt}&rdquo;</div>
      {run.status === 'done' && run.videoUrl && (
        <video src={run.videoUrl} controls autoPlay loop muted
          style={{ width: '100%', maxHeight: 500, borderRadius: 4, background: '#000' }} />
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
