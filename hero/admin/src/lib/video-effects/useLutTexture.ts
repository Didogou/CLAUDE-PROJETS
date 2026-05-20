'use client'
/**
 * useLutTexture — charge un fichier .cube (Adobe Cube LUT 1.0) en Data3DTexture
 * prête à passer au composant `<LUT>` de @react-three/postprocessing.
 *
 * Refonte 2026-05-15cb — adoption du standard LUT (vs grading paramétrique
 * amateur). Backed par THREE.LUTCubeLoader natif (already shipped avec three).
 */

import { useEffect, useState } from 'react'
import { LUTCubeLoader } from 'three/examples/jsm/loaders/LUTCubeLoader.js'
import type { Data3DTexture, Texture } from 'three'

interface LutCubeResult {
  size: number
  texture3D: Data3DTexture
  texture?: Texture
}

// Cache process-wide — chaque .cube ~130 KB parsed → garde en mémoire pour ne
// pas re-loader à chaque ouverture de modale (les 11 LUTs Hero sont fixes).
const lutCache = new Map<string, Data3DTexture>()

export function useLutTexture(url: string | null | undefined): Data3DTexture | null {
  const [tex, setTex] = useState<Data3DTexture | null>(() => url ? lutCache.get(url) ?? null : null)

  useEffect(() => {
    if (!url) {
      setTex(null)
      return
    }
    const cached = lutCache.get(url)
    if (cached) {
      setTex(cached)
      return
    }
    let cancelled = false
    new LUTCubeLoader().loadAsync(url).then((result) => {
      if (cancelled) return
      const r = result as unknown as LutCubeResult
      if (r.texture3D) {
        lutCache.set(url, r.texture3D)
        setTex(r.texture3D)
      } else {
        console.warn('[useLutTexture] no texture3D in', url)
      }
    }).catch((err) => {
      console.warn('[useLutTexture] load failed:', url, err)
    })
    return () => { cancelled = true }
  }, [url])

  return tex
}
