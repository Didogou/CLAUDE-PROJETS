'use client'
/**
 * POC FramePack (lllyasviel + Stanford/MIT, avril 2025).
 *
 * Long-video I2V via next-frame prediction sur HunyuanVideo 13B. Permet 60s+
 * sur 6-8 GB VRAM (vs LTX 2.3 capé ~20s).
 *
 * Voir mémoire `project_framepack_install_2026_05_14` pour le contexte.
 */

import React, { useCallback, useState } from 'react'
import { runFramePack, type FramePackProgress } from '@/lib/comfyui-frame-pack'

type RunStatus = 'idle' | 'uploading' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'

export default function FramePackTestPage() {
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [prompt, setPrompt] = useState(
    'A slow camera dolly forward through a quiet street at sunset, golden hour light, gentle wind in leaves',
  )
  const [durationSec, setDurationSec] = useState(30)
  const [fps, setFps] = useState(30)
  const [width, setWidth] = useState(480)
  const [height, setHeight] = useState(832)
  const [steps, setSteps] = useState(25)
  const [cfg, setCfg] = useState(1.0)
  const [seed, setSeed] = useState(0)

  const [status, setStatus] = useState<RunStatus>('idle')
  const [progressLabel, setProgressLabel] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)

  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Le fichier doit être une image.')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = reject
        r.readAsDataURL(file)
      })
      const res = await fetch('/api/storage/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path: `framepack-test/input_${Date.now()}.png` }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload HTTP ' + res.status)
      setImageUrl(data.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }, [])

  const handleRun = useCallback(async () => {
    if (!imageUrl) { setErrorMsg('Upload une image d\'abord.'); return }
    if (!prompt.trim()) { setErrorMsg('Renseigne un prompt.'); return }
    setStatus('uploading')
    setResultUrl(null)
    setErrorMsg(null)
    const startedAt = Date.now()

    try {
      const url = await runFramePack({
        sourceImageUrl: imageUrl,
        prompt, durationSec, fps, width, height, steps, cfg,
        seed: seed === 0 ? -1 : seed,
        storagePathPrefix: 'framepack-test/output',
        onProgress: (p: FramePackProgress) => {
          setStatus(p.stage)
          setProgressLabel(p.label ?? p.stage)
        },
      })
      setStatus('done')
      setProgressLabel('Vidéo générée ✓')
      setResultUrl(url)
      setElapsedMs(Date.now() - startedAt)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setProgressLabel('Erreur')
      setElapsedMs(Date.now() - startedAt)
    }
  }, [imageUrl, prompt, durationSec, fps, width, height, steps, cfg, seed])

  const canRun = !!imageUrl && !!prompt.trim()
    && status !== 'uploading' && status !== 'queuing'
    && status !== 'generating' && status !== 'fetching'

  return (
    <div style={{
      minHeight: '100vh', background: '#fff', color: '#222',
    }}>
    <div style={{
      maxWidth: '70rem', margin: '0 auto', padding: '2rem 1.5rem',
      fontFamily: 'system-ui, sans-serif', color: '#222',
    }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>FramePack — POC</h1>
      <p style={{ color: '#666', marginTop: 0, marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Long-video I2V (HunyuanVideo 13B + next-frame prediction). 60s+ sur 8 GB VRAM.
      </p>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ border: '1px solid #ddd', borderRadius: '0.5rem', padding: '1rem' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Image source</h2>
          <input
            type="file" accept="image/*"
            onChange={e => e.target.files?.[0] && handleImageFile(e.target.files[0])}
            disabled={uploading}
          />
          {uploading && <p style={{ color: '#888', fontSize: '0.85rem' }}>Upload…</p>}
          {imageUrl && (
            <img src={imageUrl} alt="source"
              style={{ display: 'block', marginTop: '0.5rem', maxWidth: '100%', maxHeight: '20rem', borderRadius: '0.25rem' }} />
          )}
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: '0.5rem', padding: '1rem' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Prompt (mouvement)</h2>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={4}
            style={{ width: '100%', padding: '0.5rem', fontFamily: 'inherit', fontSize: '0.9rem' }}
            placeholder="Décris la scène + le mouvement (caméra, action). Anglais recommandé."
          />
        </div>
      </section>

      {uploadError && (
        <div style={{ background: '#fee', color: '#c00', padding: '0.75rem', borderRadius: '0.25rem', marginBottom: '1rem' }}>
          {uploadError}
        </div>
      )}

      <section style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.75rem',
        marginBottom: '1.5rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '0.5rem',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          Durée (s)
          <input type="number" min={1} max={120} value={durationSec}
            onChange={e => setDurationSec(parseInt(e.target.value, 10))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          FPS
          <input type="number" min={5} max={60} value={fps}
            onChange={e => setFps(parseInt(e.target.value, 10))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          Width
          <input type="number" min={256} max={1024} step={32} value={width}
            onChange={e => setWidth(parseInt(e.target.value, 10))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          Height
          <input type="number" min={256} max={1024} step={32} value={height}
            onChange={e => setHeight(parseInt(e.target.value, 10))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          Steps
          <input type="number" min={5} max={50} value={steps}
            onChange={e => setSteps(parseInt(e.target.value, 10))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          CFG
          <input type="number" min={0.5} max={10} step={0.1} value={cfg}
            onChange={e => setCfg(parseFloat(e.target.value))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          Seed (0=rand)
          <input type="number" min={0} value={seed}
            onChange={e => setSeed(parseInt(e.target.value, 10))} />
        </label>
      </section>

      <button
        type="button"
        onClick={handleRun}
        disabled={!canRun}
        style={{
          padding: '0.75rem 1.5rem', fontSize: '1rem',
          background: canRun ? '#ec4899' : '#ddd',
          color: canRun ? 'white' : '#888',
          border: 'none', borderRadius: '0.25rem', cursor: canRun ? 'pointer' : 'not-allowed',
        }}
      >
        Lancer FramePack ({durationSec}s)
      </button>

      {status !== 'idle' && (
        <div style={{
          marginTop: '1.5rem', padding: '1rem',
          background: status === 'error' ? '#fee' : status === 'done' ? '#efe' : '#eef',
          borderRadius: '0.25rem',
        }}>
          <p style={{ margin: 0, fontWeight: 500 }}>{progressLabel}</p>
          {elapsedMs !== null && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#666' }}>
              Durée : {(elapsedMs / 1000 / 60).toFixed(1)} min
            </p>
          )}
          {errorMsg && <pre style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{errorMsg}</pre>}
        </div>
      )}

      {resultUrl && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem' }}>Résultat</h2>
          <video src={resultUrl} controls style={{ width: '100%', maxWidth: '40rem', borderRadius: '0.25rem' }} />
          <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem', wordBreak: 'break-all' }}>
            <a href={resultUrl} target="_blank" rel="noopener noreferrer">{resultUrl}</a>
          </p>
        </section>
      )}
    </div>
    </div>
  )
}
