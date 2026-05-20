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

/** Wrap une promise avec un timeout. Si pas résolue/rejetée à temps → reject.
 *  Indispensable pour les events DOM qui peuvent ne jamais firer (CORS partiel,
 *  décodeur stallé, vidéo corrompue). Sans ça, extract-frames peut hanger
 *  indéfiniment et la BakeProgressModal de l'appelant ne se ferme jamais. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/** Avance la vidéo à `targetTime` (en secondes) et résout quand le seek est terminé. */
function seekTo(video: HTMLVideoElement, targetTime: number): Promise<void> {
  return withTimeout(new Promise<void>((resolve, reject) => {
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
  }), 10_000, `seekTo(${targetTime}s)`)
}

/** Charge la vidéo (metadata + premier frame disponible). */
function loadVideo(videoUrl: string): Promise<HTMLVideoElement> {
  return withTimeout(new Promise<HTMLVideoElement>((resolve, reject) => {
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
  }), 15_000, `loadVideo(${videoUrl.slice(0, 80)})`)
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
 * Extrait les N DERNIÈRES frames d'une vidéo et les uploade comme images JPG
 * séquentielles. Utilisé pour conditionner LTX 2.3 V2V (continuité de
 * mouvement entre pellicules). Refonte 2026-05-11.
 *
 * Échantillonnage : on prend N timestamps uniformément espacés sur la dernière
 * seconde de vidéo (= 1s à 24 fps = 24 frames source, on en sample N). Si
 * la vidéo est plus courte qu'1s, on sample sur toute la durée.
 *
 * Format URL : `{storagePathPrefix}/{timestamp}_v2v_{i}.jpg` avec i 0-based.
 *
 * @returns Array d'URLs publiques, du PLUS ANCIEN au PLUS RÉCENT (ordre
 *   important pour le workflow V2V — la dernière de l'array est la dernière
 *   frame du clip d'entrée du V2V, donc le point de départ du nouveau plan).
 */
export async function extractLastNFramesFromVideo(opts: {
  videoUrl: string
  n: number
  /** Préfixe Supabase. Défaut 'temp/v2v'. */
  storagePathPrefix?: string
  /** Qualité JPG. Défaut 0.92 (plus haut que vignette : ces frames sont input
   *  conditioning, on veut préserver les détails). */
  jpegQuality?: number
  /** Fenêtre de fin en secondes pour échantillonner les N frames. Défaut 1.0
   *  (= dernière seconde). À ajuster selon ce que le workflow V2V attend. */
  windowSec?: number
}): Promise<string[]> {
  const {
    videoUrl,
    n,
    storagePathPrefix = 'temp/v2v',
    jpegQuality = 0.92,
    windowSec = 1.0,
  } = opts
  if (n < 1) throw new Error(`extractLastNFramesFromVideo: n must be >= 1, got ${n}`)

  const video = await loadVideo(videoUrl)
  try {
    const duration = video.duration
    if (!isFinite(duration) || duration <= 0) {
      throw new Error(`extractLastNFramesFromVideo: invalid duration ${duration}`)
    }
    // Fenêtre = min(windowSec, duration). Si vidéo trop courte → sample
    // sur toute la durée.
    const window = Math.min(windowSec, duration)
    const startT = Math.max(0, duration - window)
    // Pas uniforme : (n-1) intervalles entre [startT, duration-0.02]. Si n=1
    // on prend juste la dernière frame. Le -0.02 = même marge que extractFramesFromVideo
    // pour éviter les seek hors range.
    const endT = duration - 0.02
    const dataUrls: string[] = []
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? endT : startT + (endT - startT) * (i / (n - 1))
      await seekTo(video, t)
      dataUrls.push(captureCurrentFrame(video, jpegQuality))
    }

    const ts = Date.now()
    const urls = await Promise.all(
      dataUrls.map((du, i) => uploadDataUrl(du, `${storagePathPrefix}/${ts}_v2v_${String(i).padStart(2, '0')}.jpg`)),
    )
    return urls
  } finally {
    video.removeAttribute('src')
    video.load()
  }
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
