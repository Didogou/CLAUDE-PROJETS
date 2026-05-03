'use client'
/**
 * RainyDayGlassLayer — wrapper React de la lib rainyday.js pour le rendu
 * de la surface 'glass' dans le système d'impact zones.
 *
 * Une instance est montée par zone d'impact glass active. Elle se positionne
 * en absolu dans la bounding box de la zone et utilise l'image baked du calque
 * comme background pour la réfraction des gouttes.
 *
 * Mode 'brush' : un masque CSS reproduisant exactement la forme peinte
 * est appliqué sur le wrapper → l'effet vitre suit le tracé pinceau, pas la
 * bbox englobante. Le masque est généré offscreen depuis les strokes
 * (paint additif, erase soustractif) puis converti en data URL.
 *
 * Paramètres pilotés par l'utilisateur via FoldAtmosphere :
 *  - intensity → cadence d'apparition des gouttes (rate)
 *  - size → taille des gouttes
 *  - glassSpeed → vitesse de chute (param rainyday: trail speed)
 *  - glassOpacity → opacité globale du calque vitre (CSS opacity sur wrapper)
 *  - glassBlur → flou de réfraction (param rainyday: blur du background)
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ImpactZoneEntry, WeatherZone, WeatherRectShape } from './types'

/** Liste effective des rectangles d'une zone : commits + draft en cours de drag.
 *  Le draft (zone.rect, présent transitoirement pendant le mousedown→up du
 *  rectangle ou en legacy pré-2026-04-25) est toujours considéré paint. */
function getEffectiveRects(z: WeatherZone): WeatherRectShape[] {
  const list: WeatherRectShape[] = z.rects ? [...z.rects] : []
  if (z.rect && Math.abs(z.rect.x2 - z.rect.x1) > 0.001 && Math.abs(z.rect.y2 - z.rect.y1) > 0.001) {
    list.push({ ...z.rect, mode: 'paint' })
  }
  return list
}

interface Props {
  zoneEntry: ImpactZoneEntry
  bgImageUrl: string
  /** Largeur du conteneur parent en CSS px (display, pas DPR-multiplied). */
  containerWidth: number
  containerHeight: number
}

interface RainyDayPreset { min: number; base: number; quan: number }
interface RainyDayInstance {
  rain(presets: RainyDayPreset[], speed: number): void
  stop?: () => void
  gravity: unknown
  trail: unknown
  reflection: unknown
  GRAVITY_SIMPLE: unknown
  TRAIL_DROPS: unknown
  REFLECTION_NONE: unknown
  REFLECTION_HQ: unknown
}
type RainyDayClass = new (
  canvasid: string,
  sourceid: string,
  width: number,
  height: number,
  opacity?: number,
  blur?: number,
) => RainyDayInstance

export default function RainyDayGlassLayer({ zoneEntry, bgImageUrl, containerWidth, containerHeight }: Props) {
  const reactId = useId().replace(/:/g, '-')
  const canvasId = `rd-${reactId}-c`
  const imgId = `rd-${reactId}-i`
  const engineRef = useRef<RainyDayInstance | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)

  const bbox = computeZoneBbox(zoneEntry.zone, containerWidth, containerHeight)
  // opacity est le champ générique (toutes surfaces). glassOpacity = legacy fallback.
  const glassOpacity = zoneEntry.opacity ?? zoneEntry.glassOpacity ?? 1
  const glassBlur = zoneEntry.glassBlur ?? 20

  // Masque CSS : génère un dataURL d'un canvas alpha qui reproduit la zone
  // exacte. Compose tous les rects[] (paint additif, erase soustractif) +
  // strokes (paint additif, erase soustractif), PUIS carve à chaque carveZone
  // (zone non-glass au-dessus dans le z-order) pour faire un trou.
  // Le mask est obligatoire si :
  //   - la zone est complexe (brush, multi-rect, rect+strokes)
  //   - OU il y a des carveZones (même un simple rect doit être carvé)
  const effectiveRects = getEffectiveRects(zoneEntry.zone)
  const hasStrokes = !!zoneEntry.zone.strokes && zoneEntry.zone.strokes.some(s => s.points.length > 0)
  const isSimpleSingleRect = effectiveRects.length === 1 && effectiveRects[0].mode === 'paint' && !hasStrokes
  const needsMask = zoneEntry.zone.mode !== 'full' && !isSimpleSingleRect && (effectiveRects.length > 0 || hasStrokes)
  const brushMaskDataUrl = useMemo(() => {
    if (!needsMask) return null
    if (bbox.w < 10 || bbox.h < 10) return null
    return buildZoneMaskDataUrl(zoneEntry.zone, bbox, containerWidth, containerHeight)
  }, [needsMask, zoneEntry.zone, bbox.x, bbox.y, bbox.w, bbox.h, containerWidth, containerHeight])

  // Init / cleanup engine
  useEffect(() => {
    if (!imgLoaded) return
    if (bbox.w < 10 || bbox.h < 10) return  // évite init pour bbox trop petite
    let cancelled = false

    async function init() {
      try {
        const mod = await import('@/lib/rainyday/rainyday.js')
        if (cancelled) return
        const RainyDay = mod.default as unknown as RainyDayClass
        if (!RainyDay) return
        const w = Math.floor(bbox.w)
        const h = Math.floor(bbox.h)
        // Densité paramétrée via intensity de la zone (0.1-1 → 0.5-2× rate)
        const intensityMul = 0.5 + (zoneEntry.intensity ?? 0.7) * 1.5
        const interval = Math.max(20, Math.floor(100 / intensityMul))
        // Taille des gouttes paramétrée via size de la zone (0.5-10 px → multiplier 0.5-3)
        const sizeMul = Math.max(0.5, Math.min(3, (zoneEntry.size ?? 1.8) / 1.8))

        const engine = new RainyDay(canvasId, imgId, w, h, 0.9, glassBlur)
        engine.gravity = engine.GRAVITY_SIMPLE
        engine.trail = engine.TRAIL_DROPS
        engine.reflection = engine.REFLECTION_HQ
        const presets: RainyDayPreset[] = [
          { min: 1 * sizeMul, base: 2 * sizeMul, quan: 0.7 },
          { min: 3 * sizeMul, base: 3 * sizeMul, quan: 0.95 },
          { min: 5 * sizeMul, base: 4 * sizeMul, quan: 1 },
        ]
        engine.rain(presets, interval)
        engineRef.current = engine
      } catch (err) {
        console.warn('[RainyDayGlassLayer] init failed:', err)
      }
    }
    init()

    return () => {
      cancelled = true
      if (engineRef.current?.stop) engineRef.current.stop()
      engineRef.current = null
    }
  }, [imgLoaded, bgImageUrl, bbox.x, bbox.y, bbox.w, bbox.h, zoneEntry.intensity, zoneEntry.size, glassBlur, canvasId, imgId])

  if (bbox.w < 10 || bbox.h < 10) return null

  // Style mask : si brush → applique la forme peinte ; si rect/full → bbox carrée
  const maskStyle: React.CSSProperties = brushMaskDataUrl ? ({
    WebkitMaskImage: `url(${brushMaskDataUrl})`,
    maskImage: `url(${brushMaskDataUrl})`,
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskMode: 'alpha',
    maskMode: 'alpha',
  } as React.CSSProperties) : {}

  return (
    <div
      style={{
        position: 'absolute',
        left: `${bbox.x}px`,
        top: `${bbox.y}px`,
        width: `${bbox.w}px`,
        height: `${bbox.h}px`,
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: glassOpacity,
        ...maskStyle,
      }}
    >
      <img
        id={imgId}
        src={bgImageUrl}
        crossOrigin="anonymous"
        onLoad={() => setImgLoaded(true)}
        style={{ position: 'absolute', visibility: 'hidden', width: '100%', height: '100%' }}
        alt=""
      />
      <canvas
        id={canvasId}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
    </div>
  )
}

function computeZoneBbox(zone: WeatherZone, w: number, h: number): { x: number; y: number; w: number; h: number } {
  if (zone.mode === 'full') {
    return { x: 0, y: 0, w, h }
  }
  // Mode 'rect' ou 'brush' : union de la bbox des rectangles paint (rects[]
  // committed + draft transitoire) ET de la bbox des strokes paint. Les
  // 'erase' ne contribuent pas à étendre la bbox (ils retirent dans le mask).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let hasContent = false

  for (const r of getEffectiveRects(zone)) {
    if (r.mode !== 'paint') continue
    const rx1 = Math.min(r.x1, r.x2), ry1 = Math.min(r.y1, r.y2)
    const rx2 = Math.max(r.x1, r.x2), ry2 = Math.max(r.y1, r.y2)
    if (rx2 > rx1 && ry2 > ry1) {
      minX = Math.min(minX, rx1); minY = Math.min(minY, ry1)
      maxX = Math.max(maxX, rx2); maxY = Math.max(maxY, ry2)
      hasContent = true
    }
  }
  if (zone.strokes && zone.strokes.length > 0) {
    for (const stroke of zone.strokes) {
      if (stroke.mode === 'erase') continue
      const r = stroke.radius
      for (const pt of stroke.points) {
        minX = Math.min(minX, pt.x - r); minY = Math.min(minY, pt.y - r)
        maxX = Math.max(maxX, pt.x + r); maxY = Math.max(maxY, pt.y + r)
        hasContent = true
      }
    }
  }
  if (!hasContent) return { x: 0, y: 0, w: 0, h: 0 }
  return {
    x: Math.max(0, minX) * w,
    y: Math.max(0, minY) * h,
    w: (Math.min(1, maxX) - Math.max(0, minX)) * w,
    h: (Math.min(1, maxY) - Math.max(0, minY)) * h,
  }
}

/**
 * Génère un dataURL PNG d'un canvas mask qui reproduit la zone exacte.
 * Composition séquentielle :
 *   1. Pour chaque rect dans rects[] (+ draft) : 'paint' = remplit blanc,
 *      'erase' = découpe (destination-out).
 *   2. Pour chaque stroke dans strokes[] : 'paint' additif, 'erase' soustractif.
 * L'ordre rects[] puis strokes[] est arbitraire — on traite tous les rects en
 * premier puis tous les strokes (chronologie inter-types perdue, intra-type
 * préservée). Suffisant en pratique : l'utilisateur fait soit des rects soit
 * des traits dans une session, rarement intercalés.
 *
 * Le canvas a les dimensions de la bbox + offset matchant. Le résultat est
 * utilisé en CSS `mask-image` → seules les zones blanches sont visibles.
 *
 * Cap résolution à 1024 px de plus grand côté pour éviter dataURL géant.
 */
function buildZoneMaskDataUrl(
  zone: WeatherZone,
  bbox: { x: number; y: number; w: number; h: number },
  containerW: number,
  containerH: number,
): string | null {
  const MAX_DIM = 1024
  const scale = Math.min(1, MAX_DIM / Math.max(bbox.w, bbox.h))
  const cw = Math.max(2, Math.round(bbox.w * scale))
  const ch = Math.max(2, Math.round(bbox.h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'

  // Passe 1 : tous les rectangles (paint = source-over blanc, erase = destination-out)
  for (const r of getEffectiveRects(zone)) {
    const rx1 = Math.min(r.x1, r.x2), ry1 = Math.min(r.y1, r.y2)
    const rx2 = Math.max(r.x1, r.x2), ry2 = Math.max(r.y1, r.y2)
    if (rx2 <= rx1 || ry2 <= ry1) continue
    const rxPx = (rx1 * containerW - bbox.x) * scale
    const ryPx = (ry1 * containerH - bbox.y) * scale
    const rwPx = (rx2 - rx1) * containerW * scale
    const rhPx = (ry2 - ry1) * containerH * scale
    ctx.globalCompositeOperation = r.mode === 'erase' ? 'destination-out' : 'source-over'
    ctx.fillStyle = r.mode === 'erase' ? '#000000' : '#ffffff'
    ctx.fillRect(rxPx, ryPx, rwPx, rhPx)
  }

  // Passe 2 : strokes pinceau (paint ou efface, dans l'ordre)
  const scaleMin = Math.min(containerW, containerH)
  if (zone.strokes) {
    for (const stroke of zone.strokes) {
      const r = stroke.radius * scaleMin * scale  // rayon en px du canvas mask
      ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'
      ctx.fillStyle = stroke.mode === 'erase' ? '#000000' : '#ffffff'
      for (const pt of stroke.points) {
        const px = (pt.x * containerW - bbox.x) * scale
        const py = (pt.y * containerH - bbox.y) * scale
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  return canvas.toDataURL('image/png')
}
