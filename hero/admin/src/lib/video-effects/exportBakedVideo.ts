'use client'
/**
 * exportBakedVideo — Phase D (refonte 2026-05-15cp).
 *
 * Bake un canvas WebGL (= effets shader VideoEffectsCanvas + overlays HTML
 * sont déjà composés à l'écran) en MP4 standalone via :
 *   1. canvas.captureStream(fps) → MediaStream visuel
 *   2. videoEl.captureStream() → MediaStream audio (si vidéo source a audio)
 *   3. Combine + MediaRecorder → Blob WebM (codec VP9 si dispo, sinon VP8)
 *   4. ffmpeg.wasm transcode WebM → MP4 (H.264 + AAC) pour compat universelle
 *
 * IMPORTANT — overlays HTML/CSS NE SONT PAS BAKÉS dans le canvas WebGL.
 * canvas.captureStream() ne capture QUE le canvas, pas les overlays React
 * positionnés par-dessus. Pour V0 on documente cette limitation : seuls les
 * effets WebGL (LUT + shaders) sont exportés. Les overlays (sniper scope,
 * camcorder HUD, etc.) seront bakés en V1.5 via html2canvas + composite frame.
 *
 * Côté UX : montre une progress bar pendant capture (% du temps lu),
 * puis "Transcodage…" pendant ffmpeg, puis download auto du MP4.
 *
 * Charge ffmpeg.wasm core à la demande depuis CDN (unpkg) — bypass CORS via
 * toBlobURL pour que le browser accepte le Worker WASM.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import html2canvas from 'html2canvas'
import { lookupSmooth } from './useMouseTrack'
import type { ComposedEffectsState } from './looks-catalog'

const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'

let ffmpegSingleton: FFmpeg | null = null
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null

/** Charge ffmpeg.wasm une seule fois (singleton) à la demande. */
async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton
  if (ffmpegLoadingPromise) return ffmpegLoadingPromise
  ffmpegLoadingPromise = (async () => {
    const ff = new FFmpeg()
    // On charge le core via toBlobURL pour bypasser CORS (sinon Worker fails).
    await ff.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    ffmpegSingleton = ff
    return ff
  })()
  return ffmpegLoadingPromise
}

interface ExportOptions {
  /** Canvas WebGL à enregistrer. */
  canvas: HTMLCanvasElement
  /** Élément vidéo source (pour piloter playback + récup audio). */
  videoEl: HTMLVideoElement
  /** Conteneur DOM qui inclut le canvas WebGL + overlays HTML/CSS (HUD, sniper,
   *  etc.). html2canvas screenshote ce container à intervalle régulier pour
   *  composer les overlays au-dessus du WebGL dans le MP4 final.
   *  Refonte 2026-05-15cr — sans ce container, les overlays ne sont pas bakés. */
  overlayContainer?: HTMLElement | null
  /** Frame rate de capture. Default 30. */
  fps?: number
  /** Hz de capture des overlays via html2canvas (default 10 = 100ms throttle).
   *  Compromise perf : html2canvas prend 30-100ms par capture, donc 30Hz est
   *  intenable. 10Hz suffit pour les HUDs animés (date, GPS, mouse track). */
  overlayHz?: number
  /** Inclure l'audio source (si présent). Default true. */
  includeAudio?: boolean
  /** Callback de progression (0-100). Étape capture = 0-70%, transcode = 70-100%. */
  onProgress?: (pct: number, stage: 'capture' | 'transcode') => void
  /** État composite des effets (refonte 2026-05-15dc). Si fourni, le composer
   *  peut dessiner certains overlays directement en canvas 2D plutôt que de
   *  passer par html2canvas — ex: mask sniper radial-gradient (mal supporté
   *  par html2canvas qui le rend en bloc noir uniforme). */
  effectsState?: ComposedEffectsState | null
}

