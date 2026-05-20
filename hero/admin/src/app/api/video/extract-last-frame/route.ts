import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { spawn } from 'child_process'
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * /api/video/extract-last-frame
 *
 * Extrait la dernière frame d'une vidéo MP4 côté serveur via ffmpeg, upload
 * en JPG sur Supabase bucket `images`, retourne l'URL publique.
 *
 * Refonte 2026-05-14au — l'extraction côté browser via canvas (extract-video-frames.ts)
 * échoue silencieusement quand la vidéo Supabase n'a pas les bons headers CORS
 * (canvas tainted → toDataURL throw → null). Cet endpoint serveur contourne
 * le problème car le fetch côté Node ne souffre pas du CORS browser.
 *
 * Input  : { videoUrl: string }
 * Output : { url: string }  (URL publique JPG dans Supabase bucket `images`)
 *
 * Dépendance : ffmpeg (réutilise le binaire de ComfyUI venv via FFMPEG_PATH).
 */

export const runtime = 'nodejs'
export const maxDuration = 30

const COMFYUI_FFMPEG = 'C:\\Users\\didie\\Documents\\Projets\\CLAUDE-PROJETS\\ComfyUI\\venv\\Lib\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe'
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? COMFYUI_FFMPEG

export async function POST(req: NextRequest) {
  let tempDir: string | null = null
  try {
    const body = await req.json() as { videoUrl?: string }
    if (!body.videoUrl) {
      return NextResponse.json({ error: 'videoUrl requis' }, { status: 400 })
    }

    // 1. Download vidéo source
    const fetchRes = await fetch(body.videoUrl)
    if (!fetchRes.ok) {
      throw new Error(`fetch source HTTP ${fetchRes.status}`)
    }
    const srcBuffer = Buffer.from(await fetchRes.arrayBuffer())
    tempDir = await mkdtemp(join(tmpdir(), 'hero-extract-frame-'))
    const srcPath = join(tempDir, 'input.mp4')
    const outPath = join(tempDir, 'last.jpg')
    await writeFile(srcPath, srcBuffer)

    // 2. ffmpeg : seek vers la fin (-100ms pour éviter une frame de transition)
    //    puis grab 1 frame en JPG qualité 85.
    //    -sseof -0.1 = seek 100ms avant la fin
    //    -vframes 1 = 1 seule frame
    //    -q:v 3 = qualité JPG (1-31, plus bas = mieux ; 3 ≈ 85%)
    await new Promise<void>((resolve, reject) => {
      const args = [
        '-y',
        '-sseof', '-0.1',
        '-i', srcPath,
        '-vframes', '1',
        '-q:v', '3',
        outPath,
      ]
      const proc = spawn(FFMPEG_BIN, args)
      let stderr = ''
      proc.stderr.on('data', d => { stderr += d.toString() })
      proc.on('error', reject)
      proc.on('close', code => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))
      })
    })

    // 3. Read frame + upload Supabase
    const outBuffer = await readFile(outPath)
    const ts = Date.now()
    const path = `studio/animation/continue/last-${ts}.jpg`
    const { error: upErr } = await supabaseAdmin.storage.from('images').upload(path, outBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    })
    if (upErr) throw new Error(`upload Supabase: ${upErr.message}`)
    const { data: { publicUrl } } = supabaseAdmin.storage.from('images').getPublicUrl(path)

    return NextResponse.json({ url: publicUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[extract-last-frame] failed:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    if (tempDir) {
      try {
        await unlink(join(tempDir, 'input.mp4')).catch(() => {})
        await unlink(join(tempDir, 'last.jpg')).catch(() => {})
      } catch { /* ignore */ }
    }
  }
}
