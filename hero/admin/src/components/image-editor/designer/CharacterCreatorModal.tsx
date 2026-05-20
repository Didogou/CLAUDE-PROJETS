'use client'
/**
 * CharacterCreatorModal — POC pour créer un personnage avec 2 images
 * (portrait + plein pied) avec identité cohérente.
 *
 * Champs :
 *   - Nom (text, requis)
 *   - Style : Réaliste | Animé (drive le suffix de prompt envoyé à Z-Image)
 *   - Prompt (textarea, description visuelle libre — Z-Image bilingue FR/EN)
 *
 * Pipeline portrait (Z-Image Turbo — installé 2026-05-01) :
 *   Z-Image distillé 8 steps, ~20-30s. Excellent instruction-following
 *   (suit "homme + chapeau" sans bias Animagine). NVFP4 4.5 GB sur Blackwell.
 *
 * Pipeline plein pied (T2I + face_detailer_only — primitive validée 2026-04-30) :
 *   1. Disabled tant que portrait pas généré (besoin du face ref)
 *   2. T2I plein pied avec le MÊME moteur que le portrait (Z-Image / Flux)
 *      → body composé librement, style cohérent avec portrait, visage random
 *   3. face_detailer_only(body, portrait_ref) → swap visage via IPAdapter
 *      FaceID Plus v2 → identité du portrait préservée
 *   4. Si portrait régénéré → plein pied invalidé
 *
 * Pourquoi pas InstantID ? Testé puis abandonné 2026-05-01 : son ControlNet
 * face landmarks pèse 75% sur la composition (Cubiq) → portrait close-up forcé,
 * impossible d'avoir un vrai full body. Le combo T2I libre + face_detailer
 * donne une composition naturelle et un style portrait↔body cohérent (pas
 * de mismatch Z-Image vs SDXL).
 *
 * Save : crée le perso dans CharacterStore (au moins 1 image requise).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ImagePlus, Loader2, Check, Upload, Maximize2, Trash2, Crop, Sparkles, ChevronDown } from 'lucide-react'
import CropImageModal from '@/components/image-editor/CropImageModal'
import { runQwenImageEdit } from '@/lib/comfyui-qwen-edit'
import {
  useOptionalCharacterStore,
  type CharacterStyle, type CharacterGender, type Character,
} from '@/lib/character-store'
import { runZImage } from '@/lib/comfyui-z-image'
import { runFluxDev } from '@/lib/comfyui-flux-dev'
import { runSdxlPortrait } from '@/lib/comfyui-sdxl-portrait'
import { runFaceDetailer } from '@/lib/comfyui-face-detailer'
import { useOptionalEditorState } from '../EditorStateContext'
import { useCharacterPersist } from '@/lib/character-persist-context'
import { useCharacterStore } from '@/lib/character-store'
import './character-creator.css'

/** Moteur T2I à utiliser pour le portrait.
 *  - z_image       : ⚡ Z-Image Turbo NVFP4 (~25s, peu de variance entre seeds)
 *  - flux_dev      : ✨ Flux Dev Q5_K_S (~75s, qualité max, peut être lent 8 GB)
 *  - flux_dev_fast : 🚀 Flux Dev Q4_K_S (~40s, meilleur compromis 8 GB) */
export type PortraitEngine = 'z_image' | 'flux_dev' | 'flux_dev_fast' | 'sdxl_juggernaut'

/** Voix ElevenLabs minimaliste — juste ce qu'il faut pour le dropdown. */
export interface ElevenVoiceOption {
  voice_id: string
  name: string
  labels: Record<string, string>
  preview_url: string | null
}

/** Données exposées via la prop onPersist — laisse l'appelant choisir où
 *  persister (CharacterStore localStorage, Supabase npcs, etc.). */
export interface CharacterCreatorPayload {
  name: string
  style: CharacterStyle
  gender: CharacterGender
  prompt: string | null
  portraitUrl: string | null
  fullbodyUrl: string | null
  /** Moteur utilisé pour le portrait (utile pour régen ultérieure). */
  engine: PortraitEngine
  /** voice_id ElevenLabs si l'auteur a sélectionné une voix dans le dropdown
   *  (uniquement disponible si voices passé en prop au modal). null = pas de
   *  voix sélectionnée (ou prop voices absente). */
  voiceId: string | null
  /** Vue de DOS du perso (Qwen multi-angle, refonte 2026-05-09). null si
   *  pas générée.
   *  ⚠ DÉPRÉCIÉ depuis migration 079 — gardé pour back-compat. Les nouvelles
   *  vues alternatives vont dans `images` (galerie). */
  fullbodyBackUrl?: string | null
  /** Galerie d'images additionnelles (refonte 2026-05-09 — option B).
   *  Contient les vues Plein pied alternatives (back, profil L/R, kind tag)
   *  + les variantes scéniques (cheveux rouges, etc.). Les 2 canoniques
   *  (portraitUrl = Portrait Face, fullbodyUrl = Plein pied Face) restent
   *  séparées car utilisées par les pipelines downstream (FaceID, IPAdapter). */
  images?: import('@/types').NpcImage[]
}

/** Fichier UNet GGUF utilisé selon le moteur Flux choisi (sans impact pour Z-Image). */
const FLUX_DEV_FILES: Record<'flux_dev' | 'flux_dev_fast', string> = {
  flux_dev:      'flux1-dev-Q5_K_S.gguf',
  flux_dev_fast: 'flux1-dev-Q4_K_S.gguf',
}

interface CharacterCreatorModalProps {
  open: boolean
  onClose: () => void
  /** Callback après save (création) — reçoit l'id du perso créé/édité.
   *  En mode "store local" (CharacterStore), c'est l'id généré côté client.
   *  En mode persist custom, c'est l'id renvoyé par onPersist. */
  onCreated?: (characterId: string) => void
  /** Préfixe Supabase Storage pour ranger les images générées. */
  storagePathPrefix: string
  /** Si fourni → mode édition : pré-remplit nom/style/prompt + URLs images. */
  editingCharacter?: Character | null
  /** Persistance custom — si fourni, remplace l'écriture dans CharacterStore.
   *  Doit retourner l'id du perso créé/édité (peut être asynchrone : POST API).
   *  Si non fourni → fallback sur CharacterStore (utilisé par le Designer
   *  legacy avec son CharacterStoreProvider). */
  onPersist?: (payload: CharacterCreatorPayload, mode: 'create' | 'edit') => Promise<string> | string
  /** Titre custom du modal — défaut "Créer un personnage" / "Modifier ${name}". */
  title?: string
  /** Liste des voix ElevenLabs disponibles. Si fourni, affiche un dropdown
   *  "Voix ElevenLabs" sous la description visuelle. La voix sélectionnée
   *  est exposée dans le payload via `voiceId`. Si non fourni, le sélecteur
   *  n'apparaît pas (cas Designer legacy = pas de gestion vocale). */
  voices?: ElevenVoiceOption[]
  /** voice_id pré-sélectionné en mode édition (par ex. depuis la BDD npcs). */
  initialVoiceId?: string | null
  /** URL portrait pré-remplie en mode CRÉATION (refonte 2026-05-09).
   *  Cas d'usage : extraction de personnage depuis une photo chargée — l'auteur
   *  arrive avec un portrait déjà détouré, le modal s'ouvre avec cette image
   *  pré-remplie dans le slot Portrait (phase 'done'). */
  initialPortraitUrl?: string | null
  /** URL plein pied pré-remplie en mode CRÉATION. Idem usage extraction.
   *  Si fourni avec initialPortraitUrl → les 2 slots sont pré-remplis. */
  initialFullbodyUrl?: string | null
}

/** Suffix de style ajouté au prompt portrait. Vocabulaire calibré pour piloter
 *  Z-Image / Flux Dev sans ambiguïté (camera/lens pour réaliste, références
 *  artistes/œuvres pour stylisé). */
const STYLE_SUFFIX: Record<CharacterStyle, string> = {
  realistic:    'shot on Canon R5, 85mm f/1.4 portrait lens, Kodak Portra 400 tones, natural lighting, visible skin texture, shallow depth of field, candid documentary realism',
  anime_modern: 'modern anime film aesthetic, soft cel shading, painterly background, atmospheric lighting, art style of contemporary anime films, semi-realistic anime',
  manga:        'shonen manga style, bold inked lineart, dynamic expression, halftone shading, japanese manga panel art, expressive eyes',
  bd:           'franco-belgian comic book style, ligne claire, flat clean colors, bande dessinée illustration, Tintin Asterix style, crisp outlines',
  comic:        'american comic book art, clean inking, vibrant full color palette, dynamic composition, Marvel DC modern style, sharp linework, full saturation',
  concept_art:  'video game concept art, painterly style, cinematic lighting, detailed character design, Diablo Dishonored aesthetic, digital painting',
  dark_fantasy: 'dark fantasy oil painting, gothic horror illustration, Frank Frazetta and Brom influence, dramatic chiaroscuro lighting, weathered worn armor, brooding atmosphere, Souls series aesthetic, painterly textures, desaturated palette with deep blacks',
  // Legacy alias : anciens persos avec style 'animated' → traités comme anime moderne
  animated:     'modern anime film aesthetic, soft cel shading, painterly background, atmospheric lighting, art style of contemporary anime films, semi-realistic anime',
}

/** Refonte 2026-05-19 — Negative prompt par style.
 * Cause root du "style mismatch" (user demande réaliste mais sort cartoon) :
 * aucun negative n'était passé aux moteurs. Sur Flux (non-distillé), le
 * negative pèse vraiment. Sur Z-Image (CFG=1), pèse moins mais reste utile. */
const STYLE_NEGATIVE: Record<CharacterStyle, string> = {
  realistic:    'anime, manga, cartoon, drawing, illustration, painting, 3d render, cgi, sketch, comic, toon, low quality, deformed, distorted face, extra fingers, watermark, text, signature',
  anime_modern: 'photograph, photorealistic, real person, 3d render, low quality, deformed, extra fingers, watermark, text, signature, ugly',
  manga:        'photograph, photorealistic, real person, 3d render, painted texture, low quality, deformed, extra fingers, watermark, signature',
  bd:           'photograph, photorealistic, real person, anime, manga, heavy painting, low quality, deformed, extra fingers, watermark, signature',
  comic:        'photograph, photorealistic, real person, anime, manga, low quality, deformed, extra fingers, watermark, signature, blurry',
  concept_art:  'photograph, photorealistic, low quality, deformed, extra fingers, watermark, signature, flat colors, anime, manga, cartoon, washed out',
  dark_fantasy: 'cartoon, anime, manga, kawaii, bright cheerful colors, pastel, low contrast, washed out, photograph, low quality, deformed, extra fingers, watermark, signature',
  animated:     'photograph, photorealistic, real person, 3d render, low quality, deformed, extra fingers, watermark, text, signature, ugly',
}

