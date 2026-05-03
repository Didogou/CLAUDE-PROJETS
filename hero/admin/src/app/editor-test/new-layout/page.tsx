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
import SceneTestPicker, {
  saveSceneState,
  type TestScene,
  type SavedSceneState,
} from './SceneTestPicker'
import type { Npc, Item, Section, Choice } from '@/types'
import { CharacterStoreProvider, type Character } from '@/lib/character-store'
import type { PersonnageMode } from '../../../components/image-editor/designer/DesignerCatalog'
import { runFluxKontext } from '@/lib/comfyui-flux-kontext'
import { extractCharacterByDiff } from '@/lib/image-diff'

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
  // Scène en cours (null = on affiche le picker)
  const [scene, setScene] = useState<TestScene | null>(null)
  /** State initial à hydrater dans le Designer si la scène avait été sauvegardée */
  const [initialState, setInitialState] = useState<SavedSceneState | null>(null)

  const handlePickScene = useCallback((s: TestScene, saved: SavedSceneState | null) => {
    setScene(s)
    setInitialState(saved)
  }, [])

  const handleBackToPicker = useCallback(() => {
    setScene(null)
    setInitialState(null)
  }, [])

  // CharacterStore wrappe la page entière → persos partagés entre toutes les
  // scènes test (et plus tard, entre Designer et autres parties du Studio).
  return (
    <CharacterStoreProvider>
      {!scene ? (
        <SceneTestPicker onPick={handlePickScene} />
      ) : (
        <DesignerHost
          key={scene.id}
          scene={scene}
          initialState={initialState}
          onBack={handleBackToPicker}
        />
      )}
    </CharacterStoreProvider>
  )
}

// ── Designer hôte (rend le Designer pour une scène donnée) ───────────────

interface DesignerHostProps {
  scene: TestScene
  initialState: SavedSceneState | null
  onBack: () => void
}

