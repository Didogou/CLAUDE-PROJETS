'use client'
/**
 * Banc de test du nouveau Studio Designer (modèle 2 phases).
 *
 * URL : http://localhost:3000/editor-test/new-layout
 *
 * Architecture : 2 vues
 *   1. Pas de scène choisie → SceneTestPicker (grille 12 scènes)
 *   2. Scène choisie       → DesignerLayout avec prompt pré-rempli
 *
 * Persistance localStorage par scène (clé dz_test_v1_scene_<id>) :
 *   - Variantes générées + sélection
 *   - Image base committée
 *   - Phase courante
 *   Sauvegardé au Ctrl+S (raccourci clavier global) ou clic Commencer.
 *
 * Reload → si la scène a un state sauvegardé, on entre directement en
 * Phase B avec l'image restaurée. Sinon Phase A avec prompt pré-rempli.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Scissors, Paintbrush, Wand2, Sparkles, Hexagon, PenTool, User, UserPlus, Replace, Pencil, Film, Crop, PackagePlus } from 'lucide-react'
import CropImageModal from '@/components/image-editor/CropImageModal'
import '../../../components/image-editor/editor.css'
import '../../../components/image-editor/designer/designer.css'
import '../../../components/image-editor/designer/choice/choice.css'
import DesignerLayout from '../../../components/image-editor/designer/DesignerLayout'
import DesignerBankPanel from '../../../components/image-editor/designer/DesignerBankPanel'
import type { DesignerAction } from '../../../components/image-editor/designer/DesignerActionsToolbar'
import VariantsStrip from '../../../components/image-editor/designer/VariantsStrip'
import { EditorStateProvider, useEditorState } from '../../../components/image-editor/EditorStateContext'
import LayerTabs from '../../../components/image-editor/LayerTabs'
import Canvas from '../../../components/image-editor/Canvas'
import { SidebarContent } from '../../../components/image-editor/Sidebar'
import GenerationPanel from '../../../components/image-editor/GenerationPanel'
import BakeProgressModal from '../../../components/image-editor/BakeProgressModal'
import { useEditorTheme } from '../../../components/image-editor/hooks/useEditorTheme'
import { useImageGeneration } from '../../../components/image-editor/hooks/useImageGeneration'
import {
  variantFromBankImage,
  variantFromGenerationStatus,
  type BankImage,
  type DesignerPhase,
  type DesignerVariant,
} from '../../../components/image-editor/designer/types'
import DevStudioPicker, { type PickedPlan } from './DevStudioPicker'
// Import local conservé pour compat des types dans DesignerInner (le picker
// SceneTestPicker n'est plus utilisé dans le render — TestScene est utilisé
// comme structure proxy dans DesignerInner pour minimiser le refactor).
import { type TestScene } from './SceneTestPicker'
import type { Npc, Item, Section, Choice } from '@/types'
import { CharacterStoreProvider, useCharacterStore, type Character } from '@/lib/character-store'
import CharacterCreatorModal from '@/components/image-editor/designer/CharacterCreatorModal'
import CharacterAttachmentRouterModal from '@/components/image-editor/designer/CharacterAttachmentRouterModal'
import ItemCreatorModal, { type ItemFormData } from '@/components/image-editor/designer/ItemCreatorModal'
import { CharacterPersistProvider, type CharacterPersistFn } from '@/lib/character-persist-context'
import {
  detectImageKind,
  composeFullbodyOnGray,
  composePortraitFromExtraction,
} from '@/lib/image-extraction-analysis'
import type { PersonnageMode } from '../../../components/image-editor/designer/DesignerCatalog'
import {
  ChoicePlanProvider,
  type ChoiceData,
  type SectionChoice,
} from '../../../components/image-editor/designer/choice/ChoicePlanContext'
import { runFluxKontext } from '@/lib/comfyui-flux-kontext'
import { runQwenImageEdit } from '@/lib/comfyui-qwen-edit'
import { extractCharacterByDiff } from '@/lib/image-diff'
import { positionToZone, zoneLabelEn, zoneLabelFr } from '@/components/image-editor/designer/objects/position-to-zone'
import { computeAlphaBounds } from '@/components/image-editor/designer/objects/compute-alpha-bounds'
import ItemLayerInspector from '@/components/image-editor/designer/objects/ItemLayerInspector'
import DropPromptModal from '@/components/image-editor/designer/objects/DropPromptModal'
import AddObjectFromToolbarModal, { type AddObjectMode } from '@/components/image-editor/designer/objects/AddObjectFromToolbarModal'
import HeroToast, { type HeroToastValue } from '@/components/image-editor/designer/HeroToast'
import { runZImage } from '@/lib/comfyui-z-image'
import { flattenLayersToImage } from '@/lib/flatten-layers'

// ── Mocks NPC / Item / Section / Choice (pour les folds) ─────────────────
const MOCK_NPC: Npc = {
  id: 'npc-travis', book_id: 'mock-book', name: 'Travis', type: 'ally',
  description: 'Protagoniste, lieutenant des Freaks',
  portrait_url: 'https://placehold.co/400x400/EC4899/white?text=Travis',
} as unknown as Npc

const MOCK_ITEM: Item = {
  id: 'item-revolver', book_id: 'mock-book', name: 'Revolver Colt Python', type: 'weapon',
  description: '.357 Magnum, 6 coups',
  illustration_url: 'https://placehold.co/400x400/6366F1/white?text=Colt',
} as unknown as Item

const MOCK_CHOICE: Choice = {
  id: 'choice-1', section_id: 'section-1',
  label: 'Aller voir la silhouette au fond du bar', target_section_id: 'section-7',
} as unknown as Choice

// Banque d'images mockée pour la BankPanel (en plus du prompt de la scène)
const MOCK_BANK: BankImage[] = [
  { id: 'b1', url: 'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1600&h=900&fit=crop',
    thumbnailUrl: 'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=300&h=170&fit=crop',
    label: 'Forêt brumeuse', tags: ['forêt', 'brume'], source: 'plan' },
  { id: 'b2', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1600&h=900&fit=crop',
    thumbnailUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=300&h=170&fit=crop',
    label: 'Conifères', tags: ['forêt', 'arbres'], source: 'upload' },
  { id: 'b3', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1600&h=900&fit=crop',
    thumbnailUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=300&h=170&fit=crop',
    label: 'Chemin boisé', tags: ['arbres', 'sentier'], source: 'plan' },
  { id: 'b4', url: 'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?w=1600&h=900&fit=crop',
    thumbnailUrl: 'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?w=300&h=170&fit=crop',
    label: 'Sous-bois sombre', tags: ['forêt', 'nuit'], source: 'generated' },
]

// ── Page ─────────────────────────────────────────────────────────────────

export default function NewLayoutTestPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Palier 1 — navigation depuis Studio Section : ?planId=X&returnSectionId=Y.
  // Si planId présent : on bypass le DevStudioPicker (l'utilisateur arrive
  // intentionnellement sur ce Plan). Le chargement effectif des données du
  // plan via /api/plans/[id] = Palier 2 à venir.
  const planIdFromUrl = searchParams?.get('planId') ?? null
  const returnSectionId = searchParams?.get('returnSectionId') ?? null
  // Refonte 2026-05-13 : navigation depuis Studio Section refondu (timeline
  // horizontale) — passe `planIndex+sectionId` au lieu du `planId` legacy
  // (table morte). Source = section.images[planIndex].
  const planIndexFromUrl = searchParams?.get('planIndex')
    ? parseInt(searchParams.get('planIndex')!, 10)
    : null
  const sectionIdFromUrl = searchParams?.get('sectionId') ?? null
  // Refonte V2 2026-05-13 : nouveau flow assetId (= /api/assets/image/[id]).
  // Chantier 2 (2026-05-16) : `?imageAssetId=X` est l'alias officiel du mode
  // standalone (édition pure de l'asset, pas de plan/section). Accepté en
  // alternative à `?assetId=X` pour clarifier l'intention côté URL.
  const assetIdFromUrl = searchParams?.get('assetId')
    ?? searchParams?.get('imageAssetId')
    ?? null
  // Lazy-create 2026-05-13 : draftAssetId = UUID local, AUCUN asset DB tant
  // que l'auteur n'a pas cliqué "Commencer l'édition". Évite les orphelins.
  const draftAssetIdFromUrl = searchParams?.get('draftAssetId') ?? null

  // Plan sélectionné (null = on affiche le picker grille 4×3, sauf si planId URL)
  const [picked, setPicked] = useState<PickedPlan | null>(null)
  const [planLoadError, setPlanLoadError] = useState<string | null>(null)
  /** Contenu brut de la section courante (markdown ou résumé). Parsé pour
   *  extraire "**Persos présents :** ..." → sectionCharacterIds. Drive la
   *  section 2 du panneau Personnages du Designer. Déclaré ici (avant le
   *  useEffect de loadPlan) car le setter est utilisé dans le loadPlan. */
  const [sectionContent, setSectionContent] = useState<string>('')

  const handlePickPlan = useCallback((p: PickedPlan) => {
    setPicked(p)
  }, [])

  const handleBackToPicker = useCallback(() => {
    // Si on vient de Studio Section (returnSectionId en URL) → retour vers la
    // section parente. Sinon → retour au DevStudioPicker (clear picked).
    if (returnSectionId) {
      router.push(`/editor-test/studio-section?sectionId=${returnSectionId}`)
    } else {
      setPicked(null)
    }
  }, [returnSectionId, router])

  // Palier 2 — Si planId en URL, on fetch le Plan + sa Section pour
  // construire un PickedPlan synthetic et bypass le DevStudioPicker.
  // Le mapping new model (Plan.data) → legacy (SectionImage) est fait ici :
  //   - imageUrl du data.imageUrl (static) ou data.firstFrameUrl (animation)
  //   - les autres champs SectionImage restent vides V2 (à enrichir Palier 3+)
  useEffect(() => {
    if (!planIdFromUrl) return
    if (picked && picked.plan && (picked as PickedPlan & { _planId?: string })._planId === planIdFromUrl) return
    let aborted = false
    async function loadPlan() {
      setPlanLoadError(null)
      try {
        const planRes = await fetch(`/api/plans/${planIdFromUrl}`)
        if (!planRes.ok) throw new Error(`plan HTTP ${planRes.status}`)
        const planRow = await planRes.json() as {
          id: string
          book_id: string
          section_id: string
          sort_order: number
          type: 'static' | 'animation' | 'conversation'
          title: string | null
          data: {
            imageUrl?: string | null
            firstFrameUrl?: string | null
            sequences?: Array<{
              id?: string
              sort_order?: number
              sourceImageUrl?: string | null
              videoUrl?: string | null
              firstFrameUrl?: string | null
              lastFrameUrl?: string | null
              /** @deprecated mono-shot legacy — refacto multi-shots β.1+ utilise shots[]. */
              shot?: 'wide' | 'medium' | 'close_up' | 'extreme_close_up'
              /** @deprecated mono-shot legacy. */
              camera?: string
              /** @deprecated mono-shot legacy. */
              duration?: number
              /** @deprecated mono-shot legacy. */
              perCharacterAction?: Record<string, { action?: string; dialogue?: string }>
              characterIds?: string[]
              /** Refacto multi-shots β.1+ 2026-05-06 : source de vérité actions/dialogues par shot. */
              shots?: Array<{
                id?: string
                shot?: string
                camera?: string
                duration?: number
                characterIds?: string[]
                speakerId?: string | null
                perCharacterAction?: Record<string, { action?: string; dialogue?: string }>
                perCharacter?: Record<string, { action?: string; dialogue?: string }>
                cropKeyframes?: unknown
              }>
              /** Description scène (β.1+ 2026-05-06) — null = hérite pellicule 1. */
              scene_visible?: string | null
              scene_offscreen?: string | null
              characters_appearance?: string | null
            }>
          }
        }

        const sectionRes = await fetch(`/api/sections/${planRow.section_id}`)
        if (!sectionRes.ok) throw new Error(`section HTTP ${sectionRes.status}`)
        const { section } = await sectionRes.json() as {
          section: { number: number; summary?: string | null; content?: string | null }
        }
        if (aborted) return
        // Stocke le content brut pour parser "**Persos présents :** X, Y" → IDs
        // (drive la section 2 du panneau Personnages du Designer).
        setSectionContent(section.content ?? section.summary ?? '')

        // Mapping data → image base : pour static = imageUrl direct, pour
        // animation = firstFrame de la 1ère séquence (fallback).
        const imageUrl = planRow.data?.imageUrl
          ?? planRow.data?.firstFrameUrl
          ?? planRow.data?.sequences?.[0]?.firstFrameUrl
          ?? null

        // Palier 3 — Pour les plans animation, mappe data.sequences[] vers
        // PelliculePersisted[] que le DesignerInner hydrate (cf code ~ligne
        // 230 : persistedPellicules.forEach(addAnimationPellicule)).
        const pellicules = planRow.type === 'animation' && Array.isArray(planRow.data?.sequences)
          ? [...planRow.data.sequences]
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              .map(s => {
                // Refacto multi-shots β.1+ 2026-05-06 : si le JSON BDD vient
                // d'une vieille version (mono-shot avec champs flat), on
                // wrap dans shots[0]. Si shots[] est déjà présent (nouvelle
                // version), on l'utilise tel quel.
                const flatPerCharacter = Object.fromEntries(
                  Object.entries(s.perCharacterAction ?? {}).map(([k, v]) => [
                    k,
                    { action: v?.action ?? '', dialogue: v?.dialogue ?? '' },
                  ]),
                )
                // Helper qui hydrate un shot avec migration backward-compat des
                // champs récents (characterIds + speakerId par shot, refonte
                // 2026-05-07). Les vieux shots sans characterIds → fallback sur
                // les keys de perCharacter (= persos qui avaient action ou dialogue).
                // Sans speakerId → 1er char qui a un dialogue rempli (ou null).
                const hydrateShot = (sh: {
                  id?: string; shot?: string; camera?: string; duration?: number;
                  characterIds?: string[]; speakerId?: string | null;
                  perCharacterAction?: Record<string, { action?: string; dialogue?: string }>;
                  perCharacter?: Record<string, { action?: string; dialogue?: string }>;
                  cropKeyframes?: unknown;
                }) => {
                  const perChar = Object.fromEntries(
                    Object.entries(sh.perCharacterAction ?? sh.perCharacter ?? {}).map(([k, v]) => [
                      k,
                      { action: v?.action ?? '', dialogue: v?.dialogue ?? '' },
                    ]),
                  )
                  const charIds = sh.characterIds ?? Object.keys(perChar)
                  // speakerId fallback : 1er char avec dialogue non-vide
                  const speakerFallback = Object.entries(perChar)
                    .find(([_id, d]) => d.dialogue.trim().length > 0)?.[0] ?? null
                  return {
                    id: sh.id ?? `shot-${Math.random().toString(36).slice(2, 8)}`,
                    shot: (sh.shot ?? 'medium') as 'wide' | 'medium' | 'close_up' | 'extreme_close_up',
                    camera: (sh.camera ?? 'static') as 'static' | 'slow_zoom_in' | 'slow_zoom_out'
                      | 'pan_left' | 'pan_right' | 'dolly_in' | 'dolly_out' | 'handheld',
                    duration: sh.duration ?? 3,
                    characterIds: charIds,
                    speakerId: sh.speakerId ?? speakerFallback,
                    perCharacter: perChar,
                    cropKeyframes: sh.cropKeyframes as never,  // passe-plat, pas validé V1
                  }
                }
                const shots = Array.isArray(s.shots) && s.shots.length > 0
                  ? s.shots.map(hydrateShot)
                  : [hydrateShot({
                      // Migration : 1 seul shot construit depuis les champs flat legacy
                      shot: s.shot,
                      camera: s.camera,
                      duration: s.duration,
                      perCharacterAction: s.perCharacterAction,
                    })]
                return {
                  id: s.id ?? `seq-${Math.random().toString(36).slice(2, 8)}`,
                  characterIds: s.characterIds ?? Object.keys(s.perCharacterAction ?? {}),
                  shots,
                  videoUrl: s.videoUrl ?? null,
                  firstFrameUrl: s.firstFrameUrl ?? null,
                  lastFrameUrl: s.lastFrameUrl ?? null,
                  scene_visible: s.scene_visible ?? null,
                  scene_offscreen: s.scene_offscreen ?? null,
                  characters_appearance: s.characters_appearance ?? null,
                }
              })
          : undefined

        // Step 3d (refonte 2026-05-11) : hydratation Plan choix.
        // Le `data.choice_data` JSONB est extrait pour drive l'outil Choix
        // dans le Designer (markers, sources, variant). Si planRow.type='choice'
        // sans choice_data → init défaut 'image' avec options vide.
        const planKind: 'image' | 'animation' | 'choice' =
          planRow.type === 'animation' ? 'animation'
            : planRow.type === 'choice' ? 'choice'
              : 'image'
        const choiceData = planKind === 'choice'
          ? ((planRow.data as Record<string, unknown> | null)?.choice_data as
              import('@/types').SectionImage['choice_data']
              ?? { variant: 'image', options: [] })
          : undefined

        // Hydrate les NPCs présents : priorité à la colonne npc_ids (source de
        // vérité depuis 2026-05-12), fallback sur le legacy data.tags.characters
        // pour les plans sauvés avant cette migration. Refonte 2026-05-12 —
        // fix bug "Marquer comme posé ne persiste pas".
        const planNpcIds = ((planRow as { npc_ids?: string[] | null }).npc_ids
          ?? (planRow.data as { tags?: { characters?: string[] } } | undefined)?.tags?.characters
          ?? [])
        const synthetic: PickedPlan & { _planId: string } = {
          _planId: planRow.id,
          bookId: planRow.book_id,
          sectionId: planRow.section_id,
          sectionName: planRow.title ?? section.summary ?? `Section ${section.number}`,
          sectionNumber: section.number,
          planIndex: planRow.sort_order,
          // SectionImage minimum + pellicules pour les plans animation.
          // `kind='animation'` est CRUCIAL pour que la hydratation des pellicules
          // fire dans DesignerInner (cf condition `picked.plan.kind === 'animation'`).
          plan: {
            url: imageUrl,
            kind: planKind,
            tags: { characters: planNpcIds },
            ...(pellicules ? { pellicules } : {}),
            ...(choiceData ? { choice_data: choiceData } : {}),
          } as PickedPlan['plan'],
        }
        setPicked(synthetic)
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Designer] load plan failed:', msg)
        setPlanLoadError(msg)
      }
    }
    void loadPlan()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planIdFromUrl])

  // Refonte V2 2026-05-13 — branche assetId : fetch /api/assets/image/[id]
  // et synthetise un PickedPlan. Plus de section.images JSONB touched.
  useEffect(() => {
    if (planIdFromUrl) return
    if (planIndexFromUrl !== null && sectionIdFromUrl) return  // priorité au flow mid-V1
    if (!assetIdFromUrl) return
    if (picked && (picked as PickedPlan & { _assetId?: string })._assetId === assetIdFromUrl) return
    let aborted = false
    void (async () => {
      try {
        const assetRes = await fetch(`/api/assets/image/${assetIdFromUrl}`)
        if (assetRes.status === 404) {
          throw new Error(
            `Asset ${assetIdFromUrl?.slice(0, 8)} introuvable (probablement supprimé). `
            + 'Retourne au Studio Section et choisis un autre asset.',
          )
        }
        if (!assetRes.ok) throw new Error(`asset HTTP ${assetRes.status}`)
        const { asset } = await assetRes.json() as { asset: {
          id: string
          url: string
          label?: string
          description?: string
          prompt_fr?: string
          comfyui_settings?: import('@/types').SectionImage['comfyui_settings']
          layers?: unknown[]  // V2 fix 2026-05-14 : hydratation calques
        } }
        if (aborted) return

        // Récupère bookId + sectionName depuis sectionId si fourni
        let bookId = ''
        let sectionName = 'Asset'
        let sectionNumber = 0
        if (sectionIdFromUrl) {
          const secRes = await fetch(`/api/sections/${sectionIdFromUrl}`)
          if (secRes.ok) {
            const { section } = await secRes.json() as {
              section: { book_id: string; number: number; summary?: string; content?: string }
            }
            bookId = section.book_id
            sectionName = section.summary ?? `Section ${section.number}`
            sectionNumber = section.number
            setSectionContent(section.content ?? '')
          }
        }

        // Synthetize un PickedPlan compatible. `_layers` permet à DesignerHost
        // d'hydrater EditorStateProvider.initialLayers (V2 2026-05-14).
        const synthetic: PickedPlan & { _assetId: string; _layers?: unknown[] } = {
          _assetId: assetIdFromUrl!,
          _layers: Array.isArray(asset.layers) ? asset.layers : undefined,
          bookId,
          sectionId: sectionIdFromUrl ?? '',
          sectionName,
          sectionNumber,
          planIndex: 0,
          plan: {
            url: asset.url,
            kind: 'image',
            description: asset.description,
            prompt_fr: asset.prompt_fr,
            comfyui_settings: asset.comfyui_settings,
            tags: { kind: 'image', sections: [], location: null, characters: [], effects: [], objects: [], manual_overrides: [] },
          } as PickedPlan['plan'],
        }
        setPicked(synthetic)
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Designer V2] load asset failed:', msg)
        setPlanLoadError(msg)
      }
    })()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetIdFromUrl, sectionIdFromUrl, planIdFromUrl, planIndexFromUrl])

  // Refonte 2026-05-13 — branche alternative : navigation depuis Studio Section
  // refondu via planIndex+sectionId (table morte évitée). Lit
  // `section.images[planIndex]` directement et bypass le picker.
  useEffect(() => {
    if (planIdFromUrl) return  // priorité au flow legacy s'il est demandé
    if (planIndexFromUrl === null || !sectionIdFromUrl) return
    if (picked && (picked as PickedPlan & { _sectionPlanKey?: string })._sectionPlanKey
        === `${sectionIdFromUrl}_${planIndexFromUrl}`) return
    let aborted = false
    async function loadFromSection() {
      setPlanLoadError(null)
      try {
        const sectionRes = await fetch(`/api/sections/${sectionIdFromUrl}`)
        if (!sectionRes.ok) throw new Error(`section HTTP ${sectionRes.status}`)
        const { section } = await sectionRes.json() as {
          section: {
            book_id: string
            number: number
            summary?: string | null
            content?: string | null
            images?: import('@/types').SectionImage[]
          }
        }
        if (aborted) return
        const idx = planIndexFromUrl!
        const planFromSection = (section.images ?? [])[idx]
        if (!planFromSection) {
          throw new Error(`Plan index ${idx} introuvable (section a ${section.images?.length ?? 0} plan(s)).`)
        }
        setSectionContent(section.content ?? '')
        const synthetic: PickedPlan & { _sectionPlanKey: string } = {
          _sectionPlanKey: `${sectionIdFromUrl}_${idx}`,
          bookId: section.book_id,
          sectionId: sectionIdFromUrl!,
          sectionName: section.summary ?? `Section ${section.number}`,
          sectionNumber: section.number,
          planIndex: idx,
          plan: planFromSection,
        }
        setPicked(synthetic)
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Designer] load from section failed:', msg)
        setPlanLoadError(msg)
      }
    }
    void loadFromSection()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planIndexFromUrl, sectionIdFromUrl, planIdFromUrl])

  // Lazy-create 2026-05-13 — branche DRAFT : draftAssetIdFromUrl porte un UUID
  // local (pas en DB). On synthétise un picked vide ; aucune requête /api/assets.
  // Au clic "Commencer l'édition", handleCommencer V2 POST l'asset + le bloc
  // timeline puis remplace l'URL par ?assetId=<vrai-id>.
  useEffect(() => {
    if (!draftAssetIdFromUrl) return
    if (planIdFromUrl) return
    if (assetIdFromUrl) return
    if (planIndexFromUrl !== null && sectionIdFromUrl) return
    if (picked && (picked as PickedPlan & { _draftAssetId?: string })._draftAssetId
        === draftAssetIdFromUrl) return
    let aborted = false
    void (async () => {
      try {
        // On a juste besoin du book_id + section meta pour synthétiser le picked.
        let bookId = ''
        let sectionName = 'Brouillon'
        let sectionNumber = 0
        if (sectionIdFromUrl) {
          const secRes = await fetch(`/api/sections/${sectionIdFromUrl}`)
          if (secRes.ok) {
            const { section } = await secRes.json() as {
              section: { book_id: string; number: number; summary?: string; content?: string }
            }
            if (aborted) return
            bookId = section.book_id
            sectionName = section.summary ?? `Section ${section.number}`
            sectionNumber = section.number
            setSectionContent(section.content ?? '')
          }
        }
        const synthetic: PickedPlan & { _draftAssetId: string } = {
          _draftAssetId: draftAssetIdFromUrl,
          bookId,
          sectionId: sectionIdFromUrl ?? '',
          sectionName,
          sectionNumber,
          planIndex: 0,
          plan: {
            url: '',
            kind: 'image',
            tags: { kind: 'image', sections: [], location: null, characters: [], effects: [], objects: [], manual_overrides: [] },
          } as PickedPlan['plan'],
        }
        setPicked(synthetic)
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Designer DRAFT] init failed:', msg)
        setPlanLoadError(msg)
      }
    })()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftAssetIdFromUrl, sectionIdFromUrl, planIdFromUrl, assetIdFromUrl, planIndexFromUrl])

  // Loading / error : applicable aux 4 flows (planId legacy, planIndex+sectionId, assetId V2, draftAssetId V2 lazy).
  if ((planIdFromUrl || (planIndexFromUrl !== null && sectionIdFromUrl) || assetIdFromUrl || draftAssetIdFromUrl) && !picked) {
    return (
      <CharacterStoreProvider>
        <div style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          background: '#0F0F12',
          color: '#A1A1AA',
          fontFamily: 'Inter, sans-serif',
        }}>
          {planLoadError ? (
            <>
              <div style={{ color: '#ef4444', fontSize: '0.875rem' }}>
                ⚠ Erreur de chargement du Plan : {planLoadError}
              </div>
              <button
                type="button"
                onClick={handleBackToPicker}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: '0.5rem',
                  color: '#F4F4F5',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.8125rem',
                }}
              >
                ← Retour Studio Section
              </button>
            </>
          ) : (
            <div style={{ fontSize: '0.875rem' }}>
              Chargement du Plan{' '}
              <code style={{ color: '#F472B6' }}>
                {planIdFromUrl ?? `§${sectionIdFromUrl?.slice(0, 6)} · #${planIndexFromUrl}`}
              </code>…
            </div>
          )}
        </div>
      </CharacterStoreProvider>
    )
  }

  // CharacterStore wrappe la page entière → persos partagés entre toutes les
  // scènes (et plus tard, entre Designer et autres parties du Studio).
  return (
    <CharacterStoreProvider>
      {!picked ? (
        <DevStudioPicker onPick={handlePickPlan} />
      ) : (
        <DesignerHost
          key={`${picked.sectionId}_${picked.planIndex}`}
          picked={picked}
          onBack={handleBackToPicker}
          backLabel={returnSectionId ? '← Retour Studio Section' : undefined}
          sectionContent={sectionContent}
        />
      )}
    </CharacterStoreProvider>
  )
}

