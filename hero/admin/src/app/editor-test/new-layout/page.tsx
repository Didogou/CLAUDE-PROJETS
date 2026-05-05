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

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Scissors, Paintbrush, Wand2, Sparkles, Hexagon, PenTool, User, UserPlus, Replace, Pencil, Film } from 'lucide-react'
import '../../../components/image-editor/editor.css'
import '../../../components/image-editor/designer/designer.css'
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
import { CharacterStoreProvider, type Character } from '@/lib/character-store'
import type { PersonnageMode } from '../../../components/image-editor/designer/DesignerCatalog'
import { runFluxKontext } from '@/lib/comfyui-flux-kontext'
import { extractCharacterByDiff } from '@/lib/image-diff'
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
  // Plan sélectionné (null = on affiche le picker grille 4×3)
  const [picked, setPicked] = useState<PickedPlan | null>(null)

  const handlePickPlan = useCallback((p: PickedPlan) => {
    setPicked(p)
  }, [])

  const handleBackToPicker = useCallback(() => {
    setPicked(null)
  }, [])

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
        />
      )}
    </CharacterStoreProvider>
  )
}

// ── Designer hôte (rend le Designer pour une scène donnée) ───────────────

interface DesignerHostProps {
  picked: PickedPlan
  onBack: () => void
}

