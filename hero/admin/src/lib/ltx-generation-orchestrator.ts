/**
 * ltx-generation-orchestrator — orchestre une génération LTX 2.3 complète
 * pour une pellicule (multi-shots, lipsync, scène).
 *
 * Extrait de DesignerLayout.handleGeneratePellicule pour être réutilisable
 * entre l'ancien Designer (`/editor-test/new-layout`) et le nouvel écran
 * AnimationStudio (`/editor-test/animation-studio`).
 *
 * Pipeline :
 *   1. Résolution image source (firstFrame > prev.lastFrame > flatten base)
 *   2. Génération TTS multi-shots via buildDialogueAudio (lipsync auto)
 *   3. Auto-Qwen VL pour scène + apparence persos si vide
 *   4. Traduction FR→EN actions + scène
 *   5. buildVantagePrompt avec overrides scène
 *   6. runLtx23Dual avec audio custom + image source
 *   7. Patch des durées calculées sur les shots de la pellicule
 *
 * Le caller fournit les callbacks pour interagir avec le state React (set
 * progress, patch pellicule/shots) — pas de dépendance directe.
 */

import type { AnimationPellicule } from '@/components/image-editor/EditorStateContext'
import type { Character } from '@/lib/character-store'
import { runLtx23Dual, runLtx23DualV2v, type Ltx23DualResult } from '@/lib/comfyui-ltx-dual'
import { buildVantagePrompt } from '@/lib/ltx-vantage-prompt'
import { buildDialogueAudio, MissingVoiceError } from '@/lib/dialogue-audio'
import {
  resolveEffectiveScene,
  describeSceneViaVision,
  translateSceneFieldToEn,
} from '@/lib/scene-description'
import { flattenLayersToImage } from '@/lib/flatten-layers'
import type { EditorLayer } from '@/components/image-editor/types'

/** Calcule des dimensions LTX qui préservent l'aspect de l'image source.
 *
 *  Contraintes LTX :
 *   - Multiples de 32 sur chaque dim (ImageResizeKJv2 + EmptyLTXVLatentVideo)
 *   - Plus grand côté ≤ 1280 sur 8 GB VRAM (sinon OOM)
 *   - Min 320 sur chaque dim (en dessous LTX dégrade fort)
 *
 *  Strategy : on garde le plus grand côté à 1280 et on calcule l'autre
 *  proportionnellement (round nearest 32). Si l'image fait pile 16:9 →
 *  on retombe sur 1280×720 (defaults workflow), donc ce calcul ne change
 *  rien pour le cas historique. Pour 9:16 → 720×1280 (portrait correct).
 *  Pour 1:1 → 1024×1024 (cap inférieur pour rester sous le budget VRAM
 *  d'un 1280×720 = 921600 px ; 1024² = 1048576, légèrement plus mais OK).
 */
function computeLtxDimensions(srcW: number, srcH: number): { width: number; height: number } {
  const LONGER_EDGE_MAX = 1280
  const MIN = 320
  const round32 = (v: number) => Math.max(MIN, Math.round(v / 32) * 32)
  if (srcW <= 0 || srcH <= 0) {
    return { width: 1280, height: 720 }  // fallback safe
  }
  const isLandscape = srcW >= srcH
  const longer = LONGER_EDGE_MAX
  const shorter = round32((LONGER_EDGE_MAX * Math.min(srcW, srcH)) / Math.max(srcW, srcH))
  return isLandscape
    ? { width: longer, height: shorter }
    : { width: shorter, height: longer }
}

/** Charge l'image source pour récupérer ses dimensions naturelles. Tolérant :
 *  fallback à 1280×720 (16:9 historique) si la lib échoue (CORS, image cassée,
 *  contexte non-browser…). On préfère générer en 16:9 plutôt que de planter. */
function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ width: 1280, height: 720 })
      return
    }
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => {
      console.warn('[ltx-orchestrator] Impossible de charger l\'image pour mesurer ses dims, fallback 1280×720:', url)
      resolve({ width: 1280, height: 720 })
    }
    img.src = url
  })
}

