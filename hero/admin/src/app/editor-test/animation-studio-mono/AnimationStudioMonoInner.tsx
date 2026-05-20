'use client'
/**
 * AnimationStudioInner — orchestrateur du nouvel écran d'animation.
 *
 * Layout 4 zones (cf project_designer_animation_screen_redesign_2026_05_07.md) :
 *   ┌──┬─────────────────────────────┬─────────┐
 *   │R │ Header                      │         │
 *   │a ├─────────────────────────────┤         │
 *   │i │ Storyboard timeline horizontal        │
 *   │l ├─────────────────────────────┤ Preview │
 *   │  │ Zone PROMPT (shots empilés) │ device  │
 *   │  │ + persos vignettes par shot │         │
 *   │  │                             │         │
 *   └──┴─────────────────────────────┴─────────┘
 *
 * Banques (images, persos) = panneaux slidables depuis la gauche, fermés par
 * défaut. Mutual exclusion avec preview à droite.
 *
 * Au mount : fetch du plan via planId URL → hydrate animationPellicules +
 * imageUrl base + characters depuis npcs du book.
 */

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Sparkles, Sun, Moon } from 'lucide-react'
import PreviewModal from '@/components/preview-modal/PreviewModal'
import type { PelliculePersisted } from '@/types'
import ConfirmDialog from '@/components/studio-section/ConfirmDialog'
import { useThemePreference } from '@/lib/use-theme-preference'
import {
  useEditorState,
  type AnimationPellicule,
  type Shot,
} from '@/components/image-editor/EditorStateContext'
import { useCharacterStore, type Character } from '@/lib/character-store'
import { CharacterPersistProvider, type CharacterPersistFn } from '@/lib/character-persist-context'
import type { Npc } from '@/types'
import {
  generateAnimationPellicule,
  MissingVoiceError,
} from '@/lib/ltx-generation-orchestrator'
import { describeSceneViaVision } from '@/lib/scene-description'
// Refonte 2026-05-15ca — VideoEffectsPanel (drawer Phase B/C) remplacé par
// EffectsModal (modale 3 colonnes, looks composites). Triggers = hover banque
// + hover bloc timeline. Plus de bouton Effets dans le rail.
import EffectsModal from '@/components/image-editor/designer/effects/EffectsModal'
import {
  migrateLegacyEffectsParams,
  type ComposedEffectsState,
} from '@/lib/video-effects/looks-catalog'
// Refonte 2026-05-17 — Studio Mono : plus de MultiTrackEditor (timeline retirée).
// La page d'origine /editor-test/animation-studio garde le MultiTrackEditor.
// Refonte 2026-05-17 — Studio Mono : on réutilise les composants du Studio
// original (../animation-studio/components/). Pas de fork des composants —
// seul l'AnimationStudioMonoInner diffère (timeline retirée + tuile source).
import AnimationStudioPromptZone from '../animation-studio/components/AnimationStudioPromptZone'
import AnimationStudioRail from '../animation-studio/components/AnimationStudioRail'
import AnimationStudioBankPanel, { type BankAsset } from '../animation-studio/components/AnimationStudioBankPanel'
import '../animation-studio/components/animation-studio-bank.css'
import AnimationStudioCharactersDrawer from '../animation-studio/components/AnimationStudioCharactersDrawer'
import AnimationStudioLightbox from '../animation-studio/components/AnimationStudioLightbox'
import { type AiPaletteContext, type AiExtraction } from '../animation-studio/components/AnimationStudioAiPalette'
import AnimationStudioAiChat from '../animation-studio/components/AnimationStudioAiChat'
import type { ChatMessage, ChatShotProposal } from '@/lib/ai-chat-types'
import PelliculeExitEditor from '../animation-studio/components/PelliculeExitEditor'
import type { PelliculeExit } from '@/components/image-editor/EditorStateContext'
// Refonte 2026-05-17 — Studio Mono utilise PreviewModal en mode embedded
// (= rendu inline, pas floating) pour la tuile source. Le CSS preview-modal.css
// est déjà importé via PreviewModal lui-même.
import './animation-studio.css'

// Refonte 2026-05-15ca — 'effects' retiré (drawer remplacé par modale).
type DrawerMode = 'closed' | 'characters' | 'images'

// Refonte 2026-05-15dt — Target unifié pour modale Effets/Capture, couvre 2
// sources (tile banque + bloc timeline).
type EffectsModalTarget = {
  assetId: string
  videoUrl: string | null
  firstFrameUrl: string | null
  label: string | null
  effects_params: Record<string, unknown> | null
}

