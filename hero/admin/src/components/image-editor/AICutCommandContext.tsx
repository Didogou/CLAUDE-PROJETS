'use client'
/**
 * AICutCommandContext — partage l'état du pipeline "découpe IA" entre :
 *   - AICommandBar (où l'utilisateur tape la commande)
 *   - CatalogEdit (où s'affiche la pré-validation)
 *   - CanvasOverlay (où s'affichent les marching ants preview)
 *
 * Pourquoi un context plutôt qu'un hook local :
 *   AICommandBar est dans DesignerTopBar, CatalogEdit dans DesignerCatalog,
 *   tous deux remontent jusqu'à DesignerLayout. Sans context, il faudrait
 *   passer le status + run/confirm/cancel via 4-5 niveaux de props.
 */

import React, { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { ParsedCutCommand } from '@/lib/ai-cut-parser'
import { useEditorState } from './EditorStateContext'

interface MaskContour { points: Array<{ x: number; y: number }>; inner: boolean }

export type AICutStatus =
  | { phase: 'idle' }
  | { phase: 'parsing'; text: string }
  | { phase: 'searching'; parsed: ParsedCutCommand }
  | { phase: 'preview';
      parsed: ParsedCutCommand;
      maskUrl: string;
      contours: MaskContour[];
    }
  | { phase: 'unsupported_intent'; parsed: ParsedCutCommand }
  | { phase: 'not_found'; parsed: ParsedCutCommand; message: string }
  | { phase: 'error'; message: string; hint?: string }

interface AICutCommandContextValue {
  status: AICutStatus
  /** Lance le pipeline depuis un texte libre. */
  run: (text: string) => Promise<void>
  /** Pousse la mask preview dans wandMasks (= sélection officielle). */
  confirm: () => void
  /** Vide la preview (status → idle). */
  cancel: () => void
}

const Ctx = createContext<AICutCommandContextValue | null>(null)

interface AICutCommandProviderProps {
  children: ReactNode
  /** Callback appelé au démarrage d'une commande pour ouvrir le catalog
   *  "Édition" du panneau gauche, où s'affiche la pré-validation. Sans ça,
   *  le AICutPanel (rendu dans CatalogEdit) reste invisible car CatalogEdit
   *  n'est monté que lorsque activeCategory === 'edit'. */
  onOpenEditCatalog?: () => void
}

export function AICutCommandProvider({ children, onOpenEditCatalog }: AICutCommandProviderProps) {
  const { imageUrl, pushWandMask, setCutMode } = useEditorState()
  const [status, setStatus] = useState<AICutStatus>({ phase: 'idle' })

  const run = useCallback(async (text: string) => {
    if (!imageUrl) {
      setStatus({ phase: 'error', message: 'Aucune image base — choisis ou génère une image avant.' })
      // Ouvre quand même le catalog pour afficher l'erreur — sinon l'utilisateur
      // ne voit rien (status est invisible si le panel n'est pas mounted).
      setCutMode(true)
      onOpenEditCatalog?.()
      return
    }
    if (!text.trim()) {
      setStatus({ phase: 'idle' })
      return
    }

    // Ouvre IMMÉDIATEMENT le catalog gauche pour que les status (parsing,
    // searching, error, etc.) soient tous visibles dès la 1ère phase. Avant
    // ce déplacement, l'ouverture se faisait après le parse → en cas de
    // timeout LLM ou erreur 503 Ollama, le user voyait rien.
    setCutMode(true)
    onOpenEditCatalog?.()

    // ── PHASE 1 : parse NLU ──────────────────────────────────────────────
    setStatus({ phase: 'parsing', text })
    let parsed: ParsedCutCommand
    try {
      const res = await fetch('/api/ai/parse-cut-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus({
          phase: 'error',
          message: data.message ?? data.error ?? 'Échec du parser IA',
          hint: data.hint,
        })
        return
      }
      parsed = data as ParsedCutCommand
    } catch (err) {
      setStatus({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Erreur réseau parser',
      })
      return
    }

    // ── PHASE 2 : intent supporté ? ──────────────────────────────────────
    if (parsed.intent !== 'extract') {
      setStatus({ phase: 'unsupported_intent', parsed })
      return
    }
    if (!parsed.object_en) {
      setStatus({ phase: 'not_found', parsed, message: 'Objet à extraire non identifié dans la commande.' })
      return
    }

    // (catalog déjà ouvert au début de run() — pas besoin de re-déclencher)

    // ── PHASE 3 : Vision — routing selon parsed.suggested_engine ──────────
    //   - dino           : GroundingDINO + SAM 1, multi-classes simples
    //   - florence_res   : Florence-2 RES, UN sujet via expression relationnelle
    //   - florence_ctpg  : Florence-2 multi-query — N appels RES (1 par phrase)
    //                      puis union des masks côté client via combineMasksMulti
    setStatus({ phase: 'searching', parsed })
    let endpoint: string
    let body: Record<string, unknown>
    if (parsed.suggested_engine === 'dino') {
      endpoint = '/api/comfyui/grounded-sam'
      body = { image_url: imageUrl, prompt_text: parsed.object_en }
    } else {
      endpoint = '/api/comfyui/florence-sam2'
      body = {
        image_url: imageUrl,
        prompt_text: parsed.object_en,
        mode: parsed.suggested_engine === 'florence_ctpg' ? 'ctpg' : 'res',
      }
    }
    let maskUrl: string
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.status === 422) {
        setStatus({ phase: 'not_found', parsed, message: data.message ?? 'Objet non trouvé.' })
        return
      }
      if (!res.ok) {
        setStatus({
          phase: 'error',
          message: typeof data.error === 'string' ? data.error
            : (parsed.suggested_engine.startsWith('florence')
                ? 'Échec Florence-SAM2'
                : 'Échec Grounded-SAM'),
        })
        return
      }

      // Mode CTPG retourne un array de mask URLs (1 par phrase) → union client.
      // Les autres modes retournent un mask_url unique.
      if (Array.isArray(data.mask_urls)) {
        const { combineMasksMulti } = await import('./helpers/extractZones')
        const combined = await combineMasksMulti(
          data.mask_urls as string[],
          `ai-cut-multi/${Date.now()}`,
        )
        if (!combined) {
          setStatus({ phase: 'not_found', parsed, message: 'Aucune phrase trouvée.' })
          return
        }
        maskUrl = combined
      } else {
        maskUrl = data.mask_url as string
      }
    } catch (err) {
      setStatus({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Erreur réseau vision',
      })
      return
    }

    // ── PHASE 4 : compute contours (pour marching ants preview) ──────────
    let contours: MaskContour[] = []
    try {
      contours = await computeContoursFromMaskUrl(maskUrl)
    } catch (err) {
      console.warn('[AICutCommand] contours compute failed:', err)
    }

    // ── PHASE 5 : preview ────────────────────────────────────────────────
    setStatus({ phase: 'preview', parsed, maskUrl, contours })
  }, [imageUrl, pushWandMask, setCutMode, onOpenEditCatalog])

  const confirm = useCallback(() => {
    setStatus(prev => {
      if (prev.phase !== 'preview') return prev
      pushWandMask({ url: prev.maskUrl, contours: prev.contours })
      return { phase: 'idle' }
    })
  }, [pushWandMask])

  const cancel = useCallback(() => setStatus({ phase: 'idle' }), [])

  return (
    <Ctx.Provider value={{ status, run, confirm, cancel }}>
      {children}
    </Ctx.Provider>
  )
}