export interface GenerateAnimationOptions {
  /** Pellicule à générer. */
  pellicule: AnimationPellicule
  /** Toutes les pellicules (pour résoudre prev.lastFrameUrl + héritage scène). */
  allPellicules: AnimationPellicule[]
  /** Tous les characters du store (pour TTS voice_id + descriptions). */
  characters: Character[]
  /** URL image base du plan (fallback si pas de firstFrame ni prev.lastFrame). */
  baseImageUrl: string | null
  /** Calques à flatten avec l'image base si on doit composer (sinon vide). */
  layers?: EditorLayer[]
  /** Position spatiale de chaque perso dans la scène source, indexée par
   *  characterId. Refonte 2026-05-10 — chemin A déterministe pour ancrer
   *  l'identité dans le LoRA Dual sans Qwen VL. Computed côté caller depuis
   *  les Designer layers (placement.x normalisé 0-1 → left/center/right).
   *  Si vide ou champ manquant pour un char, fallback B = Qwen VL via
   *  charactersAppearance auto-fill (déjà branché). */
  characterPositions?: Record<string, 'left' | 'center' | 'right'>
  /** Préfixe Storage Supabase pour ranger les artefacts générés (TTS, frames). */
  storagePathPrefix?: string

  // ── Callbacks state React (gérés par le caller) ─────────────────────────
  /** Update progressif du label affiché à l'auteur (TTS, gen, etc.). */
  onProgress?: (label: string) => void
  /** Patch d'un shot (utilisé pour propager les durées calculées des TTS). */
  onPatchShot?: (shotId: string, patch: Partial<AnimationPellicule['shots'][number]>) => void
  /** Patch de la pellicule (utilisé pour persister les valeurs auto Qwen VL). */
  onPatchPellicule?: (patch: Partial<AnimationPellicule>) => void
}

export interface GenerateAnimationResult {
  /** URL Supabase de la vidéo MP4 générée. */
  videoUrl: string
  /** 1ère frame (poster). null si extraction échouée. */
  firstFrameUrl: string | null
  /** Dernière frame (continuité). null si extraction échouée. */
  lastFrameUrl: string | null
  /** Si un parent prev a été utilisé en continuité I2V → on retient son
   *  lastFrameUrl pour matcher exactement firstFrameUrl côté UI. */
  usedPrevAsContinuityInput: boolean
  /** Le prev.lastFrameUrl utilisé (si usedPrevAsContinuityInput=true). */
  prevLastFrameUrl: string | null
}

/** Erreur thrown quand un perso parlant n'a pas de voice_id défini.
 *  Le caller catch ça pour afficher un message à l'auteur (fail loud). */
export { MissingVoiceError } from '@/lib/dialogue-audio'

/** Lance la pipeline complète de génération d'une pellicule LTX 2.3 avec
 *  lipsync, scène et multi-shots. Throw `MissingVoiceError` si voice_id
 *  manquant. Retourne l'URL vidéo + frames extraites en cas de succès. */
