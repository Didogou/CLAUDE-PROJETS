/**
 * Extraction de frames depuis une vidéo MP4 (côté client).
 *
 * Capture la première et la dernière frame d'une vidéo accessible par URL,
 * uploade les 2 JPG dans Supabase via /api/storage/upload-image, retourne
 * les URLs publiques.
 *
 * Usage : après génération d'un plan kind='animation' (ex : runLtx23Dual),
 * on appelle extractFramesFromVideo(videoUrl) pour produire les thumbnails
 * persistées dans Supabase et stockées dans SectionImage.first_frame_url /
 * .last_frame_url.
 *
 * Pourquoi côté client plutôt que serveur :
 *   - Pas de FFmpeg dans le projet (évite une nouvelle dep ~50MB)
 *   - La vidéo est déjà accessible côté client (preview UI)
 *   - Approche déterministe via Canvas API standard
 *
 * Cf. décision 2026-05-03 (project_plan_kind_data_model.md).
 */

export interface ExtractedFrames {
  first_frame_url: string
  last_frame_url: string
}

interface ExtractFramesOptions {
  /** URL du MP4 à analyser. */
  videoUrl: string
  /** Préfixe Supabase pour les frames extraites. Défaut: 'temp/frames'.
   *  Format final : `{prefix}/{timestamp}_first.jpg` et `_last.jpg`. */
  storagePathPrefix?: string
  /** Format JPG. Défaut 0.85 (bon compromis qualité/taille pour vignette). */
  jpegQuality?: number
}

/** Capture la frame courante du video element via canvas → data URL JPG. */
function captureCurrentFrame(video: HTMLVideoElement, jpegQuality: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context indisponible')
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', jpegQuality)
}

/** Avance la vidéo à `targetTime` (en secondes) et résout quand le seek est terminé. */
function seekTo(video: HTMLVideoElement, targetTime: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      resolve()
    }
    const onError = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      reject(new Error('Video seek error'))
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = targetTime
  })
}

/** Charge la vidéo (metadata + premier frame disponible). */
function loadVideo(videoUrl: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true
    // Empile les listeners avant de set src (évite race condition)
    const onReady = () => {
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
      resolve(video)
    }
    const onError = () => {
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
      reject(new Error(`Video load error: ${videoUrl}`))
    }
    video.addEventListener('loadeddata', onReady)
    video.addEventListener('error', onError)
    video.src = videoUrl
  })
}

/** Upload une dataURL JPG via /api/storage/upload-image et retourne l'URL publique. */
async function uploadDataUrl(dataUrl: string, path: string): Promise<string> {
  const res = await fetch('/api/storage/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data_url: dataUrl, path }),
  })
  const data = await res.json()
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? `upload frame failed (status ${res.status})`)
  }
  return data.url as string
}

/**
 * Extrait la 1ère et dernière frame d'une vidéo, les uploade Supabase.
 * @returns URLs publiques des 2 thumbnails JPG.
 */
export async function extractFramesFromVideo(
  opts: ExtractFramesOptions,
): Promise<ExtractedFrames> {
  const {
    videoUrl,
    storagePathPrefix = 'temp/frames',
    jpegQuality = 0.85,
  } = opts

  const video = await loadVideo(videoUrl)
  try {
    // 1ère frame : seek à 0 (parfois besoin d'attendre seek explicit même à 0)
    await seekTo(video, 0)
    const firstDataUrl = captureCurrentFrame(video, jpegQuality)

    // Dernière frame : seek juste avant la durée totale (la durée pile peut
    // tomber après la dernière frame disponible selon les implémentations).
    const lastTime = Math.max(0, video.duration - 0.05)
    await seekTo(video, lastTime)
    const lastDataUrl = captureCurrentFrame(video, jpegQuality)

    const ts = Date.now()
    const [firstUrl, lastUrl] = await Promise.all([
      uploadDataUrl(firstDataUrl, `${storagePathPrefix}/${ts}_first.jpg`),
      uploadDataUrl(lastDataUrl, `${storagePathPrefix}/${ts}_last.jpg`),
    ])

    return { first_frame_url: firstUrl, last_frame_url: lastUrl }
  } finally {
    // Cleanup : libère le décodeur vidéo
    video.removeAttribute('src')
    video.load()
  }
}
