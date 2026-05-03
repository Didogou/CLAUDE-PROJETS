'use client'
/**
 * Hook de génération d'image avec multi-modèles parallèle.
 *
 * Chaque modèle sélectionné lance sa propre génération en parallèle et les
 * résultats arrivent au fur et à mesure dans `status[]`. Une variante est
 * considérée "done" quand son URL finale est uploadée dans Supabase.
 *
 * Flow :
 *   1. Traduction FR→EN (une seule fois, partagée entre tous les modèles)
 *   2. Pour chaque modèle sélectionné : spawn une promesse indépendante
 *      - POST /api/comfyui (ou /api/comfyui/panorama360) avec le bon payload
 *      - Poll GET /api/comfyui?prompt_id=X toutes les 3s
 *      - À succeeded : fetch image URL finale + update status
 *      - À failed ou timeout : marque en erreur
 *   3. Les promesses sont indépendantes — si une plante, les autres continuent
 */
import { useCallback, useRef, useState } from 'react'
import { CHECKPOINTS, findCheckpointDef } from '@/lib/comfyui'
import {
  composePromptWithCamera,
  composeNegativeForCamera,
} from '@/components/wizard/common/cameraOptions'
import type { EditorImageType } from '../types'
import { buildGeneratePayload } from '../helpers/generatePayload'

export interface GenerationRequest {
  promptFr: string
  negativeFr?: string
  /** Type d'image à produire (portrait / fullbody / object / plan_standard / panorama_360). */
  type: EditorImageType
  /** Format utilisateur ('16:9', '1:1', etc.). Ignoré pour portrait/object/360°. */
  format?: string
  /** Style (key de STYLE_SUFFIXES). */
  style?: string
  /** Cadrage (key de FRAMING_OPTIONS). */
  framing?: string
  /** Angle (key de POV_OPTIONS). */
  pov?: string
  /** Force du cadrage/angle (tags en tête du prompt avec pondération). */
  forceCamera?: boolean
  /** Clés de checkpoints à utiliser. Si vide, défaut à ['juggernaut']. */
  modelKeys: string[]
  /** Préfixe Supabase pour stocker le résultat final. */
  storagePathPrefix: string
  /** Optionnels. */
  steps?: number
  cfg?: number
  seed?: number
}

export interface GenerationVariantStatus {
  /** Clé du checkpoint (ex : 'juggernaut'). */
  modelKey: string
  /** Label affiché à l'utilisateur (ex : 'Juggernaut XL v9'). */
  modelLabel: string
  /** Étape courante. */
  stage: 'queued' | 'translating' | 'queuing' | 'generating' | 'uploading' | 'done' | 'error'
  /** URL finale quand 'done'. */
  url?: string
  /** Message d'erreur quand 'error'. */
  error?: string
  /** Prompt EN utilisé (après traduction). */
  promptUsed?: string
  /** Timestamp du dernier update (pour l'UI). */
  updatedAt: number
}

const MAX_WAIT_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 3000