export async function generateAnimationPellicule(
  opts: GenerateAnimationOptions,
): Promise<GenerateAnimationResult> {
  const {
    pellicule, allPellicules, characters, baseImageUrl, layers = [],
    characterPositions,
    storagePathPrefix = `studio/animation/${pellicule.id}`,
    onProgress, onPatchShot, onPatchPellicule,
  } = opts

  const log = (label: string) => onProgress?.(label)

  // ── Détection mode V2V (refonte 2026-05-11) ──────────────────────────
  // Si pellicule.v2vContinue === true, on bascule en mode V2V Extend qui
  // chaîne le mouvement depuis les 8 dernières frames de prev.videoUrl
  // (vs I2V qui démarre d'1 image figée et casse le mouvement). Le reste
  // du pipeline (TTS, scène, prompt) reste identique.
  const idx = allPellicules.findIndex(p => p.id === pellicule.id)
  const prev = idx > 0 ? allPellicules[idx - 1] : null
  const isV2v = pellicule.v2vContinue === true
  if (isV2v && !prev?.videoUrl) {
    throw new Error('Mode V2V : la pellicule précédente n\'a pas de vidéo générée — génère-la d\'abord, ou utilise "Pellicule vide" pour un I2V classique.')
  }

  // ── Résolution image source (uniquement utile en I2V — sert aussi pour
  //    Qwen VL même en V2V via la lastFrame de prev) ──────────────────────
  // Règle I2V : firstFrameUrl > prev.lastFrameUrl > flatten(base)
  let sourceImage: string
  let usedPrevAsContinuityInput = false
  if (isV2v) {
    // V2V : on utilise prev.lastFrameUrl pour Qwen VL et getImageDimensions
    // (= référence visuelle du dernier état). L'orchestrator V2V passera
    // prev.videoUrl en plus pour l'extraction des 8 frames.
    sourceImage = prev!.lastFrameUrl ?? prev!.firstFrameUrl ?? baseImageUrl ?? ''
    if (!sourceImage) {
      throw new Error('V2V : pas d\'image de référence trouvée pour Qwen VL (lastFrame/firstFrame/base tous absents).')
    }
    usedPrevAsContinuityInput = true
  } else if (pellicule.firstFrameUrl) {
    sourceImage = pellicule.firstFrameUrl
  } else if (prev?.lastFrameUrl) {
    sourceImage = prev.lastFrameUrl
    usedPrevAsContinuityInput = true
  } else if (baseImageUrl) {
    log('Composition de l\'image source…')
    sourceImage = await flattenLayersToImage({
      baseImageUrl,
      layers,
      storagePathPrefix: `${storagePathPrefix}/source/${Date.now()}`,
    })
  } else {
    throw new Error('Aucune image source : ni base de plan, ni pellicule précédente avec lastFrame.')
  }

  // ── Génération audio TTS (lipsync) ──────────────────────────────────
  log('Génération des voix…')
  let dialogueAudioUrl: string | undefined
  let computedShotDurations: Record<string, number> | undefined
  const dialogueResult = await buildDialogueAudio({
    shots: pellicule.shots,
    // Refonte 2026-05-07 : characterIds est par shot. On collecte l'union
    // de tous les chars de tous les shots pour le param characterIds (= ordre
    // d'apparition).
    characterIds: Array.from(new Set(pellicule.shots.flatMap(s => s.characterIds))),
    characters,
    storagePathPrefix: `${storagePathPrefix}/dialogue`,
  })
  if (dialogueResult) {
    dialogueAudioUrl = dialogueResult.audioUrl
    computedShotDurations = dialogueResult.shotDurations
  }

  // Patch les durées calculées sur la pellicule (pour que l'UI les voie).
  // Refonte 2026-05-12 — fix bug "durée 8s manuelle écrasée par TTS 3s" :
  // on prend le MAX entre la durée demandée par l'auteur et la durée requise
  // par le TTS. Le TTS PEUT étendre la durée (sinon dialogue coupé) mais ne
  // doit JAMAIS la réduire (l'auteur a souvent besoin de marge avant/après
  // pour les actions silencieuses : se retourner, lever la lettre, etc.).
  if (computedShotDurations && onPatchShot) {
    pellicule.shots.forEach(shot => {
      const ttsDur = computedShotDurations[shot.id]
      if (typeof ttsDur === 'number') {
        const finalDur = Math.max(shot.duration, ttsDur)
        if (finalDur !== shot.duration) {
          onPatchShot(shot.id, { duration: finalDur })
        }
      }
    })
  }

  // ── Traduction FR→EN des actions de tous les shots ──────────────────
  log('Traduction des actions…')
  const translatedShots = await Promise.all(pellicule.shots.map(async (shot) => {
    const translatedPerCharacter: typeof shot.perCharacter = {}
    await Promise.all(Object.entries(shot.perCharacter).map(async ([cid, data]) => {
      let actionEn = data.action
      if (data.action.trim()) {
        try {
          const tRes = await fetch('/api/translate-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: data.action }),
          })
          const tData = await tRes.json() as { text_en?: string; error?: string }
          if (tRes.ok && tData.text_en) actionEn = tData.text_en
        } catch (err) {
          console.warn(`[ltx-orchestrator] traduction action ${cid} (shot ${shot.id}) échouée, fallback FR:`, err)
        }
      }
      translatedPerCharacter[cid] = { action: actionEn, dialogue: data.dialogue }
    }))
    return {
      ...shot,
      perCharacter: translatedPerCharacter,
      // MAX (manuel, TTS) — cohérent avec le patch UI ci-dessus.
      // Refonte 2026-05-12.
      duration: Math.max(shot.duration, computedShotDurations?.[shot.id] ?? 0),
    }
  }))
  const pellTranslated: typeof pellicule = { ...pellicule, shots: translatedShots }

  // ── Description de scène (auto Qwen VL si vide) ─────────────────────
  let sceneEffective = resolveEffectiveScene(pellicule, allPellicules)
  if (!sceneEffective.scene_visible?.trim()) {
    log('Analyse de la scène (Qwen VL)…')
    try {
      const r = await describeSceneViaVision(sourceImage, 'scene')
      sceneEffective = { ...sceneEffective, scene_visible: r.description }
      onPatchPellicule?.({ scene_visible: r.description })
    } catch (err) {
      console.warn('[ltx-orchestrator] Qwen VL scene auto échoué:', err)
    }
  }
  if (!sceneEffective.characters_appearance?.trim()) {
    log('Analyse des personnages (Qwen VL)…')
    try {
      const r = await describeSceneViaVision(sourceImage, 'characters')
      sceneEffective = { ...sceneEffective, characters_appearance: r.description }
      onPatchPellicule?.({ characters_appearance: r.description })
    } catch (err) {
      console.warn('[ltx-orchestrator] Qwen VL characters auto échoué:', err)
    }
  }
  // Traduction des champs scène saisis à la main (no-op si déjà EN)
  const [sceneVisibleEn, sceneOffscreenEn, charactersAppearanceEn] = await Promise.all([
    sceneEffective.scene_visible ? translateSceneFieldToEn(sceneEffective.scene_visible) : Promise.resolve(null),
    sceneEffective.scene_offscreen ? translateSceneFieldToEn(sceneEffective.scene_offscreen) : Promise.resolve(null),
    sceneEffective.characters_appearance ? translateSceneFieldToEn(sceneEffective.characters_appearance) : Promise.resolve(null),
  ])

  // ── Build prompt + lance LTX ─────────────────────────────────────────
  const positivePrompt = buildVantagePrompt(pellTranslated, characters, {
    sceneVisible: sceneVisibleEn,
    sceneOffscreen: sceneOffscreenEn,
    charactersAppearance: charactersAppearanceEn,
    characterPositions,
  })
  console.log('[ltx-orchestrator] LTX prompt:', positivePrompt)
  if (dialogueAudioUrl) console.log('[ltx-orchestrator] LTX mode: custom audio (lipsync)')
  else console.log('[ltx-orchestrator] LTX mode: foley (no dialogue)')

  // Détecte les dims de l'image source pour produire une vidéo dans le même
  // aspect (refonte 2026-05-10). Sinon LTX force du 16:9 hardcodé et un crop
  // 9:16 / 1:1 / 4:3 se fait massacrer par center-crop côté workflow.
  const srcDims = await getImageDimensions(sourceImage)
  const ltxDims = computeLtxDimensions(srcDims.width, srcDims.height)

  // Durée totale = somme des shot.duration (déjà recalculée si dialogue audio
  // a allongé un shot). Cap workflow Vantage = 20s. Refonte 2026-05-10 :
  // avant, le workflow utilisait 15s hardcoded ignorant complètement la
  // durée des shots — toute pellicule sortait à 15s peu importe le prompt.
  const totalDurationSec = Math.max(
    1,
    Math.min(20, Math.round(translatedShots.reduce((sum, s) => sum + (s.duration ?? 0), 0))),
  )
  console.log(`[ltx-orchestrator] Source image ${srcDims.width}×${srcDims.height} → LTX ${ltxDims.width}×${ltxDims.height} · ${totalDurationSec}s`)

  const result: Ltx23DualResult = isV2v
    ? await runLtx23DualV2v({
        prevVideoUrl: prev!.videoUrl!,
        positivePrompt,
        audioUrl: dialogueAudioUrl,
        seed: -1,
        width: ltxDims.width,
        height: ltxDims.height,
        durationSec: totalDurationSec,
        onProgress: p => log(p.label ?? p.stage),
      })
    : await runLtx23Dual({
        imageUrl: sourceImage,
        positivePrompt,
        audioUrl: dialogueAudioUrl,
        seed: -1,
        width: ltxDims.width,
        height: ltxDims.height,
        durationSec: totalDurationSec,
        onProgress: p => log(p.label ?? p.stage),
      })

  return {
    videoUrl: result.video_url,
    firstFrameUrl: usedPrevAsContinuityInput ? prev?.lastFrameUrl ?? null : result.first_frame_url,
    lastFrameUrl: result.last_frame_url,
    usedPrevAsContinuityInput,
    prevLastFrameUrl: prev?.lastFrameUrl ?? null,
  }
}
