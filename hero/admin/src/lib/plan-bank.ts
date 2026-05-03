/**
 * Hook + helpers pour la banque d'images Studio Designer (Phase 4).
 *
 * - `usePlanBank()` : fetch + cache des items pour un book + section courante.
 *   Refetch au mount, refetch manuel via `refresh()`. État `loading` + `error`.
 *
 * - `persistPlanAnimation()` : ajoute un nouveau plan kind='animation' à
 *   `sections.images[]` (POST API à venir / direct via Supabase pour V1).
 *
 * Cf décisions session 2026-05-03 (project_plan_kind_data_model.md,
 * project_plan_bank_order.md, project_plan_tags_strategy.md).
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import type { PlanBankItem } from '@/components/image-editor/designer/bank/PlanBankPanel'
import { extractFramesFromVideo } from './extract-frames'

// ─── Hook usePlanBank ─────────────────────────────────────────────────────

interface UsePlanBankOptions {
  bookId: string
  /** Section dans laquelle l'auteur crée le nouveau plan. Drive l'ordre. */
  currentSectionId: string | null
  /** Si false, ne fetch pas (utile quand bookId pas encore connu). Défaut true. */
  enabled?: boolean
}

interface UsePlanBankResult {
  items: PlanBankItem[]
  loading: boolean
  error: string | null
  /** Refetch manuel (ex: après avoir ajouté un nouveau plan). */
  refresh: () => Promise<void>
}

