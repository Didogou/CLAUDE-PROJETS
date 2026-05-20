/**
 * ffmpeg.wasm singleton loader — extrait de [[exportBakedVideo]] pour réuse
 * par d'autres features qui ont besoin de transcoder/découper côté browser
 * (ex: VideoCutModal qui propose cut range + split en 2 sur une pellicule).
 *
 * Charge le core depuis unpkg CDN via toBlobURL (bypass CORS pour Worker WASM).
 *
 * Refonte 2026-05-19 — extraction commune. Avant : duplication.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'

let ffmpegSingleton: FFmpeg | null = null
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null

/** Charge ffmpeg.wasm une seule fois (singleton) à la demande. */
export async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton
  if (ffmpegLoadingPromise) return ffmpegLoadingPromise
  ffmpegLoadingPromise = (async () => {
    const ff = new FFmpeg()
    await ff.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    ffmpegSingleton = ff
    return ff
  })()
  return ffmpegLoadingPromise
}
