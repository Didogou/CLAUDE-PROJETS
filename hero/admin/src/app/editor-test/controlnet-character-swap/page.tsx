'use client'
/**
 * POC ControlNet Character Swap — pattern STANDARD 2025 minimaliste.
 *
 * Remplace un personnage par un autre dans une scène, en préservant l'identité
 * du nouveau perso depuis une image de référence. UN SEUL workflow ComfyUI :
 *
 *   SDXL (Juggernaut) + ControlNet OpenPose (pose) + IPAdapter Plus (identité)
 *   + inpainting natif (mask Grounded-SAM)
 *
 * Avantages vs pipeline 10 étapes Insert Anything + IC-Light :
 *   - 1 SEUL modèle SDXL chargé (pas de swap entre étapes)
 *   - Pas de cascade
 *   - Inpainting natif gère ombres + harmonisation
 *   - ~3-5 min/run au lieu de 8-15 min
 *
 * UX minimaliste :
 *   1. Upload scène
 *   2. Tape "person" / "man" + détecte zone (Grounded-SAM)
 *   3. Upload image de référence (le nouveau perso)
 *   4. (optionnel) Prompt court de style
 *   5. 🔄 Remplacer
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'

interface Run {
  id: string
  srcUrl: string
  refUrl: string
  srcMaskUrl: string
  srcMaskPrompt: string
  prompt: string
  ipaWeight: number
  controlnetStrength: number
  ipaPreset: string
  ipaWeightType: string
  steps: number
  cfg: number
  denoise: number
  maskGrow: number
  maskBlur: number
  /** Identifiant du preset (T01..T30) si lancé depuis le test suite */
  presetId?: string
  /** Label humain du preset si lancé depuis le test suite */
  presetLabel?: string
  status: 'uploading' | 'queuing' | 'generating' | 'fetching' | 'face-enhancing' | 'done' | 'error'
  promptId?: string
  /** Image issue de la phase A (body swap) — affichée intermédiaire si phase B en cours. */
  bodyResultUrl?: string
  /** Image finale (= bodyResultUrl si pas de FaceDetailer, sinon résultat phase B). */
  resultUrl?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

/** Paramètres exécutables d'un run (peut venir du UI courant ou d'un preset). */
interface RunParams {
  prompt: string
  ipaWeight: number
  controlnetStrength: number
  ipaPreset: string
  ipaWeightType: string
  maskGrow: number
  maskBlur: number
  denoise: number
  steps: number
  cfg: number
  enableFaceDetailer?: boolean
  faceWeight?: number
  faceDenoise?: number
  presetId?: string
  presetLabel?: string
  /** Overrides utilisés par l'auto-pipeline : permet de fournir les sources
   *  fraîches au moment du run sans attendre que le state React se propage. */
  srcUrlOverride?: string
  refUrlOverride?: string
  srcMaskUrlOverride?: string
  srcMaskPromptOverride?: string
  characterTagsOverride?: string
}

/** 30 presets pour la matrice de tests structurée.
 *  Bloc A : weight progression (10) — où bascule l'identité ?
 *  Bloc B : weight_type (6) — quel mode IPAdapter convient au swap ?
 *  Bloc C : mask processing (6) — impact dilation/blur sur résultat
 *  Bloc D : prompt variants (4) — quel prompt minimal suffit ?
 *  Bloc E : combos prometteurs (4) — meilleurs candidats à tester ensemble */
const POSE_PROMPT = 'woman seated at a wooden tavern table, leaning forward, hands on table, painterly fantasy illustration, warm candlelight, medieval tavern interior, detailed background, high quality'
/** Cas de test complets — chaque preset = scénario E2E "perso central → autre perso".
 *  Sélectionner un cas remplit TOUS les prompts (LLM, scène, perso, mask, body swap)
 *  + permet le mode "🚀 Tout automatique" qui enchaîne tout sans intervention. */
const SWAP_TEST_CASES: Array<{
  id: string
  label: string
  llm_command: string
  scene_prompt: string
  mask_keyword: string
  character_prompt: string
  body_swap_prompt: string
}> = [
  // NOTE pour les character_prompt : décrivent UNIQUEMENT identité (race, age,
  // cheveux, yeux, peau, ethnicité) + vêtements + props. La pose / orientation
  // viennent du ControlNet OpenPose (squelette extrait de la scène) en mode
  // Posed Ref. Inclure pose/orientation ici créerait des conflits avec le
  // squelette, ou de l'incohérence si Posed Ref OFF (chaise dans bg blanc, etc.).
  {
    id: 'tavern_man_to_elf',
    label: '🍺 Taverne : homme → elfe blonde',
    llm_command: 'place une elfe blonde sur la chaise à la place de l\'homme',
    scene_prompt: 'medieval tavern interior, wooden tables and benches, candlelight, hanging lanterns, stone walls, barrels, a man sitting at a table drinking, painterly fantasy illustration, warm lighting, detailed background, high quality',
    mask_keyword: 'man',
    character_prompt: 'young elf woman, long flowing blonde hair, blue eyes, fair skin, pointed ears, simple medieval green dress with white sleeves, white background, character reference sheet, painterly fantasy illustration',
    body_swap_prompt: 'painterly fantasy illustration, warm candlelight, medieval tavern interior, detailed background, high quality',
  },
  {
    id: 'forest_traveler_to_orc',
    label: '🌲 Forêt : voyageur → orc guerrier',
    llm_command: 'remplace le voyageur par un orc guerrier vert',
    // Note swap-friendly :
    // 1. "front view, facing camera, full face visible" → OpenPose détecte un
    //    squelette complet (face + bras + torse) → ControlNet a assez de
    //    contraintes pour reproduire la pose dans la Posed Ref.
    // 2. PAS de hood/cape/manteau → évite que des éléments soient hors mask et
    //    se retrouvent à flotter en arrière-plan après le swap.
    scene_prompt: 'forest clearing in the morning, ancient mossy stones, sunlight through tall trees, a young man traveler standing on a stone path in the center of the frame, front view, facing camera, full face visible, no hood, simple leather jacket, full body visible from head to toe, painterly fantasy illustration, atmospheric, detailed background, high quality',
    mask_keyword: 'person',
    character_prompt: 'fierce orc warrior, green skin, large tusks, scarred face, animal-bone armor, large axe held in hand, muscular build, white background, character reference sheet, painterly fantasy illustration',
    body_swap_prompt: 'painterly fantasy illustration, atmospheric morning light, forest path, detailed background, high quality',
  },
  {
    id: 'library_scholar_to_wizard',
    label: '📚 Bibliothèque : scholar → vieux mage',
    llm_command: 'remplace le scholar par un vieux mage avec barbe blanche',
    scene_prompt: 'large medieval library interior, towering bookshelves, candlelight, dust motes in light, a scholar reading at a wooden desk, painterly fantasy illustration, atmospheric, detailed background, high quality',
    mask_keyword: 'person',
    character_prompt: 'old wizard, long white beard, blue robe with silver stars, kind blue eyes, holding an open book, white background, character reference sheet, painterly fantasy illustration',
    body_swap_prompt: 'painterly fantasy illustration, candlelight, atmospheric library interior, detailed background, high quality',
  },
  {
    id: 'market_merchant_to_princess',
    label: '🏪 Marché : marchand → princesse incognito',
    llm_command: 'place une princesse blonde élégante à la place du marchand',
    scene_prompt: 'medieval market square at midday, stalls with goods, stone fountain, a merchant standing behind a stall, painterly fantasy illustration, sunny, detailed background, high quality',
    mask_keyword: 'merchant',
    character_prompt: 'young princess, elaborate braided blonde hair, golden tiara, pale blue silk dress, gentle expression, white background, character reference sheet, painterly fantasy illustration',
    body_swap_prompt: 'painterly fantasy illustration, sunny midday lighting, medieval market square, detailed background, high quality',
  },
  {
    id: 'forge_blacksmith_to_warrior',
    label: '🔨 Forge : forgeron → guerrière brune',
    llm_command: 'remplace le forgeron par une guerrière brune en armure de cuir',
    // Note : sujet en TÊTE du prompt + détails (apron, hammer) pour que Juggernaut
    // ne l'oublie pas au profit de l'environnement. Sans ça, scène vide → SAM
    // hallucine sur l'enclume → swap déformé.
    scene_prompt: 'a muscular bearded blacksmith man wearing a leather apron and standing at an anvil, holding a hammer, front view, full body visible, in a medieval forge interior with glowing fire and hanging tools, painterly fantasy illustration, warm fire glow, detailed background, high quality',
    mask_keyword: 'man',
    character_prompt: 'female warrior, short brown hair, athletic build, leather armor with metal pauldrons, sword on back, white background, character reference sheet, painterly fantasy illustration',
    body_swap_prompt: 'painterly fantasy illustration, warm fire glow, blacksmith forge interior, detailed background, high quality',
  },
  {
    id: 'dungeon_prisoner_to_child',
    label: '⛓️ Donjon : prisonnier adulte → enfant',
    llm_command: 'mets un jeune enfant à la place du prisonnier adulte',
    scene_prompt: 'medieval dungeon, stone walls with torches, rusty iron bars, a prisoner sitting on the cold floor against the wall, dark painterly fantasy illustration, dramatic shadows, atmospheric, detailed',
    mask_keyword: 'person',
    character_prompt: 'young child age 8, curly red hair, freckles, simple worn brown clothes, white background, character reference sheet, painterly illustration',
    body_swap_prompt: 'painterly fantasy illustration, torch light, dungeon atmosphere, dramatic shadows, detailed background, high quality',
  },
]