function DesignerHost({ scene, initialState, onBack }: DesignerHostProps) {
  const { theme, toggle: toggleTheme } = useEditorTheme()

  return (
    <div className="image-editor-root" data-theme={theme}>
      <EditorStateProvider
        initialImageUrl={initialState?.committedImageUrl ?? null}
        // Restaure les calques d'édition (atmosphère, découpe, NPCs placés…)
        // au reload d'une scène déjà éditée. C'est ce qui permet à l'utilisateur
        // de retrouver ses calques + effets après reload.
        initialLayers={initialState?.layers && initialState.layers.length > 0
          ? initialState.layers
          : undefined}
      >
        <DesignerInner
          scene={scene}
          initialState={initialState}
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
  scene: TestScene
  initialState: SavedSceneState | null
  onBack: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

function DesignerInner({ scene, initialState, onBack, theme, onToggleTheme }: DesignerInnerProps) {
  const STORAGE_PREFIX = `test/new-layout/scene-${scene.id}`
  const npcs = [MOCK_NPC]
  const items = [MOCK_ITEM]
  const choices = [MOCK_CHOICE]
  const {
    undo, redo, imageUrl: currentImageUrl, setImageUrl, replaceBase, layers: currentLayers,
    setCutMode, setCutTool, clearSceneAnalysis,
    addLayer,
  } = useEditorState()
  const [format, setFormat] = useState('16:9')
  const [genFormCollapsed, setGenFormCollapsed] = useState(false)
  // Mode actif sur l'action Personnage (drive le contenu rendu dans le catalog
  // 'generate' quand l'utilisateur a cliqué un sub-tool de Personnage).
  const [personnageMode, setPersonnageMode] = useState<PersonnageMode>(null)

  // Génération réelle d'images via ComfyUI (réutilise le hook de l'ancien Designer).
  // statuses[] mis à jour au fil de l'eau, on les transforme en variants via useEffect plus bas.
  const { statuses: genStatuses, isRunning: genIsRunning, start: startGeneration } = useImageGeneration()

  // ── Phase et state Variants : initialisé depuis le saved state si existant
  const [phase, setPhase] = useState<DesignerPhase>(initialState?.phase ?? 'creation')
  const [variants, setVariants] = useState<DesignerVariant[]>(initialState?.variants ?? [])
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    initialState?.selectedVariantId ?? null
  )

  // ── Persistance : extrait le state actuel pour sauvegarde
  const buildSnapshot = useCallback((): Omit<SavedSceneState, 'savedAt'> => ({
    committedImageUrl: phase === 'editing' ? currentImageUrl : null,
    variants,
    selectedVariantId,
    layers: currentLayers,    // ← inclut les calques pour restoration au reload
    phase,
  }), [phase, currentImageUrl, variants, selectedVariantId, currentLayers])

  // Ctrl+S : sauvegarde la session de la scène en localStorage
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const snap = buildSnapshot()
        saveSceneState(scene.id, snap)
        console.log('[scene-test] Ctrl+S → saved', scene.id, snap)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scene.id, buildSnapshot])

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

  /** Bouton "Commencer l'édition" : passe en Phase B + sauvegarde */
  const handleCommencer = useCallback(() => {
    setPhase('editing')
    // Sauvegarde immédiate (sans attendre Ctrl+S) — Commencer = commit explicite
    const snap: Omit<SavedSceneState, 'savedAt'> = {
      committedImageUrl: currentImageUrl,
      variants,
      selectedVariantId,
      layers: currentLayers,
      phase: 'editing',
    }
    saveSceneState(scene.id, snap)
    console.log('[scene-test] Commencer → saved', scene.id, snap)
  }, [currentImageUrl, variants, selectedVariantId, currentLayers, scene.id])

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
      onAddCharacter={async (character: Character, placementPrompt: string) => {
        if (!currentImageUrl) {
          throw new Error('Aucune scène active — sélectionne une variante d\'abord')
        }
        // Préfère plein pied (info ref plus riche), fallback portrait
        const refUrl = character.fullbodyUrl ?? character.portraitUrl
        if (!refUrl) {
          throw new Error(`${character.name} n'a aucune image générée`)
        }
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
        // - Verbe ONLY (vs "preserve the rest") plus directif
        // - Liste explicite des éléments à NE PAS toucher
        // - Caps lock + repetition (Flux Kontext répond aux instructions
        //   emphatiques per la doc BFL)
        const instruction = placementEn
          ? `ONLY add ${character.name} ${placementEn}. Do NOT modify the existing furniture, lighting, walls, plants, or background composition. The scene must remain identical except for the new character being added.`
          : `ONLY add ${character.name} to the scene naturally. Do NOT modify the existing furniture, lighting, walls, plants, or background composition. The scene must remain identical except for the new character being added.`

        const compositeWithDuke = await runFluxKontext({
          sourceUrl: currentImageUrl,
          refUrl,
          prompt: instruction,
          // Guidance baissée 2.5 → 1.8 : moins de "force créative" sur Flux,
          // plus de respect du source. Recommandation BFL pour edits chirurgicaux.
          guidance: 1.8,
          storagePathPrefix: `${STORAGE_PREFIX}_kontext_insert`,
          // Pas de onProgress ici — le feedback est dans CatalogCharacters via
          // son state local (le bouton Ajouter passe en busy pendant l'await).
        })

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
            console.log('[image-diff] extracting character...')
            transparentLayerUrl = await extractCharacterByDiff(
              compositeWithDuke,
              cleanBgUrl,
              25, // threshold RGB Euclidean — tunable
            )
            console.log('[image-diff] transparent character URL (blob):', transparentLayerUrl)
          } catch (diffErr) {
            const msg = diffErr instanceof Error ? diffErr.message : String(diffErr)
            console.warn('[image-diff] failed, fallback to composite layer:', msg)
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
          })
        } else {
          // Tout a échoué → fallback historique (composite as base)
          setImageUrl(compositeWithDuke)
        }
      }}

      // LayerTabs (Phase B uniquement) — séparé de children pour que la
      // toolbar actions puisse s'insérer entre les tabs et le canvas.
      layerTabs={<LayerTabs />}

      // Phase A
      bankPanel={
        <DesignerBankPanel
          images={MOCK_BANK}
          pickedId={pickedBankId}
          onPick={handleBankPick}
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
    </DesignerLayout>
  )
}
