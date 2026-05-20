'use client'
/**
 * EffectsModal — Bibliothèque d'effets vidéo composites narratifs.
 *
 * Refonte 2026-05-15ca — Modale grande 3 colonnes (Figma-style) :
 *   - Sidebar GAUCHE  : catégories (⭐ Mes looks → Cinéma / Vintage / Surveil. /
 *                       Glitch | Cible / Cadre / Ambiance). Click = filtre la grille.
 *   - Centre          : preview live de LA pellicule avec effet courant + grille
 *                       des cards de la catégorie sélectionnée. Click sur card =
 *                       autosave (look exclusif OU module empilé selon la card).
 *   - Sidebar DROITE  : sliders fins du look actif (color basics + cinéma) +
 *                       options Sniper si actif (couleur, taille, enregistrer cible)
 *                       + bouton 💾 Sauver le look comme preset perso.
 *
 * Design validé 2026-05-15 (cf. project_effects_popup_design):
 *   - Looks composites narratifs (option 1)
 *   - Hybride base/modules (option 3)
 *   - Live preview central
 *   - Live autosave + bouton "Annuler les changements"
 *   - Layout B (3 colonnes)
 *   - Mouse tracking inline (sidebar grisée pendant record)
 *   - Modal remplace le drawer
 *   - Presets perso V0 sans nom
 *   - Thumbnails = frame de SA pellicule, statiques
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Save, Trash2, Star, Loader2, Crosshair, RefreshCcw, Download,
  Film, Radar, Zap, Crosshair as CrosshairIcon, Frame, Sparkles, CloudRain, Clock,
  Camera, ChevronLeft, ChevronRight,
} from 'lucide-react'
import ConfirmDialog from '@/components/studio-section/ConfirmDialog'
import { exportBakedMp4, downloadBlob } from '@/lib/video-effects/exportBakedVideo'
import VideoEffectsCanvas from '@/lib/video-effects/VideoEffectsCanvas'
import EffectsOverlayLayer from '@/lib/video-effects/EffectsOverlayLayer'
import VideoWeatherLayer from '@/lib/video-effects/VideoWeatherLayer'
import WeatherZoneRectEditor from '@/lib/video-effects/WeatherZoneRectEditor'
import WeatherZoneBrushEditor from '@/lib/video-effects/WeatherZoneBrushEditor'
import ImpactZonesSubBlock from '@/lib/video-effects/ImpactZonesSubBlock'
import { useMouseTrack } from '@/lib/video-effects/useMouseTrack'
import {
  LOOKS, MODULES, LOOK_CATEGORIES, MODULE_CATEGORIES, CATEGORY_LABELS,
  resolveShaderParams, findLook, findModule,
  type LookCategory, type ModuleCategory, type ComposedEffectsState,
  NEUTRAL_STATE,
} from '@/lib/video-effects/looks-catalog'
import { WEATHER_PRESETS, type WeatherParams } from '@/components/image-editor/types'
// thumbnail-baker reste utilisable pour bake preset perso (savePresetPerso)
// mais l'import de captureRepresentativeFrame/captureFromImage n'est plus nécessaire
// ici depuis qu'on a retiré les thumbnails des cards (refonte 2026-05-15cg).

// ─── Types & helpers ──────────────────────────────────────────────────────

export interface EffectsModalProps {
  open: boolean
  /** URL vidéo de la pellicule (mp4/webm/mov). Si null → fallback firstFrame image. */
  videoUrl: string | null
  /** Fallback image (firstFrameUrl) si pas de vidéo. */
  fallbackImageUrl?: string | null
  /** État initial du composé. null = neutre. */
  initialState: ComposedEffectsState | null
  /** Callback appelé à chaque changement (autosave). Optionnel en mode='capture'
   *  où aucune mutation d'effects n'est attendue. */
  onChange?: (next: ComposedEffectsState) => void
  /** Callback fermeture (X ou click outside). */
  onClose: () => void
  /** Label affiché dans le header (ex: "Combat orc — pellicule 3"). */
  pelliculeLabel?: string
  /** ID du book courant — requis pour la feature Capture (refonte 2026-05-15dp)
   *  : sauvegarder dans la banque images du livre. Si absent, le bouton Sauver
   *  des captures est désactivé. */
  bookId?: string | null
  /** ID de la section courante — pour que les captures sauvées apparaissent
   *  dans la bonne section accordion de la banque. null = pas attachée à une
   *  section (orpheline). Refonte 2026-05-15dt. */
  sectionId?: string | null
  /** Callback déclenché après sauvegarde d'une capture en DB (notifie le parent
   *  pour refresh la banque images). */
  onCaptureSaved?: () => void
  /** Callback "Sauver et couper la vidéo" (refonte 2026-05-16, mode='capture').
   *  Le parent doit :
   *  1. Upload l'image en banque (data_url → asset_image)
   *  2. Trim la pellicule courante : ajuster shots[].duration au timestamp
   *     (les shots après sont supprimés, le shot en cours est tronqué)
   *  3. Refresh banque + close modal
   *  Si fourni, ajoute un bouton "Sauver et couper" dans la sidebar capture. */
  onCaptureAndTrim?: (params: {
    dataUrl: string
    label: string
    timestamp: number
  }) => Promise<void>
  /** Mode d'ouverture (refonte 2026-05-15dq). 'effects' (default) = layout 3 col
   *  complet avec sidebar catégories. 'capture' = layout simplifié (preview +
   *  block capture seul), sidebar/toolbar masquées. */
  mode?: 'effects' | 'capture'
}

interface UserPresetRow {
  id: string
  look_id: string | null
  modules: string[]
  overrides: Record<string, number | string | undefined>
  extras: { mouse_track?: { tMs: number; x: number; y: number }[] | null; sniper_color?: string; scope_size?: number }
  thumbnail_url: string | null
  created_at: string
}

type CategoryKey = LookCategory | ModuleCategory | 'mes_looks'
const CATEGORY_KEYS: CategoryKey[] = [
  'mes_looks',
  ...LOOK_CATEGORIES,
  ...MODULE_CATEGORIES,
]

function isLookCategory(k: CategoryKey): k is LookCategory {
  return (LOOK_CATEGORIES as string[]).includes(k as string)
}

function isModuleCategory(k: CategoryKey): k is ModuleCategory {
  return (MODULE_CATEGORIES as string[]).includes(k as string)
}

// Mapping catégorie → icône Lucide + couleur d'accent du dot.
// Refonte design 2026-05-15 : pas d'emoji par card, l'identité visuelle
// se fait au niveau de la catégorie (sidebar) + d'un dot coloré discret
// sur chaque card. Couleurs choisies pour rester sobres en dark theme.
const CATEGORY_META: Record<CategoryKey, { Icon: React.ComponentType<{ size?: number }>; dot: string }> = {
  mes_looks:    { Icon: Star,          dot: '#F472B6' },  // rose accent Hero
  cinema:       { Icon: Film,          dot: '#F4A261' },  // ambre chaud
  surveillance: { Icon: Radar,         dot: '#7DD3FC' },  // cyan froid
  glitch:       { Icon: Zap,           dot: '#A78BFA' },  // violet électrique
  cible:        { Icon: CrosshairIcon, dot: '#F87171' },  // rouge mire
  cadre:        { Icon: Frame,         dot: '#94A3B8' },  // gris neutre
  ambiance:     { Icon: Sparkles,      dot: '#FCD34D' },  // jaune doux
  meteo:        { Icon: CloudRain,     dot: '#60A5FA' },  // bleu pluie
  temps:        { Icon: Clock,         dot: '#A78BFA' },  // violet ralenti
}

// ─── Composant principal ──────────────────────────────────────────────────