/** Presets de scène source pour générer rapidement un cas de test.
 *  Chaque preset = scène avec un perso présent (à remplacer ensuite par le swap).
 *  Mot-clé Grounded-SAM auto-suggéré pour la zone à masquer. */
const SCENE_PRESETS: Array<{ id: string; label: string; prompt: string; mask_keyword: string }> = [
  { id: 'tavern_man', label: '🍺 Taverne + homme à table', mask_keyword: 'man',
    prompt: 'medieval tavern interior, wooden tables and benches, candlelight, hanging lanterns, stone walls, barrels, a man sitting at a table drinking, painterly fantasy illustration, warm lighting, detailed background, high quality' },
  { id: 'tavern_empty', label: '🪑 Taverne + chaise vide', mask_keyword: 'chair',
    prompt: 'medieval tavern interior, empty wooden chair next to a table with candles, candlelight, lanterns, painterly fantasy illustration, warm lighting, detailed background' },
  { id: 'forest_traveler', label: '🌲 Forêt + voyageur', mask_keyword: 'person',
    prompt: 'forest clearing in the morning, ancient stones, sunlight through trees, a hooded traveler walking along a path, painterly fantasy illustration, atmospheric, detailed background' },
  { id: 'inn_kitchen', label: '🍳 Cuisine d\'auberge + cuisinière', mask_keyword: 'woman',
    prompt: 'medieval inn kitchen, wooden counter, hanging copper pots, fire in hearth, a woman cooking by a stove, painterly illustration, warm lighting, detailed background' },
  { id: 'library', label: '📚 Bibliothèque + lecteur', mask_keyword: 'person',
    prompt: 'large medieval library interior, towering bookshelves, candlelight, a scholar reading at a wooden desk, painterly fantasy illustration, dust motes in light, detailed background' },
  { id: 'market', label: '🏪 Place de marché + marchand', mask_keyword: 'merchant',
    prompt: 'medieval market square at midday, stalls with goods, stone fountain, a merchant standing behind a stall, painterly fantasy illustration, sunny, detailed background' },
  { id: 'dungeon', label: '⛓️ Donjon + prisonnier', mask_keyword: 'person',
    prompt: 'medieval dungeon, stone walls with torches, rusty iron bars, a prisoner sitting on the cold floor, dark painterly fantasy illustration, dramatic shadows, detailed' },
  { id: 'forge', label: '🔨 Forge + forgeron', mask_keyword: 'blacksmith',
    prompt: 'medieval blacksmith forge interior, anvil, glowing fire, hanging tools, a blacksmith hammering metal, painterly illustration, warm fire glow, detailed background' },
]

/** Presets de personnage pour générer une ref. Optimisés pour le mode Posed Ref :
 *  décrivent UNIQUEMENT identité (race, age, cheveux, yeux, peau) + vêtements +
 *  props. La pose vient du ControlNet OpenPose (squelette de la scène). */
const CHARACTER_PRESETS: Array<{ id: string; label: string; prompt: string }> = [
  { id: 'elf_blonde', label: 'Elfe blonde',
    prompt: 'young elf woman, long flowing blonde hair, blue eyes, fair skin, pointed ears, simple medieval green dress with white sleeves, white background, character reference sheet, painterly fantasy illustration' },
  { id: 'old_wizard', label: 'Vieux mage',
    prompt: 'old wizard, long white beard, blue robe with silver stars, kind blue eyes, holding a wooden staff, white background, character reference sheet, painterly fantasy illustration' },
  { id: 'warrior', label: 'Guerrier costaud',
    prompt: 'muscular warrior man, short brown hair, scar across face, leather armor with metal pauldrons, sword on back, white background, character reference sheet, painterly fantasy illustration' },
  { id: 'thief', label: 'Voleuse agile',
    prompt: 'young female thief, short black hair, leather hood, daggers at belt, dark cloak, athletic build, white background, character reference sheet, painterly fantasy illustration' },
  { id: 'peasant', label: 'Paysan',
    prompt: 'humble peasant man, weathered face, simple brown tunic and trousers, leather boots, holding a wooden pitchfork, white background, character reference sheet, painterly illustration' },
  { id: 'princess', label: 'Princesse',
    prompt: 'young princess, elaborate braided blonde hair, golden tiara, pale blue silk dress, gentle expression, white background, character reference sheet, painterly fantasy illustration' },
  { id: 'orc', label: 'Orc',
    prompt: 'fierce orc warrior, green skin, large tusks, scarred face, animal-bone armor, large axe, muscular build, white background, character reference sheet, painterly fantasy illustration' },
  { id: 'child', label: 'Enfant',
    prompt: 'young child age 8, curly red hair, freckles, simple worn brown clothes, holding a wooden toy, white background, character reference sheet, painterly illustration' },
]

