/**
 * extract-video-frames — helper browser pour extraire la 1ère et dernière
 * frame d'une vidéo via canvas, puis upload sur Supabase Storage.
 *
 * Utilisé par l'AnimationStudio quand l'auteur upload une vidéo locale (vs
 * vidéo générée par LTX qui a déjà ses frames extraites côté serveur).
 *
 * ⚠ CORS : la vidéo doit être accessible cross-origin. Pour les URLs Supabase
 * Storage, le bucket doit avoir le bon CORS (= généralement OK pour les
 * buckets publics du projet Hero).
 */

/** Extrait la 1ère et la dernière frame en un seul passage (= un seul load
 *  du <video>, deux seeks). Retourne les data URLs JPEG (qualité 0.85). */
export async function extractVideoFrames(videoUrl: string): Promise<{
  firstFrameDataUrl: string | null
  lastFrameDataUrl: string | null
  duration: number
}> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = videoUrl

    let firstFrameDataUrl: string | null = null
    let lastFrameDataUrl: string | null = null
    let stage: 'awaiting-first' | 'awaiting-last' | 'done' = 'awaiting-first'
    let duration = 0
    let resolved = false

    function captureCurrentFrame(): string | null {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(v, 0, 0)
        return canvas.toDataURL('image/jpeg', 0.85)
      } catch (err) {
        // Peut throw "tainted canvas" si CORS pas OK — ignore et continue.
        console.warn('[extract-video-frames] canvas tainted (CORS):', err)
        return null
      }
    }

    function done() {
      if (resolved) return
      resolved = true
      stage = 'done'
      resolve({ firstFrameDataUrl, lastFrameDataUrl, duration })
    }

    v.addEventListener('loadedmetadata', () => {
      duration = v.duration
      // Skip 50ms pour éviter un éventuel frame noir initial
      v.currentTime = Math.min(0.05, duration / 4)
    })

    v.addEventListener('seeked', () => {
      if (stage === 'awaiting-first') {
        firstFrameDataUrl = captureCurrentFrame()
        stage = 'awaiting-last'
        // Seek vers la dernière frame (-100ms pour éviter un frame en transition)
        v.currentTime = Math.max(0, duration - 0.1)
      } else if (stage === 'awaiting-last') {
        lastFrameDataUrl = captureCurrentFrame()
        done()
      }
    })

    v.addEventListener('error', () => {
      console.warn('[extract-video-frames] video load error')
      done()
    })

    // Timeout safety — si CORS bloque ou autre, on n'attend pas indéfiniment
    setTimeout(() => done(), 15000)
  })
}

/** Upload un data URL (image base64) sur Supabase Storage via l'endpoint
 *  /api/storage/upload-image. Retourne l'URL publique ou null si erreur. */
export async function uploadDataUrlAsImage(
  dataUrl: string, path: string,
): Promise<string | null> {
  try {
    const r = await fetch('/api/storage/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: dataUrl, path }),
    })
    if (!r.ok) {
      console.warn('[uploadDataUrlAsImage] HTTP', r.status)
      return null
    }
    const { url } = await r.json() as { url: string }
    return url
  } catch (err) {
    console.warn('[uploadDataUrlAsImage] failed', err)
    return null
  }
}
