'use client'
/**
 * Sélecteur "Baguette magique" — SAM 2 auto-segmentation.
 *
 * Flow :
 *   1. Au mount : lance segmentAllObjects → récupère N masks URLs
 *   2. Charge chaque mask dans un canvas caché pour extraire les pixels
 *   3. Sur mousemove : détecte quel mask est survolé (celui dont la zone
 *      contient le curseur). Priorité au mask le plus petit (le plus précis)
 *   4. Affiche l'outline du mask survolé via SVG filter edge-detect
 *      + teal fill semi-transparent pour la zone
 *   5. Clic → sélectionne ce mask → parent reçoit l'URL via onMaskSelected
 *
 * Interchangeable avec BoxSelector / SAMSelector — même prop imgRefCallback.
 */
import React, { useEffect, useRef, useState } from 'react'
import { segmentAllObjects, clearSegmentCache } from '../helpers/segmentAllObjects'

export interface AutoSelectorProps {
  imageUrl: string
  /** URL du mask sélectionné (null tant que rien de choisi). */
  selectedMaskUrl: string | null
  onMaskSelected: (url: string | null) => void
  disabled?: boolean
  maxHeight?: string
  imgRefCallback?: (el: HTMLImageElement | null) => void
}

interface CachedMask {
  url: string
  index: number
  width: number
  height: number
  pixels: Uint8ClampedArray  // flat RGBA
  area: number               // nombre de pixels foreground (pour priorité)
}

export default function AutoSelector({
  imageUrl, selectedMaskUrl, onMaskSelected, disabled = false, maxHeight = 'calc(95vh - 280px)', imgRefCallback,
}: AutoSelectorProps) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [masks, setMasks] = useState<CachedMask[]>([])
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [rescanNonce, setRescanNonce] = useState(0) // bump pour re-run forcé
  const [debugInfo, setDebugInfo] = useState<{ apiCount: number; loaded: number; filtered: number; areas: number[] } | null>(null)

  // 1. Lance SAM auto + charge les masks au mount (en parallèle pour la vitesse).
  //    Cancel-safe : si le composant démonte ou imageUrl change, on abandonne.
  useEffect(() => {
    let cancelled = false
    async function loadOne(m: { url: string; index: number }): Promise<CachedMask | null> {
      try {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = m.url
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error(`mask ${m.index} load failed`))
        })
        if (cancelled) return null
        const c = document.createElement('canvas')
        c.width = img.naturalWidth; c.height = img.naturalHeight
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, c.width, c.height).data
        let area = 0
        for (let i = 0; i < data.length; i += 4) if (data[i] > 127) area++
        // Filtre micro-masks : <1% de l'image = détails sans intérêt pour un
        // "magic wand" (ex: une tache, un bout de feuille). Sans ça ils volent
        // le hover aux vrais objets car on trie smallest-first.
        const totalPx = c.width * c.height
        if (area < totalPx * 0.01) return null
        return { url: m.url, index: m.index, width: c.width, height: c.height, pixels: data, area }
      } catch (e) {
        console.warn('[AutoSelector] mask load fail:', e)
        return null
      }
    }
    async function run() {
      setLoading(true); setError(null); setMasks([]); setHoveredIdx(null)
      try {
        const { masks: fetched } = await segmentAllObjects(imageUrl)
        if (cancelled) return
        if (fetched.length === 0) {
          setError('Aucun objet détecté. Passe en mode Rectangle ou Points SAM.')
          setLoading(false)
          return
        }
        // Chargement parallèle des N masks (limite : nav HTTP/2 gère ça très bien)
        const loaded = (await Promise.all(fetched.map(loadOne))).filter((x): x is CachedMask => x !== null)
        if (cancelled) return
        if (loaded.length === 0) {
          setError('Tous les masks ont échoué au chargement.')
          setLoading(false)
          return
        }
        // Filtre les masks quasi-plein cadre (>85% de l'image) : c'est du background,
        // jamais utile pour "extraire un perso". Seuil très large pour ne pas trop filtrer.
        // Puis tri par aire croissante → priorité au plus petit mask précis sous le curseur.
        const totalArea = loaded[0].width * loaded[0].height
        const filtered = loaded.filter(m => m.area / totalArea < 0.85)
        filtered.sort((a, b) => a.area - b.area)
        const finalMasks = filtered.length > 0 ? filtered : loaded
        setMasks(finalMasks)
        // Debug visible dans l'UI pour diagnostiquer
        setDebugInfo({
          apiCount: fetched.length,
          loaded: loaded.length,
          filtered: finalMasks.length,
          areas: loaded.map(m => Math.round((m.area / totalArea) * 100)),
        })
        console.log('[AutoSelector] SAM stats:', {
          apiCount: fetched.length,
          loaded: loaded.length,
          filtered: finalMasks.length,
          areaRatios: loaded.map(m => (m.area / totalArea).toFixed(3)),
        })
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, rescanNonce])

  function handleRescan() {
    clearSegmentCache(imageUrl)
    onMaskSelected(null)
    setRescanNonce(n => n + 1)
  }

  /** Trouve le mask le plus petit dont le pixel (x,y) en coords natives est foreground. */
  function findMaskAt(natX: number, natY: number): number | null {
    for (let i = 0; i < masks.length; i++) {
      const m = masks[i]
      if (natX < 0 || natY < 0 || natX >= m.width || natY >= m.height) continue
      const idx = (Math.floor(natY) * m.width + Math.floor(natX)) * 4
      if (m.pixels[idx] > 127) return i
    }
    return null
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled || loading || masks.length === 0 || !imgRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const el = imgRef.current
    const ratioX = el.naturalWidth / el.clientWidth
    const ratioY = el.naturalHeight / el.clientHeight
    const x = (e.clientX - rect.left) * ratioX
    const y = (e.clientY - rect.top) * ratioY
    const idx = findMaskAt(x, y)
    if (idx !== hoveredIdx) setHoveredIdx(idx)
  }
  function handleMouseLeave() { setHoveredIdx(null) }

  function handleClick() {
    if (disabled || hoveredIdx === null) return
    onMaskSelected(masks[hoveredIdx].url)
  }

  // Mask affiché en overlay : soit le sélectionné (vert), soit le survolé (teal)
  const displayMaskUrl = selectedMaskUrl ?? (hoveredIdx !== null ? masks[hoveredIdx]?.url : null)
  const isSelected = !!selectedMaskUrl
  const overlayColor = isSelected ? '#52c484' : '#4ed5d5'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {loading && (
        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', padding: '0.5rem 0.7rem', background: 'var(--surface-2)', borderRadius: '4px' }}>
          🔮 SAM analyse l&apos;image… (~30-60s pour détecter tous les objets)
        </div>
      )}
      {error && (
        <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
          ⚠ {error}
        </div>
      )}
      {!loading && !error && masks.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
            <span>
              {isSelected ? '✓ Mask sélectionné (vert). Clique ailleurs pour changer.' : `${masks.length} objet${masks.length > 1 ? 's' : ''} détecté${masks.length > 1 ? 's' : ''}. Hover → clique pour sélectionner.`}
            </span>
            <button
              onClick={handleRescan}
              disabled={loading || disabled}
              title="Relance SAM avec des paramètres actuels (utile si la détection actuelle est mauvaise)"
              style={{ marginLeft: 'auto', fontSize: '0.62rem', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}
            >
              🔄 Re-scan
            </button>
          </div>
          {debugInfo && (
            <div style={{ fontSize: '0.55rem', color: 'var(--muted)', opacity: 0.65, fontFamily: 'monospace' }}>
              🔬 DEBUG — SAM API : {debugInfo.apiCount} masks • chargés : {debugInfo.loaded} • gardés : {debugInfo.filtered}
              {debugInfo.apiCount > 0 && debugInfo.areas.length > 0 && ` • tailles : ${debugInfo.areas.map(a => a + '%').join(', ')}`}
            </div>
          )}
        </>
      )}

      <div
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ position: 'relative', display: 'inline-block', alignSelf: 'center', maxWidth: '100%', maxHeight, cursor: (loading || disabled) ? 'wait' : (hoveredIdx !== null ? 'pointer' : 'crosshair'), userSelect: 'none' }}
      >
        <img
          ref={el => { imgRef.current = el; imgRefCallback?.(el) }}
          src={imageUrl}
          alt="source"
          draggable={false}
          style={{ maxWidth: '100%', maxHeight, height: 'auto', display: 'block', borderRadius: '6px', border: '1px solid var(--border)' }}
        />
        {/* SVG filters.
            Les PNGs exportés par ComfyUI ont alpha=255 partout (mask codé en
            luminance R/G/B). Il faut donc convertir luminance → alpha AVANT
            toute opération (morphology/fill), sinon on tint tout le fond. */}
        <svg width="0" height="0" style={{ position: 'absolute' }}>
          <defs>
            <filter id="ants-fill">
              {/* R_in (luminance du mask) → alpha_out. Les 3 premières lignes
                  imposent la couleur teal, la 4e utilise R comme alpha. */}
              <feColorMatrix type="matrix" values="0 0 0 0 0.31
                                                   0 0 0 0 0.84
                                                   0 0 0 0 0.83
                                                   0.45 0 0 0 0" />
            </filter>
            <filter id="ants-outline">
              {/* Step 1 : luminance → alpha (rgb=0, a=R du mask) */}
              <feColorMatrix type="matrix" values="0 0 0 0 0
                                                   0 0 0 0 0
                                                   0 0 0 0 0
                                                   1 0 0 0 0" result="mask" />
              {/* Step 2 : dilate l'alpha puis soustrait l'original → outline ~2px */}
              <feMorphology in="mask" operator="dilate" radius="2" result="dilated" />
              <feComposite in="dilated" in2="mask" operator="out" result="outline" />
              {/* Step 3 : force la couleur blanche sur l'outline */}
              <feColorMatrix in="outline" type="matrix" values="0 0 0 0 1
                                                                0 0 0 0 1
                                                                0 0 0 0 1
                                                                0 0 0 1 0" />
            </filter>
          </defs>
        </svg>
        {displayMaskUrl && (
          <>
            {/* Remplissage semi-transparent — teint via filter SVG */}
            <img
              src={displayMaskUrl}
              alt=""
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                pointerEvents: 'none', filter: 'url(#ants-fill)',
                mixBlendMode: 'screen',
              }}
            />
            {/* Outline "marching ants" : outline extraite + animation pulse */}
            <img
              src={displayMaskUrl}
              alt=""
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                pointerEvents: 'none',
                filter: `url(#ants-outline) drop-shadow(0 0 2px ${overlayColor}) drop-shadow(0 0 4px ${overlayColor})`,
                mixBlendMode: 'screen',
                animation: 'heroAntsPulse 0.8s ease-in-out infinite',
              }}
            />
            <style>{`
              @keyframes heroAntsPulse {
                0%, 100% { opacity: 0.9; }
                50%      { opacity: 0.55; }
              }
            `}</style>
          </>
        )}
      </div>
    </div>
  )
}