const TEST_PRESETS: Array<{
  id: string
  label: string
  prompt: string
  ipaPreset: 'PLUS (high strength)' | 'PLUS FACE (portraits)'
  ipaWeight: number
  ipaWeightType: 'linear' | 'style transfer' | 'strong style transfer' | 'composition' | 'strong middle' | 'ease in-out'
  maskGrow: number
  maskBlur: number
}> = [
  // ── Bloc A : IPAdapter weight progression (10) ──
  { id: 'A01', label: 'PLUS @ 0.0 (control no IPA)',  prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)',  ipaWeight: 0.0, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },
  { id: 'A02', label: 'PLUS @ 0.5',                   prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)',  ipaWeight: 0.5, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },
  { id: 'A03', label: 'PLUS @ 0.8',                   prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)',  ipaWeight: 0.8, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },
  { id: 'A04', label: 'PLUS @ 1.0',                   prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)',  ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },
  { id: 'A05', label: 'PLUS @ 1.2',                   prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)',  ipaWeight: 1.2, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },
  { id: 'A06', label: 'PLUS FACE @ 0.0 (control)',    prompt: POSE_PROMPT, ipaPreset: 'PLUS FACE (portraits)', ipaWeight: 0.0, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },
  { id: 'A07', label: 'PLUS FACE @ 0.5',              prompt: POSE_PROMPT, ipaPreset: 'PLUS FACE (portraits)', ipaWeight: 0.5, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },
  { id: 'A08', label: 'PLUS FACE @ 0.8',              prompt: POSE_PROMPT, ipaPreset: 'PLUS FACE (portraits)', ipaWeight: 0.8, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },
  { id: 'A09', label: 'PLUS FACE @ 1.0',              prompt: POSE_PROMPT, ipaPreset: 'PLUS FACE (portraits)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },
  { id: 'A10', label: 'PLUS FACE @ 1.2',              prompt: POSE_PROMPT, ipaPreset: 'PLUS FACE (portraits)', ipaWeight: 1.2, ipaWeightType: 'linear', maskGrow: 0, maskBlur: 0 },

  // ── Bloc B : weight_type (6) — PLUS @ 1.0 ──
  { id: 'B01', label: 'PLUS 1.0 · linear',                prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear',                maskGrow: 0, maskBlur: 0 },
  { id: 'B02', label: 'PLUS 1.0 · style transfer',        prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'style transfer',        maskGrow: 0, maskBlur: 0 },
  { id: 'B03', label: 'PLUS 1.0 · strong style transfer', prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'strong style transfer', maskGrow: 0, maskBlur: 0 },
  { id: 'B04', label: 'PLUS 1.0 · composition',           prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'composition',           maskGrow: 0, maskBlur: 0 },
  { id: 'B05', label: 'PLUS 1.0 · strong middle',         prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'strong middle',         maskGrow: 0, maskBlur: 0 },
  { id: 'B06', label: 'PLUS 1.0 · ease in-out',           prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'ease in-out',           maskGrow: 0, maskBlur: 0 },

  // ── Bloc C : mask processing (6) — PLUS @ 1.0 linear ──
  { id: 'C01', label: 'mask grow 0 · blur 0',     prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 0,   maskBlur: 0 },
  { id: 'C02', label: 'mask grow 30 · blur 0',    prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 30,  maskBlur: 0 },
  { id: 'C03', label: 'mask grow 60 · blur 0',    prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 60,  maskBlur: 0 },
  { id: 'C04', label: 'mask grow 60 · blur 12',   prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 60,  maskBlur: 12 },
  { id: 'C05', label: 'mask grow 100 · blur 24',  prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 100, maskBlur: 24 },
  { id: 'C06', label: 'mask grow 0 · blur 16',    prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 0,   maskBlur: 16 },

  // ── Bloc D : prompt variants (4) — PLUS @ 1.0 linear, mask 60/12 ──
  { id: 'D01', label: 'prompt minimal',  prompt: 'painterly illustration',                                                               ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 60, maskBlur: 12 },
  { id: 'D02', label: 'prompt pose',     prompt: POSE_PROMPT,                                                                            ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 60, maskBlur: 12 },
  { id: 'D03', label: 'prompt contexte', prompt: 'medieval tavern interior, candlelight, painterly fantasy illustration, detailed',     ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 60, maskBlur: 12 },
  { id: 'D04', label: 'prompt vide',     prompt: '',                                                                                     ipaPreset: 'PLUS (high strength)', ipaWeight: 1.0, ipaWeightType: 'linear', maskGrow: 60, maskBlur: 12 },

  // ── Bloc E : combos prometteurs (4) ──
  { id: 'E01', label: 'PLUS FACE 1.0 + mask 60/12 + pose',     prompt: POSE_PROMPT, ipaPreset: 'PLUS FACE (portraits)', ipaWeight: 1.0, ipaWeightType: 'linear',         maskGrow: 60, maskBlur: 12 },
  { id: 'E02', label: 'PLUS FACE 1.2 + mask 60/12 + pose',     prompt: POSE_PROMPT, ipaPreset: 'PLUS FACE (portraits)', ipaWeight: 1.2, ipaWeightType: 'linear',         maskGrow: 60, maskBlur: 12 },
  { id: 'E03', label: 'PLUS 1.0 style-transfer + mask 60/12',  prompt: POSE_PROMPT, ipaPreset: 'PLUS (high strength)',  ipaWeight: 1.0, ipaWeightType: 'style transfer', maskGrow: 60, maskBlur: 12 },
  { id: 'E04', label: 'PLUS FACE 1.0 composition + mask 60/12',prompt: POSE_PROMPT, ipaPreset: 'PLUS FACE (portraits)', ipaWeight: 1.0, ipaWeightType: 'composition',    maskGrow: 60, maskBlur: 12 },
]

export default function ControlNetCharacterSwapPage() {
  const [srcUrl, setSrcUrl] = useState('')
  const [refUrl, setRefUrl] = useState('')
  const [srcMaskPrompt, setSrcMaskPrompt] = useState('')
  const [srcMaskUrl, setSrcMaskUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState<'src' | 'ref' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [detectingMask, setDetectingMask] = useState(false)
  const [maskError, setMaskError] = useState<string | null>(null)
  const [filteringMask, setFilteringMask] = useState(false)

  const [prompt, setPrompt] = useState('woman seated at a wooden tavern table, leaning forward, hands on table, painterly fantasy illustration, warm candlelight, medieval tavern interior, detailed background, high quality')
  // Defaults issus du test suite 30 runs (2026-04-30) :
  // ipa_weight 1.2 + linear = meilleur résultat (A05). ipa_weight 0.8 (ancien default) = trop bas.
  // ease in-out @ 1.0 (B06) comparable, à activer manuellement si besoin.
  const [ipaWeight, setIpaWeight] = useState(1.2)
  const [controlnetStrength, setControlnetStrength] = useState(1.0)
  const [ipaPreset, setIpaPreset] = useState<'PLUS (high strength)' | 'PLUS FACE (portraits)'>('PLUS (high strength)')
  const [ipaWeightType, setIpaWeightType] = useState<'linear' | 'style transfer' | 'strong style transfer' | 'composition' | 'strong middle' | 'ease in-out'>('linear')
  // Defaults validés (setup simple qui a donné le bon résultat elfe blonde)
  const [steps, setSteps] = useState(30)
  const [cfg, setCfg] = useState(7)
  const [maskGrow, setMaskGrow] = useState(0)  // 0 = silhouette stricte. À activer si écho.
  const [maskBlur, setMaskBlur] = useState(0)  // 0 = bords nets. À activer si transitions visibles.
  const [denoise, setDenoise] = useState(1.0) // 1.0 = default character swap (régénère totalement zone masquée)
  const [enableFaceDetailer, setEnableFaceDetailer] = useState(true)  // FaceDetailer + IPAdapter FaceID Plus v2 — règle le pb visage petit
  const [faceWeight, setFaceWeight] = useState(1.0)
  const [faceDenoise, setFaceDenoise] = useState(0.5)

  // Character analysis (Qwen 2.5 VL local). Capture les attributs que IPAdapter
  // rate (couleur cheveux, yeux, race fantasy, age) → injecté en début du prompt
  // body swap. Auto-déclenché quand l'utilisateur upload une nouvelle ref.
  const [characterTags, setCharacterTags] = useState('')
  const [analyzingCharacter, setAnalyzingCharacter] = useState(false)
  const [characterAnalysisError, setCharacterAnalysisError] = useState<string | null>(null)

  // Génération scène source (T2I SDXL Juggernaut). Auto-remplit srcUrl.
  const [scenePresetId, setScenePresetId] = useState<string>('tavern_man')
  const [scenePrompt, setScenePrompt] = useState<string>(SCENE_PRESETS[0].prompt)
  const [generatingScene, setGeneratingScene] = useState(false)
  const [sceneGenError, setSceneGenError] = useState<string | null>(null)

  // Génération perso ref (T2I SDXL Juggernaut). Auto-remplit refUrl.
  const [characterPrompt, setCharacterPrompt] = useState<string>(CHARACTER_PRESETS[0].prompt)
  const [generatingCharacter, setGeneratingCharacter] = useState(false)
  const [characterGenError, setCharacterGenError] = useState<string | null>(null)
  // Mode "Posed Ref" : génère la ref avec ControlNet OpenPose calé sur la pose
  // de la scène source → ref dans MÊME orientation/posture que le perso à
  // remplacer. Résout les artefacts de mismatch front/back. Coût : +60-90s
  // (T2I supplémentaire) mais qualité ~95% vs ~85% sans.
  const [usePosedRef, setUsePosedRef] = useState(true)

  // Mode LLM : commande naturelle → mask_keyword + character_description + body_prompt
  const [llmCommand, setLlmCommand] = useState<string>('place une elfe blonde sur la chaise à la place de l\'homme')
  const [parsingLLM, setParsingLLM] = useState(false)
  const [llmError, setLlmError] = useState<string | null>(null)

  // Cas de test E2E sélectionné. Remplir tous les prompts en 1 clic.
  const [selectedTestCase, setSelectedTestCase] = useState<string>('')
  const [autoPipelineRunning, setAutoPipelineRunning] = useState(false)
  const [autoPipelineStep, setAutoPipelineStep] = useState<string>('')
  const [runs, setRuns] = useState<Run[]>([])

  // Reset mask quand on change la source
  useEffect(() => { setSrcMaskUrl(null); setMaskError(null) }, [srcUrl])

  // Auto-analyse du perso de référence quand l'utilisateur upload une nouvelle ref.
  // Qwen VL extrait les attributs (cheveux, yeux, race, age) et les met dans
  // characterTags. L'utilisateur peut ensuite les éditer avant de lancer.
  useEffect(() => {
    if (!refUrl) { setCharacterTags(''); setCharacterAnalysisError(null); return }
    let cancelled = false
    setAnalyzingCharacter(true)
    setCharacterAnalysisError(null)
    fetch('/api/analyze-character', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: refUrl }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.error) { setCharacterAnalysisError(data.error); return }
        setCharacterTags(data.suggested_tags ?? '')
      })
      .catch(err => { if (!cancelled) setCharacterAnalysisError(err.message) })
      .finally(() => { if (!cancelled) setAnalyzingCharacter(false) })
    return () => { cancelled = true }
  }, [refUrl])

  async function handleUpload(slot: 'src' | 'ref', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(slot)
    setUploadError(null)
    if (slot === 'src') setSrcUrl(''); else setRefUrl('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('path', `test/controlnet-swap/${slot}_${Date.now()}`)
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'upload failed')
      if (slot === 'src') setSrcUrl(data.url); else setRefUrl(data.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(null)
    }
  }

  async function handleDetectMask() {
    if (!srcUrl || !srcMaskPrompt.trim()) return
    setDetectingMask(true)
    setMaskError(null)
    setSrcMaskUrl(null)
    try {
      const res = await fetch('/api/comfyui/grounded-sam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: srcUrl, prompt_text: srcMaskPrompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.mask_url) throw new Error(data.error ?? data.message ?? 'detection failed')
      setSrcMaskUrl(data.mask_url)
    } catch (err) {
      setMaskError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetectingMask(false)
    }
  }

  // Filtre la plus grande zone (flood-fill, copié de la POC insert-anything)
  async function handleKeepLargestZone() {
    if (!srcMaskUrl) return
    setFilteringMask(true)
    try {
      const img = await loadImg(srcMaskUrl)
      const cv = document.createElement('canvas')
      cv.width = img.naturalWidth
      cv.height = img.naturalHeight
      const ctx = cv.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, cv.width, cv.height)
      const w = cv.width, h = cv.height
      const visited = new Uint8Array(w * h)
      const blobs: { pixels: number[] }[] = []
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const idx = y * w + x
        if (visited[idx]) continue
        if (data.data[idx * 4] < 128) { visited[idx] = 1; continue }
        const blob: number[] = []
        const queue: [number, number][] = [[x, y]]
        while (queue.length > 0) {
          const [cx, cy] = queue.pop()!
          if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue
          const cidx = cy * w + cx
          if (visited[cidx]) continue
          if (data.data[cidx * 4] < 128) { visited[cidx] = 1; continue }
          visited[cidx] = 1
          blob.push(cidx)
          queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
        }
        if (blob.length > 0) blobs.push({ pixels: blob })
      }
      if (blobs.length <= 1) { setMaskError('1 seule zone — pas de filtrage'); return }
      blobs.sort((a, b) => b.pixels.length - a.pixels.length)
      const largest = blobs[0]
      const newCv = document.createElement('canvas')
      newCv.width = w; newCv.height = h
      const newCtx = newCv.getContext('2d')!
      newCtx.fillStyle = 'black'
      newCtx.fillRect(0, 0, w, h)
      const newData = newCtx.getImageData(0, 0, w, h)
      for (const idx of largest.pixels) {
        const pi = idx * 4
        newData.data[pi] = newData.data[pi + 1] = newData.data[pi + 2] = 255
        newData.data[pi + 3] = 255
      }
      newCtx.putImageData(newData, 0, 0)
      const blob = await new Promise<Blob>((res, rej) =>
        newCv.toBlob(b => b ? res(b) : rej(new Error('blob fail')), 'image/png'))
      const url = await uploadBlob(blob, `test/controlnet-swap/mask_filtered_${Date.now()}.png`)
      setSrcMaskUrl(url)
    } catch (e) {
      setMaskError(String(e))
    } finally {
      setFilteringMask(false)
    }
  }

  /** Exécute UN run avec les params donnés (peut venir du UI ou d'un preset).
   *  Optionnellement, prend des filenames ComfyUI déjà uploadés (utile pour
   *  le test suite : on upload 1 fois et on enchaîne 30 runs sans re-upload). */
  const runOne = useCallback(async (
    params: RunParams,
    cached?: { upSrc: string; upRef: string; upMask: string },
  ) => {
    // Sources : utilise les overrides si fournis (auto-pipeline), sinon le state.
    const _srcUrl = params.srcUrlOverride ?? srcUrl
    const _refUrl = params.refUrlOverride ?? refUrl
    const _srcMaskUrl = params.srcMaskUrlOverride ?? srcMaskUrl
    const _srcMaskPrompt = params.srcMaskPromptOverride ?? srcMaskPrompt
    const _characterTags = params.characterTagsOverride ?? characterTags
    if (!_srcUrl || !_refUrl || !_srcMaskUrl) return
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const newRun: Run = {
      id, srcUrl: _srcUrl, refUrl: _refUrl, srcMaskUrl: _srcMaskUrl, srcMaskPrompt: _srcMaskPrompt,
      prompt: params.prompt,
      ipaWeight: params.ipaWeight,
      controlnetStrength: params.controlnetStrength,
      ipaPreset: params.ipaPreset,
      ipaWeightType: params.ipaWeightType,
      maskGrow: params.maskGrow,
      maskBlur: params.maskBlur,
      denoise: params.denoise,
      steps: params.steps,
      cfg: params.cfg,
      presetId: params.presetId,
      presetLabel: params.presetLabel,
      status: 'uploading', startedAt: Date.now(),
    }
    setRuns(prev => [newRun, ...prev])

    try {
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))

      const upSrc = cached?.upSrc ?? await uploadToComfy(_srcUrl, 'cnswap_src')
      const upRef = cached?.upRef ?? await uploadToComfy(_refUrl, 'cnswap_ref')
      const upMask = cached?.upMask ?? await uploadToComfy(_srcMaskUrl, 'cnswap_mask')

      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'queuing' } : r))
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'controlnet_character_swap',
          source_image: upSrc,
          mask_image: upMask,
          reference_image: upRef,
          // Backend exige prompt_positive non-vide pour ce workflow.
          // Pour le preset D04 "prompt vide" on fournit une chaîne minimale neutre.
          // Injecte les tags Qwen (cheveux/yeux/race) en TÊTE — ce que IPAdapter
          // ne transfère pas, le KSampler le génère explicitement via le prompt.
          prompt_positive: [_characterTags, params.prompt || 'illustration'].filter(Boolean).join(', '),
          prompt_negative: 'blurry, low quality, deformed, distorted face, watermark',
          ipa_weight: params.ipaWeight,
          controlnet_strength: params.controlnetStrength,
          ipa_preset: params.ipaPreset,
          ipa_weight_type: params.ipaWeightType,
          mask_grow: params.maskGrow,
          mask_blur: params.maskBlur,
          denoise: params.denoise,
          steps: params.steps,
          cfg: params.cfg,
          seed: -1,
        }),
      }).then(r => r.json())
      if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'queue failed')
      setRuns(prev => prev.map(r => r.id === id ? { ...r, promptId: queueRes.prompt_id, status: 'generating' } : r))

      const maxWait = Date.now() + 8 * 60 * 1000
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'generation failed')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout (8 min)')

      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'fetching' } : r))
      const storagePath = `test/controlnet-swap/body_${id}`
      const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
      if (!iData.image_url) throw new Error(iData.error ?? 'image_url manquante')
      const bodyUrl = iData.image_url as string
      setRuns(prev => prev.map(r => r.id === id ? { ...r, bodyResultUrl: bodyUrl, resultUrl: bodyUrl } : r))

      // Free VRAM systématiquement après phase A (anti-OOM run suivant).
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 3000))

      // ── PHASE B : FaceDetailer (workflow séparé pour éviter OOM 8 GB) ──
      // SDXL + IPAdapter Plus + ControlNet (phase A) puis SDXL + IPAdapter
      // FaceID + InsightFace + SAM + YOLO (phase B) → chaque phase a 8 GB.
      // Graceful fallback : si phase B échoue (ex: ref sans face détectable
      // par InsightFace, en cas de Posed Ref de dos), on garde le résultat
      // phase A au lieu de tout perdre. Le run reste 'done'.
      if (params.enableFaceDetailer === true) {
        try {
        setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'face-enhancing' } : r))

        const upBody = await uploadToComfy(bodyUrl, 'cnswap_body')
        const faceQueue = await fetch('/api/comfyui', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflow_type: 'face_detailer_only',
            source_image: upBody,
            reference_image: upRef,
            // Injecte aussi les tags Qwen côté FaceDetailer pour cohérence
            // (notamment couleur de cheveux qui touche les bords de la zone face).
            prompt_positive: [_characterTags, params.prompt || 'detailed face, beautiful eyes, sharp features'].filter(Boolean).join(', '),
            prompt_negative: 'blurry, low quality, deformed face, distorted',
            face_weight: params.faceWeight ?? 1.0,
            face_denoise: params.faceDenoise ?? 0.5,
            seed: -1,
          }),
        }).then(r => r.json())
        if (!faceQueue.prompt_id) throw new Error(faceQueue.error ?? 'face queue failed')

        const faceMaxWait = Date.now() + 5 * 60 * 1000
        let faceOk = false
        while (Date.now() < faceMaxWait) {
          await new Promise(r => setTimeout(r, 3000))
          const sData = await fetch(`/api/comfyui?prompt_id=${faceQueue.prompt_id}`).then(r => r.json())
          if (sData.error) throw new Error(sData.error)
          if (sData.status === 'failed') throw new Error(sData.error ?? 'face generation failed')
          if (sData.status === 'succeeded') { faceOk = true; break }
        }
        if (!faceOk) throw new Error('face timeout (5 min)')

        const facePath = `test/controlnet-swap/face_${id}`
        const fData = await fetch(`/api/comfyui?prompt_id=${faceQueue.prompt_id}&action=image&storage_path=${encodeURIComponent(facePath)}`).then(r => r.json())
        if (!fData.image_url) throw new Error(fData.error ?? 'face image_url manquante')
        setRuns(prev => prev.map(r => r.id === id ? { ...r, resultUrl: fData.image_url } : r))
        } catch (faceErr) {
          // Phase B échoue → on garde l'image phase A. Cas typique :
          // "InsightFace: No face detected" si la ref Posed Ref est de dos.
          const faceMsg = faceErr instanceof Error ? faceErr.message : String(faceErr)
          console.warn('[runOne] Phase B (FaceDetailer) failed, keeping body result:', faceMsg)
          setRuns(prev => prev.map(r => r.id === id ? { ...r, error: `face skipped: ${faceMsg}` } : r))
          await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
          await new Promise(r => setTimeout(r, 2000))
        }
      }

      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'done', finishedAt: Date.now() } : r))
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 3000))
      return { upSrc, upRef, upMask }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: msg, finishedAt: Date.now() } : r))
      // Même en cas d'erreur on libère la VRAM (le run partiel a peut-être
      // chargé des modèles avant de planter).
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 3000))
      return cached  // permet au test suite de continuer avec les filenames cachés
    }
  }, [srcUrl, refUrl, srcMaskUrl, srcMaskPrompt, characterTags])

  /** T2I SDXL Juggernaut générique pour générer une scène source ou une ref perso.
   *  Workflow ComfyUI 'portrait' (= simple SDXL T2I) avec prompt + size custom.
   *  Free VRAM avant + après pour éviter les conflits avec les workflows swap.
   *  Retourne l'URL Supabase de l'image générée. */
  async function generateImage(
    prompt: string,
    width: number,
    height: number,
    storagePathPrefix: string,
  ): Promise<string> {
    await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    await new Promise(r => setTimeout(r, 1500))

    const queueRes = await fetch('/api/comfyui', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_type: 'portrait',
        prompt_positive: prompt,
        prompt_negative: 'blurry, low quality, deformed, distorted, watermark, text, extra limbs',
        width, height,
        steps: 30, cfg: 7, seed: -1,
      }),
    }).then(r => r.json())
    if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'queue failed')

    const maxWait = Date.now() + 5 * 60 * 1000
    let succeeded = false
    while (Date.now() < maxWait) {
      await new Promise(r => setTimeout(r, 3000))
      const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
      if (sData.error) throw new Error(sData.error)
      if (sData.status === 'failed') throw new Error(sData.error ?? 'generation failed')
      if (sData.status === 'succeeded') { succeeded = true; break }
    }
    if (!succeeded) throw new Error('timeout (5 min)')

    const storagePath = `${storagePathPrefix}_${Date.now()}`
    const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
    if (!iData.image_url) throw new Error(iData.error ?? 'image_url manquante')

    await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    await new Promise(r => setTimeout(r, 2000))
    return iData.image_url as string
  }

  /** Génère une scène source (16:9, 1360×768) → auto-remplit srcUrl. */
  async function handleGenerateScene() {
    if (!scenePrompt.trim()) return
    setGeneratingScene(true)
    setSceneGenError(null)
    setSrcUrl('')           // reset le mask aussi (useEffect [srcUrl])
    try {
      const url = await generateImage(scenePrompt, 1360, 768, 'test/controlnet-swap/scene')
      setSrcUrl(url)
      // Pré-remplit le mot-clé Grounded-SAM si le preset en a un
      const preset = SCENE_PRESETS.find(p => p.id === scenePresetId)
      if (preset?.mask_keyword) setSrcMaskPrompt(preset.mask_keyword)
    } catch (err) {
      setSceneGenError(err instanceof Error ? err.message : String(err))
    } finally {
      setGeneratingScene(false)
    }
  }

  /** Sélectionner un cas de test → remplit TOUS les champs (LLM, scène, perso, mask, body swap).
   *  L'utilisateur peut ensuite éditer chaque champ ou cliquer "Tout automatique". */
  function handleSelectTestCase(id: string) {
    setSelectedTestCase(id)
    if (!id) return
    const test = SWAP_TEST_CASES.find(t => t.id === id)
    if (!test) return
    setLlmCommand(test.llm_command)
    setScenePrompt(test.scene_prompt)
    setCharacterPrompt(test.character_prompt)
    setSrcMaskPrompt(test.mask_keyword)
    setPrompt(test.body_swap_prompt)
  }

  /** Pipeline E2E : génère scène → génère perso → analyse Qwen VL → détecte mask → swap. */
  async function handleRunAutoPipeline() {
    if (!selectedTestCase) return
    const test = SWAP_TEST_CASES.find(t => t.id === selectedTestCase)
    if (!test) return
    setAutoPipelineRunning(true)
    setAutoPipelineStep('')
    setSceneGenError(null); setCharacterGenError(null); setLlmError(null); setMaskError(null)

    try {
      // 1/5 — Génération scène
      setAutoPipelineStep('1/5 · Génération de la scène (~60-90s)…')
      const sceneUrl = await generateImage(test.scene_prompt, 1360, 768, 'test/controlnet-swap/scene')
      setSrcUrl(sceneUrl)
      setSrcMaskPrompt(test.mask_keyword)

      // 2/5 — Génération perso (Posed Ref si activé : aligne pose ref sur la scène)
      if (usePosedRef) {
        setAutoPipelineStep('2/5 · Génération posed ref (OpenPose calé sur scène, ~60-90s)…')
      } else {
        setAutoPipelineStep('2/5 · Génération du perso (~60-90s)…')
      }
      const charUrl = usePosedRef
        ? await generatePosedRef(sceneUrl, test.character_prompt)
        : await generateImage(test.character_prompt, 1024, 1024, 'test/controlnet-swap/character')
      setRefUrl(charUrl)

      // 3/5 — Analyse Qwen VL (parallèle au useEffect, mais on fetch direct pour récupérer la valeur)
      setAutoPipelineStep('3/5 · Analyse Qwen VL du perso…')
      const analysisRes = await fetch('/api/analyze-character', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: charUrl }),
      }).then(r => r.json())
      const tags = (analysisRes && !analysisRes.error) ? (analysisRes.suggested_tags ?? '') : ''
      if (tags) setCharacterTags(tags)

      // 4/5 — Détection mask Grounded-SAM
      setAutoPipelineStep('4/5 · Détection zone à remplacer…')
      const maskRes = await fetch('/api/comfyui/grounded-sam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: sceneUrl, prompt_text: test.mask_keyword }),
      }).then(r => r.json())
      if (!maskRes.mask_url) throw new Error(maskRes.error ?? maskRes.message ?? 'mask detection failed')
      setSrcMaskUrl(maskRes.mask_url)

      // 5/5 — Body swap + FaceDetailer (passe les overrides pour bypasser les closures React)
      setAutoPipelineStep('5/5 · Body swap + FaceDetailer (~2 min)…')
      setPrompt(test.body_swap_prompt)
      await runOne({
        prompt: test.body_swap_prompt,
        ipaWeight, controlnetStrength, ipaPreset, ipaWeightType,
        maskGrow, maskBlur, denoise, steps, cfg,
        enableFaceDetailer, faceWeight, faceDenoise,
        srcUrlOverride: sceneUrl,
        refUrlOverride: charUrl,
        srcMaskUrlOverride: maskRes.mask_url,
        srcMaskPromptOverride: test.mask_keyword,
        characterTagsOverride: tags,
        presetId: test.id.toUpperCase().slice(0, 6),
        presetLabel: `${test.label} (auto)`,
      })

      setAutoPipelineStep('✅ Terminé')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setAutoPipelineStep(`❌ ${msg}`)
    } finally {
      setAutoPipelineRunning(false)
    }
  }

  /** Parse la commande naturelle via Qwen (text only) → remplit auto les 3 prompts.
   *  L'utilisateur peut ensuite éditer chaque prompt avant de générer scène/perso. */
  async function handleParseCommand() {
    if (!llmCommand.trim()) return
    setParsingLLM(true)
    setLlmError(null)
    try {
      const res = await fetch('/api/parse-swap-command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: llmCommand.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'parse failed')
      // Auto-remplit les 3 zones — l'utilisateur peut éditer avant de lancer
      setSrcMaskPrompt(data.mask_keyword)
      setCharacterPrompt(data.character_description)
      setPrompt(data.body_prompt)
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsingLLM(false)
    }
  }

  /** Génère un perso de référence aligné sur la pose d'une scène source.
   *  Workflow ComfyUI 'posed_ref_t2i' : extrait OpenPose skeleton de la scène
   *  → T2I + ControlNet OpenPose pour générer un perso DANS LA MÊME POSTURE.
   *  Résout l'orientation mismatch (front/back) ET la pose (assis/debout).
   *  Retourne l'URL Supabase de la ref générée.
   *  Requis : sceneSupabaseUrl déjà disponible (la scène ayant servi de source). */
  async function generatePosedRef(
    sceneSupabaseUrl: string,
    charPrompt: string,
  ): Promise<string> {
    // Upload la scène vers ComfyUI input pour que le workflow puisse y accéder
    const scenePath = await uploadToComfy(sceneSupabaseUrl, 'posed_ref_src')

    await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    await new Promise(r => setTimeout(r, 1500))

    const queueRes = await fetch('/api/comfyui', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_type: 'posed_ref_t2i',
        source_image: scenePath,
        prompt_positive: charPrompt,
        prompt_negative: 'blurry, low quality, deformed, distorted, watermark, text, extra limbs, bad anatomy',
        width: 1024, height: 1024,
        steps: 30, cfg: 7, seed: -1,
      }),
    }).then(r => r.json())
    if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'posed ref queue failed')

    const maxWait = Date.now() + 5 * 60 * 1000
    let succeeded = false
    while (Date.now() < maxWait) {
      await new Promise(r => setTimeout(r, 3000))
      const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
      if (sData.error) throw new Error(sData.error)
      if (sData.status === 'failed') throw new Error(sData.error ?? 'posed ref failed')
      if (sData.status === 'succeeded') { succeeded = true; break }
    }
    if (!succeeded) throw new Error('posed ref timeout (5 min)')

    const storagePath = `test/controlnet-swap/posed_ref_${Date.now()}`
    const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
    if (!iData.image_url) throw new Error(iData.error ?? 'posed ref image_url manquante')

    await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    await new Promise(r => setTimeout(r, 2000))
    return iData.image_url as string
  }

  /** Génère un perso de référence → auto-remplit refUrl.
   *  Si Posed Ref ON et scène disponible → utilise posed_ref_t2i (orientation/pose alignées).
   *  Sinon → T2I plat 1024×1024 fond blanc. */
  async function handleGenerateCharacter() {
    if (!characterPrompt.trim()) return
    setGeneratingCharacter(true)
    setCharacterGenError(null)
    setRefUrl('')           // reset l'auto-analyse Qwen aussi (useEffect [refUrl])
    try {
      let url: string
      if (usePosedRef && srcUrl) {
        // Mode posed ref : aligné sur la scène
        url = await generatePosedRef(srcUrl, characterPrompt)
      } else {
        // Mode plat : T2I générique fond blanc
        url = await generateImage(characterPrompt, 1024, 1024, 'test/controlnet-swap/character')
      }
      setRefUrl(url)
    } catch (err) {
      setCharacterGenError(err instanceof Error ? err.message : String(err))
    } finally {
      setGeneratingCharacter(false)
    }
  }

  /** Lance UN run avec les params actuels du UI (bouton "Remplacer le personnage"). */
  const handleGenerate = useCallback(async () => {
    await runOne({
      prompt, ipaWeight, controlnetStrength, ipaPreset, ipaWeightType,
      maskGrow, maskBlur, denoise, steps, cfg,
      enableFaceDetailer, faceWeight, faceDenoise,
    })
  }, [runOne, prompt, ipaWeight, controlnetStrength, ipaPreset, ipaWeightType, maskGrow, maskBlur, denoise, steps, cfg, enableFaceDetailer, faceWeight, faceDenoise])

  /** Lance les 30 runs de la test suite SÉQUENTIELLEMENT (pas parallèle, 8 GB
   *  VRAM ne le permet pas). Upload les 3 images UNE FOIS, puis enchaîne. */
  const [suiteRunning, setSuiteRunning] = useState(false)
  // Ref pour que le flag soit lu à chaque itération de la boucle (pas capturé
  // dans la closure du useCallback comme un state le serait).
  const suiteCancelledRef = useRef(false)
  const handleRunTestSuite = useCallback(async () => {
    if (!srcUrl || !refUrl || !srcMaskUrl) return
    if (!confirm(`Lance ${TEST_PRESETS.length} runs séquentiels (~${Math.ceil(TEST_PRESETS.length * 1.5)} min).\nContinuer ?`)) return
    setSuiteRunning(true)
    suiteCancelledRef.current = false
    let cached: { upSrc: string; upRef: string; upMask: string } | undefined
    for (let i = 0; i < TEST_PRESETS.length; i++) {
      if (suiteCancelledRef.current) break
      const p = TEST_PRESETS[i]
      const result = await runOne({
        prompt: p.prompt,
        ipaWeight: p.ipaWeight,
        controlnetStrength: 1.0,
        ipaPreset: p.ipaPreset,
        ipaWeightType: p.ipaWeightType,
        maskGrow: p.maskGrow,
        maskBlur: p.maskBlur,
        denoise: 1.0,
        steps: 30,
        cfg: 7,
        presetId: p.id,
        presetLabel: p.label,
      }, cached)
      if (result) cached = result
    }
    setSuiteRunning(false)
  }, [srcUrl, refUrl, srcMaskUrl, runOne])

  const isAnyRunning = runs.some(r => r.status !== 'done' && r.status !== 'error')
  const ready = srcUrl && refUrl && srcMaskUrl

  // Reset au setup validé "elfe blonde" qui a donné le premier bon résultat.
  // Utile quand on a tweaké des sliders sur des tests précédents et qu'on veut
  // revenir à zéro sans recharger la page (qui perdrait l'historique des runs).
  function resetToValidatedDefaults() {
    setIpaPreset('PLUS (high strength)')
    setIpaWeightType('linear')
    setIpaWeight(1.2)               // findings test suite 2026-04-30 : 0.8 trop bas, 1.2 sweet spot
    setControlnetStrength(1.0)
    setMaskGrow(0)
    setMaskBlur(0)
    setDenoise(1.0)
    setEnableFaceDetailer(true)     // FaceDetailer ON par défaut (visage net + identité fine)
    setFaceWeight(1.0)
    setFaceDenoise(0.5)
    setSteps(30)
    setCfg(7)
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1300, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC ControlNet Character Swap — pattern standard 2025 minimaliste
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          <strong>1 seul workflow ComfyUI</strong> : SDXL + ControlNet OpenPose (pose) + IPAdapter Plus (identité) +
          inpainting natif (mask). <strong style={{ color: '#10B981' }}>~3-5 min/run, pas de cascade</strong>.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* ── 🧪 CAS DE TEST E2E — preset complet + auto-pipeline ── */}
            <Section title="🧪 Cas de test (preset complet)">
              <Field label="Sélectionne un cas">
                <select value={selectedTestCase}
                  onChange={e => handleSelectTestCase(e.target.value)}
                  disabled={autoPipelineRunning}
                  style={{ ...inputStyle, padding: 6 }}>
                  <option value="">— Choisir un cas de test —</option>
                  {SWAP_TEST_CASES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </Field>
              <button onClick={handleRunAutoPipeline}
                disabled={!selectedTestCase || autoPipelineRunning || isAnyRunning || suiteRunning}
                style={{
                  ...btnStyle, width: '100%', padding: 10,
                  background: !selectedTestCase ? '#444' : autoPipelineRunning ? '#7C3AED' : '#DC2626',
                  color: 'white', fontSize: 13, fontWeight: 700,
                }}>
                {autoPipelineRunning ? '⏳ Pipeline en cours…' : '🚀 Tout automatique (5 étapes, ~5-7 min)'}
              </button>
              {autoPipelineStep && (
                <div style={{ padding: 6, background: autoPipelineStep.startsWith('❌') ? '#7f1d1d' : autoPipelineStep.startsWith('✅') ? '#065f46' : '#1e3a8a', borderRadius: 4, fontSize: 11, color: '#fff' }}>
                  {autoPipelineStep}
                </div>
              )}
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                Sélectionner un cas remplit tous les prompts ci-dessous. <strong>🚀 Tout automatique</strong> enchaîne : générer scène → générer perso → analyse Qwen VL → détection mask → body swap → FaceDetailer. Ou tu peux éditer puis lancer manuellement.
              </div>
            </Section>

            {/* ── 💬 MODE LLM — commande naturelle parsée par Qwen ── */}
            <Section title="💬 Commande naturelle (mode LLM)">
              <textarea value={llmCommand} onChange={e => setLlmCommand(e.target.value)}
                rows={2} disabled={parsingLLM}
                placeholder="ex: place une elfe blonde sur la chaise à la place de l'homme"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
              <button onClick={handleParseCommand} disabled={parsingLLM || !llmCommand.trim()}
                style={{
                  ...btnStyle, width: '100%', padding: 8,
                  background: parsingLLM ? '#444' : '#A855F7', color: 'white',
                  fontSize: 12, fontWeight: 600,
                }}>
                {parsingLLM ? '⏳ Qwen analyse la commande…' : '🤖 Traduire en actions (Qwen)'}
              </button>
              {llmError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 10 }}>❌ {llmError}</div>}
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                Décris ce que tu veux faire en français/anglais. Qwen parse → remplit auto :
                ② mot-clé Grounded-SAM · 🧝 prompt perso · ④ prompt body swap. Tu peux éditer chaque champ avant de lancer.
              </div>
            </Section>

            {/* ── 🎨 GÉNÉRATEUR SCÈNE SOURCE (T2I SDXL Juggernaut) ── */}
            <Section title="🎨 Générer scène source (optionnel)">
              <Field label="Preset">
                <select value={scenePresetId}
                  onChange={e => {
                    const id = e.target.value
                    setScenePresetId(id)
                    const p = SCENE_PRESETS.find(x => x.id === id)
                    if (p) setScenePrompt(p.prompt)
                  }}
                  disabled={generatingScene}
                  style={{ ...inputStyle, padding: 6 }}>
                  {SCENE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Prompt scène (éditable)">
                <textarea value={scenePrompt} onChange={e => setScenePrompt(e.target.value)}
                  rows={3} disabled={generatingScene}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', fontSize: 11 }} />
              </Field>
              <button onClick={handleGenerateScene} disabled={generatingScene || !scenePrompt.trim()}
                style={{
                  ...btnStyle, width: '100%', padding: 8,
                  background: generatingScene ? '#444' : '#0EA5E9', color: 'white',
                  fontSize: 12, fontWeight: 600,
                }}>
                {generatingScene ? '⏳ Génération scène (~60-90s)…' : '🎨 Générer la scène (1360×768)'}
              </button>
              {sceneGenError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 10 }}>❌ {sceneGenError}</div>}
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                Génère une scène 16:9 avec SDXL Juggernaut → remplit auto le slot ① + suggère un mot-clé Grounded-SAM en ②.
              </div>
            </Section>

            {/* ── 🧝 GÉNÉRATEUR PERSO RÉFÉRENCE (T2I SDXL Juggernaut) ── */}
            <Section title="🧝 Générer perso ref (optionnel)">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {CHARACTER_PRESETS.map(p => (
                  <button key={p.id}
                    onClick={() => setCharacterPrompt(p.prompt)}
                    disabled={generatingCharacter}
                    style={{ ...btnStyle, fontSize: 10, padding: '4px 8px', background: '#1a1a1e' }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <Field label="Prompt perso (éditable)">
                <textarea value={characterPrompt} onChange={e => setCharacterPrompt(e.target.value)}
                  rows={3} disabled={generatingCharacter}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', fontSize: 11 }} />
              </Field>
              {/* Toggle Posed Ref : aligne automatiquement la pose ref sur la scène */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, cursor: 'pointer', padding: 6, background: '#0a0a0d', borderRadius: 4, border: '1px solid #2a2a30' }}>
                <input type="checkbox" checked={usePosedRef}
                  onChange={e => setUsePosedRef(e.target.checked)}
                  disabled={generatingCharacter} />
                <span style={{ flex: 1 }}>
                  <strong>🦴 Posed Ref</strong> — aligne pose/orientation sur la scène (résout mismatch front/back)
                  {!srcUrl && <span style={{ color: '#a78bfa', fontSize: 10, marginLeft: 4 }}>· nécessite scène ①</span>}
                </span>
              </label>
              <button onClick={handleGenerateCharacter}
                disabled={generatingCharacter || !characterPrompt.trim() || (usePosedRef && !srcUrl)}
                style={{
                  ...btnStyle, width: '100%', padding: 8,
                  background: generatingCharacter ? '#444' : (usePosedRef && !srcUrl) ? '#444' : '#10B981',
                  color: 'white',
                  fontSize: 12, fontWeight: 600,
                }}>
                {generatingCharacter ? '⏳ Génération perso (~60-90s)…'
                  : usePosedRef && !srcUrl ? '⚠ Génère/charge une scène d\'abord (mode Posed Ref)'
                  : usePosedRef ? '🦴 Générer perso ALIGNÉ sur scène (Posed Ref)'
                  : '🧝 Générer le perso (1024×1024 plat)'}
              </button>
              {characterGenError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 10 }}>❌ {characterGenError}</div>}
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                {usePosedRef
                  ? '🦴 Posed Ref ON : OpenPose extrait le squelette du perso dans la scène ① → ControlNet guide la génération de la ref → orientation + posture identiques. Qualité ~95% sur orientation mismatch.'
                  : '🧝 Mode plat : T2I générique fond blanc. Plus rapide mais peut créer des artefacts si la scène est de dos et la ref de face. Active Posed Ref pour résoudre.'}
              </div>
            </Section>

            <Section title="① Scène source">
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpload('src', e)} disabled={uploading !== null}
                style={{ ...inputStyle, padding: 6 }} />
              {uploading === 'src' && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
              {srcUrl && <div style={{ marginTop: 6, background: `url(${srcUrl}) center/contain no-repeat #1a1a1e`, height: 130, border: '1px solid #2a2a30', borderRadius: 4 }} />}
            </Section>

            <Section title="② Zone à remplacer">
              <div style={{ fontSize: 11, color: '#666' }}>
                Mot-clé EN du sujet à remplacer (Grounded-SAM)
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={srcMaskPrompt} onChange={e => setSrcMaskPrompt(e.target.value)}
                  placeholder="ex: man, person, cat" disabled={!srcUrl || detectingMask}
                  style={{ ...inputStyle, flex: 1 }} />
                <button onClick={handleDetectMask}
                  disabled={!srcUrl || !srcMaskPrompt.trim() || detectingMask}
                  style={{ ...btnStyle, background: (!srcUrl || !srcMaskPrompt.trim() || detectingMask) ? '#444' : '#7C3AED', fontWeight: 600 }}>
                  {detectingMask ? '⏳' : '🎯 Détecter'}
                </button>
              </div>
              {srcMaskUrl && <div style={{ marginTop: 6, background: `url(${srcMaskUrl}) center/contain no-repeat #1a1a1e`, height: 100, border: '1px solid #10B981', borderRadius: 4 }} />}
              {srcMaskUrl && (
                <button onClick={handleKeepLargestZone} disabled={filteringMask}
                  style={{ ...btnStyle, background: filteringMask ? '#444' : '#1a1a1e', border: '1px solid #10B981', fontSize: 11 }}>
                  {filteringMask ? '⏳' : '🎯 Conserver la plus grande zone'}
                </button>
              )}
              {maskError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {maskError}</div>}
            </Section>

            <Section title="③ Référence (nouveau perso)">
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpload('ref', e)} disabled={uploading !== null}
                style={{ ...inputStyle, padding: 6 }} />
              {uploading === 'ref' && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
              {refUrl && <div style={{ marginTop: 6, background: `url(${refUrl}) center/contain no-repeat #1a1a1e`, height: 130, border: '1px solid #2a2a30', borderRadius: 4 }} />}
              <div style={{ fontSize: 9, color: '#666' }}>
                IPAdapter Plus extrait l&apos;identité visuelle. Pas besoin de fond blanc — il fait du focus auto.
              </div>

              {/* Auto-analyse Qwen VL : extrait les attributs que IPAdapter rate
                  (cheveux, yeux, race, age) → injecté en début de prompt body swap. */}
              {refUrl && (
                <div style={{ marginTop: 8, padding: 8, background: '#0a0a0d', border: '1px solid #2a2a30', borderRadius: 4 }}>
                  <div style={{ fontSize: 10, color: '#10B981', fontWeight: 600, marginBottom: 4 }}>
                    🤖 Tags auto (Qwen VL)
                  </div>
                  {analyzingCharacter ? (
                    <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Analyse du perso (~3-60s)…</div>
                  ) : characterAnalysisError ? (
                    <div style={{ fontSize: 10, color: '#7f1d1d' }}>❌ {characterAnalysisError}</div>
                  ) : (
                    <>
                      <textarea value={characterTags} onChange={e => setCharacterTags(e.target.value)}
                        rows={2} placeholder="long blonde hair, blue eyes, fair skin, elf with pointed ears, young adult woman"
                        style={{ ...inputStyle, padding: 6, fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} />
                      <div style={{ fontSize: 9, color: '#666', marginTop: 3, lineHeight: 1.4 }}>
                        Attributs détectés par Qwen 2.5 VL (cheveux, yeux, race, age). Injectés au début du prompt → le modèle les génère explicitement même quand IPAdapter les rate. Édite si Qwen s&apos;est trompé.
                      </div>
                    </>
                  )}
                </div>
              )}
            </Section>

            <Section title="④ Prompt (style + contexte + pose)">
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.5 }}>
                ✅ Style + ambiance + lumière + décor + <strong>pose/position</strong> (surtout si le perso est partiellement caché — OpenPose ne détecte pas tout, le prompt aide).<br />
                ❌ Pas d&apos;identité (genre/cheveux/race/vêtements) — c&apos;est la ref ③ qui décide.<br />
                Ex assise table : <em>&ldquo;woman seated at a wooden tavern table, leaning forward, hands on table, painterly fantasy illustration, warm candlelight, medieval interior, detailed background&rdquo;</em>
              </div>
            </Section>

            <Section title="⑤ Paramètres">
              <button onClick={resetToValidatedDefaults}
                style={{
                  ...btnStyle, width: '100%', padding: '8px',
                  background: '#0E7490', color: 'white',
                  fontSize: 11, fontWeight: 600, marginBottom: 12,
                }}>
                🔄 Reset aux defaults validés (test suite 2026-04-30)
              </button>
              <div style={{ fontSize: 9, color: '#666', marginBottom: 12, lineHeight: 1.4 }}>
                ⭐ Defaults validés (test suite 30 runs) : preset <strong>PLUS</strong>, weight_type <strong>linear</strong>, ipa <strong>1.2</strong> (A05), cn 1.0, denoise 1.0, mask 0/0, 30 steps, CFG 7, <strong>FaceDetailer ON</strong> (face_weight 1.0, face_denoise 0.5).
              </div>
              <Field label="IPAdapter preset">
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => setIpaPreset('PLUS (high strength)')}
                    style={{
                      ...btnStyle, flex: 1, padding: '6px 4px', fontSize: 10,
                      background: ipaPreset === 'PLUS (high strength)' ? '#10B981' : '#1a1a1e',
                      fontWeight: ipaPreset === 'PLUS (high strength)' ? 700 : 400,
                    }}>
                    🔄 PLUS (universel)
                  </button>
                  <button onClick={() => setIpaPreset('PLUS FACE (portraits)')}
                    style={{
                      ...btnStyle, flex: 1, padding: '6px 4px', fontSize: 10,
                      background: ipaPreset === 'PLUS FACE (portraits)' ? '#7C3AED' : '#1a1a1e',
                      fontWeight: ipaPreset === 'PLUS FACE (portraits)' ? 700 : 400,
                    }}>
                    👤 PLUS FACE (humain)
                  </button>
                </div>
                <div style={{ fontSize: 9, color: '#666' }}>
                  PLUS = universel (humain + animal + objet). PLUS FACE = visages humains uniquement, meilleure préservation visage/coiffure/vêtements.
                </div>
              </Field>
              <Field label="Weight type">
                <select value={ipaWeightType} onChange={e => setIpaWeightType(e.target.value as typeof ipaWeightType)}
                  style={{ ...inputStyle, padding: 6 }}>
                  <option value="linear">linear (best @ 1.2 — A05 test suite ⭐)</option>
                  <option value="ease in-out">ease in-out (best @ 1.0 — B06 test suite ⭐)</option>
                  <option value="style transfer">style transfer (style only, identité ignorée)</option>
                  <option value="strong style transfer">strong style transfer (style only, très strict)</option>
                  <option value="composition">composition (composition uniquement)</option>
                  <option value="strong middle">strong middle (force au milieu sampling)</option>
                </select>
                <div style={{ fontSize: 9, color: '#666' }}>
                  ⭐ <strong>linear @ 1.2</strong> ou <strong>ease in-out @ 1.0</strong> = combos validés par le test suite. ❌ &ldquo;style transfer&rdquo; / &ldquo;strong style transfer&rdquo; ne transfèrent QUE le style, identité ignorée.
                </div>
              </Field>
              <Field label={`IPAdapter weight : ${ipaWeight.toFixed(2)}`}>
                <input type="range" min={0} max={1.5} step={0.05} value={ipaWeight}
                  onChange={e => setIpaWeight(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>
                  ⭐ <strong>1.2 + linear</strong> ou <strong>1.0 + ease in-out</strong> = sweet spots validés. 0.8 trop bas (identité ne perce pas).
                </div>
              </Field>
              <Field label={`ControlNet strength : ${controlnetStrength.toFixed(2)}`}>
                <input type="range" min={0} max={1.5} step={0.05} value={controlnetStrength}
                  onChange={e => setControlnetStrength(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>1.0 = officiel xinsir SDXL</div>
              </Field>
              <Field label={`Mask dilation : ${maskGrow}px`}>
                <input type="range" min={0} max={150} step={5} value={maskGrow}
                  onChange={e => setMaskGrow(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>
                  Étend la zone du mask. ↑ pour grandes robes / vêtements amples (anti-écho).
                </div>
              </Field>
              <Field label={`Mask blur : ${maskBlur}px`}>
                <input type="range" min={0} max={48} step={1} value={maskBlur}
                  onChange={e => setMaskBlur(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>
                  Adoucit les bords du mask (anti-bordure dure).
                </div>
              </Field>
              <Field label={`Denoise : ${denoise.toFixed(2)}`}>
                <input type="range" min={0.5} max={1.0} step={0.05} value={denoise}
                  onChange={e => setDenoise(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>
                  1.0 = swap perso (régénère tout, recommandé). &lt;1.0 = stylisation (garde features originales, à éviter pour swap car contamine la ref).
                </div>
              </Field>
              <Field label={`Steps : ${steps}`}>
                <input type="range" min={20} max={60} step={1} value={steps}
                  onChange={e => setSteps(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>40+ recommandé pour visages SDXL</div>
              </Field>
              <Field label={`CFG : ${cfg.toFixed(1)}`}>
                <input type="range" min={3} max={12} step={0.5} value={cfg}
                  onChange={e => setCfg(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
            </Section>

            {/* ⑥ FaceDetailer : régénération HD du visage avec IPAdapter FaceID Plus v2 */}
            <Section title="⑥ Améliorer le visage (FaceDetailer)">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={enableFaceDetailer}
                  onChange={e => setEnableFaceDetailer(e.target.checked)} />
                <span>Activer FaceDetailer (+30-60s, +1-2 GB VRAM transitoire)</span>
              </label>
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                Détecte le visage avec YOLO → crop 512×512 → régénère HD avec <strong>IPAdapter FaceID Plus v2</strong> + même ref → blend dans la scène. Indispensable quand la face est petite (40-60px).
              </div>
              {enableFaceDetailer && (
                <>
                  <Field label={`FaceID weight : ${faceWeight.toFixed(2)}`}>
                    <input type="range" min={0} max={2} step={0.05} value={faceWeight}
                      onChange={e => setFaceWeight(Number(e.target.value))} style={{ width: '100%' }} />
                    <div style={{ fontSize: 9, color: '#666' }}>
                      1.0 = identité forte (recommandé). &gt;1 = très strict (peut overfit). &lt;0.7 = identité diffuse.
                    </div>
                  </Field>
                  <Field label={`Face denoise : ${faceDenoise.toFixed(2)}`}>
                    <input type="range" min={0.3} max={0.8} step={0.05} value={faceDenoise}
                      onChange={e => setFaceDenoise(Number(e.target.value))} style={{ width: '100%' }} />
                    <div style={{ fontSize: 9, color: '#666' }}>
                      0.5 = équilibré (recommandé). 0.7-0.8 = visage très régénéré (proche ref). 0.3-0.4 = subtil (garde + de la 1ère passe).
                    </div>
                  </Field>
                </>
              )}
            </Section>

            <button onClick={handleGenerate}
              disabled={!ready || isAnyRunning || suiteRunning}
              style={{
                ...btnStyle,
                background: (!ready || isAnyRunning || suiteRunning) ? '#444' : '#10B981',
                padding: 12, fontSize: 14, fontWeight: 700,
              }}>
              {isAnyRunning && !suiteRunning ? '⏳ Remplacement…'
                : suiteRunning ? '⏳ Test suite en cours…'
                : !srcUrl ? '⚠ Upload une scène'
                : !srcMaskUrl ? '⚠ Détecte zone à remplacer'
                : !refUrl ? '⚠ Upload référence du nouveau perso'
                : '🔄 Remplacer le personnage'}
            </button>

            {/* Test suite : 30 runs avec params variés, ~45 min total */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={handleRunTestSuite}
                disabled={!ready || isAnyRunning || suiteRunning}
                style={{
                  ...btnStyle, flex: 1,
                  background: (!ready || suiteRunning) ? '#444' : '#7C3AED',
                  color: 'white', padding: 10, fontSize: 12, fontWeight: 600,
                }}>
                {suiteRunning ? `⏳ Suite (${runs.filter(r => r.presetId && (r.status === 'done' || r.status === 'error')).length}/${TEST_PRESETS.length})` : `🧪 Test suite (${TEST_PRESETS.length} runs, ~${Math.ceil(TEST_PRESETS.length * 1.5)} min)`}
              </button>
              {suiteRunning && (
                <button onClick={() => { suiteCancelledRef.current = true }}
                  style={{ ...btnStyle, background: '#7f1d1d', color: 'white', fontSize: 11, padding: '0 10px' }}>
                  ✕ Stop
                </button>
              )}
            </div>

            {uploadError && <div style={{ padding: 8, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {uploadError}</div>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10B981', textTransform: 'uppercase' }}>
              Historique ({runs.length})
            </div>
            {runs.length === 0 && (
              <div style={{ padding: 24, background: '#0f0f13', border: '1px dashed #2a2a30', borderRadius: 6, fontSize: 12, color: '#666', textAlign: 'center' }}>
                Pattern standard 2025. Upload scène + ref, détecte zone, remplace.
                <br />~3-5 min/run sur 8 GB VRAM (1 modèle SDXL chargé).
              </div>
            )}
            {runs.map(run => <RunCard key={run.id} run={run} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──
function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`load failed: ${url}`))
    img.src = url
  })
}
async function uploadBlob(blob: Blob, path: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, path.split('/').pop() ?? 'file.png')
  form.append('path', path.replace(/\.png$/, ''))
  const res = await fetch('/api/upload-image', { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok || !data.url) throw new Error(data.error ?? 'upload blob failed')
  return data.url
}
async function uploadToComfy(url: string, name: string): Promise<string> {
  const res = await fetch('/api/comfyui/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'url', url, name }),
  })
  const data = await res.json()
  if (!res.ok || !data.filename) throw new Error(data.error ?? `comfy upload ${name} failed`)
  return data.filename
}

function RunCard({ run }: { run: Run }) {
  const elapsed = Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)
  const presetShort = run.ipaPreset.replace(/\(.*\)/, '').trim()
  return (
    <div style={{ padding: 10, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* En-tête : preset id (T01..) + label + statut */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {run.presetId && (
            <span style={{ padding: '2px 6px', background: '#7C3AED', color: '#fff', borderRadius: 3, fontSize: 10, fontWeight: 700 }}>
              {run.presetId}
            </span>
          )}
          <span style={{ color: '#ede9df', fontWeight: 600 }}>{run.presetLabel ?? 'Manuel'}</span>
        </span>
        <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
          background: run.status === 'done' ? '#10B981'
            : run.status === 'error' ? '#7f1d1d'
            : run.status === 'face-enhancing' ? '#7C3AED'
            : '#F97316', color: '#fff' }}>
          {run.status} · {elapsed}s
        </span>
      </div>
      {/* Bandeau params clés — toutes les valeurs nécessaires pour reproduire ce run */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 9, color: '#9898b4' }}>
        <code style={{ background: '#1a1a1e', padding: '2px 5px', borderRadius: 3 }}>{presetShort}</code>
        <code style={{ background: '#1a1a1e', padding: '2px 5px', borderRadius: 3, color: '#10B981' }}>ipa {run.ipaWeight.toFixed(2)}</code>
        <code style={{ background: '#1a1a1e', padding: '2px 5px', borderRadius: 3 }}>{run.ipaWeightType}</code>
        <code style={{ background: '#1a1a1e', padding: '2px 5px', borderRadius: 3 }}>cn {run.controlnetStrength.toFixed(2)}</code>
        <code style={{ background: '#1a1a1e', padding: '2px 5px', borderRadius: 3 }}>mask g{run.maskGrow}/b{run.maskBlur}</code>
        <code style={{ background: '#1a1a1e', padding: '2px 5px', borderRadius: 3 }}>denoise {run.denoise.toFixed(2)}</code>
        <code style={{ background: '#1a1a1e', padding: '2px 5px', borderRadius: 3 }}>{run.steps}st · cfg {run.cfg.toFixed(1)}</code>
      </div>
      {/* Prompt complet (peut différer entre runs du test suite) */}
      <details style={{ fontSize: 10, color: '#666' }}>
        <summary style={{ cursor: 'pointer' }}>prompt</summary>
        <div style={{ marginTop: 4, padding: 6, background: '#1a1a1e', borderRadius: 3, color: '#9898b4', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          {run.prompt || '(vide → "illustration")'}
        </div>
      </details>
      {run.status === 'done' && run.resultUrl && (
        <img src={run.resultUrl} alt="result" style={{ width: '100%', borderRadius: 4, background: '#000' }} />
      )}
      {run.status === 'error' && (
        <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {run.error}</div>
      )}
    </div>
  )
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#10B981', textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: 11, color: '#9898b4' }}>{label}</label>
      {children}
    </div>
  )
}

const pageStyle: React.CSSProperties = { minHeight: '100vh', padding: '2rem', background: '#0d0d0d', color: '#ede9df', fontFamily: 'Inter, -apple-system, sans-serif' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', background: '#1a1a1e', border: '1px solid #2a2a30', borderRadius: 4, color: '#ede9df', fontSize: 12 }
const btnStyle: React.CSSProperties = { padding: '8px 12px', background: '#1a1a1e', border: '1px solid #2a2a30', borderRadius: 4, color: '#ede9df', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }
