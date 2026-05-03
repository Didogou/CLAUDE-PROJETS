'use client'
/**
 * POC Flux.1 Fill Dev (GGUF Q4) — vrai inpaint local sur 8 GB VRAM.
 *
 * Pattern : auteur tape le mot-clé d'un objet ("barrel"), Grounded-SAM segmente,
 * Flux Fill regénère uniquement la zone masquée (vrai inpaint, pas édition globale
 * comme Qwen Edit). Le reste de l'image est PIXEL-PERFECT préservé via
 * InpaintModelConditioning + noise_mask.
 *
 * Stack : flux1-fill-dev-fp16-Q4_0-GGUF (6.8 GB) + t5xxl_fp16 + clip_l + ae VAE.
 * Custom node ComfyUI-GGUF (city96) requis.
 *
 * Validé 2026-04-29 — prend la place de la POC qwen-edit pour l'insertion locale.
 * Qwen Edit reste utile pour l'édition globale par instruction (sans mask).
 */

import React, { useCallback, useEffect, useState } from 'react'

interface Run {
  id: string
  prompt: string
  baseUrl: string
  maskUrl: string
  maskPrompt: string
  steps: number
  guidance: number
  maskGrow: number
  maskBlur: number
  status: 'uploading' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  promptId?: string
  resultUrl?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

const PROMPT_PRESETS = [
  { label: '🐱 Chat sur le fût', prompt: 'a small ginger tabby cat sitting on top of the wooden barrel, painterly style, warm candlelight, integrated into the tavern scene' },
  { label: '🪑 PNJ sur le tabouret', prompt: 'a medieval villager sitting on the wooden stool, simple tunic, painterly style consistent with the scene' },
  { label: '🗑 Supprimer (vider la zone)', prompt: '' },
  { label: '🔥 Bougie allumée', prompt: 'a lit candle with a small flickering flame, warm orange glow, painterly style' },
  { label: '✋ Manuel', prompt: '' },
]

const NEGATIVE_DEFAULT = ''  // Flux Fill ignore largement le négatif (CFG=1)

export default function FluxFillTestPage() {
  const [baseUrl, setBaseUrl] = useState('')
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0].prompt)
  const [steps, setSteps] = useState(20)
  const [guidance, setGuidance] = useState(30)  // Flux guidance, ≠ CFG sampler
  const [uploading, setUploading] = useState<'base' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Run[]>([])

  // ── Mask Grounded-SAM ──
  const [maskPrompt, setMaskPrompt] = useState('')
  const [maskUrl, setMaskUrl] = useState<string | null>(null)
  const [detectingMask, setDetectingMask] = useState(false)
  const [maskError, setMaskError] = useState<string | null>(null)
  const [maskGrow, setMaskGrow] = useState(0)   // Flux Fill marche bien sans dilation par défaut
  const [maskBlur, setMaskBlur] = useState(8)   // soft edges quand même utile

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading('base')
    setUploadError(null)
    setBaseUrl('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('path', `test/flux-fill/base_${Date.now()}`)
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? `upload failed`)
      setBaseUrl(data.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(null)
    }
  }

  function applyPreset(idx: number) {
    setPrompt(PROMPT_PRESETS[idx].prompt)
  }

  // Reset mask quand l'image change
  useEffect(() => {
    setMaskUrl(null)
    setMaskError(null)
  }, [baseUrl])

  async function handleDetectMask() {
    if (!baseUrl || !maskPrompt.trim()) return
    setDetectingMask(true)
    setMaskError(null)
    setMaskUrl(null)
    try {
      const res = await fetch('/api/comfyui/grounded-sam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: baseUrl, prompt_text: maskPrompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.mask_url) {
        throw new Error(data.error ?? data.message ?? 'detection failed')
      }
      setMaskUrl(data.mask_url)
    } catch (err) {
      setMaskError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetectingMask(false)
    }
  }

  const handleGenerate = useCallback(async () => {
    if (!baseUrl || !maskUrl) return  // Flux Fill : mask OBLIGATOIRE
    const id = `run-${Date.now()}`
    const newRun: Run = {
      id, prompt, baseUrl, maskUrl, maskPrompt,
      steps, guidance, maskGrow, maskBlur,
      status: 'uploading', startedAt: Date.now(),
    }
    setRuns(prev => [newRun, ...prev])

    try {
      // Free VRAM avant
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))

      // Upload base + mask vers ComfyUI input
      const upBase = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: baseUrl, name: 'flux_fill_base' }),
      })
      const upBaseData = await upBase.json()
      if (!upBase.ok || !upBaseData.filename) throw new Error(upBaseData.error ?? 'upload base failed')

      const upMask = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: maskUrl, name: 'flux_fill_mask' }),
      })
      const upMaskData = await upMask.json()
      if (!upMask.ok || !upMaskData.filename) throw new Error(upMaskData.error ?? 'upload mask failed')

      // Queue Flux Fill
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'queuing' } : r))
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'flux_fill',
          source_image: upBaseData.filename,
          mask_image: upMaskData.filename,
          mask_grow: maskGrow,
          mask_blur: maskBlur,
          prompt_positive: prompt,
          prompt_negative: NEGATIVE_DEFAULT,
          steps,
          cfg: guidance,  // côté workflow, params.cfg = Flux guidance (cf comfyui.ts)
          seed: -1,
        }),
      })
      const queueData = await queueRes.json()
      if (!queueRes.ok || !queueData.prompt_id) throw new Error(queueData.error ?? 'queue failed')
      setRuns(prev => prev.map(r => r.id === id ? { ...r, promptId: queueData.prompt_id, status: 'generating' } : r))

      // Poll status
      const maxWait = Date.now() + 8 * 60 * 1000  // Flux Fill peut être lent (8 min max)
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sRes = await fetch(`/api/comfyui?prompt_id=${queueData.prompt_id}`)
        const sData = await sRes.json()
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'generation failed')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout')

      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'fetching' } : r))
      const storagePath = `test/flux-fill/run_${id}`
      const iRes = await fetch(`/api/comfyui?prompt_id=${queueData.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`)
      const iData = await iRes.json()
      if (!iRes.ok || !iData.image_url) throw new Error(iData.error ?? 'image_url manquante')
      setRuns(prev => prev.map(r =>
        r.id === id ? { ...r, status: 'done', resultUrl: iData.image_url, finishedAt: Date.now() } : r,
      ))
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: msg, finishedAt: Date.now() } : r))
    }
  }, [baseUrl, maskUrl, maskPrompt, prompt, steps, guidance, maskGrow, maskBlur])

  const isAnyRunning = runs.some(r => r.status !== 'done' && r.status !== 'error')

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1300, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Flux.1 Fill Dev — vrai inpaint local (8 GB VRAM)
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Insertion / suppression locale d&apos;objet via mask. Le reste de l&apos;image
          est <strong style={{ color: '#10B981' }}>pixel-perfect préservé</strong> (vrai inpaint, pas édition
          globale comme Qwen Edit). Mask via Grounded-SAM.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16 }}>
          {/* ── Form ──────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section title="① Image de base (la scène)">
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={handleUpload} disabled={uploading !== null}
                style={{ ...inputStyle, padding: 6 }} />
              {uploading === 'base' && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
              {baseUrl && (
                <div style={{
                  marginTop: 6,
                  background: `url(${baseUrl}) center/contain no-repeat #1a1a1e`,
                  height: 160, border: '1px solid #2a2a30', borderRadius: 4,
                }} />
              )}
            </Section>

            {uploadError && (
              <div style={{ padding: 8, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>
                ❌ {uploadError}
              </div>
            )}

            <Section title="② Zone d'édition (mask, OBLIGATOIRE)">
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4, lineHeight: 1.5 }}>
                Tape un mot-clé EN (ex: <code style={{ color: '#10B981' }}>barrel</code>, <code style={{ color: '#10B981' }}>stool</code>).
                Flux Fill regénère <strong>uniquement</strong> la zone détectée.
                Le reste de l&apos;image reste intact (vrai inpaint).
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={maskPrompt}
                  onChange={e => setMaskPrompt(e.target.value)}
                  placeholder="ex: barrel"
                  disabled={!baseUrl || detectingMask}
                  style={{ ...inputStyle, flex: 1 }} />
                <button onClick={handleDetectMask}
                  disabled={!baseUrl || !maskPrompt.trim() || detectingMask}
                  style={{
                    ...btnStyle,
                    background: (!baseUrl || !maskPrompt.trim() || detectingMask) ? '#444' : '#7C3AED',
                    fontWeight: 600, padding: '8px 12px',
                  }}>
                  {detectingMask ? '⏳' : '🎯 Détecter'}
                </button>
              </div>
              {maskUrl && (
                <div style={{
                  marginTop: 6,
                  background: `url(${maskUrl}) center/contain no-repeat #1a1a1e`,
                  height: 120, border: '1px solid #10B981', borderRadius: 4,
                }} />
              )}
              {maskUrl && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: '#10B981' }}>
                    ✓ Mask détecté pour &ldquo;{maskPrompt}&rdquo;
                  </span>
                  <button onClick={() => setMaskUrl(null)}
                    style={{ ...btnStyle, fontSize: 10, padding: '2px 6px', background: '#7f1d1d', marginLeft: 'auto' }}>
                    Retirer
                  </button>
                </div>
              )}
              {maskUrl && (
                <>
                  <Field label={`Marge autour du mask : ${maskGrow}px`}>
                    <input type="range" min={0} max={200} step={4} value={maskGrow}
                      onChange={e => setMaskGrow(Number(e.target.value))} style={{ width: '100%' }} />
                    <div style={{ fontSize: 9, color: '#666' }}>
                      0 (default) = silhouette stricte · 48 = place pour insérer un sujet plus grand
                    </div>
                  </Field>
                  <Field label={`Adoucissement bords : ${maskBlur}px`}>
                    <input type="range" min={0} max={32} step={1} value={maskBlur}
                      onChange={e => setMaskBlur(Number(e.target.value))} style={{ width: '100%' }} />
                    <div style={{ fontSize: 9, color: '#666' }}>
                      0 = bords nets · 8 (default) = transition douce sur peintures
                    </div>
                  </Field>
                </>
              )}
              {maskError && (
                <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>
                  ❌ {maskError}
                </div>
              )}
            </Section>

            <Section title="③ Prompt d'édition">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {PROMPT_PRESETS.map((p, i) => (
                  <button key={p.label} onClick={() => applyPreset(i)}
                    style={{ ...btnStyle, fontSize: 11, padding: '6px 8px', textAlign: 'left' }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
                placeholder="Décris ce qui doit apparaître dans la zone masquée (en EN, plus stable). Vide = supprimer/vider la zone."
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </Section>

            <Section title="④ Paramètres Flux Fill">
              <Field label={`Steps : ${steps}`}>
                <input type="range" min={10} max={40} step={1} value={steps}
                  onChange={e => setSteps(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>
                  20 (default BFL) · 30 = qualité max · 10 = test rapide
                </div>
              </Field>
              <Field label={`Guidance Flux : ${guidance}`}>
                <input type="range" min={5} max={50} step={1} value={guidance}
                  onChange={e => setGuidance(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>
                  30 (default BFL pour Fill) · &gt;40 = trop saturé · &lt;15 = ignore le prompt
                </div>
              </Field>
              <div style={{ fontSize: 10, color: '#9898b4', padding: 6, background: '#0d2818', borderRadius: 4 }}>
                💡 CFG sampler = 1.0 fixe (Flux). La &laquo;&nbsp;force&nbsp;&raquo; est dans <em>guidance</em>.
              </div>
            </Section>

            <button onClick={handleGenerate}
              disabled={!baseUrl || !maskUrl || isAnyRunning || uploading !== null}
              style={{
                ...btnStyle,
                background: (!baseUrl || !maskUrl || isAnyRunning || uploading !== null) ? '#444' : '#F97316',
                padding: 12, fontSize: 14, fontWeight: 600,
              }}>
              {isAnyRunning ? '⏳ Génération…'
                : !baseUrl ? '⚠ Upload une scène d\'abord'
                : !maskUrl ? '⚠ Détecte une zone d\'abord (②)'
                : '🪄 Générer Flux Fill'}
            </button>
          </div>

          {/* ── History ────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#F97316', textTransform: 'uppercase' }}>
              Historique ({runs.length})
            </div>
            {runs.length === 0 && (
              <div style={{ padding: 24, background: '#0f0f13', border: '1px dashed #2a2a30',
                borderRadius: 6, fontSize: 12, color: '#666', textAlign: 'center' }}>
                Upload scène, détecte zone, génère. ~30-90s sur 8 GB VRAM (Q4).
              </div>
            )}
            {runs.map(run => <RunCard key={run.id} run={run} />)}
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#F97316' }}>Différence avec POC Qwen Edit :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>Flux Fill = <strong>vrai inpaint</strong>. Zone non-masquée pixel-perfect préservée.</li>
            <li>Qwen Edit = édition globale. Sans mask il drift, avec mask il regénère quand même tout.</li>
            <li>Pour insertion locale d&apos;objet → Flux Fill. Pour transformation globale → Qwen Edit.</li>
            <li>Mask OBLIGATOIRE ici (pas d&apos;édition sans mask).</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function RunCard({ run }: { run: Run }) {
  const elapsed = Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)
  return (
    <div style={{ padding: 10, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: '#9898b4' }}>
          <code style={{ color: '#F97316' }}>{run.steps}st / g{run.guidance}</code>
          <span style={{ marginLeft: 6, color: '#a78bfa' }}>
            mask &ldquo;{run.maskPrompt}&rdquo;
          </span>
          {(run.maskGrow > 0 || run.maskBlur > 0) && (
            <span style={{ marginLeft: 6, color: '#666', fontSize: 10 }}>
              g{run.maskGrow}/b{run.maskBlur}
            </span>
          )}
        </span>
        <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
          background: run.status === 'done' ? '#10B981' : run.status === 'error' ? '#7f1d1d' : '#F97316', color: '#fff' }}>
          {run.status} · {elapsed}s
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#9898b4', fontStyle: 'italic' }}>
        {run.prompt ? `“${run.prompt}”` : '(vide → supprime/vide la zone)'}
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
