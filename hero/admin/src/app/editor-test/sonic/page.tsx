'use client'
/**
 * POC Sonic Video (Tencent, 2025) — talking-head audio-driven portrait animation.
 *
 * Pipeline : SVD xt 1.1 + Sonic UNet patch + Whisper-tiny + YOLO face + RIFE.
 * Voir mémoire `project_sonic_install_2026_05_14` pour le contexte d'évaluation
 * vs notre stack LTX 2.3 + Vantage Dual mono-perso plan rapproché.
 */

import React, { useCallback, useState } from 'react'
import { runSonic, type SonicProgress } from '@/lib/comfyui-sonic'

type RunStatus = 'idle' | 'uploading' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'

export default function SonicTestPage() {
  const [portraitUrl, setPortraitUrl] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [uploadingPortrait, setUploadingPortrait] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Params Sonic
  const [durationSec, setDurationSec] = useState(5)
  const [inferenceSteps, setInferenceSteps] = useState(25)
  const [fps, setFps] = useState(25)
  const [seed, setSeed] = useState(0)

  // État du run
  const [status, setStatus] = useState<RunStatus>('idle')
  const [progressLabel, setProgressLabel] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)

  // ── Upload portrait (image → bucket Supabase) ──────────────────────────────
  const handlePortraitFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Le fichier portrait doit être une image (JPG/PNG).')
      return
    }
    setUploadingPortrait(true)
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
        body: JSON.stringify({ data_url: dataUrl, path: `sonic-test/portrait_${Date.now()}.png` }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload portrait HTTP ' + res.status)
      setPortraitUrl(data.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingPortrait(false)
    }
  }, [])

  // ── Upload audio ───────────────────────────────────────────────────────────
  const handleAudioFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('audio/')) {
      setUploadError('Le fichier audio doit être WAV / MP3 / OGG.')
      return
    }
    setUploadingAudio(true)
    setUploadError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = reject
        r.readAsDataURL(file)
      })
      const res = await fetch('/api/storage/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path: `sonic-test/audio_${Date.now()}.wav` }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload audio HTTP ' + res.status)
      setAudioUrl(data.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingAudio(false)
    }
  }, [])

  // ── Run Sonic ──────────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!portraitUrl || !audioUrl) {
      setErrorMsg('Upload un portrait + un audio d\'abord.')
      return
    }
    setStatus('uploading')
    setProgressLabel('Préparation…')
    setResultUrl(null)
    setErrorMsg(null)
    setElapsedMs(null)
    const startedAt = Date.now()

    try {
      const url = await runSonic({
        portraitUrl, audioUrl,
        storagePathPrefix: 'sonic-test/output',
        durationSec, inferenceSteps, fps,
        seed: seed === 0 ? -1 : seed,
        onProgress: (p: SonicProgress) => {
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
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setProgressLabel('Erreur')
      setElapsedMs(Date.now() - startedAt)
    }
  }, [portraitUrl, audioUrl, durationSec, inferenceSteps, fps, seed])

  const canRun = !!portraitUrl && !!audioUrl
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
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Sonic Video — POC</h1>
      <p style={{ color: '#666', marginTop: 0, marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Talking-head audio-driven (Tencent). 1 portrait + 1 audio → vidéo lipsync.
        Évalué vs LTX 2.3 + Vantage Dual mono-perso plan rapproché.
      </p>

      {/* ── INPUTS ── */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ border: '1px solid #ddd', borderRadius: '0.5rem', padding: '1rem' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Portrait</h2>
          <input
            type="file" accept="image/*"
            onChange={e => e.target.files?.[0] && handlePortraitFile(e.target.files[0])}
            disabled={uploadingPortrait}
          />
          {uploadingPortrait && <p style={{ color: '#888', fontSize: '0.85rem' }}>Upload…</p>}
          {portraitUrl && (
            <img
              src={portraitUrl} alt="portrait"
              style={{ display: 'block', marginTop: '0.5rem', maxWidth: '100%', maxHeight: '15rem', borderRadius: '0.25rem' }}
            />
          )}
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: '0.5rem', padding: '1rem' }}>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Audio</h2>
          <input
            type="file" accept="audio/*"
            onChange={e => e.target.files?.[0] && handleAudioFile(e.target.files[0])}
            disabled={uploadingAudio}
          />
          {uploadingAudio && <p style={{ color: '#888', fontSize: '0.85rem' }}>Upload…</p>}
          {audioUrl && <audio src={audioUrl} controls style={{ display: 'block', marginTop: '0.5rem', width: '100%' }} />}
        </div>
      </section>

      {uploadError && (
        <div style={{ background: '#fee', color: '#c00', padding: '0.75rem', borderRadius: '0.25rem', marginBottom: '1rem' }}>
          {uploadError}
        </div>
      )}

      {/* ── PARAMS ── */}
      <section style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem',
        marginBottom: '1.5rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '0.5rem',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
          Durée (s)
          <input type="number" min={1} max={20} step={0.5} value={durationSec}
            onChange={e => setDurationSec(parseFloat(e.target.value))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
          Inference steps
          <input type="number" min={5} max={50} step={1} value={inferenceSteps}
            onChange={e => setInferenceSteps(parseInt(e.target.value, 10))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
          FPS
          <input type="number" min={5} max={60} step={1} value={fps}
            onChange={e => setFps(parseInt(e.target.value, 10))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
          Seed (0 = random)
          <input type="number" min={0} step={1} value={seed}
            onChange={e => setSeed(parseInt(e.target.value, 10))} />
        </label>
      </section>

      {/* ── RUN ── */}
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
        Lancer Sonic
      </button>

      {/* ── PROGRESS / RESULT ── */}
      {status !== 'idle' && (
        <div style={{
          marginTop: '1.5rem', padding: '1rem',
          background: status === 'error' ? '#fee' : status === 'done' ? '#efe' : '#eef',
          borderRadius: '0.25rem',
        }}>
          <p style={{ margin: 0, fontWeight: 500 }}>{progressLabel}</p>
          {elapsedMs !== null && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#666' }}>
              Durée : {(elapsedMs / 1000).toFixed(1)}s
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