/** Label affiché dans le dropdown UI. */
const STYLE_LABELS: Record<CharacterStyle, string> = {
  realistic:    '📷 Photo réaliste',
  anime_modern: '🎨 Anime moderne (Ghibli, Makoto Shinkai)',
  manga:        '💢 Manga shonen (One Piece, MHA)',
  bd:           '📖 BD franco-belge (Tintin, Astérix)',
  comic:        '🦸 Comic américain (Marvel, DC)',
  concept_art:  '🖌 Concept art (Dishonored, Diablo)',
  dark_fantasy: '🗡 Dark fantasy peinture (Frazetta, Brom, Souls)',
  animated:     '🎨 Anime moderne (Ghibli, Makoto Shinkai)',
}

/** Ordre d'affichage du dropdown (legacy 'animated' exclu pour ne pas
 *  doublonner avec 'anime_modern' dans la liste). */
const STYLE_ORDER: CharacterStyle[] = [
  'realistic', 'anime_modern', 'manga', 'bd', 'comic', 'concept_art', 'dark_fantasy',
]

/** Tags injectés en TÊTE pour cadrage swap-friendly (visage de face, sans hood,
 *  bien éclairé). Critical pour que YOLO/InsightFace détecte le visage côté
 *  FaceDetailer ensuite. */
const PORTRAIT_FRAMING = 'portrait headshot, head and shoulders centered, front view, looking directly at camera, face fully visible and well lit, eyes open and visible, neutral expression, neutral background'
const FULLBODY_FRAMING = 'full body shot, head to toes visible, standing pose, character centered in frame, front view, facing camera, face fully visible, neutral background'
// Negative renforcé 2026-05-03 : le mot "arrière" du userPrompt FR pouvait
// se traduire "back" et biaiser Flux vers vue de dos. Désormais userPrompt
// est ignoré en faveur de l'analyse vision du portrait (cf generateFullbody),
// mais on garde back-view dans le négatif comme ceinture+bretelles.
const FULLBODY_NEGATIVE = 'close-up, headshot, cropped, face only, head only, zoom on face, back view, rear view, from behind, viewed from back, profile view, side view'

/** État du pipeline plein pied. T2I + face_detailer en chaîne (2 phases). */
type FullbodyPhase = 'idle' | 't2i' | 'facedetailer' | 'done' | 'error'

/** État du pipeline portrait (Z-Image — 1 pass). */
type PortraitPhase = 'idle' | 'generating' | 'done' | 'error'

