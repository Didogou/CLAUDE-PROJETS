import { NextResponse } from 'next/server'
import { freeComfyVram } from '@/lib/comfyui'

/**
 * POST /api/comfyui/force-free
 *
 * Force un free VRAM + RAM agressif sur ComfyUI (unload_models + free_memory).
 * Utilisé par les helpers client en cas de retry après OOM (option B retry
 * auto, refonte 2026-05-12).
 *
 * Réponse : { success: true } après l'appel (fire-and-forget côté ComfyUI,
 * les erreurs sont juste logguées).
 */
export async function POST() {
  await freeComfyVram({ unload: true })
  // Petit délai pour laisser le GC Python finir de libérer
  await new Promise(r => setTimeout(r, 2000))
  return NextResponse.json({ success: true })
}
