'use client'
/**
 * POC Qwen Image Edit 2511 — édition d'image par instruction + référence.
 *
 * Cas d'usage Hero : "ajoute un chat sur le fût dans cette scène", soit
 *   - Mode TEXTE : prompt seul → Qwen Edit invente le chat dans le style
 *   - Mode RÉFÉRENCE : prompt + image chat (banque) → Qwen intègre CE chat
 *
 * Stack : qwen_image_edit_2511_fp8mixed (10GB fp8) + qwen_2.5_vl_7b (9GB) +
 * qwen_image_vae (250MB). Tout déjà installé chez Didier.
 *
 * Validé 2026-04-28 — équivalent open-source de Flux Kontext, fits 8GB VRAM.
 */

import React, { useCallback, useEffect, useState } from 'react'

interface Run {
  id: string
  prompt: string
  baseUrl: string
  refUrl: string | null
  maskUrl: string | null
  maskPrompt: string | null
  steps: number
  cfg: number
  useLightning: boolean
  status: 'uploading' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  promptId?: string
  resultUrl?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

const PROMPT_PRESETS = [
  { label: '🐱 Chat sur le fût', prompt: 'Add a small tabby cat sitting on top of the wooden barrel, the cat is roughly 30cm tall, much smaller than the barrel itself. Keep the rest of the scene unchanged. Match the warm candlelight and painterly style.' },
  { label: '🪑 PNJ sur le tabouret', prompt: 'Add a medieval villager sitting on the wooden stool, normal human proportions for the scene, simple clothes. Keep the rest of the scene unchanged. Painterly style, integrated into the existing lighting.' },
  { label: '🎨 Référence à intégrer (petite)', prompt: 'Insert the subject from the reference image into the scene, placed on top of the wooden barrel. The inserted subject must occupy a small portion of the frame (~10-15% of image height), realistic scale relative to the surrounding objects. Do not enlarge or center the subject — preserve the original composition, framing, lighting and palette of the scene exactly.' },
  { label: '🌫 Atmosphère', prompt: 'Add subtle smoke and dust particles drifting through the candlelight beams, enhance the atmospheric mood. Keep all subjects, objects and composition unchanged.' },
  { label: '✋ Manuel', prompt: '' },
]

const NEGATIVE_DEFAULT = 'low quality, blurry, distorted anatomy, bad lighting, watermark'

export default function QwenEditTestPage() {
  const [baseUrl, setBaseUrl] = useState('')
  const [refUrl, setRefUrl] = useState<string | null>(null)
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0].prompt)
  const [useLightning, setUseLightning] = useState(true)  // ⚡ default ON : ~6x plus rapide
  const [steps, setSteps] = useState(4)                   // 4 par défaut (Lightning), 25 sans
  const [cfg, setCfg] = useState(1.0)                     // 1.0 Lightning, 4 sans

  // Si user toggle Lightning, ajuste steps/cfg aux valeurs recommandées
  useEffect(() => {
    if (useLightning) {
      setSteps(4)
      setCfg(1.0)
    } else {
      setSteps(25)
      setCfg(4)
    }
  }, [useLightning])
  const [uploading, setUploading] = useState<'base' | 'ref' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  // ── Mask Grounded-SAM ──
  // L'auteur tape "barrel" → DINO+SAM segmente → mask binaire (PNG blanc/noir)
  // → passé à Qwen Edit en SetLatentNoiseMask. Garantit que l'édition reste
  // strictement dans la zone détectée, pas de drift composition.
  const [maskPrompt, setMaskPrompt] = useState('')
  const [maskUrl, setMaskUrl] = useState<string | null>(null)
  const [detectingMask, setDetectingMask] = useState(false)
  const [maskError, setMaskError] = useState<string | null>(null)
  // Marge autour de la silhouette détectée — DINO retourne le contour strict
  // de l'objet ("barrel" = silhouette du tonneau). Sans marge, pas de place
  // pour un sujet inséré au-dessus (chat).
  const [maskGrow, setMaskGrow] = useState(48)
  // Adoucissement gaussien des bords. 0 = bords nets, ~8-16 = transition douce.
  const [maskBlur, setMaskBlur] = useState(8)

  async function handleUpload(slot: 'base' | 'ref', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(slot)
    setUploadError(null)
    if (slot === 'base') setBaseUrl(''); else setRefUrl(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('path', `test/qwen-edit/${slot}_${Date.now()}`)
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? `upload failed`)
      if (slot === 'base') setBaseUrl(data.url); else setRefUrl(data.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(null)
    }
  }

  function applyPreset(idx: number) {
    setPrompt(PROMPT_PRESETS[idx].prompt)
  }

  // Reset le mask si on change la base (mask spécifique à l'image source)
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
    if (!baseUrl || !prompt.trim()) return
    const id = `run-${Date.now()}`
    const newRun: Run = {
      id, prompt, baseUrl, refUrl, maskUrl, maskPrompt: maskUrl ? maskPrompt : null,
      steps, cfg, useLightning,
      status: 'uploading', startedAt: Date.now(),
    }
    setRuns(prev => [newRun, ...prev])

    try {
      // Free VRAM avant
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))

      // Upload base + (optionnel) ref + (optionnel) mask vers ComfyUI input
      const upBase = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: baseUrl, name: 'qwen_base' }),
      })
      const upBaseData = await upBase.json()
      if (!upBase.ok || !upBaseData.filename) throw new Error(upBaseData.error ?? 'upload base failed')

      let refFilename: string | undefined
      if (refUrl) {
        const upRef = await fetch('/api/comfyui/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'url', url: refUrl, name: 'qwen_ref' }),
        })
        const upRefData = await upRef.json()
        if (!upRef.ok || !upRefData.filename) throw new Error(upRefData.error ?? 'upload ref failed')
        refFilename = upRefData.filename
      }

      let maskFilename: string | undefined
      if (maskUrl) {
        const upMask = await fetch('/api/comfyui/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'url', url: maskUrl, name: 'qwen_mask' }),
        })
        const upMaskData = await upMask.json()
        if (!upMask.ok || !upMaskData.filename) throw new Error(upMaskData.error ?? 'upload mask failed')
        maskFilename = upMaskData.filename
      }

      // Queue Qwen Edit
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'queuing' } : r))
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'qwen_image_edit',
          source_image: upBaseData.filename,
          reference_image: refFilename,
          mask_image: maskFilename,
          mask_grow: maskFilename ? maskGrow : undefined,
          mask_blur: maskFilename ? maskBlur : undefined,
          prompt_positive: prompt,
          prompt_negative: NEGATIVE_DEFAULT,
          steps, cfg, seed: -1,
          use_lightning: useLightning,
        }),
      })
      const queueData = await queueRes.json()
      if (!queueRes.ok || !queueData.prompt_id) throw new Error(queueData.error ?? 'queue failed')
      setRuns(prev => prev.map(r => r.id === id ? { ...r, promptId: queueData.prompt_id, status: 'generating' } : r))

      // Poll status
      const maxWait = Date.now() + 5 * 60 * 1000
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

      // Récupère l'image (qwen_image_edit produit une image, pas une vidéo)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'fetching' } : r))
      const storagePath = `test/qwen-edit/run_${id}`
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
  }, [baseUrl, refUrl, maskUrl, maskPrompt, maskGrow, maskBlur, prompt, steps, cfg, useLightning])

  const isAnyRunning = runs.some(r => r.status !== 'done' && r.status !== 'error')

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1300, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Qwen Image Edit 2511 — édition + insertion
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Édite une scène par instruction texte, optionnellement avec une 2ème
          image de référence (banque). Équivalent open-source de Flux Kontext.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16 }}>
          {/* ── Form ──────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section title="① Image de base (la scène)">
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpload('base', e)} disabled={uploading !== null}
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

            <Section title="② Zone d'édition (mask, optionnel mais recommandé)">
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4, lineHeight: 1.5 }}>
                Tape un mot-clé EN (ex: <code style={{ color: '#10B981' }}>barrel</code>, <code style={{ color: '#10B981' }}>stool</code>, <code style={{ color: '#10B981' }}>table</code>).
                Grounded-SAM segmente la zone → Qwen n'éditera <strong>que là</strong>.
                Sans mask, Qwen regénère toute l'image et peut drift.
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
                      0 = silhouette stricte du sujet · 48 (default) = place pour insérer ·
                      120+ = grande zone autour
                    </div>
                  </Field>
                  <Field label={`Adoucissement bords : ${maskBlur}px`}>
                    <input type="range" min={0} max={32} step={1} value={maskBlur}
                      onChange={e => setMaskBlur(Number(e.target.value))} style={{ width: '100%' }} />
                    <div style={{ fontSize: 9, color: '#666' }}>
                      0 = bords nets (visibles sur peinture) · 8 (default) = transition douce
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

            <Section title="③ Image de référence (optionnelle)">
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                Pour intégrer un objet/perso spécifique (ex: chat de la banque).
                Sans référence, Qwen invente depuis le prompt.
              </div>
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpload('ref', e)} disabled={uploading !== null}
                style={{ ...inputStyle, padding: 6 }} />
              {uploading === 'ref' && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
              {refUrl && (
                <div style={{
                  marginTop: 6,
                  background: `url(${refUrl}) center/contain no-repeat #1a1a1e`,
                  height: 120, border: '1px solid #2a2a30', borderRadius: 4,
                }} />
              )}
              {refUrl && (
                <button onClick={() => setRefUrl(null)}
                  style={{ ...btnStyle, fontSize: 10, padding: '4px 8px', background: '#7f1d1d' }}>
                  Retirer la référence
                </button>
              )}
            </Section>

            {uploadError && (
              <div style={{ padding: 8, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>
                ❌ {uploadError}
              </div>
            )}

            <Section title="④ Prompt d'édition">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {PROMPT_PRESETS.map((p, i) => (
                  <button key={p.label} onClick={() => applyPreset(i)}
                    style={{ ...btnStyle, fontSize: 11, padding: '6px 8px', textAlign: 'left' }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
                placeholder="Décris ce qui doit être ajouté ou modifié (en EN, plus stable)…"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              {refUrl && !maskUrl && (
                <div style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.5, padding: 6, background: '#3a2a0a', borderRadius: 4 }}>
                  ⚠ <strong>Référence sans mask</strong> — Qwen tend à surdimensionner le sujet inséré et drift la composition.
                  Mieux : ajoute un mask en ② (zone d&apos;insertion). Sinon, ajoute dans le prompt :
                  <em>taille relative</em> (&ldquo;small&rdquo;, &ldquo;~10-15% of image height&rdquo;) +
                  <em>&ldquo;preserve original composition&rdquo;</em>.
                </div>
              )}
              {maskUrl && (
                <div style={{ fontSize: 10, color: '#10B981', lineHeight: 1.5, padding: 6, background: '#0d2818', borderRadius: 4 }}>
                  ✓ <strong>Mode mask actif</strong> — l&apos;édition est restreinte à la zone détectée pour
                  &ldquo;{maskPrompt}&rdquo;. Le reste de l&apos;image reste pixel-perfect.
                  Le sujet inséré sera forcément à l&apos;échelle de la zone masquée.
                </div>
              )}
            </Section>

            <Section title="⑤ Paramètres">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: 8,
                background: useLightning ? '#10B981' : '#1a1a1e', borderRadius: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={useLightning}
                  onChange={e => setUseLightning(e.target.checked)} />
                <strong>⚡ Lightning 4-step LoRA</strong>
                <span style={{ fontSize: 10, color: useLightning ? '#fff' : '#9898b4', marginLeft: 'auto' }}>
                  ~10-15s vs 60-90s
                </span>
              </label>
              <Field label={`Steps : ${steps}`}>
                <input type="range" min={1} max={40} step={1} value={steps}
                  onChange={e => setSteps(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
              <Field label={`CFG : ${cfg.toFixed(1)} ${useLightning ? '(Lightning : 1.0 idéal)' : '(3-5 idéal)'}`}>
                <input type="range" min={1} max={10} step={0.5} value={cfg}
                  onChange={e => setCfg(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
            </Section>

            <button onClick={handleGenerate}
              disabled={!baseUrl || !prompt.trim() || isAnyRunning || uploading !== null}
              style={{
                ...btnStyle,
                background: (!baseUrl || !prompt.trim() || isAnyRunning || uploading !== null) ? '#444' : '#EC4899',
                padding: 12, fontSize: 14, fontWeight: 600,
              }}>
              {isAnyRunning ? '⏳ Génération…'
                : !baseUrl ? '⚠ Upload une scène d\'abord'
                : !prompt.trim() ? '⚠ Ajoute un prompt'
                : '🎨 Générer édition'}
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
                Upload une scène, ajoute un prompt, génère. ~60-90s sur 8GB.
              </div>
            )}
            {runs.map(run => <RunCard key={run.id} run={run} />)}
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>À évaluer :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>Mode TEXTE seul : "Add a tabby cat sitting on the wooden barrel" → Qwen invente un chat cohérent ?</li>
            <li>Mode RÉFÉRENCE : avec image chat → Qwen intègre CE chat avec la lumière scène ?</li>
            <li>Style préservé (painterly, candlelight) ou drift photoréaliste ?</li>
            <li>Position obéie au prompt (sur le fût) ou Qwen choisit librement ?</li>
            <li>CFG 3 vs 5 vs 7 : impact sur fidélité prompt</li>
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
          {run.useLightning && <code style={{ color: '#10B981', marginRight: 4 }}>⚡</code>}
          <code style={{ color: '#d4a84c' }}>{run.steps}st / cfg {run.cfg.toFixed(1)}</code>
          <span style={{ marginLeft: 6, color: run.refUrl ? '#10B981' : '#666' }}>
            {run.refUrl ? '+ référence' : 'texte seul'}
          </span>
          {run.maskUrl && (
            <span style={{ marginLeft: 6, color: '#a78bfa' }}>
              + mask &ldquo;{run.maskPrompt}&rdquo;
            </span>
          )}
        </span>
        <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
          background: run.status === 'done' ? '#10B981' : run.status === 'error' ? '#7f1d1d' : '#EC4899', color: '#fff' }}>
          {run.status} · {elapsed}s
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#9898b4', fontStyle: 'italic' }}>&ldquo;{run.prompt}&rdquo;</div>
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
