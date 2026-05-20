/**
 * Helpers cut/split d'une vidéo MP4 via ffmpeg.wasm côté browser.
 *
 * Refonte 2026-05-19 — feature Couper (CharacterCreator/Studio Section).
 *
 * - `cutRange(url, start, end)` : enlève le segment [start, end] et reconstruit
 *   1 nouvelle vidéo (concat des 2 morceaux restants). Retourne 1 Blob.
 * - `splitAt(url, splitSec)` : coupe en 2 vidéos distinctes [0,split] + [split,end].
 *   Retourne 2 Blobs.
 *
 * Stratégie : on demux+decode+re-encode pour garantir keyframe-precise
 * (sinon le cut "fast copy" snap aux keyframes les plus proches, imprécis).
 * Re-encode H.264 baseline crf=23, AAC 128k audio si présent.
 */

import { fetchFile } from '@ffmpeg/util'
import { loadFFmpeg } from './ffmpeg-loader'

export interface VideoCutProgress {
  stage: 'loading' | 'fetching' | 'processing' | 'done'
  pct?: number
  label?: string
}

interface RunOpts {
  onProgress?: (p: VideoCutProgress) => void
}

/** Coupe le range [startSec, endSec] de la vidéo. Retourne le Blob du résultat.
 *
 * Refonte 2026-05-20 — passage du concat-demuxer (-c copy) au concat-filter
 * avec re-encode unifié. L'approche demuxer générait un fichier dont la
 * dernière frame était étirée de N secondes (timestamps de seg1 commençaient
 * à endSec et pas à 0, le player extrapolait la durée). Avec le filtre :
 *   trim+setpts(PTS-STARTPTS) sur chaque segment → timestamps propres
 *   concat=n=2:v=1 → fusion clean
 * Le résultat a la durée exacte attendue (durée_input - (endSec-startSec)).
 *
 * V1 : vidéo only (pas d'audio). Les LTX Hero n'ont pas de track audio. */
export async function cutRange(
  videoUrl: string,
  startSec: number,
  endSec: number,
  opts: RunOpts = {},
): Promise<Blob> {
  if (!(endSec > startSec)) throw new Error('endSec doit être > startSec')
  if (startSec < 0) throw new Error('startSec doit être ≥ 0')
  const { onProgress } = opts

  onProgress?.({ stage: 'loading', label: 'Chargement ffmpeg.wasm…' })
  const ff = await loadFFmpeg()

  onProgress?.({ stage: 'fetching', label: 'Téléchargement vidéo…' })
  const src = await fetchFile(videoUrl)
  await ff.writeFile('input.mp4', src)

  onProgress?.({ stage: 'processing', label: 'Découpe + concat…' })

  // Cas particuliers :
  //  - startSec ≈ 0 : on garde juste [endSec, EOF] → simple trim
  //  - endSec >= duration : on garde juste [0, startSec] → simple trim
  //  - sinon : trim 2 segments + concat
  if (startSec < 0.05) {
    // Trim simple : garde [endSec, EOF]
    await ff.exec([
      '-i', 'input.mp4',
      '-ss', endSec.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-an',  // strip audio
      '-y', 'out.mp4',
    ])
  } else {
    // 2 segments + concat via filter (timestamps propres).
    const trim0 = `0:${startSec.toFixed(3)}`
    const trim1Start = endSec.toFixed(3)
    const filter =
      `[0:v]trim=${trim0},setpts=PTS-STARTPTS[v0];` +
      `[0:v]trim=start=${trim1Start},setpts=PTS-STARTPTS[v1];` +
      `[v0][v1]concat=n=2:v=1:a=0[outv]`
    await ff.exec([
      '-i', 'input.mp4',
      '-filter_complex', filter,
      '-map', '[outv]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-an',  // strip audio
      '-y', 'out.mp4',
    ])
  }

  const data = await ff.readFile('out.mp4')
  // Cleanup
  await safeUnlink(ff, 'input.mp4')
  await safeUnlink(ff, 'out.mp4')

  onProgress?.({ stage: 'done' })
  return new Blob([data as Uint8Array], { type: 'video/mp4' })
}

/** Coupe la vidéo en 2 vidéos distinctes [0,splitSec] et [splitSec,end].
 *  Retourne [partA, partB]. */
export async function splitAt(
  videoUrl: string,
  splitSec: number,
  opts: RunOpts = {},
): Promise<[Blob, Blob]> {
  if (splitSec <= 0) throw new Error('splitSec doit être > 0')
  const { onProgress } = opts

  onProgress?.({ stage: 'loading', label: 'Chargement ffmpeg.wasm…' })
  const ff = await loadFFmpeg()

  onProgress?.({ stage: 'fetching', label: 'Téléchargement vidéo…' })
  const src = await fetchFile(videoUrl)
  await ff.writeFile('input.mp4', src)

  // Refonte 2026-05-20 — utilise trim+setpts comme cutRange pour avoir des
  // timestamps propres dans les 2 outputs (sinon player pouvait extrapoler
  // la durée). `-an` strip audio (LTX Hero pas d'audio).
  onProgress?.({ stage: 'processing', label: 'Partie 1/2…' })
  await ff.exec([
    '-i', 'input.mp4',
    '-filter_complex', `[0:v]trim=0:${splitSec.toFixed(3)},setpts=PTS-STARTPTS[outv]`,
    '-map', '[outv]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-an',
    '-y', 'partA.mp4',
  ])
  onProgress?.({ stage: 'processing', label: 'Partie 2/2…' })
  await ff.exec([
    '-i', 'input.mp4',
    '-filter_complex', `[0:v]trim=start=${splitSec.toFixed(3)},setpts=PTS-STARTPTS[outv]`,
    '-map', '[outv]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-an',
    '-y', 'partB.mp4',
  ])

  const a = await ff.readFile('partA.mp4')
  const b = await ff.readFile('partB.mp4')
  await safeUnlink(ff, 'input.mp4')
  await safeUnlink(ff, 'partA.mp4')
  await safeUnlink(ff, 'partB.mp4')

  onProgress?.({ stage: 'done' })
  return [
    new Blob([a as Uint8Array], { type: 'video/mp4' }),
    new Blob([b as Uint8Array], { type: 'video/mp4' }),
  ]
}

async function safeUnlink(ff: Awaited<ReturnType<typeof loadFFmpeg>>, name: string) {
  try { await ff.deleteFile(name) } catch { /* file may not exist, ignore */ }
}
