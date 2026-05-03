/**
 * POST /api/comfyui/free
 *
 * Force le déchargement de TOUS les modèles ComfyUI de la VRAM. Utilisé entre
 * 2 workflows lourds (Wan, ToonCrafter, scene analyzer) pour éviter les OOM
 * sur GPU 8 Go quand plusieurs gros modèles s'empilent.
 *
 * Réutilise le helper `freeComfyVram()` déjà dispo, exposé en HTTP pour que
 * le client puisse le déclencher explicitement entre 2 actions.
 */

import { NextResponse } from 'next/server'
import { freeComfyVram } from '@/lib/comfyui'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await freeComfyVram({ unload: true })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