// ── Designer hôte (rend le Designer pour une scène donnée) ───────────────

interface DesignerHostProps {
  picked: PickedPlan
  onBack: () => void
  /** Label custom du bouton retour (override default "← Choisir une autre scène"). */
  backLabel?: string
  /** Contenu brut section (fetché côté parent dans loadPlan) — relayé vers
   *  DesignerInner pour le parsing NPCs du panneau Personnages. */
  sectionContent: string
}

function DesignerHost({ picked, onBack, backLabel, sectionContent }: DesignerHostProps) {
  const { theme, toggle: toggleTheme } = useEditorTheme()
  // V2 fix 2026-05-14 : hydratation calques depuis assets_image.layers (passé
  // par useEffect assetIdFromUrl via _layers). Auparavant : calques perdus au
  // refresh — les modifs Designer (perso drag-drop, objets, découpages) ne
  // survivaient qu'en mémoire.
  const persistedLayers = (picked as PickedPlan & { _layers?: unknown[] })._layers

  return (
    <div className="image-editor-root" data-theme={theme}>
      <EditorStateProvider
        initialImageUrl={picked.plan.url ?? null}
        initialLayers={persistedLayers as Parameters<typeof EditorStateProvider>[0]['initialLayers']}
      >
        <DesignerInner
          picked={picked}
          onBack={onBack}
          backLabel={backLabel}
          theme={theme}
          onToggleTheme={toggleTheme}
          sectionContent={sectionContent}
        />
        {/* Modal full-screen pendant SAM compute / bake animation. Lit
         * bakeStatus depuis le context — doit vivre INSIDE EditorStateProvider. */}
        <BakeProgressModal />
      </EditorStateProvider>
    </div>
  )
}

// ── Designer inner (a accès à useEditorState) ────────────────────────────

interface DesignerInnerProps {
  picked: PickedPlan
  onBack: () => void
  backLabel?: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  /** Contenu brut de la section courante — parsé pour extraire les NPCs
   *  déclarés présents (drive section 2 du panneau Personnages). */
  sectionContent: string
}

