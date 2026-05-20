import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { spawn } from 'child_process'
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * /api/video/add-silent-audio
 *
 * Re-mux une vidéo MP4 pour ajouter une piste audio silencieuse stereo 44100Hz.
 *
 * Bug fix 2026-05-13 : le workflow LTX 2.3 V2V Extend exige une piste audio
 * dans la prev vidéo (chaîne 319 VHSLoadVideo → 443 NormalizeAudioLoudness →
 * 179 LTXVAudioVAEEncode → sampler). Les vidéos LTX générées n'ont pas
 * d'audio → VHS plante ("VHS failed to extract audio").
 *
 * Solution : avant d'envoyer la prev vidéo à ComfyUI, on lui colle un audio
 * silencieux via ffmpeg. La piste audio finale est de toute façon écrasée
 * par les outputs du sampler audio LTX (ou retirée du VideoCombine final).
 *
 * Input : { videoUrl: string } — URL Supabase de la vidéo source
 * Output : { url: string } — URL Supabase de la vidéo avec audio silencieux
 *
 * Dépendance : ffmpeg dans le PATH système (ou via process.env.FFMPEG_PATH).
 */

export const runtime = 'nodejs'
export const maxDuration = 60

/** Path ffmpeg :
 *   1. FFMPEG_PATH env var si définie
 *   2. ffmpeg du PATH système (Linux/Mac, ou Windows avec install global)
 *   3. Fallback : binaire embarqué dans ComfyUI venv (imageio_ffmpeg) —
 *      présent sur les machines Hero car ComfyUI tourne sur le même host. */
const COMFYUI_FFMPEG = 'C:\\Users\\didie\\Documents\\Projets\\CLAUDE-PROJETS\\ComfyUI\\venv\\Lib\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe'
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? COMFYUI_FFMPEG

export async function POST(req: NextRequest) {
  let tempDir: string | null = null
  try {
    const body = await req.json() as { videoUrl?: string }
    if (!body.videoUrl) {
      return NextResponse.json({ error: 'videoUrl requis' }, { status: 400 })
    }
    // 1. Download vidéo source (temp file)
    const fetchRes = await fetch(body.videoUrl)
    if (!fetchRes.ok) {
      throw new Error(`fetch source HTTP ${fetchRes.status}`)
    }
    const srcBuffer = Buffer.from(await fetchRes.arrayBuffer())
    tempDir = await mkdtemp(join(tmpdir(), 'hero-silent-audio-'))
    const srcPath = join(tempDir, 'input.mp4')
    const outPath = join(tempDir, 'output.mp4')
    await writeFile(srcPath, srcBuffer)

    // 2. ffmpeg : copy video, add silent stereo audio, output mp4
    await new Promise<void>((resolve, reject) => {
      const args = [
        '-y',                                 // overwrite output
        '-i', srcPath,                        // video input
        '-f', 'lavfi',                        // virtual input format
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-c:v', 'copy',                       // no re-encode video
        '-c:a', 'aac',
        '-shortest',                          // stop at video duration
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

    // 3. Read output, upload to Supabase
    const outBuffer = await readFile(outPath)
    const ts = Date.now()
    const path = `tmp/silent-audio/${ts}.mp4`
    const { error: upErr } = await supabaseAdmin.storage.from('videos').upload(path, outBuffer, {
      contentType: 'video/mp4',
      upsert: true,
    })
    if (upErr) throw new Error(`upload Supabase: ${upErr.message}`)
    const { data: { publicUrl } } = supabaseAdmin.storage.from('videos').getPublicUrl(path)

    return NextResponse.json({ url: publicUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[add-silent-audio] failed:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    // Cleanup temp dir
    if (tempDir) {
      try {
        await unlink(join(tempDir, 'input.mp4')).catch(() => {})
        await unlink(join(tempDir, 'output.mp4')).catch(() => {})
      } catch { /* ignore */ }
    }
  }
}
