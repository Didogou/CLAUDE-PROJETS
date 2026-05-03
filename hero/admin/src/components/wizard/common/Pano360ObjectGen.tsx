'use client'
/**
 * Générateur d'objets IA intégré au Pano360Composer.
 *
 * Permet de produire rapidement un "prop" one-shot (brasero, poubelle, caisse,
 * graffiti, etc.) et de le rendre immédiatement placeable sur la scène 360°
 * SANS passer par la fiche Objet en DB.
 *
 * Workflow :
 *   1. Utilisateur saisit un prompt court (ex: "un brasero rouillé avec flammes")
 *   2. Appel /api/comfyui avec workflow_type='background' + "no people" forcé
 *   3. Polling prompt_id → récupère l'image finale stockée Supabase
 *   4. Appel onGenerated(url, name) → le parent ajoute à sa liste tempItems
 *
 * L'objet généré n'est PAS sauvegardé comme Item en DB. Il vit dans la
 * composition via `SceneItemPlacement.custom_url` (prioritaire sur lookup Item).
 * Si l'utilisateur veut le réutiliser ailleurs, il passera par la fiche Objet
 * classique (pas le scope de ce composant).
 */
import React, { useRef, useState } from 'react'
import { CHECKPOINTS } from '@/lib/comfyui'

export interface Pano360ObjectGenProps {
  /** Préfixe de storage Supabase (pour l'image générée). */
  storagePathPrefix: string
  /** Callback appelé quand un objet a été généré avec succès. */
  onGenerated: (url: string, name: string) => void
  /** Checkpoint SDXL à utiliser (défaut : juggernaut). */
  defaultCheckpoint?: string
  /** Style d'image (défaut : realistic). */
  style?: string
}

export default function Pano360ObjectGen({ storagePathPrefix, onGenerated, defaultCheckpoint, style }: Pano360ObjectGenProps) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')
  const cancelledRef = useRef(false)

  const checkpointFilename = (() => {
    const key = defaultCheckpoint ?? 'juggernaut'
    return CHECKPOINTS.find(c => c.key === key || c.filename === key)?.filename
      ?? CHECKPOINTS[0].filename
  })()

  async function handleGenerate() {
    const trimmed = prompt.trim()
    if (!trimmed) { setError('Décris l\'objet à générer.'); return }
    setError(null); setBusy(true); cancelledRef.current = false
    try {
      // 1. Traduction FR→EN optimisée SDXL (sinon Juggernaut hallucine sur des mots français)
      setProgress('Traduction prompt FR→EN…')
      let promptEn = trimmed
      let negativeExtra = ''
      try {
        const trRes = await fetch('/api/translate-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt_fr: trimmed }),
        })
        if (trRes.ok) {
          const td = await trRes.json()
          if (td.prompt_en) promptEn = td.prompt_en
          if (td.negative_prompt) negativeExtra = `, ${td.negative_prompt}`
        } else {
          console.warn('[ObjectGen] translate-prompt failed, fallback prompt brut')
        }
      } catch (err) {
        console.warn('[ObjectGen] translate-prompt error, fallback:', err)
      }

      // 2. Génération : on ajoute juste "isolated single object on neutral background"
      //    Plus léger que "product photography" qui biaisait vers la photo produit
      setProgress('Envoi à ComfyUI…')
      const body = {
        workflow_type: 'background' as const,
        prompt_positive: `${promptEn}, single isolated object centered, neutral background`,
        prompt_negative: `people, person, human, character, face, hands, figure, crowd, multiple objects, landscape scene${negativeExtra}`,
        style: style ?? 'realistic',
        width: 1024,
        height: 1024,
        steps: 30,
        cfg: 7,
        seed: -1,
        checkpoint: checkpointFilename,
      }
      const res = await fetch('/api/comfyui', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (!d.prompt_id) throw new Error(d.error || 'Échec envoi workflow')

      setProgress('Génération (~20-40s)…')
      const startT = Date.now()
      const MAX_WAIT = 3 * 60 * 1000
      while (Date.now() - startT < MAX_WAIT) {
        if (cancelledRef.current) return
        await new Promise(r => setTimeout(r, 2500))
        const poll = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}`)
        const pd = await poll.json()
        if (pd.status === 'succeeded') {
          const storagePath = `${storagePathPrefix}_obj_${Date.now()}`
          const imgRes = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`)
          const imgData = await imgRes.json()
          if (!imgData.image_url) throw new Error('Pas d\'URL finale')
          const cleanUrl = imgData.image_url.split('?')[0]
          // Nom court : 1ers mots du prompt (max 40 chars)
          const shortName = trimmed.slice(0, 40).replace(/[,.].*$/, '').trim() || 'Objet'
          onGenerated(cleanUrl, shortName)
          setPrompt('')
          setProgress('')
          return
        }
        if (pd.status === 'failed') throw new Error(pd.error || 'Workflow échoué')
      }
      throw new Error('Timeout (3 min)')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  function handleCancel() {
    cancelledRef.current = true
    setBusy(false)
    setProgress('')
  }

  return (
    <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'var(--surface-2)', borderRadius: '4px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0.4rem', background: 'transparent', border: 'none', color: 'var(--foreground)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold' }}>
        <span>✨ Générer un objet IA</span>
        <span style={{ opacity: 0.5, fontSize: '0.6rem' }}>{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="ex: un brasero rouillé avec flammes, une poubelle en métal renversée, un graffiti sur mur de brique"
            rows={2}
            disabled={busy}
            style={{ fontSize: '0.62rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem', color: 'var(--foreground)', fontFamily: 'inherit', resize: 'vertical' }}
          />

          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {busy ? (
              <>
                <button onClick={handleCancel}
                  style={{ flex: 1, fontSize: '0.62rem', padding: '0.35rem', borderRadius: '3px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer' }}>
                  ✕ Annuler
                </button>
                <div style={{ flex: 2, fontSize: '0.58rem', color: '#e0a742', padding: '0.35rem', textAlign: 'center', background: 'rgba(224,167,66,0.08)', borderRadius: '3px' }}>
                  ⏳ {progress}
                </div>
              </>
            ) : (
              <button onClick={() => void handleGenerate()} disabled={!prompt.trim()}
                style={{ width: '100%', fontSize: '0.65rem', padding: '0.4rem', borderRadius: '3px', border: 'none', background: prompt.trim() ? '#e0a742' : 'var(--surface)', color: prompt.trim() ? '#0f0f14' : 'var(--muted)', cursor: prompt.trim() ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}>
                🎨 Générer
              </button>
            )}
          </div>

          {error && (
            <div style={{ fontSize: '0.6rem', color: '#c94c4c', padding: '0.3rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '3px' }}>
              ⚠ {error}
            </div>
          )}

          <div style={{ fontSize: '0.55rem', color: 'var(--muted)', opacity: 0.65, lineHeight: 1.4 }}>
            Objet non sauvé en DB — vit uniquement dans cette scène. Pour réutiliser ailleurs, crée une fiche Objet.
          </div>
        </>
      )}
    </div>
  )
}