function DesignerInner({ picked, onBack, backLabel, theme, onToggleTheme, sectionContent }: DesignerInnerProps) {
  // useRouter pour le bouton "Commencer l'animation" qui navigue vers le
  // nouvel écran AnimationStudio (refonte 2026-05-07).
  const router = useRouter()
  // Compatibilité avec le code existant qui s'attend à `scene: TestScene` —
  // on construit un proxy minimal depuis le picked plan.
  const scene: TestScene = useMemo(() => ({
    id: `${picked.sectionId}_p${picked.planIndex}`,
    name: picked.plan.description ?? `${picked.sectionName} · Plan ${picked.planIndex + 1}`,
    prompt: picked.plan.prompt_en ?? picked.plan.prompt_fr ?? '',
    negative: picked.plan.comfyui_settings?.negative ?? '',
    usage: [],
  }), [picked])
  const STORAGE_PREFIX = `studio/section_${picked.sectionId}/plan_${picked.planIndex}`
  const choices = [MOCK_CHOICE]

  // 2026-05-06 — Fetch book npcs + items au mount + push npcs dans CharacterStore
  // pour que le panneau "Personnages dans la scène" du Designer affiche les vrais
  // NPCs du livre (au lieu du MOCK_NPC précédent).
  const { characters: storeCharacters, setCharacters: setStoreCharacters, updateCharacter: updateStoreCharacter } = useCharacterStore()
  const [npcs, setNpcs] = useState<Npc[]>([])
  const [items, setItems] = useState<Item[]>([])
  /** Style illustration du livre (book.illustration_style) — sert de défaut
   *  au GenerationPanel (refonte 2026-05-12). null = pas encore chargé ou
   *  livre sans style → fallback 'realistic' côté GenerationPanel. */
  const [bookIllustrationStyle, setBookIllustrationStyle] = useState<string | null>(null)
  useEffect(() => {
    if (!picked.bookId) return
    let aborted = false
    async function loadBookCatalog() {
      try {
        const res = await fetch(`/api/books/${picked.bookId}`)
        if (!res.ok) return
        const data = await res.json() as {
          book?: { illustration_style?: string | null }
          npcs?: Npc[]
          items?: Item[]
        }
        if (aborted) return
        const fetchedNpcs = data.npcs ?? []
        const fetchedItems = data.items ?? []
        setNpcs(fetchedNpcs)
        setItems(fetchedItems)
        // Style d'illustration du livre — sert de défaut au sélecteur de style
        // dans GenerationPanel (refonte 2026-05-12 : avant 'realistic' hardcodé).
        setBookIllustrationStyle(data.book?.illustration_style ?? null)
        // Push les NPCs dans CharacterStore avec leur portrait_url. Mapping
        // npc → Character : on préserve l'id pour matcher plan.npc_ids[].
        const mapped: Character[] = fetchedNpcs.map(n => {
          const ext = n as Npc & {
            portrait_url?: string | null
            fullbody_gray_url?: string | null
            fullbody_back_url?: string | null
            voice_id?: string | null
            appearance?: string | null
            portrait_settings?: { gender?: string; style?: string; engine?: string } | null
          }
          // Galerie images (migration 079) : tableau d'objets {id, url, label, ...}.
          // Si la colonne renvoie null/undefined (perso créé avant 079) → fallback [].
          const galleryImages = Array.isArray(ext.images) ? ext.images : []
          // Hydrate gender depuis portrait_settings.gender (JSONB) — fix
          // 2026-05-09. Avant : hardcodé 'female' → bug LTX dual qui traitait
          // tous les persos comme femmes.
          const persistedGender = ext.portrait_settings?.gender
          const gender: 'male' | 'female' = persistedGender === 'male' ? 'male' : 'female'
          return {
            id: n.id,
            name: n.name,
            portraitUrl: ext.portrait_url ?? null,
            fullbodyUrl: ext.fullbody_gray_url ?? null,
            fullbodyBackUrl: ext.fullbody_back_url ?? null,
            images: galleryImages,
            gender,
            // Copié depuis npcs.voice_id (cf β.1 lipsync 2026-05-06) — utilisé
            // par buildDialogueAudio quand l'auteur remplit un dialogue dans
            // l'AnimationEditor.
            voice_id: ext.voice_id ?? undefined,
            // Copié depuis npcs.appearance (fix 2026-05-06) — utilisé par
            // buildVantagePrompt comme description visuelle du perso (vêtements,
            // allure). Sans ça, fallback "a person" → LTX a aucune info perso.
            // ⚠ Cette description est le DEFAULT (fiche d'identité du NPC).
            // Pour une scène spécifique où le perso change d'apparence (autre
            // tenue, accessoire ajouté), l'auteur peut override via le champ
            // "Apparence des persos dans la scène" du SceneDescriptionAccordion.
            prompt: ext.appearance ?? undefined,
            createdAt: 0,
          }
        })
        setStoreCharacters(mapped)
      } catch (err) {
        console.error('[Designer] load book catalog failed:', err)
      }
    }
    void loadBookCatalog()
    return () => { aborted = true }
  }, [picked.bookId, setStoreCharacters])

  // ── Step 3d (refonte 2026-05-11) — Plan choix : fetch des choices de la
  //    Section parente + setup persistence pour les markers du Plan choix.
  // Activé uniquement quand picked.plan.kind === 'choice'.
  const isPlanChoice = picked.plan.kind === 'choice'
  const initialChoiceData: ChoiceData | undefined = picked.plan.choice_data
  const planIdForPersist = (picked as PickedPlan & { _planId?: string })._planId ?? null
  // Fetch les choix de la Section parente — utilisé pour 2 features :
  //   1. ChoicePlanProvider (drag-drop des markers sur Plan choix)
  //   2. Bandeau "Choix de §X" affiché au-dessus du canvas (read-only,
  //      rappel visuel pour l'auteur quand il dessine la base, peu importe
  //      le kind du plan).
  const [sectionChoices, setSectionChoices] = useState<SectionChoice[]>([])
  useEffect(() => {
    if (!picked.sectionId) return
    let aborted = false
    async function loadSectionChoices() {
      try {
        const res = await fetch(`/api/sections/${picked.sectionId}`)
        if (!res.ok) return
        const data = await res.json() as { choices?: SectionChoice[] }
        if (aborted) return
        setSectionChoices(data.choices ?? [])
      } catch (err) {
        console.error('[Designer] load section choices failed:', err)
      }
    }
    void loadSectionChoices()
    return () => { aborted = true }
  }, [picked.sectionId])

  // Persistance debouncée : drag d'un marker fire moveOption N fois → on
  // n'envoie qu'un seul PATCH 350ms après le dernier mouvement.
  const choiceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleChoiceDataChange = useCallback((data: ChoiceData) => {
    if (!planIdForPersist) return
    if (choiceSaveTimerRef.current) clearTimeout(choiceSaveTimerRef.current)
    choiceSaveTimerRef.current = setTimeout(() => {
      void fetch(`/api/plans/${planIdForPersist}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { choice_data: data } }),
      }).catch(err => console.error('[Designer] persist choice_data failed:', err))
    }, 350)
  }, [planIdForPersist])

  // Persistance NPCs présents (refonte 2026-05-12 — fix bug "Marquer posé ne
  // persiste pas"). À chaque changement de allPresentCharacterIds (= layers
  // perso + baked), debounced PATCH npc_ids 350ms après la dernière modif.
  // Skip le tout premier render (hydratation rétablit la liste sauvegardée
  // → on ne veut PAS écrire ce qu'on vient juste de lire).
  const npcIdsPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const npcIdsPersistEnabledRef = useRef(false)

  const {
    undo, redo, imageUrl: currentImageUrl, setImageUrl, replaceBase, layers: currentLayers,
    activeLayerIdx,
    setCutMode, setCutTool, clearSceneAnalysis,
    addLayer, removeLayer, updateLayer, setBakeStatus, addBakedCharacter, bakedCharacterIds,
    currentVideoUrl, currentVideoFirstFrameUrl, currentVideoLastFrameUrl, setCurrentVideo,
    addAnimationPellicule,
    animationPellicules,  // Phase B : persiste tout l'array timeline en DB
    animationSelectedCharIds,  // Phase B : persiste la sélection 1-2 chars
    setAnimationSelectedChars,  // hydratation : restore la sélection au reload
  } = useEditorState()

  // Liste UNION des Characters présents dans le plan en cours :
  // - bakedCharacterIds : persos aplatis dans la base (pas de calque)
  // - layers[].character_id : persos en calques transparents
  // Persistée au save dans plan.tags.characters → reload OK au refresh.
  const allPresentCharacterIds = useMemo(() => {
    const fromLayers = currentLayers
      .filter(l => l.character_id != null)
      .map(l => l.character_id!) as string[]
    return Array.from(new Set([...fromLayers, ...bakedCharacterIds]))
  }, [currentLayers, bakedCharacterIds])

  // PATCH npc_ids debounced à chaque changement (après hydratation only). Sans
  // ça, "Marquer comme posé" ne persiste pas et le perso disparaît au refresh.
  // Refonte 2026-05-12.
  useEffect(() => {
    if (!npcIdsPersistEnabledRef.current) return
    if (!planIdForPersist) return
    if (npcIdsPersistTimerRef.current) clearTimeout(npcIdsPersistTimerRef.current)
    npcIdsPersistTimerRef.current = setTimeout(() => {
      void fetch(`/api/plans/${planIdForPersist}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npc_ids: allPresentCharacterIds }),
      }).catch(err => console.error('[Designer] persist npc_ids failed:', err))
    }, 350)
    // Cleanup timer si re-fire avant échéance
    return () => {
      if (npcIdsPersistTimerRef.current) clearTimeout(npcIdsPersistTimerRef.current)
    }
  }, [allPresentCharacterIds, planIdForPersist])

  // Hydrate bakedCharacterIds + animation depuis la DB au mount.
  // Au reload, picked.plan.tags?.characters contient l'UNION layer+baked du save
  // précédent. V1 : on push tout dans bakedCharacterIds (les layers ne sont pas
  // encore reload depuis DB en V1, ce sera Phase plan_layers V2).
  // Si plan kind='animation', restaure la vidéo + frames pour que Canvas
  // l'affiche immédiatement (sinon reload = perte de la vidéo).
  //
  // ⚠ Ref guard contre React StrictMode (qui exécute useEffect 2× en dev).
  // Sans ce guard, addAnimationPellicule se déclenche 2× → 2 pellicules
  // dupliquées dans la timeline (addBakedCharacter est déjà idempotent).
  // Le ref stocke la clé du plan déjà hydraté ; si l'effet re-fire avec
  // la même clé → no-op. Si on switch de plan, la clé change → re-hydrate.
  const hydratedPlanKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const planKey = `${picked.sectionId}_${picked.planIndex}`
    if (hydratedPlanKeyRef.current === planKey) return
    hydratedPlanKeyRef.current = planKey

    const persisted = picked.plan.tags?.characters ?? []
    persisted.forEach(id => addBakedCharacter(id))
    // Active le persist npc_ids APRÈS l'hydratation : la prochaine modif de
    // allPresentCharacterIds déclenchera un PATCH. Le timeout 200ms protège
    // contre les re-renders en cascade qui pourraient fire avant que tous les
    // addBakedCharacter ci-dessus aient été appliqués.
    setTimeout(() => { npcIdsPersistEnabledRef.current = true }, 200)
    if (picked.plan.kind === 'animation') {
      // Phase B : restaure aussi la sélection persos timeline (1-2 chars).
      // Section-level (legacy fallback) — sera écrasé par la sync pellicule
      // sélectionnée si l'array pellicules est présent (cf set_animation_selected_pellicule
      // sync chars dans le reducer).
      const persistedSelectedChars = picked.plan.animation_selected_chars
      if (persistedSelectedChars && persistedSelectedChars.length > 0) {
        setAnimationSelectedChars(persistedSelectedChars)
      }
      // Phase B (2026-05-05) : si l'array `pellicules` est présent en DB,
      // c'est la source de vérité → on restaure tout d'un coup via setOrder.
      // Sinon fallback legacy (single video stored in base_video_url) →
      // on crée 1 pellicule à partir de ces champs.
      const persistedPellicules = picked.plan.pellicules
      if (persistedPellicules && persistedPellicules.length > 0) {
        // Restore l'array complet — le reducer add_animation_pellicule préserve
        // l'id si fourni (cas hydratation), génère un nouveau si collision.
        // On itère pour add chacune et garder l'ordre persisté.
        persistedPellicules.forEach(p => {
          addAnimationPellicule({
            id: p.id,  // préserve l'id DB
            // Refacto multi-shots β.1+ 2026-05-06 : shots[] est désormais le
            // niveau de granularité des cadrage/caméra/durée/perCharacter.
            // L'hydratation upstream (vers ligne 178) a déjà fait la migration
            // backward-compat depuis l'ancien shape flat → shots[0]. On finit
            // de combler ici les champs ajoutés par la refonte 2026-05-07
            // (characterIds + speakerId par shot) au cas où l'objet vient
            // directement de la BDD sans passer par hydrateShot.
            shots: p.shots?.map(s => ({
              ...s,
              characterIds: s.characterIds ?? Object.keys(s.perCharacter ?? {}),
              speakerId: s.speakerId ?? null,
            })),
            // characterIds : par pellicule depuis 2026-05-05. Fallback sur
            // animation_selected_chars (section-level) pour les saves anciens.
            characterIds: p.characterIds ?? persistedSelectedChars ?? [],
            videoUrl: p.videoUrl,
            firstFrameUrl: p.firstFrameUrl,
            lastFrameUrl: p.lastFrameUrl,
            scene_visible: p.scene_visible ?? null,
            scene_offscreen: p.scene_offscreen ?? null,
            characters_appearance: p.characters_appearance ?? null,
          })
        })
        // Set la dernière pellicule générée comme currentVideoUrl pour que
        // Canvas affiche le poster (firstFrame). autoplay=false → pas de
        // lecture automatique à l'arrivée sur la section, l'auteur clique
        // pour lancer (cf décision 2026-05-06).
        const lastGen = [...persistedPellicules].reverse().find(p => p.videoUrl)
        if (lastGen) {
          setCurrentVideo(lastGen.videoUrl, lastGen.firstFrameUrl, lastGen.lastFrameUrl, false)
        }
      } else if (picked.plan.base_video_url) {
        // Legacy : pas d'array pellicules mais base_video_url présent (= save
        // d'avant Phase B). On reconstruit 1 pellicule à partir des champs
        // legacy pour back-compat. autoplay=false (cohérent avec ci-dessus).
        setCurrentVideo(
          picked.plan.base_video_url,
          picked.plan.first_frame_url ?? null,
          picked.plan.last_frame_url ?? null,
          false,
        )
        addAnimationPellicule({
          videoUrl: picked.plan.base_video_url,
          firstFrameUrl: picked.plan.first_frame_url ?? null,
          lastFrameUrl: picked.plan.last_frame_url ?? null,
        })
      }
    }
    // Volontairement pas dans deps : on hydrate UNE FOIS au mount + au switch de plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.sectionId, picked.planIndex])
  const [format, setFormat] = useState('16:9')
  const [genFormCollapsed, setGenFormCollapsed] = useState(false)

  /** Auto-détection du format à partir de l'aspect ratio réel de l'image
   *  base (refonte 2026-05-10). Sans ça, le state local `format` reset à
   *  '16:9' à chaque mount, et une scène déjà croppée 9:16 s'affiche
   *  letterboxée dans le canvas (qui se cale sur le format state). On
   *  load l'image, on mesure naturalWidth/Height, et on pick le preset
   *  le plus proche dans FORMATS. Ça marche rétroactivement sur les
   *  plans existants — pas de migration DB.
   *
   *  ⚠ Seulement si l'auteur n'a PAS modifié le format manuellement après
   *  le mount (sinon on écraserait son choix). On track via une ref. */
  const formatManuallySetRef = useRef(false)
  useEffect(() => {
    if (!currentImageUrl) return
    if (formatManuallySetRef.current) return
    if (typeof window === 'undefined') return
    let aborted = false
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (aborted) return
      const ratio = img.naturalWidth / img.naturalHeight
      // Pick le preset le plus proche du ratio mesuré.
      const presets: Array<{ value: string; ratio: number }> = [
        { value: '9:16',     ratio: 9 / 16 },   // 0.5625
        { value: '1:1',      ratio: 1 },
        { value: '4:3',      ratio: 4 / 3 },    // 1.333
        { value: '16:9',     ratio: 16 / 9 },   // 1.778
        { value: '2:1 pano', ratio: 2 / 1 },
      ]
      let closest = presets[0]
      let minDiff = Math.abs(ratio - closest.ratio)
      for (const p of presets) {
        const d = Math.abs(ratio - p.ratio)
        if (d < minDiff) { minDiff = d; closest = p }
      }
      // Seulement update si le preset détecté diffère du state actuel
      // (évite re-render inutile).
      setFormat(prev => prev === closest.value ? prev : closest.value)
    }
    img.onerror = () => {
      // Échec silencieux : on garde le format courant
    }
    img.src = currentImageUrl
    return () => { aborted = true }
  }, [currentImageUrl])

  // Wrapper setFormat qui marque le manual-set pour que l'auto-detect ne
  // ré-écrase pas le choix de l'auteur si l'image change ensuite (ex: après
  // un crop, on reste sur le format choisi pour le crop).
  const setFormatManual = useCallback((f: string) => {
    formatManuallySetRef.current = true
    setFormat(f)
  }, [])
  // Mode actif sur l'action Personnage (drive le contenu rendu dans le catalog
  // 'generate' quand l'utilisateur a cliqué un sub-tool de Personnage).
  // Refonte 2026-05-12 : init 'animate' si le plan est de type animation ou
  // choix-animation → ouvre directement la vue pellicules (timeline + drawer)
  // au lieu de l'image fixe. L'auteur clique sur une mini-tile plan-anim et
  // arrive immédiatement sur la vue qui correspond à son contenu.
  const initialPersonnageMode: PersonnageMode = (() => {
    if (picked.plan.kind === 'animation') return 'animate'
    if (picked.plan.kind === 'choice'
        && (picked.plan as { choice_data?: { variant?: string } }).choice_data?.variant === 'animation') {
      return 'animate'
    }
    return null
  })()
  const [personnageMode, setPersonnageMode] = useState<PersonnageMode>(initialPersonnageMode)

  /** State pour le CharacterCreatorModal ouvert depuis l'extraction (refonte
   *  2026-05-09). Ouvert quand l'auteur clique "Créer un personnage" dans le
   *  drawer Découper après avoir détouré un sujet. */
  const [extractCreatorOpen, setExtractCreatorOpen] = useState(false)
  const [extractPortraitUrl, setExtractPortraitUrl] = useState<string | null>(null)
  const [extractFullbodyUrl, setExtractFullbodyUrl] = useState<string | null>(null)

  /** Routeur d'attachement perso (refonte 2026-05-12). Quand l'auteur clique
   *  "Créer un perso" depuis une découpe, on n'ouvre PAS direct CharacterCreator
   *  — on ouvre d'abord ce routeur qui demande "nouveau perso" OU "attacher à
   *  un existant" (+ choix slot). Pattern aligné sur le flow Objet. */
  const [attachRouterOpen, setAttachRouterOpen] = useState(false)
  const [attachRouterExtractionUrl, setAttachRouterExtractionUrl] = useState<string | null>(null)

  // Génération réelle d'images via ComfyUI (réutilise le hook de l'ancien Designer).
  // statuses[] mis à jour au fil de l'eau, on les transforme en variants via useEffect plus bas.
  const { statuses: genStatuses, isRunning: genIsRunning, start: startGeneration } = useImageGeneration()

  // ── Phase et state Variants : initialisé selon si le plan a déjà une URL
  // (image generée → Phase B editing) ou pas (vide → Phase A creation).
  // V1 : pas de hydratation des variants persistées, l'auteur regen au besoin.
  const [phase, setPhase] = useState<DesignerPhase>(picked.plan.url ? 'editing' : 'creation')
  const [variants, setVariants] = useState<DesignerVariant[]>([])
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)

  // Note : `buildSnapshot` legacy (qui retournait SavedSceneState pour
  // localStorage) supprimé après migration DB 2026-05-03. Save direct via
  // POST /api/sections/[id]/plans dans le handler Ctrl+S et handleCommencer.
  // Le SAFEGUARD blob URL des calques sera réintroduit en V2 quand on branchera
  // sections.plan_layers en DB (V1 = juste sauve l'image base, pas les calques).

  // Toast discret pour confirmer la sauvegarde (demande UX 2026-05-03 :
  // "aucun message explicite de sauvegarde -> à faire un message discret")
  const [savedToastVisible, setSavedToastVisible] = useState(false)

  /** Crop modal — état d'ouverture. Quand l'auteur clique "Recadrer" dans la
   *  toolbar, on ouvre le modal sur l'image actuelle (currentImageUrl). À
   *  l'apply : upload Storage → entry bank-uploads (réutilisable) → set la
   *  base active du plan via replaceBase. */
  const [cropModalOpen, setCropModalOpen] = useState(false)

  /** Apply du crop : upload + bank entry + replaceBase + ajuste le format
   *  du canvas pour matcher l'aspect choisi (sinon le wrapper canvas reste
   *  sur l'ancien format avec object-fit:cover → image visuellement croppée). */
  const handleCropApplied = useCallback(async (dataUrl: string, aspect: import('@/components/image-editor/CropImageModal').AspectPreset) => {
    if (!picked.bookId) throw new Error('book_id manquant')
    const ts = Date.now().toString(36)
    const path = `books/${picked.bookId}/plans/crops/scene-${ts}.jpg`

    // 1. Upload Storage
    const upRes = await fetch('/api/storage/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: dataUrl, path }),
    })
    const upData = await upRes.json() as { url?: string; error?: string }
    if (!upRes.ok || !upData.url) {
      throw new Error(upData.error ?? `Upload Storage HTTP ${upRes.status}`)
    }

    // 2. Bank entry (non-bloquant — la base est appliquée même si ça rate)
    try {
      await fetch(`/api/books/${picked.bookId}/bank-uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'image',
          url: upData.url,
          name: `Crop ${aspect} ${new Date().toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
          source: 'upload',
        }),
      })
    } catch (err) {
      console.warn('[Designer] bank-uploads entry failed (non-blocking):', err)
    }

    // 3. Remplace la base active + ajuste le format du canvas. formatToAspectRatio
    //    de GenerationPanel comprend déjà '16:9'/'9:16'/'1:1'/'4:3' donc on
    //    passe l'aspect tel quel. Le wrapper canvas se reshape via aspect-ratio
    //    CSS animée (300ms ease) — l'auteur voit la transition.
    replaceBase(upData.url)
    setFormatManual(aspect)
    setCropModalOpen(false)
    setSavedToastVisible(true)
    setTimeout(() => setSavedToastVisible(false), 1500)
  }, [picked.bookId, replaceBase, setFormatManual])

  /** Save unifié : appelé par Ctrl+S, handleCommencer ET l'auto-save débouncé.
   *
   *  Deux modes selon l'origine du picked :
   *   - **New model** (planId URL → synthetic picked avec `_planId`) :
   *     PATCH `/api/plans/[id]` avec data JSONB { imageUrl, sequences[] }.
   *   - **Legacy** (DevStudioPicker → picked classique) : POST
   *     `/api/sections/[id]/plans` mode UPDATE comme avant. */
  const savePlanToDb = useCallback(async (showToast: boolean = true) => {
    const newPlanId = (picked as PickedPlan & { _planId?: string })._planId
    const v2AssetId = (picked as PickedPlan & { _assetId?: string })._assetId
    const draftAssetId = (picked as PickedPlan & { _draftAssetId?: string })._draftAssetId

    // ── DRAFT lazy-create : NO-OP. Aucun save tant que l'auteur n'a pas
    //    cliqué "Commencer l'édition" (= handleCommencer commit l'asset). ──
    if (draftAssetId) {
      return
    }

    // ── MODE V2 (refonte 2026-05-13) : PATCH /api/assets/image/[id] ──
    // Évite la corruption silencieuse de section.images[0] JSONB qu'auraient
    // engendré les branches legacy en l'absence de cette gate (audit CRITIQUE #5).
    if (v2AssetId) {
      try {
        const res = await fetch(`/api/assets/image/${v2AssetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: currentImageUrl ?? null,
            layers: currentLayers,  // V2 fix 2026-05-14 : persiste les calques
          }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(errBody.error ?? `PATCH asset HTTP ${res.status}`)
        }
        console.log('[savePlan V2] PATCH asset saved:', v2AssetId)
        if (showToast) {
          setSavedToastVisible(true)
          setTimeout(() => setSavedToastVisible(false), 2000)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[savePlan V2] PATCH asset failed:', msg, err)
      }
      return
    }

    // ── MODE NEW : PATCH /api/plans/[id] ──────────────────────────────
    if (newPlanId) {
      const data = {
        imageUrl: currentImageUrl ?? null,
        // Mapping inverse de l'hydratation Palier 3 : pellicules → sequences
        sequences: animationPellicules.map((p, idx) => ({
          id: p.id,
          sort_order: idx,
          characterIds: p.characterIds,
          // Multi-shots β.1+ 2026-05-06 + refonte 2026-05-07 (characterIds,
          // speakerId, cropKeyframes par shot).
          shots: p.shots.map(s => ({
            id: s.id,
            shot: s.shot,
            camera: s.camera,
            duration: s.duration,
            characterIds: s.characterIds,
            speakerId: s.speakerId,
            perCharacterAction: s.perCharacter,
            cropKeyframes: s.cropKeyframes,
          })),
          videoUrl: p.videoUrl,
          firstFrameUrl: p.firstFrameUrl,
          lastFrameUrl: p.lastFrameUrl,
          scene_visible: p.scene_visible,
          scene_offscreen: p.scene_offscreen,
          characters_appearance: p.characters_appearance,
        })),
      }
      try {
        const res = await fetch(`/api/plans/${newPlanId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
        })
        if (!res.ok) {
          // Le body d'erreur peut être { error: <string> } OU { error: <obj
          // PostgrestError> } selon que la route catch un throw natif ou un
          // throw Supabase. Sérialise proprement pour pas afficher
          // "[object Object]" (bug logging 2026-05-12).
          const errBody = await res.json().catch(() => ({})) as { error?: unknown }
          const errMsg = typeof errBody.error === 'string'
            ? errBody.error
            : errBody.error
              ? JSON.stringify(errBody.error)
              : `save HTTP ${res.status}`
          throw new Error(errMsg)
        }
        console.log('[savePlan] PATCH new model saved:', newPlanId)
        if (showToast) {
          setSavedToastVisible(true)
          setTimeout(() => setSavedToastVisible(false), 2000)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[savePlan] PATCH failed:', msg, err)
      }
      return
    }

    // ── MODE LEGACY : POST /api/sections/[id]/plans (sections.images JSONB) ──
    const isAnimation = animationPellicules.length > 0 || !!currentVideoUrl
    const lastGenerated = [...animationPellicules].reverse().find(p => p.videoUrl)
    const body = {
      planIndex: picked.planIndex,
      url: currentImageUrl ?? undefined,
      kind: isAnimation ? ('animation' as const) : ('image' as const),
      base_video_url: isAnimation
        ? (lastGenerated?.videoUrl ?? currentVideoUrl ?? undefined)
        : undefined,
      first_frame_url: isAnimation
        ? (lastGenerated?.firstFrameUrl ?? currentVideoFirstFrameUrl ?? undefined)
        : undefined,
      last_frame_url: isAnimation
        ? (lastGenerated?.lastFrameUrl ?? currentVideoLastFrameUrl ?? undefined)
        : undefined,
      pellicules: animationPellicules.length > 0 ? animationPellicules : undefined,
      animation_selected_chars: animationSelectedCharIds.length > 0
        ? animationSelectedCharIds : undefined,
      tags: { characters: allPresentCharacterIds },
    }
    try {
      const res = await fetch(`/api/sections/${picked.sectionId}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `save HTTP ${res.status}`)
      console.log('[savePlan] saved plan to DB:', picked.sectionId, picked.planIndex)
      if (showToast) {
        setSavedToastVisible(true)
        setTimeout(() => setSavedToastVisible(false), 2000)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[savePlan] failed:', msg)
    }
  }, [
    picked, picked.sectionId, picked.planIndex, currentImageUrl, allPresentCharacterIds,
    currentVideoUrl, currentVideoFirstFrameUrl, currentVideoLastFrameUrl,
    animationPellicules, animationSelectedCharIds, currentLayers,
  ])

  // Ctrl+S : raccourci clavier global qui appelle savePlanToDb avec toast.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void savePlanToDb(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [savePlanToDb])

  // Auto-save débouncé : à chaque changement de pellicules / chars sélectionnés
  // (add, update, remove, reorder, char selection), trigger un save silencieux
  // après 800ms d'inactivité. Garantit que les modifications de timeline
  // (notamment les suppressions) sont persistées sans avoir à Ctrl+S explicite.
  //
  // Note : déclenche aussi 1× après l'hydratation au mount → save no-op qui
  // ré-écrit la même data en DB. Acceptable (1 network call ≈ 100ms côté serveur).
  // Pour optimiser plus tard : tracker un hash du dernier state sauvé.
  useEffect(() => {
    const timer = setTimeout(() => {
      void savePlanToDb(false)  // pas de toast, save silencieux
    }, 800)
    return () => clearTimeout(timer)
  }, [animationPellicules, animationSelectedCharIds, savePlanToDb])

  // Banque dynamique :
  //  - V1 legacy : MOCK_BANK statique + uploads
  //  - V2 (assetIdFromUrl) : fetch /api/assets/image?bookId=X, retire MOCK
  // Note : assetIdFromUrl est lu directement ici car DesignerInner est un
  // sous-composant qui n'a pas accès au scope NewLayoutTestPage.
  const innerSearchParams = useSearchParams()
  const innerAssetIdFromUrl = innerSearchParams?.get('assetId') ?? null
  const innerDraftAssetIdFromUrl = innerSearchParams?.get('draftAssetId') ?? null
  const isV2Flow = !!(innerAssetIdFromUrl || innerDraftAssetIdFromUrl)
  const [uploadedBankImages, setUploadedBankImages] = useState<BankImage[]>([])
  const [dbBankImages, setDbBankImages] = useState<BankImage[]>([])

  // Fetch assets_image du livre courant V2 (asset committé ou draft : même banque)
  useEffect(() => {
    if (!isV2Flow) return  // V1 legacy → garde MOCK
    const bId = picked?.bookId
    if (!bId) return
    let aborted = false
    void (async () => {
      try {
        const res = await fetch(`/api/assets/image?bookId=${bId}`)
        if (!res.ok) return
        const data = await res.json() as { assets: Array<{
          id: string
          url: string
          label?: string
          description?: string
        }> }
        if (aborted) return
        setDbBankImages(data.assets.map(a => ({
          id: a.id,
          url: a.url,
          thumbnailUrl: a.url,
          label: a.label ?? a.description?.slice(0, 24) ?? `Image ${a.id.slice(0, 4)}`,
          tags: [],
          source: 'plan',
        } as BankImage)))
      } catch (err) {
        console.warn('[Designer V2] fetch dbBankImages failed:', err)
      }
    })()
    return () => { aborted = true }
  }, [isV2Flow, picked?.bookId])

  const fullBankImages = useMemo(
    () => isV2Flow
      ? [...uploadedBankImages, ...dbBankImages]
      : [...uploadedBankImages, ...MOCK_BANK],
    [innerAssetIdFromUrl, uploadedBankImages, dbBankImages],
  )

  // ── Pick depuis la banque ────────────────────────────────────────────
  // Tous les changements de variante passent par `replaceBase` (cascade
  // delete des calques liés à l'ancienne base) — vs `setImageUrl` qui sert
  // aux édits in-place (LAMA erase, inpaint) où les calques sont conservés.
  const handleBankPick = useCallback((img: BankImage) => {
    const existing = variants.find(v => v.source.kind === 'bank' && v.source.bankId === img.id)
    if (existing) {
      setSelectedVariantId(existing.id)
      replaceBase(existing.url)
      return
    }
    const newVariant = variantFromBankImage(img)
    setVariants(prev => [newVariant, ...prev])
    setSelectedVariantId(newVariant.id)
    replaceBase(newVariant.url)
  }, [variants, replaceBase])

  // ── Upload externe (depuis PC) → pousse dans la banque locale ──────
  // Lit le file en base64, POST vers /api/storage/upload-image, crée une
  // BankImage pointant vers l'URL Supabase, push dans uploadedBankImages.
  // Le composant DesignerBankPanel appelle ensuite onPick(image) pour la
  // sélectionner automatiquement comme base courante.
  const handleBankUpload = useCallback(async (file: File): Promise<BankImage> => {
    // Lit en data URL
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
      reader.readAsDataURL(file)
    })
    // Upload Supabase
    const res = await fetch('/api/storage/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_url: dataUrl,
        path: `${STORAGE_PREFIX}_bank_upload/${Date.now()}_${file.name}`,
      }),
    })
    const data = await res.json()
    if (!res.ok || !data.url) {
      throw new Error(data.error ?? `upload HTTP ${res.status}`)
    }
    // Construit la BankImage et push
    const fileNameNoExt = file.name.replace(/\.[^/.]+$/, '')
    const newImage: BankImage = {
      id: `upload-${Date.now()}`,
      url: data.url,
      thumbnailUrl: data.url,  // pas de thumbnail séparé V1, full image OK
      label: fileNameNoExt,
      tags: ['upload'],
      source: 'upload',
    }
    setUploadedBankImages(prev => [newImage, ...prev])
    return newImage
  }, [])

  /** Persist unifié pour TOUS les CharacterCreatorModal sous l'arbre (refonte
   *  2026-05-09). Branché via CharacterPersistProvider en bas de la fonction.
   *  Gère create (POST /api/npcs) ET edit (PATCH /api/npcs/[id]).
   *  Met à jour le store local pour feedback immédiat sans refresh. */
  const persistCharacterToDb = useCallback<CharacterPersistFn>(async (payload, mode, editingNpcId) => {
    if (!picked.bookId) throw new Error('book_id manquant')
    const baseBody = {
      name: payload.name,
      portrait_url: payload.portraitUrl,
      fullbody_gray_url: payload.fullbodyUrl,
      // fullbody_back_url : déprécié depuis migration 079 (galerie). On
      // continue à envoyer pour back-compat des persos legacy, mais le code
      // utilise désormais `images` pour les nouvelles vues alternatives.
      fullbody_back_url: payload.fullbodyBackUrl ?? null,
      // Galerie : vues alternatives (back/profil L/R) + variantes (refonte
      // 2026-05-09 — migration 079). Source de vérité pour le picker drag-drop.
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
      return editingNpcId
    } else {
      const res = await fetch('/api/npcs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: picked.bookId, ...baseBody }),
      })
      const data = await res.json() as { id?: string; name?: string; portrait_url?: string; fullbody_gray_url?: string; fullbody_back_url?: string; error?: unknown }
      if (!res.ok || !data.id) {
        // Sérialisation robuste : data.error peut être string OU objet (Supabase
        // renvoie souvent { error: { code, message, details } } directement).
        const errStr = typeof data.error === 'string'
          ? data.error
          : data.error
            ? JSON.stringify(data.error)
            : `POST /api/npcs HTTP ${res.status}`
        throw new Error(errStr)
      }
      // Push immédiat dans le store local pour feedback (sans refresh).
      // Le useEffect d'hydratation NPCs se synchronisera au prochain reload.
      setStoreCharacters([
        ...storeCharacters,
        {
          id: data.id,
          name: data.name ?? payload.name,
          portraitUrl: data.portrait_url ?? payload.portraitUrl,
          fullbodyUrl: data.fullbody_gray_url ?? payload.fullbodyUrl,
          fullbodyBackUrl: data.fullbody_back_url ?? payload.fullbodyBackUrl ?? null,
          gender: payload.gender,
          voice_id: payload.voiceId ?? undefined,
          prompt: payload.prompt ?? undefined,
          createdAt: Date.now(),
        },
      ])
      return data.id
    }
  }, [picked.bookId, storeCharacters, setStoreCharacters])

  /** Handler "Animer cette scène" (refonte 2026-05-09).
   *  Crée un nouveau plan animation dans la section courante avec la scène
   *  flattenée comme image de base, puis navigue vers l'AnimationStudio.
   *  L'auteur peut alors créer ses pellicules LTX qui partiront de cette
   *  composition (= compositing CSS + Kontext refine déjà bakés). */
  const handleCreateAndOpenAnimationPlan = useCallback(async () => {
    if (!picked.sectionId) {
      alert('Section requise pour créer un plan animation.')
      return
    }
    if (!currentImageUrl) {
      alert('Aucune image de base — génère ou charge une scène d\'abord.')
      return
    }
    setBakeStatus({
      startedAt: Date.now(),
      kind: 'sam_cut',
      phase: 'Création du plan animation…',
      estimatedTotalSec: 5,
    })
    try {
      // 1. Flatten la scène (base + tous les calques placés / extractions /
      //    perso intégrés) pour avoir UNE image qui contient tout ce que
      //    l'auteur voit dans le canvas.
      const flatUrl = await flattenLayersToImage({
        baseImageUrl: currentImageUrl,
        layers: currentLayers,
        storagePathPrefix: `studio/anim_plan_base/${Date.now()}`,
        skipFirstLayerAsBase: true,
      })
      // 2. Snapshot des positions perso pour l'AnimationStudio (refonte
      //    2026-05-10 — fix LTX confond les persos).
      //    On extrait uniquement les calques perso drag-droppés (= ceux avec
      //    character_id + placement) et on stocke leur position spatiale
      //    left/center/right (computed depuis placement.x). L'AnimationStudio
      //    utilisera ça pour suffixer le prompt Vantage avec "on the X side"
      //    au moment du gen → ancrage déterministe sans appel AI.
      const characterPlacements = currentLayers
        .filter(l => l.character_id && l.placement)
        .map(l => {
          const x = l.placement!.x
          // x = top-left corner. Threshold sur tiers du canvas.
          const position: 'left' | 'center' | 'right' =
            x < 0.33 ? 'left' : x < 0.66 ? 'center' : 'right'
          return { character_id: l.character_id!, position }
        })

      // 3. Lazy-create V2 (refonte 2026-05-13) : pas de POST /api/plans legacy.
      //    On push directement vers AnimationStudio en mode DRAFT avec un
      //    UUID local + l'image flat pré-cochée en firstFrameUrl. L'asset
      //    animation + le bloc timeline ne seront créés qu'à la première
      //    génération vidéo (= effet auto-commit AnimationStudio).
      const draftId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const params = new URLSearchParams({
        draftAssetId: draftId,
        draftKind: 'animation',
        sectionId: picked.sectionId,
        returnSectionId: picked.sectionId,
        firstFrameUrl: flatUrl,
      })
      if (characterPlacements.length > 0) {
        params.set('characterPlacements', JSON.stringify(characterPlacements))
      }
      router.push(`/editor-test/animation-studio?${params.toString()}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[create-anim-plan]', msg)
      alert(`Création du plan animation échouée : ${msg}`)
    } finally {
      setBakeStatus(null)
    }
  }, [picked.sectionId, currentImageUrl, currentLayers, setBakeStatus, router])

  /** Handler "Créer un personnage depuis l'extraction" — refonte 2026-05-12
   *  (interpose routeur). Au clic sur le bouton du drawer Découper, on ouvre
   *  désormais CharacterAttachmentRouterModal qui demande "nouveau perso" OU
   *  "attacher à un existant". L'ancienne logique compose-and-open est
   *  déplacée dans `proceedToCreateNewCharacterFromExtraction` ci-dessous,
   *  branché sur la card "Créer nouveau" du routeur. */
  const handleCreateCharacterFromExtraction = useCallback((extractionUrl: string) => {
    setAttachRouterExtractionUrl(extractionUrl)
    setAttachRouterOpen(true)
  }, [])

  /** Étape "Créer nouveau" du routeur — ancien contenu du flow direct.
   *  Détecte Portrait vs Plein pied via la BBOX du sujet, compose sur fond gris
   *  #808080 (convention Hero IPAdapter/FaceID/Kontext) puis ouvre
   *  CharacterCreatorModal. */
  const proceedToCreateNewCharacterFromExtraction = useCallback(async (extractionUrl: string) => {
    const ts = Date.now()
    try {
      const kind = await detectImageKind(extractionUrl)
      if (kind === 'fullbody') {
        const [fullbodyGray, portraitGray] = await Promise.all([
          composeFullbodyOnGray(extractionUrl, `${STORAGE_PREFIX}_extracted_char/${ts}_fullbody_gray.png`),
          composePortraitFromExtraction(extractionUrl, `${STORAGE_PREFIX}_extracted_char/${ts}_portrait_gray.png`),
        ])
        setExtractFullbodyUrl(fullbodyGray ?? extractionUrl)
        setExtractPortraitUrl(portraitGray)
      } else {
        const portraitGray = await composeFullbodyOnGray(
          extractionUrl,
          `${STORAGE_PREFIX}_extracted_char/${ts}_portrait_gray.png`,
        )
        setExtractPortraitUrl(portraitGray ?? extractionUrl)
        setExtractFullbodyUrl(null)
      }
      setExtractCreatorOpen(true)
    } catch (err) {
      console.warn('[create-char-from-extract] analyse échouée, fallback brut :', err)
      setExtractPortraitUrl(extractionUrl)
      setExtractFullbodyUrl(null)
      setExtractCreatorOpen(true)
    }
  }, [STORAGE_PREFIX])

  /** Étape "Attacher à perso existant" du routeur. Compose l'image sur fond
   *  gris selon le slot demandé, PATCH /api/npcs/[id], et met à jour le store
   *  local pour feedback immédiat. Refonte 2026-05-12. */
  const handleAttachExtractionToCharacter = useCallback(async (
    charId: string,
    slot: import('@/components/image-editor/designer/CharacterAttachmentRouterModal').CharacterAttachmentSlot,
    extractionUrl: string,
  ) => {
    const ts = Date.now()
    const existing = storeCharacters.find(c => c.id === charId)
    if (!existing) throw new Error('Personnage introuvable')

    // 1. Compose sur fond gris selon slot. Portrait = top 45% bbox ; tous les
    //    autres slots = fullbody complet sur fond gris (1024×1024). C'est le
    //    plus simple — on garde le format de référence Hero.
    const path = `${STORAGE_PREFIX}_extracted_char/${ts}_${slot}_gray.png`
    const composedUrl = slot === 'portrait'
      ? await composePortraitFromExtraction(extractionUrl, path)
      : await composeFullbodyOnGray(extractionUrl, path)
    const finalUrl = composedUrl ?? extractionUrl

    // 2. Calcule le patch Character + payload API selon slot.
    //    - portrait / fullbody_face : champs top-level.
    //    - vues alternatives / variante : entrée dans images[] avec kind.
    const slotToKind: Record<string, 'view_back' | 'view_profile_left' | 'view_profile_right' | 'variant'> = {
      view_back: 'view_back',
      view_profile_left: 'view_profile_left',
      view_profile_right: 'view_profile_right',
      variant: 'variant',
    }
    const slotLabels: Record<string, string> = {
      view_back: 'Vue de dos',
      view_profile_left: 'Profil gauche',
      view_profile_right: 'Profil droit',
      variant: `Variante ${new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    }
    const nextImages = [...(existing.images ?? [])]
    let portraitUrlPatch = existing.portraitUrl
    let fullbodyUrlPatch = existing.fullbodyUrl

    if (slot === 'portrait') {
      portraitUrlPatch = finalUrl
    } else if (slot === 'fullbody_face') {
      fullbodyUrlPatch = finalUrl
    } else {
      const kind = slotToKind[slot]
      const newEntry = {
        id: crypto.randomUUID(),
        url: finalUrl,
        label: slotLabels[slot] ?? 'Vue',
        source: 'extraction' as const,
        kind,
      }
      if (kind === 'variant') {
        // Toujours en ajout (peut y en avoir N)
        nextImages.push(newEntry)
      } else {
        // 1 slot par kind canonique : remplace l'existant
        const idx = nextImages.findIndex(im => im.kind === kind)
        if (idx >= 0) nextImages[idx] = newEntry
        else nextImages.push(newEntry)
      }
    }

    // 3. PATCH /api/npcs/[id] avec les nouveaux champs uniquement (les autres
    //    sont conservés tels quels par la route si on les laisse undefined ?
    //    Non : la route attend body complet baseBody, on doit donc envoyer
    //    tout. On envoie le merge sécurisé portrait_url / fullbody_gray_url
    //    / images.
    const patchBody = {
      portrait_url: portraitUrlPatch,
      fullbody_gray_url: fullbodyUrlPatch,
      images: nextImages,
    }
    const res = await fetch(`/api/npcs/${charId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    })
    const data = await res.json() as { error?: string }
    if (!res.ok) throw new Error(data.error ?? `PATCH /api/npcs HTTP ${res.status}`)

    // 4. Update store local pour feedback immédiat.
    updateStoreCharacter(charId, {
      portraitUrl: portraitUrlPatch,
      fullbodyUrl: fullbodyUrlPatch,
      images: nextImages,
    })

    setSavedToastVisible(true)
  }, [storeCharacters, updateStoreCharacter, STORAGE_PREFIX])

  const handleSelectVariant = useCallback((v: DesignerVariant) => {
    setSelectedVariantId(v.id)
    if (v.url) replaceBase(v.url)
  }, [replaceBase])

  const handleToggleReference = useCallback((variantId: string) => {
    setVariants(prev => prev.map(v => ({
      ...v,
      isReference: v.id === variantId ? !v.isReference : false,
    })))
  }, [])

  const handleDeleteVariant = useCallback((variantId: string) => {
    setVariants(prev => prev.filter(v => v.id !== variantId))
    if (selectedVariantId === variantId) {
      setSelectedVariantId(null)
      replaceBase(null)
    }
  }, [selectedVariantId, replaceBase])

  // ── Sync génération → variants ───────────────────────────────────────
  // Quand un statut devient `done` avec une URL, on l'ajoute à la liste des
  // variants (s'il n'y est pas déjà). Auto-select de la première terminée
  // si aucune image n'est encore sélectionnée.
  useEffect(() => {
    if (genStatuses.length === 0) return
    let firstDoneToAutoSelect: { id: string; url: string } | null = null
    setVariants(prev => {
      let next = prev
      for (const s of genStatuses) {
        if (s.stage !== 'done' || !s.url) continue
        if (next.some(v => v.url === s.url)) continue
        const newVariant = variantFromGenerationStatus(s)
        next = [newVariant, ...next]
        if (!firstDoneToAutoSelect) firstDoneToAutoSelect = { id: newVariant.id, url: s.url }
      }
      return next
    })
    // TS narrow l'`if (firstDoneToAutoSelect)` à `never` parce qu'il ne suit pas
    // l'assignation faite dans le callback setVariants (closure). On caste pour
    // force-widen et accéder aux champs sans erreur.
    const picked = firstDoneToAutoSelect as { id: string; url: string } | null
    if (picked && !currentImageUrl) {
      setSelectedVariantId(picked.id)
      replaceBase(picked.url)
    }
  }, [genStatuses, currentImageUrl, replaceBase])

  // Handler appelé par GenerationPanel — délègue au hook tel quel
  // (storagePathPrefix est déjà dans req via la prop du panel).
  const handleGenerate = useCallback(async (req: Parameters<typeof startGeneration>[0]) => {
    console.log('[new-layout] handleGenerate req:', {
      style: req.style,
      type: req.type,
      format: req.format,
      framing: req.framing,
      pov: req.pov,
      modelKeys: req.modelKeys,
      promptFr: req.promptFr.slice(0, 80) + '...',
    })
    await startGeneration(req)
  }, [startGeneration])

  /** Bouton "Commencer l'édition" : passe en Phase B + sauvegarde DB.
   *
   *  Lazy-create 2026-05-13 — branche DRAFT (priorité) : si on est arrivé via
   *  ?draftAssetId=<uuid local>, c'est ICI qu'on commit en DB l'asset_image +
   *  son bloc section_timeline. Puis router.replace en ?assetId=<vrai-id> pour
   *  basculer en mode normal V2 (auto-save PATCH). */
  const handleCommencer = useCallback(() => {
    setPhase('editing')
    if (!currentImageUrl) return
    const draftAssetId = (picked as PickedPlan & { _draftAssetId?: string })._draftAssetId
    ;(async () => {
      // ── DRAFT V2 lazy-create : POST asset + POST timeline + replace URL ──
      if (draftAssetId) {
        try {
          if (!picked.bookId || !picked.sectionId) {
            console.error('[Commencer DRAFT] bookId/sectionId manquants — abort')
            return
          }
          const assetRes = await fetch('/api/assets/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: draftAssetId,  // commit avec le draftId local → URL stable
              url: currentImageUrl,
              source_type: 'generated',
              layers: currentLayers,  // V2 fix 2026-05-14 : commit aussi les calques
              bookId: picked.bookId,
              sectionId: picked.sectionId,
            }),
          })
          if (!assetRes.ok) {
            const errBody = await assetRes.json().catch(() => ({})) as { error?: string }
            throw new Error(errBody.error ?? `POST asset HTTP ${assetRes.status}`)
          }
          const { asset } = await assetRes.json() as { asset: { id: string } }

          const blockRes = await fetch(`/api/sections/${picked.sectionId}/timeline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              track: 'video_image',
              asset_type: 'image',
              asset_id: asset.id,
              duration_ms: 3000,
            }),
          })
          if (!blockRes.ok) {
            const errBody = await blockRes.json().catch(() => ({})) as { error?: string }
            throw new Error(errBody.error ?? `POST timeline HTTP ${blockRes.status}`)
          }

          // Bascule en mode normal V2 — l'auto-save reprend en PATCH.
          const newParams = new URLSearchParams({
            assetId: asset.id,
            sectionId: picked.sectionId,
            returnSectionId: picked.sectionId,
          })
          router.replace(`/editor-test/new-layout?${newParams.toString()}`)
          console.log('[Commencer DRAFT] committed asset:', asset.id)
        } catch (err) {
          console.error('[Commencer DRAFT] commit failed:', err)
          alert(`Sauvegarde échouée : ${err instanceof Error ? err.message : String(err)}`)
        }
        return
      }

      // ── LEGACY : update section.images JSONB (chemin pré-V2 conservé) ────
      try {
        const isAnimation = animationPellicules.length > 0 || !!currentVideoUrl
        const lastGenerated = [...animationPellicules].reverse().find(p => p.videoUrl)
        await fetch(`/api/sections/${picked.sectionId}/plans`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planIndex: picked.planIndex,
            url: currentImageUrl,
            kind: isAnimation ? 'animation' : 'image',
            base_video_url: isAnimation
              ? (lastGenerated?.videoUrl ?? currentVideoUrl ?? undefined)
              : undefined,
            first_frame_url: isAnimation
              ? (lastGenerated?.firstFrameUrl ?? currentVideoFirstFrameUrl ?? undefined)
              : undefined,
            last_frame_url: isAnimation
              ? (lastGenerated?.lastFrameUrl ?? currentVideoLastFrameUrl ?? undefined)
              : undefined,
            pellicules: animationPellicules.length > 0 ? animationPellicules : undefined,
            animation_selected_chars: animationSelectedCharIds.length > 0
              ? animationSelectedCharIds : undefined,
            tags: { characters: allPresentCharacterIds },
          }),
        })
        console.log('[Commencer] saved plan to DB:', picked.sectionId, picked.planIndex)
      } catch (err) {
        console.error('[Commencer] save failed:', err)
      }
    })()
  }, [
    currentImageUrl, picked, picked.sectionId, picked.planIndex, picked.bookId,
    allPresentCharacterIds,
    currentVideoUrl, currentVideoFirstFrameUrl, currentVideoLastFrameUrl,
    animationPellicules, animationSelectedCharIds, currentLayers,
    router,
  ])

  /** "Nouvelle base" en Phase B : reset et revient en Phase A.
   *  Supprime aussi l'analyse de scène (mask PNGs Supabase + ligne DB) pour
   *  l'image base courante — l'utilisateur repart de zéro (calques inclus). */
  const handleNouvelleBase = useCallback(async () => {
    if (!confirm('Refaire la base ? Les calques de l\'ancienne base seront supprimés (Ctrl+Z pour annuler).')) return

    // Supprime les anciennes découpes côté backend (masks PNG + row scene_analyses)
    if (currentImageUrl) {
      try {
        const res = await fetch('/api/comfyui/analyze-scene', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: currentImageUrl }),
        })
        const data = await res.json().catch(() => ({}))
        console.log('[Nouvelle base] cleanup analysis :', data)
      } catch (err) {
        console.warn('[Nouvelle base] cleanup failed:', err)
      }
    }

    // Reset state client (replaceBase fait déjà clearSceneAnalysis + reset layers,
    // mais on garde le clear explicite pour rester safe si replaceBase évolue).
    clearSceneAnalysis()
    setPhase('creation')
    setVariants([])
    setSelectedVariantId(null)
    replaceBase(null)
  }, [currentImageUrl, replaceBase, clearSceneAnalysis])

  const pickedBankId = useMemo(() => {
    if (!selectedVariantId) return null
    const v = variants.find(x => x.id === selectedVariantId)
    return v && v.source.kind === 'bank' ? v.source.bankId : null
  }, [selectedVariantId, variants])

  const commencerEnabled = useMemo(() => {
    const v = variants.find(x => x.id === selectedVariantId)
    return !!v && !!v.url
  }, [variants, selectedVariantId])

  // Toast discret de confirmation Ctrl+S — rendu via portal pattern (overlay
  // fixed, hors flow normal donc pas besoin de wrapper fragment).
  const savedToast = savedToastVisible ? (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(16, 185, 129, 0.95)',  // emerald-500
        color: '#fff',
        padding: '10px 18px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      ✓ Sauvegardé
    </div>
  ) : null

  // ── Refonte Objet 2026-05-12 — items de la section + badge rail ────────
  // Filtre le book.items par sections_used pour obtenir les objets attachés
  // à la section courante. Le badge X/Y se calcule dessus :
  //   Y = total items de la section
  //   X = items "positionnés sur l'image courante" (V1 = 0, sera calculé
  //       depuis SectionImage.positioned_items quand step 6+ sera fait)
  const sectionItemsList = useMemo(() => {
    return items
      .filter(it => Array.isArray(it.sections_used) && it.sections_used.includes(picked.sectionId))
      .map(it => ({
        id: it.id,
        name: it.name,
        illustration_url: it.illustration_url ?? null,
        description: it.description ?? null,
        item_type: it.item_type ?? 'outil',
        category: it.category,
      }))
  }, [items, picked.sectionId])

  const railBadges = useMemo(() => {
    if (sectionItemsList.length === 0) return undefined
    return {
      objects: { positioned: 0, total: sectionItemsList.length },
    }
  }, [sectionItemsList])

  // ── ItemCreatorModal state (refonte Objet 2026-05-12) ──────────────────
  // Ouvert depuis CatalogObjects v2 (bouton "+ Nouveau" → mode création,
  // crayon sur tile → mode édition). Au save, on patch ou push dans `items`
  // pour rafraîchir le panel sans re-fetch.
  const [itemEditorOpen, setItemEditorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ItemFormData | null>(null)

  const handleCreateItem = useCallback(() => {
    // Pré-remplit sections_used avec la section courante pour qu'à la
    // création le nouvel item apparaisse direct dans le panel de cette
    // section.
    setEditingItem({
      id: 'new',
      name: '',
      item_type: 'outil',
      category: 'consommable',
      sections_used: [picked.sectionId],
    })
    setItemEditorOpen(true)
  }, [picked.sectionId])

  const handleEditItem = useCallback((item: { id: string; name: string; illustration_url: string | null; description: string | null; item_type: string; category?: string }) => {
    // Lookup l'item complet dans la liste items pour récupérer tous les
    // champs (effect, quantity, etc.) — la tile ne contient qu'un sous-ensemble.
    const fullItem = items.find(i => i.id === item.id)
    if (!fullItem) {
      alert('Item introuvable')
      return
    }
    setEditingItem({
      id: fullItem.id,
      name: fullItem.name,
      item_type: (fullItem.item_type ?? 'outil') as ItemFormData['item_type'],
      category: ((fullItem.category as ItemFormData['category']) ?? 'consommable'),
      weapon_type: fullItem.weapon_type ?? null,
      description: fullItem.description ?? null,
      illustration_url: fullItem.illustration_url ?? null,
      detail_url: fullItem.detail_url ?? null,
      effect: fullItem.effect ?? {},
      quantity: fullItem.quantity ?? 1,
      auto_pickup: !!fullItem.auto_pickup,
      sections_used: fullItem.sections_used ?? [],
    })
    setItemEditorOpen(true)
  }, [items])

  // ── État du modal toolbar Insérer un objet (refonte 2026-05-12) ──────
  const [addObjectModalOpen, setAddObjectModalOpen] = useState(false)
  const [toast, setToast] = useState<HeroToastValue | null>(null)

  // Orchestrateur pour le modal toolbar (3 modes).
  const handleConfirmAddObject = useCallback(async (params: {
    description: string
    location: string
    mode: AddObjectMode
    existingItemId?: string
  }) => {
    if (!currentImageUrl) {
      setToast({ message: 'Aucune scène active', kind: 'error' })
      return
    }
    if (!planIdForPersist) return

    const { description, location, mode, existingItemId } = params

    // Nom de l'objet pour le prompt Qwen + (si new) nom du nouvel item.
    const itemName = mode === 'existing' && existingItemId
      ? items.find(i => i.id === existingItemId)?.name ?? 'objet'
      : description.split(/\s+/).slice(0, 5).join(' ').slice(0, 60) || 'objet'

    const qwenPrompt = `Ajoute ${itemName}, ${description}, ${location}`

    setBakeStatus({
      startedAt: Date.now(),
      phase: `Qwen Edit — insertion de "${itemName}"…`,
      kind: 'qwen_edit',
      estimatedTotalSec: 60,
    })
    try {
      // 1. Qwen Edit (toujours)
      const compositeUrl = await runQwenImageEdit({
        sourceUrl: currentImageUrl,
        prompt: qwenPrompt,
        storagePathPrefix: `${STORAGE_PREFIX}_objet_toolbar/${Date.now()}`,
        useLightning: true,
        onProgress: p => setBakeStatus({
          startedAt: Date.now(),
          phase: p.label ?? p.stage,
          kind: 'qwen_edit',
          estimatedTotalSec: 60,
        }),
      })
      setImageUrl(compositeUrl)

      // 2. Mode-specific side effects
      let resolvedItemId: string | null = null
      if (mode === 'existing' && existingItemId) {
        resolvedItemId = existingItemId
      } else if (mode === 'new') {
        // Crée l'item via POST avec nom dérivé de la description
        try {
          const res = await fetch(`/api/books/${picked.bookId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: itemName,
              description,
              item_type: 'outil',
              category: 'consommable',
              sections_used: [picked.sectionId],
            }),
          })
          const data = await res.json() as { item?: { id: string; name: string; sections_used?: string[] } }
          if (data.item) {
            resolvedItemId = data.item.id
            // Reflète dans le state local
            setItems(prev => [
              ...prev,
              {
                id: data.item!.id,
                book_id: picked.bookId,
                name: data.item!.name,
                item_type: 'outil',
                category: 'consommable',
                description,
                sections_used: data.item!.sections_used ?? [picked.sectionId],
                illustration_url: null,
                effect: {},
                quantity: 1,
                auto_pickup: false,
              } as Item,
            ])
          }
        } catch (err) {
          console.warn('[add-object-toolbar] POST item failed:', err)
        }
      }
      // mode 'noitem' : pas d'item, pas de positioned_items

      // 3. positioned_items entry si on a un item lié
      if (resolvedItemId) {
        const approxBboxSize = 0.25
        const newEntry = {
          item_id: resolvedItemId,
          position: { x: 0.5, y: 0.7 },  // approximatif (pas de drop point)
          scale: 1,
          layer_id: '',
          click_bounds: {
            x: 0.5 - approxBboxSize / 2,
            y: 0.7 - approxBboxSize / 2,
            w: approxBboxSize,
            h: approxBboxSize,
          },
        }
        try {
          const planRes = await fetch(`/api/plans/${planIdForPersist}`)
          const planData = await planRes.json() as { data?: Record<string, unknown> }
          const existing = ((planData.data?.positioned_items as typeof newEntry[]) ?? [])
          await fetch(`/api/plans/${planIdForPersist}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: { ...(planData.data ?? {}), positioned_items: [...existing, newEntry] },
            }),
          })
        } catch (err) {
          console.warn('[add-object-toolbar] persist positioned_items failed:', err)
        }
      }

      setToast({
        message: mode === 'noitem'
          ? 'Objet inséré dans la scène'
          : mode === 'new'
            ? `Objet "${itemName}" créé et inséré`
            : `Objet inséré et lié à "${itemName}"`,
        kind: 'success',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[add-object-toolbar] pipeline failed:', err)
      setToast({ message: `Insertion échouée : ${msg}`, kind: 'error' })
    } finally {
      setBakeStatus(null)
    }
  }, [currentImageUrl, planIdForPersist, items, picked.bookId, picked.sectionId, STORAGE_PREFIX, setImageUrl, setBakeStatus])

  // ── Étape 1 : drag-drop d'une tile Objet ouvre DropPromptModal ───────
  // Refonte 2026-05-12 — l'auteur affine la position (et la description si
  // l'objet n'a pas d'image) avant que la pipeline se lance.
  const [dropContext, setDropContext] = useState<{
    itemId: string
    dropX: number
    dropY: number
  } | null>(null)

  const handleDropItem = useCallback((itemId: string, dropX: number, dropY: number) => {
    const item = items.find(i => i.id === itemId)
    if (!item) {
      console.warn('[Designer] dropped item not found:', itemId)
      return
    }
    if (!currentImageUrl) {
      alert('Aucune scène active — choisis d\'abord une variante.')
      return
    }
    if (!planIdForPersist) {
      alert('Plan non persisté — relance depuis Studio Section.')
      return
    }
    setDropContext({ itemId, dropX, dropY })
  }, [items, currentImageUrl, planIdForPersist])

  // ── Étape 2 : confirmation du modal → pipeline Qwen Edit (flux "ballon")
  //    Décision 2026-05-12 : on utilise TOUJOURS Qwen Edit, peu importe que
  //    l'objet ait une illustration_url ou non. Kontext multi-image parqué
  //    (résultat trop bizarre vs Qwen qui blend mieux). À re-tester plus tard.
  //    Pipeline :
  //    1. Build prompt FR : "Ajoute {item.name}, {description}, {position}"
  //    2. runQwenImageEdit (Lightning ~30-60s)
  //    3. extractCharacterByDiff → PNG transparent (avec largest-blob cleanup)
  //    4. computeAlphaBounds → click_bounds pour runtime
  //    5. addLayer + push positioned_items + PATCH plan.data
  const handleConfirmDrop = useCallback(async (positionPrompt: string, description: string | null) => {
    if (!dropContext) return
    const { itemId, dropX, dropY } = dropContext
    setDropContext(null)  // ferme le modal

    const item = items.find(i => i.id === itemId)
    if (!item || !currentImageUrl || !planIdForPersist) return

    const cleanBgUrl = currentImageUrl

    // Build le prompt FR pour Qwen Edit (multilingue). On enrichit avec :
    //   - le nom de l'objet
    //   - la description (depuis modal OU fiche existante) si dispo
    //   - le placement (zone + précision auteur)
    const effectiveDescription = description ?? item.description ?? null
    const descPart = effectiveDescription ? `, ${effectiveDescription}` : ''
    const qwenPrompt = `Ajoute ${item.name}${descPart}, ${positionPrompt}`

    setBakeStatus({
      startedAt: Date.now(),
      phase: `Qwen Edit — ajout de "${item.name}"…`,
      kind: 'qwen_edit',
      estimatedTotalSec: 60,
    })

    try {
      // 1. Qwen Edit ADD → composite avec l'objet (et drift global de Qwen)
      setBakeStatus({
        startedAt: Date.now(),
        phase: `Qwen Edit ADD — insertion de "${item.name}"…`,
        kind: 'qwen_edit',
        estimatedTotalSec: 120,
      })
      const compositeUrl = await runQwenImageEdit({
        sourceUrl: cleanBgUrl,
        prompt: qwenPrompt,
        storagePathPrefix: `${STORAGE_PREFIX}_objects/${itemId}/composite_add`,
        useLightning: true,
        onProgress: p => setBakeStatus({
          startedAt: Date.now(),
          phase: `ADD : ${p.label ?? p.stage}`,
          kind: 'qwen_edit',
          estimatedTotalSec: 120,
        }),
      })

      // 1bis. Qwen Edit REMOVE sur le composite → scène sans l'objet mais
      //       AVEC le même drift Qwen partout (= "clean BG" pour le diff).
      //       Décision 2026-05-12 : on réplique le 3-pass validé pour les persos
      //       (composite + remove + diff) afin que le drift global s'annule
      //       dans la diff et seul l'objet ressorte comme calque transparent.
      // Décision 2026-05-12 (solution simple) : plus d'extraction de calque
      // transparent. Le composite remplace direct la base. Trade-off : on
      // perd la séparabilité du calque (toggle visibilité, drag-reposition),
      // mais on gagne en simplicité + le drift Qwen est figé dans la scène
      // = visuellement cohérent au lieu d'avoir un calque imparfait.
      setImageUrl(compositeUrl)

      // Si l'auteur a fourni une description (modal), on la sauve dans la
      // fiche pour la prochaine fois (pas de regen d'image, juste enrichir).
      if (description && !item.description) {
        await fetch(`/api/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
        }).catch(err => console.warn('[Designer] PATCH item description failed:', err))
        setItems(prev => prev.map(i => i.id === itemId
          ? { ...i, description }
          : i))
      }

      // Persist positioned_items dans plan.data — sert au runtime cliquable.
      // Bbox approximatif autour du drop point (20% de la dim — ajustable
      // par l'auteur plus tard). Pas de layer_id puisqu'il n'y a plus de
      // calque séparé.
      const approxBboxSize = 0.2
      const newEntry = {
        item_id: itemId,
        position: { x: dropX, y: dropY },
        scale: 1,
        layer_id: '',  // pas de calque séparé en V1 simple
        click_bounds: {
          x: Math.max(0, dropX - approxBboxSize / 2),
          y: Math.max(0, dropY - approxBboxSize / 2),
          w: approxBboxSize,
          h: approxBboxSize,
        },
      }
      try {
        const planRes = await fetch(`/api/plans/${planIdForPersist}`)
        const planData = await planRes.json() as { data?: Record<string, unknown> }
        const existing = ((planData.data?.positioned_items as typeof newEntry[]) ?? [])
        const merged = [...existing, newEntry]
        await fetch(`/api/plans/${planIdForPersist}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { ...(planData.data ?? {}), positioned_items: merged } }),
        })
      } catch (err) {
        console.error('[Designer] persist positioned_items failed:', err)
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Designer] drop item pipeline failed:', err)
      alert(`Insertion d'objet échouée : ${msg}`)
    } finally {
      setBakeStatus(null)
    }
  }, [dropContext, items, currentImageUrl, planIdForPersist, STORAGE_PREFIX, setImageUrl, setBakeStatus])

  // ── Bake / Régénérer un calque-objet (refonte 2026-05-12 steps 11+12) ─
  // État busy partagé pour disable les boutons pendant qu'une action tourne.
  const [itemLayerBusy, setItemLayerBusy] = useState<'bake' | 'regen' | null>(null)
  const [itemLayerBusyLabel, setItemLayerBusyLabel] = useState('')

  /** Bake (step 11) : flatten le calque-objet dans la base + sauve son PNG
   *  transparent dans items.illustration_url. Remove le calque ensuite. */
  const handleBakeItemLayer = useCallback(async () => {
    const layer = currentLayers[activeLayerIdx]
    if (!layer || !layer.item_id || !layer.media_url) return
    if (!currentImageUrl) {
      alert('Aucune base active.')
      return
    }
    if (!planIdForPersist) {
      alert('Plan non persisté.')
      return
    }
    const itemId = layer.item_id
    setItemLayerBusy('bake')
    setItemLayerBusyLabel('Sauvegarde de l\'identité…')
    try {
      // 1. PATCH item avec illustration_url = le PNG transparent du calque.
      //    Si l'item avait déjà une image, on l'écrase (= "mise à jour").
      const patchRes = await fetch(`/api/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ illustration_url: layer.media_url }),
      })
      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? 'PATCH item failed')
      }
      // Reflète dans le state local pour que le panel se mette à jour
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, illustration_url: layer.media_url ?? null } : i))

      // 2. Flatten base + ce calque uniquement → nouvelle base
      setItemLayerBusyLabel('Aplatissement…')
      const newBaseUrl = await flattenLayersToImage({
        baseImageUrl: currentImageUrl,
        layers: [layer],
        skipFirstLayerAsBase: false,
        storagePathPrefix: `${STORAGE_PREFIX}_objects/${itemId}/baked`,
      })
      // ⚠ setImageUrl (pas replaceBase !) — replaceBase fait un cascade delete
      // des calques. On veut juste remplacer le visuel de la base SANS toucher
      // aux autres calques (autres objets/persos posés sur la scène).
      setImageUrl(newBaseUrl)

      // 3. Remove le calque-objet (l'objet est maintenant baked dans la base).
      //    Les autres calques sont préservés.
      removeLayer(activeLayerIdx)

      // 4. PATCH plan : marque positioned_items[i].baked = true (lookup par
      //    layer_id qui = l'URL du PNG)
      try {
        const planRes = await fetch(`/api/plans/${planIdForPersist}`)
        const planData = await planRes.json() as { data?: Record<string, unknown> }
        const existing = ((planData.data?.positioned_items as Array<{
          item_id: string; layer_id: string; baked?: boolean
        }>) ?? [])
        const updated = existing.map(e =>
          e.layer_id === layer.media_url ? { ...e, baked: true } : e
        )
        await fetch(`/api/plans/${planIdForPersist}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { ...(planData.data ?? {}), positioned_items: updated } }),
        })
      } catch (err) {
        console.warn('[Designer] persist baked flag failed:', err)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Bake échoué : ${msg}`)
    } finally {
      setItemLayerBusy(null)
      setItemLayerBusyLabel('')
    }
  }, [currentLayers, activeLayerIdx, currentImageUrl, planIdForPersist, STORAGE_PREFIX, setImageUrl, removeLayer])

  /** Régénérer ici (step 12) : re-Kontext multi-image avec la position
   *  stockée dans positioned_items. Adapte ombres/lumière. */
  const handleRegenerateItemLayer = useCallback(async () => {
    const layer = currentLayers[activeLayerIdx]
    if (!layer || !layer.item_id || !layer.media_url) return
    if (!currentImageUrl) {
      alert('Aucune base active.')
      return
    }
    if (!planIdForPersist) {
      alert('Plan non persisté.')
      return
    }
    const itemId = layer.item_id
    const item = items.find(i => i.id === itemId)
    if (!item) {
      alert('Item introuvable.')
      return
    }

    setItemLayerBusy('regen')
    setItemLayerBusyLabel('Lecture de la position…')
    try {
      // 1. Récupère position depuis positioned_items
      const planRes = await fetch(`/api/plans/${planIdForPersist}`)
      const planData = await planRes.json() as { data?: Record<string, unknown> }
      const existing = ((planData.data?.positioned_items as Array<{
        item_id: string; layer_id: string; position: { x: number; y: number }
      }>) ?? [])
      const entry = existing.find(e => e.layer_id === layer.media_url)
      if (!entry) {
        throw new Error('Entrée positioned_items introuvable pour ce calque.')
      }
      const { x, y } = entry.position
      const zoneEn = zoneLabelEn(positionToZone(x, y))

      // 2. Re-Kontext avec ref item — note : on utilise illustration_url
      //    actuelle (peut être différente de la précédente si l'auteur a
      //    fait un bake entre-temps).
      if (!item.illustration_url) {
        throw new Error('Item sans illustration_url — bake d\'abord pour fixer l\'identité.')
      }
      setItemLayerBusyLabel('Régénération via Kontext…')
      const compositeUrl = await runFluxKontext({
        sourceUrl: currentImageUrl,
        refUrl: item.illustration_url,
        prompt: `place the ${item.name} from the second image ${zoneEn} of the first image, sized appropriately, matching the scene lighting and perspective`,
        storagePathPrefix: `${STORAGE_PREFIX}_objects/${itemId}/regen`,
        guidance: 2.5,
        steps: 20,
        onProgress: p => setItemLayerBusyLabel(p.label ?? p.stage),
      })

      // 3. Image-diff pour le nouveau PNG transparent
      setItemLayerBusyLabel('Extraction du calque…')
      const newLayerUrl = await extractCharacterByDiff({
        compositeUrl,
        cleanBgUrl: currentImageUrl,
        storagePathPrefix: `${STORAGE_PREFIX}_objects/${itemId}/regen_layer`,
      })

      // 4. Recalcule click_bounds
      let clickBounds = entry && (entry as typeof entry & { click_bounds?: { x: number; y: number; w: number; h: number } }).click_bounds
        ? (entry as typeof entry & { click_bounds: { x: number; y: number; w: number; h: number } }).click_bounds
        : { x: 0, y: 0, w: 1, h: 1 }
      try {
        const bounds = await computeAlphaBounds({ imageUrl: newLayerUrl })
        if (bounds) clickBounds = bounds
      } catch (err) {
        console.warn('[Designer] alpha bounds compute failed on regen, fallback ancien bbox:', err)
      }

      // 5. Update calque (nouveau media_url) + entry positioned_items (layer_id + bbox)
      updateLayer(activeLayerIdx, { media_url: newLayerUrl })
      const updated = existing.map(e =>
        e.layer_id === layer.media_url
          ? { ...e, layer_id: newLayerUrl, click_bounds: clickBounds }
          : e
      )
      await fetch(`/api/plans/${planIdForPersist}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...(planData.data ?? {}), positioned_items: updated } }),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Régénération échouée : ${msg}`)
    } finally {
      setItemLayerBusy(null)
      setItemLayerBusyLabel('')
    }
  }, [currentLayers, activeLayerIdx, currentImageUrl, planIdForPersist, items, STORAGE_PREFIX, updateLayer])

  const handleItemSaved = useCallback((saved: ItemFormData & { id: string }) => {
    // Update / insert dans `items` state pour refresh immédiat du panel sans
    // re-fetch. Si id existait → patch, sinon push.
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === saved.id)
      const merged: Item = {
        ...(idx >= 0 ? prev[idx] : ({} as Item)),
        ...(saved as unknown as Item),
        book_id: picked.bookId,
      }
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = merged
        return next
      }
      return [...prev, merged]
    })
  }, [picked.bookId])

  return (
    <CharacterPersistProvider persist={persistCharacterToDb}>
    <ChoicePlanProvider
      isPlanChoice={isPlanChoice}
      initialChoiceData={initialChoiceData}
      sectionChoices={sectionChoices}
      onChange={handleChoiceDataChange}
    >
    <DesignerLayout
      phase={phase}
      // Catégorie active à l'ouverture : 'generate' pour les plans anim ou
      // choix-anim (= ouvre directement le catalog animation + drawer pellicules).
      // null sinon = comportement standard plan image fixe.
      initialActiveCategory={initialPersonnageMode === 'animate' ? 'generate' : null}
      sectionChoices={sectionChoices}
      sectionNumber={picked.sectionNumber}
      sectionItems={sectionItemsList}
      // Persos déclarés de la section (parsing "**Persos présents :** ..."
      // sur sectionContent, match exact case-insensitive sur npc.name). Drive
      // la section 2 du panneau Personnages du Designer.
      bookNpcs={npcs}
      bookId={picked.bookId}
      sectionCharacterIds={(() => {
        const m = sectionContent.match(/\*\*Persos pr[ée]sents\s*:\*\*\s*([^\n]+)/i)
        if (!m) return []
        const names = m[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
        return npcs
          .filter(n => names.includes(n.name.trim().toLowerCase()))
          .map(n => n.id)
      })()}
      railBadges={railBadges}
      onCreateItem={handleCreateItem}
      onEditItem={handleEditItem}
      onDropItem={handleDropItem}
      // Refonte 2026-05-12 : "Créer objet depuis découpe" du drawer Découper.
      // Ouvre ItemCreatorModal pré-rempli avec illustration_url = la découpe.
      onCreateItemFromExtraction={(cutImageUrl: string) => {
        setEditingItem({
          id: 'new',
          name: '',
          item_type: 'outil',
          category: 'consommable',
          sections_used: [picked.sectionId],
          illustration_url: cutImageUrl,
        })
        setItemEditorOpen(true)
      }}
      // Tous les items du livre pour le picker (avec flag section courante)
      allBookItems={items.map(it => ({
        id: it.id,
        name: it.name,
        illustration_url: it.illustration_url ?? null,
        sections_used: it.sections_used ?? [],
      }))}
      // Refresh state local après attachement réussi (sinon la panel des
      // tiles Objet garde l'ancienne miniature).
      onItemUpdatedAfterAttach={(itemId, patch) => {
        setItems(prev => prev.map(i => i.id === itemId
          ? { ...i, illustration_url: patch.illustration_url }
          : i))
      }}
      planTitle={`Scène test — ${scene.name}`}
      // planSummary = vrai résumé narratif (depuis sectionContent fetché dans
      // loadPlan). Affiché dans la zone Contexte du panneau IA Ctrl+K. Avant :
      // scene.id (= UUID plan brut, illisible). Refonte 2026-05-12.
      planSummary={sectionContent.split('\n').filter(Boolean)[0]?.slice(0, 240) || undefined}
      returnLabel={backLabel ?? '← Choisir une autre scène'}
      onReturn={onBack}
      onUndo={undo}
      onRedo={redo}
      canUndo={true}
      canRedo={true}
      theme={theme}
      onToggleTheme={onToggleTheme}
      storagePathPrefix={STORAGE_PREFIX}

      // Actions toolbar (Phase B uniquement) — N icônes principales avec
      // mutual exclusion : un seul drawer ouvert à la fois. Cliquer sur une
      // icône pendant qu'un autre drawer est ouvert ferme l'ancien et ouvre
      // le nouveau. Aujourd'hui : Découper + Personnage + Animer.
      // Refonte 2026-05-09 : si le calque actif est en mode 'extraction'
      // (= image chargée pour bosser sur extraction de perso/objet/zone),
      // on ne garde QUE Découper. Personnage et Animer n'ont pas de sens.
      actions={(currentLayers[activeLayerIdx]?.mode === 'extraction'
        ? ([
            'decoupe',
          ] as const)
        : (['decoupe', 'personnage', 'animer', 'recadrer', 'objet_add'] as const)
      ).map(id => {
        const allActions: DesignerAction[] = [
        {
          id: 'decoupe',
          label: 'Découper',
          icon: <Scissors size={18} />,
          opensCategory: 'edit',
          title: 'Découper — Smart visu / Baguette / Polygone / Lasso / Pinceau',
          subTools: [
            // Couleur signature par outil — distingue visuellement chacun et
            // donne du caractère à la palette. Tons saturés mais pas garish
            // (Tailwind 500-ish), complémentaires entre eux.
            { id: 'sam_prompt', label: 'Smart visu',      icon: <Sparkles size={16} />,   hint: 'clic IA sémantique', color: '#a855f7' /* violet */ },
            { id: 'magic_wand', label: 'Baguette magique', icon: <Wand2 size={16} />,      hint: 'tolérance couleur',  color: '#eab308' /* gold  */ },
            { id: 'lasso_poly', label: 'Polygone',         icon: <Hexagon size={16} />,    hint: 'clics → polygone',   color: '#3b82f6' /* blue  */ },
            { id: 'lasso_free', label: 'Lasso',            icon: <PenTool size={16} />,    hint: 'drag continu',       color: '#10b981' /* green */ },
            { id: 'brush',      label: 'Pinceau',          icon: <Paintbrush size={16} />, hint: 'peindre manuel',     color: '#f97316' /* orange*/ },
          ],
          onSubToolPick: (toolId) => {
            // Le tool opère TOUJOURS sur le calque actif (= l'image visible
            // dans le canvas). Pattern Photoshop : l'outil suit le calque.
            // C'est `effectiveImageUrl` (EditorStateContext) qui se charge de
            // résoudre vers le bon `media_url` quand on est sur un calque
            // extraction.
            setCutTool(toolId as 'sam_prompt' | 'lasso_poly' | 'lasso_free' | 'brush' | 'magic_wand')
            setCutMode(true)
          },
        } satisfies DesignerAction,
        {
          id: 'personnage',
          label: 'Personnage',
          icon: <User size={18} />,
          opensCategory: 'generate',
          title: 'Personnage — Ajouter / Remplacer / Modifier',
          subTools: [
            // 3 verbes (AJOUTE / REMPLACE / CHANGE). Animer a été retiré le
            // 2026-05-05 : c'est une action sur la SCÈNE (pas sur 1 perso) →
            // top-level icon dédié dans la toolbar, voir action 'animer' ci-dessous.
            { id: 'add',     label: 'Ajouter',   icon: <UserPlus size={16} />, hint: 'insérer un perso dans la scène', color: '#10b981' /* green */ },
            { id: 'replace', label: 'Remplacer', icon: <Replace size={16} />,  hint: 'swap un perso existant',         color: '#f59e0b' /* amber */ },
            { id: 'modify',  label: 'Modifier',  icon: <Pencil size={16} />,   hint: 'changer un attribut',            color: '#3b82f6' /* blue  */ },
          ],
          onSubToolPick: (toolId) => {
            setPersonnageMode(toolId as PersonnageMode)
          },
        } satisfies DesignerAction,
        // Animer = crée un nouveau plan animation avec la scène courante en
        // base, puis ouvre l'AnimationStudio dessus (refonte 2026-05-09).
        // Avant : ouvrait juste le CatalogAnimation in-page. Maintenant flow
        // direct vers AnimationStudio sur un nouveau plan = workflow continu
        // composer scène CSS → animer en LTX en 1 click.
        {
          id: 'animer',
          label: 'Animer',
          icon: <Film size={18} />,
          opensCategory: 'generate',
          title: 'Animer cette scène — crée un plan animation et ouvre AnimationStudio',
          onActivate: () => {
            void handleCreateAndOpenAnimationPlan()
          },
        } satisfies DesignerAction,
        // Recadrer — ouvre le modal de crop sur l'image base actuelle. Le
        // crop devient la nouvelle base du plan + entry dans la banque
        // d'images (réutilisable). Refonte 2026-05-10 — réponse au bug LTX
        // qui dérive l'identité quand les persos sont petits dans la frame.
        {
          id: 'recadrer',
          label: 'Recadrer',
          icon: <Crop size={18} />,
          opensCategory: 'generate',  // category dummy : pas de catalog associé
          title: 'Recadrer la scène (zoom sur les persos = meilleure préservation d\'identité par LTX)',
          disabled: !currentImageUrl,
          onActivate: () => setCropModalOpen(true),
        } satisfies DesignerAction,
        // Objet via prompt (refonte 2026-05-12) — modal description + position
        // + 3 modes (lier existant / créer nouveau / sans objet). Pipeline
        // Qwen Edit toujours, side effects selon le mode.
        {
          id: 'objet_add',
          label: 'Insérer un objet',
          icon: <PackagePlus size={18} />,
          opensCategory: 'generate',  // dummy
          title: 'Insérer un objet via prompt (description + localisation)',
          disabled: !currentImageUrl,
          onActivate: () => setAddObjectModalOpen(true),
        } satisfies DesignerAction,
        ]
        return allActions.find(a => a.id === id)!
      })}
      personnageMode={personnageMode}
      bankImages={fullBankImages}
      onCreateCharacterFromExtraction={handleCreateCharacterFromExtraction}
      onAddCharacter={async (character: Character, placementPrompt: string, asLayer: boolean) => {
        if (!currentImageUrl) {
          throw new Error('Aucune scène active — sélectionne une variante d\'abord')
        }
        // Préfère plein pied (info ref plus riche), fallback portrait
        const refUrl = character.fullbodyUrl ?? character.portraitUrl
        if (!refUrl) {
          throw new Error(`${character.name} n'a aucune image générée`)
        }
        // Active BakeProgressModal — bloque l'UI pendant ~40-60s (Kontext
        // compose + remove + image diff). Sinon clic ailleurs = perte du state.
        setBakeStatus({
          startedAt: Date.now(),
          phase: `Insertion de ${character.name}…`,
          kind: 'insert_character',
          estimatedTotalSec: 60,
        })
        try {
        // Translate FR → EN (Flux Kontext = T5 préfère anglais)
        let placementEn = placementPrompt.trim()
        if (placementEn) {
          try {
            const trRes = await fetch('/api/translate-prompt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt_fr: placementEn }),
            })
            if (trRes.ok) {
              const td = await trRes.json() as { positive?: string }
              if (td.positive) placementEn = td.positive
            }
          } catch {/* fallback raw FR */}
        }
        // Instruction renforcée pour minimiser la dérive du décor :
        // - Verbe ONLY directif
        // - Caps lock + repetition (Flux Kontext répond aux instructions emphatiques)
        // - Contrainte SCALE explicite (Flux a tendance à agrandir le sujet ajouté)
        // - Anti-spawn personnage : toute référence humaine dans le placement
        //   (woman, man, person…) doit pointer un perso EXISTANT, pas en créer
        //   un nouveau. Best practice Flux Kontext 2025 : nommer les existants
        //   comme "existing" + interdire explicitement l'ajout de nouveaux sujets.
        const SCALE_CONSTRAINT =
          'The character must be at REALISTIC scale relative to the furniture and existing scene proportions ' +
          '(e.g. a seated person occupies about half the sofa height, a standing person fits naturally between floor and ceiling). ' +
          'Do NOT enlarge or magnify the character beyond what physics allows in this room. ' +
          'Keep depth, perspective and proportions of the original scene unchanged.'
        const ANTI_SPAWN_CONSTRAINT =
          `The ONLY new character to add is ${character.name}. ` +
          `Any reference in the placement description to other people (woman, man, person, character, them, her, him…) ` +
          `MUST be interpreted as an EXISTING character ALREADY present in the source image — DO NOT create new people. ` +
          `Do NOT add any other humans, animals, or characters besides ${character.name}. ` +
          `Existing characters in the source image must keep their exact pose, position, appearance and clothing unchanged.`
        const instruction = placementEn
          ? `ONLY add ${character.name} ${placementEn}. ${ANTI_SPAWN_CONSTRAINT} ${SCALE_CONSTRAINT} Do NOT modify the existing furniture, lighting, walls, plants, or background composition. The scene must remain identical except for ${character.name} being added at correct scale.`
          : `ONLY add ${character.name} to the scene naturally. ${ANTI_SPAWN_CONSTRAINT} ${SCALE_CONSTRAINT} Do NOT modify the existing furniture, lighting, walls, plants, or background composition. The scene must remain identical except for ${character.name} being added at correct scale.`

        // FLATTEN AVANT envoi à Flux Kontext : si la scène a déjà des persos
        // en calques transparents par-dessus la base, Kontext ne les voit
        // pas et peut les "inventer" (bug 2026-05-03 : prompt référençant
        // "the woman" → Kontext crée une nouvelle femme à côté de Duke).
        // En aplatissant base + calques, Kontext voit la scène COMPLÈTE et
        // place Duke en cohérence avec les persos existants.
        let flatSourceUrl = currentImageUrl
        if (currentLayers.length > 1) {  // au moins 1 calque overlay (base = layers[0])
          try {
            flatSourceUrl = await flattenLayersToImage({
              baseImageUrl: currentImageUrl,
              layers: currentLayers,
              storagePathPrefix: `${STORAGE_PREFIX}_flatten_for_insert`,
            })
            console.log('[Insertion] flatten composite (base+layers) →', flatSourceUrl)
          } catch (flatErr) {
            console.warn('[Insertion] flatten failed, fallback base only:', flatErr)
            // Fallback : on continue avec base seule (risque que Kontext invente
            // les persos comme avant, mais ne bloque pas le flow)
          }
        }

        // ── DEBUG : log explicite de ce qu'on envoie à Flux Kontext ──────
        // Permet de vérifier le prompt + refUrl + sourceUrl avant chaque gen.
        // Critique pour debug bug "perso trop grand" (HF Kontext bug connu si
        // refUrl est un portrait cropped → head/legs distordus).
        console.group('🎬 [Flux Kontext insert] DEBUG envoi')
        console.log('character.name :', character.name)
        console.log('refUrl (image perso) :', refUrl)
        console.log('  → est-ce fullbody ?', !!character.fullbodyUrl, character.fullbodyUrl ? '(OK fullbody)' : '(⚠ portrait seulement = risque scale)')
        console.log('sourceUrl (scène) :', flatSourceUrl)
        console.log('  → flatten déclenché ?', currentLayers.length > 1 ? `OUI (${currentLayers.length} calques)` : 'NON (base seule)')
        console.log('guidance :', 2.5)
        console.log('PROMPT ENVOYÉ :')
        console.log(instruction)
        console.groupEnd()

        // Warning si refUrl est un portrait (crop visage) → risque scale connu Flux Kontext
        if (!character.fullbodyUrl && character.portraitUrl) {
          console.warn(
            '⚠ [Flux Kontext insert] refUrl est un PORTRAIT (visage seul). ' +
            'Bug connu Flux Kontext : si la réf est cropped face, le perso généré ' +
            'aura souvent une tête trop grande / jambes trop courtes. ' +
            'Génère un fullbody pour ' + character.name + ' pour de meilleurs résultats.'
          )
        }

        const compositeWithDuke = await runFluxKontext({
          sourceUrl: flatSourceUrl,
          refUrl,
          prompt: instruction,
          // Guidance bumpée 1.8 → 2.5 : 1.8 trop bas pour faire passer les
          // contraintes scale/anti-spawn du prompt. 2.5 = défaut BFL recommandé,
          // bon compromis fidélité décor / obéissance instructions.
          guidance: 2.5,
          storagePathPrefix: `${STORAGE_PREFIX}_kontext_insert`,
          // Pas de onProgress ici — le feedback est dans CatalogCharacters via
          // son state local (le bouton Ajouter passe en busy pendant l'await).
        })

        // ── MODE BAKED (asLayer=false, défaut) : on aplatit le perso dans
        //    la base directement. 1 seul Kontext call, pas de Kontext-remove
        //    ni image-diff. Plus rapide, pas de risque distorsion bord.
        //    Trade-off : le perso n'est plus séparable individuellement.
        //    On track quand même son ID via addBakedCharacter pour que
        //    CatalogAnimation sache qu'il est dans la scène (option A
        //    décision 2026-05-04).
        if (!asLayer) {
          console.log('[Insertion] mode BAKED — perso aplati dans la base directement')
          replaceBase(compositeWithDuke)
          addBakedCharacter(character.id)
          return
        }

        // ── MODE CALQUE (asLayer=true) : pipeline complet 3 étapes ──────
        // ─── Kontext-remove : produit le clean BG (calque base) ──────────
        // Stratégie prompt symétrique à l'insertion (insight Didier 2026-05-02) :
        // le modèle a le même contexte placement + mêmes contraintes anti-drift.
        // "ONLY remove" miroir de "ONLY add".
        let cleanBgUrl: string | null = null
        try {
          console.log('[Kontext-remove] starting on composite...')
          const removalInstruction = placementEn
            ? `ONLY remove ${character.name} (the character placed ${placementEn}) from the scene. Do NOT modify the existing furniture, lighting, walls, plants, or background composition. The scene must remain identical except for the character being removed.`
            : `ONLY remove ${character.name} from the scene. Do NOT modify the existing furniture, lighting, walls, plants, or background composition. The scene must remain identical except for the character being removed.`
          cleanBgUrl = await runFluxKontext({
            sourceUrl: compositeWithDuke,
            // Pas de refUrl — mode single-image (instruction-only)
            prompt: removalInstruction,
            guidance: 1.8,
            storagePathPrefix: `${STORAGE_PREFIX}_kontext_remove`,
          })
          console.log('[Kontext-remove] clean BG result URL:', cleanBgUrl)
        } catch (removeErr) {
          const msg = removeErr instanceof Error ? removeErr.message : String(removeErr)
          console.warn('[Kontext-remove] failed, fallback to composite as base:', msg)
        }
        console.log('[Insertion] composite (avec Duke) URL:', compositeWithDuke)

        // ─── Extract perso transparent via image diff (multi-perso compatible) ──
        // Pixel diff browser-side entre composite et clean BG → PNG transparent
        // contenant uniquement le perso. Permet d'empiler N persos sur la même
        // base sans qu'ils se masquent les uns les autres.
        let transparentLayerUrl: string | null = null
        if (cleanBgUrl) {
          try {
            console.log('[image-diff] extracting character + uploading Supabase...')
            // extractCharacterByDiff garantit upload Supabase (cf
            // feedback_always_persist_to_supabase.md). Retourne URL HTTPS
            // persistante directement, plus de blob URL exposée.
            transparentLayerUrl = await extractCharacterByDiff({
              compositeUrl: compositeWithDuke,
              cleanBgUrl,
              threshold: 25,
              storagePathPrefix: `${STORAGE_PREFIX}_char_transparent_${character.name.replace(/[^a-z0-9]/gi, '_')}`,
            })
            console.log('[image-diff] persisted Supabase URL:', transparentLayerUrl)
          } catch (diffErr) {
            const msg = diffErr instanceof Error ? diffErr.message : String(diffErr)
            console.warn('[image-diff] failed (extract or upload), fallback to composite layer:', msg)
          }
        }

        // ─── Compose archi sprite-based : base = clean BG, layer = transparent ──
        // - Idéal : base = clean BG, calque transparent (juste le perso)
        //   → multi-perso : N calques transparents s'empilent sans se masquer
        // - Fallback diff échoué : calque = composite opaque (mono-perso seulement)
        // - Fallback remove échoué : base = composite, pas de calque
        if (cleanBgUrl && transparentLayerUrl) {
          setImageUrl(cleanBgUrl)
          addLayer({
            type: 'image',
            media_url: transparentLayerUrl,
            name: `🎬 ${character.name}`,
            visible: true,
            opacity: 1,
            blend: 'normal',
            // Lien vers le store Character → permet à CatalogAnimation de
            // filtrer le sélecteur perso (cf project_plan_kind_data_model.md)
            character_id: character.id,
          })
        } else if (cleanBgUrl) {
          // Diff a échoué mais on a quand même le clean BG → fallback composite layer
          setImageUrl(cleanBgUrl)
          addLayer({
            type: 'image',
            media_url: compositeWithDuke,
            name: `🎬 ${character.name} (composite)`,
            visible: true,
            opacity: 1,
            blend: 'normal',
            character_id: character.id,
          })
        } else {
          // Tout a échoué → fallback historique (composite as base : perso fusionné)
          // Note : pas de calque dédié → le character_id n'est pas trackable.
          // CatalogAnimation ne pourra pas reconnaître ce perso dans la scène.
          setImageUrl(compositeWithDuke)
        }
        } finally {
          // Ferme BakeProgressModal global même en cas d'erreur (sinon UI bloquée)
          setBakeStatus(null)
        }
      }}

      // LayerTabs (Phase B uniquement) — séparé de children pour que la
      // toolbar actions puisse s'insérer entre les tabs et le canvas.
      // bookId/sectionId : alimentent le LayerSourceModal (banque d'images)
      // ouvert par le bouton "+ Ajouter un calque" (refonte 2026-05-09).
      layerTabs={<LayerTabs bookId={picked.bookId ?? null} sectionId={picked.sectionId ?? null} />}

      // Phase A
      bankPanel={
        <DesignerBankPanel
          images={fullBankImages}
          pickedId={pickedBankId}
          onPick={handleBankPick}
          onUpload={handleBankUpload}
        />
      }
      bottomDrawer={
        <div className="dz-bottom-drawer">
          <div className="dz-bottom-drawer-content">
            <VariantsStrip
              variants={variants}
              selectedId={selectedVariantId}
              onSelect={handleSelectVariant}
              onToggleReference={handleToggleReference}
              onDelete={handleDeleteVariant}
            />
            <div className="dz-gen-form-slot">
              <GenerationPanel
                context="plan"
                storagePathPrefix={STORAGE_PREFIX}
                initialPrompt={scene.prompt}
                initialNegative={scene.negative}
                onGenerate={handleGenerate}
                isRunning={genIsRunning}
                collapsed={genFormCollapsed}
                onToggleCollapsed={() => setGenFormCollapsed(c => !c)}
                format={format}
                onFormatChange={setFormatManual}
                sectionId={picked.sectionId}
                // Style livre par défaut (refonte 2026-05-12 : avant 'realistic'
                // hardcodé). Si le livre n'a pas de style, fallback 'realistic'
                // côté GenerationPanel.
                defaultStyle={bookIllustrationStyle ?? undefined}
              />
            </div>
          </div>
        </div>
      }
      onCommencer={handleCommencer}
      commencerEnabled={commencerEnabled}
      // Refonte 2026-05-07 : 2ème bouton qui ouvre le nouvel écran AnimationStudio.
      // Routes : /editor-test/animation-studio?planId=X&returnSectionId=Y.
      // L'auteur peut alterner entre l'ancien Designer (édition image) et le
      // nouveau studio (édition animation) le temps de la transition.
      onCommencerAnimation={() => {
        const newPlanId = (picked as PickedPlan & { _planId?: string })._planId
        if (!newPlanId) {
          alert('Studio Animation disponible uniquement pour les plans issus de la nouvelle BDD plans.')
          return
        }
        const params = new URLSearchParams({ planId: newPlanId })
        if (picked.sectionId) params.set('returnSectionId', String(picked.sectionId))
        router.push(`/editor-test/animation-studio?${params.toString()}`)
      }}
      commencerAnimationEnabled={commencerEnabled}

      // Phase B
      onNouvelleBase={handleNouvelleBase}
      inspectorTitle={<span>Paramètres du calque</span>}
      inspectorContent={
        <>
          {/* Refonte Objet 2026-05-12 — ItemLayerInspector en haut quand le
              calque actif est un calque-objet (a un item_id). Donne accès
              aux actions Baker + Régénérer ici. */}
          {(() => {
            const activeLayer = currentLayers[activeLayerIdx]
            if (!activeLayer?.item_id) return null
            const linkedItem = items.find(i => i.id === activeLayer.item_id)
            if (!linkedItem) return null
            return (
              <ItemLayerInspector
                itemName={linkedItem.name}
                itemHasIllustration={!!linkedItem.illustration_url}
                busy={itemLayerBusy}
                busyLabel={itemLayerBusyLabel}
                onBake={() => void handleBakeItemLayer()}
                onRegenerate={() => void handleRegenerateItemLayer()}
              />
            )
          })()}
          <SidebarContent
            context="plan"
            showViewTabs={true}
            npcs={npcs}
            items={items}
            choices={choices}
            imageUrl={currentImageUrl}
            storagePathPrefix={STORAGE_PREFIX}
            onImageReplaced={setImageUrl}
            onToggleCollapsed={() => { /* géré par DesignerInspector */ }}
          />
        </>
      }

      // Modal Aperçu
      previewImageUrl={currentImageUrl}
      previewSectionText={scene.prompt}
      previewChoices={[
        { id: 'c1', label: '▶ Aller voir Travis' },
        { id: 'c2', label: '▶ Sortir par derrière' },
        { id: 'c3', label: '▶ Examiner le bar' },
      ]}
    >
      <Canvas
        imageUrl={currentImageUrl}
        npcs={npcs}
        items={items}
        choices={choices}
        format={format}
      />
      {savedToast}
      {/* Modal Création de perso depuis extraction (refonte 2026-05-09).
       *  Pré-rempli avec portrait/fullbody dérivés de la sélection de l'auteur
       *  (cf handleCreateCharacterFromExtraction). Persiste vers /api/npcs
       *  (DB Supabase) — pas le CharacterStore local — pour que le perso
       *  apparaisse dans la banque entre sessions et soit utilisable par
       *  les autres outils Hero. */}
      <CharacterCreatorModal
        open={extractCreatorOpen}
        onClose={() => {
          setExtractCreatorOpen(false)
          setExtractPortraitUrl(null)
          setExtractFullbodyUrl(null)
        }}
        onCreated={() => {
          setExtractCreatorOpen(false)
          setExtractPortraitUrl(null)
          setExtractFullbodyUrl(null)
        }}
        storagePathPrefix={STORAGE_PREFIX}
        initialPortraitUrl={extractPortraitUrl}
        initialFullbodyUrl={extractFullbodyUrl}
        onPersist={persistCharacterToDb}
      />

      {/* Routeur d'attachement perso depuis découpe (refonte 2026-05-12).
       *  Mêmes ergonomiques que le routeur Objet : carte Créer / carte
       *  Attacher à existant. Si "Attacher" : choix perso + slot, puis PATCH
       *  /api/npcs/[id] via handleAttachExtractionToCharacter. */}
      <CharacterAttachmentRouterModal
        open={attachRouterOpen}
        onClose={() => {
          setAttachRouterOpen(false)
          setAttachRouterExtractionUrl(null)
        }}
        extractionUrl={attachRouterExtractionUrl}
        characters={storeCharacters}
        onCreateNew={url => {
          // Chaîne sur le flow nouveau perso existant (compose gris + open
          // CharacterCreatorModal pré-rempli).
          void proceedToCreateNewCharacterFromExtraction(url)
        }}
        onAttach={handleAttachExtractionToCharacter}
      />

      {/* Modal Recadrer la base — ouvre sur l'image actuelle. À l'apply :
       *  upload Supabase + entry banque + replaceBase. Fermeture auto via
       *  setCropModalOpen(false) dans handleCropApplied. */}
      <CropImageModal
        open={cropModalOpen && !!currentImageUrl}
        sourceUrl={currentImageUrl ?? null}
        title="Recadrer la scène"
        defaultAspect="16:9"
        onClose={() => setCropModalOpen(false)}
        onCropped={handleCropApplied}
      />

      {/* Modal édition / création d'item (refonte Objet 2026-05-12).
       *  Ouvert via le bouton "+ Nouveau" ou le crayon sur tile dans
       *  CatalogObjects v2. */}
      <ItemCreatorModal
        open={itemEditorOpen}
        onClose={() => setItemEditorOpen(false)}
        editingItem={editingItem}
        bookId={picked.bookId}
        storagePathPrefix={STORAGE_PREFIX}
        onSaved={handleItemSaved}
      />

      {/* Modal toolbar Insérer un objet (refonte 2026-05-12) — description
       *  + localisation + 3 modes (lier existant / créer nouveau / sans). */}
      <AddObjectFromToolbarModal
        open={addObjectModalOpen}
        onClose={() => setAddObjectModalOpen(false)}
        bookItems={items.map(it => ({
          id: it.id,
          name: it.name,
          illustration_url: it.illustration_url ?? null,
          belongsToCurrentSection: Array.isArray(it.sections_used) && it.sections_used.includes(picked.sectionId),
        }))}
        onConfirm={handleConfirmAddObject}
      />

      {/* Toast pour les feedbacks du flow toolbar Insérer */}
      <HeroToast toast={toast} onDismiss={() => setToast(null)} />

      {/* Modal de confirmation au drop d'un objet — affine position + (si
          besoin) description avant de lancer la pipeline (refonte 2026-05-12). */}
      {dropContext && (() => {
        const droppedItem = items.find(i => i.id === dropContext.itemId)
        if (!droppedItem) return null
        const zoneFr = zoneLabelFr(positionToZone(dropContext.dropX, dropContext.dropY))
        return (
          <DropPromptModal
            open
            onClose={() => setDropContext(null)}
            itemName={droppedItem.name}
            // Toujours afficher le champ description (refonte 2026-05-12) :
            // l'auteur veut pouvoir revoir/affiner ce qui sera envoyé à Qwen
            // même si une description existe déjà en fiche. Pré-rempli depuis
            // la fiche si dispo.
            needsDescription
            defaultPositionPrompt={zoneFr}
            defaultDescription={droppedItem.description}
            onConfirm={handleConfirmDrop}
          />
        )
      })()}
    </DesignerLayout>
    </ChoicePlanProvider>
    </CharacterPersistProvider>
  )
}