export default function EffectsModal({
  open, videoUrl, fallbackImageUrl, initialState, onChange, onClose, pelliculeLabel,
  bookId, sectionId, onCaptureSaved, onCaptureAndTrim, mode = 'effects',
}: EffectsModalProps) {
  // Mode capture : capture toujours active visuellement, pas via toggle module
  const captureModeActive = mode === 'capture'
  // ── État composé local (autosave : on propage onChange via useEffect, pas
  // dans l'updater — sinon React lève "Cannot update a component while
  // rendering a different component" car onChange dispatch sur le parent. ──
  const [state, setState] = useState<ComposedEffectsState>(
    initialState ?? NEUTRAL_STATE,
  )
  // Snapshot initial pour bouton "Annuler les changements"
  const [initialSnapshot, setInitialSnapshot] = useState<ComposedEffectsState>(
    initialState ?? NEUTRAL_STATE,
  )
  // Skip premier sync onChange (mount avec initial state)
  const skipNextSyncRef = useRef(true)
  // Refonte 2026-05-15dg — Reset state UNIQUEMENT quand open passe de
  // false→true (mount). Si on re-fire à chaque change d'initialState (qui
  // change à chaque re-render parent car migrateLegacyEffectsParams crée
  // un nouvel objet), on écrase l'état utilisateur entre 2 toggles.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const snap = initialState ?? NEUTRAL_STATE
      skipNextSyncRef.current = true
      setState(snap)
      setInitialSnapshot(snap)
    }
    wasOpenRef.current = open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Sync state local → parent (autosave). Différé via useEffect pour ne pas
  // déclencher de dispatch parent pendant le render de la modale.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false
      return
    }
    onChangeRef.current?.(state)
  }, [state])

  // ── Catégorie active (sidebar) ──
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('cinema')

  // ── Presets perso (chargés au mount) ──
  const [userPresets, setUserPresets] = useState<UserPresetRow[]>([])
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [savingPreset, setSavingPreset] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  // Phase D — export MP4 baked (refonte 2026-05-15cp)
  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [exportStage, setExportStage] = useState<'capture' | 'transcode' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  // Dimensions de l'export récent (pour confirmation post-download)
  const [lastExportInfo, setLastExportInfo] = useState<{ width: number; height: number; sizeMB: number } | null>(null)
  // M3 Weather zones — index de l'effet weather en cours d'édition de zone
  // (drag rectangle sur preview). null = pas en édition. Refonte 2026-05-15di.
  const [editingWeatherZoneIdx, setEditingWeatherZoneIdx] = useState<number | null>(null)
  // M4b Impact zones — index { weatherIdx, impactIdx } en cours d'édition.
  // null = pas en édition. Refonte 2026-05-15dk.
  const [editingImpact, setEditingImpact] = useState<{ wIdx: number; iIdx: number } | null>(null)
  // Confirm "Sauver et couper la vidéo" (refonte 2026-05-16). null = pas demandé.
  const [confirmTrimCapId, setConfirmTrimCapId] = useState<string | null>(null)
  const [trimInFlight, setTrimInFlight] = useState(false)
  // Mode record du ralenti (refonte 2026-05-15do) — workflow interactif type sniper
  // idle = pas en record
  // countdown = 3-2-1 avant de partir
  // preroll = vidéo joue à 1×, l'auteur attend le bon moment pour cliquer "Démarrer ralenti"
  // inSlowmo = vidéo joue à factor×, l'auteur attend le bon moment pour cliquer "Reprendre"
  // postroll = vidéo continue à 1× jusqu'à la fin
  const [slowmoRecord, setSlowmoRecord] = useState<{
    mode: 'idle' | 'countdown' | 'preroll' | 'inSlowmo' | 'postroll'
    countdownVal: number | null
    factor: number
    startSec: number | null
    endSec: number | null
  }>({ mode: 'idle', countdownVal: null, factor: 0.5, startSec: null, endSec: null })
  // Capture d'image — liste locale (sauvegarde explicite, refonte 2026-05-15dp).
  // Chaque capture = snapshot dataURL en attente. L'auteur sauve explicitement
  // pour persister en banque images (sinon perdu à la fermeture).
  interface LocalCapture {
    id: string             // uuid local
    timestamp: number      // currentTime de la capture (sec)
    dataUrl: string        // image JPEG base64
    label: string          // éditable
    saving: boolean        // upload en cours
    saved: boolean         // déjà persisté en DB
    savedUrl?: string      // URL Supabase après save
  }
  const [captures, setCaptures] = useState<LocalCapture[]>([])
  const [scrubTime, setScrubTime] = useState<number>(0)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  // Durée vidéo source + hook ralenti déplacés APRÈS déclaration de
  // livePreviewVideoEl et tracker (cf. plus bas).

  const refreshPresets = useCallback(async () => {
    setPresetsLoading(true)
    try {
      const res = await fetch('/api/user/effects-presets')
      const data = await res.json()
      if (res.ok) setUserPresets(data.presets ?? [])
    } catch (err) {
      console.warn('[EffectsModal] refreshPresets failed:', err)
    } finally {
      setPresetsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void refreshPresets()
  }, [open, refreshPresets])

  // (Refonte 2026-05-15cg — bakedFrame retiré : les cards n'utilisent plus
  // de thumbnails, juste dot coloré + label. thumbnail-baker reste pour le
  // bake de preset perso au save.)

  // ── Live preview : video element ref pour mouse tracking ──
  const [livePreviewVideoEl, setLivePreviewVideoEl] = useState<HTMLVideoElement | null>(null)
  // Ratio source dynamique pour adapter le preview-box (refonte 2026-05-15ct).
  // Update via le callback onAspectChange de VideoEffectsCanvas (refonte cw —
  // observation directe ne marchait pas si la metadata chargeait avant le hook).
  const [sourceAspect, setSourceAspect] = useState<number>(16 / 9)

  // ── Mouse tracking pour sniper (inline dans modal) ──
  const tracker = useMouseTrack({ videoEl: livePreviewVideoEl, playbackRate: 0.5 })

  // Ref locale sur le wrapper preview, pour pouvoir querySelector le canvas
  // WebGL R3F au moment d'une capture (cf captureCurrentFrame). Combinée avec
  // tracker.attachTarget via setPreviewBoxRef. Refonte 2026-05-15ds.
  const previewBoxRef = useRef<HTMLDivElement | null>(null)
  const setPreviewBoxRef = useCallback((el: HTMLDivElement | null) => {
    previewBoxRef.current = el
    tracker.attachTarget(el)
  }, [tracker])

  // Quand le record termine, on commit les points dans state.mouse_track
  useEffect(() => {
    // Le tracker passe en 'idle' quand l'enregistrement est terminé (vidéo ended)
    // ET qu'il a des points. On commit ces points dans state.
    if (tracker.mode === 'idle' && tracker.points.length > 0) {
      setState(prev => {
        const sameLength = (prev.mouse_track?.length ?? 0) === tracker.points.length
        if (sameLength) return prev  // pas de changement
        return { ...prev, mouse_track: tracker.points }
      })
    }
  }, [tracker.mode, tracker.points, setState])

  // Durée vidéo source (pour driver les sliders ralenti). 0 = pas encore connue.
  const [videoDuration, setVideoDuration] = useState<number>(0)
  useEffect(() => {
    if (!livePreviewVideoEl) return
    const update = () => {
      if (livePreviewVideoEl.duration > 0 && Number.isFinite(livePreviewVideoEl.duration)) {
        setVideoDuration(livePreviewVideoEl.duration)
      }
    }
    if (livePreviewVideoEl.readyState >= 1) update()
    livePreviewVideoEl.addEventListener('loadedmetadata', update)
    livePreviewVideoEl.addEventListener('durationchange', update)
    return () => {
      livePreviewVideoEl.removeEventListener('loadedmetadata', update)
      livePreviewVideoEl.removeEventListener('durationchange', update)
    }
  }, [livePreviewVideoEl])

  // ── Ralenti preview live (refonte 2026-05-15dn) — applique playbackRate
  // depuis state.slowMotion (= ce qui est PERSISTÉ après record). Tourne
  // seulement si AUCUN record interactif en cours (sinon le record gère).
  useEffect(() => {
    const sm = state.slowMotion
    if (!sm || !livePreviewVideoEl || tracker.mode !== 'idle') return
    if (slowmoRecord.mode !== 'idle') return  // record en cours = gère son propre playbackRate
    const v = livePreviewVideoEl
    let lastApplied = -1
    const id = setInterval(() => {
      const t = v.currentTime
      const inside = t >= sm.startSec && t < sm.endSec
      const target = inside ? Math.max(0.1, Math.min(1, sm.factor)) : 1
      if (Math.abs(target - lastApplied) > 0.01) {
        v.playbackRate = target
        lastApplied = target
      }
    }, 100)
    return () => {
      clearInterval(id)
      try { v.playbackRate = 1 } catch { /* noop */ }
    }
  }, [state.slowMotion, livePreviewVideoEl, tracker.mode, slowmoRecord.mode])

  // ── Ralenti record interactif (refonte 2026-05-15do) — workflow type sniper :
  // countdown → preroll → l'auteur clique "Démarrer ralenti" → inSlowmo →
  // l'auteur clique "Reprendre" → postroll → fin vidéo → commit state.slowMotion.
  async function slowmoStart() {
    if (!livePreviewVideoEl) return
    const v = livePreviewVideoEl
    v.pause()
    v.currentTime = 0
    v.playbackRate = 1
    setSlowmoRecord(prev => ({ ...prev, mode: 'countdown', countdownVal: 3, startSec: null, endSec: null }))
    // Countdown 3-2-1
    for (let i = 3; i >= 1; i--) {
      setSlowmoRecord(prev => ({ ...prev, countdownVal: i }))
      await new Promise(r => setTimeout(r, 800))
    }
    setSlowmoRecord(prev => ({ ...prev, countdownVal: null, mode: 'preroll' }))
    try {
      await v.play()
    } catch { /* autoplay block */ }
  }

  function slowmoMarkStart() {
    if (!livePreviewVideoEl) return
    const v = livePreviewVideoEl
    const t = v.currentTime
    v.playbackRate = slowmoRecord.factor
    setSlowmoRecord(prev => ({ ...prev, mode: 'inSlowmo', startSec: t }))
  }

  function slowmoMarkEnd() {
    if (!livePreviewVideoEl) return
    const v = livePreviewVideoEl
    const t = v.currentTime
    v.playbackRate = 1
    setSlowmoRecord(prev => ({ ...prev, mode: 'postroll', endSec: t }))
  }

  function slowmoCancel() {
    if (livePreviewVideoEl) {
      try { livePreviewVideoEl.playbackRate = 1 } catch { /* noop */ }
      livePreviewVideoEl.pause()
    }
    setSlowmoRecord({ mode: 'idle', countdownVal: null, factor: slowmoRecord.factor, startSec: null, endSec: null })
  }

  // ── Capture d'image (refonte 2026-05-15dp / dq) ────────────────────────
  // Sync scrubTime ↔ videoEl quand on est en mode capture actif.
  // Actif si mode='capture' (modale dédiée) ou module legacy 'image_capture'.
  const captureActive = captureModeActive || state.modules.includes('image_capture')
  useEffect(() => {
    if (!captureActive || !livePreviewVideoEl) return
    const v = livePreviewVideoEl
    const update = () => setScrubTime(v.currentTime)
    update()
    v.addEventListener('timeupdate', update)
    v.addEventListener('seeked', update)
    return () => {
      v.removeEventListener('timeupdate', update)
      v.removeEventListener('seeked', update)
    }
  }, [captureActive, livePreviewVideoEl])

  function scrubTo(t: number) {
    if (!livePreviewVideoEl) return
    livePreviewVideoEl.pause()
    livePreviewVideoEl.currentTime = Math.max(0, Math.min(t, livePreviewVideoEl.duration || t))
  }

  function captureCurrentFrame() {
    if (!livePreviewVideoEl) return
    const v = livePreviewVideoEl
    // WYSIWYG : on capture le canvas WebGL R3F (= ce que l'utilisateur voit
    // dans la preview, avec tonemapping sRGB + LUT + effets), et pas le
    // videoEl brut qui donne des pixels linéaires plus sombres (cf bug
    // capture trop foncée vs preview, 2026-05-15ds). preserveDrawingBuffer
    // est déjà activé côté Canvas R3F (cf VideoEffectsCanvas).
    const glCanvas = previewBoxRef.current?.querySelector('canvas') as HTMLCanvasElement | null
    const w = v.videoWidth || 1280
    const h = v.videoHeight || 720
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return
    try {
      if (glCanvas && glCanvas.width > 0 && glCanvas.height > 0) {
        ctx.drawImage(glCanvas, 0, 0, w, h)
      } else {
        ctx.drawImage(v, 0, 0, w, h)
      }
    } catch (err) {
      console.warn('[EffectsModal] capture drawImage failed:', err)
      return
    }
    const dataUrl = c.toDataURL('image/jpeg', 0.88)
    const t = v.currentTime
    const safeLabel = (pelliculeLabel ?? 'pellicule').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 30)
    const cap: LocalCapture = {
      id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: t,
      dataUrl,
      label: `${safeLabel} - t=${t.toFixed(1)}s`,
      saving: false,
      saved: false,
    }
    // Mode capture (refonte 2026-05-16) = SINGLE capture active. Une nouvelle
    // capture remplace la précédente (sauf si elle est déjà sauvée — on garde
    // l'historique mini). En mode effets (image_capture toggle), on append.
    if (captureModeActive) {
      setCaptures(prev => {
        const unsaved = prev.filter(c => !c.saved)
        const saved = prev.filter(c => c.saved)
        // Remplace l'unsaved courante par la nouvelle. Garde les saved (historique).
        if (unsaved.length > 0) return [...saved, cap]
        return [...prev, cap]
      })
    } else {
      setCaptures(prev => [...prev, cap])
    }
  }

  function updateCaptureLabel(id: string, label: string) {
    setCaptures(prev => prev.map(c => c.id === id ? { ...c, label } : c))
  }

  function deleteCapture(id: string) {
    setCaptures(prev => prev.filter(c => c.id !== id))
  }

  async function saveCaptureToBank(id: string) {
    if (!bookId) return
    const cap = captures.find(c => c.id === id)
    if (!cap || cap.saved || cap.saving) return
    setCaptures(prev => prev.map(c => c.id === id ? { ...c, saving: true } : c))
    try {
      // Upload via storage
      const upRes = await fetch('/api/storage/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_url: cap.dataUrl,
          path: `captures/cap_${Date.now()}.jpg`,
        }),
      })
      const upData = await upRes.json() as { url?: string }
      if (!upRes.ok || !upData.url) throw new Error('upload failed')
      // Create asset_image dans la banque (avec sectionId si fourni pour que
      // la capture apparaisse dans la bonne section accordion — refonte 2026-05-15dt).
      const assetRes = await fetch('/api/assets/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId,
          sectionId: sectionId ?? undefined,
          url: upData.url,
          label: cap.label,
          source_type: 'capture',
        }),
      })
      if (!assetRes.ok) throw new Error('asset create failed')
      setCaptures(prev => prev.map(c => c.id === id ? { ...c, saving: false, saved: true, savedUrl: upData.url } : c))
      onCaptureSaved?.()
    } catch (err) {
      console.error('[EffectsModal] saveCaptureToBank failed:', err)
      setCaptures(prev => prev.map(c => c.id === id ? { ...c, saving: false } : c))
    }
  }

  // Auto-commit + auto-end quand la vidéo se termine pendant un record
  useEffect(() => {
    if (slowmoRecord.mode === 'idle' || !livePreviewVideoEl) return
    const v = livePreviewVideoEl
    const onEnded = () => {
      // Si on est inSlowmo et l'auteur n'a pas cliqué Reprendre, on commit endSec = duration
      const startSec = slowmoRecord.startSec
      let endSec = slowmoRecord.endSec
      if (slowmoRecord.mode === 'inSlowmo' && startSec !== null) {
        endSec = v.duration || (startSec + 1)
      }
      if (startSec !== null && endSec !== null && endSec > startSec) {
        setState(prev => ({
          ...prev,
          slowMotion: { startSec, endSec, factor: slowmoRecord.factor },
        }))
      }
      try { v.playbackRate = 1 } catch { /* noop */ }
      setSlowmoRecord(prev => ({ ...prev, mode: 'idle', countdownVal: null }))
    }
    v.addEventListener('ended', onEnded)
    return () => v.removeEventListener('ended', onEnded)
  }, [slowmoRecord, livePreviewVideoEl, setState])

  // ── Mutations état ──

  function pickLook(lookId: string | null) {
    setState(prev => ({ ...prev, look_id: lookId, custom_preset_id: null, overrides: {} }))
  }

  function toggleModule(moduleId: string) {
    setState(prev => {
      const has = prev.modules.includes(moduleId)
      const mod = findModule(moduleId)
      let nextWeather = prev.weather
      let nextSlowMotion = prev.slowMotion
      // Refonte 2026-05-15dn — Module 'time_slowmo' : init/clear state.slowMotion
      if (moduleId === 'time_slowmo') {
        if (has) {
          nextSlowMotion = null  // désactivation
        } else {
          // Init : ralenti 25%-75% à 0.5× (durée vidéo connue plus tard via slider)
          // Si videoDuration > 0, on init avec ces valeurs ; sinon valeurs par défaut.
          const dur = videoDuration || 4
          nextSlowMotion = {
            startSec: dur * 0.25,
            endSec: dur * 0.75,
            factor: 0.5,
          }
        }
      }
      // Refonte 2026-05-15de — Modules météo : push/pull le preset WeatherParams
      // associé dans state.weather. Tagué via __moduleId pour pouvoir retrouver
      // l'entry à supprimer quand le module est dé-toggle.
      if (mod?.weatherPresetKey) {
        if (has) {
          // Désactivation : retire l'entry weather correspondante
          nextWeather = (prev.weather ?? []).filter(
            (w) => (w as WeatherParams & { __moduleId?: string }).__moduleId !== moduleId,
          )
          if (nextWeather.length === 0) nextWeather = null
        } else {
          // Activation : pousse le preset par défaut tagué avec __moduleId
          const preset = WEATHER_PRESETS.find(p => p.key === mod.weatherPresetKey)
          if (preset) {
            const entry = {
              ...(preset.defaults as WeatherParams),
              preset: preset.key,
              __moduleId: moduleId,
            } as WeatherParams & { __moduleId: string }
            nextWeather = [...(prev.weather ?? []), entry]
          }
        }
      }
      return {
        ...prev,
        modules: has ? prev.modules.filter(m => m !== moduleId) : [...prev.modules, moduleId],
        custom_preset_id: null,
        weather: nextWeather,
        slowMotion: nextSlowMotion,
      }
    })
  }

  function applyUserPreset(p: UserPresetRow) {
    setState(() => ({
      look_id: p.look_id,
      modules: p.modules,
      overrides: p.overrides as ComposedEffectsState['overrides'],
      mouse_track: p.extras?.mouse_track ?? null,
      sniper_color: (p.extras?.sniper_color as 'red' | 'green' | 'black') ?? 'red',
      scope_size: p.extras?.scope_size ?? 0.22,
      custom_preset_id: p.id,
    }))
  }

  async function deleteUserPreset(p: UserPresetRow) {
    try {
      const res = await fetch(`/api/user/effects-presets?id=${p.id}`, { method: 'DELETE' })
      if (res.ok) {
        setUserPresets(prev => prev.filter(x => x.id !== p.id))
        if (state.custom_preset_id === p.id) {
          setState(prev => ({ ...prev, custom_preset_id: null }))
        }
      }
    } catch (err) {
      console.warn('[EffectsModal] deleteUserPreset failed:', err)
    }
  }

  function setOverride(key: string, value: number) {
    setState(prev => ({
      ...prev,
      overrides: { ...prev.overrides, [key]: value },
      custom_preset_id: null,
    }))
  }

  function resetChanges() {
    setState(initialSnapshot)
  }

  function clearAll() {
    setState(() => NEUTRAL_STATE)
  }

  async function savePresetPerso() {
    setSavingPreset(true)
    try {
      // Bake une mini-thumbnail de la preview (capture la frame actuelle de la vidéo)
      let thumbnailDataUrl: string | null = null
      try {
        if (livePreviewVideoEl) {
          const w = 200
          const h = Math.round(w * (9 / 16))
          const c = document.createElement('canvas')
          c.width = w; c.height = h
          const ctx = c.getContext('2d')
          if (ctx) {
            ctx.drawImage(livePreviewVideoEl, 0, 0, w, h)
            thumbnailDataUrl = c.toDataURL('image/jpeg', 0.7)
          }
        }
      } catch (err) {
        console.warn('[EffectsModal] bake preset thumbnail failed:', err)
      }

      // Upload thumbnail sur Supabase si bake réussi (pas de blob URL en DB)
      let thumbnailUrl: string | null = null
      if (thumbnailDataUrl) {
        try {
          const upRes = await fetch('/api/storage/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data_url: thumbnailDataUrl,
              path: `user-effects-presets/thumb_${Date.now()}.jpg`,
            }),
          })
          const upData = await upRes.json() as { url?: string }
          if (upRes.ok && upData.url) thumbnailUrl = upData.url
        } catch (err) {
          console.warn('[EffectsModal] upload preset thumbnail failed:', err)
        }
      }

      const res = await fetch('/api/user/effects-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          look_id: state.look_id,
          modules: state.modules,
          overrides: state.overrides,
          extras: {
            mouse_track: state.mouse_track,
            sniper_color: state.sniper_color,
            scope_size: state.scope_size,
          },
          thumbnail_url: thumbnailUrl,
        }),
      })
      if (res.ok) {
        await refreshPresets()
        setActiveCategory('mes_looks')
        // Toast feedback "Sauvé !" 1.6s
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1600)
      }
    } catch (err) {
      console.error('[EffectsModal] savePresetPerso failed:', err)
    } finally {
      setSavingPreset(false)
    }
  }

  // Phase D — Export MP4 bakeé (refonte 2026-05-15cp)
  async function handleExport() {
    if (!livePreviewVideoEl) {
      setExportError('Aucune vidéo à exporter')
      return
    }
    // Récupère le canvas WebGL + le container des overlays HTML
    const previewBox = document.querySelector<HTMLDivElement>('.efx-preview-box')
    const canvas = previewBox?.querySelector<HTMLCanvasElement>('canvas')
    if (!canvas || !previewBox) {
      setExportError('Canvas WebGL introuvable')
      return
    }
    setExporting(true)
    setExportError(null)
    setExportPct(0)
    setExportStage('capture')
    try {
      const mp4 = await exportBakedMp4({
        canvas,
        videoEl: livePreviewVideoEl,
        overlayContainer: previewBox,
        fps: 30,
        overlayHz: 10,
        includeAudio: true,
        // Refonte 2026-05-15dc — passe le state pour que le composer sache
        // dessiner les overlays canvas 2D (sniper mask non bakable via html2canvas).
        effectsState: state,
        onProgress: (pct, stage) => {
          setExportPct(pct)
          setExportStage(stage)
        },
      })
      const safeLabel = (pelliculeLabel ?? 'pellicule').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40)
      downloadBlob(mp4, `effets-${safeLabel}-${Date.now()}.mp4`)
      // Mémorise dimensions + taille pour confirmation visuelle (refonte 2026-05-15cv)
      setLastExportInfo({
        width: livePreviewVideoEl.videoWidth || 0,
        height: livePreviewVideoEl.videoHeight || 0,
        sizeMB: Math.round((mp4.size / (1024 * 1024)) * 10) / 10,
      })
      // Auto-fade après 8s
      setTimeout(() => setLastExportInfo(null), 8000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[EffectsModal] export failed:', msg)
      setExportError(msg)
    } finally {
      setExporting(false)
      setExportStage(null)
      setExportPct(0)
    }
  }

  // ── Calcul des params shader effectifs (pour la preview) ──
  const shaderParams = useMemo(() => resolveShaderParams(state), [state])

  // ── Rendering : grille de cards selon catégorie active ──
  // Refonte design 2026-05-15 — Studio pro : pas d'emoji, juste un dot
  // coloré catégoriel + label centré. L'icône Lucide vit dans la sidebar.
  const cardsToRender = useMemo(() => {
    if (activeCategory === 'mes_looks') {
      return userPresets.map((p, i) => ({
        kind: 'user_preset' as const,
        id: p.id,
        label: `Preset ${i + 1}`,
        category: 'mes_looks' as CategoryKey,
        description: 'Mon preset perso',
        active: state.custom_preset_id === p.id,
        onClick: () => applyUserPreset(p),
        onDelete: () => deleteUserPreset(p),
      }))
    }
    if (isLookCategory(activeCategory)) {
      return LOOKS.filter(l => l.category === activeCategory).map(l => ({
        kind: 'look' as const,
        id: l.id,
        label: l.label,
        category: l.category as CategoryKey,
        description: l.description,
        active: state.look_id === l.id,
        onClick: () => pickLook(l.id),
      }))
    }
    if (isModuleCategory(activeCategory)) {
      return MODULES.filter(m => m.category === activeCategory).map(m => ({
        kind: 'module' as const,
        id: m.id,
        label: m.label,
        category: m.category as CategoryKey,
        description: m.description,
        active: state.modules.includes(m.id),
        onClick: () => toggleModule(m.id),
      }))
    }
    return []
  }, [activeCategory, state, userPresets])

  // Active look (pour panel droit)
  const activeLook = findLook(state.look_id)
  // Refonte 2026-05-15co — tracking étendu : tout module avec needsMouseTrack
  // (sniper + viewfinder_photo + hud_reticle). On garde le nom `sniperActive`
  // pour la cohérence avec le block "Sniper" du panel droit qui contient les
  // options spécifiques (taille zone, couleur réticule). Les autres modules
  // trackables réutilisent juste la mécanique d'enregistrement de cible.
  const sniperActive = state.modules.includes('sniper')
  const anyTrackable = state.modules.some(mid => {
    const m = findModule(mid)
    return m?.needsMouseTrack === true
  })

  // Compteur d'actifs par catégorie (pour les badges sidebar)
  const activeCounts = useMemo(() => {
    const c: Partial<Record<CategoryKey, number>> = {}
    if (state.look_id) {
      const lk = findLook(state.look_id)
      if (lk) c[lk.category] = 1
    }
    for (const mid of state.modules) {
      const m = findModule(mid)
      if (m) c[m.category] = (c[m.category] ?? 0) + 1
    }
    if (state.custom_preset_id) c.mes_looks = 1
    return c
  }, [state])

  // Si recording, on grise sidebar + panel droit
  const recordingMode = tracker.mode !== 'idle'

  // Refonte 2026-05-15ch — Click outside DÉSACTIVÉ (pattern Figma/Photoshop) :
  // l'auteur travaille longtemps dans la modale, fermeture accidentelle = perte
  // de focus et ré-ouverture pénible. Sortie uniquement via X header ou Escape.
  // Hook AVANT early return pour respecter Rules of Hooks (ordre stable).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !recordingMode) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, recordingMode, onClose])

  if (!open) return null

  return (
    <div className="efx-modal-backdrop">
      <div className="efx-modal" role="dialog" aria-label="Bibliothèque d'effets">

        {/* ── HEADER ──────────────────────────────────────────────────── */}
        <header className="efx-header">
          <div className="efx-header-title">
            <span>Effets vidéo</span>
            {pelliculeLabel && <span className="efx-header-subtitle">— {pelliculeLabel}</span>}
            {/* Dimensions source vidéo (refonte 2026-05-15cv) */}
            {livePreviewVideoEl && livePreviewVideoEl.videoWidth > 0 && (
              <span className="efx-header-dims" title="Dimensions natives de la vidéo source">
                {livePreviewVideoEl.videoWidth}×{livePreviewVideoEl.videoHeight}
              </span>
            )}
          </div>
          <div className="efx-header-actions">
            {/* Refonte Phase D 2026-05-15cp — Export MP4 bakeé */}
            <button
              type="button"
              className="efx-header-icon-btn efx-header-export"
              onClick={handleExport}
              disabled={exporting || recordingMode || !livePreviewVideoEl}
              title={exporting
                ? `${exportStage === 'transcode' ? 'Transcodage' : 'Capture'} ${exportPct}%`
                : 'Exporter en MP4 (avec effets bakés)'}
              aria-label="Exporter MP4"
            >
              {exporting
                ? <Loader2 size={14} className="efx-spin" />
                : <Download size={14} />}
            </button>
            {/* Refonte 2026-05-15cm — Sauver le look déplacé en icon header */}
            <button
              type="button"
              className={`efx-header-icon-btn efx-header-save ${savedFlash ? 'is-saved' : ''}`}
              onClick={savePresetPerso}
              disabled={savingPreset || recordingMode}
              title={savedFlash ? 'Sauvé !' : 'Sauver le look comme preset perso'}
              aria-label="Sauver le look"
            >
              {savingPreset
                ? <Loader2 size={14} className="efx-spin" />
                : <Save size={14} />}
            </button>
            <button type="button" className="efx-btn-ghost" onClick={resetChanges}
              title="Restaure l'état avant ouverture de la modale" disabled={recordingMode}>
              <RefreshCcw size={13} />
              <span>Annuler les changements</span>
            </button>
            <button type="button" className="efx-btn-ghost" onClick={clearAll}
              title="Aucun effet (image neutre)" disabled={recordingMode}>
              Aucun effet
            </button>
            <button type="button" className="efx-btn-close" onClick={onClose}
              aria-label="Fermer" disabled={recordingMode}>
              <X size={16} />
            </button>
          </div>
        </header>

        {/* ── TOOLBAR DES EFFETS — masquée en mode='capture' (refonte 2026-05-15dq) ── */}
        {!captureModeActive && (
        <div className={`efx-cards-toolbar ${recordingMode ? 'is-disabled' : ''}`}>
          <div className="efx-cards-toolbar-meta">
            <span className="efx-cards-toolbar-count">
              {activeCategory === 'mes_looks'
                ? `${userPresets.length} preset${userPresets.length > 1 ? 's' : ''}`
                : `${cardsToRender.length} effet${cardsToRender.length > 1 ? 's' : ''}`}
            </span>
            {presetsLoading && activeCategory === 'mes_looks' && <Loader2 size={11} className="efx-spin" />}
          </div>
          <div className="efx-cards-strip-wrap">
          <div className="efx-cards-strip" key={`strip-${activeCategory}`}>
            {activeCategory === 'mes_looks' && userPresets.length === 0 && !presetsLoading && (
              <div className="efx-empty-presets-inline">
                <span className="efx-empty-presets-icon" aria-hidden>
                  <Star size={14} />
                </span>
                <span>
                  Aucun preset perso encore. Règle un look puis clique <strong>Sauver le look</strong> dans le panneau droit.
                </span>
              </div>
            )}
            {cardsToRender.map((card, idx) => {
              const meta = CATEGORY_META[card.category]
              return (
                <div
                  key={card.id}
                  role="button"
                  tabIndex={recordingMode ? -1 : 0}
                  aria-pressed={card.active}
                  aria-disabled={recordingMode}
                  className={`efx-card ${card.active ? 'is-active' : ''} ${recordingMode ? 'is-disabled' : ''}`}
                  style={{ animationDelay: `${Math.min(idx * 24, 360)}ms` }}
                  onClick={() => { if (!recordingMode) card.onClick() }}
                  onKeyDown={(e) => {
                    if (recordingMode) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      card.onClick()
                    }
                  }}
                  title={card.description}
                >
                  <span
                    className="efx-card-dot"
                    aria-hidden
                    style={{ background: meta.dot, boxShadow: `0 0 0.4rem ${meta.dot}55` }}
                  />
                  <span className="efx-card-label">{card.label}</span>
                  {card.active && <span className="efx-card-active-mark" aria-hidden />}
                  {card.kind === 'user_preset' && (
                    <button
                      type="button"
                      className="efx-card-delete"
                      onClick={(e) => { e.stopPropagation(); void card.onDelete?.() }}
                      title="Supprimer ce preset"
                      aria-label="Supprimer"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          </div>
        </div>
        )}

        {/* ── BODY 3 COLONNES (sidebar masquée en mode='capture') ──────── */}
        <div className={`efx-body ${captureModeActive ? 'is-capture-mode' : ''}`}>
          {/* Sidebar gauche — catégories. Masquée en mode capture. */}
          {!captureModeActive && (
          <nav className={`efx-sidebar ${recordingMode ? 'is-disabled' : ''}`} aria-label="Catégories">
            {CATEGORY_KEYS.map(cat => {
              const label = cat === 'mes_looks' ? 'Mes looks' : CATEGORY_LABELS[cat]
              const count = activeCounts[cat] ?? 0
              const meta = CATEGORY_META[cat]
              const Icon = meta.Icon
              return (
                <button
                  key={cat}
                  type="button"
                  className={`efx-sidebar-btn ${activeCategory === cat ? 'is-active' : ''}`}
                  onClick={() => setActiveCategory(cat)}
                  disabled={recordingMode}
                >
                  <span className="efx-sidebar-btn-icon" aria-hidden style={{ color: meta.dot }}>
                    <Icon size={14} />
                  </span>
                  <span className="efx-sidebar-btn-label">{label}</span>
                  {count > 0 && <span className="efx-sidebar-badge">{count}</span>}
                </button>
              )
            })}
          </nav>
          )}

          {/* Centre — preview live + grille de cards */}
          <main className="efx-center">
            {/* Preview live grande */}
            <div className="efx-preview-wrap">
              {videoUrl ? (
                <div ref={setPreviewBoxRef} className="efx-preview-box"
                  style={{
                    cursor: tracker.mode === 'recording' ? 'crosshair' : 'default',
                    // Refonte 2026-05-15ct — aspect-ratio dynamique = source.
                    // Override le 16:9 forcé du CSS pour matcher la vraie vidéo.
                    aspectRatio: sourceAspect.toString(),
                  }}
                >
                  <VideoEffectsCanvas
                    videoUrl={videoUrl}
                    params={shaderParams}
                    lutUrl={activeLook?.lut_url ?? null}
                    width="100%"
                    height="100%"
                    loop={tracker.mode === 'idle' && slowmoRecord.mode === 'idle'}
                    autoPlay={tracker.mode === 'idle' && slowmoRecord.mode === 'idle'}
                    onVideoElement={setLivePreviewVideoEl}
                    onAspectChange={setSourceAspect}
                  />
                  <EffectsOverlayLayer
                    state={state}
                    currentXY={tracker.currentXY}
                    sniperMaskOff={tracker.mode === 'countdown'}
                    videoEl={livePreviewVideoEl}
                  />
                  {/* Weather (refonte 2026-05-15de) — pluie/neige/brouillard/
                   *  nuages/éclairs posés par-dessus la vidéo. */}
                  <VideoWeatherLayer weather={state.weather} />
                  {/* Zone editors (refonte 2026-05-15di-dj) — rectangle ou
                   *  pinceau selon le mode de l'entry weather en cours d'édition. */}
                  {(() => {
                    const editingEntry = editingWeatherZoneIdx !== null
                      ? state.weather?.[editingWeatherZoneIdx]
                      : null
                    if (!editingEntry) return null
                    const idx = editingWeatherZoneIdx as number
                    if (editingEntry.zone?.mode === 'rect') {
                      return (
                        <WeatherZoneRectEditor
                          mode="editing"
                          committedRect={editingEntry.zone.rect ?? null}
                          onCommit={(rect) => {
                            setState(prev => ({
                              ...prev,
                              weather: (prev.weather ?? []).map((e, i) =>
                                i === idx ? { ...e, zone: { mode: 'rect', rect } } : e,
                              ),
                            }))
                          }}
                          onCancel={() => setEditingWeatherZoneIdx(null)}
                        />
                      )
                    }
                    if (editingEntry.zone?.mode === 'brush') {
                      const z = editingEntry.zone
                      return (
                        <WeatherZoneBrushEditor
                          mode="editing"
                          committedStrokes={(z.strokes ?? []).map(s => ({
                            points: s.points,
                            radius: s.radius,
                            mode: s.mode,
                          }))}
                          brushSize={z.brushSize ?? 0.04}
                          brushMode={z.brushMode ?? 'paint'}
                          onCommitStroke={(stroke) => {
                            setState(prev => ({
                              ...prev,
                              weather: (prev.weather ?? []).map((e, i) => {
                                if (i !== idx) return e
                                const ez = e.zone
                                if (ez?.mode !== 'brush') return e
                                return {
                                  ...e,
                                  zone: {
                                    ...ez,
                                    strokes: [...(ez.strokes ?? []), {
                                      points: stroke.points,
                                      radius: stroke.radius,
                                      mode: stroke.mode,
                                    }],
                                  },
                                }
                              }),
                            }))
                          }}
                          onCancel={() => setEditingWeatherZoneIdx(null)}
                        />
                      )
                    }
                    return null
                  })()}
                  {/* Éditeur impact zone (M4b refonte 2026-05-15dk) — rect ou
                   *  brush ciblant impactZones[i] de l'effet weather actif. */}
                  {(() => {
                    if (!editingImpact) return null
                    const w = state.weather?.[editingImpact.wIdx]
                    const iz = w?.impactZones?.[editingImpact.iIdx]
                    if (!iz) return null
                    const wIdx = editingImpact.wIdx
                    const iIdx = editingImpact.iIdx
                    const patchImpact = (zonePatch: Partial<typeof iz.zone> | { strokes: typeof iz.zone.strokes }) => {
                      setState(prev => ({
                        ...prev,
                        weather: (prev.weather ?? []).map((e, i) => {
                          if (i !== wIdx) return e
                          const izs = e.impactZones ?? []
                          return {
                            ...e,
                            impactZones: izs.map((z, j) => j === iIdx
                              ? { ...z, zone: { ...z.zone, ...zonePatch } as typeof z.zone }
                              : z,
                            ),
                          }
                        }),
                      }))
                    }
                    if (iz.zone?.mode === 'rect') {
                      return (
                        <WeatherZoneRectEditor
                          mode="editing"
                          accent="#fbbf24"
                          committedRect={iz.zone.rect ?? null}
                          onCommit={(rect) => patchImpact({ mode: 'rect', rect })}
                          onCancel={() => setEditingImpact(null)}
                        />
                      )
                    }
                    if (iz.zone?.mode === 'brush') {
                      const z = iz.zone
                      return (
                        <WeatherZoneBrushEditor
                          mode="editing"
                          accent="#fbbf24"
                          committedStrokes={(z.strokes ?? []).map(s => ({
                            points: s.points,
                            radius: s.radius,
                            mode: s.mode,
                          }))}
                          brushSize={z.brushSize ?? 0.04}
                          brushMode={z.brushMode ?? 'paint'}
                          onCommitStroke={(stroke) => {
                            patchImpact({
                              strokes: [...(z.strokes ?? []), {
                                points: stroke.points,
                                radius: stroke.radius,
                                mode: stroke.mode,
                              }],
                            })
                          }}
                          onCancel={() => setEditingImpact(null)}
                        />
                      )
                    }
                    return null
                  })()}
                  {/* Visualisation OUTLINE permanent du rect committed pour TOUS
                   *  les effets weather en mode rect (même hors mode édition).
                   *  L'auteur voit en permanence où la pluie tombe. */}
                  {state.weather && state.weather.map((w, idx) => (
                    w.zone?.mode === 'rect' && w.zone.rect && editingWeatherZoneIdx !== idx ? (
                      <WeatherZoneRectEditor
                        key={`zone-view-${idx}`}
                        mode="view"
                        committedRect={w.zone.rect}
                      />
                    ) : null
                  ))}
                  {/* Countdown overlay (sniper OU slowmo) */}
                  {tracker.mode === 'countdown' && tracker.countdownValue !== null && (
                    <div className="efx-countdown">{tracker.countdownValue}</div>
                  )}
                  {slowmoRecord.mode === 'countdown' && slowmoRecord.countdownVal !== null && (
                    <div className="efx-countdown">{slowmoRecord.countdownVal}</div>
                  )}
                  {/* Hint inSlowmo / preroll pour guider l'auteur */}
                  {(slowmoRecord.mode === 'preroll' || slowmoRecord.mode === 'inSlowmo') && (
                    <div className="efx-slowmo-record-hint">
                      {slowmoRecord.mode === 'preroll'
                        ? '▶ Lecture normale — clique "Démarrer ralenti" au bon moment'
                        : `🐢 Ralenti ${slowmoRecord.factor.toFixed(2)}× — clique "Reprendre" pour finir`}
                    </div>
                  )}
                  {/* REC indicator + bouton Stop accessible (panel droit grisé) */}
                  {tracker.mode === 'recording' && (
                    <>
                      <div className="efx-rec-badge">● REC</div>
                      <button
                        type="button"
                        className="efx-rec-stop-btn"
                        onClick={tracker.stop}
                        title="Arrêter l'enregistrement"
                      >
                        ■ Arrêter
                      </button>
                    </>
                  )}
                  {tracker.mode === 'countdown' && (
                    <button
                      type="button"
                      className="efx-rec-stop-btn"
                      onClick={tracker.stop}
                      title="Annuler le countdown"
                      style={{ zIndex: 30 }}
                    >
                      ✕ Annuler
                    </button>
                  )}
                  {/* Phase D — Progress overlay export MP4 (refonte 2026-05-15cp) */}
                  {exporting && (
                    <div className="efx-export-overlay" aria-live="polite">
                      <div className="efx-export-stage">
                        {exportStage === 'transcode' ? 'Transcodage MP4…' : 'Capture des effets…'}
                      </div>
                      <div className="efx-export-bar"><div className="efx-export-bar-fill" style={{ width: `${exportPct}%` }} /></div>
                      <div className="efx-export-pct">{exportPct}%</div>
                    </div>
                  )}
                  {exportError && !exporting && (
                    <div className="efx-export-error">⚠ Export échoué : {exportError}</div>
                  )}
                  {lastExportInfo && !exporting && (
                    <div className="efx-export-info">
                      ✓ MP4 téléchargé · {lastExportInfo.width}×{lastExportInfo.height} · {lastExportInfo.sizeMB} MB
                    </div>
                  )}
                </div>
              ) : fallbackImageUrl ? (
                <div className="efx-preview-box">
                  <img src={fallbackImageUrl} alt="Aperçu" style={{
                    width: '100%', height: '100%', objectFit: 'cover',
                  }} />
                  <div className="efx-no-video-hint">
                    Aucune vidéo — preview statique. Les effets shader ne s'appliquent
                    pas sur image fixe (V2 : bake côté image).
                  </div>
                </div>
              ) : (
                <div className="efx-preview-empty">
                  <span>Pas de média à prévisualiser.</span>
                </div>
              )}
            </div>

          </main>

          {/* Sidebar droite — sliders fins + sauver. Refonte 2026-05-15cl —
           *  badge héros pour Look actif, sliders en grid 2 cols, Sniper dans
           *  block bordé, save avec toast. En mode='capture' : seuls le block
           *  capture est visible (refonte 2026-05-15dq). */}
          <aside className={`efx-right ${recordingMode ? 'is-disabled' : ''} ${captureModeActive ? 'is-capture-mode' : ''}`}>
            {/* ── Badge héros : Look actif (masqué en mode capture via CSS) ── */}
            <div className="efx-right-section efx-hero-section">
              <div className="efx-right-section-title">Look actif</div>
              {activeLook ? (
                <div
                  className="efx-hero-badge"
                  style={{
                    background: `linear-gradient(135deg, ${CATEGORY_META[activeLook.category].dot}22 0%, ${CATEGORY_META[activeLook.category].dot}08 100%)`,
                    borderColor: `${CATEGORY_META[activeLook.category].dot}50`,
                  }}
                >
                  <span
                    className="efx-hero-badge-icon"
                    style={{ color: CATEGORY_META[activeLook.category].dot }}
                    aria-hidden
                  >
                    {(() => {
                      const Icon = CATEGORY_META[activeLook.category].Icon
                      return <Icon size={16} />
                    })()}
                  </span>
                  <span className="efx-hero-badge-label">{activeLook.label}</span>
                  <span
                    className="efx-hero-badge-dot"
                    aria-hidden
                    style={{
                      background: CATEGORY_META[activeLook.category].dot,
                      boxShadow: `0 0 0.5rem ${CATEGORY_META[activeLook.category].dot}`,
                    }}
                  />
                </div>
              ) : (
                <div className="efx-hero-badge efx-hero-badge-empty">
                  <em>Aucun look — image neutre</em>
                </div>
              )}
              {state.modules.length > 0 && (
                <div className="efx-right-modules">
                  {state.modules.map(mid => {
                    const m = findModule(mid)
                    if (!m) return null
                    const dotColor = CATEGORY_META[m.category].dot
                    return (
                      <span key={mid} className="efx-mod-chip"
                        style={{ borderColor: `${dotColor}50` }}
                      >
                        <span className="efx-mod-chip-dot" aria-hidden style={{ background: dotColor }} />
                        {m.label}
                        <button type="button" onClick={() => toggleModule(mid)}
                          aria-label={`Retirer ${m.label}`} title={`Retirer ${m.label}`}>×</button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Sliders fins (color basics) — affichés UNIQUEMENT pour les
             *  catégories LUT (mes_looks/cinema/surveillance/glitch). Refonte
             *  2026-05-15dl — masqué sur cible/cadre/ambiance/météo car ces
             *  catégories n'utilisent pas les sliders de color grading. */}
            {(activeCategory === 'mes_looks' || isLookCategory(activeCategory)) && (
            <div className="efx-right-section">
              <div className="efx-right-section-title">Réglages fins</div>
              <div className="efx-sliders-grid">
                <FineSlider label="Lum." value={shaderParams.brightness ?? 0}
                  min={-1} max={1} step={0.01} onChange={v => setOverride('brightness', v)} />
                <FineSlider label="Contr." value={shaderParams.contrast ?? 0}
                  min={-1} max={1} step={0.01} onChange={v => setOverride('contrast', v)} />
                <FineSlider label="Satur." value={shaderParams.saturate ?? 0}
                  min={-1} max={1} step={0.01} onChange={v => setOverride('saturate', v)} />
                <FineSlider label="Teinte" value={shaderParams.hue ?? 0}
                  min={-1} max={1} step={0.01} onChange={v => setOverride('hue', v)} />
                <FineSlider label="Vign." value={shaderParams.vignette ?? 0}
                  min={0} max={1} step={0.01} onChange={v => setOverride('vignette', v)} />
                <FineSlider label="Grain" value={shaderParams.filmGrain ?? 0}
                  min={0} max={1} step={0.01} onChange={v => setOverride('filmGrain', v)} />
              </div>
            </div>
            )}

            {/* ── Block Suivi de cible si AU MOINS UN module trackable actif ──
             *  Refonte 2026-05-15co — le record est partagé par sniper +
             *  viewfinder + hud_reticle. Les options sniper-spécifiques
             *  (taille zone, couleur réticule) ne s'affichent QUE si sniper actif. */}
            {anyTrackable && (
              <div className="efx-right-section efx-sniper-block">
                <div className="efx-right-section-title">
                  <CrosshairIcon size={11} style={{ verticalAlign: '-0.1rem', marginRight: '0.3rem', color: CATEGORY_META.cible.dot }} />
                  Suivi de cible
                </div>
                {sniperActive && (
                  <>
                    <FineSlider label="Taille" value={state.scope_size ?? 0.22}
                      min={0.05} max={0.5} step={0.01}
                      onChange={v => setState(prev => ({ ...prev, scope_size: v }))} />
                    <div className="efx-color-row">
                      <span className="efx-color-row-label">Réticule</span>
                      <div className="efx-color-dots">
                        {(['red', 'green', 'black'] as const).map(c => (
                          <button
                            key={c}
                            type="button"
                            className={`efx-color-dot ${state.sniper_color === c ? 'is-active' : ''}`}
                            onClick={() => setState(prev => ({ ...prev, sniper_color: c }))}
                            style={{ background: c === 'red' ? '#ff2d2d' : c === 'green' ? '#39ff14' : '#000' }}
                            title={`Réticule ${c}`}
                            aria-label={`Réticule ${c}`}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {/* Boutons record + aperçu trajectoire (refonte 2026-05-15cz)
                 *  Aperçu : rejoue la vidéo avec la trajectoire enregistrée
                 *  pour valider avant l'export MP4. */}
                <div className="efx-sniper-actions">
                  {tracker.mode === 'idle' && (
                    <>
                      <button type="button" className="efx-btn-record"
                        onClick={tracker.start} disabled={!videoUrl}
                        title="Enregistrer la trajectoire de la cible">
                        <Crosshair size={11} />
                        <span>{tracker.points.length > 0 ? 'Réenregistrer' : 'Enregistrer cible'}</span>
                      </button>
                      {tracker.points.length > 0 && (
                        <button type="button" className="efx-btn-preview"
                          onClick={tracker.play} disabled={!videoUrl}
                          title="Rejouer la vidéo avec la trajectoire enregistrée">
                          <span>▶ Aperçu</span>
                        </button>
                      )}
                    </>
                  )}
                  {tracker.mode === 'playing' && (
                    <button type="button" className="efx-btn-record is-stop" onClick={tracker.stop}>
                      <span>■ Stop aperçu</span>
                    </button>
                  )}
                  {(tracker.mode === 'recording' || tracker.mode === 'countdown') && (
                    <button type="button" className="efx-btn-record is-stop" onClick={tracker.stop}>
                      <span>■ Stop record</span>
                    </button>
                  )}
                  {tracker.points.length > 0 && tracker.mode === 'idle' && (
                    <span className="efx-track-count">{tracker.points.length} pts enregistrés</span>
                  )}
                </div>
              </div>
            )}

            {/* ── Block Météo (refonte 2026-05-15dh — M2 sliders fins par effet)
             *  Pour chaque entry weather active, expose les sliders pertinents
             *  (density, speed, angle, opacité, trail rain only, depth, lightning…). */}
            {state.weather && state.weather.length > 0 && (
              <div className="efx-right-section efx-weather-block">
                <div className="efx-right-section-title">
                  <CloudRain size={11} style={{ verticalAlign: '-0.1rem', marginRight: '0.3rem', color: '#60A5FA' }} />
                  Réglages météo
                </div>
                {state.weather.map((w, idx) => {
                  const tagged = w as WeatherParams & { __moduleId?: string }
                  const mid = tagged.__moduleId
                  const mod = mid ? findModule(mid) : null
                  const label = mod?.label ?? w.preset ?? w.kind
                  const updateEntry = (patch: Partial<WeatherParams>) => {
                    setState(prev => ({
                      ...prev,
                      weather: (prev.weather ?? []).map((e, i) => i === idx ? { ...e, ...patch } : e),
                    }))
                  }
                  return (
                    <div key={`weather-cfg-${idx}`} className="efx-weather-entry">
                      <div className="efx-weather-entry-title">{label}</div>
                      <div className="efx-sliders-grid">
                        {/* Density : pluie 50-500, neige 30-300, brouillard 3-12, cloud 1-15 */}
                        {(w.kind === 'rain' || w.kind === 'snow') && (
                          <FineSlider label="Densité" value={w.density ?? 100}
                            min={20} max={500} step={5}
                            onChange={v => updateEntry({ density: v })} />
                        )}
                        {w.kind === 'fog' && (
                          <FineSlider label="Volutes" value={w.density ?? 9}
                            min={2} max={20} step={1}
                            onChange={v => updateEntry({ density: v })} />
                        )}
                        {w.kind === 'cloud' && (
                          <FineSlider label="Nuages" value={w.density ?? 8}
                            min={1} max={20} step={1}
                            onChange={v => updateEntry({ density: v })} />
                        )}
                        {/* Vitesse — tous sauf lightning */}
                        {w.kind !== 'lightning' && (
                          <FineSlider label="Vitesse" value={w.speed ?? 1}
                            min={0.25} max={2} step={0.05}
                            onChange={v => updateEntry({ speed: v })} />
                        )}
                        {/* Angle vent — pluie/neige */}
                        {(w.kind === 'rain' || w.kind === 'snow') && (
                          <FineSlider label="Vent °" value={w.angle ?? 0}
                            min={-45} max={45} step={1}
                            onChange={v => updateEntry({ angle: v })} />
                        )}
                        {/* Trail length — rain only */}
                        {w.kind === 'rain' && (
                          <FineSlider label="Trait" value={w.trailLength ?? 14}
                            min={4} max={40} step={1}
                            onChange={v => updateEntry({ trailLength: v })} />
                        )}
                        {/* Opacité particules */}
                        {w.kind !== 'lightning' && (
                          <FineSlider label="Opacité" value={w.particleOpacity ?? 1}
                            min={0} max={1} step={0.05}
                            onChange={v => updateEntry({ particleOpacity: v })} />
                        )}
                        {/* Lightning : luminosité, halo, fréquence */}
                        {w.kind === 'lightning' && (
                          <>
                            <FineSlider label="Lumière" value={w.lightningBrightness ?? 0.7}
                              min={0} max={1} step={0.05}
                              onChange={v => updateEntry({ lightningBrightness: v })} />
                            <FineSlider label="Halo" value={w.lightningHaloIntensity ?? 0.6}
                              min={0} max={1} step={0.05}
                              onChange={v => updateEntry({ lightningHaloIntensity: v })} />
                            <FineSlider label="Fréq." value={w.lightningFrequency ?? 0.4}
                              min={0} max={1} step={0.05}
                              onChange={v => updateEntry({ lightningFrequency: v })} />
                          </>
                        )}
                      </div>
                      {/* Zone — toggle Plein écran / Rectangle / Pinceau
                       *  (refonte 2026-05-15di-dj : M3 rect + M4 brush). */}
                      {w.kind !== 'lightning' && (
                        <>
                          <div className="efx-zone-row">
                            <span className="efx-zone-label">Zone :</span>
                            <div className="efx-zone-tabs">
                              <button
                                type="button"
                                className={`efx-zone-tab ${(w.zone?.mode ?? 'full') === 'full' ? 'is-active' : ''}`}
                                onClick={() => {
                                  updateEntry({ zone: { mode: 'full' } })
                                  if (editingWeatherZoneIdx === idx) setEditingWeatherZoneIdx(null)
                                }}
                              >Plein</button>
                              <button
                                type="button"
                                className={`efx-zone-tab ${w.zone?.mode === 'rect' ? 'is-active' : ''}`}
                                onClick={() => {
                                  updateEntry({ zone: { mode: 'rect', rect: w.zone?.rect } })
                                  setEditingWeatherZoneIdx(idx)
                                }}
                              >Rect</button>
                              <button
                                type="button"
                                className={`efx-zone-tab ${w.zone?.mode === 'brush' ? 'is-active' : ''}`}
                                onClick={() => {
                                  updateEntry({ zone: {
                                    mode: 'brush',
                                    strokes: w.zone?.strokes ?? [],
                                    brushSize: w.zone?.brushSize ?? 0.04,
                                    brushMode: w.zone?.brushMode ?? 'paint',
                                  } })
                                  setEditingWeatherZoneIdx(idx)
                                }}
                              >Pinceau</button>
                            </div>
                            {(w.zone?.mode === 'rect' || w.zone?.mode === 'brush') && (
                              <button
                                type="button"
                                className="efx-zone-edit-btn"
                                onClick={() => setEditingWeatherZoneIdx(editingWeatherZoneIdx === idx ? null : idx)}
                              >
                                {editingWeatherZoneIdx === idx ? 'Terminer' : 'Éditer'}
                              </button>
                            )}
                          </div>
                          {/* Sub-controls brush : taille + paint/erase */}
                          {w.zone?.mode === 'brush' && (
                            <div className="efx-brush-controls">
                              <FineSlider
                                label="Taille"
                                value={w.zone.brushSize ?? 0.04}
                                min={0.005} max={0.12} step={0.005}
                                onChange={v => updateEntry({ zone: { ...w.zone!, brushSize: v } })}
                              />
                              <div className="efx-brush-mode-row">
                                <button
                                  type="button"
                                  className={`efx-brush-mode-btn ${(w.zone.brushMode ?? 'paint') === 'paint' ? 'is-active' : ''}`}
                                  onClick={() => updateEntry({ zone: { ...w.zone!, brushMode: 'paint' } })}
                                >+ Ajouter</button>
                                <button
                                  type="button"
                                  className={`efx-brush-mode-btn ${w.zone.brushMode === 'erase' ? 'is-erase' : ''}`}
                                  onClick={() => updateEntry({ zone: { ...w.zone!, brushMode: 'erase' } })}
                                >− Retirer</button>
                                {(w.zone.strokes?.length ?? 0) > 0 && (
                                  <button
                                    type="button"
                                    className="efx-brush-clear-btn"
                                    onClick={() => updateEntry({ zone: { ...w.zone!, strokes: [] } })}
                                    title="Effacer toute la zone peinte"
                                  >Vider</button>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {/* M4b — Impact zones (rain only). Refonte 2026-05-15dk.
                       *  Liste de zones où les gouttes tombent + surface
                       *  associée (water/hard/soft/glass). */}
                      {w.kind === 'rain' && (
                        <ImpactZonesSubBlock
                          weather={w}
                          weatherIdx={idx}
                          editingImpact={editingImpact}
                          onSetEditingImpact={setEditingImpact}
                          onUpdateImpactZones={(updater) => {
                            setState(prev => ({
                              ...prev,
                              weather: (prev.weather ?? []).map((e, i) =>
                                i === idx ? { ...e, impactZones: updater(e.impactZones ?? []) } : e,
                              ),
                            }))
                          }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Block Capture d'image (refonte 2026-05-15dp) ──
             *  Slider scrub + bouton snapshot local + grid miniatures.
             *  Sauvegarde EXPLICITE par capture pour éviter la pollution
             *  de la banque images du livre. */}
            {captureActive && (() => {
              const dur = videoDuration || (livePreviewVideoEl?.duration ?? 0) || 1
              return (
                <div className="efx-right-section efx-capture-block">
                  <div className="efx-right-section-title">
                    <Camera size={11} style={{ verticalAlign: '-0.1rem', marginRight: '0.3rem', color: '#22d3ee' }} />
                    Capture d'image
                  </div>
                  {/* Slider scrub */}
                  <div className="efx-capture-scrub">
                    <div className="efx-capture-scrub-row">
                      <input
                        type="range"
                        min={0} max={dur} step={0.05}
                        value={scrubTime}
                        onChange={(e) => scrubTo(parseFloat(e.target.value))}
                        className="efx-capture-scrub-input"
                      />
                      <span className="efx-capture-scrub-time">{scrubTime.toFixed(1)}s</span>
                    </div>
                    <button
                      type="button"
                      className="efx-btn-primary efx-capture-btn"
                      onClick={captureCurrentFrame}
                      disabled={!livePreviewVideoEl}
                      title="Capturer la frame courante (local, sauvegarde explicite ensuite)"
                    >
                      <Camera size={11} />
                      <span>Capturer cette frame</span>
                    </button>
                  </div>
                  {/* Refonte 2026-05-16 (mode capture single) — 1 grande image
                   *  active avec label + 3 boutons : Sauver / Sauver et couper
                   *  la vidéo / Supprimer. Layout single = plus d'espace, pas
                   *  de scroll de liste. En mode='effects' (legacy), comportement
                   *  liste préservé. */}
                  {captures.length === 0 ? (
                    <div className="efx-capture-empty">
                      Aucune capture. Scrub la timeline puis clique « Capturer cette frame ».
                    </div>
                  ) : captureModeActive ? (
                    // ── SINGLE mode ──
                    (() => {
                      // Affiche la dernière capture (= unsaved courante si présente,
                      // sinon la dernière sauvée).
                      const cap = captures[captures.length - 1]
                      return (
                        <div className={`efx-capture-single ${cap.saved ? 'is-saved' : ''}`}>
                          <div className="efx-capture-single-thumb-wrap">
                            <button
                              type="button"
                              className="efx-capture-single-thumb"
                              onClick={() => setLightboxIdx(captures.length - 1)}
                              title="Voir en grand"
                            >
                              <img src={cap.dataUrl} alt={cap.label} />
                              <span className="efx-capture-single-time">{cap.timestamp.toFixed(2)}s</span>
                            </button>
                            {/* Bouton 🗑️ overlay top-right au hover, cohérent
                             *  avec les tiles banque (refonte 2026-05-16). */}
                            {!cap.saved && (
                              <button
                                type="button"
                                className="efx-capture-delete-overlay"
                                onClick={(e) => { e.stopPropagation(); deleteCapture(cap.id) }}
                                title="Supprimer cette capture (non sauvegardée)"
                                aria-label="Supprimer"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                          <input
                            type="text"
                            className="efx-capture-label-input"
                            value={cap.label}
                            onChange={(e) => updateCaptureLabel(cap.id, e.target.value)}
                            placeholder="Label de l'image"
                            disabled={cap.saved}
                          />
                          {!cap.saved ? (
                            <div className="efx-capture-actions-single">
                              <button
                                type="button"
                                className="efx-capture-action-btn efx-capture-action-save"
                                onClick={() => saveCaptureToBank(cap.id)}
                                disabled={cap.saving || !bookId}
                                title={bookId ? 'Sauver l\'image dans la banque' : 'bookId manquant'}
                              >
                                {cap.saving ? <Loader2 size={12} className="efx-spin" /> : <Save size={12} />}
                                <span>Sauver l&apos;image</span>
                              </button>
                              {onCaptureAndTrim && (
                                <button
                                  type="button"
                                  className="efx-capture-action-btn efx-capture-action-trim"
                                  onClick={() => setConfirmTrimCapId(cap.id)}
                                  disabled={cap.saving || trimInFlight || !bookId}
                                  title="Sauve l'image dans la banque ET coupe la vidéo à ce timecode"
                                >
                                  <Save size={12} />
                                  <span>Sauver + couper</span>
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="efx-capture-saved-tag">✓ Image sauvée</span>
                          )}
                        </div>
                      )
                    })()
                  ) : (
                    // ── LIST mode (legacy effects toggle) ──
                    <div className="efx-capture-grid">
                      {captures.map((cap, idx) => (
                        <div key={cap.id} className={`efx-capture-tile ${cap.saved ? 'is-saved' : ''}`}>
                          <button
                            type="button"
                            className="efx-capture-thumb"
                            onClick={() => setLightboxIdx(idx)}
                            title="Voir en grand"
                          >
                            <img src={cap.dataUrl} alt={cap.label} />
                            <span className="efx-capture-thumb-time">{cap.timestamp.toFixed(1)}s</span>
                          </button>
                          <input
                            type="text"
                            className="efx-capture-label-input"
                            value={cap.label}
                            onChange={(e) => updateCaptureLabel(cap.id, e.target.value)}
                            placeholder="Label"
                            disabled={cap.saved}
                          />
                          <div className="efx-capture-actions">
                            {!cap.saved ? (
                              <>
                                <button
                                  type="button"
                                  className="efx-capture-save-btn"
                                  onClick={() => saveCaptureToBank(cap.id)}
                                  disabled={cap.saving || !bookId}
                                  title={bookId ? 'Sauver dans la banque images du livre' : 'bookId manquant'}
                                >
                                  {cap.saving ? <Loader2 size={10} className="efx-spin" /> : <Save size={10} />}
                                  <span>Sauver</span>
                                </button>
                                <button
                                  type="button"
                                  className="efx-capture-delete-btn"
                                  onClick={() => deleteCapture(cap.id)}
                                  title="Supprimer (jamais sauvegardée)"
                                  aria-label="Supprimer"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </>
                            ) : (
                              <span className="efx-capture-saved-tag">✓ Sauvée</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!bookId && (
                    <div className="efx-capture-warn">
                      ⚠ bookId manquant — sauvegarde désactivée (capture locale seulement)
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ── Block Ralenti (refonte 2026-05-15do — UX record interactif
             *  type sniper). Visible si module time_slowmo actif. */}
            {state.modules.includes('time_slowmo') && (() => {
              const sm = state.slowMotion
              const dur = videoDuration || (livePreviewVideoEl?.duration ?? 0) || 4
              const rm = slowmoRecord.mode
              return (
                <div className="efx-right-section efx-slowmo-block">
                  <div className="efx-right-section-title">
                    <Clock size={11} style={{ verticalAlign: '-0.1rem', marginRight: '0.3rem', color: '#A78BFA' }} />
                    Ralenti
                  </div>
                  {/* Slider vitesse — paramètre AVANT le record */}
                  <FineSlider
                    label="Vitesse ralenti"
                    value={slowmoRecord.factor}
                    min={0.25} max={1} step={0.05}
                    onChange={(v) => {
                      setSlowmoRecord(prev => ({ ...prev, factor: v }))
                      // Si déjà enregistré, mettre à jour aussi le state.slowMotion
                      if (sm) setState(prev => ({
                        ...prev,
                        slowMotion: prev.slowMotion ? { ...prev.slowMotion, factor: v } : null,
                      }))
                    }}
                  />
                  {/* Boutons selon mode record */}
                  <div className="efx-slowmo-actions">
                    {rm === 'idle' && (
                      <>
                        <button type="button" className="efx-btn-record"
                          onClick={slowmoStart} disabled={!videoUrl}
                          title="Lancer le record : countdown 3-2-1 puis lecture">
                          <Clock size={11} />
                          <span>{sm ? 'Réenregistrer' : 'Enregistrer ralenti'}</span>
                        </button>
                        {sm && (
                          <>
                            <button type="button" className="efx-btn-preview"
                              onClick={() => {
                                if (livePreviewVideoEl) {
                                  livePreviewVideoEl.currentTime = 0
                                  void livePreviewVideoEl.play().catch(() => {/* noop */})
                                }
                              }}
                              title="Rejouer la vidéo avec le ralenti enregistré">
                              <span>▶ Aperçu</span>
                            </button>
                            <button type="button" className="efx-btn-record is-stop"
                              onClick={() => {
                                setState(prev => ({ ...prev, slowMotion: null }))
                                if (livePreviewVideoEl) try { livePreviewVideoEl.playbackRate = 1 } catch { /* noop */ }
                              }}
                              title="Supprimer le ralenti enregistré">
                              <span>✕ Effacer</span>
                            </button>
                          </>
                        )}
                      </>
                    )}
                    {rm === 'countdown' && (
                      <button type="button" className="efx-btn-record is-stop" onClick={slowmoCancel}>
                        <span>✕ Annuler</span>
                      </button>
                    )}
                    {rm === 'preroll' && (
                      <>
                        <button type="button" className="efx-btn-preview"
                          onClick={slowmoMarkStart}
                          title="Bascule la vidéo en ralenti maintenant">
                          <span>🐢 Démarrer ralenti</span>
                        </button>
                        <button type="button" className="efx-btn-record is-stop" onClick={slowmoCancel}>
                          <span>✕</span>
                        </button>
                      </>
                    )}
                    {rm === 'inSlowmo' && (
                      <>
                        <button type="button" className="efx-btn-preview"
                          onClick={slowmoMarkEnd}
                          title="Termine le ralenti et reprend la vitesse normale">
                          <span>▶ Reprendre</span>
                        </button>
                        <button type="button" className="efx-btn-record is-stop" onClick={slowmoCancel}>
                          <span>✕</span>
                        </button>
                      </>
                    )}
                    {rm === 'postroll' && (
                      <span className="efx-slowmo-hint">Lecture en cours… ({slowmoRecord.endSec?.toFixed(1) ?? '?'}s marqué)</span>
                    )}
                  </div>
                  {/* Récap zone enregistrée */}
                  {sm && rm === 'idle' && (
                    <div className="efx-slowmo-duration">
                      Zone : <strong>{sm.startSec.toFixed(1)}s → {sm.endSec.toFixed(1)}s</strong>
                      {' à '}
                      <strong>{sm.factor.toFixed(2)}×</strong>
                      <br />
                      Durée : {dur.toFixed(1)}s → <strong>{(dur + (sm.endSec - sm.startSec) * (1 / Math.max(0.1, sm.factor) - 1)).toFixed(1)}s</strong>
                    </div>
                  )}
                </div>
              )
            })()}

          </aside>
        </div>

      </div>

      {/* ── Lightbox carrousel des captures (refonte 2026-05-15dp) ── */}
      {lightboxIdx !== null && captures[lightboxIdx] && (
        <div className="efx-lightbox-backdrop" onClick={() => setLightboxIdx(null)}>
          <div className="efx-lightbox-frame" onClick={(e) => e.stopPropagation()}>
            <img
              src={captures[lightboxIdx].dataUrl}
              alt={captures[lightboxIdx].label}
              className="efx-lightbox-img"
            />
            <div className="efx-lightbox-bar">
              <span className="efx-lightbox-label">{captures[lightboxIdx].label}</span>
              <span className="efx-lightbox-time">{captures[lightboxIdx].timestamp.toFixed(2)}s</span>
              <span className="efx-lightbox-pos">{lightboxIdx + 1} / {captures.length}</span>
            </div>
            {lightboxIdx > 0 && (
              <button type="button" className="efx-lightbox-nav efx-lightbox-prev"
                onClick={() => setLightboxIdx(i => (i !== null && i > 0 ? i - 1 : i))}
                aria-label="Précédent">
                <ChevronLeft size={28} />
              </button>
            )}
            {lightboxIdx < captures.length - 1 && (
              <button type="button" className="efx-lightbox-nav efx-lightbox-next"
                onClick={() => setLightboxIdx(i => (i !== null && i < captures.length - 1 ? i + 1 : i))}
                aria-label="Suivant">
                <ChevronRight size={28} />
              </button>
            )}
            <button type="button" className="efx-lightbox-close"
              onClick={() => setLightboxIdx(null)} aria-label="Fermer">
              <X size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Confirm "Sauver et couper la vidéo" (refonte 2026-05-16) */}
      {confirmTrimCapId !== null && (() => {
        const cap = captures.find(c => c.id === confirmTrimCapId)
        if (!cap) return null
        return (
          <ConfirmDialog
            open={true}
            title="Sauver l'image et couper la vidéo ?"
            message={
              <div>
                <p style={{ margin: 0 }}>
                  L&apos;image sera ajoutée à la banque, et la vidéo sera
                  raccourcie pour s&apos;arrêter à <strong>{cap.timestamp.toFixed(2)}s</strong>.
                </p>
                <p style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: 'var(--ie-text-muted, #a1a1aa)' }}>
                  Tu pourras ensuite démarrer une nouvelle vidéo depuis cette image. La
                  vidéo source reste intacte côté serveur — seule la durée de lecture
                  est modifiée (réversible).
                </p>
              </div>
            }
            variant="danger"
            confirmLabel="Sauver + couper"
            cancelLabel="Annuler"
            loading={trimInFlight}
            onCancel={() => setConfirmTrimCapId(null)}
            onConfirm={async () => {
              if (!onCaptureAndTrim) return
              setTrimInFlight(true)
              try {
                await onCaptureAndTrim({
                  dataUrl: cap.dataUrl,
                  label: cap.label,
                  timestamp: cap.timestamp,
                })
                // Le parent ferme la modale et refresh — pas besoin de cleanup ici
              } catch (err) {
                console.error('[EffectsModal] onCaptureAndTrim failed:', err)
                alert(`Échec : ${err instanceof Error ? err.message : String(err)}`)
              } finally {
                setTrimInFlight(false)
                setConfirmTrimCapId(null)
              }
            }}
          />
        )
      })()}

      {/* CSS global de la modal — un seul style jsx pour éviter "nested styled-jsx tag". */}
      <style jsx global>{EFFECTS_MODAL_CSS}</style>
    </div>
  )
}

// ─── Sub-component : Slider fin ───────────────────────────────────────────

function FineSlider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <label className="efx-slider-row">
      <div className="efx-slider-row-header">
        <span className="efx-slider-label">{label}</span>
        <span className="efx-slider-value">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="efx-slider-input"
      />
    </label>
  )
}

// ─── CSS (unités relatives, design rose vif Hero, dark theme) ─────────────

const EFFECTS_MODAL_CSS = `
/* ── EffectsModal — refonte design 2026-05-15 ───────────────────────────────
 * Variables Hero (--ie-*) inlinées sur .efx-modal pour rester scoped même si
 * le composant n'est pas monté sous .as-root / .dz-root. Palette dark Hero.
 *
 * Décisions design :
 *   - Cards SANS emoji : un dot coloré catégoriel (top-left) + label centré.
 *     L'icône Lucide vit dans la sidebar gauche (1 par catégorie).
 *   - Layout central FIX : .efx-center en flex column, preview à hauteur
 *     bornée (max-height: 55%) + cards-wrap scrollable. Plus d'overlay.
 *   - Accent rose Hero #F472B6 (dark theme) avec parcimonie : focus, active,
 *     hover discret. Pas de glow tape-à-l'œil.
 *   - Transitions 120-160ms cubic-bezier(0.2, 0.8, 0.2, 1) — micro-animées.
 * ─────────────────────────────────────────────────────────────────────────── */

.efx-modal-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(0.5rem);
  display: flex; align-items: center; justify-content: center;
  padding: 1.5rem;
  animation: efx-bd-in 160ms ease-out;
}
@keyframes efx-bd-in { from { opacity: 0; } to { opacity: 1; } }

.efx-modal {
  /* Variables Hero scoped — palette dark Hero (cf. animation-studio.css) */
  --ie-bg: #0F0F12;
  --ie-surface: #17171B;
  --ie-surface-2: #1F1F25;
  --ie-surface-3: #2A2A32;
  --ie-text: #F4F4F5;
  --ie-text-muted: #A1A1AA;
  --ie-text-faint: #71717A;
  --ie-border: rgba(255, 255, 255, 0.08);
  --ie-border-strong: rgba(255, 255, 255, 0.14);
  --ie-accent: #F472B6;
  --ie-accent-hover: #EC4899;
  --ie-accent-faint: rgba(244, 114, 182, 0.12);
  --ie-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  /* Refonte 2026-05-15cj — modale plus grande pour s'adapter aux écrans
   * laptop (1366×768, 1440×900) où 88vh n'était pas assez et coupait les
   * cards en bas. min-height garantit qu'on ne descend jamais sous le
   * seuil utilisable même sur viewport petit. */
  width: 96vw; height: 94vh;
  max-width: 110rem; max-height: 68rem;
  min-height: 38rem;
  background: var(--ie-bg);
  color: var(--ie-text);
  font-family: var(--ie-font);
  border: 0.0625rem solid var(--ie-border);
  border-radius: 0.75rem;
  display: grid;
  grid-template-rows: auto auto 1fr; /* header / cards-toolbar / body */
  overflow: hidden;
  box-shadow: 0 1.5rem 3rem rgba(0, 0, 0, 0.55), 0 0.25rem 0.75rem rgba(0, 0, 0, 0.35);
  animation: efx-mod-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes efx-mod-in {
  from { opacity: 0; transform: translateY(0.4rem) scale(0.985); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* ── HEADER ───────────────────────────────────────────────────────────── */
.efx-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 1rem;
  border-bottom: 0.0625rem solid var(--ie-border);
  background: var(--ie-surface);
}
.efx-header-title {
  font-size: 0.85rem; font-weight: 600; color: var(--ie-text);
  display: flex; gap: 0.4rem; align-items: baseline;
  letter-spacing: 0.005em;
}
.efx-header-subtitle {
  font-size: 0.75rem; color: var(--ie-text-faint); font-weight: 400;
}
.efx-header-actions { display: flex; gap: 0.35rem; align-items: center; }
.efx-btn-ghost {
  display: inline-flex; gap: 0.3rem; align-items: center;
  background: transparent; border: 0.0625rem solid var(--ie-border);
  color: var(--ie-text-muted); padding: 0.35rem 0.65rem; border-radius: 0.35rem;
  font-family: inherit; font-size: 0.72rem; cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.efx-btn-ghost:hover:not(:disabled) {
  background: var(--ie-surface-2);
  border-color: var(--ie-border-strong);
  color: var(--ie-text);
}
.efx-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.efx-btn-close {
  background: transparent; border: 0.0625rem solid var(--ie-border);
  color: var(--ie-text-muted); width: 1.85rem; height: 1.85rem;
  border-radius: 0.35rem; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.efx-btn-close:hover:not(:disabled) {
  background: var(--ie-surface-2);
  border-color: var(--ie-border-strong);
  color: var(--ie-text);
}
.efx-btn-close:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── BODY 3 COLONNES ──────────────────────────────────────────────────── */
.efx-body {
  display: grid;
  grid-template-columns: 12rem minmax(0, 1fr) 17rem;
  min-height: 0;
}

/* ── SIDEBAR GAUCHE ───────────────────────────────────────────────────── */
.efx-sidebar {
  display: flex; flex-direction: column; gap: 0.1rem;
  padding: 0.75rem 0.4rem;
  border-right: 0.0625rem solid var(--ie-border);
  background: var(--ie-surface);
  overflow-y: auto;
}
.efx-sidebar.is-disabled { opacity: 0.45; pointer-events: none; }
.efx-sidebar-btn {
  position: relative;
  display: grid;
  grid-template-columns: 1.1rem 1fr auto;
  align-items: center; gap: 0.55rem;
  background: transparent; border: 0;
  color: var(--ie-text-muted);
  padding: 0.5rem 0.65rem;
  border-radius: 0.35rem;
  font-family: inherit; font-size: 0.78rem;
  cursor: pointer; text-align: left;
  transition: background 140ms ease, color 140ms ease;
}
.efx-sidebar-btn:hover:not(:disabled) {
  background: var(--ie-surface-2);
  color: var(--ie-text);
}
.efx-sidebar-btn.is-active {
  background: linear-gradient(90deg, color-mix(in srgb, var(--ie-accent) 18%, transparent) 0%, transparent 90%);
  color: var(--ie-text);
}
.efx-sidebar-btn.is-active::before {
  content: ''; position: absolute;
  left: 0; top: 18%; bottom: 18%;
  width: 0.18rem;
  background: linear-gradient(180deg, var(--ie-accent), color-mix(in srgb, var(--ie-accent) 70%, transparent));
  border-radius: 0 0.12rem 0.12rem 0;
  box-shadow: 0 0 0.5rem var(--ie-accent);
}
.efx-sidebar-btn-icon {
  display: inline-flex; align-items: center; justify-content: center;
  opacity: 0.7;
  transition: opacity 140ms ease, transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.efx-sidebar-btn:hover .efx-sidebar-btn-icon { opacity: 1; transform: scale(1.08); }
.efx-sidebar-btn.is-active .efx-sidebar-btn-icon {
  opacity: 1;
  filter: drop-shadow(0 0 0.3rem currentColor);
}
.efx-sidebar-btn-label {
  font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.efx-sidebar-btn.is-active .efx-sidebar-btn-label { font-weight: 600; }
.efx-sidebar-badge {
  background: linear-gradient(135deg, var(--ie-accent), var(--ie-accent-hover, #db2777));
  color: #fff;
  min-width: 1.15rem; height: 1.15rem; padding: 0 0.35rem;
  border-radius: 0.6rem;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.62rem; font-weight: 700; line-height: 1;
  box-shadow: 0 0.0625rem 0.25rem rgba(244, 114, 182, 0.45);
  animation: efx-badge-pop 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes efx-badge-pop {
  0%   { transform: scale(0.6); opacity: 0; }
  60%  { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
}

/* ── CENTRE — Layout fix ───────────────────────────────────────────────
 * Refonte 2026-05-15 : flex column avec preview en HAUT (hauteur bornée par
 * max-height pour ne pas écraser les cards) + cards-wrap en BAS (scrollable).
 * Plus d'overlay : les cards sont DANS le flux normal. */
.efx-center {
  display: flex; flex-direction: column;
  min-width: 0; min-height: 0;
  background: var(--ie-bg);
}
.efx-preview-wrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
  /* Refonte 2026-05-15ck — cards déplacées en TOOLBAR header.
   * .efx-center ne contient plus que la preview, qui prend 100% de la zone. */
}
.efx-preview-box {
  position: relative;
  /* Refonte 2026-05-15cw — pattern fit-contain : height: 100% dicte, width
   * suit le ratio (donné inline = sourceAspect). max-width/height empêchent
   * de dépasser le parent. Avant, width: 100% + aspect-ratio fixe écrasait
   * le ratio source, les vidéos verticales 9:16 apparaissaient en horizontal. */
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: 16 / 9;  /* default fallback, override par inline style */
  background: #000;
  border-radius: 0.4rem; overflow: hidden;
  border: 0.0625rem solid var(--ie-border);
  box-shadow: 0 0.4rem 1.2rem rgba(0, 0, 0, 0.45);
}
.efx-preview-empty {
  display: flex; align-items: center; justify-content: center;
  width: 100%; aspect-ratio: 16 / 9;
  background: var(--ie-surface);
  color: var(--ie-text-faint); font-size: 0.78rem;
  border: 0.0625rem dashed var(--ie-border-strong);
  border-radius: 0.4rem;
}
.efx-no-video-hint {
  position: absolute; bottom: 0.5rem; left: 0.5rem; right: 0.5rem;
  background: rgba(0, 0, 0, 0.7); color: var(--ie-text);
  font-size: 0.68rem; padding: 0.4rem 0.55rem;
  border-radius: 0.25rem; pointer-events: none;
}

.efx-countdown {
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  font-size: 9rem; font-weight: 800; color: #fff;
  text-shadow: 0 0 1.5rem rgba(255, 45, 45, 0.8);
  font-family: system-ui, sans-serif; pointer-events: none;
  animation: efx-cd-pop 700ms ease-out;
}
@keyframes efx-cd-pop {
  0%   { opacity: 0; transform: scale(2); }
  20%  { opacity: 1; transform: scale(1); }
  100% { opacity: 0.85; transform: scale(1); }
}
.efx-rec-badge {
  position: absolute; top: 0.5rem; left: 0.5rem; z-index: 20;
  padding: 0.18rem 0.5rem; background: rgba(0, 0, 0, 0.7);
  color: #ff2d2d; font-family: monospace; font-weight: 700;
  font-size: 0.74rem; border-radius: 0.2rem; pointer-events: none;
  animation: efx-rec-blink 1.2s steps(2, end) infinite;
}
.efx-rec-stop-btn {
  position: absolute; top: 0.5rem; right: 0.5rem; z-index: 20;
  padding: 0.32rem 0.7rem;
  background: rgba(0, 0, 0, 0.78); color: #fff;
  border: 0.0625rem solid rgba(255, 255, 255, 0.4); border-radius: 0.3rem;
  font-size: 0.72rem; font-weight: 600; cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease;
  font-family: monospace;
}
.efx-rec-stop-btn:hover { background: #ef4444; border-color: #ef4444; }
@keyframes efx-rec-blink {
  0%, 50%   { opacity: 1; }
  50.01%, 100% { opacity: 0.3; }
}

/* ── GRILLE CARDS ────────────────────────────────────────────────────── */
/* TOOLBAR DES EFFETS — barre horizontale en haut, sous le header.
 * Refonte 2026-05-15ck — boutons jolies en row scroll-x.
 * Polish 2026-05-15cl — fade-edges + séparateur appuyé + stagger entrée. */
.efx-cards-toolbar {
  display: flex; align-items: center; gap: 0.85rem;
  padding: 0.55rem 1rem;
  background: linear-gradient(180deg, var(--ie-surface) 0%, color-mix(in srgb, var(--ie-surface) 92%, var(--ie-bg)) 100%);
  border-bottom: 0.0625rem solid var(--ie-border);
  min-height: 3.5rem;
  position: relative;
}
.efx-cards-toolbar.is-disabled { opacity: 0.45; pointer-events: none; }
.efx-cards-toolbar-meta {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.62rem; color: var(--ie-text-faint);
  text-transform: uppercase; letter-spacing: 0.09em; font-weight: 700;
  flex-shrink: 0;
  padding-right: 0.85rem;
  position: relative;
}
/* Séparateur vertical épaissi entre meta et cards */
.efx-cards-toolbar-meta::after {
  content: '';
  position: absolute;
  right: 0; top: 12%; bottom: 12%;
  width: 0.0625rem;
  background: linear-gradient(180deg, transparent 0%, var(--ie-border-strong) 50%, transparent 100%);
}
.efx-cards-toolbar-count { white-space: nowrap; }

/* Wrapper qui porte les fade-edges left/right via pseudo-elements */
.efx-cards-strip-wrap {
  flex: 1 1 0; min-width: 0;
  position: relative;
}
/* Fade-edges réduits + plus subtils pour ne pas masquer les premiers boutons.
 * Refonte 2026-05-15cm — passage de 1.5rem opaque à 0.7rem semi-transparent. */
.efx-cards-strip-wrap::before,
.efx-cards-strip-wrap::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0;
  width: 0.65rem;
  pointer-events: none;
  z-index: 2;
}
.efx-cards-strip-wrap::before {
  left: 0;
  background: linear-gradient(90deg, color-mix(in srgb, var(--ie-surface) 90%, transparent) 0%, transparent 100%);
}
.efx-cards-strip-wrap::after {
  right: 0;
  background: linear-gradient(-90deg, color-mix(in srgb, var(--ie-surface) 90%, transparent) 0%, transparent 100%);
}

.efx-cards-strip {
  display: flex; flex-wrap: nowrap; align-items: center;
  gap: 0.4rem;
  overflow-x: auto;
  overflow-y: hidden;
  /* padding latéral pour décaler les cards du fade-edge (refonte 2026-05-15cm) */
  padding: 0.1rem 0.7rem 0.25rem;
  scroll-behavior: smooth;
  /* Scrollbar discrète horizontale Hero */
  scrollbar-width: thin;
  scrollbar-color: var(--ie-border-strong) transparent;
}
.efx-cards-strip::-webkit-scrollbar { height: 0.35rem; }
.efx-cards-strip::-webkit-scrollbar-thumb {
  background: var(--ie-border-strong); border-radius: 0.2rem;
}
.efx-cards-strip::-webkit-scrollbar-thumb:hover { background: var(--ie-text-faint); }

.efx-empty-presets-inline {
  display: inline-flex; align-items: center; gap: 0.55rem;
  padding: 0.5rem 0.8rem;
  background: linear-gradient(135deg, var(--ie-accent-faint), transparent);
  border: 0.0625rem dashed color-mix(in srgb, var(--ie-accent) 35%, transparent);
  border-radius: 0.4rem;
  color: var(--ie-text-muted); font-size: 0.74rem;
  white-space: nowrap;
}
.efx-empty-presets-inline strong { color: var(--ie-accent); font-weight: 600; }
.efx-empty-presets-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.6rem; height: 1.6rem; border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: var(--ie-accent);
  flex-shrink: 0;
}

/* Card sobre Studio pro : dot catégoriel + label centré, pas d'icône.
 * Hover lift discret (-1px), ring accent à l'active, pas de gradient flashy. */
.efx-card {
  position: relative;
  flex: 0 0 auto;
  min-width: 8rem;
  max-width: 13rem;
  background: var(--ie-surface-2);
  border: 0.0625rem solid var(--ie-border);
  border-radius: 0.3rem;
  padding: 0.25rem 1.1rem 0.25rem 0.95rem;
  cursor: pointer;
  display: flex; align-items: center; justify-content: flex-start;
  overflow: hidden;
  height: 2.4rem;
  transition:
    transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 160ms ease;
  /* Stagger entrée — animation-delay set inline par index card */
  animation: efx-card-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
}
@keyframes efx-card-in {
  from { opacity: 0; transform: translateX(-0.4rem); }
  to   { opacity: 1; transform: translateX(0); }
}
.efx-card:hover:not(.is-disabled) {
  background: var(--ie-surface-3);
  border-color: var(--ie-border-strong);
  transform: translateY(-0.0625rem);
  box-shadow: 0 0.25rem 0.6rem rgba(0, 0, 0, 0.3);
}
.efx-card.is-disabled { cursor: not-allowed; opacity: 0.4; }
.efx-card:focus-visible {
  outline: 0.125rem solid var(--ie-accent);
  outline-offset: 0.125rem;
}
.efx-card.is-active {
  background: var(--ie-accent-faint);
  border-color: var(--ie-accent);
  box-shadow: 0 0 0 0.0625rem var(--ie-accent), 0 0.25rem 0.7rem rgba(244, 114, 182, 0.18);
}

/* Dot catégoriel à GAUCHE du label (refonte 2026-05-15ci — cards row).
 * Position absolue alignée verticalement, à 0.4rem du bord gauche. */
.efx-card-dot {
  position: absolute;
  top: 50%; left: 0.45rem;
  transform: translateY(-50%);
  width: 0.4rem; height: 0.4rem;
  border-radius: 50%;
  flex-shrink: 0;
  transition: transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 140ms ease;
}
.efx-card:hover:not(.is-disabled) .efx-card-dot { transform: translateY(-50%) scale(1.25); }

.efx-card-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--ie-text-muted);
  text-align: left;
  line-height: 1.15;
  letter-spacing: 0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
  max-width: 100%;
  padding: 0 0.2rem;
}
.efx-card:hover:not(.is-disabled) .efx-card-label { color: var(--ie-text); }
.efx-card.is-active .efx-card-label {
  color: var(--ie-text); font-weight: 600;
}

/* Petit checkmark accent sur la card active (right, vertical center) */
.efx-card-active-mark {
  position: absolute; top: 50%; right: 0.45rem;
  transform: translateY(-50%);
  width: 0.4rem; height: 0.4rem; border-radius: 50%;
  background: var(--ie-accent);
  box-shadow: 0 0 0 0.12rem var(--ie-accent-faint);
}

.efx-card-delete {
  position: absolute; top: 50%; right: 0.3rem;
  transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.55); border: 0;
  color: var(--ie-text); width: 1.1rem; height: 1.1rem;
  border-radius: 0.2rem;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0;
  transition: opacity 140ms ease, background 140ms ease;
}
.efx-card:hover .efx-card-delete,
.efx-card:focus-within .efx-card-delete { opacity: 1; }
.efx-card-delete:hover { background: #ef4444; }

/* ── SIDEBAR DROITE ──────────────────────────────────────────────────── */
.efx-right {
  display: flex; flex-direction: column;
  border-left: 0.0625rem solid var(--ie-border);
  background: var(--ie-surface);
  padding: 0.85rem; gap: 0.85rem;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--ie-border-strong) transparent;
}
.efx-right::-webkit-scrollbar { width: 0.4rem; }
.efx-right::-webkit-scrollbar-thumb {
  background: var(--ie-border-strong); border-radius: 0.2rem;
}
.efx-right.is-disabled { opacity: 0.45; pointer-events: none; }
.efx-right-section {
  display: flex; flex-direction: column; gap: 0.5rem;
  padding-bottom: 0.75rem;
  border-bottom: 0.0625rem solid var(--ie-border);
}
.efx-right-section:last-child { border-bottom: 0; padding-bottom: 0; }
.efx-right-section-title {
  font-size: 0.62rem; color: var(--ie-text-faint);
  text-transform: uppercase; letter-spacing: 0.08em;
  font-weight: 700;
}
/* Refonte 2026-05-15cl — Badge héros pour Look actif (gradient catégoriel + icône) */
.efx-hero-badge {
  display: flex; align-items: center; gap: 0.55rem;
  padding: 0.55rem 0.7rem;
  background: var(--ie-surface-2);
  border: 0.0625rem solid var(--ie-border);
  border-radius: 0.4rem;
  position: relative;
  transition: background 240ms ease, border-color 240ms ease;
}
.efx-hero-badge-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.6rem; height: 1.6rem;
  border-radius: 0.3rem;
  background: rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
.efx-hero-badge-label {
  flex: 1; min-width: 0;
  font-size: 0.85rem; color: var(--ie-text); font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.efx-hero-badge-dot {
  width: 0.45rem; height: 0.45rem; border-radius: 50%;
  flex-shrink: 0;
  animation: efx-hero-dot-pulse 2.4s ease-in-out infinite;
}
@keyframes efx-hero-dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.65; transform: scale(0.85); }
}
.efx-hero-badge-empty {
  color: var(--ie-text-faint); font-size: 0.78rem; font-style: italic;
  justify-content: center;
}

.efx-right-modules {
  display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.55rem;
}
.efx-mod-chip {
  display: inline-flex; gap: 0.3rem; align-items: center;
  background: var(--ie-surface-2); color: var(--ie-text);
  padding: 0.2rem 0.5rem 0.2rem 0.45rem; border-radius: 0.7rem;
  font-size: 0.68rem; font-weight: 500;
  border: 0.0625rem solid var(--ie-border);
  transition: border-color 140ms ease, background 140ms ease;
}
.efx-mod-chip:hover { background: var(--ie-surface-3); }
.efx-mod-chip-dot {
  width: 0.35rem; height: 0.35rem; border-radius: 50%;
  flex-shrink: 0;
}
.efx-mod-chip button {
  background: transparent; border: 0; color: var(--ie-text);
  cursor: pointer; padding: 0; line-height: 1;
  font-size: 0.95rem; opacity: 0.55;
  transition: opacity 140ms ease;
  margin-left: 0.1rem;
}
.efx-mod-chip button:hover { opacity: 1; }

/* ── SLIDER ──────────────────────────────────────────────────────────── */
/* Refonte 2026-05-15cl — Grid 2 cols pour sliders fins (économie verticale). */
.efx-sliders-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.55rem 0.7rem;
}
.efx-slider-row {
  display: flex; flex-direction: column;
  gap: 0.2rem;
  font-size: 0.7rem; color: var(--ie-text-muted);
}
.efx-slider-row-header {
  display: flex; justify-content: space-between; align-items: baseline;
}
.efx-slider-label {
  font-weight: 500; letter-spacing: 0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.efx-slider-input {
  width: 100%; accent-color: var(--ie-accent);
  cursor: pointer; height: 0.85rem;
}
.efx-slider-value {
  font-family: ui-monospace, 'SF Mono', monospace;
  color: var(--ie-text-faint);
  font-size: 0.65rem;
}

/* Block Sniper bordé */
.efx-sniper-block {
  background: linear-gradient(180deg, rgba(248, 113, 113, 0.04) 0%, transparent 100%);
  border: 0.0625rem solid color-mix(in srgb, #F87171 25%, transparent);
  border-radius: 0.4rem;
  padding: 0.6rem 0.7rem 0.7rem;
}
.efx-sniper-block.efx-right-section { border-bottom: 0.0625rem solid color-mix(in srgb, #F87171 25%, transparent); padding-bottom: 0.7rem; }
/* Block Météo (refonte 2026-05-15dh — M2) */
.efx-weather-block {
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.05) 0%, transparent 100%);
  border: 0.0625rem solid color-mix(in srgb, #60A5FA 25%, transparent);
  border-radius: 0.4rem;
  padding: 0.6rem 0.7rem 0.7rem;
}
.efx-weather-entry {
  padding: 0.5rem 0;
  border-top: 0.0625rem dashed color-mix(in srgb, #60A5FA 18%, transparent);
}
.efx-weather-entry:first-of-type { border-top: 0; padding-top: 0.3rem; }
.efx-weather-entry-title {
  font-size: 0.75rem; font-weight: 600; color: var(--ie-text);
  margin-bottom: 0.4rem;
  letter-spacing: 0.01em;
}
/* Zone toggle row (refonte 2026-05-15di — M3) */
.efx-zone-row {
  display: flex; align-items: center; gap: 0.4rem;
  margin-top: 0.5rem;
  font-size: 0.7rem;
}
.efx-zone-label { color: var(--ie-text-muted); }
.efx-zone-tabs {
  display: inline-flex; gap: 0;
  background: var(--ie-surface-2);
  border: 0.0625rem solid var(--ie-border);
  border-radius: 0.3rem; overflow: hidden;
}
.efx-zone-tab {
  background: transparent; border: 0;
  color: var(--ie-text-muted);
  padding: 0.2rem 0.5rem;
  font-size: 0.68rem; cursor: pointer;
  font-family: inherit;
  transition: background 120ms ease, color 120ms ease;
}
.efx-zone-tab:hover { background: var(--ie-surface-3); color: var(--ie-text); }
.efx-zone-tab.is-active {
  background: color-mix(in srgb, #60A5FA 25%, var(--ie-surface-2));
  color: var(--ie-text); font-weight: 600;
}
.efx-zone-edit-btn {
  background: color-mix(in srgb, #60A5FA 18%, var(--ie-surface-2));
  border: 0.0625rem solid color-mix(in srgb, #60A5FA 50%, transparent);
  color: var(--ie-text);
  padding: 0.25rem 0.55rem;
  font-size: 0.68rem; font-weight: 600;
  border-radius: 0.3rem; cursor: pointer;
  margin-left: auto;
  font-family: inherit;
  transition: all 140ms ease;
}
.efx-zone-edit-btn:hover {
  background: color-mix(in srgb, #60A5FA 30%, var(--ie-surface-2));
  border-color: #60A5FA;
}
/* Brush sub-controls (refonte 2026-05-15dj — M4) */
.efx-brush-controls {
  margin-top: 0.4rem;
  padding: 0.4rem 0.5rem;
  background: rgba(96, 165, 250, 0.06);
  border: 0.0625rem dashed color-mix(in srgb, #60A5FA 30%, transparent);
  border-radius: 0.3rem;
  display: flex; flex-direction: column; gap: 0.4rem;
}
.efx-brush-mode-row { display: flex; gap: 0.3rem; align-items: center; }
.efx-brush-mode-btn {
  background: var(--ie-surface-2);
  border: 0.0625rem solid var(--ie-border);
  color: var(--ie-text-muted);
  padding: 0.25rem 0.55rem;
  font-size: 0.68rem; font-weight: 600;
  border-radius: 0.3rem; cursor: pointer;
  font-family: inherit;
  transition: all 120ms ease;
}
.efx-brush-mode-btn.is-active {
  background: color-mix(in srgb, #60A5FA 25%, var(--ie-surface-2));
  border-color: #60A5FA;
  color: var(--ie-text);
}
.efx-brush-mode-btn.is-erase {
  background: color-mix(in srgb, #F87171 25%, var(--ie-surface-2));
  border-color: #F87171;
  color: var(--ie-text);
}
.efx-brush-clear-btn {
  background: transparent;
  border: 0.0625rem solid var(--ie-border);
  color: var(--ie-text-faint);
  padding: 0.25rem 0.55rem;
  font-size: 0.65rem; cursor: pointer;
  border-radius: 0.3rem;
  font-family: inherit;
  margin-left: auto;
  transition: all 120ms ease;
}
.efx-brush-clear-btn:hover { color: #ef4444; border-color: #ef4444; }

/* Impact zones sub-block (refonte 2026-05-15dk — M4b) */
.efx-impacts-block {
  margin-top: 0.5rem;
  padding: 0.5rem 0.55rem 0.6rem;
  background: rgba(251, 191, 36, 0.05);
  border: 0.0625rem solid color-mix(in srgb, #fbbf24 30%, transparent);
  border-radius: 0.3rem;
  display: flex; flex-direction: column; gap: 0.4rem;
}
.efx-impacts-header {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.65rem; color: #fbbf24;
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;
}
.efx-impacts-count {
  background: rgba(251, 191, 36, 0.25);
  color: #fbbf24;
  padding: 0 0.4rem; border-radius: 0.5rem;
  font-size: 0.6rem;
}
.efx-impacts-empty {
  font-size: 0.7rem; color: var(--ie-text-faint);
  font-style: italic; padding: 0.4rem;
  text-align: center;
}
.efx-impact-entry {
  padding: 0.4rem 0.5rem;
  background: var(--ie-surface-2);
  border: 0.0625rem solid var(--ie-border);
  border-radius: 0.3rem;
  display: flex; flex-direction: column; gap: 0.35rem;
}
.efx-impact-entry.is-editing {
  border-color: #fbbf24;
  background: color-mix(in srgb, #fbbf24 12%, var(--ie-surface-2));
}
.efx-impact-row { display: flex; align-items: center; gap: 0.3rem; }
.efx-impact-surface {
  flex: 1;
  background: var(--ie-bg);
  border: 0.0625rem solid var(--ie-border);
  color: var(--ie-text);
  padding: 0.25rem 0.4rem;
  font-size: 0.7rem; border-radius: 0.25rem;
  font-family: inherit;
  cursor: pointer;
}
.efx-impact-delete {
  background: transparent; border: 0.0625rem solid var(--ie-border);
  color: var(--ie-text-faint);
  width: 1.5rem; height: 1.5rem;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 0.25rem; cursor: pointer;
  transition: all 120ms ease;
}
.efx-impact-delete:hover { color: #ef4444; border-color: #ef4444; }
.efx-impact-zone-row {
  display: flex; align-items: center; gap: 0.3rem;
  font-size: 0.65rem;
}
.efx-impact-zone-label { color: var(--ie-text-muted); }
.efx-impact-zone-tabs {
  display: inline-flex;
  background: var(--ie-bg);
  border: 0.0625rem solid var(--ie-border);
  border-radius: 0.25rem; overflow: hidden;
}
.efx-impact-zone-tab {
  background: transparent; border: 0;
  color: var(--ie-text-muted);
  padding: 0.18rem 0.4rem;
  font-size: 0.62rem; cursor: pointer;
  font-family: inherit;
  transition: all 120ms ease;
}
.efx-impact-zone-tab:hover { background: var(--ie-surface-3); color: var(--ie-text); }
.efx-impact-zone-tab.is-active {
  background: color-mix(in srgb, #fbbf24 25%, var(--ie-bg));
  color: var(--ie-text); font-weight: 600;
}
.efx-impact-edit-btn {
  background: color-mix(in srgb, #fbbf24 18%, var(--ie-surface-2));
  border: 0.0625rem solid color-mix(in srgb, #fbbf24 50%, transparent);
  color: var(--ie-text);
  padding: 0.18rem 0.5rem;
  font-size: 0.62rem; font-weight: 600;
  border-radius: 0.25rem; cursor: pointer;
  margin-left: auto; font-family: inherit;
}
.efx-impact-edit-btn:hover {
  background: color-mix(in srgb, #fbbf24 30%, var(--ie-surface-2));
  border-color: #fbbf24;
}
.efx-impact-sliders {
  display: flex; flex-direction: column; gap: 0.25rem;
}
.efx-impact-slider {
  display: grid; grid-template-columns: 4rem 1fr 2rem;
  gap: 0.4rem; align-items: center;
  font-size: 0.65rem; color: var(--ie-text-muted);
}
.efx-impact-slider input[type="range"] {
  width: 100%; accent-color: #fbbf24;
  height: 0.7rem;
}
.efx-impact-val { font-family: ui-monospace, monospace; color: var(--ie-text-faint); font-size: 0.6rem; text-align: right; }
.efx-impact-toggles { display: flex; gap: 0.6rem; }
.efx-impact-toggle {
  display: flex; align-items: center; gap: 0.25rem;
  font-size: 0.65rem; color: var(--ie-text-muted); cursor: pointer;
}
.efx-impact-toggle input { accent-color: #fbbf24; }
.efx-impacts-add-row {
  display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap;
  margin-top: 0.2rem;
}
.efx-impacts-add-label { font-size: 0.62rem; color: var(--ie-text-faint); margin-right: 0.2rem; }
.efx-impacts-add-btn {
  display: inline-flex; gap: 0.2rem; align-items: center;
  background: var(--ie-surface-2);
  border: 0.0625rem dashed color-mix(in srgb, #fbbf24 40%, transparent);
  color: var(--ie-text-muted);
  padding: 0.18rem 0.4rem;
  font-size: 0.62rem; cursor: pointer;
  border-radius: 0.25rem; font-family: inherit;
  transition: all 120ms ease;
}
.efx-impacts-add-btn:hover {
  background: color-mix(in srgb, #fbbf24 18%, var(--ie-surface-2));
  border-style: solid;
  border-color: #fbbf24;
  color: var(--ie-text);
}

/* Block Ralenti (refonte 2026-05-15dm) */
.efx-slowmo-block {
  background: linear-gradient(180deg, rgba(167, 139, 250, 0.05) 0%, transparent 100%);
  border: 0.0625rem solid color-mix(in srgb, #A78BFA 25%, transparent);
  border-radius: 0.4rem;
  padding: 0.6rem 0.7rem 0.7rem;
}
.efx-slowmo-toggle {
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 0.78rem; color: var(--ie-text);
  cursor: pointer;
  padding: 0.3rem 0;
}
.efx-slowmo-toggle input { accent-color: #A78BFA; }
.efx-slowmo-duration {
  margin-top: 0.5rem;
  padding: 0.4rem 0.55rem;
  background: var(--ie-surface-2);
  border-radius: 0.3rem;
  font-size: 0.7rem; color: var(--ie-text-muted);
  line-height: 1.4;
}
.efx-slowmo-duration strong { color: var(--ie-text); }
.efx-slowmo-delta { color: #A78BFA; font-weight: 600; }
.efx-slowmo-actions {
  display: flex; gap: 0.35rem; align-items: center;
  margin-top: 0.5rem;
}
.efx-slowmo-hint {
  font-size: 0.7rem; color: var(--ie-text-muted); font-style: italic;
}
/* Bandeau hint pendant record slowmo sur la preview (refonte 2026-05-15do) */
.efx-slowmo-record-hint {
  position: absolute; bottom: 0.6rem; left: 50%; transform: translateX(-50%);
  z-index: 22;
  padding: 0.4rem 0.85rem;
  background: rgba(167, 139, 250, 0.92); color: #fff;
  font-size: 0.78rem; font-weight: 600;
  border-radius: 0.4rem;
  pointer-events: none;
  box-shadow: 0 0.3rem 0.8rem rgba(167, 139, 250, 0.35);
}

/* ── Capture d'image (refonte 2026-05-15dp) ─────────────────────────────── */
.efx-capture-block {
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.05) 0%, transparent 100%);
  border: 0.0625rem solid color-mix(in srgb, #22d3ee 25%, transparent);
  border-radius: 0.4rem;
  padding: 0.6rem 0.7rem 0.7rem;
}
.efx-capture-scrub {
  display: flex; flex-direction: column; gap: 0.4rem;
  margin-bottom: 0.5rem;
}
.efx-capture-scrub-row {
  display: flex; align-items: center; gap: 0.4rem;
}
.efx-capture-scrub-input {
  flex: 1;
  accent-color: #22d3ee;
  cursor: pointer;
}
.efx-capture-scrub-time {
  font-family: ui-monospace, monospace;
  font-size: 0.7rem; color: var(--ie-text-faint);
  min-width: 2.4rem; text-align: right;
}
.efx-capture-btn {
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  border: 0;
}
.efx-capture-empty {
  font-size: 0.7rem; color: var(--ie-text-faint);
  font-style: italic; padding: 0.6rem; text-align: center;
  background: var(--ie-surface-2); border-radius: 0.3rem;
  border: 0.0625rem dashed var(--ie-border);
}
.efx-capture-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
  gap: 0.45rem;
}
/* Single mode (refonte 2026-05-16, captureModeActive) — 1 grande image
 * verticalement empilée avec label + actions. Pas de scroll de liste. */
.efx-capture-single {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.5rem;
  background: var(--ie-surface-2);
  border: 0.0625rem solid var(--ie-border);
  border-radius: 0.4rem;
  transition: border-color 140ms ease;
}
.efx-capture-single.is-saved {
  border-color: #10b981;
  background: color-mix(in srgb, #10b981 8%, var(--ie-surface-2));
}
.efx-capture-single-thumb-wrap {
  position: relative;
}
.efx-capture-single-thumb-wrap:hover .efx-capture-delete-overlay {
  opacity: 1;
}
.efx-capture-single-thumb {
  display: block;
  width: 100%;
  position: relative;
  background: transparent; border: 0; padding: 0;
  cursor: pointer; border-radius: 0.3rem; overflow: hidden;
  transition: transform 140ms ease;
}
.efx-capture-single-thumb:hover { transform: scale(1.01); }
.efx-capture-single-thumb img {
  width: 100%; aspect-ratio: 16/9;
  object-fit: cover; display: block;
}
.efx-capture-single-time {
  position: absolute; bottom: 0.3rem; right: 0.3rem;
  padding: 0.1rem 0.4rem;
  background: rgba(0, 0, 0, 0.75); color: #fff;
  font-family: ui-monospace, monospace; font-size: 0.7rem; font-weight: 600;
  border-radius: 0.25rem;
}
/* Bouton 🗑️ overlay top-right au hover (cohérent banque tiles) */
.efx-capture-delete-overlay {
  position: absolute;
  top: 0.35rem; right: 0.35rem;
  width: 1.6rem; height: 1.6rem;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.65);
  border: 0.0625rem solid rgba(239, 68, 68, 0.55);
  color: #fff;
  border-radius: 0.3rem;
  cursor: pointer;
  z-index: 4;
  padding: 0;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease,
              border-color 0.12s ease, transform 0.12s ease,
              box-shadow 0.12s ease;
  box-shadow: 0 0.15rem 0.4rem rgba(0, 0, 0, 0.4);
}
.efx-capture-delete-overlay:hover {
  background: #ef4444;
  border-color: #ef4444;
  transform: translateY(-0.05rem);
  box-shadow: 0 0.3rem 0.7rem rgba(239, 68, 68, 0.5);
}
/* Boutons d'action jumeaux Sauver / Sauver + couper — taille identique,
 * flex 1 chacun, même padding/font. Refonte 2026-05-16. */
.efx-capture-actions-single {
  display: flex;
  gap: 0.4rem;
}
.efx-capture-action-btn {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.55rem 0.6rem;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.1;
  border-radius: 0.35rem;
  border: 0;
  color: #fff;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: filter 140ms ease, transform 140ms ease, box-shadow 140ms ease;
  box-shadow: 0 0.15rem 0.35rem rgba(0, 0, 0, 0.25);
}
.efx-capture-action-btn:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-0.05rem);
  box-shadow: 0 0.3rem 0.7rem rgba(0, 0, 0, 0.35);
}
.efx-capture-action-btn:disabled {
  opacity: 0.5; cursor: not-allowed;
  transform: none; box-shadow: 0 0.15rem 0.35rem rgba(0, 0, 0, 0.2);
}
.efx-capture-action-save {
  background: linear-gradient(135deg, #06b6d4, #0891b2);
}
.efx-capture-action-trim {
  background: linear-gradient(135deg, #ec4899, #db2777);
}
.efx-capture-tile {
  display: flex; flex-direction: column; gap: 0.3rem;
  padding: 0.35rem;
  background: var(--ie-surface-2);
  border: 0.0625rem solid var(--ie-border);
  border-radius: 0.35rem;
  transition: border-color 140ms ease;
}
.efx-capture-tile.is-saved {
  border-color: #10b981;
  background: color-mix(in srgb, #10b981 8%, var(--ie-surface-2));
}
.efx-capture-thumb {
  position: relative;
  background: transparent; border: 0;
  padding: 0; cursor: pointer;
  border-radius: 0.25rem; overflow: hidden;
  transition: transform 140ms ease;
}
.efx-capture-thumb:hover { transform: scale(1.03); }
.efx-capture-thumb img {
  width: 100%; aspect-ratio: 16/9;
  object-fit: cover; display: block;
}
.efx-capture-thumb-time {
  position: absolute; bottom: 0.2rem; right: 0.25rem;
  padding: 0.05rem 0.3rem;
  background: rgba(0, 0, 0, 0.7); color: #fff;
  font-family: ui-monospace, monospace; font-size: 0.6rem;
  border-radius: 0.2rem;
}
.efx-capture-label-input {
  background: var(--ie-bg); border: 0.0625rem solid var(--ie-border);
  color: var(--ie-text);
  padding: 0.2rem 0.4rem;
  font-size: 0.68rem; border-radius: 0.25rem;
  font-family: inherit; width: 100%;
}
.efx-capture-label-input:disabled { opacity: 0.7; cursor: default; }
.efx-capture-actions {
  display: flex; gap: 0.25rem; align-items: center;
}
.efx-capture-save-btn {
  display: inline-flex; gap: 0.25rem; align-items: center; justify-content: center;
  flex: 1;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  border: 0; color: #fff;
  padding: 0.22rem 0.4rem;
  font-size: 0.62rem; font-weight: 600;
  border-radius: 0.25rem; cursor: pointer;
  font-family: inherit;
  transition: filter 140ms ease, transform 140ms ease;
}
.efx-capture-save-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-0.0625rem); }
.efx-capture-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.efx-capture-delete-btn {
  background: transparent;
  border: 0.0625rem solid var(--ie-border);
  color: var(--ie-text-faint);
  width: 1.4rem; height: 1.4rem;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 0.25rem; cursor: pointer;
  transition: all 120ms ease;
}
.efx-capture-delete-btn:hover { color: #ef4444; border-color: #ef4444; }
.efx-capture-saved-tag {
  font-size: 0.62rem; color: #10b981; font-weight: 600;
  padding: 0.2rem 0.4rem;
  background: color-mix(in srgb, #10b981 12%, transparent);
  border-radius: 0.25rem;
}
.efx-capture-warn {
  margin-top: 0.5rem;
  padding: 0.35rem 0.5rem;
  background: rgba(239, 68, 68, 0.1);
  border: 0.0625rem solid rgba(239, 68, 68, 0.3);
  color: #ef4444; font-size: 0.65rem;
  border-radius: 0.25rem;
}
/* Mode 'capture' (refonte 2026-05-15dq) — masque tous les blocks sauf capture
 * dans le panel droit, et adapte la grille body (pas de sidebar). */
.efx-body.is-capture-mode {
  grid-template-columns: minmax(0, 1fr) 22rem;
}
.efx-right.is-capture-mode .efx-right-section:not(.efx-capture-block) {
  display: none;
}
.efx-right.is-capture-mode .efx-capture-block {
  /* Block capture seul → on lui donne plus de respiration verticale */
  flex: 1; min-height: 0;
}

/* ── Lightbox carrousel (refonte 2026-05-15dp) ──────────────────────────── */
.efx-lightbox-backdrop {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.92);
  display: flex; align-items: center; justify-content: center;
  padding: 2rem;
  animation: efx-bd-in 0.18s ease-out;
  cursor: zoom-out;
}
.efx-lightbox-frame {
  position: relative; max-width: 90vw; max-height: 88vh;
  display: flex; flex-direction: column;
  cursor: default;
}
.efx-lightbox-img {
  max-width: 100%; max-height: calc(88vh - 3rem);
  object-fit: contain;
  border-radius: 0.4rem;
  box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.6);
}
.efx-lightbox-bar {
  display: flex; align-items: center; gap: 1rem;
  padding: 0.6rem 0.8rem;
  margin-top: 0.6rem;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 0.3rem;
  color: #fff; font-size: 0.78rem;
}
.efx-lightbox-label { flex: 1; font-weight: 600; }
.efx-lightbox-time {
  font-family: ui-monospace, monospace; color: #22d3ee;
}
.efx-lightbox-pos { color: #a1a1aa; font-family: ui-monospace, monospace; }
.efx-lightbox-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 3rem; height: 3rem;
  background: rgba(0, 0, 0, 0.55);
  border: 0.0625rem solid rgba(255, 255, 255, 0.18);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; cursor: pointer;
  transition: all 140ms ease;
}
.efx-lightbox-nav:hover { background: rgba(34, 211, 238, 0.4); border-color: #22d3ee; }
.efx-lightbox-prev { left: -3.5rem; }
.efx-lightbox-next { right: -3.5rem; }
.efx-lightbox-close {
  position: absolute; top: -2rem; right: 0;
  width: 2rem; height: 2rem;
  background: transparent; border: 0; color: #fff;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 0.3rem;
  transition: background 140ms ease;
}
.efx-lightbox-close:hover { background: rgba(255, 255, 255, 0.1); }
.efx-sniper-actions {
  display: flex; flex-direction: column; gap: 0.4rem; align-items: stretch;
  margin-top: 0.3rem;
}

.efx-color-row {
  display: flex; gap: 0.5rem; align-items: center;
  padding: 0.15rem 0;
}
.efx-color-row-label {
  font-size: 0.7rem; color: var(--ie-text-muted); flex: 1;
}
.efx-color-dots { display: flex; gap: 0.3rem; }
.efx-color-dot {
  width: 1.15rem; height: 1.15rem; border-radius: 50%;
  border: 0.125rem solid transparent; cursor: pointer;
  padding: 0;
  transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}
.efx-color-dot:hover { transform: scale(1.08); }
.efx-color-dot.is-active {
  border-color: var(--ie-text);
  box-shadow: 0 0 0 0.0625rem var(--ie-accent);
}

.efx-btn-primary {
  display: inline-flex; gap: 0.4rem; align-items: center;
  background: var(--ie-accent); border: 0; color: #fff;
  padding: 0.45rem 0.75rem; border-radius: 0.35rem;
  font-family: inherit; font-size: 0.74rem; font-weight: 600; cursor: pointer;
  transition: background 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}
.efx-btn-primary:hover:not(:disabled) {
  background: var(--ie-accent-hover);
  transform: translateY(-0.0625rem);
  box-shadow: 0 0.25rem 0.6rem rgba(244, 114, 182, 0.3);
}
.efx-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.efx-btn-stop {
  display: inline-flex; gap: 0.4rem; align-items: center;
  background: var(--ie-surface-3); border: 0; color: var(--ie-text);
  padding: 0.45rem 0.75rem; border-radius: 0.35rem;
  font-family: inherit; font-size: 0.74rem; cursor: pointer;
  transition: background 140ms ease;
}
.efx-btn-stop:hover { background: #444; }

.efx-track-count {
  margin-left: 0.5rem; font-size: 0.68rem;
  color: var(--ie-text-faint);
}

.efx-btn-save {
  display: inline-flex; gap: 0.45rem; align-items: center;
  width: 100%;
  background: linear-gradient(135deg, var(--ie-accent), var(--ie-accent-hover));
  border: 0; color: #fff;
  padding: 0.55rem 0.8rem; border-radius: 0.4rem;
  font-family: inherit; font-size: 0.78rem; font-weight: 600; cursor: pointer;
  transition: filter 140ms ease, transform 140ms ease, box-shadow 160ms ease;
  box-shadow: 0 0.15rem 0.4rem rgba(244, 114, 182, 0.18);
}
.efx-btn-save:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-0.0625rem);
  box-shadow: 0 0.4rem 0.9rem rgba(244, 114, 182, 0.32);
}
.efx-btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
/* Refonte 2026-05-15cl — Animation "Sauvé !" : pulse vert + scale */
.efx-btn-save.is-saved {
  background: linear-gradient(135deg, #10b981, #059669);
  animation: efx-saved-pulse 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
  box-shadow: 0 0 0 0.25rem rgba(16, 185, 129, 0.18);
}
@keyframes efx-saved-pulse {
  0%   { transform: scale(1); }
  35%  { transform: scale(1.04); }
  100% { transform: scale(1); }
}

/* Refonte 2026-05-15cm — Bouton Sauver compact en icon dans le header */
.efx-header-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 2rem; height: 2rem;
  background: var(--ie-surface-2);
  border: 0.0625rem solid var(--ie-border);
  border-radius: 0.3rem;
  color: var(--ie-text-muted); cursor: pointer;
  transition: all 140ms ease;
  padding: 0;
}
.efx-header-icon-btn:hover:not(:disabled) {
  background: var(--ie-surface-3);
  border-color: var(--ie-accent);
  color: var(--ie-accent);
  transform: translateY(-0.0625rem);
}
.efx-header-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.efx-header-save.is-saved {
  background: linear-gradient(135deg, #10b981, #059669);
  border-color: #10b981;
  color: #fff;
  animation: efx-saved-pulse 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
  box-shadow: 0 0 0 0.2rem rgba(16, 185, 129, 0.18);
}
.efx-header-export:hover:not(:disabled) {
  border-color: #60a5fa;
  color: #60a5fa;
}

/* Phase D — Overlay progress export sur la preview (refonte 2026-05-15cp) */
.efx-export-overlay {
  position: absolute; inset: 0; z-index: 30;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.6rem;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(0.3rem);
  pointer-events: none;
}
.efx-export-stage {
  color: #fff; font-size: 0.95rem; font-weight: 600;
  letter-spacing: 0.02em;
  text-shadow: 0 0 0.4rem rgba(0, 0, 0, 0.8);
}
.efx-export-bar {
  width: 60%; max-width: 30rem;
  height: 0.4rem;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 0.2rem; overflow: hidden;
}
.efx-export-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #60a5fa, #818cf8);
  transition: width 200ms ease;
  box-shadow: 0 0 0.4rem #60a5fa;
}
.efx-export-pct {
  color: #fff; font-family: ui-monospace, monospace; font-size: 0.78rem;
}
.efx-export-error {
  position: absolute; bottom: 0.5rem; left: 0.5rem; right: 0.5rem; z-index: 25;
  padding: 0.4rem 0.7rem; border-radius: 0.3rem;
  background: rgba(239, 68, 68, 0.92); color: #fff; font-size: 0.78rem;
}
/* Toast info post-export (refonte 2026-05-15cv) */
.efx-export-info {
  position: absolute; bottom: 0.6rem; left: 50%; transform: translateX(-50%);
  z-index: 25;
  padding: 0.45rem 0.85rem; border-radius: 1rem;
  background: rgba(16, 185, 129, 0.92); color: #fff;
  font-size: 0.78rem; font-weight: 600;
  font-family: ui-monospace, monospace;
  box-shadow: 0 0.3rem 0.8rem rgba(16, 185, 129, 0.35);
  animation: efx-export-info-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes efx-export-info-in {
  from { opacity: 0; transform: translate(-50%, 0.3rem); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}

/* Bouton Enregistrer cible compact (refonte 2026-05-15cm) */
.efx-btn-record {
  display: inline-flex; gap: 0.35rem; align-items: center; justify-content: center;
  background: color-mix(in srgb, #F87171 18%, var(--ie-surface-2));
  border: 0.0625rem solid color-mix(in srgb, #F87171 50%, transparent);
  color: var(--ie-text);
  padding: 0.35rem 0.6rem; border-radius: 0.3rem;
  font-family: inherit; font-size: 0.7rem; font-weight: 600;
  cursor: pointer;
  transition: all 140ms ease;
}
.efx-btn-record:hover:not(:disabled) {
  background: color-mix(in srgb, #F87171 30%, var(--ie-surface-2));
  border-color: #F87171;
  transform: translateY(-0.0625rem);
}
.efx-btn-record:disabled { opacity: 0.5; cursor: not-allowed; }
.efx-btn-record.is-stop {
  background: var(--ie-surface-3);
  border-color: var(--ie-border-strong);
}
/* Bouton Aperçu — vert pour différencier de Record (refonte 2026-05-15cz) */
.efx-btn-preview {
  display: inline-flex; gap: 0.35rem; align-items: center; justify-content: center;
  background: color-mix(in srgb, #10b981 15%, var(--ie-surface-2));
  border: 0.0625rem solid color-mix(in srgb, #10b981 50%, transparent);
  color: var(--ie-text);
  padding: 0.35rem 0.6rem; border-radius: 0.3rem;
  font-family: inherit; font-size: 0.7rem; font-weight: 600;
  cursor: pointer;
  transition: all 140ms ease;
  margin-left: 0.3rem;
}
.efx-btn-preview:hover:not(:disabled) {
  background: color-mix(in srgb, #10b981 28%, var(--ie-surface-2));
  border-color: #10b981;
  transform: translateY(-0.0625rem);
}
.efx-btn-preview:disabled { opacity: 0.5; cursor: not-allowed; }

.efx-spin { animation: efx-spin 0.9s linear infinite; }
@keyframes efx-spin { to { transform: rotate(360deg); } }

/* ── Responsive — sur petits écrans, masque la sidebar droite ─────────── */
@media (max-width: 64rem) {
  .efx-body { grid-template-columns: 10.5rem minmax(0, 1fr); }
  .efx-right { display: none; }
  .efx-cards-grid { grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); }
  .efx-preview-wrap { max-height: 50%; padding: 0.75rem 0.75rem 0.5rem; }
  .efx-cards-wrap { padding: 0.5rem 0.75rem 0.75rem; }
}
@media (max-width: 40rem) {
  .efx-body { grid-template-columns: minmax(0, 1fr); }
  .efx-sidebar { display: none; }
}
`
