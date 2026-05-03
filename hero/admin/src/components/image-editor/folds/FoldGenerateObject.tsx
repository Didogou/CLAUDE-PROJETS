'use client'
/**
 * Fold "Générer un objet" : génération IA one-shot d'un prop pour l'intégrer
 * à la scène sans passer par la fiche Item en DB.
 *
 * Flow :
 *   1. Prompt FR + negative (optionnels)
 *   2. Clic Générer → /api/translate-prompt puis /api/comfyui workflow 'background'
 *   3. Attente de la génération (~20-40s) avec polling
 *   4. Au succès : addItem({ item_id: `temp_${Date.now()}`, custom_url, custom_name })
 *      → l'objet apparaît au centre de l'image, draggable comme les items classiques
 *
 * Cohérent avec l'approche Pano360ObjectGen.tsx déjà existante mais intégré
 * à l'ImageEditor via le Context (addItem, pas de callback externe).
 */
import React, { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { CHECKPOINTS } from '@/lib/comfyui'
import { useEditorState } from '../EditorStateContext'

interface FoldGenerateObjectProps {
  storagePathPrefix: string
}

export default function FoldGenerateObject({ storagePathPrefix }: FoldGenerateObjectProps) {
  const { addItem } = useEditorState()
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const defaultCheckpoint = CHECKPOINTS.find(c => c.key === 'juggernaut')?.filename
    ?? CHECKPOINTS[0].filename

  async function handleGenerate() {
    const trimmed = prompt.trim()
    if (!trimmed) { setError('Décris l\'objet à générer.'); return }
    setError(null); setBusy(true); cancelledRef.current = false

    try {
      // 1. Traduction FR→EN
      setProgress('Traduction FR → EN…')
      let promptEn = trimmed
      let negativeExtra = ''
      try {
        const tr = await fetch('/api/translate-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt_fr: trimmed }),
        })
        if (tr.ok) {
          const td = await tr.json()
          if (td.prompt_en) promptEn = td.prompt_en
          if (td.negative_prompt) negativeExtra = `, ${td.negative_prompt}`
        }
      } catch { /* fallback silencieux */ }

      if (cancelledRef.current) return

      // 2. Envoi workflow background (SDXL isolated object)
      setProgress('Envoi ComfyUI…')
      const res = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'background',
          prompt_positive: `${promptEn}, single isolated object centered, neutral background`,
          prompt_negative: `people, person, human, character, face, hands, figure, crowd, landscape scene${negativeExtra}`,
          style: 'realistic',
          width: 1024, height: 1024,
          steps: 30, cfg: 7, seed: -1,
          checkpoint: defaultCheckpoint,
        }),
      })
      const d = await res.json()
      if (!d.prompt_id) throw new Error(d.error || 'Échec envoi workflow')

      // 3. Polling
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
          const name = trimmed.slice(0, 40).replace(/[,.].*$/, '').trim() || 'Objet'

          // 4. Ajoute au compositing via le Context (addItem avec custom_url)
          addItem({
            item_id: `temp_${Date.now()}`,
            theta: 180, phi: -10,
            scale: 0.5,
            custom_url: cleanUrl,
            custom_name: name,
          })
          setPrompt('')
          setProgress('')
          return
        }
        if (pd.status === 'failed') throw new Error(pd.error || 'Workflow échoué')
      }
      throw new Error('Timeout (3 min)')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  function handleCancel() {
    cancelledRef.current = true
    setBusy(false); setProgress('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-3)' }}>
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="ex: un brasero rouillé avec flammes, une caisse en bois, un néon rouge cassé au sol…"
        rows={3}
        disabled={busy}
        style={{
          width: '100%', padding: 'var(--ie-space-2) var(--ie-space-3)',
          background: 'var(--ie-surface)', border: '1px solid var(--ie-border-strong)',
          borderRadius: 'var(--ie-radius)', fontSize: 'var(--ie-text-sm)',
          fontFamily: 'inherit', color: 'var(--ie-text)', outline: 'none', resize: 'vertical',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--ie-accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--ie-accent-faint)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--ie-border-strong)'; e.currentTarget.style.boxShadow = 'none' }}
      />

      {busy ? (
        <div style={{ display: 'flex', gap: 'var(--ie-space-2)' }}>
          <motion.button
            onClick={handleCancel}
            whileTap={{ scale: 0.96 }}
            style={{
              padding: '8px 12px', borderRadius: 'var(--ie-radius)',
              border: '1px solid var(--ie-border-strong)', background: 'var(--ie-surface)',
              color: 'var(--ie-text-muted)', fontSize: 'var(--ie-text-sm)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <X size={13} /> Annuler
          </motion.button>
          <div style={{
            flex: 1, padding: '8px 12px',
            background: 'var(--ie-accent-faint)', color: 'var(--ie-accent-dark)',
            borderRadius: 'var(--ie-radius)', fontSize: 'var(--ie-text-sm)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            ⏳ {progress}
          </div>
        </div>
      ) : (
        <motion.button
          onClick={() => void handleGenerate()}
          disabled={!prompt.trim()}
          whileHover={prompt.trim() ? { scale: 1.01, boxShadow: 'var(--ie-shadow)' } : undefined}
          whileTap={prompt.trim() ? { scale: 0.98 } : undefined}
          style={{
            padding: '10px 14px',
            background: prompt.trim() ? 'var(--ie-accent)' : 'var(--ie-surface-3)',
            color: prompt.trim() ? 'var(--ie-accent-text-on)' : 'var(--ie-text-faint)',
            border: 'none', borderRadius: 'var(--ie-radius)',
            fontSize: 'var(--ie-text-sm)', fontWeight: 600,
            cursor: prompt.trim() ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <Sparkles size={14} /> Générer
        </motion.button>
      )}

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              padding: 'var(--ie-space-2) var(--ie-space-3)',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid var(--ie-danger)',
              borderRadius: 'var(--ie-radius)',
              color: 'var(--ie-danger)',
              fontSize: 'var(--ie-text-sm)',
            }}
          >
            ⚠ {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{
        fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-faint)',
        lineHeight: 1.4, fontStyle: 'italic',
      }}>
        Prop one-shot non enregistré en DB. Pour réutiliser ailleurs, crée une fiche Objet dans la section.
      </div>
    </div>
  )
}
