/**
 * scene-description — utilitaires pour la description de scène / persos d'une
 * pellicule animée (Studio Designer, β.1+ 2026-05-06).
 *
 * Modèle :
 *   - Chaque pellicule a 3 champs scène (`scene_visible`, `scene_offscreen`,
 *     `characters_appearance`). `null` = hérite de la pellicule 1.
 *   - L'auteur peut soit cliquer 🪄 (auto Qwen VL) soit taper à la main.
 *   - Au moment de la génération, on résout les valeurs effectives + on
 *     traduit FR→EN si nécessaire.
 *
 * Ce module ne dépend PAS de React — uniquement fetch + types — pour pouvoir
 * être appelé depuis n'importe quel handler / composant.
 */

import type { AnimationPellicule } from '@/components/image-editor/EditorStateContext'

/** Résultat des appels Qwen VL via `/api/describe-scene`. */
export interface SceneDescriptionResult {
  description: string
  engine_used: 'qwen' | 'claude'
  fallback_reason?: string
}

/** Champs scène d'une pellicule (sans le reste de la struct). */
export interface SceneFields {
  scene_visible: string | null
  scene_offscreen: string | null
  characters_appearance: string | null
}

/** Résolution avec héritage : si la pellicule N a des champs `null`, on les
 *  remplace par ceux de la pellicule 1 (la "scène de référence" du plan).
 *  La pellicule 1 elle-même n'hérite de rien (elle EST la référence).
 *
 *  Retourne TOUJOURS un objet (jamais undefined). Les champs peuvent rester
 *  `null` si la pellicule 1 ne les a pas non plus → l'appelant gère le cas
 *  vide (auto-Qwen ou prompt minimaliste). */
export function resolveEffectiveScene(
  pell: AnimationPellicule,
  allPellicules: AnimationPellicule[],
): SceneFields {
  const ref = allPellicules[0]
  const isFirst = ref && ref.id === pell.id
  // Si on EST la 1ère, pas d'héritage possible — retourner les valeurs brutes
  if (isFirst || !ref) {
    return {
      scene_visible: pell.scene_visible,
      scene_offscreen: pell.scene_offscreen,
      characters_appearance: pell.characters_appearance,
    }
  }
  // Sinon, héritage champ par champ : null override = utilise pellicule 1
  return {
    scene_visible: pell.scene_visible ?? ref.scene_visible,
    scene_offscreen: pell.scene_offscreen ?? ref.scene_offscreen,
    characters_appearance: pell.characters_appearance ?? ref.characters_appearance,
  }
}

/** Indique si la pellicule a au moins un override (= un champ non-null) par
 *  rapport à la pellicule 1. Utile pour afficher un badge "✓ validée" ou pour
 *  détecter qu'il y a une scène à décrire. */
export function hasOwnSceneOverride(pell: AnimationPellicule): boolean {
  return (
    pell.scene_visible !== null ||
    pell.scene_offscreen !== null ||
    pell.characters_appearance !== null
  )
}

/** Détermine si la scène effective est suffisamment renseignée pour LTX
 *  (au moins un visible défini). Sinon → on doit auto-déclencher Qwen VL
 *  avant la génération. */
export function isSceneReadyForGeneration(effective: SceneFields): boolean {
  return !!effective.scene_visible && effective.scene_visible.trim().length > 0
}

/** Résout l'image source qui sera envoyée à Qwen VL pour le suggest 🪄.
 *  Règle : firstFrameUrl > prev.lastFrameUrl > baseImageUrl > null.
 *  Identique en esprit à la résolution de handleGeneratePellicule (sauf
 *  qu'on n'a pas le flatten composite ici car ça impliquerait un upload
 *  Supabase trop coûteux pour un simple suggest).
 *
 *  Retourne null si aucune source image disponible — l'appelant désactive
 *  le bouton 🪄 dans ce cas. */
export function resolveSceneSourceImage(
  pell: AnimationPellicule,
  allPellicules: AnimationPellicule[],
  baseImageUrl: string | null,
): string | null {
  if (pell.firstFrameUrl) return pell.firstFrameUrl
  const idx = allPellicules.findIndex(p => p.id === pell.id)
  if (idx > 0) {
    const prev = allPellicules[idx - 1]
    if (prev?.lastFrameUrl) return prev.lastFrameUrl
  }
  return baseImageUrl
}

/** Wrap autour de `/api/describe-scene` — encapsule le fetch + l'erreur. */
export async function describeSceneViaVision(
  imageUrl: string,
  mode: 'scene' | 'characters',
): Promise<SceneDescriptionResult> {
  const r = await fetch('/api/describe-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, mode }),
  })
  const d = await r.json() as SceneDescriptionResult & { error?: string }
  if (!r.ok || !d.description) {
    throw new Error(d.error ?? `describe-scene HTTP ${r.status}`)
  }
  return d
}

/** Traduit un texte FR→EN via la route /api/translate-text déjà en place
 *  (auto-detect FR via mots markers — no-op si déjà EN). Résilience : si la
 *  traduction échoue, on retourne le texte original.
 *
 *  Utilisé au moment de la génération pour les champs scène/persos que
 *  l'auteur a saisis manuellement (Qwen VL retourne déjà en EN). */
export async function translateSceneFieldToEn(text: string): Promise<string> {
  if (!text.trim()) return text
  try {
    const r = await fetch('/api/translate-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const d = await r.json() as { text_en?: string; error?: string }
    if (r.ok && d.text_en) return d.text_en
  } catch (err) {
    console.warn('[scene-description] translation failed, fallback original:', err)
  }
  return text
}
