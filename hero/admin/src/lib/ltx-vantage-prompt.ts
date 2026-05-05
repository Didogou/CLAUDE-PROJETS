/**
 * Construit le prompt structuré au format Vantage attendu par LTX 2.3 +
 * IC LoRA Dual Characters (LoRA Civitai 2500098).
 *
 * Format attendu :
 *   [Scene] description du décor (placeholder pour l'instant)
 *   [Characters]
 *   Female: <description physique>  # <nom propre en commentaire>
 *   Male:   <description physique>  # <nom propre en commentaire>
 *   [Shot 1] (cadrage, durée, caméra)
 *   Female: <action>. "<dialogue>"
 *   Male:   <action>. "<dialogue>"
 *
 * ⚠ Règles dures (cf project_ltx_dual_ic_lora_prompting.md) :
 *   - Labels génériques `Male:` / `Female:` UNIQUEMENT (pas de noms propres)
 *   - Si plusieurs persos même genre : `Female 2:`, etc.
 *   - Durée injectée dans le header Shot pour aider le modèle
 *   - Actions en EN (le LoRA est entraîné EN, FR dégrade)
 *   - Pas de connecteurs `while`/`as` (non tunés) — les actions simultanées
 *     se contentent de lignes adjacentes
 *
 * Cf trigger words à éviter (`salute`, `kiss`, `handshake`…) qui font inventer
 * des persos supplémentaires — l'auteur doit les éviter dans le champ Action.
 */

import type { Character } from './character-store'
import type { AnimationPellicule } from '@/components/image-editor/EditorStateContext'

/** Termes EN injectés (pas les labels FR de l'UI). */
const SHOT_PROMPT: Record<AnimationPellicule['shot'], string> = {
  wide: 'wide shot',
  medium: 'medium shot',
  close_up: 'close-up',
  extreme_close_up: 'extreme close-up',
}
const CAMERA_PROMPT: Record<AnimationPellicule['camera'], string> = {
  static: 'static',
  slow_zoom_in: 'slow zoom in',
  slow_zoom_out: 'slow zoom out',
  pan_left: 'pan left',
  pan_right: 'pan right',
  dolly_in: 'dolly in',
  dolly_out: 'dolly out',
  handheld: 'handheld',
}

export function buildVantagePrompt(
  pell: AnimationPellicule,
  chars: Character[],
): string {
  const lines: string[] = []

  // ── Mapping perso → label Vantage ─────────────────────────────────────
  // Compteur par bucket (female / male) pour gérer les collisions multi-persos.
  // Legacy 'other' / undefined → 'female' (sanitization).
  const counts = { female: 0, male: 0 }
  const labelByCharId = new Map<string, string>()
  for (const c of chars) {
    const g: 'female' | 'male' = c.gender === 'male' ? 'male' : 'female'
    counts[g] += 1
    const base = g === 'female' ? 'Female' : 'Male'
    const label = counts[g] === 1 ? base : `${base} ${counts[g]}`
    labelByCharId.set(c.id, label)
  }

  // [Scene] : placeholder tant que la scène n'est pas extraite du plan parent.
  // TODO Phase C+ : passer une description de scène depuis Designer.
  lines.push('[Scene] Cinematic scene with two characters interacting.')
  lines.push('')

  // [Characters] : description physique courte par perso, indexée par label
  if (chars.length > 0) {
    lines.push('[Characters]')
    for (const c of chars) {
      const desc = c.prompt?.trim() || 'a person'
      const label = labelByCharId.get(c.id) ?? c.name
      // Le `# Nom` final est ignoré par le LoRA mais lisible pour debug
      lines.push(`${label}: ${desc}  # ${c.name}`)
    }
    lines.push('')
  }

  // [Shot 1] : cadrage + durée + caméra + actions
  const cameraDesc = CAMERA_PROMPT[pell.camera]
  const shotDesc = SHOT_PROMPT[pell.shot]
  lines.push(`[Shot 1] (${shotDesc}, ${pell.duration}s, ${cameraDesc} camera)`)
  for (const c of chars) {
    const data = pell.perCharacter[c.id]
    if (!data) continue
    const action = data.action.trim()
    const dialogue = data.dialogue.trim()
    if (!action && !dialogue) continue
    const label = labelByCharId.get(c.id) ?? c.name
    let line = `${label}:`
    if (action) line += ` ${action}.`
    if (dialogue) line += ` "${dialogue}"`
    lines.push(line)
  }

  return lines.join('\n')
}