export function usePlanBank(opts: UsePlanBankOptions): UsePlanBankResult {
  const { bookId, currentSectionId, enabled = true } = opts
  const [items, setItems] = useState<PlanBankItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // AbortController pour invalider les requêtes en cours quand bookId/section
  // change rapidement (évite race conditions où une réponse stale écrase une
  // réponse fresh).
  const abortRef = useRef<AbortController | null>(null)

  const fetchItems = useCallback(async () => {
    if (!bookId || !enabled) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (currentSectionId) params.set('currentSectionId', currentSectionId)
      const res = await fetch(
        `/api/books/${bookId}/plan-bank?${params.toString()}`,
        { signal: ctrl.signal },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `plan-bank fetch HTTP ${res.status}`)
      // Si on a été abort entre le fetch et le json, on ignore le résultat
      if (ctrl.signal.aborted) return
      setItems(data.items ?? [])
    } catch (err) {
      // AbortError est attendue quand bookId change → ne pas afficher comme erreur
      if (err instanceof DOMException && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[usePlanBank]', msg)
      setError(msg)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [bookId, currentSectionId, enabled])

  useEffect(() => {
    fetchItems()
    return () => { abortRef.current?.abort() }
  }, [fetchItems])

  return { items, loading, error, refresh: fetchItems }
}

// ─── Helper persistance ───────────────────────────────────────────────────

interface PersistPlanOptions {
  /** ID de la section où ajouter le plan. */
  sectionId: string
  /** Type du plan. */
  kind: 'image' | 'animation'
  /** URL Supabase de l'image (kind='image') OU 1ère frame de référence (animation). */
  url: string
  /** Si kind='animation' : URL MP4. */
  baseVideoUrl?: string
  /** Si kind='animation' : URL 1ère frame extraite. */
  firstFrameUrl?: string
  /** Si kind='animation' : URL dernière frame extraite. */
  lastFrameUrl?: string
  /** Prompt fr utilisé pour la gen (pour debug + futur re-gen). */
  promptFr?: string
  /** Tags initiaux (auto-dérivés du contexte). Mergés avec auto-tag côté API si supportés. */
  tags?: Record<string, unknown>
}

/**
 * Ajoute un nouveau plan dans `sections.images[]` du book via la route POST.
 * Auto-tag à la création côté serveur (kind, sections, location).
 */
export async function persistPlanAnimation(opts: PersistPlanOptions): Promise<{ ok: boolean; planIndex?: number; error?: string }> {
  try {
    const res = await fetch(`/api/sections/${opts.sectionId}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: opts.kind,
        url: opts.url,
        base_video_url: opts.baseVideoUrl,
        first_frame_url: opts.firstFrameUrl,
        last_frame_url: opts.lastFrameUrl,
        prompt_fr: opts.promptFr,
        tags: opts.tags,
      }),
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data.error ?? `persistPlan HTTP ${res.status}` }
    return { ok: true, planIndex: data.planIndex }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// ─── Helper upload externe vers la banque ────────────────────────────────

interface UploadToBankOptions {
  bookId: string
  /** Le fichier sélectionné par l'auteur (image OU vidéo). Format détecté via mimeType. */
  file: File
  /** Tags initiaux (V1 : vides, V2 : suggestion Qwen VL). */
  tags?: Record<string, unknown>
  /** Callback de progression UI (étapes : upload / extract / insert / done). */
  onProgress?: (stage: 'upload' | 'extract' | 'insert' | 'done', label?: string) => void
}

interface UploadToBankResult {
  ok: boolean
  uploadId?: string
  url?: string
  error?: string
}

/**
 * Upload une image ou vidéo dans la banque externe :
 * 1. Lit le fichier en base64
 * 2. Upload via /api/storage/upload-image (image) OU stockage direct (vidéo TODO V2)
 * 3. Si vidéo : extrait les 2 frames via extractFramesFromVideo
 * 4. Insert dans bank_uploads via /api/books/[id]/bank-uploads
 */
export async function uploadToBank(opts: UploadToBankOptions): Promise<UploadToBankResult> {
  const { bookId, file, tags, onProgress } = opts
  try {
    const isVideo = file.type.startsWith('video/')
    const isImage = file.type.startsWith('image/')
    if (!isVideo && !isImage) {
      return { ok: false, error: 'Format non supporté (image ou vidéo uniquement)' }
    }

    onProgress?.('upload', 'Upload du fichier…')

    // ── 1. Convertir en data URL ──
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
      reader.readAsDataURL(file)
    })

    let assetUrl: string
    if (isImage) {
      // ── 2a. Upload image via route existante ──
      const res = await fetch('/api/storage/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_url: dataUrl,
          path: `bank/${bookId}/${Date.now()}_${file.name}`,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? `upload image HTTP ${res.status}`)
      assetUrl = data.url
    } else {
      // ── 2b. Upload vidéo : V1 sans route dédiée → on bidouille avec data URL
      // pour passer le contenu, mais l'API upload-image refuse les vidéos.
      // V2 : créer /api/storage/upload-media qui accepte vidéos.
      // Pour l'instant on bloque proprement avec un message explicite.
      return {
        ok: false,
        error: 'Upload vidéo pas encore supporté (V2). Utilise une image PNG/JPG pour l\'instant.',
      }
    }

    let firstFrameUrl: string | null = null
    let lastFrameUrl: string | null = null
    if (isVideo) {
      // (Code dead pour V1, prêt pour V2 quand l'upload vidéo sera là)
      onProgress?.('extract', 'Extraction des miniatures vidéo…')
      try {
        const frames = await extractFramesFromVideo({
          videoUrl: assetUrl,
          storagePathPrefix: `bank/${bookId}/frames`,
        })
        firstFrameUrl = frames.first_frame_url
        lastFrameUrl = frames.last_frame_url
      } catch (err) {
        console.warn('[uploadToBank] extractFrames failed:', err)
      }
    }

    // ── 3. Insert dans bank_uploads ──
    onProgress?.('insert', 'Enregistrement…')
    const fileNameNoExt = file.name.replace(/\.[^/.]+$/, '')
    const insertRes = await fetch(`/api/books/${bookId}/bank-uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: isVideo ? 'animation' : 'image',
        url: assetUrl,
        first_frame_url: firstFrameUrl,
        last_frame_url: lastFrameUrl,
        name: fileNameNoExt,
        tags: tags ?? {},
        source: 'upload',
      }),
    })
    const insertData = await insertRes.json()
    if (!insertRes.ok || !insertData.id) {
      throw new Error(insertData.error ?? `bank_uploads insert HTTP ${insertRes.status}`)
    }

    onProgress?.('done', 'Terminé')
    return { ok: true, uploadId: insertData.id, url: assetUrl }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