/** Lance l'export bakeé. Retourne un Blob MP4 prêt à download. */
export async function exportBakedMp4({
  canvas, videoEl, overlayContainer, fps = 30, overlayHz = 10,
  includeAudio = true, onProgress, effectsState,
}: ExportOptions): Promise<Blob> {
  // Refonte 2026-05-15ct — Garantit que videoWidth/Height sont chargés AVANT
  // de dimensionner le composer (sinon fallback rect = format cassé).
  if (!videoEl.videoWidth || !videoEl.videoHeight) {
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => { if (!done) { done = true; resolve() } }
      if (videoEl.readyState >= 1) { finish(); return }
      videoEl.addEventListener('loadedmetadata', finish, { once: true })
      videoEl.addEventListener('canplay', finish, { once: true })
      setTimeout(finish, 3000)
    })
  }

  // ── 1. Composite canvas (WebGL + overlays) si overlayContainer fourni ────
  // Sinon fallback simple = capture directe du canvas WebGL (V0 path).
  // Refonte 2026-05-15cr — sans composite, les overlays HTML ne sont pas bakés.
  let visualStream: MediaStream
  let composerCleanup: (() => void) | null = null

  if (overlayContainer) {
    // Capture en const local pour aider TS dans les closures (sinon TS voit
    // overlayContainer comme HTMLElement|null dans le rAF)
    const ovl: HTMLElement = overlayContainer
    const rect = ovl.getBoundingClientRect()
    // Composer aligné sur les dimensions NATIVES de la vidéo source.
    const srcW = videoEl.videoWidth || Math.max(1, Math.round(rect.width))
    const srcH = videoEl.videoHeight || Math.max(1, Math.round(rect.height))
    const composer = document.createElement('canvas')
    composer.width = srcW
    composer.height = srcH
    // Refonte 2026-05-15da — append au DOM (caché) car captureStream() peut
    // foirer silencieusement sur Chrome si le canvas est hors document tree
    // (le compositor n'observe pas le canvas → MediaStream produit des frames
    // noires malgré drawImage qui marche). Bug rapporté multiple fois.
    composer.style.position = 'fixed'
    composer.style.left = '-99999px'
    composer.style.top = '0'
    composer.style.pointerEvents = 'none'
    document.body.appendChild(composer)
    const ctx = composer.getContext('2d')
    if (!ctx) throw new Error('[exportBakedMp4] canvas 2D context null')
    visualStream = composer.captureStream(fps)
    // Échelle pour html2canvas : multiplie les dimensions CSS du DOM overlay
    // pour matcher la résolution native du composer (= overlays nets, pas pixelisés).
    const overlayScale = Math.max(1, srcW / Math.max(1, rect.width))

    // Cache du dernier bitmap overlay (pour réutiliser entre 2 captures html2canvas)
    let lastOverlayBitmap: ImageBitmap | HTMLCanvasElement | null = null
    let lastOverlayCaptureMs = 0
    const overlayPeriodMs = 1000 / overlayHz
    let overlayCaptureInflight = false
    let stopFlag = false

    // Boucle rAF de composition : drawImage(webgl) + drawImage(overlay-bitmap).
    // Refonte 2026-05-15cy — fallback drawImage(videoEl) si le canvas WebGL est
    // tainted/vide (CORS, preserveDrawingBuffer non honoré, etc.). Au pire on
    // perd le LUT mais on a quand même la vidéo + overlays visibles.
    let webglOkLogged = false
    let webglFailLogged = false
    function composeFrame() {
      if (stopFlag) return
      const ctx2 = composer.getContext('2d')
      if (!ctx2) return
      // Fond noir (au cas où ni webgl ni video n'ont couvert)
      ctx2.fillStyle = '#000'
      ctx2.fillRect(0, 0, composer.width, composer.height)
      // 1. drawImage du canvas WebGL (= preview LUT + shaders)
      // Refonte 2026-05-15dd — check pixel center à CHAQUE frame. Si webgl
      // retourne noir (timing rAF : composer s'exécute avant R3F render), on
      // fallback drawImage(videoEl). Perd le LUT pour la frame mais vidéo OK.
      let webglUsed = false
      try {
        if (canvas.width > 0 && canvas.height > 0) {
          ctx2.drawImage(canvas, 0, 0, composer.width, composer.height)
          // Test pixel center pour valider que webgl est rendered
          try {
            const imgd = ctx2.getImageData(Math.floor(composer.width / 2), Math.floor(composer.height / 2), 1, 1)
            const [r, g, b] = imgd.data
            if (r === 0 && g === 0 && b === 0) {
              // WebGL noir → fallback : on dessine la vidéo brute par-dessus
              ctx2.drawImage(videoEl, 0, 0, composer.width, composer.height)
            } else {
              webglUsed = true
            }
          } catch {
            // getImageData failed (canvas tainted CORS) → fallback video
            ctx2.drawImage(videoEl, 0, 0, composer.width, composer.height)
          }
          // Log debug 1 fois pour identifier le path actif
          if (!webglOkLogged) {
            console.log('[exportBakedMp4] première frame —', webglUsed ? 'WebGL OK (LUT visible)' : 'fallback video direct (LUT non bakable cette frame)')
            webglOkLogged = true
          }
        } else {
          // Canvas pas prêt → video direct
          ctx2.drawImage(videoEl, 0, 0, composer.width, composer.height)
        }
      } catch (err) {
        if (!webglFailLogged) {
          console.warn('[exportBakedMp4] drawImage failed:', err)
          webglFailLogged = true
        }
      }
      // 2. drawImage du dernier bitmap overlay (HTML/CSS)
      if (lastOverlayBitmap) {
        try {
          ctx2.drawImage(lastOverlayBitmap, 0, 0, composer.width, composer.height)
        } catch (err) {
          console.warn('[exportBakedMp4] drawImage overlay failed:', err)
        }
      }
      // 2bis. Mask sniper manuel en canvas 2D (refonte 2026-05-15dc) — html2canvas
      // ne sait pas rendre le radial-gradient transparent → on le redessine ici.
      // Pour que ça marche en sync avec la trajectoire enregistrée, on lookup
      // mouse_track au currentTime de la vidéo (= même algo que useMouseTrack).
      if (effectsState && effectsState.modules.includes('sniper')
          && effectsState.mouse_track && effectsState.mouse_track.length > 0) {
        const xy = lookupSmooth(effectsState.mouse_track, videoEl.currentTime * 1000)
        if (xy) {
          const cx = xy.x * composer.width
          const cy = xy.y * composer.height
          const minSide = Math.min(composer.width, composer.height)
          const sizePx = minSide * (effectsState.scope_size ?? 0.22)
          // Radial gradient : transparent au centre, noir à la périphérie
          const grad = ctx2.createRadialGradient(cx, cy, sizePx * 0.95, cx, cy, sizePx * 1.15)
          grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
          grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.7)')
          grad.addColorStop(1, 'rgba(0, 0, 0, 0.92)')
          ctx2.fillStyle = grad
          ctx2.fillRect(0, 0, composer.width, composer.height)
        }
      }
      // 3. Si throttle écoulé ET pas déjà en cours → recapture overlay
      const now = performance.now()
      if (!overlayCaptureInflight && (now - lastOverlayCaptureMs) >= overlayPeriodMs) {
        overlayCaptureInflight = true
        lastOverlayCaptureMs = now
        // html2canvas async — ignore le canvas WebGL (déjà drawn juste avant)
        void html2canvas(ovl, {
          backgroundColor: null,
          useCORS: true,
          logging: false,
          // Refonte 2026-05-15cs — `scale` plutôt que width/height absolus :
          // html2canvas multiplie les dimensions CSS par scale → output bitmap
          // à la résolution native du composer. Sinon le DOM était stretched
          // côté drawImage et les overlays apparaissaient flous.
          scale: overlayScale,
          ignoreElements: (el) => {
            // Skip le canvas WebGL (= déjà capturé par drawImage)
            if (el.tagName === 'CANVAS') return true
            // Skip les boutons d'overlay record (bandeau REC, bouton Stop)
            if (el.classList?.contains('efx-rec-badge')) return true
            if (el.classList?.contains('efx-rec-stop-btn')) return true
            if (el.classList?.contains('efx-export-overlay')) return true
            if (el.classList?.contains('efx-countdown')) return true
            // Refonte 2026-05-15dc — skip le MASK sniper noir : html2canvas ne
            // supporte pas bien le radial-gradient → il rend le mask comme un
            // bloc noir uniforme qui occlut toute la vidéo dans le bake. Le
            // crosshair SVG (.poc-scope-reticle) reste visible. V1.5 : refaire
            // le mask en shader WebGL pour avoir l'effet lunette dans le MP4.
            if (el.classList?.contains('poc-scope-mask')) return true
            return false
          },
        }).then((c) => {
          if (!stopFlag) lastOverlayBitmap = c
        }).catch((err) => {
          console.warn('[exportBakedMp4] html2canvas failed:', err)
        }).finally(() => {
          overlayCaptureInflight = false
        })
      }
      requestAnimationFrame(composeFrame)
    }
    requestAnimationFrame(composeFrame)
    composerCleanup = () => {
      stopFlag = true
      // Retire le composer du DOM (refonte 2026-05-15da)
      try { composer.remove() } catch { /* noop */ }
    }
  } else {
    // Fallback : capture directe du canvas WebGL (overlays NON bakés)
    visualStream = canvas.captureStream(fps)
  }

  let combinedStream = visualStream
  if (includeAudio) {
    try {
      // captureStream() sur HTMLVideoElement retourne un MediaStream avec audio
      // si la vidéo source en a. Si pas d'audio (vidéo muette), on continue silencieusement.
      const videoStream = (videoEl as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.()
      const audioTracks = videoStream?.getAudioTracks() ?? []
      if (audioTracks.length > 0) {
        combinedStream = new MediaStream([
          ...visualStream.getVideoTracks(),
          ...audioTracks,
        ])
      }
    } catch (err) {
      console.warn('[exportBakedMp4] audio capture failed, video-only:', err)
    }
  }

  // ── 2. Choix du mimeType (préfère VP9 + Opus, fallback VP8) ──────────────
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  const mimeType = candidates.find(t => MediaRecorder.isTypeSupported(t))
  if (!mimeType) throw new Error('[exportBakedMp4] aucun codec WebM supporté par ce navigateur')

  // ── 3. MediaRecorder + collect chunks ─────────────────────────────────────
  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 6_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data)
  }

  // Récupère la durée totale de la vidéo source (pour la progress)
  const totalMs = (videoEl.duration || 0) * 1000

  // Refonte 2026-05-15cq — fix loop infini : force loop=false pendant capture,
  // restaure après. Sinon le video boucle, onended ne fire jamais, capture sans
  // fin. Backup aussi muted pour éviter de casser l'audio source.
  const originalLoop = videoEl.loop
  videoEl.loop = false

  // Reset video à 0 + démarre playback en sync avec le recorder
  videoEl.pause()
  videoEl.currentTime = 0
  // Petit delay pour que le seek atterrisse avant de lancer le record
  await new Promise<void>((resolve) => {
    if (videoEl.currentTime === 0 && videoEl.readyState >= 2) { resolve(); return }
    const onSeeked = () => { videoEl.removeEventListener('seeked', onSeeked); resolve() }
    videoEl.addEventListener('seeked', onSeeked)
    setTimeout(() => { videoEl.removeEventListener('seeked', onSeeked); resolve() }, 600)
  })

  recorder.start(200)  // chunk every 200ms

  // Track progress via timeupdate
  const onTimeUpdate = () => {
    if (totalMs > 0 && onProgress) {
      const pct = Math.min(70, Math.round((videoEl.currentTime / videoEl.duration) * 70))
      onProgress(pct, 'capture')
    }
  }
  videoEl.addEventListener('timeupdate', onTimeUpdate)

  try {
    await videoEl.play()

    // Attend la fin de la lecture, avec safety timeout = durée vidéo × 3 + 10s
    // (pour ne pas hanger si onended n'arrive jamais malgré loop=false).
    const safetyMs = Math.max(30_000, ((videoEl.duration || 10) * 1000) * 3 + 10_000)
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        videoEl.removeEventListener('ended', onEnded)
        videoEl.removeEventListener('timeupdate', onTimeUpdate)
        resolve()
      }
      const onEnded = () => finish()
      videoEl.addEventListener('ended', onEnded)
      setTimeout(() => {
        if (!done) {
          console.warn('[exportBakedMp4] safety timeout — onended jamais fire, on stop')
          finish()
        }
      }, safetyMs)
    })
  } finally {
    // Restaure loop initial dans tous les cas
    videoEl.loop = originalLoop
    videoEl.pause()
  }

  // Stop recording (un petit delay pour s'assurer que la dernière frame est captée)
  await new Promise(r => setTimeout(r, 300))
  if (recorder.state !== 'inactive') recorder.stop()
  await new Promise<void>((resolve) => {
    if (recorder.state === 'inactive') { resolve(); return }
    recorder.onstop = () => resolve()
  })

  // Stop composer rAF loop (refonte 2026-05-15cr)
  composerCleanup?.()

  const webmBlob = new Blob(chunks, { type: mimeType })
  onProgress?.(70, 'capture')

  // ── 4. Transcode WebM → MP4 via ffmpeg.wasm ──────────────────────────────
  onProgress?.(72, 'transcode')
  const ff = await loadFFmpeg()
  const inputName = `input_${Date.now()}.webm`
  const outputName = `output_${Date.now()}.mp4`
  await ff.writeFile(inputName, await fetchFile(webmBlob))
  onProgress?.(80, 'transcode')

  // Args ffmpeg : H.264 + AAC, preset rapide, bitrate raisonnable
  // -movflags +faststart pour mp4 streamable web (moov à l'avant)
  const args = [
    '-i', inputName,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-y', outputName,
  ]
  // On suit la progress ffmpeg via event. Refonte 2026-05-15ct — clamp 0-1
  // car ffmpeg.wasm renvoie parfois des valeurs aberrantes (très négatives,
  // > 1, NaN) au début du transcode ou sur certains formats. Bug connu.
  // On garde aussi la dernière valeur valide pour ne pas régresser.
  let lastValidPct = 80
  const progressHandler = ({ progress }: { progress: number }) => {
    if (!onProgress || !Number.isFinite(progress)) return
    const safe = Math.max(0, Math.min(1, progress))
    const pct = 80 + Math.round(safe * 20)
    // Ne descend jamais (la progress doit être monotone croissante)
    if (pct >= lastValidPct) {
      lastValidPct = pct
      onProgress(Math.min(99, pct), 'transcode')
    }
  }
  ff.on('progress', progressHandler)
  try {
    await ff.exec(args)
  } finally {
    ff.off('progress', progressHandler)
  }
  // Force 100% à la fin pour combler les progress events manquants
  onProgress?.(100, 'transcode')

  const mp4Data = await ff.readFile(outputName)
  // Cleanup VFS
  await ff.deleteFile(inputName).catch(() => { /* noop */ })
  await ff.deleteFile(outputName).catch(() => { /* noop */ })

  onProgress?.(100, 'transcode')
  // mp4Data peut être Uint8Array ou string selon la version ; on cast en Uint8Array
  const u8 = mp4Data instanceof Uint8Array ? mp4Data : new TextEncoder().encode(mp4Data as string)
  // Ré-emballe dans un buffer ArrayBuffer "vrai" (pas SharedArrayBuffer) pour Blob
  const ab = new ArrayBuffer(u8.byteLength)
  new Uint8Array(ab).set(u8)
  return new Blob([ab], { type: 'video/mp4' })
}

/** Helper download : déclenche un téléchargement client-side du blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}