export function useImageGeneration(): {
  statuses: GenerationVariantStatus[]
  isRunning: boolean
  start: (req: GenerationRequest) => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [statuses, setStatuses] = useState<GenerationVariantStatus[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const cancelledRef = useRef(false)

  const updateStatus = useCallback((modelKey: string, patch: Partial<GenerationVariantStatus>) => {
    setStatuses(prev => prev.map(s =>
      s.modelKey === modelKey ? { ...s, ...patch, updatedAt: Date.now() } : s,
    ))
  }, [])

  const start = useCallback(async (req: GenerationRequest) => {
    if (!req.promptFr.trim()) {
      console.warn('[ImageEditor] prompt vide, génération ignorée')
      return
    }
    const keys = req.modelKeys.length > 0 ? req.modelKeys : ['juggernaut']
    cancelledRef.current = false
    setIsRunning(true)

    // Init statuses pour chaque modèle
    const initialStatuses: GenerationVariantStatus[] = keys.map(k => ({
      modelKey: k,
      modelLabel: CHECKPOINTS.find(c => c.key === k)?.label ?? k,
      stage: 'queued',
      updatedAt: Date.now(),
    }))
    setStatuses(initialStatuses)

    // Traduction FR→EN une seule fois (partagée)
    let promptEn = req.promptFr
    let negativeEn = req.negativeFr ?? ''
    try {
      keys.forEach(k => updateStatus(k, { stage: 'translating' }))
      const trRes = await fetch('/api/translate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_fr: req.promptFr }),
      })
      if (trRes.ok) {
        const td = await trRes.json()
        if (td.prompt_en) promptEn = td.prompt_en
        if (td.negative_prompt) negativeEn = `${negativeEn}, ${td.negative_prompt}`.replace(/^, /, '')
      }
    } catch (err) {
      console.warn('[ImageEditor] translate fallback to raw prompt:', err)
    }

    if (cancelledRef.current) { setIsRunning(false); return }

    // Compose les tags cadrage + angle
    const composedPrompt = composePromptWithCamera(promptEn, req.framing ?? '', req.pov ?? '', undefined, req.forceCamera ?? false)
    const composedNegative = [negativeEn, composeNegativeForCamera(req.framing ?? '', req.pov ?? '', req.forceCamera ?? false)]
      .filter(s => s.trim()).join(', ')

    // Lance chaque modèle en parallèle
    const promises = keys.map(async (modelKey) => {
      const def = findCheckpointDef(modelKey)
      if (!def) {
        updateStatus(modelKey, { stage: 'error', error: `Checkpoint inconnu: ${modelKey}` })
        return
      }
      try {
        await generateOneVariant({
          modelKey,
          checkpoint: def.filename,
          promptEn: composedPrompt,
          negativeEn: composedNegative,
          req,
          updateStatus,
          isCancelled: () => cancelledRef.current,
        })
      } catch (err) {
        if (cancelledRef.current) return
        const msg = err instanceof Error ? err.message : String(err)
        updateStatus(modelKey, { stage: 'error', error: msg })
      }
    })

    // On attend toutes les promesses mais pas de façon bloquante pour l'UI
    // (updateStatus met à jour le state progressivement au fur et à mesure)
    await Promise.allSettled(promises)
    setIsRunning(false)
  }, [updateStatus])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    setIsRunning(false)
  }, [])

  const reset = useCallback(() => {
    cancelledRef.current = true
    setStatuses([])
    setIsRunning(false)
  }, [])

  return { statuses, isRunning, start, cancel, reset }
}

// ── Core : génère 1 variante (1 checkpoint) ──────────────────────────────

async function generateOneVariant(args: {
  modelKey: string
  checkpoint: string
  promptEn: string
  negativeEn: string
  req: GenerationRequest
  updateStatus: (modelKey: string, patch: Partial<GenerationVariantStatus>) => void
  isCancelled: () => boolean
}) {
  const { modelKey, checkpoint, promptEn, negativeEn, req, updateStatus, isCancelled } = args

  // Pony : traduction Danbooru tags avant envoi (réutilise l'endpoint existant)
  let promptForModel = promptEn
  if (modelKey === 'pony_xl_v6') {
    try {
      const r = await fetch('/api/translate-to-pony-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptEn }),
      })
      if (r.ok) {
        const d = await r.json()
        if (d.tags) promptForModel = d.tags
      }
    } catch { /* fallback au prompt EN standard */ }
  }

  if (isCancelled()) return

  updateStatus(modelKey, { stage: 'queuing', promptUsed: promptForModel })

  // Construit le payload selon le type d'image
  const { endpoint, body } = buildGeneratePayload({
    promptEn: promptForModel,
    negativeEn,
    type: req.type,
    format: req.format,
    style: req.style,
    checkpoint,
    steps: req.steps,
    cfg: req.cfg,
    seed: req.seed,
  })

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${endpoint}`)
  const d = await res.json()
  if (!d.prompt_id) throw new Error(d.error || 'Pas de prompt_id renvoyé')

  if (isCancelled()) return
  updateStatus(modelKey, { stage: 'generating' })

  // Poll jusqu'à complétion
  const startT = Date.now()
  while (Date.now() - startT < MAX_WAIT_MS) {
    if (isCancelled()) return
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    if (isCancelled()) return

    const poll = await fetch(`${endpoint}?prompt_id=${d.prompt_id}`)
    const pd = await poll.json()

    if (pd.status === 'succeeded') {
      if (isCancelled()) return
      updateStatus(modelKey, { stage: 'uploading' })
      const storagePath = `${req.storagePathPrefix}_${modelKey}_${Date.now()}`
      const imgRes = await fetch(`${endpoint}?prompt_id=${d.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`)
      const imgData = await imgRes.json()
      if (!imgData.image_url) throw new Error('Pas d\'URL image finale')
      const cleanUrl = imgData.image_url.split('?')[0]
      updateStatus(modelKey, { stage: 'done', url: cleanUrl })
      return
    }
    if (pd.status === 'failed') {
      throw new Error(pd.error || 'Workflow échoué côté ComfyUI')
    }
  }
  throw new Error(`Timeout (${Math.round(MAX_WAIT_MS / 60000)} min)`)
}
