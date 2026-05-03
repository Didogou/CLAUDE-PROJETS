'use client'
/**
 * POC Animation Lab — bench de test isolé pour comparer plusieurs approches
 * d'animation sur une image. Pas câblé au Designer (qui n'a pas encore
 * d'animation prod). Utile pour valider quels types d'animations donnent un
 * rendu acceptable sur les images générées par Hero.
 *
 * V1 = Wan 2.2 image-to-video (le seul workflow d'animation déjà câblé dans
 * Hero, via /api/comfyui workflow_type='wan_animate'). Autres types (wan_camera,
 * motion_brush, cinemagraph) à brancher dans des itérations suivantes.
 *
 * Workflow :
 *   1. Tu mets une URL d'image (ou tu uploads). On l'upload dans ComfyUI/input.
 *   2. Tu choisis un preset prompt + params (frames, steps, cfg, denoise).
 *   3. Tu lances la génération → poll status → vidéo MP4 affichée.
 *   4. Chaque run garde son card dans l'historique (avec params + miniature)
 *      → tu peux comparer 4-5 prompts/réglages sans recharger la page.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────

interface AnimRun {
  id: string
  prompt: string
  negativePrompt: string
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

const PROMPT_PRESETS: { label: string; prompt: string; denoise: number; frames: number }[] = [
  {
    label: '🐱 Chat qui s\'étire',
    prompt: 'the cat slowly stretches its body, extending its front paws forward, gentle organic motion, subtle muscle movement, painterly illustration style',
    denoise: 0.7, frames: 25,
  },
  {
    label: '🌬 Respiration douce',
    prompt: 'subtle breathing motion, body slightly rises and falls, very gentle ambient movement, eyes blinking once, no large displacement',
    denoise: 0.4, frames: 17,
  },
  {
    label: '👀 Regarde autour',
    prompt: 'the subject slowly turns its head from left to right, gentle attentive gaze, subtle ear movement',
    denoise: 0.6, frames: 25,
  },
  {
    label: '🔥 Atmosphère vivante',
    prompt: 'gentle ambient motion, flickering light, subtle wind in fabric, dust particles floating slowly in light beams, very soft breath',
    denoise: 0.5, frames: 21,
  },
  {
    label: '✋ Manuel',
    prompt: '',
    denoise: 0.7, frames: 25,
  },
]

// Aspect-ratio → Wan dimensions (multiples de 32, fixes pour Wan 2.2 stability)
const WAN_DIMS: Record<string, [number, number]> = {
  '1:1':  [640, 640],
  '16:9': [640, 352],
  '9:16': [352, 640],
  '4:3':  [640, 480],
  '3:4':  [480, 640],
}

const NEGATIVE_DEFAULT = 'static, blurred, worst quality, low quality, watermark, extra limbs, deformed'

// ── Page ──────────────────────────────────────────────────────────────────

export default function AnimationTestPage() {
  // Source image
  const [imageUrl, setImageUrl] = useState('')
  const [imageRatio, setImageRatio] = useState('1:1')

  // Form state
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0].prompt)
  const [negativePrompt, setNegativePrompt] = useState(NEGATIVE_DEFAULT)
  const [frames, setFrames] = useState(PROMPT_PRESETS[0].frames)
  const [fps, setFps] = useState(12)
  const [steps, setSteps] = useState(30)
  const [cfg, setCfg] = useState(5)
  const [denoise, setDenoise] = useState(PROMPT_PRESETS[0].denoise)

  // Runs history
  const [runs, setRuns] = useState<AnimRun[]>([])

  function applyPreset(idx: number) {
    const p = PROMPT_PRESETS[idx]
    setPrompt(p.prompt)
    setDenoise(p.denoise)
    setFrames(p.frames)
  }

  // ── Lance une animation ────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!imageUrl.trim() || !prompt.trim()) return

    const id = `run-${Date.now()}`
    const [w, h] = WAN_DIMS[imageRatio] ?? [640, 640]
    const newRun: AnimRun = {
      id, prompt, negativePrompt,
      frames, fps, steps, cfg, denoise,
      width: w, height: h,
      status: 'uploading',
      startedAt: Date.now(),
    }
    setRuns(prev => [newRun, ...prev])

    try {
      // 1. Upload l'URL source vers ComfyUI/input (nécessaire pour LoadImage)
      const upRes = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: imageUrl, name: 'animation_poc_src' }),
      })
      const upData = await upRes.json()
      if (!upRes.ok || !upData.filename) {
        throw new Error(upData.error ?? `upload HTTP ${upRes.status}`)
      }

      // 2. Queue le workflow wan_animate
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'queuing' } : r))
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'wan_animate',
          source_image: upData.filename,
          prompt_positive: prompt,
          prompt_negative: negativePrompt,
          frames, fps, steps, cfg,
          seed: -1,
          denoise,
          width: w, height: h,
        }),
      })
      const queueData = await queueRes.json()
      if (!queueRes.ok || !queueData.prompt_id) {
        throw new Error(queueData.error ?? `queue HTTP ${queueRes.status}`)
      }
      setRuns(prev => prev.map(r => r.id === id ? { ...r, promptId: queueData.prompt_id, status: 'generating' } : r))

      // Poll #1 : attend status='succeeded' (route GET /api/comfyui sans action)
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

      // Poll #2 : action=video_info pour récup l'URL réelle (+ persist Supabase)
      const storagePath = `test/animation/run_${id}`
      const vRes = await fetch(`/api/comfyui?prompt_id=${queueData.prompt_id}&action=video_info&storage_path=${encodeURIComponent(storagePath)}`)
      const vData = await vRes.json()
      if (!vRes.ok || !vData.video_url) throw new Error(vData.error ?? 'video_url manquante')
      setRuns(prev => prev.map(r =>
        r.id === id ? { ...r, status: 'done', videoUrl: vData.video_url, finishedAt: Date.now() } : r,
      ))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: msg, finishedAt: Date.now() } : r))
    }
  }, [imageUrl, imageRatio, prompt, negativePrompt, frames, fps, steps, cfg, denoise])

  // ── Auto-detect ratio depuis l'image source ───────────────────────────
  useEffect(() => {
    if (!imageUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const r = img.naturalWidth / img.naturalHeight
      // Snap au ratio le plus proche dans WAN_DIMS
      let bestKey = '1:1'
      let bestDiff = Infinity
      for (const [k, [dw, dh]] of Object.entries(WAN_DIMS)) {
        const dr = dw / dh
        const diff = Math.abs(r - dr)
        if (diff < bestDiff) { bestDiff = diff; bestKey = k }
      }
      setImageRatio(bestKey)
    }
    img.src = imageUrl
  }, [imageUrl])

  const isAnyRunning = runs.some(r => r.status !== 'done' && r.status !== 'error')

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Animation Lab — Wan 2.2 image-to-video
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Bench standalone pour tester plusieurs prompts/params d&apos;animation
          IA sur une image. Pas câblé au Designer. Réutilise le workflow
          <code style={{ marginLeft: 4 }}>wan_animate</code> existant.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
          {/* ── Sidebar gauche : params ─────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Image source */}
            <Section title="Image source">
              <Field label="URL de l'image (Supabase, Unsplash, etc.)">
                <input
                  type="text"
                  value={imageUrl}
                  onChange={e => setImageUrl(e.target.value)}
                  placeholder="https://…/cat.png"
                  style={inputStyle}
                />
              </Field>
              {imageUrl && (
                <div style={{
                  marginTop: 6, aspectRatio: '1/1',
                  background: `url(${imageUrl}) center/contain no-repeat`,
                  backgroundColor: '#1a1a1e',
                  border: '1px solid #2a2a30', borderRadius: 4,
                  height: 140,
                }} />
              )}
              <Field label={`Ratio détecté : ${imageRatio}`}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {Object.keys(WAN_DIMS).map(r => (
                    <button
                      key={r}
                      onClick={() => setImageRatio(r)}
                      style={{ ...btnStyle, fontSize: 11, padding: '4px 8px',
                        background: imageRatio === r ? '#EC4899' : '#1a1a1e' }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>

            {/* Presets */}
            <Section title="Presets de prompt">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {PROMPT_PRESETS.map((p, i) => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(i)}
                    style={{ ...btnStyle, fontSize: 11, padding: '6px 8px', textAlign: 'left' }}
                    title={p.prompt || '(prompt vide — manuel)'}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Section>

            {/* Prompt */}
            <Section title="Prompt">
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={4}
                placeholder="Décris le mouvement à animer (en anglais, plus stable pour Wan)…"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
              <details>
                <summary style={{ fontSize: 11, color: '#666', cursor: 'pointer', marginTop: 4 }}>
                  Negative prompt
                </summary>
                <textarea
                  value={negativePrompt}
                  onChange={e => setNegativePrompt(e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', marginTop: 4 }}
                />
              </details>
            </Section>

            {/* Params */}
            <Section title="Paramètres">
              <Field label={`Frames : ${frames} (${(frames / fps).toFixed(1)}s @ ${fps}fps)`}>
                <input type="range" min={5} max={49} step={4} value={frames}
                  onChange={e => setFrames(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
              <Field label={`FPS : ${fps}`}>
                <input type="range" min={6} max={24} step={1} value={fps}
                  onChange={e => setFps(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
              <Field label={`Denoise : ${denoise.toFixed(2)} (force du mouvement)`}>
                <input type="range" min={0.2} max={1} step={0.05} value={denoise}
                  onChange={e => setDenoise(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
              <Field label={`Steps : ${steps}`}>
                <input type="range" min={15} max={50} step={1} value={steps}
                  onChange={e => setSteps(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
              <Field label={`CFG : ${cfg}`}>
                <input type="range" min={1} max={10} step={0.5} value={cfg}
                  onChange={e => setCfg(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
            </Section>

            <button
              onClick={handleGenerate}
              disabled={!imageUrl.trim() || !prompt.trim() || isAnyRunning}
              style={{ ...btnStyle, background: '#EC4899', padding: 12, fontSize: 14, fontWeight: 600 }}
            >
              {isAnyRunning ? '⏳ Génération en cours…' : '🎬 Générer animation'}
            </button>
          </div>

          {/* ── Right : history des runs ───────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase' }}>
              Historique ({runs.length} run{runs.length > 1 ? 's' : ''})
            </div>
            {runs.length === 0 && (
              <div style={{
                padding: 24, background: '#0f0f13', border: '1px dashed #2a2a30',
                borderRadius: 6, fontSize: 12, color: '#666', textAlign: 'center',
              }}>
                Charge une image, choisis un preset, lance la génération.
                <br />Compte ~3-6 min selon frames + steps.
              </div>
            )}
            {runs.map(run => <RunCard key={run.id} run={run} />)}
          </div>
        </div>

        <div style={{ marginTop: 24, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>À évaluer :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li><strong>Articulation</strong> : Wan respecte-t-il l&apos;anatomie du chat ? Pattes qui s&apos;étendent vraiment, pas le chat qui se déforme en bloc ?</li>
            <li><strong>Style</strong> : préservation du painterly / illustré, ou drift vers du photoréaliste ?</li>
            <li><strong>Denoise sweet spot</strong> : 0.4 = très peu de mouvement, 0.7+ = mouvement marqué mais risque de drift visuel.</li>
            <li><strong>Cohérence</strong> : le sujet reste-t-il identifiable sur toute la vidéo, ou il morph ?</li>
            <li><strong>Temps</strong> : 25 frames @ 30 steps = combien sur ton RTX 50 ?</li>
          </ul>
          <p style={{ margin: '10px 0 0', padding: '8px 10px', background: '#1a1a1e', borderRadius: 4 }}>
            <strong style={{ color: '#10B981' }}>Si Wan 2.2 sort un chat-qui-s&apos;étire correct</strong> → upgrade vers
            Wan 2.7 pas urgent. <strong style={{ color: '#EC4899' }}>Si rendu décevant</strong> → on planifie l&apos;upgrade
            (~3-5h de setup partner nodes + nouveaux models).
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Composants ────────────────────────────────────────────────────────────

function RunCard({ run }: { run: AnimRun }) {
  const elapsed = Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)
  return (
    <div style={{
      padding: 12, background: '#0f0f13', border: '1px solid #2a2a30',
      borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
        <span style={{ color: '#9898b4' }}>
          <code style={{ color: '#d4a84c' }}>{run.frames}f @{run.fps}fps</code>
          <span style={{ marginLeft: 8 }}>denoise <code>{run.denoise.toFixed(2)}</code></span>
          <span style={{ marginLeft: 8 }}>steps <code>{run.steps}</code></span>
          <span style={{ marginLeft: 8 }}>cfg <code>{run.cfg}</code></span>
        </span>
        <StatusBadge status={run.status} elapsed={elapsed} />
      </div>

      <div style={{ fontSize: 11, color: '#9898b4', fontStyle: 'italic' }}>
        &ldquo;{run.prompt}&rdquo;
      </div>

      {run.status === 'done' && run.videoUrl && (
        <video
          src={run.videoUrl}
          controls
          autoPlay loop muted
          style={{ width: '100%', maxHeight: 500, borderRadius: 4, background: '#000' }}
        />
      )}

      {run.status === 'error' && (
        <div style={{ padding: 8, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>
          ❌ {run.error}
        </div>
      )}

      {(run.status === 'queuing' || run.status === 'uploading' || run.status === 'generating') && (
        <ProgressBar elapsed={elapsed} estimatedSec={run.frames * 8 + run.steps * 3} />
      )}
    </div>
  )
}

function StatusBadge({ status, elapsed }: { status: AnimRun['status']; elapsed: number }) {
  const colors: Record<AnimRun['status'], string> = {
    uploading: '#3b82f6', queuing: '#3b82f6', generating: '#EC4899',
    done: '#10B981', error: '#7f1d1d',
  }
  const labels: Record<AnimRun['status'], string> = {
    uploading: '📤 Upload', queuing: '🔄 Queue',
    generating: '🎬 Génération', done: '✓ Done', error: '❌ Erreur',
  }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 3, fontSize: 11,
      background: colors[status], color: '#fff', fontWeight: 600,
    }}>
      {labels[status]} {(status === 'done' || status === 'error') ? `· ${elapsed}s` : `· ${elapsed}s en cours`}
    </span>
  )
}

function ProgressBar({ elapsed, estimatedSec }: { elapsed: number; estimatedSec: number }) {
  const pct = Math.min(99, (elapsed / estimatedSec) * 100)
  return (
    <div style={{ position: 'relative', height: 4, background: '#1a1a1e', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, height: '100%',
        width: `${pct}%`, background: '#EC4899',
        transition: 'width 500ms',
      }} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 12, background: '#0f0f13', border: '1px solid #2a2a30',
      borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
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

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: '#0d0d0d',
  color: '#ede9df',
  fontFamily: 'Inter, -apple-system, sans-serif',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
}

const btnStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