export default function CharacterCreatorModal({
  open, onClose, onCreated, storagePathPrefix, editingCharacter,
  onPersist, title, voices, initialVoiceId,
  initialPortraitUrl, initialFullbodyUrl,
}: CharacterCreatorModalProps) {
  // CharacterStore optionnel : si pas de provider (cas Studio Creator), on
  // s'appuie sur onPersist. Si onPersist absent ET pas de provider → erreur
  // explicite côté handleSave (fail loud).
  const characterStore = useOptionalCharacterStore()
  // Persist DB optionnel via context (refonte 2026-05-09) : si new-layout
  // wrappe l'arbre avec CharacterPersistProvider, ce hook retourne la fonction
  // qui POST/PATCH /api/npcs. Permet aux modals d'édition de CatalogCharacters
  // de persister sans prop drilling à travers Designer → Catalog → Modal.
  const persistFromContext = useCharacterPersist()
  // BakeProgressModal global : optionnel — affiche un overlay pendant les
  // gens longues (designer). Hors Designer, le modal sticky bloque déjà l'UI
  // donc l'overlay global n'est pas nécessaire.
  const editorState = useOptionalEditorState()
  const setBakeStatus: NonNullable<typeof editorState>['setBakeStatus'] =
    editorState?.setBakeStatus ?? (() => { /* no-op hors Designer */ })

  // Liste des persos existants — utilisée pour bloquer les noms doublons
  // (refonte 2026-05-11). En mode édition, on autorise le perso à garder son
  // propre nom (ne pas le considérer comme doublon de lui-même).
  const { characters: allCharacters } = useCharacterStore()

  const isEditMode = !!editingCharacter
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Modal crop manuel ouvert depuis le bouton "Du plein pied" sur Portrait.
   *  Source = fullbodyUrl. Onapply : upload Supabase + setPortraitUrl.
   *  Refonte 2026-05-12 — remplace l'extraction auto (top % heuristique qui
   *  ratait quand le sujet portait un chapeau / plume / coiffure haute). */
  const [cropFromFullbodyOpen, setCropFromFullbodyOpen] = useState(false)

  /** Onglet actif (refonte fiche perso 2026-05-12, phase A — squelette).
   *  - identity : Style + Moteur + Voix + Apparence
   *  - images   : Portrait + Plein pied carousel + Galerie variantes
   *  - traits   : Caractéristiques (placeholder V1, à faire) */
  const [activeTab, setActiveTab] = useState<'identity' | 'images' | 'gallery' | 'traits'>('identity')

  /** Type narratif (ennemi/boss/allié/neutre/marchand) — depuis npcs.type.
   *  Affiché en header, modifiable. Persisté via persistCharacterToDb (phase C
   *  2026-05-12). Défaut 'allié' pour les créations from-scratch (= le moins
   *  hostile, l'auteur ajuste). */
  const [npcType, setNpcType] = useState<import('@/types').NpcType>('allié')

  /** Modal "Édition IA du portrait" (phase B). Ouverte au clic sur le portrait
   *  identité du header. Affiche le portrait en grand + input prompt → Qwen
   *  Edit → replace portraitUrl. */
  const [aiEditPortraitOpen, setAiEditPortraitOpen] = useState(false)
  const [aiEditPrompt, setAiEditPrompt] = useState('')
  const [aiEditBusy, setAiEditBusy] = useState(false)
  const [aiEditError, setAiEditError] = useState<string | null>(null)
  const [aiEditLabel, setAiEditLabel] = useState('')
  const [name, setName] = useState('')
  const [style, setStyle] = useState<CharacterStyle>('anime_modern')
  /** Apparence du perso — pilote les slots typés LTX IC LoRA Dual (Male:/Female:).
   *  Défaut 'female' = arbitraire, l'auteur ajuste au besoin. */
  const [gender, setGender] = useState<CharacterGender>('female')
  const [engine, setEngine] = useState<PortraitEngine>('z_image')
  const [prompt, setPrompt] = useState('')
  // Refonte 2026-05-19 — Aide IA pour enrichir la description visuelle.
  // POST /api/character/enhance-prompt → Mistral rewrite. Loading state +
  // error visible. Le prompt précédent est mémorisé pour permettre Annuler.
  const [enhancingPrompt, setEnhancingPrompt] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  const [previousPromptBeforeEnhance, setPreviousPromptBeforeEnhance] = useState<string | null>(null)
  const enhancePromptWithAI = useCallback(async () => {
    const raw = prompt.trim()
    if (!raw) {
      setEnhanceError('Écris d\'abord une courte description.')
      return
    }
    setEnhanceError(null)
    setEnhancingPrompt(true)
    const before = prompt
    try {
      const res = await fetch('/api/character/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawPrompt: raw, style, npcType, name }),
      })
      if (!res.ok) {
        const eb = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(eb.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { enhancedPrompt?: string; error?: string }
      if (data.error) throw new Error(data.error)
      if (!data.enhancedPrompt) throw new Error('Réponse vide')
      setPreviousPromptBeforeEnhance(before)
      setPrompt(data.enhancedPrompt)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[enhance-prompt] failed:', msg)
      setEnhanceError(msg)
    } finally {
      setEnhancingPrompt(false)
    }
  }, [prompt, style, npcType, name])
  const revertPromptEnhance = useCallback(() => {
    if (previousPromptBeforeEnhance === null) return
    setPrompt(previousPromptBeforeEnhance)
    setPreviousPromptBeforeEnhance(null)
    setEnhanceError(null)
  }, [previousPromptBeforeEnhance])

  // ── Portrait : Z-Image Turbo (T2I distillé, 8 steps) ──────────────────
  const [portraitPhase, setPortraitPhase] = useState<PortraitPhase>('idle')
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [portraitError, setPortraitError] = useState<string | null>(null)
  const [portraitProgressLabel, setPortraitProgressLabel] = useState<string>('')

  // ── Plein pied : pipeline InstantID (1 pass, identité depuis portrait) ──
  const [fullbodyPhase, setFullbodyPhase] = useState<FullbodyPhase>('idle')
  const [fullbodyUrl, setFullbodyUrl] = useState<string | null>(null)
  const [fullbodyError, setFullbodyError] = useState<string | null>(null)
  const [fullbodyProgressLabel, setFullbodyProgressLabel] = useState<string>('')

  // ── Carousel Plein pied (refonte 2026-05-09) ──
  // 4 angles : Face (= fullbodyUrl canonique) + Dos / Profil G / Profil D
  // (= items de `images` avec kind='view_X'). Cyclage via arrows + dots.
  type PleinPiedAngle = 'face' | 'view_back' | 'view_profile_left' | 'view_profile_right'
  const [pleinPiedAngle, setPleinPiedAngle] = useState<PleinPiedAngle>('face')
  const ANGLE_ORDER: readonly PleinPiedAngle[] = ['face', 'view_back', 'view_profile_left', 'view_profile_right'] as const
  const ANGLE_LABEL: Record<PleinPiedAngle, string> = {
    face: 'Face',
    view_back: 'Dos',
    view_profile_left: 'Profil G',
    view_profile_right: 'Profil D',
  }

  // ── Galerie d'images (refonte 2026-05-09 — option B) ──
  // Architecture migration 079 : tout sauf les 2 canoniques (portrait_url,
  // fullbody_gray_url) vit dans `images: NpcImage[]`. Vues alternatives Plein
  // pied (back/profil L/R) = items avec kind='view_X', source='qwen_multiangle'.
  // Variantes scéniques (cheveux rouges, etc.) = items avec kind='variant'.
  const [images, setImages] = useState<import('@/types').NpcImage[]>([])
  // Track quel angle est en train de se générer (= disable Générer pendant)
  const [generatingAngle, setGeneratingAngle] = useState<'view_back' | 'view_profile_left' | 'view_profile_right' | null>(null)
  const [angleGenError, setAngleGenError] = useState<string | null>(null)

  // ── Lightbox : preview agrandi quand on clique sur une slot image ───────
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  // Upload manuel : true le temps de l'upload pour bloquer les double-clics
  const [portraitUploading, setPortraitUploading] = useState(false)
  const [fullbodyUploading, setFullbodyUploading] = useState(false)

  // ── Voix ElevenLabs (uniquement actif si prop voices fourni) ──────────
  const [voiceId, setVoiceId] = useState<string>('')

  // Reset complet au close
  useEffect(() => {
    if (!open) {
      // Reset complet à la fermeture
      setName(''); setPrompt(''); setStyle('anime_modern'); setGender('female'); setEngine('z_image')
      setPortraitPhase('idle'); setPortraitUrl(null); setPortraitError(null)
      setPortraitProgressLabel('')
      setFullbodyPhase('idle'); setFullbodyUrl(null); setFullbodyError(null)
      setFullbodyProgressLabel('')
      setImages([]); setGeneratingAngle(null); setAngleGenError(null)
      setPleinPiedAngle('face')
      setGalleryUploading(false); setGalleryError(null)
      setSaving(false); setSaveError(null)
      setVoiceId('')
    } else if (editingCharacter) {
      // Mode édition : hydrate les champs depuis le perso existant
      setName(editingCharacter.name)
      // 'animated' (legacy) → 'anime_modern' pour cohérence dropdown
      const styleKey: CharacterStyle = editingCharacter.style === 'animated'
        ? 'anime_modern'
        : (editingCharacter.style ?? 'anime_modern')
      setStyle(styleKey)
      // Persos legacy sans gender (ou héritage invalide 'other') → 'female' (l'auteur peut corriger)
      setGender(editingCharacter.gender === 'male' ? 'male' : 'female')
      setPrompt(editingCharacter.prompt ?? '')
      setPortraitUrl(editingCharacter.portraitUrl)
      setFullbodyUrl(editingCharacter.fullbodyUrl)
      // Hydrate la galerie depuis editingCharacter.images. Migration douce :
      // si l'ancienne colonne fullbodyBackUrl est set MAIS pas encore dans
      // images (= perso créé avant migration 079), on la migre à l'open
      // pour que l'auteur retrouve sa vue de dos.
      const baseImages: import('@/types').NpcImage[] = editingCharacter.images ?? []
      const hasBackInImages = baseImages.some(i => i.kind === 'view_back')
      const migrated = !hasBackInImages && editingCharacter.fullbodyBackUrl
        ? [{
            id: `legacy-back-${editingCharacter.id}`,
            url: editingCharacter.fullbodyBackUrl,
            label: 'Vue de dos',
            source: 'qwen_multiangle' as const,
            kind: 'view_back' as const,
          }, ...baseImages]
        : baseImages
      setImages(migrated)
      setGeneratingAngle(null); setAngleGenError(null)
      // Phases done si l'image existe déjà
      setPortraitPhase(editingCharacter.portraitUrl ? 'done' : 'idle')
      setFullbodyPhase(editingCharacter.fullbodyUrl ? 'done' : 'idle')
      setPortraitError(null); setFullbodyError(null)
      setPortraitProgressLabel(''); setFullbodyProgressLabel('')
      // voice_id depuis prop initialVoiceId (le wrapper le passe depuis npcs.voice_id)
      setVoiceId(initialVoiceId ?? '')
      // Hydrate npcType depuis editingCharacter.type (cast — le Character store
      // ne déclare pas ce field, mais l'hydratation NPCs côté page.tsx peut
      // l'avoir injecté). Défaut 'allié'. Phase C 2026-05-12.
      const extType = (editingCharacter as { type?: import('@/types').NpcType }).type
      setNpcType(extType ?? 'allié')
    } else if (initialPortraitUrl || initialFullbodyUrl) {
      // Mode CRÉATION pré-rempli (cas extraction depuis photo, refonte 2026-05-09).
      // L'auteur arrive avec une ou deux images déjà détourées — on les pousse
      // dans les slots correspondants en phase 'done' pour qu'il puisse Save
      // direct ou ajuster (régen / importer une autre).
      if (initialPortraitUrl) {
        setPortraitUrl(initialPortraitUrl)
        setPortraitPhase('done')
      }
      if (initialFullbodyUrl) {
        setFullbodyUrl(initialFullbodyUrl)
        setFullbodyPhase('done')
      }
    }
  }, [open, editingCharacter, initialVoiceId, initialPortraitUrl, initialFullbodyUrl])

  // Invalidation : si le portrait change (regen ou clear), on jette le plein
  // pied — il a été swappé sur l'ancien portrait, plus valide.
  // Skip-flag pour les cas où l'auteur a explicitement supprimé le portrait :
  // il ne veut PAS qu'on cascade-supprime le plein pied/galerie en plus.
  // Refonte 2026-05-12 — fix bug "Supprimer le portrait supprime toutes les images".
  const prevPortraitUrlRef = useRef<string | null>(null)
  const skipPortraitCascadeRef = useRef(false)
  useEffect(() => {
    if (skipPortraitCascadeRef.current) {
      skipPortraitCascadeRef.current = false
      prevPortraitUrlRef.current = portraitUrl
      return
    }
    if (prevPortraitUrlRef.current !== portraitUrl && prevPortraitUrlRef.current !== null) {
      // Vraie transition (pas le mount initial où prev=null)
      setFullbodyPhase('idle'); setFullbodyUrl(null); setFullbodyError(null)
      setFullbodyProgressLabel('')
    }
    prevPortraitUrlRef.current = portraitUrl
  }, [portraitUrl])

  // ── Computed ───────────────────────────────────────────────────────────
  const portraitBusy = portraitPhase === 'generating'
  const fullbodyBusy = fullbodyPhase === 't2i' || fullbodyPhase === 'facedetailer'
  const promptOk = prompt.trim().length > 0

  // Détection nom doublon (case-insensitive, trim). En édition, le perso peut
  // garder son propre nom (= excluded de la liste de comparaison). Refonte
  // 2026-05-11 — fix UX : empêche d'avoir 3 "Roman" dans la banque qui se
  // ressemblent et confondent le mapping Vantage IC LoRA Dual.
  const trimmedName = name.trim().toLowerCase()
  const nameDuplicate = trimmedName.length > 0 && allCharacters.some(c =>
    c.id !== editingCharacter?.id && c.name.trim().toLowerCase() === trimmedName
  )

  const canGenerateFullbody = !!portraitUrl && !portraitBusy && !fullbodyBusy && promptOk
  const canSave = name.trim().length > 0 && (portraitUrl || fullbodyUrl) && !nameDuplicate

  async function generatePortrait() {
    if (!promptOk || portraitBusy) return
    setPortraitPhase('generating'); setPortraitError(null); setPortraitUrl(null)
    setPortraitProgressLabel('Préparation…')
    // Active le BakeProgressModal global → bloque l'UI pendant ~25-75s pour
    // éviter perte de state (clic ailleurs = unmount du modal = gen perdue).
    setBakeStatus({
      startedAt: Date.now(),
      phase: 'Préparation…',
      kind: 'portrait',
      estimatedTotalSec: engine === 'z_image' ? 25
        : engine === 'sdxl_juggernaut' ? 35
        : engine === 'flux_dev_fast' ? 40
        : 75,
    })

    // Helper local : sync le label local. Le BakeProgressModal a son propre
    // chrono auto-incrémenté → on n'update PAS sa phase à chaque tick (le
    // setBakeStatus n'accepte pas de callback de toute façon).
    const updateLabel = (label: string) => {
      setPortraitProgressLabel(label)
    }

    try {
      let url: string
      if (engine === 'z_image') {
        // Z-Image bilingue (text encoder Qwen 3) → comprend le FR directement,
        // pas besoin de traduire. Prompt = framing + user + style suffix.
        // Refonte 2026-05-19 — negative prompt par style (cf STYLE_NEGATIVE).
        const fullPrompt = `${PORTRAIT_FRAMING}, ${prompt.trim()}, ${STYLE_SUFFIX[style]}`
        url = await runZImage({
          prompt: fullPrompt,
          negativePrompt: STYLE_NEGATIVE[style],
          width: 1024, height: 1024,
          storagePathPrefix: `${storagePathPrefix}_char_portrait_zimage`,
          onProgress: (p) => { if (p.label) updateLabel(p.label) },
        })
      } else if (engine === 'sdxl_juggernaut') {
        // Refonte 2026-05-19 — SDXL Juggernaut XL v9 via workflow `portrait`
        // existant (buildPortraitWorkflow). Photoréalisme strict, moins de
        // bascule anime que Z-Image. Le backend ajoute STYLE_SUFFIXES côté
        // workflow — on passe juste user prompt + framing.
        const fullPrompt = `${PORTRAIT_FRAMING}, ${prompt.trim()}, ${STYLE_SUFFIX[style]}`
        url = await runSdxlPortrait({
          prompt: fullPrompt,
          negativePrompt: STYLE_NEGATIVE[style],
          checkpoint: 'juggernaut',
          // style côté backend (mapping différent du CharacterStyle frontend) —
          // on force 'realistic' qui est le suffix le plus neutre, puisque le
          // STYLE_SUFFIX frontend est déjà inclus dans le fullPrompt.
          style: 'realistic',
          width: 1024, height: 1024,
          storagePathPrefix: `${storagePathPrefix}_char_portrait_sdxl`,
          onProgress: (p) => { if (p.label) updateLabel(p.label) },
        })
      } else {
        // Flux Dev (Q5_K_S qualité OU Q4_K_S rapide) via T5 → préfère
        // l'anglais. On traduit le prompt user FR→EN via /api/translate-prompt.
        updateLabel('Traduction du prompt…')
        let userPromptEn = prompt.trim()
        try {
          const trRes = await fetch('/api/translate-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_fr: prompt.trim(), is_portrait: true }),
          })
          if (trRes.ok) {
            const td = await trRes.json() as { positive?: string }
            if (td.positive) userPromptEn = td.positive
          }
        } catch (trErr) {
          console.warn('[CharacterCreator] Flux translation fallback to raw FR:', trErr)
        }
        const fullPrompt = `${PORTRAIT_FRAMING}, ${userPromptEn}, ${STYLE_SUFFIX[style]}`
        url = await runFluxDev({
          prompt: fullPrompt,
          // Refonte 2026-05-19 — negative dynamique par style (cf STYLE_NEGATIVE).
          negativePrompt: STYLE_NEGATIVE[style],
          width: 1024, height: 1024,
          // Q5_K_S (qualité, ~75s) ou Q4_K_S (rapide, ~40s, sweet spot 8 GB)
          unetFile: FLUX_DEV_FILES[engine],
          storagePathPrefix: `${storagePathPrefix}_char_portrait_flux`,
          onProgress: (p) => { if (p.label) updateLabel(p.label) },
        })
      }
      setPortraitUrl(url); setPortraitPhase('done'); setPortraitProgressLabel('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[CharacterCreator] portrait failed:', msg)
      setPortraitError(msg); setPortraitPhase('error'); setPortraitProgressLabel('')
    } finally {
      // Ferme le BakeProgressModal global même en cas d'erreur — sinon UI
      // restée bloquée sur loader fantôme.
      setBakeStatus(null)
    }
  }

  async function generateFullbody() {
    if (!canGenerateFullbody || !portraitUrl) return
    setFullbodyPhase('t2i'); setFullbodyError(null); setFullbodyUrl(null)
    setFullbodyProgressLabel('Analyse du portrait…')
    // Active BakeProgressModal — bloque l'UI pendant ~75-120s (vision +
    // body T2I + FaceDetailer). Estimation conservative.
    setBakeStatus({
      startedAt: Date.now(),
      phase: 'Analyse du portrait…',
      kind: 'fullbody',
      estimatedTotalSec: engine === 'z_image' ? 60 : engine === 'flux_dev_fast' ? 90 : 120,
    })

    // Helper local : sync le label local (BakeProgressModal a son chrono auto)
    const updateLabel = (label: string) => {
      setFullbodyProgressLabel(label)
    }

    try {
      // ── PHASE 0 : analyse vision du portrait pour cohérence visuelle ─
      // Le userPrompt initial peut diverger du résultat portrait (modèle a
      // ré-interprété "chapeau classique" différemment). Pour que le fullbody
      // reproduise EXACTEMENT le perso visible dans le portrait (chapeau,
      // costume, couleurs), on analyse le portrait via Qwen 2.5 VL local
      // (gratuit, ~5-10s) → descripteurs SDXL-friendly EN.
      // Décision 2026-05-03 : remplacer userPrompt par cette description vision
      // pour le fullbody. userPrompt reste utilisé UNIQUEMENT pour le portrait.
      let visionDescription: string | null = null
      try {
        const visRes = await fetch('/api/describe-portrait', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: portraitUrl, engine: 'qwen' }),
        })
        if (visRes.ok) {
          const vd = await visRes.json() as { description?: string; engine_used?: string }
          if (vd.description) {
            visionDescription = vd.description
            console.log('[CharacterCreator] portrait analyzed (' + (vd.engine_used ?? 'qwen') + '):', visionDescription)
          }
        }
      } catch (visErr) {
        console.warn('[CharacterCreator] vision analysis failed, fallback userPrompt:', visErr)
      }

      // Si vision a retourné une description NON-VIDE, on l'utilise. Sinon
      // fallback userPrompt (résilience — la gen ne doit pas être bloquée par
      // vision). On utilise || (pas ??) pour fallback aussi sur string vide.
      const characterDescription = (visionDescription && visionDescription.trim()) || prompt.trim()

      setFullbodyPhase('t2i'); updateLabel('Génération du corps…')

      // ── PHASE 1 : T2I body avec le MÊME moteur que le portrait ────────
      // → style cohérent portrait↔body (couleurs, anime/comic/etc. matchent)
      // Le visage généré ici est random — on le swap juste après avec FaceDetailer.
      let bodyT2IUrl: string

      if (engine === 'z_image') {
        // Z-Image bilingue : on lui passe direct la description (vision = EN, ou
        // fallback userPrompt FR — Z-Image gère les deux).
        const fullPrompt = `${FULLBODY_FRAMING}, ${characterDescription}, ${STYLE_SUFFIX[style]}`
        bodyT2IUrl = await runZImage({
          prompt: fullPrompt,
          width: 832, height: 1216,  // ~9:13 vertical, multiple de 64
          storagePathPrefix: `${storagePathPrefix}_char_fullbody_t2i_zimage`,
          onProgress: (p) => { if (p.label) updateLabel(`Corps · ${p.label}`) },
        })
      } else if (engine === 'sdxl_juggernaut') {
        // Refonte 2026-05-19 — SDXL Juggernaut pour fullbody. Idem portrait :
        // pipeline workflow `portrait` (cf comfyui.ts).
        const fullPrompt = `${FULLBODY_FRAMING}, ${characterDescription}, ${STYLE_SUFFIX[style]}`
        bodyT2IUrl = await runSdxlPortrait({
          prompt: fullPrompt,
          negativePrompt: FULLBODY_NEGATIVE,
          checkpoint: 'juggernaut',
          style: 'realistic',
          width: 832, height: 1216,
          storagePathPrefix: `${storagePathPrefix}_char_fullbody_t2i_sdxl`,
          onProgress: (p) => { if (p.label) updateLabel(`Corps · ${p.label}`) },
        })
      } else {
        // Flux Dev : la description vient de Qwen (déjà EN). Si vision a fail
        // et qu'on fallback sur userPrompt FR → on traduit. Sinon traduction
        // inutile (vision EN déjà bon).
        let descriptionEn = characterDescription
        let negativeEn = ''
        if (!visionDescription) {
          // Fallback userPrompt → translate FR→EN
          try {
            const trRes = await fetch('/api/translate-prompt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt_fr: characterDescription }),
            })
            if (trRes.ok) {
              const td = await trRes.json() as { positive?: string; negative?: string }
              if (td.positive) descriptionEn = td.positive
              if (td.negative) negativeEn = td.negative
            }
          } catch {/* keep raw */}
        }
        const fullPrompt = `${FULLBODY_FRAMING}, ${descriptionEn}, ${STYLE_SUFFIX[style]}`
        const fullNegative = [FULLBODY_NEGATIVE, negativeEn].filter(Boolean).join(', ')
        bodyT2IUrl = await runFluxDev({
          prompt: fullPrompt,
          negativePrompt: fullNegative,
          width: 832, height: 1216,
          unetFile: FLUX_DEV_FILES[engine],
          storagePathPrefix: `${storagePathPrefix}_char_fullbody_t2i_flux`,
          onProgress: (p) => { if (p.label) updateLabel(`Corps · ${p.label}`) },
        })
      }

      // ── PHASE 2 : FaceDetailer swap visage avec portrait_ref ──────────
      // → identité du portrait projetée sur le visage du body T2I
      setFullbodyPhase('facedetailer')
      updateLabel('Affinage du visage…')

      const finalUrl = await runFaceDetailer({
        sourceUrl: bodyT2IUrl,
        refUrl: portraitUrl,
        prompt: prompt.trim() || undefined,
        storagePathPrefix: `${storagePathPrefix}_char_fullbody_face`,
        onProgress: (p) => { if (p.label) updateLabel(`Visage · ${p.label}`) },
      })

      setFullbodyUrl(finalUrl); setFullbodyPhase('done'); setFullbodyProgressLabel('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[CharacterCreator] fullbody pipeline failed:', msg)
      setFullbodyError(msg); setFullbodyPhase('error'); setFullbodyProgressLabel('')
    } finally {
      // Ferme BakeProgressModal global (résultat OU erreur — sinon UI bloquée)
      setBakeStatus(null)
    }
  }

  /** Upload manuel : lit le file en data URL puis POST /api/storage/upload-image.
   *  Bypass total du pipeline IA — l'auteur a déjà l'image qu'il veut.
   *  Slots canoniques : 'portrait' / 'fullbody'. Pour les uploads d'angles
   *  alternatifs ou de variantes → uploadGalleryItem (ci-dessous). */
  async function uploadFile(file: File, slot: 'portrait' | 'fullbody') {
    if (!file.type.startsWith('image/')) {
      const msg = `Format non supporté : ${file.type || 'inconnu'}`
      if (slot === 'portrait') setPortraitError(msg)
      else setFullbodyError(msg)
      return
    }
    const setUploading = slot === 'portrait' ? setPortraitUploading : setFullbodyUploading
    const setError = slot === 'portrait' ? setPortraitError : setFullbodyError
    const setUrl = slot === 'portrait' ? setPortraitUrl : setFullbodyUrl

    setUploading(true); setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
        reader.readAsDataURL(file)
      })
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${storagePathPrefix}_char_${slot}_upload_${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`
      const res = await fetch('/api/storage/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setUrl(data.url)
      if (slot === 'portrait') setPortraitPhase('done')
      else setFullbodyPhase('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[CharacterCreator] upload ${slot} failed:`, msg)
      setError(msg)
    } finally {
      setUploading(false)
    }
  }

  /** Upload d'un item dans la galerie : angle alternatif (kind=view_X) ou
   *  variante custom (kind=variant). Refonte 2026-05-09 — option B. */
  const [galleryUploading, setGalleryUploading] = useState(false)
  const [galleryError, setGalleryError] = useState<string | null>(null)
  async function uploadGalleryItem(
    file: File,
    kind: 'view_back' | 'view_profile_left' | 'view_profile_right' | 'variant' | 'custom',
    label: string,
  ) {
    if (!file.type.startsWith('image/')) {
      setGalleryError(`Format non supporté : ${file.type || 'inconnu'}`)
      return
    }
    setGalleryUploading(true); setGalleryError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
        reader.readAsDataURL(file)
      })
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `${storagePathPrefix}_char_gallery_${kind}_${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`
      const res = await fetch('/api/storage/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error ?? `HTTP ${res.status}`)
      const newItem: import('@/types').NpcImage = {
        id: `${kind}-${Date.now()}`,
        url: data.url,
        label,
        kind,
        source: 'upload',
      }
      // Si angle existant → remplace. Si variant/custom → push (peut y en avoir N).
      const isAngle = kind === 'view_back' || kind === 'view_profile_left' || kind === 'view_profile_right'
      setImages(prev => isAngle
        ? [...prev.filter(i => i.kind !== kind), newItem]
        : [...prev, newItem],
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[CharacterCreator] gallery upload ${kind} failed:`, msg)
      setGalleryError(msg)
    } finally {
      setGalleryUploading(false)
    }
  }
  function removeGalleryItem(id: string) {
    setImages(prev => prev.filter(i => i.id !== id))
  }
  function updateGalleryItemLabel(id: string, label: string) {
    setImages(prev => prev.map(i => i.id === id ? { ...i, label } : i))
  }

  /** Génère un angle alternatif du Plein pied via Qwen Image Edit + multi-angles
   *  LoRA. Pattern : free VRAM × 2 + cooldown (Qwen Edit ~10 GB sur 8 GB VRAM
   *  exige unload complet) → upload source → free → queue qwen_multiangle avec
   *  prompt langage naturel → poll → fetch URL → push dans `images`. ~30-60s
   *  par gen. Cf flux-kontext/page.tsx → handleRotateRef pour le pattern.
   *  Si l'angle existe déjà dans la galerie, on REMPLACE (= régénération). */
  async function handleGenerateAngle(angleKind: 'view_back' | 'view_profile_left' | 'view_profile_right') {
    if (!fullbodyUrl || generatingAngle !== null) return
    setGeneratingAngle(angleKind)
    setAngleGenError(null)
    try {
      // Free × 2 (Qwen Edit ~10 GB, ne tient que si tout est unload)
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 2500))
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 2500))

      // Map angle → prompt + label affiché dans la galerie.
      const ANGLE_CONFIG = {
        view_back:          { prompt: 'Rotate the camera 180 degrees to show the back of the character. Keep the same character, same clothing, same colors, same proportions.', label: 'Vue de dos',     pathSuffix: 'back' },
        view_profile_left:  { prompt: 'Rotate the camera 90 degrees to the left to show the left profile of the character. Keep the same character, same clothing, same colors, same proportions.', label: 'Profil gauche', pathSuffix: 'profile_left' },
        view_profile_right: { prompt: 'Rotate the camera 90 degrees to the right to show the right profile of the character. Keep the same character, same clothing, same colors, same proportions.', label: 'Profil droit',  pathSuffix: 'profile_right' },
      } as const
      const { prompt: promptText, label, pathSuffix } = ANGLE_CONFIG[angleKind]

      // Upload current fullbody to ComfyUI input folder
      const upRes = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: fullbodyUrl, name: `qmangle_${pathSuffix}_src` }),
      }).then(r => r.json()) as { filename?: string; error?: string }
      if (!upRes.filename) throw new Error(upRes.error ?? 'upload échoué')

      // Re-free juste avant queue (l'upload a pu réserver du buffer)
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 2000))

      // Queue qwen_multiangle workflow avec prompt EN LANGAGE NATUREL (refonte
      // 2026-05-09 : remplace le format `<sks> ... view shot` qui était un
      // trigger de la LoRA Qwen 2509 v1, plus pertinent en 2511).
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'qwen_multiangle',
          source_image: upRes.filename,
          prompt_positive: promptText,
          prompt_negative: 'blurry, low quality, deformed, distorted face, different person, different clothing',
          steps: 4, cfg: 1, seed: -1,
        }),
      }).then(r => r.json()) as { prompt_id?: string; error?: string }
      if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'queue échoué')

      // Poll status (max 10 min — Qwen Edit sur 8 GB lowvram peut prendre 3-7 min)
      const maxWait = Date.now() + 10 * 60 * 1000
      let succeeded = false
      let pollCount = 0
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 4000))
        pollCount++
        const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json()) as
          { status?: string; error?: string; execution_errors?: unknown }
        if (pollCount % 5 === 1) {
          console.log(`[handleGenerateAngle ${angleKind}] poll #${pollCount} status=${sData.status}`)
        }
        if (sData.error) {
          console.error(`[handleGenerateAngle ${angleKind}] ComfyUI errors:`, sData.execution_errors)
          throw new Error(sData.error)
        }
        if (sData.status === 'failed') throw new Error('génération échouée (cf console ComfyUI)')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout (10 min) — ComfyUI bloqué ou OOM ? Check console')

      // Status = succeeded → 2e appel pour récupérer l'URL Supabase finale
      const storagePath = `${storagePathPrefix}_${pathSuffix}_${Date.now()}`
      const iData = await fetch(
        `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`,
      ).then(r => r.json()) as { image_url?: string; error?: string }
      if (!iData.image_url) {
        throw new Error(iData.error ?? 'récupération de l\'URL image échouée')
      }
      // Push dans la galerie (remplace l'angle existant si déjà là).
      const newItem: import('@/types').NpcImage = {
        id: `${angleKind}-${Date.now()}`,
        url: iData.image_url,
        label,
        kind: angleKind,
        source: 'qwen_multiangle',
      }
      setImages(prev => [
        ...prev.filter(i => i.kind !== angleKind),
        newItem,
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[handleGenerateAngle ${angleKind}]`, msg)
      setAngleGenError(msg)
    } finally {
      setGeneratingAngle(null)
    }
  }

  /** Handler "Demander à l'IA" pour l'édition du portrait via Qwen Edit
   *  (phase B 2026-05-12). Skip cascade pour pas perdre le fullbody. */
  async function handleAiEditApply() {
    if (!portraitUrl || aiEditBusy) return
    const promptText = aiEditPrompt.trim()
    if (!promptText) return
    setAiEditBusy(true)
    setAiEditError(null)
    setAiEditLabel('Préparation…')
    try {
      const newUrl = await runQwenImageEdit({
        sourceUrl: portraitUrl,
        prompt: promptText,
        storagePathPrefix: `${storagePathPrefix}_portrait_ai_edit`,
        useLightning: true,
        onProgress: p => setAiEditLabel(p.label ?? p.stage),
      })
      // Skip le cascade portrait→fullbody : l'auteur édite SON portrait,
      // pas un swap d'identité — le fullbody reste valide.
      skipPortraitCascadeRef.current = true
      setPortraitUrl(newUrl)
      setPortraitPhase('done')
      setPortraitError(null)
      setAiEditPortraitOpen(false)
      setAiEditPrompt('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setAiEditError(msg)
    } finally {
      setAiEditBusy(false)
      setAiEditLabel('')
    }
  }

  async function handleSave() {
    if (!canSave || saving) return
    setSaving(true); setSaveError(null)
    // fullbodyBackUrl déprécié : on dérive du 1er item kind=view_back de la
    // galerie pour garder la colonne legacy à jour (back-compat). Les
    // pipelines downstream qui lisent encore fullbody_back_url voient la
    // dernière vue de dos générée.
    const backFromGallery = images.find(i => i.kind === 'view_back')?.url ?? null
    const payload: CharacterCreatorPayload = {
      name: name.trim(),
      style,
      gender,
      prompt: prompt.trim() || null,
      portraitUrl,
      fullbodyUrl,
      engine,
      voiceId: voiceId || null,
      fullbodyBackUrl: backFromGallery,
      images,
    }
    try {
      let savedId: string
      // Priorité : prop onPersist (custom wrapper) > context (Designer DB
      // persist via new-layout/page.tsx) > CharacterStore local fallback.
      const effectivePersist = onPersist ?? persistFromContext
      if (effectivePersist) {
        // Persistance distante (Supabase npcs)
        savedId = await effectivePersist(
          payload,
          isEditMode ? 'edit' : 'create',
          isEditMode ? editingCharacter?.id : undefined,
        )
        // Update local store en plus pour que le perso apparaisse direct
        // (sinon il faut F5 pour voir les changements). Si store absent → skip.
        if (characterStore) {
          if (isEditMode && editingCharacter) {
            characterStore.updateCharacter(editingCharacter.id, {
              name: payload.name,
              style: payload.style,
              gender: payload.gender,
              prompt: payload.prompt ?? undefined,
              portraitUrl: payload.portraitUrl,
              fullbodyUrl: payload.fullbodyUrl,
              fullbodyBackUrl: payload.fullbodyBackUrl ?? null,
            })
          }
          // Note : pas de addCharacter ici en mode 'create' parce que le
          // wrapper onPersist côté new-layout/page.tsx s'en charge déjà.
        }
      } else if (characterStore) {
        // Fallback Designer standalone : CharacterStore localStorage seul
        if (isEditMode && editingCharacter) {
          characterStore.updateCharacter(editingCharacter.id, {
            name: payload.name,
            style: payload.style,
            gender: payload.gender,
            prompt: payload.prompt ?? undefined,
            portraitUrl: payload.portraitUrl,
            fullbodyUrl: payload.fullbodyUrl,
            fullbodyBackUrl: payload.fullbodyBackUrl ?? null,
          })
          savedId = editingCharacter.id
        } else {
          const created = characterStore.addCharacter({
            name: payload.name,
            style: payload.style,
            gender: payload.gender,
            prompt: payload.prompt ?? undefined,
            portraitUrl: payload.portraitUrl,
            fullbodyUrl: payload.fullbodyUrl,
            fullbodyBackUrl: payload.fullbodyBackUrl ?? null,
          })
          savedId = created.id
        }
      } else {
        throw new Error('CharacterCreatorModal : ni onPersist ni CharacterStoreProvider')
      }
      onCreated?.(savedId)
      onClose()
    } catch (err) {
      // Sérialisation robuste : Error → .message, objet → JSON, primitif → String.
      // Avant : String(err) sur un objet donnait "[object Object]" et masquait le
      // message réel (ex: { error: 'foo', code: 500 }).
      let msg: string
      if (err instanceof Error) {
        msg = err.message || err.name || 'Error sans message'
      } else if (err && typeof err === 'object') {
        // Heuristique : prend .message ou .error ou JSON full.
        const obj = err as Record<string, unknown>
        msg = String(obj.message ?? obj.error ?? JSON.stringify(err))
      } else {
        msg = String(err)
      }
      console.error('[CharacterCreator] save failed:', msg, '— raw:', err)
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ccm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          // Pas de onClick={onClose} — modal sticky : seul X / Annuler ferme.
          // Évite la perte de travail si l'auteur clique en dehors par erreur
          // (les générations + métadonnées prennent du temps à recréer).
        >
          <motion.div
            className="ccm-modal"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ccm-title"
          >
            {/* Header partagé (phase C 2026-05-12) : portrait identité
             *  cliquable (→ AI edit) + Nom + Type + Description visuelle.
             *  Toujours visible quel que soit l'onglet. */}
            <header className="ccm-header">
              <button
                type="button"
                className="ccm-header-portrait"
                onClick={() => {
                  if (!portraitUrl) return
                  setAiEditPrompt('')
                  setAiEditError(null)
                  setAiEditPortraitOpen(true)
                }}
                disabled={!portraitUrl}
                title={portraitUrl
                  ? "Cliquer pour éditer le portrait avec l'IA (ex: enlève les lunettes)"
                  : "Génère d'abord un portrait dans l'onglet Images"}
                aria-label="Éditer le portrait avec l'IA"
              >
                {portraitUrl
                  ? <img src={portraitUrl} alt="Portrait" />
                  : <ImagePlus size={22} />}
              </button>
              <div className="ccm-header-fields">
                <div className="ccm-header-row1">
                  <input
                    id="ccm-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Nom du personnage"
                    className={`ccm-header-name-input ${nameDuplicate ? 'ccm-input-error' : ''}`}
                    autoFocus
                    aria-invalid={nameDuplicate}
                  />
                  <select
                    className="ccm-header-type-select"
                    value={npcType}
                    onChange={e => setNpcType(e.target.value as import('@/types').NpcType)}
                    title="Type narratif (depuis la fiche NPC)"
                  >
                    <option value="allié">🤝 Allié</option>
                    <option value="ennemi">⚔ Ennemi</option>
                    <option value="boss">👑 Boss</option>
                    <option value="neutre">🌫 Neutre</option>
                    <option value="marchand">🪙 Marchand</option>
                  </select>
                </div>
                {/* Refonte 2026-05-19 — Wrapper relatif pour héberger le
                 *  bouton ✨ "Améliorer" en absolute bottom-right de la textarea.
                 *  Le bouton appelle Mistral via /api/character/enhance-prompt
                 *  et remplace la valeur. revertPromptEnhance permet d'annuler. */}
                <div className="ccm-prompt-wrap">
                  <textarea
                    className="ccm-header-prompt"
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="Description visuelle (ex: Jeune elfe aux cheveux blonds tressés…)"
                    rows={4}
                    disabled={enhancingPrompt}
                  />
                  <div className="ccm-prompt-actions">
                    {previousPromptBeforeEnhance !== null && !enhancingPrompt && (
                      <button
                        type="button"
                        className="ccm-prompt-revert-btn"
                        onClick={revertPromptEnhance}
                        title="Annuler l'amélioration et revenir au texte précédent"
                      >
                        ↶ Annuler
                      </button>
                    )}
                    <button
                      type="button"
                      className="ccm-prompt-enhance-btn"
                      onClick={enhancePromptWithAI}
                      disabled={enhancingPrompt || !prompt.trim()}
                      title={enhancingPrompt
                        ? 'Mistral réfléchit…'
                        : !prompt.trim()
                          ? 'Écris d\'abord une courte description'
                          : 'Améliorer la description avec l\'IA (Mistral)'}
                      aria-label="Améliorer avec l'IA"
                    >
                      {enhancingPrompt
                        ? <Loader2 size={12} className="ccm-spin" />
                        : <Sparkles size={12} />}
                      <span>{enhancingPrompt ? '…' : 'Améliorer'}</span>
                    </button>
                  </div>
                </div>
                {enhanceError && (
                  <div className="ccm-field-error">
                    ⚠ {enhanceError}
                  </div>
                )}
                {nameDuplicate && (
                  <div className="ccm-field-error">
                    ⚠ Un personnage nommé « {name.trim()} » existe déjà.
                  </div>
                )}
              </div>
              <button type="button" onClick={onClose} className="ccm-close" aria-label="Fermer">
                <X size={16} />
              </button>
            </header>

            {/* Barre onglets (refonte fiche perso 2026-05-12, phase A). Le
             *  Nom + Apparence restent dans Identité pour V1 ; phase C montera
             *  Nom + Portrait identité + Type + Description en header partagé. */}
            <nav className="ccm-tabs" role="tablist" aria-label="Onglets fiche personnage">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'identity'}
                className={`ccm-tab ${activeTab === 'identity' ? 'active' : ''}`}
                onClick={() => setActiveTab('identity')}
              >
                Identité
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'images'}
                className={`ccm-tab ${activeTab === 'images' ? 'active' : ''}`}
                onClick={() => setActiveTab('images')}
              >
                Images
              </button>
              {/* Refonte 2026-05-19 — Galerie extraite de l'onglet Images dans
               *  son propre tab (libère la modale + scope clair). */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'gallery'}
                className={`ccm-tab ${activeTab === 'gallery' ? 'active' : ''}`}
                onClick={() => setActiveTab('gallery')}
              >
                Galerie
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'traits'}
                className={`ccm-tab ${activeTab === 'traits' ? 'active' : ''}`}
                onClick={() => setActiveTab('traits')}
              >
                Caractéristiques
              </button>
            </nav>

            <div className="ccm-body" data-active-tab={activeTab}>
              {/* ── Onglet Identité — champs texte (Nom, Style, Apparence,
               *     Moteur, Voix, Description visuelle). Refonte phase A 2026-05-12.
               *     Nom + Apparence remontent en header partagé en phase C. */}
              {activeTab === 'identity' && (
              <div className="ccm-col ccm-col-form">
                {/* Nom + Description déplacés dans le header partagé (phase C
                 *  2026-05-12). L'onglet Identité ne garde que les paramètres
                 *  de génération (style/moteur/voix) + apparence ♀/♂. */}

                {/* Style — dropdown 7 options */}
                <div className="ccm-field">
                  <label htmlFor="ccm-style-select">Style</label>
                  <select
                    id="ccm-style-select"
                    className="ccm-select"
                    value={style}
                    onChange={e => setStyle(e.target.value as CharacterStyle)}
                  >
                    {STYLE_ORDER.map(key => (
                      <option key={key} value={key}>{STYLE_LABELS[key]}</option>
                    ))}
                  </select>
                </div>

                {/* Apparence — drive les slots typés LTX IC LoRA Dual (Male:/Female:) */}
                <div className="ccm-field">
                  <label>Apparence</label>
                  <div className="ccm-radio-row ccm-radio-row-2">
                    <label className={`ccm-radio ${gender === 'female' ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="ccm-gender"
                        checked={gender === 'female'}
                        onChange={() => setGender('female')}
                      />
                      <span>♀ Femme</span>
                    </label>
                    <label className={`ccm-radio ${gender === 'male' ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="ccm-gender"
                        checked={gender === 'male'}
                        onChange={() => setGender('male')}
                      />
                      <span>♂ Homme</span>
                    </label>
                  </div>
                </div>

                {/* Moteur portrait : déplacé en split-button du slot Portrait
                 *  (refonte UX 2026-05-12). Le choix se fait au moment de
                 *  "Régénérer" via le chevron à droite du bouton principal —
                 *  contexte = génération. */}

                {/* Voix ElevenLabs — uniquement si voices passé en prop par
                    le wrapper (BookNpcCreatorModal). Le Designer legacy ne
                    passe pas de voices → ce bloc n'apparaît pas. */}
                {voices && voices.length > 0 && (
                  <div className="ccm-field">
                    <label htmlFor="ccm-voice">🎙 Voix ElevenLabs</label>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <select
                        id="ccm-voice"
                        className="ccm-select"
                        value={voiceId}
                        onChange={e => setVoiceId(e.target.value)}
                        disabled={saving}
                        style={{ flex: 1 }}
                      >
                        <option value="">— Aucune voix —</option>
                        {voices.map(v => (
                          <option key={v.voice_id} value={v.voice_id}>
                            {v.name}
                            {v.labels.gender ? ` · ${v.labels.gender}` : ''}
                            {v.labels.accent ? ` · ${v.labels.accent}` : ''}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const v = voices.find(x => x.voice_id === voiceId)
                        return v?.preview_url
                          ? <audio controls src={v.preview_url} style={{ height: '1.75rem', maxWidth: '12rem' }} />
                          : null
                      })()}
                    </div>
                  </div>
                )}

                {/* Description visuelle déplacée dans le header partagé
                 *  (phase C 2026-05-12). */}
              </div>
              )}

              {/* ── Onglet Images — Portrait + Plein pied carousel + Galerie.
               *     Refonte phase A 2026-05-12. */}
              {activeTab === 'images' && (
              <>
              <div className="ccm-col ccm-col-slots">
                <ImageSlot
                  label="Portrait"
                  hint={
                    engine === 'z_image'         ? '⚡ Z-Image · ~25s' :
                    engine === 'sdxl_juggernaut' ? '📷 Juggernaut · ~35s' :
                    engine === 'flux_dev_fast'   ? '🚀 Flux · ~40s' :
                                                    '✨ Flux HQ · ~75s'
                  }
                  url={portraitUrl}
                  busy={portraitBusy || portraitUploading}
                  busyLabel={portraitUploading ? 'Upload…' : (portraitProgressLabel || 'Génération…')}
                  disabled={!promptOk || portraitBusy || portraitUploading}
                  onGenerate={generatePortrait}
                  onUpload={(f) => uploadFile(f, 'portrait')}
                  onPreview={() => portraitUrl && setLightboxUrl(portraitUrl)}
                  warning={portraitError ?? undefined}
                  enginePicker={{ value: engine, onChange: setEngine }}
                  onDelete={() => {
                    // Skip le cascade portrait→fullbody : suppression explicite
                    // ≠ régénération. L'auteur ne veut PAS perdre son fullbody
                    // en plus de son portrait. Refonte 2026-05-12.
                    skipPortraitCascadeRef.current = true
                    setPortraitUrl(null)
                    setPortraitPhase('idle')
                    setPortraitError(null)
                  }}
                  // Bouton "Du plein pied" : ouvre le CropImageModal (manuel)
                  // sur fullbodyUrl. L'auteur sélectionne la zone tête + buste
                  // (preset 1:1) puis valide. Plus fiable que les heuristiques
                  // auto (chapeau / plume / coiffures hautes faussaient le top %).
                  // Refonte 2026-05-12 (crop manuel).
                  onExtractFromFullbody={() => {
                    if (!fullbodyUrl) return
                    setCropFromFullbodyOpen(true)
                  }}
                  extractDisabled={!fullbodyUrl}
                />
                {/* Plein pied = carousel 4 angles (Face canonique + Dos /
                 *  Profil G / Profil D dans la galerie). Refonte 2026-05-09.
                 *  Arrows pour cycler, dots indicateurs. La face est
                 *  sauvegardée sous fullbodyUrl, les autres dans `images`. */}
                {(() => {
                  const angleUrls: Record<PleinPiedAngle, string | null> = {
                    face: fullbodyUrl,
                    view_back: images.find(i => i.kind === 'view_back')?.url ?? null,
                    view_profile_left: images.find(i => i.kind === 'view_profile_left')?.url ?? null,
                    view_profile_right: images.find(i => i.kind === 'view_profile_right')?.url ?? null,
                  }
                  const currentIdx = ANGLE_ORDER.indexOf(pleinPiedAngle)
                  const cycle = (dir: -1 | 1) => setPleinPiedAngle(
                    ANGLE_ORDER[(currentIdx + dir + ANGLE_ORDER.length) % ANGLE_ORDER.length],
                  )
                  const isFace = pleinPiedAngle === 'face'
                  const angleBusy = generatingAngle === pleinPiedAngle
                  const currentUrl = angleUrls[pleinPiedAngle]
                  const angleHint = isFace
                    ? (portraitUrl ? 'FaceDetailer — visage du portrait' : 'génère d\'abord le portrait')
                    : (fullbodyUrl ? 'Qwen multi-angle depuis Face' : 'génère d\'abord la Face')
                  // Génération : si Face → pipeline FaceDetailer. Sinon → Qwen multi-angle.
                  const onGen = isFace
                    ? generateFullbody
                    : () => { void handleGenerateAngle(pleinPiedAngle as 'view_back' | 'view_profile_left' | 'view_profile_right') }
                  const onUp = isFace
                    ? (f: File) => uploadFile(f, 'fullbody')
                    : (f: File) => uploadGalleryItem(f, pleinPiedAngle as 'view_back' | 'view_profile_left' | 'view_profile_right', ANGLE_LABEL[pleinPiedAngle])
                  const disabled = isFace
                    ? !canGenerateFullbody && !fullbodyUploading
                    : !fullbodyUrl || angleBusy || fullbodyBusy
                  const busy = isFace ? (fullbodyBusy || fullbodyUploading) : angleBusy
                  const busyLabel = isFace
                    ? (fullbodyUploading ? 'Upload…' : (fullbodyProgressLabel || 'Génération…'))
                    : 'Qwen Image Edit (~30-60s)…'
                  const warning = isFace ? (fullbodyError ?? undefined) : (angleGenError ?? undefined)
                  return (
                    <div className="ccm-carousel-wrapper">
                      {/* Refonte 2026-05-19 — carousel-header (arrows + title)
                       *  RETIRÉ : les dots Face/Dos/Profil G/Profil D en bas
                       *  servent déjà de sélecteur d'angle + indicateur visuel.
                       *  Le helper `cycle` n'est plus utilisé. */}
                      <ImageSlot
                        label={`Plein pied — ${ANGLE_LABEL[pleinPiedAngle]}`}
                        hint={angleHint}
                        url={currentUrl}
                        busy={busy}
                        busyLabel={busyLabel}
                        disabled={disabled}
                        onGenerate={onGen}
                        onUpload={onUp}
                        onPreview={() => currentUrl && setLightboxUrl(currentUrl)}
                        warning={warning}
                        // Suppression : pour Face = setFullbodyUrl(null) +
                        // reset phase. Pour les autres angles = retire l'entrée
                        // de images[] qui matche le kind. Refonte 2026-05-12.
                        onDelete={isFace
                          ? () => {
                              setFullbodyUrl(null)
                              setFullbodyPhase('idle')
                              setFullbodyError(null)
                            }
                          : () => {
                              const kind = pleinPiedAngle as 'view_back' | 'view_profile_left' | 'view_profile_right'
                              setImages(prev => prev.filter(i => i.kind !== kind))
                            }
                        }
                      />
                      <div className="ccm-carousel-dots" role="tablist" aria-label="Choisir l'angle">
                        {ANGLE_ORDER.map(angle => {
                          const hasUrl = !!angleUrls[angle]
                          const isActive = angle === pleinPiedAngle
                          return (
                            <button
                              key={angle}
                              type="button"
                              role="tab"
                              aria-selected={isActive}
                              className={`ccm-carousel-dot ${isActive ? 'active' : ''} ${hasUrl ? 'has-url' : 'empty'}`}
                              onClick={() => setPleinPiedAngle(angle)}
                              title={`${ANGLE_LABEL[angle]}${hasUrl ? '' : ' (pas généré)'}`}
                            >
                              <span className="ccm-carousel-dot-label">{ANGLE_LABEL[angle]}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
              </div>
              </>
              )}

              {/* ── Onglet Galerie — variantes scéniques (cheveux rouges,
               *     tenue formelle, etc.). Refonte 2026-05-19 — extrait de
               *     l'onglet Images pour libérer la place et clarifier le scope. */}
              {activeTab === 'gallery' && (
                <GallerySection
                  items={images.filter(i =>
                    i.kind !== 'view_back'
                    && i.kind !== 'view_profile_left'
                    && i.kind !== 'view_profile_right',
                  )}
                  uploading={galleryUploading}
                  error={galleryError}
                  onUpload={(file) => {
                    const variantCount = images.filter(i => i.kind === 'variant' || i.kind === 'custom').length
                    void uploadGalleryItem(file, 'variant', `Variante ${variantCount + 1}`)
                  }}
                  onRemove={removeGalleryItem}
                  onUpdateLabel={updateGalleryItemLabel}
                  onPreview={setLightboxUrl}
                />
              )}

              {/* ── Onglet Caractéristiques — placeholder V1 (à faire).
               *     Phase A 2026-05-12 : pose la structure. Remplissage futur :
               *     stats (Force/Agilité/Intelligence depuis npcs), équipement,
               *     etc. */}
              {activeTab === 'traits' && (
                <div className="ccm-col ccm-col-traits">
                  <div className="ccm-traits-placeholder">
                    <h3>Caractéristiques</h3>
                    <p>Section à venir : statistiques (force, agilité, intelligence),
                       équipement, objets de quête, conditions spéciales.</p>
                    <p className="ccm-traits-placeholder-hint">
                      Pour V1, les caractéristiques sont éditables via la fiche
                      complète Studio Section.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <footer className="ccm-footer">
              {saveError && (
                <span className="ccm-save-error" title={saveError}>
                  ⚠ {saveError.length > 90 ? saveError.slice(0, 90) + '…' : saveError}
                </span>
              )}
              <button type="button" onClick={onClose} className="ccm-btn-ghost" disabled={saving}>
                Annuler
              </button>
              <button
                type="button"
                onClick={() => { void handleSave() }}
                disabled={!canSave || saving}
                className="ccm-btn-primary"
                title={!canSave ? 'Renseigne un nom et génère au moins une image' : 'Enregistrer le personnage'}
              >
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </footer>
          </motion.div>

          {/* Lightbox preview agrandi (z-index supérieur au backdrop modal) */}
          <AnimatePresence>
            {lightboxUrl && (
              <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
            )}
          </AnimatePresence>

          {/* Modal "Édition IA du portrait" (phase B 2026-05-12). Click sur
           *  le portrait du header → ouvre cette modal. Input prompt → Qwen
           *  Edit sur portraitUrl → replace en réussite. */}
          <AnimatePresence>
            {aiEditPortraitOpen && portraitUrl && (
              <motion.div
                key="ccm-ai-edit"
                className="ccm-ai-edit-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => { if (!aiEditBusy) setAiEditPortraitOpen(false) }}
              >
                <motion.div
                  className="ccm-ai-edit-modal"
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  onClick={e => e.stopPropagation()}
                >
                  <header className="ccm-ai-edit-header">
                    <span className="ccm-ai-edit-title">
                      <Sparkles size={14} /> Édition IA du portrait
                    </span>
                    <button
                      type="button"
                      className="ccm-close"
                      onClick={() => setAiEditPortraitOpen(false)}
                      disabled={aiEditBusy}
                      aria-label="Fermer"
                    >
                      <X size={16} />
                    </button>
                  </header>
                  <div className="ccm-ai-edit-body">
                    <div className="ccm-ai-edit-preview">
                      <img src={portraitUrl} alt="Portrait" />
                      {aiEditBusy && (
                        <div className="ccm-ai-edit-busy-overlay">
                          <Loader2 className="ccm-spin" size={24} />
                          <span>{aiEditLabel || 'Édition…'}</span>
                        </div>
                      )}
                    </div>
                    <div className="ccm-ai-edit-controls">
                      <label htmlFor="ccm-ai-edit-prompt">Demande à l&apos;IA</label>
                      <textarea
                        id="ccm-ai-edit-prompt"
                        className="ccm-textarea"
                        value={aiEditPrompt}
                        onChange={e => setAiEditPrompt(e.target.value)}
                        placeholder="ex : enlève les lunettes · ajoute une cicatrice · change les cheveux en blonds"
                        disabled={aiEditBusy}
                        rows={3}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey && aiEditPrompt.trim() && !aiEditBusy) {
                            e.preventDefault()
                            void handleAiEditApply()
                          }
                        }}
                      />
                      {aiEditError && (
                        <div className="ccm-field-error">⚠ {aiEditError}</div>
                      )}
                      <div className="ccm-ai-edit-actions">
                        <button
                          type="button"
                          className="ccm-btn-ghost"
                          onClick={() => setAiEditPortraitOpen(false)}
                          disabled={aiEditBusy}
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          className="ccm-btn-primary"
                          onClick={() => void handleAiEditApply()}
                          disabled={aiEditBusy || !aiEditPrompt.trim()}
                        >
                          {aiEditBusy ? 'Édition…' : 'Demander'}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Crop manuel "Du plein pied" → Portrait. L'auteur sélectionne la
           *  zone (tête + buste) au lieu d'une heuristique auto. defaultAspect
           *  1:1 (portrait carré, convention Hero). Refonte 2026-05-12. */}
          <CropImageModal
            open={cropFromFullbodyOpen}
            sourceUrl={fullbodyUrl}
            defaultAspect="1:1"
            title="Sélectionne la zone du portrait"
            onClose={() => setCropFromFullbodyOpen(false)}
            onCropped={async (dataUrl) => {
              try {
                const ts = Date.now()
                const path = `${storagePathPrefix}_extracted_portrait/${ts}_crop.jpg`
                const res = await fetch('/api/storage/upload-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ data_url: dataUrl, path }),
                })
                const data = await res.json() as { url?: string; error?: string }
                if (!res.ok || !data.url) {
                  throw new Error(data.error ?? `Upload HTTP ${res.status}`)
                }
                // Skip cascade : on remplace le portrait, on ne veut PAS
                // perdre le fullbody dont on dérive.
                skipPortraitCascadeRef.current = true
                setPortraitUrl(data.url)
                setPortraitPhase('done')
                setPortraitError(null)
                setCropFromFullbodyOpen(false)
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                setPortraitError(`Crop : ${msg}`)
                // Garde la modal ouverte pour que l'auteur puisse retry
              }
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Section galerie sous les 2 slots canoniques (refonte 2026-05-09 — option B).
 *  Affiche les variantes scéniques (cheveux rouges, tenue alternative, etc.)
 *  en grid scrollable horizontale. Chaque item : thumb + label éditable +
 *  bouton supprimer + preview au click. Bouton "+ Importer" en haut. */
function GallerySection({
  items, uploading, error, onUpload, onRemove, onUpdateLabel, onPreview,
}: {
  items: import('@/types').NpcImage[]
  uploading: boolean
  error: string | null
  onUpload: (file: File) => void
  onRemove: (id: string) => void
  onUpdateLabel: (id: string, label: string) => void
  onPreview: (url: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  function handleUploadClick() {
    fileInputRef.current?.click()
  }
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) onUpload(f)
  }
  return (
    <div className="ccm-gallery-section">
      <header className="ccm-gallery-header">
        <span className="ccm-gallery-title">
          Galerie · {items.length} variante{items.length > 1 ? 's' : ''}
        </span>
        <button
          type="button"
          className="ccm-gallery-add-btn"
          onClick={handleUploadClick}
          disabled={uploading}
          title="Importer une variante (cheveux différents, tenue alternative, etc.)"
        >
          {uploading
            ? <><Loader2 size={12} className="ccm-spin" /> Upload…</>
            : <><Upload size={12} /> Importer</>}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </header>
      {error && (
        <div className="ccm-gallery-error">⚠ {error.length > 90 ? error.slice(0, 90) + '…' : error}</div>
      )}
      {items.length === 0 ? (
        <div className="ccm-gallery-empty">
          Aucune variante. Importe une image pour ajouter ici (cheveux rouges, tenue formelle, etc.).
        </div>
      ) : (
        <div className="ccm-gallery-grid">
          {items.map(item => (
            <div key={item.id} className="ccm-gallery-item">
              <button
                type="button"
                className="ccm-gallery-thumb-btn"
                onClick={() => onPreview(item.url)}
                title="Cliquer pour agrandir"
              >
                <img src={item.url} alt={item.label} className="ccm-gallery-thumb" />
              </button>
              <input
                type="text"
                className="ccm-gallery-label-input"
                value={item.label}
                onChange={(e) => onUpdateLabel(item.id, e.target.value)}
                placeholder="Nom"
              />
              <button
                type="button"
                className="ccm-gallery-remove-btn"
                onClick={() => onRemove(item.id)}
                title="Supprimer cette variante"
                aria-label="Supprimer"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Options pour le picker de moteur dans le slot Portrait (split-button refonte
 *  UX 2026-05-12). Si non fourni à ImageSlot, le bouton est un simple Generate. */
interface EnginePickerProps {
  /** Moteur actuellement sélectionné. */
  value: PortraitEngine
  /** Callback de changement. */
  onChange: (engine: PortraitEngine) => void
}

// Refonte 2026-05-19 — emojis retirés (⚡ 🚀 ✨), labels nus pour popover compact.
// Refonte 2026-05-19 v2 — ajout Juggernaut (SDXL existant) pour photoréalisme
// strict, moins sujet au style-mismatch que Z-Image (qui hybride anime+réaliste).
const ENGINE_OPTIONS: Array<{ value: PortraitEngine; label: string; hint: string }> = [
  { value: 'z_image',         label: 'Z-Image',    hint: '~25s · rapide hybride' },
  { value: 'sdxl_juggernaut', label: 'Juggernaut', hint: '~35s · photoréaliste strict' },
  { value: 'flux_dev_fast',   label: 'Flux',       hint: '~40s · équilibré' },
  { value: 'flux_dev',        label: 'Flux HQ',    hint: '~75s · qualité max' },
]

function ImageSlot({
  label, hint, url, busy, busyLabel = 'Génération…', disabled,
  onGenerate, onUpload, onPreview, warning,
  onDelete, onExtractFromFullbody, extractDisabled,
  enginePicker,
}: {
  label: string
  hint: string
  url: string | null
  busy: boolean
  busyLabel?: string
  disabled: boolean
  onGenerate: () => void
  /** Upload manuel — bypass IA, l'auteur fournit son image. */
  onUpload: (file: File) => void
  /** Click sur l'image affichée → ouvre la lightbox. */
  onPreview: () => void
  /** Si fourni, affiché en bas de slot (ex: "FaceDetailer skipped — visage non détecté"). */
  warning?: string
  /** Si fourni, ajoute un bouton corbeille à droite — l'auteur peut retirer
   *  l'image du slot (ex: pour la régénérer from scratch ou parce que pas
   *  satisfait). Réversible jusqu'à Enregistrer. Refonte 2026-05-12. */
  onDelete?: () => void
  /** Slot Portrait uniquement : si fourni, ajoute un bouton "Extraire du
   *  plein pied" qui compose le top 45% du fullbody sur fond gris → portrait.
   *  Utile quand l'auteur a un fullbody mais pas de portrait dédié.
   *  Refonte 2026-05-12. */
  onExtractFromFullbody?: () => void
  /** Disable du bouton onExtractFromFullbody (= pas de fullbody encore). */
  extractDisabled?: boolean
  /** Si fourni, transforme le bouton Générer en split-button avec chevron
   *  ouvrant un popover de sélection du moteur. Réservé au slot Portrait.
   *  Refonte UX 2026-05-12. */
  enginePicker?: EnginePickerProps
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [enginePickerOpen, setEnginePickerOpen] = useState(false)
  const pickerWrapperRef = useRef<HTMLDivElement | null>(null)

  // Fermer le popover sur click extérieur ou Escape
  useEffect(() => {
    if (!enginePickerOpen) return
    function onDocClick(e: MouseEvent) {
      if (!pickerWrapperRef.current?.contains(e.target as Node)) {
        setEnginePickerOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setEnginePickerOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [enginePickerOpen])

  function pickFile() {
    if (busy) return
    fileInputRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    // Reset pour permettre re-upload du même fichier
    e.target.value = ''
  }

  return (
    <div className="ccm-slot">
      <div className="ccm-slot-header">
        <span className="ccm-slot-label">{label}</span>
        <span className="ccm-slot-hint">{hint}</span>
      </div>
      <div
        className={`ccm-slot-preview ${url && !busy ? 'ccm-slot-preview-clickable' : ''}`}
        onClick={url && !busy ? onPreview : undefined}
        title={url && !busy ? 'Cliquer pour agrandir' : undefined}
      >
        {url ? (
          <img src={url} alt={label} className="ccm-slot-img" />
        ) : busy ? (
          <div className="ccm-slot-busy">
            <Loader2 className="ccm-spin ccm-icon-md" />
            <span>{busyLabel}</span>
          </div>
        ) : (
          <div className="ccm-slot-empty">
            <ImagePlus className="ccm-icon-md" />
            <span>Aucune image</span>
          </div>
        )}
        {url && !busy && (
          <>
            <span className="ccm-slot-check" aria-label="Image prête">
              <Check className="ccm-icon-xs" strokeWidth={3} />
            </span>
            <span className="ccm-slot-zoom" aria-hidden="true">
              <Maximize2 className="ccm-icon-xs" />
            </span>
          </>
        )}
      </div>
      {warning && (
        <div className="ccm-slot-warning" title={warning}>⚠ {warning.slice(0, 80)}{warning.length > 80 ? '…' : ''}</div>
      )}
      <div className="ccm-slot-actions">
        {enginePicker ? (
          <div className="ccm-split-btn" ref={pickerWrapperRef}>
            <button
              type="button"
              onClick={() => { setEnginePickerOpen(false); onGenerate() }}
              disabled={disabled || busy}
              className="ccm-slot-btn ccm-slot-btn-primary ccm-split-main"
              title={`Moteur : ${ENGINE_OPTIONS.find(o => o.value === enginePicker.value)?.label} (${ENGINE_OPTIONS.find(o => o.value === enginePicker.value)?.hint})`}
            >
              {busy ? busyLabel : url ? 'Régénérer' : 'Générer'}
            </button>
            <button
              type="button"
              onClick={() => setEnginePickerOpen(v => !v)}
              disabled={busy}
              className="ccm-slot-btn ccm-slot-btn-primary ccm-split-caret"
              aria-haspopup="menu"
              aria-expanded={enginePickerOpen}
              aria-label="Choisir le moteur de génération"
              title="Choisir le moteur"
            >
              <ChevronDown className="ccm-icon-xs" />
            </button>
            {enginePickerOpen && (
              <div className="ccm-engine-popover" role="menu">
                <div className="ccm-engine-popover-head">Moteur de génération</div>
                {ENGINE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={enginePicker.value === opt.value}
                    className={`ccm-engine-popover-item ${enginePicker.value === opt.value ? 'active' : ''}`}
                    onClick={() => {
                      enginePicker.onChange(opt.value)
                      setEnginePickerOpen(false)
                    }}
                  >
                    <span className="ccm-engine-popover-item-label">{opt.label}</span>
                    <span className="ccm-engine-popover-item-hint">{opt.hint}</span>
                    {enginePicker.value === opt.value && (
                      <Check className="ccm-icon-xs ccm-engine-popover-item-check" strokeWidth={3} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onGenerate}
            disabled={disabled || busy}
            className="ccm-slot-btn ccm-slot-btn-primary"
          >
            {busy ? busyLabel : url ? 'Régénérer' : 'Générer'}
          </button>
        )}
        <button
          type="button"
          onClick={pickFile}
          disabled={busy}
          className="ccm-slot-btn ccm-slot-btn-ghost"
          title="Importer une image depuis l'ordinateur"
        >
          <Upload className="ccm-icon-xs" />
          <span>Importer</span>
        </button>
        {onExtractFromFullbody && (
          <button
            type="button"
            onClick={onExtractFromFullbody}
            disabled={busy || extractDisabled}
            className="ccm-slot-btn ccm-slot-btn-ghost"
            title={extractDisabled
              ? 'Génère d\'abord le plein pied — Face'
              : 'Crop le portrait depuis le plein pied (top 45% sur fond gris)'}
          >
            <Crop className="ccm-icon-xs" />
            <span>Du plein pied</span>
          </button>
        )}
        {onDelete && url && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="ccm-slot-btn ccm-slot-btn-ghost ccm-slot-btn-danger"
            title="Supprimer cette image (réversible jusqu'à Enregistrer)"
          >
            <Trash2 className="ccm-icon-xs" />
            <span>Supprimer</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}

/** Lightbox plein écran : preview agrandi de l'image. Click backdrop ou Esc ferme. */
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      className="ccm-lightbox-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Aperçu de l'image"
    >
      <motion.img
        src={url}
        alt="Aperçu"
        className="ccm-lightbox-img"
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        onClick={e => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="ccm-lightbox-close"
        aria-label="Fermer l'aperçu"
      >
        <X className="ccm-icon-md" />
      </button>
    </motion.div>
  )
}
