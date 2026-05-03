/**
 * Cleanup des fichiers ComfyUI/output/ après transfert vers Supabase.
 *
 * Pourquoi : ComfyUI sauvegarde les outputs (caption .txt, masks .png) dans
 * son dossier output/ et ne les supprime jamais. Une fois qu'on les a
 * transférés sur Supabase storage, ils sont en double et accumulent du
 * disque local sans utilité.
 *
 * Helpers exposés :
 *   - unlinkComfyOutput(filename, subfolder?) → unlink un fichier précis
 *   - bulkCleanupComfyOutput() → scan + delete tous les fichiers matchant
 *                                  nos préfixes (scene_*, hero_*)
 *
 * Le path racine de output/ est configurable via env COMFYUI_OUTPUT_DIR,
 * défaut sur l'install local Windows.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const COMFYUI_OUTPUT_DIR =
  process.env.COMFYUI_OUTPUT_DIR ??
  'c:/Users/didie/Documents/Projets/CLAUDE-PROJETS/ComfyUI/output'

/** Préfixes des fichiers générés par notre pipeline (scene-analyzer + workflows). */
const SCENE_FILE_PATTERNS: RegExp[] = [
  /^scene_caption_/,
  /^scene_od_caption_/,
  /^scene_ctpg_caption_/,
  /^scene_dino_sam1_/,
  /^scene_dino_bboxes_/,
  /^scene_single_mask_/,
  /^scene_grouped_mask_/,
  /^scene_point_mask_/,
  /^scene_bbox_point_mask_/,
  /^scene_data_/,
  /^scene_od_/,
  /^hero_/,
]

/**
 * Supprime UN fichier précis de ComfyUI/output/ après transfert Supabase.
 * Appelé immédiatement après getImage() pour libérer le disque local.
 *
 * Silencieux en cas d'erreur (fichier déjà supprimé, path invalide, etc.).
 */
export async function unlinkComfyOutput(
  filename: string,
  subfolder = '',
): Promise<void> {
  try {
    const filePath = path.join(COMFYUI_OUTPUT_DIR, subfolder, filename)
    await fs.unlink(filePath)
  } catch {
    // Silencieux : ENOENT (déjà supprimé) ou EPERM (autre process l'a)
  }
}

/**
 * Bulk cleanup : scan ComfyUI/output/ et supprime tous les fichiers dont
 * le nom matche nos préfixes. Utilisé pour purger l'accumulation existante
 * (avant la mise en place du cleanup auto).
 *
 * Retourne stats { scanned, removed, errors, kept } pour reporting UI.
 */
export async function bulkCleanupComfyOutput(): Promise<{
  scanned: number
  removed: number
  errors: number
  kept: number
  output_dir: string
}> {
  let scanned = 0
  let removed = 0
  let errors = 0
  let kept = 0

  try {
    const entries = await fs.readdir(COMFYUI_OUTPUT_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      scanned++
      const matches = SCENE_FILE_PATTERNS.some(p => p.test(entry.name))
      if (!matches) {
        kept++
        continue
      }
      try {
        await fs.unlink(path.join(COMFYUI_OUTPUT_DIR, entry.name))
        removed++
      } catch {
        errors++
      }
    }
  } catch (err) {
    console.warn('[bulkCleanupComfyOutput] readdir failed:', err)
  }

  return { scanned, removed, errors, kept, output_dir: COMFYUI_OUTPUT_DIR }
}