function DesignerHost({ picked, onBack }: DesignerHostProps) {
  const { theme, toggle: toggleTheme } = useEditorTheme()

  return (
    <div className="image-editor-root" data-theme={theme}>
      <EditorStateProvider
        initialImageUrl={picked.plan.url ?? null}
        // V1 : pas de hydratation des calques persistés (les sections.images[]
        // n'ont qu'un objet plan, les calques arriveront via plan_layers JSONB
        // en V2 quand on branchera le full save plan_layers en DB).
      >
        <DesignerInner
          picked={picked}
          onBack={onBack}
          theme={theme}
          onToggleTheme={toggleTheme}
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
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

function DesignerInner({ picked, onBack, theme, onToggleTheme }: DesignerInnerProps) {
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
  const npcs = [MOCK_NPC]
  const items = [MOCK_ITEM]
  const choices = [MOCK_CHOICE]
  const {
    undo, redo, imageUrl: currentImageUrl, setImageUrl, replaceBase, layers: currentLayers,
    setCutMode, setCutTool, clearSceneAnalysis,
    addLayer, setBakeStatus, addBakedCharacter, bakedCharacterIds,
    currentVideoUrl, currentVideoFirstFrameUrl, currentVideoLastFrameUrl, setCurrentVideo,
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

  // Hydrate bakedCharacterIds + animation depuis la DB au mount.
  // Au reload, picked.plan.tags?.characters contient l'UNION layer+baked du save
  // précédent. V1 : on push tout dans bakedCharacterIds (les layers ne sont pas
  // encore reload depuis DB en V1, ce sera Phase plan_layers V2).
  // Si plan kind='animation', restaure la vidéo + frames pour que Canvas
  // l'affiche immédiatement (sinon reload = perte de la vidéo).
  useEffect(() => {
    const persisted = picked.plan.tags?.characters ?? []
    persisted.forEach(id => addBakedCharacter(id))
    if (picked.plan.kind === 'animation' && picked.plan.base_video_url) {
      setCurrentVideo(
        picked.plan.base_video_url,
        picked.plan.first_frame_url ?? null,
        picked.plan.last_frame_url ?? null,
      )
    }
    // Volontairement pas dans deps : on hydrate UNE FOIS au mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.sectionId, picked.planIndex])
  const [format, setFormat] = useState('16:9')
  const [genFormCollapsed, setGenFormCollapsed] = useState(false)
  // Mode actif sur l'action Personnage (drive le contenu rendu dans le catalog
  // 'generate' quand l'utilisateur a cliqué un sub-tool de Personnage).
  const [personnageMode, setPersonnageMode] = useState<PersonnageMode>(null)

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

  // Ctrl+S : sauvegarde le plan en cours dans Supabase (sections.images[planIndex])
  // via PATCH /api/sections/[id]/plans en mode UPDATE (planIndex fourni).
  // Plus de localStorage — décision 2026-05-03 : tout en DB.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        // Body = état actuel du plan (image + prompts). Les calques (overlays)
        // ne sont PAS encore persistés ici — V2 quand on branchera plan_layers.
        // Mais on persiste plan.tags.characters (ID des persos baked + layers)
        // pour que CatalogAnimation retrouve les persos au reload.
        // Si une vidéo de plan animation est en cours → on switch kind='animation'
        // + on persiste base_video_url + frames. Sinon kind='image' (ou hérité).
        const isAnimation = !!currentVideoUrl
        const body = {
          planIndex: picked.planIndex,
          url: currentImageUrl ?? undefined,
          kind: isAnimation ? ('animation' as const) : ('image' as const),
          base_video_url: isAnimation ? currentVideoUrl : undefined,
          first_frame_url: isAnimation ? (currentVideoFirstFrameUrl ?? undefined) : undefined,
          last_frame_url: isAnimation ? (currentVideoLastFrameUrl ?? undefined) : undefined,
          tags: {
            characters: allPresentCharacterIds,
          },
        }
        ;(async () => {
          try {
            const res = await fetch(`/api/sections/${picked.sectionId}/plans`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? `save HTTP ${res.status}`)
            console.log('[Ctrl+S] saved plan to DB:', picked.sectionId, picked.planIndex)
            setSavedToastVisible(true)
            setTimeout(() => setSavedToastVisible(false), 2000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error('[Ctrl+S] save failed:', msg)
            // TODO V2 : afficher un toast d'erreur
          }
        })()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    picked.sectionId, picked.planIndex, currentImageUrl, allPresentCharacterIds,
    currentVideoUrl, currentVideoFirstFrameUrl, currentVideoLastFrameUrl,
  ])

  // Banque dynamique : MOCK_BANK statique + uploads de l'utilisateur (V1
  // local state, persistance Supabase via Phase 3b vraie intégration).
  const [uploadedBankImages, setUploadedBankImages] = useState<BankImage[]>([])
  const fullBankImages = useMemo(
    () => [...uploadedBankImages, ...MOCK_BANK],
    [uploadedBankImages],
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
    if (firstDoneToAutoSelect && !currentImageUrl) {
      setSelectedVariantId(firstDoneToAutoSelect.id)
      replaceBase(firstDoneToAutoSelect.url)
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

  /** Bouton "Commencer l'édition" : passe en Phase B + sauvegarde DB */
  const handleCommencer = useCallback(() => {
    setPhase('editing')
    // Sauvegarde immédiate du plan en DB (commit de l'image base sélectionnée)
    if (!currentImageUrl) return
    ;(async () => {
      try {
        const isAnimation = !!currentVideoUrl
        await fetch(`/api/sections/${picked.sectionId}/plans`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planIndex: picked.planIndex,
            url: currentImageUrl,
            kind: isAnimation ? 'animation' : 'image',
            base_video_url: isAnimation ? currentVideoUrl : undefined,
            first_frame_url: isAnimation ? (currentVideoFirstFrameUrl ?? undefined) : undefined,
            last_frame_url: isAnimation ? (currentVideoLastFrameUrl ?? undefined) : undefined,
            tags: { characters: allPresentCharacterIds },
          }),
        })
        console.log('[Commencer] saved plan to DB:', picked.sectionId, picked.planIndex)
      } catch (err) {
        console.error('[Commencer] save failed:', err)
      }
    })()
  }, [
    currentImageUrl, picked.sectionId, picked.planIndex, allPresentCharacterIds,
    currentVideoUrl, currentVideoFirstFrameUrl, currentVideoLastFrameUrl,
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

  return (
    <DesignerLayout
      phase={phase}
      planTitle={`Scène test — ${scene.name}`}
      planSummary={scene.id}
      returnLabel="← Choisir une autre scène"
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
      // le nouveau. Aujourd'hui : Découper + Personnage.
      actions={[
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
            setCutTool(toolId as 'sam_prompt' | 'lasso_poly' | 'lasso_free' | 'brush' | 'magic_wand')
            setCutMode(true)
          },
        } satisfies DesignerAction,
        {
          id: 'personnage',
          label: 'Personnage',
          icon: <User size={18} />,
          opensCategory: 'generate',
          title: 'Personnage — Ajouter / Remplacer / Modifier / Animer',
          subTools: [
            // 4 verbes alignés sur la design Prompt Assistant validée :
            // AJOUTE / REMPLACE / CHANGE / ANIME. Couleurs distinctes mais
            // dans la même famille tonale que les outils Découper.
            { id: 'add',     label: 'Ajouter',   icon: <UserPlus size={16} />, hint: 'insérer un perso dans la scène', color: '#10b981' /* green  */ },
            { id: 'replace', label: 'Remplacer', icon: <Replace size={16} />,  hint: 'swap un perso existant',         color: '#f59e0b' /* amber  */ },
            { id: 'modify',  label: 'Modifier',  icon: <Pencil size={16} />,   hint: 'changer un attribut',            color: '#3b82f6' /* blue   */ },
            { id: 'animate', label: 'Animer',    icon: <Film size={16} />,     hint: 'mettre en mouvement',            color: '#a855f7' /* violet */ },
          ],
          onSubToolPick: (toolId) => {
            // Set le mode → drive le contenu du catalog 'generate'. Pour
            // l'instant seul 'add' route vers CatalogCharacters, les autres
            // tomberont sur le placeholder 'Génération AI' jusqu'au branchement.
            setPersonnageMode(toolId as PersonnageMode)
          },
        } satisfies DesignerAction,
      ]}
      personnageMode={personnageMode}
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
      layerTabs={<LayerTabs />}

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
                onFormatChange={setFormat}
              />
            </div>
          </div>
        </div>
      }
      onCommencer={handleCommencer}
      commencerEnabled={commencerEnabled}

      // Phase B
      onNouvelleBase={handleNouvelleBase}
      inspectorTitle={<span>Paramètres du calque</span>}
      inspectorContent={
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
    </DesignerLayout>
  )
}
