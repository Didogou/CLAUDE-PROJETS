'use client'
/**
 * Step 1 du PlanWizard : comparaison de modèles + sélection image.
 *
 * Reprend la logique du ImageGenerationWizard (multi-modèles SDXL, auto-traduction
 * Pony, édition prompt/style, regénération) mais adaptée au contexte du wizard.
 *
 * Affichage :
 *   - Si params.existingImage est fourni → affichée en haut (option "garder celle-ci")
 *   - Grille des 6 checkpoints (checkbox multi-sélection)
 *   - Prompt + style éditables
 *   - Bouton Regénérer
 *
 * Sortie :
 *   - onImageSelected(url, checkpointKey) → Step 2 (dashboard) ou fermeture
 */
import React, { useEffect, useRef, useState } from 'react'
import { CHECKPOINTS } from '@/lib/comfyui'
import type { PlanWizardOpenParams } from '../types'
import { FRAMING_OPTIONS, POV_OPTIONS, composePromptWithCamera, composeNegativeForCamera } from '../common/cameraOptions'

interface GenResult {
  status: 'pending' | 'translating' | 'generating' | 'done' | 'error'
  url?: string
  error?: string
  promptUsed?: string
}

export interface Step1ImageProps {
  params: PlanWizardOpenParams
  /** Déclenché quand l'utilisateur valide une image. */
  onImageSelected: (url: string, checkpointKey: string, discardedUrls: string[]) => void
  /** Déclenché au clic Fermer / clic extérieur. */
  onClose: () => void
}

