'use client'
/**
 * Sous-wizard "Dérivations" du PlanWizard.
 *
 * Génère N frames subtilement variées à partir de l'image principale du plan.
 * Utilisé pour des animations frame-by-frame (flipbook, ~10 fps typiquement).
 *
 * Flow :
 *   1. Stage 'config' : count (défaut 20), denoise (0.4), checkpoint
 *   2. Stage 'generating' : progression live (frames apparaissent un par un)
 *   3. Stage 'review' : strip de frames + mini-player de preview + validation
 *
 * Logique de génération entièrement déléguée à generateDerivations (helper pur).
 */
import React, { useEffect, useRef, useState } from 'react'
import type { PlanWizardState } from '../types'
import { CHECKPOINTS } from '@/lib/comfyui'
import { generateDerivations } from '../helpers/generateDerivations'

export interface SubDerivationsProps {
  state: PlanWizardState
  /** Validation : renvoie l'array ordonné d'URLs (pour comfyui_settings.derivations). */
  onCompleted: (urls: string[]) => void
  onCancel: () => void
}

type Stage = 'config' | 'generating' | 'review'
type FrameState = { status: 'pending' | 'generating' | 'done' | 'error'; url?: string; error?: string }

export default function SubDerivations({ state, onCompleted, onCancel }: SubDerivationsProps) {
  const img = state.selectedImage
  const [stage, setStage] = useState<Stage>('config')
  const [count, setCount] = useState(20)
  const [denoise, setDenoise] = useState(0.4)
  const [frames, setFrames] = useState<FrameState[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keptIdx, setKeptIdx] = useState<Set<number>>(new Set())
  /** Index de l'animation en preview (flipbook player). */
  const [playing, setPlaying] = useState(false)
  const [previewIdx, setPreviewIdx] = useState(0)
  const playTimer = useRef<number | null>(null)

  const checkpoint = state.selectedImage?.checkpointKey
    ? (CHECKPOINTS.find(c => c.key === state.selectedImage!.checkpointKey) ?? CHECKPOINTS[0])
    : CHECKPOINTS[0]

  // ── Flipbook player ─────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) { if (playTimer.current) { clearInterval(playTimer.current); playTimer.current = null }; return }
    const keptUrls = [...keptIdx].sort((a, b) => a - b).map(i => frames[i]?.url).filter((u): u is string => !!u)
    if (keptUrls.length === 0) { setPlaying(false); return }
    playTimer.current = window.setInterval(() => {
      setPreviewIdx(prev => (prev + 1) % keptUrls.length)
    }, 1000 / 10) // 10 fps par défaut
    return () => { if (playTimer.current) { clearInterval(playTimer.current); playTimer.current = null } }
  }, [playing, keptIdx, frames])

  if (!img) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Pas d&apos;image principale — retour au dashboard.</div>
  }

  // ── Lancement ───────────────────────────────────────────────────────
  async function handleLaunch() {
    if (!img) return
    setError(null); setRunning(true); setStage('generating')
    const initial: FrameState[] = Array.from({ length: count }, () => ({ status: 'pending' }))
    setFrames(initial)
    setKeptIdx(new Set())
    try {
      await generateDerivations({
        sourceUrl: img.url,
        basePrompt: state.params.prompt,
        promptNegative: state.params.promptNegative,
        style: state.params.style,
        checkpoint: checkpoint.filename,
        count, denoise,
        steps: state.params.steps,
        cfg: state.params.cfg,
        storagePathPrefix: `${state.params.storagePathPrefix}_derivations`,
        onProgress: (frameIndex, _total, urlOrError, isError) => {
          setFrames(prev => {
            const next = [...prev]
            next[frameIndex] = isError
              ? { status: 'error', error: urlOrError ?? 'erreur' }
              : { status: 'done', url: urlOrError ?? undefined }
            return next
          })
          // Auto-coche par défaut les frames réussies (user décoche les mauvaises)
          if (!isError && urlOrError) {
            setKeptIdx(prev => new Set(prev).add(frameIndex))
          }
        },
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
      setStage('review')
    }
  }

  function toggleFrame(i: number) {
    setKeptIdx(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  function handleValidate() {
    const ordered = [...keptIdx].sort((a, b) => a - b).map(i => frames[i]?.url).filter((u): u is string => !!u)
    if (ordered.length === 0) { setError('Sélectionne au moins 1 frame à garder.'); return }
    onCompleted(ordered)
  }

  const doneCount = frames.filter(f => f.status === 'done').length
  const errCount = frames.filter(f => f.status === 'error').length
  const keptUrls = [...keptIdx].sort((a, b) => a - b).map(i => frames[i]?.url).filter((u): u is string => !!u)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
        <span style={{ color: '#64b5f6', fontWeight: 'bold', fontSize: '0.95rem' }}>🔄 Sous-wizard — Dérivations (frame-by-frame)</span>
        <button onClick={onCancel} disabled={running} style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: running ? 'wait' : 'pointer' }}>← Retour dashboard</button>
      </div>

      {/* Stage CONFIG */}
      {stage === 'config' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 2fr', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>Image source (frame de référence)</div>
            <img src={img.url} alt="source" style={{ width: '100%', height: 'auto', borderRadius: '6px', border: '1px solid var(--border)' }} />
          </div>
          <div style={{ background: 'var(--surface-2)', borderRadius: '6px', padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--foreground)', fontWeight: 'bold' }}>Configuration des dérivations</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
              Nombre de frames : <strong style={{ color: 'var(--accent)' }}>{count}</strong>
              <input type="range" min={6} max={40} step={1} value={count} onChange={e => setCount(Number(e.target.value))} style={{ width: '100%' }} />
              <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>20 = défaut (~2 s à 10 fps). Plus = séquence plus longue mais génération lente.</span>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
              Denoise (intensité des variations) : <strong style={{ color: 'var(--accent)' }}>{denoise.toFixed(2)}</strong>
              <input type="range" min={0.2} max={0.8} step={0.05} value={denoise} onChange={e => setDenoise(Number(e.target.value))} style={{ width: '100%' }} />
              <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>0.2 = très subtil (presque identique) · 0.4 = équilibré · 0.8 = très différent entre frames</span>
            </label>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Checkpoint : <code>{checkpoint.label}</code></div>
            {error && <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px' }}>⚠ {error}</div>}
            <button onClick={() => void handleLaunch()} style={{ alignSelf: 'flex-start', background: '#64b5f6', border: 'none', borderRadius: '4px', padding: '0.5rem 1.2rem', color: '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}>
              ▶ Lancer la génération de {count} frames (~{Math.round(count * 0.5)}-{Math.round(count * 1)} min)
            </button>
          </div>
        </div>
      )}

      {/* Stage GENERATING & REVIEW partagent la grille des frames */}
      {(stage === 'generating' || stage === 'review') && (
        <>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            {stage === 'generating'
              ? `⏳ Génération en cours : ${doneCount}/${count}${errCount > 0 ? ` · ${errCount} erreur${errCount > 1 ? 's' : ''}` : ''}`
              : `✓ Terminé : ${doneCount}/${count} frames générées${errCount > 0 ? ` · ${errCount} erreur${errCount > 1 ? 's' : ''}` : ''} · ${keptIdx.size} conservée${keptIdx.size > 1 ? 's' : ''}`}
          </div>

          {error && <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px' }}>⚠ {error}</div>}

          {/* Mini-player flipbook (visible seulement en review avec au moins 2 frames gardées) */}
          {stage === 'review' && keptUrls.length >= 2 && (
            <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start', background: 'var(--surface-2)', borderRadius: '6px', padding: '0.6rem' }}>
              <div style={{ flex: '0 0 auto' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Aperçu animation (10 fps)</div>
                <div style={{ width: 220, aspectRatio: state.params.aspectRatio === '1:1' ? '1' : state.params.aspectRatio === '9:16' ? '9/16' : '16/9', background: '#000', borderRadius: '4px', overflow: 'hidden' }}>
                  <img src={keptUrls[previewIdx % keptUrls.length]} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <button onClick={() => setPlaying(p => !p)} style={{ marginTop: '0.4rem', fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: playing ? 'var(--accent)' : 'var(--surface-2)', color: playing ? '#0f0f14' : 'var(--muted)', fontWeight: playing ? 'bold' : 'normal', cursor: 'pointer' }}>
                  {playing ? '⏸ Pause' : '▶ Lecture'}
                </button>
                <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>Frame {(previewIdx % keptUrls.length) + 1}/{keptUrls.length}</div>
              </div>
              <div style={{ flex: 1, fontSize: '0.65rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                Décoche les frames ratées dans la grille pour les exclure de l&apos;animation finale. L&apos;ordre des frames est conservé.
              </div>
            </div>
          )}

          {/* Grille frames */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '0.4rem' }}>
            {frames.map((f, i) => {
              const isKept = keptIdx.has(i)
              const borderColor = f.status === 'done' ? (isKept ? '#64b5f6' : 'var(--border)')
                : f.status === 'error' ? '#c94c4c'
                : f.status === 'generating' ? '#f0a742'
                : 'var(--border)'
              return (
                <div key={i}
                  onClick={() => f.status === 'done' && toggleFrame(i)}
                  style={{ border: `2px solid ${borderColor}`, borderRadius: '4px', overflow: 'hidden', cursor: f.status === 'done' ? 'pointer' : 'default', position: 'relative', aspectRatio: state.params.aspectRatio === '1:1' ? '1' : state.params.aspectRatio === '9:16' ? '9/16' : '16/9', background: '#000', opacity: f.status === 'done' && !isKept ? 0.4 : 1 }}
                  title={f.status === 'error' ? `Frame ${i + 1} : ${f.error}` : `Frame ${i + 1}`}
                >
                  {f.url ? (
                    <img src={f.url} alt={`frame ${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: 'var(--muted)' }}>
                      {f.status === 'generating' ? '⏳' : f.status === 'error' ? '✕' : '⏸'}
                    </div>
                  )}
                  <div style={{ position: 'absolute', top: 2, left: 2, fontSize: '0.5rem', padding: '1px 4px', borderRadius: '2px', background: 'rgba(0,0,0,0.6)', color: 'white' }}>{i + 1}</div>
                  {f.status === 'done' && (
                    <div style={{ position: 'absolute', bottom: 2, right: 2, fontSize: '0.55rem', padding: '1px 3px', borderRadius: '2px', background: isKept ? '#64b5f6' : 'rgba(0,0,0,0.6)', color: isKept ? '#0f0f14' : 'white', fontWeight: 'bold' }}>{isKept ? '✓' : '○'}</div>
                  )}
                </div>
              )
            })}
          </div>

          {stage === 'review' && (
            <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setStage('config')} disabled={running} style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer' }}>
                ← Relancer (nouvelle config)
              </button>
              <button onClick={() => setKeptIdx(new Set(frames.map((f, i) => f.status === 'done' ? i : -1).filter(i => i >= 0)))} style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
                Tout cocher
              </button>
              <button onClick={() => setKeptIdx(new Set())} style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
                Tout décocher
              </button>
              <button onClick={handleValidate} disabled={keptIdx.size === 0} style={{ marginLeft: 'auto', background: '#64b5f6', border: 'none', borderRadius: '4px', padding: '0.5rem 1.2rem', color: '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: keptIdx.size === 0 ? 'not-allowed' : 'pointer', opacity: keptIdx.size === 0 ? 0.5 : 1 }}>
                ✓ Valider {keptIdx.size} frame{keptIdx.size > 1 ? 's' : ''}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