export default function AnimationStudioMonoInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const planId = searchParams?.get('planId') ?? null
  const returnSectionId = searchParams?.get('returnSectionId') ?? null
  // Refonte 2026-05-13 : navigation depuis Studio Section refondu — passe
  // planIndex+sectionId au lieu du planId legacy. Source : section.images[N].
  const planIndexFromUrl = searchParams?.get('planIndex')
    ? parseInt(searchParams.get('planIndex')!, 10)
    : null
  const sectionIdFromUrl = searchParams?.get('sectionId') ?? null
  // Refonte V2 2026-05-13 : nouveau flow via assetId (= row assets_animation).
  // Coexiste avec planId legacy + planIndex+sectionId mid-V1.
  const assetIdFromUrl = searchParams?.get('assetId') ?? null
  // Lazy-create 2026-05-13 : draftAssetId = UUID local non encore en DB. Le
  // commit (POST asset + POST timeline) se fait dès la première vidéo générée.
  const draftAssetIdFromUrl = searchParams?.get('draftAssetId') ?? null
  // Optionnel : image flat envoyée par "Animer cette scène" (Designer) pour
  // pré-remplir la pellicule draft (firstFrameUrl + imageUrl du canvas).
  const draftFirstFrameUrl = searchParams?.get('firstFrameUrl') ?? null
  // Refonte 2026-05-14at — Studio Section "Continuer" : assetId de la pellicule
  // à étendre (V2V Extend). Quand cet asset est hydraté + présent dans
  // animationPellicules, on auto-déclenche handleContinueVideo (1 fois).
  const continueFromAssetIdFromUrl = searchParams?.get('continueFromAssetId') ?? null
  // Refonte 2026-05-17 — Mono studio : Studio Section "Ajouter" passe
  // addedFromAssetId = assetId de l'animation source (= celle dont on prend la
  // lastFrame comme firstFrameUrl). Permet d'afficher la tuile image source.
  const addedFromAssetIdFromUrl = searchParams?.get('addedFromAssetId') ?? null

  const {
    addAnimationPellicule, animationPellicules, animationSelectedPelliculeId,
    setAnimationSelectedPellicule, setImageUrl, imageUrl,
    updateAnimationPellicule, updateAnimationShot, setCurrentVideo,
    removeAnimationPellicule,
    updateAnimationPelliculeCharData, shotAddCharacter, shotSetSpeaker,
  } = useEditorState()
  const { setCharacters: setStoreCharacters, characters } = useCharacterStore()

  const [bookId, setBookId] = useState<string | null>(null)
  const [npcs, setNpcs] = useState<Npc[]>([])
  /** Section parente du plan + ses Choices — chargés en parallèle du book
   *  pour alimenter le picker de cible "Choice de Section" dans l'éditeur
   *  d'overlay choix pellicule (Phase 1 choix épreuve, refonte 2026-05-11). */
  const [sectionChoices, setSectionChoices] = useState<Array<{ id: string; label: string }>>([])
  // Images de la section (= section.images filtrées kind='image'). Alimentent
  // le folder Images de la library en /animation-studio (refonte 2026-05-13).
  const [sectionBankImages, setSectionBankImages] = useState<Array<{ id: string; url: string; label?: string }>>([])
  const [loading, setLoading] = useState(!!planId || (planIndexFromUrl !== null && !!sectionIdFromUrl) || !!assetIdFromUrl || !!draftAssetIdFromUrl)
  // Lazy-create — true tant que l'asset/bloc timeline n'ont pas été POST en
  // DB (auto-save no-op, premier video_url déclenche le commit + URL replace).
  const [isDraftPending, setIsDraftPending] = useState<boolean>(!!draftAssetIdFromUrl)
  const draftCommitInFlightRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerMode>('closed')
  // Refonte 2026-05-15ca — Modale Effets ouverte sur une pellicule donnée
  // (assetId = animationPellicule.id). null = fermée. Triggers : icône ✨ au
  // hover dans la banque + au hover sur les blocs video timeline.
  // Refonte 2026-05-15dt — Target unifié (assetId + videoUrl + firstFrameUrl
  // + label + effects_params). Couvre 2 sources : tile banque (asset_animation
  // même hors timeline) ET bloc timeline. Sans ça, l'asset banque non posé en
  // timeline ne trouvait pas de targetPellicule → modale jamais ouverte.
  const [effectsModalTarget, setEffectsModalTarget] = useState<EffectsModalTarget | null>(null)
  // Refonte 2026-05-15dq+dt — Modale Capture (séparée d'Effets, mode='capture').
  // Triggers : bouton 📸 Capture du bandeau bas (banque + blocs timeline).
  const [captureModalTarget, setCaptureModalTarget] = useState<EffectsModalTarget | null>(null)
  // Helpers : construire un target depuis l'asset banque ou la pellicule timeline.
  const buildTargetFromAsset = useCallback((asset: BankAsset): EffectsModalTarget => ({
    assetId: asset.id,
    videoUrl: asset.video_url ?? null,
    firstFrameUrl: asset.first_frame_url ?? null,
    label: asset.label ?? null,
    effects_params: (asset.effects_params as Record<string, unknown> | null) ?? null,
  }), [])
  const buildTargetFromPellicule = useCallback((pelliculeId: string): EffectsModalTarget | null => {
    const p = animationPellicules.find(pp => pp.id === pelliculeId)
    if (!p) return null
    return {
      assetId: p.id,
      videoUrl: p.videoUrl ?? null,
      firstFrameUrl: p.firstFrameUrl ?? null,
      label: p.label ?? null,
      effects_params: (p.effects_params as Record<string, unknown> | null) ?? null,
    }
  }, [animationPellicules])
  // Debounce des PATCH effects_params côté DB (l'autosave de la modale envoie
  // un onChange à chaque mutation, ex: chaque tick de slider — sans debounce
  // ça produit 30 req/s. Refonte 2026-05-15ca).
  const effectsPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { theme, toggleTheme } = useThemePreference()
  // Génération LTX : id de la pellicule en cours + label de progression
  const [generatingPelliculeId, setGeneratingPelliculeId] = useState<string | null>(null)
  const [generatingProgressLabel, setGeneratingProgressLabel] = useState('')
  /** Si null : on ouvre le drawer sans cible (ex: rail click). Sinon : on
   *  ouvre dans le contexte d'un shot précis (= ajout d'un perso à CE shot). */
  const [drawerTargetShotId, setDrawerTargetShotId] = useState<string | null>(null)
  /** id de la pellicule à afficher dans le lightbox plein écran (Palier C).
   *  null = lightbox fermé. */
  const [lightboxPelliculeId, setLightboxPelliculeId] = useState<string | null>(null)
  // Refonte 2026-05-17 — timelinePlaying RETIRÉ (plus de MultiTrackEditor).
  // Le PreviewModal pilote sa propre lecture en mode mono.
  // PreviewModal floating window — refonte 2026-05-16 (memory project_preview_modal_unified)
  // Remplace le sidebar AnimationStudioPreview (cadrage par drag différé V2 cf
  // memory project_cropping_in_preview_modal_v2).
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  // Suppression asset banque (refonte 2026-05-16) — popup confirm cascade
  // DELETE + liste sections cliquables pour navigation Studio Section.
  const [deleteAssetTarget, setDeleteAssetTarget] = useState<{
    asset: BankAsset
    kind: 'animations' | 'images'
    sectionsUsing: { id: string; number: number; title?: string | null }[]
  } | null>(null)
  const [deletingAsset, setDeletingAsset] = useState(false)
  /** Refonte 2026-05-14bt — Compteur incremental qui force le panel banque V2
   *  à refetch ses assets. Bumpé après chaque gen / commit asset_animation
   *  pour que la nouvelle pellicule générée apparaisse immédiatement dans
   *  la banque (au lieu d'attendre une fermeture/réouverture du panel). */
  const [bankRefreshKey, setBankRefreshKey] = useState(0)
  /** Modal "Demande à l'IA" Ctrl+K. open = visible. */
  const [aiPaletteOpen, setAiPaletteOpen] = useState(false)
  /** Historique de la conversation chat IA (refonte 2026-05-11). Persiste à
   *  travers les ouvertures/fermetures du panel Ctrl+K. Reset au refresh page
   *  (acceptable V1). Format ChatMessage[] — cf src/lib/ai-chat-types.ts. */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  /** Modal d'édition de l'exit de la pellicule active (Step 2 refonte 2026-05-11). */
  const [exitEditorOpen, setExitEditorOpen] = useState(false)
  /** Description Qwen VL de l'image source (Phase 4). Pré-fetché en arrière-
   *  plan au mount + à chaque changement d'imageUrl (= changement de plan).
   *  Passé au palette pour enrichir le contexte Mistral. null = pas encore
   *  prêt (l'auteur peut quand même utiliser la palette, juste contexte +
   *  pauvre). Cache invalidé à chaque imageUrl différent. */
  const [aiImageDescription, setAiImageDescription] = useState<string | null>(null)
  /** Description Qwen VL en mode 'characters' : décrit ce que les persos
   *  PORTENT dans l'image source (jersey, shorts, accessoires…) au format
   *  Vantage `Male: ... / Female: ...`. Source de vérité pour les vêtements
   *  → évite que Mistral invente des défauts ("black shorts" stéréotypique).
   *  Pré-fetch en parallèle avec aiImageDescription au mount. Refonte 2026-05-11. */
  const [aiCharactersDescription, setAiCharactersDescription] = useState<string | null>(null)
  /** État du pré-fetch Qwen VL (les 2 calls scene+characters parallèles).
   *  Affiché en badge dans la palette IA pour que l'auteur SACHE quand il
   *  peut soumettre sans rater le contexte Qwen (51s sur 8 GB VRAM, donc
   *  l'auteur va souvent vouloir soumettre avant que ça finisse). Refonte
   *  2026-05-11. */
  const [aiQwenStatus, setAiQwenStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  /** Positions spatiales des persos drag-droppés au moment de "Animer cette
   *  scène" (chemin A — refonte 2026-05-10). Hydratées depuis plan.data.
   *  characterPlacements. Passées à l'orchestrator → builder Vantage qui
   *  suffixe "on the X side" dans [Characters] block → LTX résout l'identité
   *  spatialement de manière déterministe (vs B Qwen VL fallback). */
  const [characterPositions, setCharacterPositions] = useState<Record<string, 'left' | 'center' | 'right'>>({})

  // Hydrate plan + npcs au mount
  useEffect(() => {
    if (!planId) {
      setLoading(false)
      return
    }
    let aborted = false
    async function load() {
      try {
        // 1. Fetch plan
        const planRes = await fetch(`/api/plans/${planId}`)
        if (!planRes.ok) throw new Error(`plan HTTP ${planRes.status}`)
        // Type permissif : les shots persistés peuvent arriver dans plusieurs
        // shapes selon l'âge du save (perCharacter ou perCharacterAction,
        // characterIds/speakerId optionnels). L'hydratation ci-dessous comble.
        const planRow = await planRes.json() as {
          book_id: string
          /** Section parente du plan (utilisée pour récupérer la liste des
           *  Choices de la Section dans le picker de cible des choix overlay
           *  pellicule — refonte 2026-05-11 Phase 1 choix épreuve). */
          section_id?: string
          data?: {
            imageUrl?: string | null
            /** Snapshot positions persos drag-droppés au moment de "Animer
             *  cette scène" (Designer → AnimationStudio). Refonte 2026-05-10
             *  pour ancrage spatial dans le prompt Vantage. */
            characterPlacements?: Array<{
              character_id: string
              position: 'left' | 'center' | 'right'
            }>
            /** Pan-and-scan animation-level (refonte 2026-05-08). */
            cropKeyframes?: Partial<Record<
              'phone' | 'tabletPortrait' | 'tabletLandscape',
              Array<{ time: number; x: number; y: number; scale: number }>
            >>
            sequences?: Array<{
              id?: string
              sort_order?: number
              characterIds?: string[]
              videoUrl?: string | null
              firstFrameUrl?: string | null
              lastFrameUrl?: string | null
              scene_visible?: string | null
              scene_offscreen?: string | null
              characters_appearance?: string | null
              trimStart?: number
              trimEnd?: number
              source?: 'ltx' | 'upload'
              shots?: Array<{
                id?: string
                shot?: string
                camera?: string
                duration?: number
                characterIds?: string[]
                speakerId?: string | null
                perCharacter?: Record<string, { action?: string; dialogue?: string }>
                perCharacterAction?: Record<string, { action?: string; dialogue?: string }>
                cropKeyframes?: unknown
              }>
            }>
          }
        }
        if (aborted) return

        // Hydrate l'image base
        if (planRow.data?.imageUrl) setImageUrl(planRow.data.imageUrl)
        setBookId(planRow.book_id)

        // Hydrate les positions spatiales persos (chemin A) — depuis le snapshot
        // posé par le Designer au moment de "Animer cette scène". Permet à
        // l'orchestrator d'ancrer Roman/Marvyn dans le prompt Vantage sans
        // appel Qwen VL. Si vide → fallback B (Qwen VL via auto characters_appearance).
        const placements = planRow.data?.characterPlacements ?? []
        if (placements.length > 0) {
          const map: Record<string, 'left' | 'center' | 'right'> = {}
          for (const p of placements) {
            if (p.character_id && p.position) map[p.character_id] = p.position
          }
          setCharacterPositions(map)
        }

        // (cropKeyframes hydratation retirée 2026-05-09 — feature pan-and-scan
        //  abandonnée. Le format vidéo sera défini à la génération LTX.)

        // Hydrate les pellicules avec migration backward-compat.
        // Les shots persistés peuvent arriver dans 2 shapes selon l'âge du save :
        //   - vieille (avant β.1+ 2026-05-06) : champs flat sur la pellicule
        //     (shot/camera/duration/perCharacterAction). On ignore ici — pour le
        //     nouvel écran, on impose la migration via le Designer existant qui
        //     wrap dans shots[0]. Si shots[] absent → pellicule vide héritée.
        //   - moderne : shots[] avec id/shot/camera/duration/perCharacter (ou
        //     perCharacterAction selon la version). Refonte 2026-05-07 a ajouté
        //     characterIds + speakerId par shot — peuvent manquer sur saves
        //     intermédiaires, on fallback ici.
        const persistedPellicules = planRow.data?.sequences ?? []
        for (const p of persistedPellicules.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
          const hydratedShots = Array.isArray(p.shots)
            ? p.shots.map(s => {
                const perChar = Object.fromEntries(
                  Object.entries(s.perCharacterAction ?? s.perCharacter ?? {}).map(([k, v]) => [
                    k,
                    { action: v?.action ?? '', dialogue: v?.dialogue ?? '' },
                  ]),
                )
                const charIds = s.characterIds ?? Object.keys(perChar)
                const speakerFallback = Object.entries(perChar)
                  .find(([, d]) => d.dialogue.trim().length > 0)?.[0] ?? null
                return {
                  id: s.id ?? `shot-${Math.random().toString(36).slice(2, 8)}`,
                  shot: (s.shot ?? 'medium') as 'wide' | 'medium' | 'close_up' | 'extreme_close_up',
                  camera: (s.camera ?? 'static') as 'static' | 'slow_zoom_in' | 'slow_zoom_out'
                    | 'pan_left' | 'pan_right' | 'dolly_in' | 'dolly_out' | 'handheld',
                  duration: s.duration ?? 3,
                  characterIds: charIds,
                  speakerId: s.speakerId ?? speakerFallback,
                  perCharacter: perChar,
                  cropKeyframes: s.cropKeyframes as never,
                }
              })
            : undefined
          // On utilise addAnimationPellicule qui prend un partial — le reducer
          // applique les defaults pour les champs manquants (notamment shots
          // si hydratedShots=undefined → 1 shot vide).
          addAnimationPellicule({
            id: p.id,
            shots: hydratedShots,
            characterIds: p.characterIds,
            videoUrl: p.videoUrl ?? null,
            firstFrameUrl: p.firstFrameUrl ?? null,
            lastFrameUrl: p.lastFrameUrl ?? null,
            scene_visible: p.scene_visible ?? null,
            scene_offscreen: p.scene_offscreen ?? null,
            characters_appearance: p.characters_appearance ?? null,
            trimStart: p.trimStart,
            trimEnd: p.trimEnd,
            source: p.source ?? 'ltx',
          })
        }

        // 2. Fetch book pour récupérer les NPCs + (en parallèle) Section parente
        // pour les Choices de la Section (Phase 1 choix épreuve, refonte 2026-05-11).
        const [bookRes, sectionRes] = await Promise.all([
          fetch(`/api/books/${planRow.book_id}`),
          planRow.section_id ? fetch(`/api/sections/${planRow.section_id}`) : Promise.resolve(null),
        ])
        if (!bookRes.ok) throw new Error(`book HTTP ${bookRes.status}`)
        const bookData = await bookRes.json() as { npcs?: Npc[] }
        if (aborted) return

        // Hydrate les choices de la Section parente (lecture seule pour le picker).
        // On ne fait que mapper {id, label} pour l'UI — pas besoin du reste.
        if (sectionRes && sectionRes.ok) {
          try {
            const sectionData = await sectionRes.json() as { choices?: Array<{ id: string; choice_text?: string; condition_summary?: string }> }
            if (!aborted) {
              setSectionChoices((sectionData.choices ?? []).map(c => ({
                id: c.id,
                label: c.choice_text ?? c.condition_summary ?? `(Choice ${c.id.slice(0, 8)})`,
              })))
            }
          } catch (err) {
            console.warn('[AnimationStudio] Section choices hydration failed (non-bloquant):', err)
          }
        }

        setNpcs(bookData.npcs ?? [])
        // Push dans le CharacterStore pour que les composants downstream
        // accèdent aux persos via useCharacterStore (pattern Designer).
        // Fix 2026-05-10 : lire portrait_settings.gender + fullbody_gray_url
        // + images (galerie) — sinon l'édition d'un perso le ré-écrit en
        // 'female' / sans plein-pied / sans vues alternatives.
        const mapped: Character[] = (bookData.npcs ?? []).map(n => {
          const ext = n as Npc & {
            portrait_url?: string | null
            fullbody_gray_url?: string | null
            fullbody_back_url?: string | null
            voice_id?: string | null
            appearance?: string | null
            portrait_settings?: { style?: string; gender?: 'male' | 'female'; engine?: string }
            images?: Character['images']
          }
          const persistedGender = ext.portrait_settings?.gender
          return {
            id: n.id,
            name: n.name,
            portraitUrl: ext.portrait_url ?? null,
            fullbodyUrl: ext.fullbody_gray_url ?? null,
            fullbodyBackUrl: ext.fullbody_back_url ?? null,
            gender: persistedGender === 'male' ? 'male' : 'female',
            voice_id: ext.voice_id ?? undefined,
            prompt: ext.appearance ?? undefined,
            images: ext.images ?? undefined,
            createdAt: 0,
          }
        })
        setStoreCharacters(mapped)
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[AnimationStudio] load failed:', msg)
        setError(msg)
      } finally {
        if (!aborted) setLoading(false)
      }
    }
    void load()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId])

  // Refonte V2 2026-05-13 — branche assetId : load via /api/assets/animation/[id].
  // 1 asset = 1 pellicule dans le contexte. Au save, PATCH cet asset directement.
  useEffect(() => {
    if (planId || (planIndexFromUrl !== null && sectionIdFromUrl)) return  // priorité aux flows précédents
    if (!assetIdFromUrl) return
    let aborted = false
    void (async () => {
      try {
        // 1. Fetch l'asset animation
        const assetRes = await fetch(`/api/assets/animation/${assetIdFromUrl}`)
        if (assetRes.status === 404) {
          // Refonte 2026-05-14 — handle propre 404 (cas : asset cleanupé,
          // URL périmée, etc.). Avant : crash silencieux ligne 412 sur
          // `asset.first_frame_url` car asset était undefined.
          throw new Error(
            `Asset ${assetIdFromUrl?.slice(0, 8)}... introuvable (probablement supprimé). `
            + 'Retourne au Studio Section pour choisir un autre asset.',
          )
        }
        if (!assetRes.ok) {
          throw new Error(`assets/animation/${assetIdFromUrl} HTTP ${assetRes.status}`)
        }
        const { asset } = await assetRes.json() as { asset: {
          id: string
          video_url?: string | null
          first_frame_url?: string | null
          last_frame_url?: string | null
          label?: string | null
          scene_visible?: string | null
          scene_offscreen?: string | null
          characters_appearance?: string | null
          character_ids?: string[]
          shots?: Array<{
            id?: string
            shot?: string
            camera?: string
            duration?: number
            characterIds?: string[]
            speakerId?: string | null
            perCharacter?: Record<string, { action: string; dialogue: string }>
            sceneAction?: string
            textOverlays?: unknown[]
          }>
          type?: 'animation' | 'image_static' | 'conversation'
          source?: 'ltx' | 'upload'
          v2v_continue?: boolean
          exit_data?: unknown
          audio_tracks?: unknown[]
        } }
        if (aborted) return
        if (!asset) {
          throw new Error(`Réponse asset vide pour ${assetIdFromUrl?.slice(0, 8)}...`)
        }

        // 2. Récupère bookId depuis sectionId si fourni
        let resolvedBookId: string | null = null
        if (sectionIdFromUrl) {
          const secRes = await fetch(`/api/sections/${sectionIdFromUrl}`)
          if (secRes.ok) {
            const { section } = await secRes.json() as { section: { book_id: string } }
            setBookId(section.book_id)
            resolvedBookId = section.book_id
          }
        }
        if (asset.first_frame_url) setImageUrl(asset.first_frame_url)

        // 2bis. Folder Images V2 : fetch /api/assets/image?bookId=X
        if (resolvedBookId) {
          try {
            const imgRes = await fetch(`/api/assets/image?bookId=${resolvedBookId}`)
            if (imgRes.ok) {
              const { assets: imgAssets } = await imgRes.json() as { assets: Array<{
                id: string; url: string; label?: string; description?: string
              }> }
              if (!aborted) {
                setSectionBankImages(imgAssets
                  .filter(a => !!a.url)
                  .map(a => ({
                    id: a.id,
                    url: a.url,
                    label: a.label ?? a.description?.slice(0, 24) ?? `Image ${a.id.slice(0, 4)}`,
                  })))
              }
            }
          } catch (err) {
            console.warn('[AnimationStudio V2] fetch bankImages failed:', err)
          }
        }

        // 3. Hydrate 1 pellicule depuis cet asset
        const hydratedShots = (asset.shots ?? []).map(s => ({
          id: s.id ?? `shot-${Math.random().toString(36).slice(2, 8)}`,
          shot: (s.shot ?? 'medium') as 'wide' | 'medium' | 'close_up' | 'extreme_close_up',
          camera: (s.camera ?? 'static') as 'static' | 'slow_zoom_in' | 'slow_zoom_out'
            | 'pan_left' | 'pan_right' | 'dolly_in' | 'dolly_out' | 'handheld',
          duration: s.duration ?? 4,
          characterIds: s.characterIds ?? [],
          speakerId: s.speakerId ?? null,
          perCharacter: s.perCharacter ?? {},
          sceneAction: s.sceneAction,
          textOverlays: s.textOverlays as never,
        }))
        // Guard contre double-add : le reducer skip déjà via id check, mais
        // on évite l'appel inutile pour éviter le re-render (#4 audit V2).
        if (!animationPellicules.some(p => p.id === asset.id)) {
          addAnimationPellicule({
            id: asset.id,
            shots: hydratedShots.length > 0 ? hydratedShots : undefined,
            characterIds: asset.character_ids ?? [],
            videoUrl: asset.video_url ?? null,
            firstFrameUrl: asset.first_frame_url ?? null,
            lastFrameUrl: asset.last_frame_url ?? null,
            scene_visible: asset.scene_visible ?? null,
            scene_offscreen: asset.scene_offscreen ?? null,
            characters_appearance: asset.characters_appearance ?? null,
            type: asset.type ?? 'animation',
            source: asset.source ?? 'ltx',
            v2vContinue: asset.v2v_continue ?? false,
          })
        }
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[AnimationStudio V2] load asset failed:', msg)
        setError(msg)
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetIdFromUrl, sectionIdFromUrl, planId, planIndexFromUrl])

  // Refonte 2026-05-14ac — branche DRAFT : on RECRÉE la pellicule en mémoire
  // au mount (= nécessaire pour que le PromptZone s'affiche, sinon il rend
  // un placeholder "Sélectionne une pellicule"). MAIS l'asset_animation +
  // bloc timeline ne sont commit en DB qu'à la 1ère génération réussie via
  // l'auto-commit V3 (qui watch videoUrl != null sur la pellicule draft).
  // L'écran apparaît "vide" car la pellicule n'a pas encore de videoUrl :
  // le bloc timeline interne s'affiche en gris sans thumb (acceptable V1).
  useEffect(() => {
    if (!draftAssetIdFromUrl) return
    if (planId || assetIdFromUrl) return
    if (planIndexFromUrl !== null && sectionIdFromUrl) return
    if (animationPellicules.some(p => p.id === draftAssetIdFromUrl)) {
      setLoading(false)
      return
    }
    let aborted = false
    void (async () => {
      try {
        let resolvedBookId: string | null = null
        if (sectionIdFromUrl) {
          const secRes = await fetch(`/api/sections/${sectionIdFromUrl}`)
          if (secRes.ok) {
            const { section } = await secRes.json() as { section: { book_id: string } }
            if (aborted) return
            setBookId(section.book_id)
            resolvedBookId = section.book_id
          }
        }
        if (resolvedBookId) {
          try {
            const imgRes = await fetch(`/api/assets/image?bookId=${resolvedBookId}`)
            if (imgRes.ok) {
              const { assets: imgAssets } = await imgRes.json() as { assets: Array<{
                id: string; url: string; label?: string; description?: string
              }> }
              if (!aborted) {
                setSectionBankImages(imgAssets
                  .filter(a => !!a.url)
                  .map(a => ({
                    id: a.id, url: a.url,
                    label: a.label ?? a.description?.slice(0, 24) ?? `Image ${a.id.slice(0, 4)}`,
                  })))
              }
            }
          } catch (err) {
            console.warn('[AnimationStudio DRAFT] fetch bankImages failed:', err)
          }
        }
        if (aborted) return
        if (draftFirstFrameUrl) setImageUrl(draftFirstFrameUrl)
        addAnimationPellicule({
          id: draftAssetIdFromUrl,
          characterIds: [],
          videoUrl: null,
          firstFrameUrl: draftFirstFrameUrl,
          lastFrameUrl: null,
          type: 'animation',
          source: 'ltx',
          v2vContinue: false,
        })
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[AnimationStudio DRAFT] init failed:', msg)
        setError(msg)
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftAssetIdFromUrl, sectionIdFromUrl, assetIdFromUrl, planId, planIndexFromUrl])

  // Refonte 2026-05-13 — branche alternative : load via planIndex+sectionId.
  // Lit section.images[planIndex] et hydrate les pellicules de cette animation.
  useEffect(() => {
    if (planId) return  // priorité au flow legacy
    if (planIndexFromUrl === null || !sectionIdFromUrl) return
    let aborted = false
    async function load() {
      try {
        const sectionRes = await fetch(`/api/sections/${sectionIdFromUrl}`)
        if (!sectionRes.ok) throw new Error(`section HTTP ${sectionRes.status}`)
        const { section, choices } = await sectionRes.json() as {
          section: {
            book_id: string
            number: number
            summary?: string | null
            images?: import('@/types').SectionImage[]
          }
          choices?: Array<{ id: string; text?: string }>
        }
        if (aborted) return
        const planFromSection = (section.images ?? [])[planIndexFromUrl!]
        if (!planFromSection) {
          throw new Error(`Plan #${planIndexFromUrl} introuvable (section a ${section.images?.length ?? 0} plan(s))`)
        }
        setBookId(section.book_id)
        if (planFromSection.url) setImageUrl(planFromSection.url)

        // Folder Images de la library = assets_image V2 du livre (refonte
        // 2026-05-13). Avant : section.images JSONB (deprecated).
        try {
          const imgRes = await fetch(`/api/assets/image?bookId=${section.book_id}`)
          if (imgRes.ok) {
            const { assets } = await imgRes.json() as { assets: Array<{
              id: string; url: string; label?: string; description?: string
            }> }
            setSectionBankImages(assets
              .filter(a => !!a.url)
              .map(a => ({
                id: a.id,
                url: a.url,
                label: a.label ?? a.description?.slice(0, 24) ?? `Image ${a.id.slice(0, 4)}`,
              })))
          }
        } catch (err) {
          console.warn('[AnimationStudio V2] fetch bankImages failed:', err)
        }

        // Hydrate les pellicules de l'animation (si déjà existantes).
        // Sinon, on laisse la liste vide — l'auteur cliquera "+ Pellicule".
        const persistedPellicules = planFromSection.pellicules ?? []
        for (const p of persistedPellicules) {
          const hydratedShots = (p.shots ?? []).map(s => ({
            id: s.id,
            shot: s.shot,
            camera: s.camera,
            duration: s.duration,
            characterIds: s.characterIds ?? [],
            speakerId: s.speakerId ?? null,
            perCharacter: s.perCharacter,
            cropKeyframes: s.cropKeyframes,
            sceneAction: s.sceneAction,
            textOverlays: s.textOverlays,
          }))
          addAnimationPellicule({
            id: p.id,
            shots: hydratedShots.length > 0 ? hydratedShots : undefined,
            characterIds: p.characterIds,
            videoUrl: p.videoUrl ?? null,
            firstFrameUrl: p.firstFrameUrl ?? null,
            lastFrameUrl: p.lastFrameUrl ?? null,
            scene_visible: p.scene_visible ?? null,
            scene_offscreen: p.scene_offscreen ?? null,
            characters_appearance: p.characters_appearance ?? null,
          })
        }

        // Hydrate npcs depuis le book + choices de la section
        if (choices) {
          setSectionChoices(choices.map(c => ({
            id: c.id,
            label: c.text ?? `(Choice ${c.id.slice(0, 8)})`,
          })))
        }
        const bookRes = await fetch(`/api/books/${section.book_id}`)
        if (!bookRes.ok) throw new Error(`book HTTP ${bookRes.status}`)
        const bookData = await bookRes.json() as { npcs?: Npc[] }
        if (aborted) return
        setNpcs(bookData.npcs ?? [])
        const mapped: Character[] = (bookData.npcs ?? []).map(n => {
          const ext = n as Npc & {
            portrait_url?: string | null
            fullbody_gray_url?: string | null
            fullbody_back_url?: string | null
            voice_id?: string | null
            appearance?: string | null
            portrait_settings?: { gender?: 'male' | 'female' }
            images?: Character['images']
          }
          return {
            id: n.id,
            name: n.name,
            portraitUrl: ext.portrait_url ?? null,
            fullbodyUrl: ext.fullbody_gray_url ?? null,
            fullbodyBackUrl: ext.fullbody_back_url ?? null,
            gender: ext.portrait_settings?.gender === 'male' ? 'male' : 'female',
            voice_id: ext.voice_id ?? undefined,
            prompt: ext.appearance ?? undefined,
            images: ext.images ?? undefined,
            createdAt: 0,
          }
        })
        setStoreCharacters(mapped)
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[AnimationStudio] load from section failed:', msg)
        setError(msg)
      } finally {
        if (!aborted) setLoading(false)
      }
    }
    void load()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planIndexFromUrl, sectionIdFromUrl, planId])

  /** Pellicule active (sélectionnée dans la timeline). */
  const selectedPellicule = useMemo(
    () => animationPellicules.find(p => p.id === animationSelectedPelliculeId) ?? null,
    [animationPellicules, animationSelectedPelliculeId],
  )

  /** Auto-select la 1ère pellicule au load si rien de sélectionné. */
  useEffect(() => {
    if (!animationSelectedPelliculeId && animationPellicules.length > 0) {
      setAnimationSelectedPellicule(animationPellicules[0].id)
    }
  }, [animationPellicules, animationSelectedPelliculeId, setAnimationSelectedPellicule])

  /** Auto-création d'une 1ère pellicule vide si le plan n'en a aucune au load
   *  (refonte 2026-05-09). DÉSACTIVÉ en mode draft V2 (refonte 2026-05-14ab)
   *  ET en mode normal V2 (refonte 2026-05-14al) : l'auteur arrive sur écran
   *  vide et ne crée la pellicule qu'au 1er Generate / Continue / Upload.
   *  Sinon, après auto-commit V3 + suppression du bloc, une pellicule fantôme
   *  re-spawnait avec juste firstFrameUrl=imageUrl (= "l'image qui persiste"). */
  const autoCreatedPelliculeRef = useRef(false)
  useEffect(() => {
    if (loading) return
    if (draftAssetIdFromUrl) return  // mode draft V2 : pas d'auto-create
    if (assetIdFromUrl) return       // mode normal V2 : idem
    if (autoCreatedPelliculeRef.current) return
    if (animationPellicules.length > 0) return
    if (!imageUrl) return  // pas d'image base → rien à animer
    autoCreatedPelliculeRef.current = true
    addAnimationPellicule({ firstFrameUrl: imageUrl })
  }, [loading, animationPellicules.length, imageUrl, addAnimationPellicule, draftAssetIdFromUrl, assetIdFromUrl])

  /** Ouvre le drawer persos sur un shot ciblé. */
  const handleOpenCharactersDrawer = useCallback((shotId: string | null) => {
    setDrawerTargetShotId(shotId)
    setDrawer('characters')
  }, [])

  /** IDs des persos déjà placés dans le plan (= au moins un shot d'une
   *  pellicule les référence). Sert à filtrer la banque en mode "vue plan"
   *  (rail click sans targetShotId) — l'auteur édite leurs fiches sans être
   *  noyé sous tous les NPCs du livre. Refonte 2026-05-10. */
  const inPlanCharacterIds = useMemo(() => {
    const ids = new Set<string>()
    for (const p of animationPellicules) {
      // Guard 2026-05-14bk : asset_animation hydraté depuis DB peut avoir
      // shots = null si jamais persisté. Skip silencieusement plutôt que crash.
      for (const s of p.shots ?? []) {
        for (const cid of s.characterIds ?? []) ids.add(cid)
      }
    }
    return ids
  }, [animationPellicules])

  /** Persist unifié pour les CharacterCreatorModal sous l'arbre (refonte
   *  2026-05-10 — clone du flow new-layout/page.tsx). Branché via
   *  CharacterPersistProvider. Gère create (POST /api/npcs) ET edit (PATCH).
   *  Met à jour le store local pour feedback immédiat sans refresh. */
  const persistCharacterToDb = useCallback<CharacterPersistFn>(async (payload, mode, editingNpcId) => {
    if (!bookId) throw new Error('book_id manquant')
    const baseBody = {
      name: payload.name,
      portrait_url: payload.portraitUrl,
      fullbody_gray_url: payload.fullbodyUrl,
      // Back-compat legacy column ; la galerie `images` est désormais source
      // de vérité (cf migration 079).
      fullbody_back_url: payload.fullbodyBackUrl ?? null,
      images: payload.images ?? [],
      appearance: payload.prompt,
      portrait_settings: {
        style: payload.style,
        gender: payload.gender,
        engine: payload.engine,
      },
      voice_id: payload.voiceId,
    }
    if (mode === 'edit' && editingNpcId) {
      const res = await fetch(`/api/npcs/${editingNpcId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseBody),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? `PATCH /api/npcs HTTP ${res.status}`)
      // Mise à jour du store local — TOUS les champs persistés. Sinon, après
      // un re-open du modal, on lit l'ancien store sans `images` (vue de dos
      // perdue visuellement même si la DB l'a). Bug observé 2026-05-10.
      setStoreCharacters(characters.map(c => c.id === editingNpcId
        ? {
            ...c,
            name: payload.name,
            portraitUrl: payload.portraitUrl,
            fullbodyUrl: payload.fullbodyUrl,
            fullbodyBackUrl: payload.fullbodyBackUrl ?? null,
            gender: payload.gender,
            voice_id: payload.voiceId ?? undefined,
            prompt: payload.prompt ?? undefined,
            images: payload.images ?? [],
          }
        : c))
      return editingNpcId
    } else {
      const res = await fetch('/api/npcs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId, ...baseBody }),
      })
      const data = await res.json() as { id?: string; name?: string; portrait_url?: string; fullbody_gray_url?: string; fullbody_back_url?: string; error?: string }
      if (!res.ok || !data.id) throw new Error(data.error ?? `POST /api/npcs HTTP ${res.status}`)
      setStoreCharacters([
        ...characters,
        {
          id: data.id,
          name: data.name ?? payload.name,
          portraitUrl: data.portrait_url ?? payload.portraitUrl,
          fullbodyUrl: data.fullbody_gray_url ?? payload.fullbodyUrl,
          fullbodyBackUrl: data.fullbody_back_url ?? payload.fullbodyBackUrl ?? null,
          gender: payload.gender,
          voice_id: payload.voiceId ?? undefined,
          prompt: payload.prompt ?? undefined,
          images: payload.images ?? [],
          createdAt: Date.now(),
        },
      ])
      return data.id
    }
  }, [bookId, characters, setStoreCharacters])

  // ── Auto-save BDD débouncé à 1s ────────────────────────────────────────
  // À chaque changement de animationPellicules (édition shot, ajout/remove
  // perso, scène, etc.), on déclenche un PATCH /api/plans/[id] avec la
  // nouvelle structure data.sequences[]. Débouncé pour éviter de spammer
  // pendant la frappe rapide des actions/dialogues.
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<string>('')  // hash du dernier save (skip si identique)
  /** Toast confirmation save (Ctrl+S manuel). Auto-fade après 1.4s. */
  const [saveToast, setSaveToast] = useState<'saving' | 'saved' | 'error' | null>(null)

  /** Construit le payload normalisé envoyé au PATCH /api/plans/[id]. Extrait
   *  pour pouvoir être utilisé par l'auto-save ET le force-save (Ctrl+S). */
  const buildSerializedPlan = useCallback(() => {
    return JSON.stringify({
      imageUrl,
      sequences: animationPellicules.map((p, idx) => ({
        id: p.id, sort_order: idx,
        characterIds: p.characterIds,
        shots: p.shots.map(s => ({
          id: s.id, shot: s.shot, camera: s.camera, duration: s.duration,
          characterIds: s.characterIds, speakerId: s.speakerId,
          perCharacterAction: s.perCharacter,
          cropKeyframes: s.cropKeyframes,
        })),
        videoUrl: p.videoUrl,
        firstFrameUrl: p.firstFrameUrl,
        lastFrameUrl: p.lastFrameUrl,
        scene_visible: p.scene_visible,
        scene_offscreen: p.scene_offscreen,
        characters_appearance: p.characters_appearance,
        trimStart: p.trimStart,
        trimEnd: p.trimEnd,
        source: p.source,
      })),
    })
  }, [imageUrl, animationPellicules])

  /** Save effectif (utilisé par le débounce ET le force-save Ctrl+S).
   *  3 modes :
   *   - planId legacy → PATCH /api/plans/[planId] avec data sérialisé
   *   - planIndex+sectionId mid-V1 → PATCH /api/sections/[id] avec
   *     section.images[planIndex] reconstruit
   *   - assetId V2 (refonte 2026-05-13) → PATCH /api/assets/animation/[id]
   *     directement, plus de section.images touched */
  const persistPlan = useCallback(async (serialized: string, source: 'auto' | 'manual'): Promise<boolean> => {
    // Lazy-create DRAFT : no-op tant que pas committé. Le commit (POST asset
    // + POST timeline) est déclenché par l'effet auto-commit dès que la
    // pellicule a une video_url. Avant ça on n'écrit rien.
    if (isDraftPending) return false

    // Flow V2 : PATCH asset animation directement
    if (assetIdFromUrl && !planId && (planIndexFromUrl === null || !sectionIdFromUrl)) {
      try {
        // 1 pellicule = 1 asset (par design V2). On prend la 1ère.
        const pell = animationPellicules[0]
        if (!pell) return false
        const r = await fetch(`/api/assets/animation/${assetIdFromUrl}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_url: pell.videoUrl,
            first_frame_url: pell.firstFrameUrl,
            last_frame_url: pell.lastFrameUrl,
            shots: pell.shots,
            character_ids: pell.characterIds,
            scene_visible: pell.scene_visible,
            scene_offscreen: pell.scene_offscreen,
            characters_appearance: pell.characters_appearance,
            type: pell.type,
            source: pell.source,
            v2v_continue: pell.v2vContinue,
            exit_data: pell.exit,
          }),
        })
        if (r.ok) {
          lastSavedRef.current = serialized
          console.log(`[AnimationStudio V2] ${source}-saved (asset ${assetIdFromUrl.slice(0, 8)})`)
          return true
        }
        const errBody = await r.json().catch(() => ({})) as { error?: string }
        console.warn(`[AnimationStudio V2] ${source}-save HTTP ${r.status}:`, errBody.error)
        return false
      } catch (err) {
        console.warn(`[AnimationStudio V2] ${source}-save failed:`, err)
        return false
      }
    }
    // Flow nouveau : update section.images[planIndex] via PATCH section
    if (!planId && planIndexFromUrl !== null && sectionIdFromUrl) {
      try {
        const sectionRes = await fetch(`/api/sections/${sectionIdFromUrl}`)
        if (!sectionRes.ok) throw new Error(`section read HTTP ${sectionRes.status}`)
        const { section } = await sectionRes.json() as {
          section: { images?: import('@/types').SectionImage[] }
        }
        const images = [...(section.images ?? [])]
        const existing = images[planIndexFromUrl] ?? { kind: 'animation' }
        // Sérialise les pellicules runtime au format SectionImage.pellicules
        const pelliculesPersisted = animationPellicules.map(p => ({
          id: p.id,
          type: p.type,
          characterIds: p.characterIds,
          shots: p.shots,
          videoUrl: p.videoUrl,
          firstFrameUrl: p.firstFrameUrl,
          lastFrameUrl: p.lastFrameUrl,
          scene_visible: p.scene_visible ?? null,
          scene_offscreen: p.scene_offscreen ?? null,
          characters_appearance: p.characters_appearance ?? null,
        }))
        // B.6 fix 2026-05-13 : ne pas forcer kind='animation' si l'entrée
        // existante était kind='image' (= ouverture par erreur dans
        // /animation-studio). Skip le save pour éviter d'écraser un plan
        // image en plan animation silencieusement.
        if (existing.kind && existing.kind !== 'animation') {
          console.warn(`[AnimationStudio] persistPlan SKIPPED: existing kind='${existing.kind}', refuse de force kind='animation' (planIndex=${planIndexFromUrl})`)
          return false
        }
        images[planIndexFromUrl] = {
          ...existing,
          kind: 'animation',
          url: existing.url ?? imageUrl ?? '',
          base_video_url: animationPellicules[animationPellicules.length - 1]?.videoUrl ?? existing.base_video_url,
          first_frame_url: animationPellicules[0]?.firstFrameUrl ?? existing.first_frame_url,
          last_frame_url: animationPellicules[animationPellicules.length - 1]?.lastFrameUrl ?? existing.last_frame_url,
          pellicules: pelliculesPersisted,
        }
        const r = await fetch(`/api/sections/${sectionIdFromUrl}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images }),
        })
        if (r.ok) {
          lastSavedRef.current = serialized
          console.log(`[AnimationStudio] ${source}-saved (section.images[${planIndexFromUrl}])`)
          return true
        }
        console.warn(`[AnimationStudio] ${source}-save section HTTP`, r.status)
        return false
      } catch (err) {
        console.warn(`[AnimationStudio] ${source}-save section failed:`, err)
        return false
      }
    }
    // Flow legacy planId
    if (!planId) return false
    try {
      const data = JSON.parse(serialized)
      const r = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      })
      if (r.ok) {
        lastSavedRef.current = serialized
        console.log(`[AnimationStudio] ${source}-saved`)
        return true
      }
      console.warn(`[AnimationStudio] ${source}-save HTTP`, r.status)
      return false
    } catch (err) {
      console.warn(`[AnimationStudio] ${source}-save failed:`, err)
      return false
    }
  }, [planId, planIndexFromUrl, sectionIdFromUrl, assetIdFromUrl, animationPellicules, imageUrl])

  // Lazy-create 2026-05-13 — auto-commit DRAFT : dès que la pellicule a une
  // video_url non-null (= première génération réussie), on POST l'asset
  // animation + POST le bloc timeline puis on bascule l'URL en mode normal V2
  // (?assetId=<draftId>) pour réactiver l'auto-save PATCH. Idempotent : ref
  // empêche double-fire pendant que la requête est en vol.
  useEffect(() => {
    if (!isDraftPending) return
    if (!draftAssetIdFromUrl) return
    if (!sectionIdFromUrl) return
    if (draftCommitInFlightRef.current) return
    const pell = animationPellicules.find(p => p.id === draftAssetIdFromUrl)
    if (!pell || !pell.videoUrl) return
    draftCommitInFlightRef.current = true
    void (async () => {
      try {
        if (!bookId) {
          console.warn('[AnimationStudio DRAFT] commit skipped: bookId not resolved yet')
          draftCommitInFlightRef.current = false
          return
        }
        const assetRes = await fetch('/api/assets/animation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: draftAssetIdFromUrl,  // commit avec l'UUID local → URL stable
            video_url: pell.videoUrl,
            first_frame_url: pell.firstFrameUrl,
            last_frame_url: pell.lastFrameUrl,
            shots: pell.shots,
            character_ids: pell.characterIds,
            scene_visible: pell.scene_visible,
            scene_offscreen: pell.scene_offscreen,
            characters_appearance: pell.characters_appearance,
            type: pell.type,
            source: pell.source,
            v2v_continue: pell.v2vContinue,
            bookId, sectionId: sectionIdFromUrl,
          }),
        })
        if (!assetRes.ok) {
          const errBody = await assetRes.json().catch(() => ({})) as { error?: string }
          throw new Error(errBody.error ?? `POST asset HTTP ${assetRes.status}`)
        }
        const blockRes = await fetch(`/api/sections/${sectionIdFromUrl}/timeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            track: 'video_image',
            asset_type: 'animation',
            asset_id: draftAssetIdFromUrl,
            duration_ms: Math.round((pell.shots?.reduce((s, sh) => s + (sh.duration ?? 4), 0) || 4) * 1000),
          }),
        })
        if (!blockRes.ok) {
          const errBody = await blockRes.json().catch(() => ({})) as { error?: string }
          throw new Error(errBody.error ?? `POST timeline HTTP ${blockRes.status}`)
        }
        // Bascule l'URL : ?draftAssetId → ?assetId (auto-save reprend en PATCH)
        const newParams = new URLSearchParams({
          assetId: draftAssetIdFromUrl,
          sectionId: sectionIdFromUrl,
          returnSectionId: returnSectionId ?? sectionIdFromUrl,
        })
        router.replace(`/editor-test/animation-studio?${newParams.toString()}`)
        setIsDraftPending(false)
        console.log('[AnimationStudio DRAFT] committed asset:', draftAssetIdFromUrl)
        // Refonte 2026-05-14bt — refresh banque V2 après commit draft.
        setBankRefreshKey(k => k + 1)
      } catch (err) {
        console.error('[AnimationStudio DRAFT] commit failed:', err)
        // Laisse retry possible au prochain changement de videoUrl
        draftCommitInFlightRef.current = false
      }
    })()
  }, [isDraftPending, draftAssetIdFromUrl, animationPellicules, bookId, sectionIdFromUrl, returnSectionId, router])

  useEffect(() => {
    const hasTarget = !!planId || (planIndexFromUrl !== null && !!sectionIdFromUrl) || !!assetIdFromUrl
    if (!hasTarget || loading) return
    const serialized = buildSerializedPlan()
    if (serialized === lastSavedRef.current) return  // rien changé
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      void persistPlan(serialized, 'auto')
    }, 1000)
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [planId, planIndexFromUrl, sectionIdFromUrl, assetIdFromUrl, loading, buildSerializedPlan, persistPlan])

  /** Ctrl/Cmd+S : intercepte le raccourci (sinon Chrome ouvre "Save Page As"),
   *  flushe le save immédiatement et affiche un toast de confirmation. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isSave = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
        && (e.key === 's' || e.key === 'S')
      if (!isSave) return
      e.preventDefault()
      const hasTarget = !!planId || (planIndexFromUrl !== null && !!sectionIdFromUrl) || !!assetIdFromUrl
      if (!hasTarget || loading) return
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      const serialized = buildSerializedPlan()
      // Si rien n'a changé depuis le dernier save, on confirme quand même
      // (l'auteur attend un feedback visuel pour son Ctrl+S).
      if (serialized === lastSavedRef.current) {
        setSaveToast('saved')
        return
      }
      setSaveToast('saving')
      void persistPlan(serialized, 'manual').then(ok => {
        setSaveToast(ok ? 'saved' : 'error')
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [planId, loading, buildSerializedPlan, persistPlan])

  // Auto-fade du toast de save
  useEffect(() => {
    if (saveToast !== 'saved' && saveToast !== 'error') return
    const t = setTimeout(() => setSaveToast(null), 1400)
    return () => clearTimeout(t)
  }, [saveToast])

  /** Ctrl/Cmd+K → ouvre la palette IA (Phase 2 chantier IA 2026-05-10).
   *  Override global même en focus textarea (pattern Linear / Notion). */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isAi = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
        && (e.key === 'k' || e.key === 'K')
      if (!isAi) return
      e.preventDefault()
      setAiPaletteOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /** Pré-fetch Qwen VL de l'image source au mount + reset si imageUrl change
   *  (= autre plan, autre scène). Lance en PARALLÈLE 2 calls Qwen :
   *    - mode 'scene'      → décor / ambiance (pour pré-remplir Décor)
   *    - mode 'characters' → vêtements visibles (pour pré-remplir Apparence
   *      persos — refonte 2026-05-11, fix bug shorts noirs inventés par
   *      Mistral quand fiches NPC sparses)
   *
   *  Fix 2026-05-14 : le call 'characters' n'est lancé que si AU MOINS UNE
   *  pellicule a des characterIds non vides. Sinon Qwen invente des persos
   *  fantômes ("Male: dark silhouette…") alors qu'aucun perso n'est censé
   *  être dans la scène. Si l'auteur ajoute un perso à une pellicule plus
   *  tard, le useEffect re-run et le call est lancé. */
  const hasAnyCharacterAssigned = useMemo(
    () => animationPellicules.some(p =>
      (p.characterIds?.length ?? 0) > 0
      || (p.shots ?? []).some(s => (s.characterIds?.length ?? 0) > 0),
    ),
    [animationPellicules],
  )
  // Refonte 2026-05-15 — Image analysée par l'IA = celle SUR laquelle on va
  // animer. Si la pellicule sélectionnée a déjà une vidéo générée, on prend
  // sa firstFrameUrl (= ce que LTX continuera depuis). Sinon fallback sur
  // imageUrl (= image base du plan, point de départ I2V classique).
  const aiAnalysisImageUrl = selectedPellicule?.firstFrameUrl ?? imageUrl
  useEffect(() => {
    if (!aiAnalysisImageUrl) {
      setAiImageDescription(null)
      setAiCharactersDescription(null)
      setAiQwenStatus('idle')
      return
    }
    let aborted = false
    setAiQwenStatus('loading')
    // Si aucun perso assigné → on skip le call 'characters' (= reset à null
    // pour ne pas garder un ancien résultat fantôme). Évite le bug "Qwen
    // invente des persos qui n'existent pas".
    if (!hasAnyCharacterAssigned) {
      setAiCharactersDescription(null)
    }
    void (async () => {
      const calls: Array<Promise<{ description: string }>> = [
        describeSceneViaVision(aiAnalysisImageUrl, 'scene'),
      ]
      if (hasAnyCharacterAssigned) {
        calls.push(describeSceneViaVision(aiAnalysisImageUrl, 'characters'))
      }
      const results = await Promise.allSettled(calls)
      if (aborted) return
      const sceneRes = results[0]
      const charsRes = results[1]  // undefined si on a skip
      if (sceneRes.status === 'fulfilled') {
        setAiImageDescription(sceneRes.value.description)
      } else {
        console.warn('[AnimationStudio] Qwen VL scene pré-fetch échoué:', sceneRes.reason)
        setAiImageDescription(null)
      }
      if (charsRes) {
        if (charsRes.status === 'fulfilled') {
          setAiCharactersDescription(charsRes.value.description)
        } else {
          console.warn('[AnimationStudio] Qwen VL characters pré-fetch échoué:', charsRes.reason)
          setAiCharactersDescription(null)
        }
      }
      const anyOk = sceneRes.status === 'fulfilled'
        || (charsRes?.status === 'fulfilled')
      setAiQwenStatus(anyOk ? 'ready' : 'failed')
    })()
    return () => { aborted = true }
  }, [aiAnalysisImageUrl, hasAnyCharacterAssigned])

  /** Calcule le contexte pellicule à envoyer à Mistral. Mémoïsé sur les
   *  dépendances réelles (pellicule active + characters store) pour ne pas
   *  re-créer l'objet à chaque render — sinon le useEffect d'init du palette
   *  retriggerait trop souvent. */
  const aiPaletteContext: AiPaletteContext | null = useMemo(() => {
    if (!selectedPellicule) return null
    // Helper : enrichit un Character avec sa description (= prompt fiche NPC)
    // et sa position spatiale (depuis Designer placement.x, hydraté dans
    // characterPositions). Refonte 2026-05-11 — fix bug d'attribution Mistral
    // qui inversait Roman/Marvyn quand l'auteur les mentionnait dans la
    // même phrase. Plus de contexte = meilleure désambiguïsation.
    const enrichChar = (c: Character) => ({
      id: c.id,
      name: c.name,
      gender: (c.gender === 'male' ? 'male' : 'female') as 'male' | 'female',
      hasVoice: !!c.voice_id,
      description: c.prompt ?? undefined,
      position: characterPositions[c.id],
    })
    // Refonte 2026-05-11 (fix bug "Aucun perso configuré") — depuis β.1+
    // 2026-05-06, les characterIds sont stockés AU NIVEAU SHOT, pas pellicule.
    // L'ancien selectedPellicule.characterIds est obsolète. On agrège l'union
    // des chars présents dans tous les shots de la pellicule.
    const charIdsInPell = new Set<string>()
    for (const cid of selectedPellicule.characterIds ?? []) charIdsInPell.add(cid)  // backward-compat
    for (const shot of selectedPellicule.shots) {
      for (const cid of shot.characterIds ?? []) charIdsInPell.add(cid)
    }
    const charsInPell = [...charIdsInPell]
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is Character => !!c)
      .map(enrichChar)

    // Dédoublonnage par nom de bookCharacters AVANT envoi à Mistral (refonte
    // 2026-05-11). Si l'auteur a 2 entrées homonymes "Marvyn" + "Marvyn 2"
    // dans sa banque book, Mistral hésite entre les 2 ids et attribue souvent
    // l'action de l'autre perso au doublon → cascade d'erreurs (vignettes
    // dupliquées, actions inversées). On présente UN SEUL id par nom à
    // Mistral. Priorité de résolution :
    //   1. Si un homonyme est déjà dans charsInPell, on garde celui-là
    //   2. Sinon, on garde le 1er rencontré
    const seenNames = new Set<string>()
    for (const c of charsInPell) seenNames.add(c.name.trim().toLowerCase())
    const bookChars: ReturnType<typeof enrichChar>[] = [...charsInPell]
    for (const c of characters) {
      const key = c.name.trim().toLowerCase()
      if (seenNames.has(key)) continue
      seenNames.add(key)
      bookChars.push(enrichChar(c))
    }

    return {
      pelliculeId: selectedPellicule.id,
      activeShotIndex: 0,  // Phase 2 V1 : toujours shot 0. Phase 3+ : shot actif réel.
      pelliculeShots: selectedPellicule.shots.map(s => ({
        id: s.id, characterIds: s.characterIds ?? [], speakerId: s.speakerId ?? null,
      })),
      charactersInPellicule: charsInPell,
      bookCharacters: bookChars,
      sceneVisible: selectedPellicule.scene_visible ?? undefined,
      sceneAppearance: selectedPellicule.characters_appearance ?? undefined,
    }
  }, [selectedPellicule, characters, characterPositions])

  /** Apply de l'extraction Mistral — Phase 3.
   *  Patche le state pellicule avec les valeurs validées par l'auteur. Refonte
   *  2026-05-11 — supporte 1 OU 2 shots. Si Mistral détecte une césure
   *  chronologique, il génère 2 shots et on crée le 2nd à la volée :
   *    - Shot 0 (existant à activeShotIndex=0) → patché via dispatchs unitaires
   *    - Shot 1 (nouveau) → ajouté en une seule passe via updateAnimationPellicule
   *      (= patch du tableau shots) pour rester déterministe (pas de double
   *      dispatch addAnimationShot puis update qui dépendrait de l'id généré).
   *
   *  Dédoublonnage par nom : si l'auteur a 2 charIds homonymes dans sa banque
   *  ("Marvyn" + "Marvyn 2"), on ré-aiguille les actions Mistral vers l'id
   *  déjà présent dans le shot pour éviter de créer une vignette dupliquée. */
  const handleAiApply = useCallback((extraction: AiExtraction) => {
    if (!selectedPellicule) return
    if (extraction.shots.length === 0) return

    // Helper : pour un shot donné (déjà existant OU à construire), produit
    // perCharacter remappé + speakerId remappé + characterIds résultants à
    // partir de l'extraction Mistral. Sépare la résolution des doublons (par
    // nom) du dispatch effectif pour pouvoir réutiliser sur shot existant
    // ET sur shot nouveau.
    function resolveShot(extShot: AiExtraction['shots'][number], referenceCharIds: string[]) {
      // Map name(lower) → charId déjà présent dans le shot de référence (= shot
      // existant pour le 1er, ou hérité de la pellicule pour les nouveaux).
      const inShotByName = new Map<string, string>()
      for (const cid of referenceCharIds) {
        const c = characters.find(ch => ch.id === cid)
        if (c) inShotByName.set(c.name.trim().toLowerCase(), cid)
      }
      const remappedCharId = new Map<string, string>()
      for (const charId of Object.keys(extShot.perCharacter)) {
        const c = characters.find(ch => ch.id === charId)
        if (!c) continue
        const inShotId = inShotByName.get(c.name.trim().toLowerCase())
        if (inShotId && inShotId !== charId) {
          console.warn(
            `[AnimationStudio] AI apply: doublon par nom — Mistral pointe id="${charId}" alors que "${c.name}" est déjà ref avec id="${inShotId}". Re-route.`,
          )
          remappedCharId.set(charId, inShotId)
        } else {
          remappedCharId.set(charId, charId)
        }
      }
      // Concat actions si 2 ids Mistral pointent vers le même id final
      const perCharacterRemapped: Record<string, { action: string; dialogue: string }> = {}
      for (const [charIdMistral, data] of Object.entries(extShot.perCharacter)) {
        const finalId = remappedCharId.get(charIdMistral) ?? charIdMistral
        const existing = perCharacterRemapped[finalId]
        if (existing) {
          existing.action = `${existing.action}; ${data.action}`.trim()
          if (data.dialogue && !existing.dialogue) existing.dialogue = data.dialogue
        } else {
          perCharacterRemapped[finalId] = { action: data.action, dialogue: data.dialogue ?? '' }
        }
      }
      const remappedSpeakerId = extShot.speakerId
        ? remappedCharId.get(extShot.speakerId) ?? extShot.speakerId
        : null
      const duration = Math.max(1, Math.min(20, Math.round(extShot.suggestedDurationSec)))
      return { perCharacterRemapped, remappedSpeakerId, duration }
    }

    // Détecte si on a au moins un shot à AJOUTER (= shotIndex >= longueur
    // actuelle). Si oui on bascule en mode "patch atomique" : on construit
    // toute la séquence shots[] modifiée puis 1 seul dispatch updateAnimationPellicule.
    // Sinon on reste en mode "dispatchs unitaires" (préserve sémantique
    // existante du single-shot apply : add char puis set speaker puis set
    // action…).
    //
    // Pourquoi ne PAS mixer les deux ? Le mode "patch atomique" lit
    // selectedPellicule.shots depuis la closure useCallback (= snapshot
    // pré-dispatch). Si on faisait des dispatchs unitaires SUR shot 0 PUIS
    // updateAnimationPellicule({ shots: [...stale_snapshot, newShot] }), le
    // patch écraserait shot 0 avec sa version stale → on perdrait les patchs
    // unitaires. D'où la séparation des modes.
    const sortedShots = [...extraction.shots].sort((a, b) => a.shotIndex - b.shotIndex)
    const needsAppend = sortedShots.some(s => s.shotIndex >= selectedPellicule.shots.length)

    const pellPatch: Partial<AnimationPellicule> = {}

    if (needsAppend) {
      // ── Mode patch atomique : reconstruit shots[] complet ──
      // Part de la copie actuelle, applique chaque ext shot en place ou append.
      const workingShots: Shot[] = selectedPellicule.shots.map(s => ({ ...s, perCharacter: { ...s.perCharacter } }))
      for (const extShot of sortedShots) {
        const existing = workingShots[extShot.shotIndex]
        if (existing) {
          // Patch en place
          const resolved = resolveShot(extShot, existing.characterIds ?? [])
          // Merge perCharacter : conserve ce qui existe pour chars non touchés,
          // overwrite pour chars présents dans Mistral.
          const mergedPerChar = { ...existing.perCharacter, ...resolved.perCharacterRemapped }
          // Union characterIds (existants + nouveaux mentionnés)
          const mergedCharIds = Array.from(new Set([
            ...(existing.characterIds ?? []),
            ...Object.keys(resolved.perCharacterRemapped),
          ]))
          workingShots[extShot.shotIndex] = {
            ...existing,
            characterIds: mergedCharIds,
            speakerId: resolved.remappedSpeakerId,
            duration: resolved.duration,
            perCharacter: mergedPerChar,
            // Refonte 2026-05-14az : si l'IA a fourni sceneAction, on patche.
            // Sinon on garde la valeur existante (ne pas effacer un sceneAction
            // déjà saisi à la main par l'auteur).
            ...(extShot.sceneAction ? { sceneAction: extShot.sceneAction } : {}),
          }
        } else {
          // Append nouveau shot — hérite du dernier existant comme reducer
          const lastExisting = workingShots[workingShots.length - 1]
          const inheritedRefCharIds = lastExisting?.characterIds ?? []
          const resolved = resolveShot(extShot, inheritedRefCharIds)
          const newCharIds = Array.from(new Set([
            ...inheritedRefCharIds,
            ...Object.keys(resolved.perCharacterRemapped),
          ]))
          const newShot: Shot = {
            id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            shot: lastExisting?.shot ?? 'medium',
            camera: lastExisting?.camera ?? 'static',
            duration: resolved.duration,
            characterIds: newCharIds,
            speakerId: resolved.remappedSpeakerId,
            perCharacter: resolved.perCharacterRemapped,
            ...(extShot.sceneAction ? { sceneAction: extShot.sceneAction } : {}),
          }
          workingShots.push(newShot)
        }
      }
      // Cap dur à 2 shots (cf reducer add_animation_shot — limite produit).
      pellPatch.shots = workingShots.slice(0, 2)
    } else {
      // ── Mode dispatchs unitaires (shots tous existants) ──
      for (const extShot of sortedShots) {
        const targetShot = selectedPellicule.shots[extShot.shotIndex]
        if (!targetShot) continue
        const resolved = resolveShot(extShot, targetShot.characterIds ?? [])
        for (const charId of Object.keys(resolved.perCharacterRemapped)) {
          if (!targetShot.characterIds?.includes(charId)) {
            shotAddCharacter(selectedPellicule.id, targetShot.id, charId)
          }
        }
        if (targetShot.speakerId !== resolved.remappedSpeakerId) {
          shotSetSpeaker(selectedPellicule.id, targetShot.id, resolved.remappedSpeakerId)
        }
        for (const [charId, data] of Object.entries(resolved.perCharacterRemapped)) {
          updateAnimationPelliculeCharData(selectedPellicule.id, targetShot.id, charId, 'action', data.action)
          updateAnimationPelliculeCharData(selectedPellicule.id, targetShot.id, charId, 'dialogue', data.dialogue)
        }
        if (resolved.duration !== targetShot.duration) {
          updateAnimationShot(selectedPellicule.id, targetShot.id, { duration: resolved.duration })
        }
        // Refonte 2026-05-14az : patch sceneAction si l'IA en a fourni un.
        if (extShot.sceneAction && extShot.sceneAction !== targetShot.sceneAction) {
          updateAnimationShot(selectedPellicule.id, targetShot.id, { sceneAction: extShot.sceneAction })
        }
      }
    }

    // Patch scène (commun aux 2 modes — non null seulement si Mistral a fourni)
    if (extraction.scene.scene_visible !== null) {
      pellPatch.scene_visible = extraction.scene.scene_visible
    }
    if (extraction.scene.characters_appearance !== null) {
      pellPatch.characters_appearance = extraction.scene.characters_appearance
    }
    if (Object.keys(pellPatch).length > 0) {
      updateAnimationPellicule(selectedPellicule.id, pellPatch)
    }

    setSaveToast('saved')
  }, [selectedPellicule, characters, shotAddCharacter, shotSetSpeaker,
      updateAnimationPelliculeCharData, updateAnimationShot, updateAnimationPellicule])

  /** Apply d'un shot proposé via le nouveau chat conversationnel. Convertit
   *  ChatShotProposal → AiExtraction et délègue à handleAiApply pour réutiliser
   *  toute la logique existante (dédoublonnage par nom, mode atomique vs
   *  unitaire, etc.). Refonte 2026-05-11. */
  const handleApplyChatShot = useCallback((shot: ChatShotProposal) => {
    const fakeExtraction: AiExtraction = {
      intent: 'configure_pellicule',
      shots: [shot],
      // Pas d'override scène dans ce flow chat — la scène est déjà configurée
      // en amont (par les Qwen VL auto + saisie auteur). Si Mistral veut la
      // modifier dans le futur, on ajoutera un type de message "scene_update".
      scene: { scene_visible: null, characters_appearance: null, confidence: 'high' },
      warnings: [],
    }
    handleAiApply(fakeExtraction)
  }, [handleAiApply])

  /** Lance la génération LTX de la pellicule sélectionnée via l'orchestrator
   *  partagé. Réutilise toute la pipeline (TTS multi-shots + Qwen scène +
   *  traduction + LTX 2.3 dual + extract frames).
   *
   *  Refonte 2026-05-14ab (Phase B option B) : si en mode draft initial
   *  (= draftAssetIdFromUrl set, aucune pellicule encore), crée la pellicule
   *  à la volée AVANT la gen avec id = draftAssetId. L'auto-commit V3 se
   *  charge ensuite de POST asset + POST timeline (start_ms auto-snap = 0). */
  const handleGenerate = useCallback(async () => {
    let pellToGen = selectedPellicule
    if (!pellToGen && draftAssetIdFromUrl) {
      // Création à la volée d'une pellicule en mémoire (id = draftAssetId).
      // addAnimationPellicule fait un setState async ; le reducer renverra
      // un id auto si on ne fournit pas, donc ici on FORCE id pour matcher
      // l'auto-commit V3 + l'URL.
      addAnimationPellicule({
        id: draftAssetIdFromUrl,
        characterIds: [],
        videoUrl: null,
        firstFrameUrl: imageUrl ?? draftFirstFrameUrl ?? null,
        lastFrameUrl: null,
        type: 'animation',
        source: 'ltx',
        v2vContinue: false,
      })
      // On construit pellToGen MANUELLEMENT pour ne pas attendre le re-render
      // (addAnimationPellicule dispatch async). L'orchestrator capture cet
      // objet par valeur, donc OK.
      pellToGen = {
        id: draftAssetIdFromUrl,
        type: 'animation',
        characterIds: [],
        shots: [{
          id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          shot: 'medium',
          camera: 'static',
          duration: 4,
          characterIds: [],
          speakerId: null,
          perCharacter: {},
        }],
        videoUrl: null,
        firstFrameUrl: imageUrl ?? draftFirstFrameUrl ?? null,
        lastFrameUrl: null,
        scene_visible: null,
        scene_offscreen: null,
        characters_appearance: null,
        source: 'ltx',
        v2vContinue: false,
      } as AnimationPellicule
    }
    if (!pellToGen) return
    const targetId = pellToGen.id
    setGeneratingPelliculeId(targetId)
    setGeneratingProgressLabel('Préparation…')
    // Re-bind selectedPellicule semantically pour la suite du code
    const selectedPellicule_local = pellToGen
    try {
      // Reset firstFrameUrl AVANT de générer (refonte 2026-05-11) — sinon
      // l'orchestrator priorise pellicule.firstFrameUrl (= 1ère frame de la
      // vidéo précédente) sur baseImageUrl, créant un cycle vicieux qui
      // amplifie la dérive d'identité à chaque clic Régénérer. Sans calques
      // dans l'AnimationStudio (layers=[]), repartir de baseImageUrl est
      // gratuit et donne le comportement attendu : 1 clic = 1 fresh gen.
      // On force aussi le pellicule local en mémoire pour éviter la race
      // (orchestrator capture le pellicule passé en arg, pas le state).
      //
      // Fix 2026-05-13 : on ne reset le firstFrameUrl QUE s'il y a un
      // baseImageUrl à utiliser à la place. Sinon (= cas drop image direct
      // depuis library Images), on garde le firstFrameUrl de la pellicule
      // comme source — sinon "Aucune image source".
      const shouldResetFirstFrame = !!imageUrl
      const pelliculeForGen = shouldResetFirstFrame
        ? { ...selectedPellicule_local, firstFrameUrl: null }
        : selectedPellicule_local
      if (shouldResetFirstFrame) {
        updateAnimationPellicule(targetId, { firstFrameUrl: null })
      }
      const result = await generateAnimationPellicule({
        pellicule: pelliculeForGen,
        allPellicules: animationPellicules,
        characters,
        baseImageUrl: imageUrl,
        layers: [],
        characterPositions,
        onProgress: setGeneratingProgressLabel,
        onPatchPellicule: patch => updateAnimationPellicule(targetId, patch),
        onPatchShot: (shotId, patch) => updateAnimationShot(targetId, shotId, patch),
      })
      updateAnimationPellicule(targetId, {
        videoUrl: result.videoUrl,
        firstFrameUrl: result.firstFrameUrl,
        lastFrameUrl: result.lastFrameUrl,
        // Bugfix 2026-05-16 — sans ce patch, une pellicule créée comme
        // 'image_static' (ex : ajoutée depuis la banque images) gardait son
        // type même après génération vidéo. Conséquence : la timeline
        // continuait d'afficher l'image figée et le PelliculeRenderer pausait
        // (cf mapper.ts:61 + PelliculeRenderer kind detection).
        type: 'animation',
      })
      setCurrentVideo(result.videoUrl, result.firstFrameUrl, result.lastFrameUrl)
      // Refonte 2026-05-14aj : auto-select la pellicule fraîchement générée
      // pour que le preview phone et la barre rouge timeline se positionnent
      // sur son début (= seek auto via useEffect MultiTrackTimeline).
      setAnimationSelectedPellicule(targetId)

      // Refonte 2026-05-14ae — commit asset_animation + bloc timeline pour
      // les pellicules supplémentaires (= Continuer, etc.) qui ne sont pas
      // gérées par l'auto-commit V3 (qui ne commit que draftAssetIdFromUrl).
      // Le start_ms est auto-snap côté API à la fin du dernier bloc track.
      const isAdditionalPellicule = targetId !== draftAssetIdFromUrl && bookId && sectionIdFromUrl
      if (isAdditionalPellicule) {
        void (async () => {
          try {
            const assetRes = await fetch('/api/assets/animation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: targetId,
                video_url: result.videoUrl,
                first_frame_url: result.firstFrameUrl,
                last_frame_url: result.lastFrameUrl,
                shots: selectedPellicule_local.shots,
                character_ids: selectedPellicule_local.characterIds,
                v2v_continue: selectedPellicule_local.v2vContinue,
                source: 'ltx',
                type: 'animation',
                bookId,
                sectionId: sectionIdFromUrl,
              }),
            })
            if (!assetRes.ok) {
              const errBody = await assetRes.json().catch(() => ({})) as { error?: string }
              throw new Error(errBody.error ?? `POST asset HTTP ${assetRes.status}`)
            }
            const totalSec = (selectedPellicule_local.shots ?? [])
              .reduce((s, sh) => s + (sh.duration ?? 4), 0) || 4
            await fetch(`/api/sections/${sectionIdFromUrl}/timeline`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                track: 'video_image',
                asset_type: 'animation',
                asset_id: targetId,
                duration_ms: Math.round(totalSec * 1000),
              }),
            })
            console.log('[AnimationStudio] additional pellicule committed:', targetId)
            // Refonte 2026-05-14bt — refresh la banque V2 ouverte pour que
            // la nouvelle pellicule générée y apparaisse immédiatement.
            setBankRefreshKey(k => k + 1)
          } catch (err) {
            console.error('[AnimationStudio] commit additional pellicule failed:', err)
          }
        })()
      }
    } catch (err) {
      if (err instanceof MissingVoiceError) {
        alert(`⚠ Voix manquante\n\n${err.message}`)
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[AnimationStudio] gen failed:', msg)
      alert('Erreur génération : ' + msg)
    } finally {
      setGeneratingPelliculeId(null)
      setGeneratingProgressLabel('')
    }
  }, [
    selectedPellicule, animationPellicules, characters, imageUrl,
    characterPositions,
    updateAnimationPellicule, updateAnimationShot, setCurrentVideo,
    addAnimationPellicule, setAnimationSelectedPellicule,
    draftAssetIdFromUrl, draftFirstFrameUrl,
    bookId, sectionIdFromUrl,
  ])

  /** Upload d'une vidéo locale via le file picker → POST /api/storage/upload-video
   *  → extrait 1ère + dernière frame côté browser (canvas) → upload comme images
   *  → ajoute une pellicule avec videoUrl + firstFrameUrl + lastFrameUrl.
   *
   *  La lastFrameUrl est utilisée par la pellicule SUIVANTE comme image de
   *  départ (continuité visuelle). Sans extraction, P3 ne pouvait pas hériter
   *  de la dernière frame de P2. */

  /** "Continuer la vidéo" (refonte 2026-05-11) — crée une nouvelle pellicule
   *  marquée v2vContinue=true, qui chaîne le mouvement depuis la dernière
   *  pellicule générée via LTX 2.3 V2V Extend. Hérite chars + scène de la
   *  prev (continuité narrative). À la gen, l'orchestrator extrait les 8
   *  dernières frames de prev.videoUrl et les passe au workflow V2V.
   *  Différence vs "Pellicule vide" : la nouvelle pellicule continue le
   *  MOUVEMENT (perso qui dribble continue à dribbler) au lieu d'avoir
   *  juste la dernière frame figée comme point de départ I2V. */
  const handleContinueVideo = useCallback(async () => {
    // Refonte 2026-05-14bv — exclut explicitement image_static. V2V Extend
    // a besoin d'une vraie vidéo source pour chaîner le mouvement.
    const lastReady = [...animationPellicules].reverse().find(p => {
      const ext = p as typeof p & { type?: string }
      return !!p.videoUrl && ext.type !== 'image_static'
    })
    console.log('[CONTINUE] before count =', animationPellicules.length,
      'pellicules =', animationPellicules.map(p => ({
        id: p.id.slice(0, 8),
        hasVideo: !!p.videoUrl,
        hasFirstFrame: !!p.firstFrameUrl,
        type: (p as { type?: string }).type ?? 'animation',
        v2vContinue: (p as { v2vContinue?: boolean }).v2vContinue,
      })),
      'lastReady =', lastReady?.id?.slice(0, 8))
    if (!lastReady) {
      alert('Aucune pellicule générée à continuer — génère d\'abord une pellicule.')
      return
    }
    const lastShot = lastReady.shots[lastReady.shots.length - 1]
    const inheritedShotCharIds = lastShot?.characterIds ?? []
    // Refonte 2026-05-14au : extraction lastFrame côté SERVEUR via ffmpeg.
    // L'extraction côté browser (canvas) échouait silencieusement quand le
    // bucket Supabase n'envoie pas les bons headers CORS (canvas tainted →
    // toDataURL throw → null). Le serveur fait fetch+ffmpeg sans souci CORS.
    // Si l'endpoint serveur rate aussi, fallback sur firstFrameUrl pour ne
    // pas laisser l'auteur avec un preview noir.
    let inheritedLastFrame = lastReady.lastFrameUrl ?? null
    if (!inheritedLastFrame && lastReady.videoUrl) {
      try {
        const r = await fetch('/api/video/extract-last-frame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: lastReady.videoUrl }),
        })
        const data = await r.json() as { url?: string; error?: string }
        if (r.ok && data.url) {
          inheritedLastFrame = data.url
          updateAnimationPellicule(lastReady.id, { lastFrameUrl: data.url })
        } else {
          console.warn('[AnimationStudio] extract-last-frame server failed:', data.error)
        }
      } catch (err) {
        console.warn('[AnimationStudio] extract-last-frame server unreachable:', err)
      }
    }
    // Fallback : si toujours rien, on utilise au moins la firstFrame de la
    // pellicule continue. L'auteur voit le sujet de la scène (= mieux qu'un
    // preview noir, observé 2026-05-14au).
    if (!inheritedLastFrame) {
      inheritedLastFrame = lastReady.firstFrameUrl ?? null
    }
    // Refonte 2026-05-14ae : génère un UUID v4 explicite pour pouvoir POST
    // l'asset_animation en DB après génération (la route /api/assets/[type]
    // valide UUID v4 strict).
    const newId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `pell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    addAnimationPellicule({
      id: newId,
      v2vContinue: true,
      characterIds: lastReady.characterIds,
      // Refonte 2026-05-14aq : initialise le preview de la nouvelle pellicule
      // avec la dernière frame de la précédente (continuité visuelle pour
      // l'auteur). LTX recevra les 8 dernières frames de la VIDÉO précédente
      // via V2V Extend, pas cette image — c'est juste un placeholder UX.
      firstFrameUrl: inheritedLastFrame,
      shots: [{
        id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        shot: lastShot?.shot ?? 'medium',
        camera: lastShot?.camera ?? 'static',
        duration: 4,
        characterIds: inheritedShotCharIds,
        speakerId: null,
        perCharacter: {},
      }],
      scene_visible: null,
      scene_offscreen: null,
      characters_appearance: null,
    })
    // Refonte 2026-05-14ah : auto-select la nouvelle pellicule pour que
    // la barre de progression du preview se positionne sur son début et
    // que PromptZone la cible immédiatement.
    setAnimationSelectedPellicule(newId)
    // Debug 2026-05-14bv : log AFTER (en setTimeout pour capter le state
    // post-render). Si count reste à 1 au lieu de monter à 2, c'est un
    // useEffect qui supprime/replace après l'add.
    setTimeout(() => {
      console.log('[CONTINUE] AFTER add (next tick) — selectedId =', newId.slice(0, 8))
    }, 0)
  }, [animationPellicules, addAnimationPellicule, setAnimationSelectedPellicule, updateAnimationPellicule])

  // Refonte 2026-05-14at — Auto-trigger handleContinueVideo quand l'asset
  // arrive depuis Studio Section "Continuer". Garde via ref pour ne firer
  // qu'1 fois (sinon re-render → re-create pellicule fantôme).
  const continueAutoTriggeredRef = useRef(false)
  useEffect(() => {
    if (!continueFromAssetIdFromUrl) return
    if (continueAutoTriggeredRef.current) return
    if (loading) return
    const target = animationPellicules.find(p => p.id === continueFromAssetIdFromUrl)
    if (!target?.videoUrl) return  // pellicule cible pas encore hydratée OU pas de vidéo
    continueAutoTriggeredRef.current = true
    void handleContinueVideo()
  }, [continueFromAssetIdFromUrl, animationPellicules, loading, handleContinueVideo])

  // E.5 : ref pour protection double-clic upload vidéo (idempotence — le
  // bouton lui-même n'a pas accès au state ici, donc on garde simple via ref).
  const uploadingVideoRef = useRef(false)
  const handleUploadVideo = useCallback(async (file: File) => {
    console.log('[AnimationStudio handleUploadVideo] CALLED', { name: file.name, size: file.size, type: file.type })
    if (uploadingVideoRef.current) {
      console.warn('[AnimationStudio handleUploadVideo] SKIP — already uploading')
      return
    }
    uploadingVideoRef.current = true
    try {
      // 0. Validation type côté client (refonte 2026-05-10) — fix 400 cryptique
      // si l'auteur drop une image / pdf / autre. L'endpoint server refuse
      // tout data_url qui ne commence pas par "data:video/" — autant le
      // catch ici avec un message clair plutôt que faire l'aller-retour réseau.
      if (!file.type.startsWith('video/')) {
        alert(`Ce n'est pas une vidéo (type détecté : ${file.type || 'inconnu'}). Les formats acceptés : MP4, WebM, MOV.`)
        return
      }
      // 1. Convertit le file en data URL base64 pour le POST
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('FileReader failed'))
        reader.readAsDataURL(file)
      })
      // 2. Upload de la vidéo
      const r = await fetch('/api/storage/upload-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path: `studio/animation/upload/${Date.now()}-${file.name}` }),
      })
      if (!r.ok) {
        // Surface le vrai message d'erreur serveur (Supabase quota, format,
        // etc.) plutôt qu'un opaque "HTTP 400".
        const errBody = await r.json().catch(() => ({})) as { error?: string }
        throw new Error(errBody.error ?? `Upload HTTP ${r.status}`)
      }
      const { url } = await r.json() as { url: string }

      // 3. Extraction des frames (1ère + dernière) côté browser via canvas
      //    + récupération de la durée native du MP4 (refonte 2026-05-15 :
      //    avant on hardcodait 4s, l'auteur uploadait une vidéo 10s mais
      //    sur la timeline elle apparaissait coupée à 4s).
      const { extractVideoFrames, uploadDataUrlAsImage } = await import('@/lib/extract-video-frames')
      const { firstFrameDataUrl, lastFrameDataUrl, duration: videoDuration } = await extractVideoFrames(url)
      console.log('[AnimationStudio handleUploadVideo] extractVideoFrames →', { videoDuration, hasFirst: !!firstFrameDataUrl, hasLast: !!lastFrameDataUrl })
      // Clamp défensif : 0.5s mini (évite les vidéos corrompues à 0s),
      // 60s maxi (évite un upload de 1h qui pète la timeline).
      const realDurationSec = Math.max(0.5, Math.min(60, videoDuration || 4))
      const realDurationMs = Math.round(realDurationSec * 1000)
      console.log('[AnimationStudio handleUploadVideo] realDurationSec =', realDurationSec, '(raw videoDuration =', videoDuration, ')')

      // 4. Upload des frames extraites comme images
      const ts = Date.now()
      let firstFrameUrl: string | null | undefined
      let lastFrameUrl: string | null | undefined
      if (firstFrameDataUrl) {
        firstFrameUrl = await uploadDataUrlAsImage(
          firstFrameDataUrl,
          `studio/animation/upload/first-${ts}.jpg`,
        )
      }
      if (lastFrameDataUrl) {
        lastFrameUrl = await uploadDataUrlAsImage(
          lastFrameDataUrl,
          `studio/animation/upload/last-${ts}.jpg`,
        )
      }

      // 5. Ajoute ou remplace la pellicule draft (refonte 2026-05-14ag).
      //    Si on a une pellicule draft (id = draftAssetIdFromUrl) sans
      //    videoUrl encore, on la REMPLIT avec l'upload au lieu de créer
      //    une 2ème pellicule. L'auto-commit V3 prend le relais pour POST
      //    l'asset (=> 1 seul bloc timeline). Sinon (= mode normal V2 ou
      //    pellicules suivantes), on créé une nouvelle pellicule.
      const draftPell = draftAssetIdFromUrl
        ? animationPellicules.find(p => p.id === draftAssetIdFromUrl && !p.videoUrl)
        : null
      let newId: string
      // Shot synthétique avec la vraie durée de la vidéo (refonte 2026-05-15).
      // Sans ça le mapper retombe sur 4s par défaut → bloc tronqué côté UI.
      const syntheticShot = {
        id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        shot: 'medium' as const,
        camera: 'static' as const,
        duration: realDurationSec,
        characterIds: [],
        speakerId: null,
        perCharacter: {},
      }
      if (draftPell) {
        newId = draftPell.id
        updateAnimationPellicule(newId, {
          videoUrl: url,
          firstFrameUrl: firstFrameUrl ?? null,
          lastFrameUrl: lastFrameUrl ?? null,
          source: 'upload',
          shots: [syntheticShot],
        })
      } else {
        newId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID()
          : `pell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        addAnimationPellicule({
          id: newId,
          videoUrl: url,
          firstFrameUrl: firstFrameUrl ?? null,
          lastFrameUrl: lastFrameUrl ?? null,
          source: 'upload',
          shots: [syntheticShot],
        })
      }

      // Commit immédiat en DB (asset_animation + bloc timeline) — équivalent
      // de ce qu'on fait pour les pellicules générées (Continuer + handleGenerate).
      // start_ms auto-snap par l'API à la fin du dernier bloc track. Si en
      // mode draft (= 1ère pellicule, pas encore d'asset committé), l'auto-
      // commit V3 prendra le relais sur la pellicule draft existante.
      if (bookId && sectionIdFromUrl && newId !== draftAssetIdFromUrl) {
        try {
          const assetRes = await fetch('/api/assets/animation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: newId,
              video_url: url,
              first_frame_url: firstFrameUrl ?? null,
              last_frame_url: lastFrameUrl ?? null,
              source: 'upload',
              type: 'animation',
              bookId,
              sectionId: sectionIdFromUrl,
            }),
          })
          if (!assetRes.ok) {
            const errBody = await assetRes.json().catch(() => ({})) as { error?: string }
            throw new Error(errBody.error ?? `POST asset HTTP ${assetRes.status}`)
          }
          await fetch(`/api/sections/${sectionIdFromUrl}/timeline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              track: 'video_image',
              asset_type: 'animation',
              asset_id: newId,
              duration_ms: realDurationMs,
            }),
          })
          console.log('[AnimationStudio] uploaded video committed:', newId, `(${realDurationSec}s)`)
        } catch (commitErr) {
          console.error('[AnimationStudio] commit uploaded video failed:', commitErr)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[AnimationStudio] upload video failed:', msg)
      alert(`Upload vidéo échoué : ${msg}`)
    } finally {
      uploadingVideoRef.current = false
    }
  }, [addAnimationPellicule, updateAnimationPellicule, animationPellicules, bookId, sectionIdFromUrl, draftAssetIdFromUrl])

  function handleBack() {
    if (returnSectionId) {
      router.push(`/editor-test/studio-section?sectionId=${returnSectionId}`)
    } else {
      router.back()
    }
  }

  if (loading) {
    return (
      <div className="as-loading">Chargement de l&apos;animation…</div>
    )
  }
  if (error) {
    return (
      <div className="as-error">
        <h2>Erreur de chargement</h2>
        <p>{error}</p>
        <button type="button" onClick={handleBack}>Retour</button>
      </div>
    )
  }

  return (
    <CharacterPersistProvider persist={persistCharacterToDb}>
    <div className={`as-root ${theme === 'light' ? 'theme-light' : ''}`}>
      {/* Header — back à gauche, IA centré, theme toggle à droite */}
      <header className="as-header">
        <button type="button" className="as-back-btn" onClick={handleBack}>
          <ArrowLeft size={14} />
          <span>Retour Studio Section</span>
        </button>
        <div className="as-header-spacer" />
        <button
          type="button"
          className="as-header-iabtn"
          onClick={() => setAiPaletteOpen(true)}
          title="Demande à l'IA d'extraire la config du shot depuis ta description (raccourci : Ctrl+K)"
        >
          <Sparkles size={14} />
          <span>Demande à l&apos;IA…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="as-header-spacer" />
        {/* Refonte 2026-05-17 — bouton Preview du header RETIRÉ en mode mono :
         *  redondant avec l'embedded PreviewModal de l'aside qui est toujours
         *  visible. Le theme toggle reste mais glissé vers la gauche pour ne
         *  pas être recouvert par la tuile absolue en haut-droite. */}
        <button
          type="button"
          className="as-header-theme-btn as-header-theme-btn-mono"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
          aria-label="Basculer thème"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </header>

      {/* Body : rail | (banque si ouverte) | (timeline + prompt zone) | preview */}
      <div className={`as-body${drawer === 'images' ? ' has-bank' : ''}`}>
        <AnimationStudioRail
          drawer={drawer}
          onOpenCharacters={() => handleOpenCharactersDrawer(null)}
          onOpenImages={() => setDrawer(drawer === 'images' ? 'closed' : 'images')}
        />

        {/* Drawer slidable (banques) */}
        <AnimationStudioCharactersDrawer
          open={drawer === 'characters'}
          npcs={npcs}
          targetShotId={drawerTargetShotId}
          activePelliculeId={animationSelectedPelliculeId}
          inPlanCharacterIds={inPlanCharacterIds}
          bookId={bookId}
          onClose={() => { setDrawer('closed'); setDrawerTargetShotId(null) }}
        />

        {/* Banque V2 unifiée — refonte 2026-05-14bd. Slide-in à gauche.
         *  Animations + Images groupées par section du livre. Remplacera
         *  l'ancienne TimelineLibrary à la Phase 3. */}
        {drawer === 'images' && (
          <AnimationStudioBankPanel
            bookId={bookId}
            currentSectionId={sectionIdFromUrl}
            refreshKey={bankRefreshKey}
            onClose={() => setDrawer('closed')}
            onOpenEffects={(asset) => setEffectsModalTarget(buildTargetFromAsset(asset))}
            onOpenCapture={(asset) => setCaptureModalTarget(buildTargetFromAsset(asset))}
            onDeleteAsset={(asset, kind, sectionsUsing) =>
              setDeleteAssetTarget({ asset, kind, sectionsUsing })
            }
            // Refonte 2026-05-16 — badge 🎬 sur tile si asset en timeline.
            // V1 limité à l'asset banque actuellement édité (= assetIdFromUrl).
            // Les pellicules ajoutées via "Ajouter" depuis la banque n'ont pas
            // de mapping source_asset_id → pas détectables en V1. À étendre V2
            // (ajouter source_asset_id sur pellicule + reducer + persist).
            inTimelineAssetIds={assetIdFromUrl ? [assetIdFromUrl] : []}
            // Chantier 3 (2026-05-16) — Modifier/Créer via banque.
            onEditAsset={(asset, kind, source) => {
              // Standalone (source=recents) ou contextuel (source=section) ?
              // Option C : on respecte la source. En contextuel, on passe le
              // sectionId. En standalone, juste l'assetId.
              const passSection = source === 'section' && sectionIdFromUrl
              if (kind === 'animations') {
                const qs = new URLSearchParams({ assetId: asset.id })
                if (passSection) qs.set('sectionId', sectionIdFromUrl)
                router.push(`/editor-test/animation-studio?${qs.toString()}`)
              } else {
                // Image → Designer (chantier 2 ajoute le mode standalone)
                const qs = new URLSearchParams({ imageAssetId: asset.id })
                if (passSection) qs.set('sectionId', sectionIdFromUrl)
                router.push(`/editor-test/new-layout?${qs.toString()}`)
              }
            }}
            onCreateAnimation={() => {
              // Nouvel asset animation : draftAssetId + draftKind
              const draftId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
                ? crypto.randomUUID()
                : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
              const qs = new URLSearchParams({ draftAssetId: draftId, draftKind: 'animation' })
              if (sectionIdFromUrl) qs.set('sectionId', sectionIdFromUrl)
              router.push(`/editor-test/animation-studio?${qs.toString()}`)
            }}
            onCreateImage={() => {
              // Chantier 2 (2026-05-16) — bouton "Créer image" activé.
              // Reroute Designer en draft (= lazy-create asset). Standalone
              // par défaut (pas de sectionId si origine = Récents implicite).
              const draftId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
                ? crypto.randomUUID()
                : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
              const qs = new URLSearchParams({ draftAssetId: draftId, draftKind: 'image' })
              if (sectionIdFromUrl) qs.set('sectionId', sectionIdFromUrl)
              router.push(`/editor-test/new-layout?${qs.toString()}`)
            }}
            onRenameAsset={(assetId, kind, newLabel) => {
              // Refonte 2026-05-15bf — Rename label depuis tile banque :
              // 1. Update local state animationPellicules (= sync immédiat
              //    du label sur le bloc timeline si la pellicule live).
              // 2. PATCH asset DB (best-effort).
              if (kind === 'animations' && animationPellicules.some(p => p.id === assetId)) {
                updateAnimationPellicule(assetId, { label: newLabel })
              }
              const apiKind = kind === 'animations' ? 'animation' : 'image'
              const url = bookId
                ? `/api/assets/${apiKind}/${assetId}?bookId=${bookId}`
                : `/api/assets/${apiKind}/${assetId}`
              void fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: newLabel }),
              }).catch(err => console.warn('[AnimationStudio] rename PATCH failed:', err))
            }}
            onAddImage={(imageId, imageUrl) => {
              // Ajoute en tant que pellicule image_static à la fin du tableau
              addAnimationPellicule({
                firstFrameUrl: imageUrl,
                type: 'image_static',
                shots: [{
                  id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                  shot: 'medium', camera: 'static', duration: 3,
                  characterIds: [], speakerId: null, perCharacter: {},
                }],
              })
              void imageId  // V2 : utiliser l'imageAssetId pour persist V3 timeline (TODO)
            }}
            onAddAnimation={(animationId) => {
              // Refonte 2026-05-14bj — Permet la duplication : chaque clic
              // "Ajouter" depuis la banque crée une NOUVELLE instance pellicule
              // sur la timeline (id local frais, généré par le reducer).
              // Le mapping vers l'asset_id source pour persist V3 sera ajouté
              // via un champ `source_asset_id` plus tard (TODO).
              void (async () => {
                try {
                  const r = await fetch(`/api/assets/animation/${animationId}`)
                  if (!r.ok) throw new Error(`asset HTTP ${r.status}`)
                  const { asset } = await r.json() as { asset: {
                    id: string; video_url: string | null; first_frame_url: string | null;
                    last_frame_url: string | null; label?: string | null;
                    shots?: Array<{ id: string; shot?: string; camera?: string; duration?: number; characterIds?: string[]; speakerId?: string | null; perCharacter?: Record<string, { action: string; dialogue: string }> }>;
                  } }
                  // Refonte 2026-05-14bq — Audit "remplacement" :
                  // ne PAS passer d'id au reducer (= laisse le reducer
                  // générer un id frais lui-même). Évite tout risque que
                  // notre id collide avec une pellicule existante (ce qui
                  // déclencherait la guard idempotence + setSelected →
                  // effet visuel "remplacement"). Idem shot ids.
                  const cryptoOk = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                  addAnimationPellicule({
                    label: asset.label ?? undefined,
                    videoUrl: asset.video_url,
                    firstFrameUrl: asset.first_frame_url,
                    lastFrameUrl: asset.last_frame_url,
                    shots: (asset.shots ?? []).map((s, i) => ({
                      id: cryptoOk
                        ? crypto.randomUUID()
                        : `shot-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`,
                      shot: (s.shot ?? 'medium') as 'wide' | 'medium' | 'close_up' | 'extreme_close_up',
                      camera: (s.camera ?? 'static') as 'static' | 'slow_zoom_in' | 'slow_zoom_out' | 'pan_left' | 'pan_right' | 'dolly_in' | 'dolly_out' | 'handheld',
                      duration: s.duration ?? 4,
                      characterIds: s.characterIds ?? [],
                      speakerId: s.speakerId ?? null,
                      perCharacter: s.perCharacter ?? {},
                    })),
                  })
                  // Note : pas besoin de setAnimationSelectedPellicule —
                  // le reducer add_animation_pellicule fait déjà l'auto-select
                  // de la nouvelle pellicule (animationSelectedPelliculeId: newId).
                } catch (err) {
                  console.error('[AnimationStudio] add animation from bank failed:', err)
                }
              })()
            }}
            onUploadImage={async (file) => {
              // Refonte 2026-05-14bm — Upload image dans la BANQUE :
              // 1. Storage Supabase
              // 2. POST /api/assets/image (= asset_image row + asset_usage
              //    rattaché au bookId+sectionId courant) pour persistance.
              // 3. Retourne l'asset frais pour que le panel l'affiche
              //    immédiatement dans la section courante.
              if (!bookId || !sectionIdFromUrl) {
                throw new Error('bookId/sectionId manquants — impossible de persister en banque')
              }
              const dataUrl = await new Promise<string>((resolve, reject) => {
                const r = new FileReader()
                r.onload = () => resolve(r.result as string); r.onerror = reject
                r.readAsDataURL(file)
              })
              const res = await fetch('/api/storage/upload-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data_url: dataUrl, path: `studio/bank/upload/img-${Date.now()}.png` }),
              })
              if (!res.ok) throw new Error(`upload storage HTTP ${res.status}`)
              const { url } = await res.json() as { url: string }
              const assetRes = await fetch('/api/assets/image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url,
                  source_type: 'upload',
                  label: file.name,
                  bookId,
                  sectionId: sectionIdFromUrl,
                }),
              })
              if (!assetRes.ok) {
                const errBody = await assetRes.json().catch(() => ({})) as { error?: string }
                throw new Error(errBody.error ?? `POST asset_image HTTP ${assetRes.status}`)
              }
              const { asset } = await assetRes.json() as { asset: { id: string; url: string; label?: string | null } }
              // Sync state local section : la liste sectionBankImages alimente
              // la library legacy ET les autres écrans qui en dépendent.
              setSectionBankImages(prev => [...prev, { id: asset.id, url: asset.url, label: asset.label ?? file.name }])
              // Retour pour que la banque V2 ajoute la tile localement
              return { id: asset.id, url: asset.url, label: asset.label ?? file.name, type: 'image_static' }
            }}
            onUploadVideo={async (file) => {
              // Refonte 2026-05-14bo — Upload vidéo dans la BANQUE (≠ timeline).
              // Persiste asset_animation + retourne pour affichage dans le panel.
              // Pas de placement automatique sur la timeline (l'auteur clique
              // ensuite "Ajouter" sur la tile pour l'amener sur la timeline).
              if (!file.type.startsWith('video/')) {
                throw new Error(`Type invalide (${file.type || 'inconnu'}) — attendu vidéo`)
              }
              if (!bookId || !sectionIdFromUrl) {
                throw new Error('bookId/sectionId manquants — impossible de persister en banque')
              }
              const dataUrl = await new Promise<string>((resolve, reject) => {
                const r = new FileReader()
                r.onload = () => resolve(String(r.result))
                r.onerror = () => reject(new Error('FileReader failed'))
                r.readAsDataURL(file)
              })
              // 1. Upload storage video
              const r = await fetch('/api/storage/upload-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data_url: dataUrl, path: `studio/bank/upload/vid-${Date.now()}-${file.name}` }),
              })
              if (!r.ok) {
                const errBody = await r.json().catch(() => ({})) as { error?: string }
                throw new Error(errBody.error ?? `upload storage HTTP ${r.status}`)
              }
              const { url: videoUrl } = await r.json() as { url: string }
              // 2. Extract first/last frames + DURÉE NATIVE (refonte 2026-05-15bd —
              // avant la durée n'était pas capturée → asset stocké sans shots →
              // au "Ajouter timeline" durée par défaut 4s, vidéo 10s tronquée).
              const { extractVideoFrames, uploadDataUrlAsImage } = await import('@/lib/extract-video-frames')
              const ts = Date.now()
              let firstFrameUrl: string | null = null
              let lastFrameUrl: string | null = null
              let videoDurationSec = 4  // fallback safe si extraction rate
              try {
                const frames = await extractVideoFrames(videoUrl)
                console.log('[AnimationStudio bank upload] extractVideoFrames →', { duration: frames.duration, hasFirst: !!frames.firstFrameDataUrl, hasLast: !!frames.lastFrameDataUrl })
                videoDurationSec = Math.max(0.5, Math.min(60, frames.duration || 4))
                if (frames.firstFrameDataUrl) {
                  firstFrameUrl = await uploadDataUrlAsImage(
                    frames.firstFrameDataUrl,
                    `studio/bank/upload/first-${ts}.jpg`,
                  ) ?? null
                }
                if (frames.lastFrameDataUrl) {
                  lastFrameUrl = await uploadDataUrlAsImage(
                    frames.lastFrameDataUrl,
                    `studio/bank/upload/last-${ts}.jpg`,
                  ) ?? null
                }
              } catch (err) {
                console.warn('[AnimationStudio] extractVideoFrames bank upload failed:', err)
              }
              // 3. POST asset_animation (= persistance banque cross-section)
              const newAssetId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
                ? crypto.randomUUID()
                : `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
              const assetRes = await fetch('/api/assets/animation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: newAssetId,
                  video_url: videoUrl,
                  first_frame_url: firstFrameUrl,
                  last_frame_url: lastFrameUrl,
                  source: 'upload',
                  type: 'animation',
                  label: file.name,
                  // Refonte 2026-05-15bd : shot synthétique avec la vraie durée
                  // de la vidéo. Sans ça, au "Ajouter timeline" depuis la banque,
                  // le mapper retombait sur 4s (s.duration ?? 4 ligne 2049).
                  shots: [{
                    id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                    shot: 'medium',
                    camera: 'static',
                    duration: videoDurationSec,
                    characterIds: [],
                    speakerId: null,
                    perCharacter: {},
                  }],
                  bookId,
                  sectionId: sectionIdFromUrl,
                }),
              })
              if (!assetRes.ok) {
                const errBody = await assetRes.json().catch(() => ({})) as { error?: string }
                throw new Error(errBody.error ?? `POST asset_animation HTTP ${assetRes.status}`)
              }
              const { asset } = await assetRes.json() as { asset: { id: string; video_url: string | null; first_frame_url: string | null; label?: string | null } }
              return {
                id: asset.id,
                url: asset.video_url,
                video_url: asset.video_url,
                first_frame_url: asset.first_frame_url,
                label: asset.label ?? file.name,
                type: 'animation',
              }
            }}
          />
        )}

        {/* Drawer Effets retiré (refonte 2026-05-15ca) — remplacé par la
         *  modale EffectsModal accessible via hover (banque + bloc timeline). */}

        {/* Zone centrale : timeline + prompt */}
        <main
          className="as-main"
          onClick={(e) => {
            // Click ailleurs (pas dans un drawer) → ferme le drawer
            // Détection : si la cible n'est pas un descendant du drawer
            if (drawer !== 'closed') {
              const target = e.target as HTMLElement
              if (!target.closest('.as-drawer') && !target.closest('.asb-panel')) {
                setDrawer('closed')
                setDrawerTargetShotId(null)
              }
            }
          }}
        >
          {/* Refonte 2026-05-17 — Studio Mono : layout 2 colonnes.
           *    - LEFT  : PromptZone (Shot 1 … Action de scène … Générer)
           *    - RIGHT : tuile source en device frame (réutilise le DeviceFrame
           *              du PreviewModal). Phone pour ratio ≤ 1, Desktop sinon.
           *  Aucune sticky/overlay : la tuile reste dans le flux normal, donc
           *  les zones sous PromptZone ne sont jamais masquées par elle.
           */}
          <div className="as-mono-split">
            <div className="as-mono-split-main">
              <AnimationStudioPromptZone
                pellicule={selectedPellicule}
                npcs={npcs}
                onOpenCharactersForShot={handleOpenCharactersDrawer}
                onGenerate={handleGenerate}
                generatingPelliculeId={generatingPelliculeId}
                generatingProgressLabel={generatingProgressLabel}
                onOpenExitEditor={() => setExitEditorOpen(true)}
                isLastPellicule={
                  !!selectedPellicule &&
                  animationPellicules.length > 0 &&
                  animationPellicules[animationPellicules.length - 1].id === selectedPellicule.id
                }
              />
            </div>
            <aside className="as-mono-split-aside">
              {(() => {
                // SOURCE = pellicule pointée par continueFromAssetId. NB :
                // selectedPellicule devient l'extension VIDE juste après le
                // auto-trigger handleContinueVideo → ne pas l'utiliser ici.
                const sourcePell = continueFromAssetIdFromUrl
                  ? animationPellicules.find(p => p.id === continueFromAssetIdFromUrl) ?? null
                  : null
                const mode: 'continue' | 'add' | 'blank' =
                  continueFromAssetIdFromUrl ? 'continue'
                  : (addedFromAssetIdFromUrl && draftFirstFrameUrl) ? 'add'
                  : 'blank'
                // On construit une "pellicule synthétique" pour Ajouter (= image
                // statique). Pour Continuer on passe directement la sourcePell.
                const previewPellicules: PelliculePersisted[] =
                  mode === 'continue' && sourcePell
                    ? [sourcePell as unknown as PelliculePersisted]
                    : mode === 'add' && draftFirstFrameUrl
                      ? [{
                          id: `mono-source-add`,
                          type: 'image_static',
                          characterIds: [],
                          shots: [{
                            id: 'mono-source-shot',
                            shot: 'medium',
                            camera: 'static',
                            duration: 4,
                            characterIds: [],
                            speakerId: null,
                            perCharacter: {},
                          }],
                          videoUrl: null,
                          firstFrameUrl: draftFirstFrameUrl,
                          lastFrameUrl: null,
                          scene_visible: null,
                          scene_offscreen: null,
                          characters_appearance: null,
                        } as unknown as PelliculePersisted]
                      : []
                const title =
                  mode === 'continue' ? 'Source à continuer'
                  : mode === 'add' ? 'Image source (ajouter)'
                  : 'Aucune source'
                return (
                  <PreviewModal
                    open
                    embedded
                    onClose={() => { /* embedded — no close */ }}
                    pellicules={previewPellicules}
                    title={title}
                  />
                )
              })()}
            </aside>
          </div>
        </main>

        {/* Sidebar preview supprimé (refonte 2026-05-16). Remplacé par
         *  <PreviewModal> floating window non-modale ouvert via bouton header
         *  "Preview". Cadrage par drag → réintégré V2 cf
         *  memory project_cropping_in_preview_modal_v2. */}
      </div>

      {/* Lightbox plein écran (Palier C) — preview vidéo simple sans cadrage.
       *  Le cadrage a été déplacé vers AnimationCropModal (animation-level). */}
      <AnimationStudioLightbox
        open={lightboxPelliculeId !== null}
        pellicule={animationPellicules.find(p => p.id === lightboxPelliculeId) ?? null}
        baseImageUrl={imageUrl}
        onClose={() => setLightboxPelliculeId(null)}
      />

      {/* (Refonte 2026-05-08 : modal cadrage retirée — le preview à droite
       *  fait office d'éditeur de cadrage avec drag direct sur la vidéo.
       *  Plus simple, moins de chemins UX redondants.) */}

      {/* Chat IA conversationnel Ctrl+K — Refonte 2026-05-11.
       *  Slide panel depuis la gauche avec historique persistant. L'auteur
       *  dialogue avec Mistral qui propose les shots un par un, acceptés
       *  individuellement (= patch direct pellicule à chaque clic Accepter). */}
      <AnimationStudioAiChat
        open={aiPaletteOpen}
        onClose={() => setAiPaletteOpen(false)}
        context={aiPaletteContext}
        imageDescription={aiImageDescription ?? undefined}
        charactersDescription={aiCharactersDescription ?? undefined}
        qwenStatus={aiQwenStatus}
        messages={chatMessages}
        onMessagesChange={setChatMessages}
        onApplyShot={handleApplyChatShot}
        characters={characters}
        sceneImageUrl={selectedPellicule?.firstFrameUrl ?? imageUrl}
        pelliculeHasVideo={!!selectedPellicule?.videoUrl}
        onGenerate={handleGenerate}
      />

      {/* Modal d'édition de l'exit de la pellicule active (Step 2 refonte 2026-05-11).
       *  Affiché uniquement quand exitEditorOpen=true ; le bouton trigger n'apparaît
       *  que sur la dernière pellicule du plan (cf isLastPellicule prop). */}
      <PelliculeExitEditor
        open={exitEditorOpen}
        onClose={() => setExitEditorOpen(false)}
        pellicule={selectedPellicule}
        allPellicules={animationPellicules}
        onSave={(exit) => {
          if (!selectedPellicule) return
          updateAnimationPellicule(selectedPellicule.id, { exit })
        }}
        onCreateNewPellicule={() => {
          const newId = `pell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          addAnimationPellicule({ id: newId })
          return newId
        }}
      />

      {/* Toast Ctrl+S — feedback discret en bas à droite. Auto-fade 1.4s. */}
      {saveToast && (
        <div className={`as-save-toast as-save-toast-${saveToast}`} role="status" aria-live="polite">
          {saveToast === 'saving' && <span>💾 Enregistrement…</span>}
          {saveToast === 'saved'  && <span>✓ Enregistré</span>}
          {saveToast === 'error'  && <span>⚠ Échec — réessaie</span>}
        </div>
      )}

      {/* Modale Bibliothèque d'effets (refonte 2026-05-15ca+dt) — ouverte via
       *  hover banque ou hover bloc timeline. Lit depuis target unifié (asset
       *  banque OU pellicule timeline). Autosave en DB via PATCH
       *  /api/assets/animation/[id] {effects_params}. */}
      <EffectsModal
        open={!!effectsModalTarget}
        videoUrl={effectsModalTarget?.videoUrl ?? null}
        fallbackImageUrl={effectsModalTarget?.firstFrameUrl ?? null}
        bookId={bookId}
        sectionId={sectionIdFromUrl ?? null}
        onCaptureSaved={() => setBankRefreshKey(k => k + 1)}
        initialState={migrateLegacyEffectsParams(
          effectsModalTarget?.effects_params as ComposedEffectsState | null,
        )}
        pelliculeLabel={effectsModalTarget?.label ?? undefined}
        onChange={(next) => {
          const assetId = effectsModalTarget?.assetId
          if (!assetId) return
          // Sync local : si la pellicule est en timeline, on update son state
          // (= preview live réactive sur le bloc timeline).
          if (animationPellicules.some(p => p.id === assetId)) {
            updateAnimationPellicule(assetId, {
              effects_params: next as unknown as Record<string, unknown>,
            })
          }
          // PATCH DB debouncé 400ms.
          if (bookId) {
            if (effectsPatchTimerRef.current) clearTimeout(effectsPatchTimerRef.current)
            effectsPatchTimerRef.current = setTimeout(() => {
              void fetch(`/api/assets/animation/${assetId}?bookId=${bookId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ effects_params: next }),
              }).catch(err => console.warn('[AnimationStudio] effects PATCH failed:', err))
            }, 400)
          }
        }}
        onClose={() => setEffectsModalTarget(null)}
      />

      {/* Modale Capture (refonte 2026-05-15dq+dt+2026-05-16) — séparée de la
       *  modale Effets. Mode='capture' : pas de sidebar/toolbar effets,
       *  uniquement scrub+save vers la banque d'images. Lit depuis target
       *  unifié (banque OU timeline). Refonte 2026-05-16 : ajout
       *  onCaptureAndTrim pour sauver l'image + couper la vidéo (metadata trim
       *  des shots[].duration au timestamp). */}
      <EffectsModal
        mode="capture"
        open={!!captureModalTarget}
        videoUrl={captureModalTarget?.videoUrl ?? null}
        fallbackImageUrl={captureModalTarget?.firstFrameUrl ?? null}
        bookId={bookId}
        sectionId={sectionIdFromUrl ?? null}
        onCaptureSaved={() => setBankRefreshKey(k => k + 1)}
        initialState={migrateLegacyEffectsParams(
          captureModalTarget?.effects_params as ComposedEffectsState | null,
        )}
        pelliculeLabel={captureModalTarget?.label ?? undefined}
        onCaptureAndTrim={async ({ dataUrl, label, timestamp }) => {
          if (!captureModalTarget || !bookId) return
          const targetAssetId = captureModalTarget.assetId
          // 1. Upload image vers Supabase + create asset_image
          const upRes = await fetch('/api/storage/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data_url: dataUrl,
              path: `captures/cap_trim_${Date.now()}.jpg`,
            }),
          })
          const upData = await upRes.json() as { url?: string }
          if (!upRes.ok || !upData.url) throw new Error('upload image failed')
          const assetRes = await fetch('/api/assets/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookId,
              sectionId: sectionIdFromUrl ?? undefined,
              url: upData.url,
              label,
              source_type: 'capture_trim',
            }),
          })
          if (!assetRes.ok) throw new Error('create asset_image failed')
          // 2. Trim shots de la pellicule courante : trouver le shot qui
          // contient timestamp, ajuster sa duration, supprimer les suivants.
          const pell = animationPellicules.find(p => p.id === targetAssetId)
          if (pell && pell.shots && pell.shots.length > 0) {
            let elapsed = 0
            const newShots: typeof pell.shots = []
            for (const sh of pell.shots) {
              const dur = sh.duration ?? 4
              if (elapsed + dur >= timestamp) {
                // Ce shot contient le timestamp → tronquer (min 0.1s pour éviter shot vide)
                const newDur = Math.max(0.1, timestamp - elapsed)
                newShots.push({ ...sh, duration: newDur })
                break  // ignore les shots suivants
              }
              newShots.push(sh)
              elapsed += dur
            }
            // Si timestamp dépasse la durée totale, on garde tous les shots tels quels
            if (newShots.length > 0) {
              updateAnimationPellicule(targetAssetId, { shots: newShots })
            }
          }
          // 3. Refresh banque + close modal
          setBankRefreshKey(k => k + 1)
          setCaptureModalTarget(null)
        }}
        onClose={() => setCaptureModalTarget(null)}
      />

      {/* ConfirmDialog suppression asset banque (refonte 2026-05-16). Cascade
       *  DELETE scoped via /api/assets/[type]/[id]?bookId=X. Si l'asset est
       *  utilisé dans des sections, affiche la liste cliquable (click =
       *  navigate Studio Section). */}
      {(() => {
        const t = deleteAssetTarget
        if (!t) return null
        const apiKind = t.kind === 'animations' ? 'animation' : 'image'
        const hasUsages = t.sectionsUsing.length > 0
        const messageNode = hasUsages ? (
          <div>
            <p style={{ marginTop: 0 }}>
              Cet asset est utilisé dans <strong>{t.sectionsUsing.length}</strong>{' '}
              section{t.sectionsUsing.length > 1 ? 's' : ''}. La suppression le
              retirera de toutes ces sections (cascade).
            </p>
            <ul style={{
              listStyle: 'none', padding: 0, margin: '0.5rem 0',
              display: 'flex', flexDirection: 'column', gap: '0.3rem',
              maxHeight: '12rem', overflowY: 'auto',
            }}>
              {t.sectionsUsing.map(s => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteAssetTarget(null)
                      // Navigation vers Studio Section (memory project_preview_modal_unified
                      // option A) — la section courante est fermée, la cible chargée.
                      router.push(`/editor-test/studio-section?sectionId=${s.id}`)
                    }}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '0.4rem 0.6rem',
                      background: 'var(--ie-bg, #0e0e12)',
                      border: '1px solid var(--ie-border, #2a2a35)',
                      borderRadius: '0.25rem',
                      color: 'var(--ie-text, #e4e4e7)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                    }}
                  >
                    📄 Section {s.number}{s.title ? ` — ${s.title}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p style={{ margin: 0 }}>
            Cet asset n&apos;est utilisé dans aucune section. La suppression est définitive.
          </p>
        )
        return (
          <ConfirmDialog
            open={!!deleteAssetTarget}
            title={`Supprimer ${t.kind === 'animations' ? "l'animation" : "l'image"} « ${t.asset.label ?? t.asset.id.slice(0, 8)} » ?`}
            message={messageNode}
            variant="danger"
            confirmLabel={hasUsages ? 'Supprimer quand même' : 'Supprimer'}
            cancelLabel="Annuler"
            loading={deletingAsset}
            onCancel={() => setDeleteAssetTarget(null)}
            onConfirm={async () => {
              if (!bookId) return
              setDeletingAsset(true)
              try {
                const res = await fetch(
                  `/api/assets/${apiKind}/${t.asset.id}?bookId=${bookId}`,
                  { method: 'DELETE' },
                )
                if (!res.ok) {
                  const txt = await res.text().catch(() => '')
                  throw new Error(`HTTP ${res.status} ${txt}`)
                }
                // Refresh banque (re-fetch assets + usages)
                setBankRefreshKey(k => k + 1)
                setDeleteAssetTarget(null)
              } catch (err) {
                console.error('[AnimationStudio] DELETE asset failed:', err)
                alert(`Échec suppression : ${err instanceof Error ? err.message : String(err)}`)
              } finally {
                setDeletingAsset(false)
              }
            }}
          />
        )
      })()}

      {/* PreviewModal floating window — refonte 2026-05-16. Remplace l'ancien
       *  sidebar AnimationStudioPreview. Non-bloquant (édition continue
       *  derrière), draggable, repliable. */}
      <PreviewModal
        open={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        pellicules={animationPellicules}
        title={`Animation • ${animationPellicules.length} pellicule${animationPellicules.length > 1 ? 's' : ''}`}
      />
    </div>
    </CharacterPersistProvider>
  )
}

