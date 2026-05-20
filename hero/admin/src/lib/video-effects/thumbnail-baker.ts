/**
 * thumbnail-baker.ts — Génération offscreen de mini-thumbnails par look/module.
 *
 * Refonte 2026-05-15ca — Pour la modale Effets, chaque carte de look (~30 au
 * total) doit afficher une mini-image de LA pellicule avec l'effet appliqué.
 * On NE peut PAS faire 30 canvas WebGL en parallèle (GPU exploose, max ~16
 * contexts par tab Chrome).
 *
 * Approche :
 *   1. Capturer 1 frame représentative (frame du milieu de la pellicule) via
 *      un <video> caché → canvas 2D → dataURL une seule fois.
 *   2. Pour chaque look : un seul canvas WebGL réutilisé en série, on dessine
 *      la frame, applique le shader, lit le pixel buffer → dataURL → cache.
 *   3. Les overlays HTML/CSS sont rendus PAR-DESSUS la thumbnail au runtime
 *      (pas bakés en image), pour rester fidèles au comportement modal.
 *
 * V1 simple : on fait juste la capture de la frame, pas de shader bake (= les
 * thumbnails affichent la frame brute + un petit badge "look" qui apply au
 * click). Le bake shader complet sera V1.5 si l'auteur trouve les vignettes
 * pas assez parlantes.
 */

/** Capture une frame représentative depuis une vidéo URL. Frame du milieu
 *  par défaut (compromis statique/lisible). Retourne dataURL JPEG.  */
export async function captureRepresentativeFrame(
  videoUrl: string,
  opts: { atSecond?: number; maxWidth?: number; quality?: number } = {},
): Promise<string> {
  const { maxWidth = 320, quality = 0.78 } = opts
  return new Promise<string>((resolve, reject) => {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.src = videoUrl
    v.muted = true
    v.playsInline = true
    v.style.display = 'none'
    document.body.appendChild(v)

    const cleanup = () => {
      try { v.pause() } catch { /* noop */ }
      v.removeAttribute('src')
      v.load()
      v.remove()
    }

    const onError = () => {
      cleanup()
      reject(new Error(`[thumbnail-baker] video load error for ${videoUrl}`))
    }
    v.addEventListener('error', onError, { once: true })

    v.addEventListener('loadedmetadata', () => {
      const t = opts.atSecond ?? Math.max(0.1, v.duration * 0.5)
      const onSeeked = () => {
        try {
          const ar = v.videoWidth / Math.max(1, v.videoHeight)
          const w = Math.min(maxWidth, v.videoWidth)
          const h = Math.round(w / ar)
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          const ctx = c.getContext('2d')
          if (!ctx) throw new Error('canvas 2d ctx null')
          ctx.drawImage(v, 0, 0, w, h)
          const url = c.toDataURL('image/jpeg', quality)
          cleanup()
          resolve(url)
        } catch (err) {
          cleanup()
          reject(err)
        }
      }
      v.addEventListener('seeked', onSeeked, { once: true })
      v.currentTime = t
    }, { once: true })

    // Safety timeout 6s — si la vidéo ne répond pas (CORS, format), on lâche
    setTimeout(() => {
      cleanup()
      reject(new Error(`[thumbnail-baker] timeout 6s on ${videoUrl}`))
    }, 6000)
  })
}

/** Capture depuis une URL d'IMAGE (cas pellicule image_static). Trivial : on
 *  télécharge l'image, on la dessine, on retourne dataURL. */
export async function captureFromImage(imageUrl: string, maxWidth = 320, quality = 0.78): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const ar = img.naturalWidth / Math.max(1, img.naturalHeight)
        const w = Math.min(maxWidth, img.naturalWidth)
        const h = Math.round(w / ar)
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) throw new Error('canvas 2d ctx null')
        ctx.drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', quality))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error(`[thumbnail-baker] image load error for ${imageUrl}`))
    img.src = imageUrl
  })
}