export default function Step1Image({ params, onImageSelected, onClose }: Step1ImageProps) {
  const [results, setResults] = useState<Record<string, GenResult>>(
    Object.fromEntries(CHECKPOINTS.map(c => [c.key, { status: 'pending' as const }])),
  )
  const [running, setRunning] = useState(false)
  const cancelledRef = useRef(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>(CHECKPOINTS.map(c => c.key))
  const [localPrompt, setLocalPrompt] = useState(params.prompt)
  const [localStyle, setLocalStyle] = useState(params.style)
  const [framing, setFraming] = useState<string>('')  // clé FRAMING_OPTIONS
  const [pov, setPov] = useState<string>('')          // clé POV_OPTIONS
  const [forceCamera, setForceCamera] = useState(false) // pondération + anti-tags
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null)

  // Pas de génération auto au mount : l'utilisateur déclenche manuellement via le
  // bouton "▶ Générer" pour éviter de gaspiller GPU time sur une config non voulue.
  useEffect(() => {
    return () => { cancelledRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function regenerate() {
    if (running) {
      cancelledRef.current = true
      try { await fetch('http://127.0.0.1:8188/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }) } catch {}
      try { await fetch('http://127.0.0.1:8188/interrupt', { method: 'POST' }) } catch {}
      await new Promise(r => setTimeout(r, 500))
    }
    if (selectedKeys.length === 0) return
    // Reset des modèles sélectionnés à pending (garde les autres intactes)
    setResults(prev => {
      const next = { ...prev }
      for (const k of selectedKeys) next[k] = { status: 'pending' as const }
      return next
    })
    cancelledRef.current = false
    void runSequence(selectedKeys, localPrompt, localStyle)
  }

  async function runSequence(keysToRun: string[], promptOverride: string, styleOverride: string) {
    setRunning(true)
    const dims: [number, number] = params.aspectRatio === '1:1' ? [1024, 1024] : params.aspectRatio === '9:16' ? [768, 1360] : [1360, 768]
    // Injection auto Cadrage + Angle dans le prompt (tags anglais).
    // Si forceCamera=true : tags en tête + pondération + anti-tags dans negative.
    const composedPrompt = composePromptWithCamera(promptOverride, framing, pov, undefined, forceCamera)
    const negativeAddition = composeNegativeForCamera(framing, pov, forceCamera)
    const composedNegative = negativeAddition
      ? `${params.promptNegative}, ${negativeAddition}`
      : params.promptNegative
    const updateResult = (key: string, patch: Partial<GenResult>) => {
      setResults(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
    }

    for (const ckpt of CHECKPOINTS.filter(c => keysToRun.includes(c.key))) {
      if (cancelledRef.current) break
      let promptToUse = composedPrompt

      if (ckpt.key === 'pony_xl_v6') {
        updateResult(ckpt.key, { status: 'translating' })
        try {
          const r = await fetch('/api/translate-to-pony-tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: composedPrompt }) })
          if (cancelledRef.current) break
          const d = await r.json()
          if (d.tags) promptToUse = d.tags
        } catch {}
      }
      if (cancelledRef.current) break

      updateResult(ckpt.key, { status: 'generating', promptUsed: promptToUse })

      try {
        const res = await fetch('/api/comfyui', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          workflow_type: 'background',
          prompt_positive: promptToUse,
          prompt_negative: composedNegative,
          style: styleOverride,
          width: dims[0], height: dims[1],
          steps: params.steps ?? 35, cfg: params.cfg ?? 7, seed: -1,
          checkpoint: ckpt.filename,
        }) })
        if (cancelledRef.current) break
        const d = await res.json()
        if (!d.prompt_id) {
          updateResult(ckpt.key, { status: 'error', error: d.error || 'Erreur ComfyUI' })
          continue
        }

        const startT = Date.now()
        const MAX_WAIT = 5 * 60 * 1000
        let done = false
        while (Date.now() - startT < MAX_WAIT) {
          if (cancelledRef.current) { done = true; break }
          await new Promise(r => setTimeout(r, 3000))
          if (cancelledRef.current) { done = true; break }
          const poll = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}`)
          if (cancelledRef.current) { done = true; break }
          const pd = await poll.json()
          if (pd.status === 'succeeded') {
            const storagePath = `${params.storagePathPrefix}_${ckpt.key}_${Date.now()}`
            const imgRes = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`)
            if (cancelledRef.current) { done = true; break }
            const imgData = await imgRes.json()
            if (imgData.image_url) {
              updateResult(ckpt.key, { status: 'done', url: imgData.image_url.split('?')[0] })
            }
            done = true
            break
          }
          if (pd.status === 'failed') {
            updateResult(ckpt.key, { status: 'error', error: pd.error || 'Échoué' })
            done = true
            break
          }
        }
        if (!done) updateResult(ckpt.key, { status: 'error', error: 'Timeout 5 min' })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        updateResult(ckpt.key, { status: 'error', error: msg })
      }
    }
    setRunning(false)
    if (cancelledRef.current) {
      try { await fetch('http://127.0.0.1:8188/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }) } catch {}
      try { await fetch('http://127.0.0.1:8188/interrupt', { method: 'POST' }) } catch {}
    }
  }

  // Sélectionne une image : construit la liste des URLs à nettoyer (toutes les autres + existante si non choisie)
  function handleSelect(checkpointKey: string, chosenUrl: string) {
    const discarded: string[] = []
    // Toutes les autres générations réussies
    for (const [k, r] of Object.entries(results)) {
      if (r.url && r.url !== chosenUrl) discarded.push(r.url)
    }
    // L'existante si elle n'est PAS celle choisie
    if (params.existingImage?.url && params.existingImage.url !== chosenUrl) {
      discarded.push(params.existingImage.url)
    }
    onImageSelected(chosenUrl, checkpointKey, discarded)
  }

  function handleKeepExisting() {
    if (!params.existingImage) return
    // Garde l'existante, nettoie toutes les générations
    const discarded: string[] = []
    for (const r of Object.values(results)) {
      if (r.url) discarded.push(r.url)
    }
    onImageSelected(params.existingImage.url, params.existingImage.checkpointKey || 'unknown', discarded)
  }

  const totalDone = Object.values(results).filter(r => r.status === 'done').length
  const totalErr = Object.values(results).filter(r => r.status === 'error').length
  const STYLES = ['realistic', 'photo', 'manga', 'comic', 'bnw', 'dark_fantasy', 'sketch']

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: '0.95rem' }}>🎨 Étape 1 — Image principale</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            {totalDone}/{selectedKeys.length} générés{totalErr > 0 ? ` · ${totalErr} erreur${totalErr > 1 ? 's' : ''}` : ''}{running ? ' · ⏳' : ''}
          </span>
          <button onClick={onClose} style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer' }}>Fermer</button>
        </div>

        {/* Image existante en haut, bouton "Garder celle-ci" */}
        {params.existingImage?.url && (
          <div style={{ border: '2px solid #7ab8d866', borderRadius: '6px', padding: '0.6rem', background: 'rgba(122,184,216,0.08)', display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
            <img src={params.existingImage.url} alt="existante" style={{ width: 120, height: 'auto', maxHeight: 90, objectFit: 'cover', borderRadius: '4px', cursor: 'zoom-in' }} onClick={() => setZoomedUrl(params.existingImage!.url)} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', color: '#7ab8d8', fontWeight: 'bold' }}>Image actuelle</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                Tu peux la conserver ou générer de nouvelles propositions ci-dessous.
              </div>
            </div>
            <button onClick={handleKeepExisting} style={{ background: '#7ab8d8', border: 'none', borderRadius: '4px', padding: '0.4rem 0.9rem', color: '#0f0f14', fontSize: '0.72rem', fontWeight: 'bold', cursor: 'pointer' }}>
              ↩ Garder celle-ci
            </button>
          </div>
        )}

        {/* Contrôles */}
        <div style={{ background: 'var(--surface-2)', borderRadius: '6px', padding: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.7rem', color: 'var(--foreground)' }}>Modèles à générer</strong>
            <button onClick={() => setSelectedKeys(CHECKPOINTS.map(c => c.key))} style={{ fontSize: '0.55rem', padding: '0.1rem 0.4rem', borderRadius: '3px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Tous</button>
            <button onClick={() => setSelectedKeys([])} style={{ fontSize: '0.55rem', padding: '0.1rem 0.4rem', borderRadius: '3px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Aucun</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {CHECKPOINTS.map(c => {
              const checked = selectedKeys.includes(c.key)
              return (
                <label key={c.key} title={c.hint} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.65rem', padding: '0.2rem 0.5rem', borderRadius: '4px', border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`, background: checked ? 'rgba(212,168,76,0.1)' : 'transparent', cursor: 'pointer', color: checked ? 'var(--accent)' : 'var(--muted)' }}>
                  <input type="checkbox" checked={checked} onChange={e => setSelectedKeys(prev => e.target.checked ? [...prev, c.key] : prev.filter(k => k !== c.key))} style={{ cursor: 'pointer' }} />
                  {c.label}
                </label>
              )
            })}
          </div>
          <textarea value={localPrompt} onChange={e => setLocalPrompt(e.target.value)} placeholder="Prompt EN" rows={3}
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.4rem 0.5rem', color: 'var(--foreground)', fontSize: '0.7rem', fontFamily: 'inherit', resize: 'vertical' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.65rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              Style
              <select value={localStyle} onChange={e => setLocalStyle(e.target.value)} style={{ fontSize: '0.65rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)' }}>
                {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.65rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              Cadrage
              <select value={framing} onChange={e => setFraming(e.target.value)} style={{ fontSize: '0.65rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)' }}>
                {FRAMING_OPTIONS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.65rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              Angle
              <select value={pov} onChange={e => setPov(e.target.value)} style={{ fontSize: '0.65rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.15rem 0.3rem', color: 'var(--foreground)' }}>
                {POV_OPTIONS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </label>
            <label
              title="Pondère les tags caméra à :1.4, les met en tête du prompt et ajoute des anti-tags dans le negative. Utile quand SDXL ignore les angles."
              style={{ fontSize: '0.65rem', color: forceCamera ? 'var(--accent)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: (!framing && !pov) ? 'not-allowed' : 'pointer', opacity: (!framing && !pov) ? 0.5 : 1 }}>
              <input type="checkbox" checked={forceCamera} onChange={e => setForceCamera(e.target.checked)} disabled={!framing && !pov} />
              🔒 Forcer
            </label>
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>Ratio : {params.aspectRatio}</span>
            <button onClick={() => void regenerate()} disabled={selectedKeys.length === 0}
              style={{ marginLeft: 'auto', background: 'var(--accent)', border: 'none', borderRadius: '4px', padding: '0.4rem 0.9rem', color: '#0f0f14', fontSize: '0.72rem', fontWeight: 'bold', cursor: selectedKeys.length === 0 ? 'not-allowed' : 'pointer', opacity: selectedKeys.length === 0 ? 0.5 : 1 }}>
              {running ? '🔄 Annuler + Regénérer' : (totalDone > 0 ? '🔄 Regénérer' : `▶ Générer (${selectedKeys.length})`)}
            </button>
          </div>
        </div>

        {/* Grille */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '0.8rem' }}>
          {CHECKPOINTS.filter(c => selectedKeys.includes(c.key) || results[c.key]?.url).map(ckpt => {
            const r = results[ckpt.key]
            const status = r?.status ?? 'pending'
            return (
              <div key={ckpt.key} style={{ border: `1px solid ${status === 'done' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '6px', padding: '0.5rem', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <strong style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>{ckpt.label}</strong>
                  {status === 'pending' && <span style={{ fontSize: '0.55rem', color: 'var(--muted)' }}>⏸</span>}
                  {status === 'translating' && <span style={{ fontSize: '0.55rem', color: '#7ab8d8' }}>🔄 Danbooru</span>}
                  {status === 'generating' && <span style={{ fontSize: '0.55rem', color: '#f0a742' }}>⏳</span>}
                  {status === 'done' && <span style={{ fontSize: '0.55rem', color: '#52c484' }}>✓</span>}
                  {status === 'error' && <span style={{ fontSize: '0.55rem', color: '#c94c4c' }}>✕</span>}
                </div>
                <div onClick={() => r?.url && setZoomedUrl(r.url)}
                  style={{ aspectRatio: params.aspectRatio === '1:1' ? '1' : params.aspectRatio === '9:16' ? '9/16' : '16/9', background: '#000', borderRadius: '4px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: r?.url ? 'zoom-in' : 'default' }}>
                  {r?.url ? <img src={r.url} alt={ckpt.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> :
                    status === 'error' ? <span style={{ fontSize: '0.6rem', color: '#c94c4c', textAlign: 'center', padding: '0.5rem' }}>{r?.error || 'Erreur'}</span> :
                    <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>{status === 'translating' ? '🔄 Traduction…' : status === 'generating' ? '⏳ Génération…' : '⏸'}</span>}
                </div>
                {r?.url && (
                  <button onClick={() => handleSelect(ckpt.key, r.url!)} style={{ background: 'var(--accent)', border: 'none', borderRadius: '4px', padding: '0.4rem 0.6rem', color: '#0f0f14', fontSize: '0.72rem', fontWeight: 'bold', cursor: 'pointer' }}>
                    ✓ Choisir celle-ci →
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {zoomedUrl && (
        <div onClick={() => setZoomedUrl(null)} style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#000000f5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: '2rem' }}>
          <img src={zoomedUrl} alt="zoom" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </>
  )
}
