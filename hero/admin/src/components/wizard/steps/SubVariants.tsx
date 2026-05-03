'use client'
/**
 * Sous-wizard "Variantes" du PlanWizard.
 *
 * Génère N variantes de l'image principale (même scène, différents seeds et
 * optionnellement différents checkpoints/styles). L'utilisateur multi-sélectionne
 * celles à garder ; les autres sont retournées dans `discarded` pour cleanup.
 *
 * Utilise <GenerateAndSelectBatch> comme UI principale + une barre de config
 * en haut (nombre, répartition modèles, prompt overlay).
 */
import React, { useState } from 'react'
import { CHECKPOINTS } from '@/lib/comfyui'
import type { PlanWizardState } from '../types'
import GenerateAndSelectBatch from '../common/GenerateAndSelectBatch'
import { FRAMING_OPTIONS, POV_OPTIONS, composePromptWithCamera, composeNegativeForCamera } from '../common/cameraOptions'

export interface SubVariantsProps {
  state: PlanWizardState
  /** Validation : renvoie URLs gardées + URLs à supprimer (cleanup caller). */
  onCompleted: (kept: string[], discarded: string[]) => void
  /** Annulation : retour au dashboard, toutes URLs générées vont au cleanup. */
  onCancel: () => void
}

export default function SubVariants({ state, onCompleted, onCancel }: SubVariantsProps) {
  const [count, setCount] = useState(6)
  const [mode, setMode] = useState<'same_model' | 'all_models'>('same_model')
  const [framing, setFraming] = useState<string>('')   // clé FRAMING_OPTIONS
  const [pov, setPov] = useState<string>('')           // clé POV_OPTIONS
  const [forceCamera, setForceCamera] = useState(false)
  const [promptAddon, setPromptAddon] = useState('')
  const [refStrength, setRefStrength] = useState(0.65) // force IPAdapter Plus (couleurs/habits)
  const [uploadedRef, setUploadedRef] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const img = state.selectedImage
  const basePrompt = state.params.prompt
  const baseCheckpoint = img?.checkpointKey

  // Upload l'image de base vers ComfyUI une seule fois, puis passe à l'écran de génération.
  async function handleLaunch() {
    if (!img) return
    setUploadError(null)
    setUploading(true)
    try {
      const r = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: img.url, name: 'variant_ref' }),
      })
      const d = await r.json()
      if (!d.filename) throw new Error(d.error || 'Upload échoué')
      setUploadedRef(d.filename)
      setStarted(true)
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  // Modèles répartis selon le mode :
  //   - 'same_model' : tous les N utilisent le checkpoint de l'image sélectionnée
  //   - 'all_models' : répartition round-robin sur les 6 checkpoints
  const modelKeysForIndex = (i: number): string => {
    if (mode === 'same_model') return baseCheckpoint || CHECKPOINTS[0].key
    return CHECKPOINTS[i % CHECKPOINTS.length].key
  }

  const labels: string[] = Array.from({ length: count }, (_, i) => {
    const k = modelKeysForIndex(i)
    const c = CHECKPOINTS.find(cc => cc.key === k)
    return `#${i + 1} · ${c?.label ?? k}`
  })

  async function generateOne(i: number): Promise<string | null> {
    const ckptKey = modelKeysForIndex(i)
    const ckpt = CHECKPOINTS.find(c => c.key === ckptKey) ?? CHECKPOINTS[0]
    const dims: [number, number] = state.params.aspectRatio === '1:1' ? [1024, 1024] : state.params.aspectRatio === '9:16' ? [768, 1360] : [1360, 768]

    let effPrompt = composePromptWithCamera(basePrompt, framing, pov, promptAddon, forceCamera)
    const negativeAddition = composeNegativeForCamera(framing, pov, forceCamera)
    const effNegative = negativeAddition
      ? `${state.params.promptNegative}, ${negativeAddition}`
      : state.params.promptNegative
    // Pony auto-traduction
    if (ckptKey === 'pony_xl_v6') {
      try {
        const r = await fetch('/api/translate-to-pony-tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: effPrompt }) })
        const d = await r.json()
        if (d.tags) effPrompt = d.tags
      } catch {}
    }

    // Workflow scene_composition utilisé pour appliquer IPAdapter Plus sur l'image
    // de base → transfère les couleurs/habits/lumière vers les variantes tout en
    // laissant la composition varier (seed + éventuels ajouts de prompt).
    const res = await fetch('/api/comfyui', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      workflow_type: uploadedRef ? 'scene_composition' : 'background',
      prompt_positive: effPrompt,
      prompt_negative: effNegative,
      style: state.params.style,
      width: dims[0], height: dims[1],
      steps: state.params.steps ?? 35, cfg: state.params.cfg ?? 7, seed: -1,
      checkpoint: ckpt.filename,
      // Référence IPAdapter Plus (couleurs/habits) si upload ok. Pas de background_image
      // ni characters → scene_composition dégénère en "SDXL + IPAdapter Plus seul".
      ...(uploadedRef ? { style_reference_image: uploadedRef, style_reference_weight: refStrength } : {}),
    }) })
    const d = await res.json()
    if (!d.prompt_id) throw new Error(d.error || 'Erreur ComfyUI')

    const startT = Date.now()
    const MAX_WAIT = 5 * 60 * 1000
    while (Date.now() - startT < MAX_WAIT) {
      await new Promise(r => setTimeout(r, 3000))
      const poll = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}`)
      const pd = await poll.json()
      if (pd.status === 'succeeded') {
        const storagePath = `${state.params.storagePathPrefix}/variant_${i}_${ckptKey}_${Date.now()}`
        const imgRes = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`)
        const imgData = await imgRes.json()
        if (imgData.image_url) return imgData.image_url.split('?')[0]
        return null
      }
      if (pd.status === 'failed') throw new Error(pd.error || 'Échoué')
    }
    throw new Error('Timeout 5 min')
  }

  if (!img) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Pas d'image principale — retour au dashboard.</div>
  }

  // Écran de configuration (avant lancement)
  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <span style={{ color: '#b48edd', fontWeight: 'bold', fontSize: '0.95rem' }}>🎲 Sous-wizard — Variantes</span>
          <button onClick={onCancel} style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer' }}>← Retour dashboard</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 2fr', gap: '1rem' }}>
          {/* Preview image principale */}
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>Image de base</div>
            <img src={img.url} alt="base" style={{ width: '100%', height: 'auto', borderRadius: '6px', border: '1px solid var(--border)' }} />
          </div>

          {/* Config */}
          <div style={{ background: 'var(--surface-2)', borderRadius: '6px', padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--foreground)', fontWeight: 'bold' }}>Configuration des variantes</div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
              Nombre de variantes
              <input type="number" min={1} max={12} value={count} onChange={e => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                style={{ width: 60, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.2rem 0.4rem', color: 'var(--foreground)', fontSize: '0.7rem' }} />
            </label>

            <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Répartition des modèles</div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: `1px solid ${mode === 'same_model' ? 'var(--accent)' : 'var(--border)'}`, background: mode === 'same_model' ? 'rgba(212,168,76,0.1)' : 'transparent', cursor: 'pointer', color: mode === 'same_model' ? 'var(--accent)' : 'var(--muted)' }}>
                <input type="radio" checked={mode === 'same_model'} onChange={() => setMode('same_model')} />
                Même modèle ({CHECKPOINTS.find(c => c.key === baseCheckpoint)?.label ?? baseCheckpoint})
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: `1px solid ${mode === 'all_models' ? 'var(--accent)' : 'var(--border)'}`, background: mode === 'all_models' ? 'rgba(212,168,76,0.1)' : 'transparent', cursor: 'pointer', color: mode === 'all_models' ? 'var(--accent)' : 'var(--muted)' }}>
                <input type="radio" checked={mode === 'all_models'} onChange={() => setMode('all_models')} />
                Tous les modèles (round-robin)
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.7rem', color: 'var(--muted)', flex: '1 1 180px' }}>
                Cadrage
                <select value={framing} onChange={e => setFraming(e.target.value)} style={{ fontSize: '0.7rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem 0.4rem', color: 'var(--foreground)' }}>
                  {FRAMING_OPTIONS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.7rem', color: 'var(--muted)', flex: '1 1 180px' }}>
                Angle
                <select value={pov} onChange={e => setPov(e.target.value)} style={{ fontSize: '0.7rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem 0.4rem', color: 'var(--foreground)' }}>
                  {POV_OPTIONS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </label>
              <label
                title="Pondère les tags caméra à :1.4, les met en tête et ajoute des anti-tags dans le negative. Utile quand SDXL ignore les angles."
                style={{ fontSize: '0.7rem', color: forceCamera ? 'var(--accent)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', alignSelf: 'flex-end', paddingBottom: '0.35rem', cursor: (!framing && !pov) ? 'not-allowed' : 'pointer', opacity: (!framing && !pov) ? 0.5 : 1 }}>
                <input type="checkbox" checked={forceCamera} onChange={e => setForceCamera(e.target.checked)} disabled={!framing && !pov} />
                🔒 Forcer
              </label>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
              Ajout libre au prompt (ex: "rain", "neon lights", "over a rooftop")
              <input type="text" value={promptAddon} onChange={e => setPromptAddon(e.target.value)} placeholder="laisse vide pour juste varier le seed"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem 0.5rem', color: 'var(--foreground)', fontSize: '0.7rem' }} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
              <span>
                Force de la référence (couleurs / habits / style) : <strong style={{ color: 'var(--accent)' }}>{refStrength.toFixed(2)}</strong>
              </span>
              <input type="range" min={0} max={1} step={0.05} value={refStrength} onChange={e => setRefStrength(Number(e.target.value))} style={{ width: '100%' }} />
              <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>
                0 = variantes libres · 0.65 = bon compromis · 1 = colle fort à l'image de base (peut figer la compo)
              </span>
            </label>

            {uploadError && (
              <div style={{ fontSize: '0.65rem', color: '#c94c4c', padding: '0.3rem 0.5rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px' }}>
                ⚠ Upload de l'image de référence échoué : {uploadError}. Les variantes seront générées sans référence IPAdapter.
              </div>
            )}

            <button onClick={() => void handleLaunch()} disabled={uploading} style={{ alignSelf: 'flex-start', background: 'var(--accent)', border: 'none', borderRadius: '4px', padding: '0.5rem 1.2rem', color: '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
              {uploading ? '⏳ Upload référence…' : `▶ Lancer la génération de ${count} variante${count > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Écran de génération (batch)
  return (
    <GenerateAndSelectBatch
      count={count}
      labels={labels}
      aspectRatio={state.params.aspectRatio === '1:1' ? '1' : state.params.aspectRatio === '9:16' ? '9/16' : '16/9'}
      generateOne={generateOne}
      title="🎲 Variantes — coche celles à garder"
      onCompleted={onCompleted}
      onCancel={onCancel}
    />
  )
}