/** Hook consumer — throw si utilisé hors provider. */
export function useAICutCommand(): AICutCommandContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAICutCommand doit être utilisé dans <AICutCommandProvider>')
  return ctx
}

/** Hook safe — retourne null si pas de provider (utile pour usage optionnel). */
export function useAICutCommandOptional(): AICutCommandContextValue | null {
  return useContext(Ctx)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function computeContoursFromMaskUrl(maskUrl: string): Promise<MaskContour[]> {
  // @ts-expect-error : magic-wand-tool sans types officiels
  const MagicWand = (await import('magic-wand-tool')).default

  const img = await loadImage(maskUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, W, H).data

  const binary = new Uint8Array(W * H)
  let minX = W, minY = H, maxX = 0, maxY = 0
  let area = 0
  for (let i = 0; i < W * H; i++) {
    if (data[i * 4] > 128) {
      binary[i] = 1
      area++
      const x = i % W
      const y = Math.floor(i / W)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (area === 0) return []

  const mwMask = {
    data: binary,
    width: W, height: H,
    bounds: { minX, minY, maxX, maxY },
  }
  const raw = MagicWand.traceContours(mwMask) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean
  }>
  const simplified = MagicWand.simplifyContours(raw, 1, 30) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean
  }>
  return simplified.map(c => ({
    inner: c.inner,
    points: c.points.map(p => ({ x: p.x / W, y: p.y / H })),
  }))
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load mask: ${url.slice(0, 80)}`))
    img.src = url
  })
}
