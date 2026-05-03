'use client'
/**
 * Overlay par-dessus l'image canvas pour les objets pré-détectés.
 *
 * Modèle d'interaction (post-split : 1 détection = 1 objet individuel) :
 *
 *   ┌─ Idle ─────────────────────────────────────────────────────────────────┐
 *   │   - Aucune détection sélectionnée                                       │
 *   │   - Hover sur l'intérieur d'un objet :                                  │
 *   │       * Curseur pointer                                                 │
 *   │       * Marching ants violets sur le contour exact                      │
 *   │   - Click sur l'intérieur d'un objet → SÉLECTION                        │
 *   │   - Click hors de tout objet → no-op                                    │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 *   ┌─ Sélection active ─────────────────────────────────────────────────────┐
 *   │   - Le contour de l'objet sélectionné = trait rouge plein épais         │
 *   │   - Hover sur un AUTRE objet → marching ants violets (preview)          │
 *   │   - Click sur un AUTRE objet → bascule la sélection                     │
 *   │   - Click hors de tout objet → désélection                              │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * La sélection est lifted dans EditorStateContext (selectedDetectionId) pour
 * que la toolbar puisse réagir : ouvrir le drawer ciseau, désactiver les
 * sub-tools, activer les action icons. Le panneau gauche s'ouvre aussi auto
 * pour visualiser la liste des découpes (entrée poussée via pushWandMask).
 *
 * Pas d'action destructive depuis cet overlay — les actions (delete, etc.)
 * vivent dans la toolbar (icônes Supprimer/Calque/Personnage/Objet) câblées
 * séparément quand le besoin sera spécifié.
 *
 * Hit-test pixel-accurate via décodage des masks PNG en Uint8Array. La
 * granularité est = détection (post-split → 1 détection = 1 objet, donc 1
 * contour outer significatif). Si une détection a encore plusieurs contours
 * outer (cas où le split a échoué), tous sont rendus pour la même détection.
 */

import React, { useEffect, useRef, useState, type RefObject } from 'react'
import { useEditorState } from './EditorStateContext'
import { maskUrlToContours } from './helpers/maskUrlToContours'
import type { MagicWandContour } from './helpers/magicWand'

interface MaskPixels {
  data: Uint8Array
  width: number
  height: number
}

interface SceneDetectionsOverlayProps {
  imgRef: RefObject<HTMLImageElement | null>
}

export default function SceneDetectionsOverlay({ imgRef }: SceneDetectionsOverlayProps) {
  const {
    sceneAnalysis,
    cutMode,
    selectedDetectionId,
    setSelectedDetection,
    wandMasks,
    pushWandMask,
    setCutTool,
  } = useEditorState()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [imgRect, setImgRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const maskPixelsRef = useRef<Map<string, MaskPixels>>(new Map())
  const contoursRef = useRef<Map<string, MagicWandContour[]>>(new Map())
  const [decodeTick, setDecodeTick] = useState(0)

  const hasDetections = sceneAnalysis.detections.length > 0

  // Si la détection sélectionnée disparaît (suppression, ré-analyse) → clear
  useEffect(() => {
    if (selectedDetectionId && !sceneAnalysis.detections.some(d => d.id === selectedDetectionId)) {
      setSelectedDetection(null)
    }
  }, [sceneAnalysis.detections, selectedDetectionId, setSelectedDetection])

  // Décodage des masks (pixels pour hit-test + contours pour SVG path)
  useEffect(() => {
    if (!hasDetections) {
      maskPixelsRef.current = new Map()
      contoursRef.current = new Map()
      return
    }
    let cancelled = false

    Promise.all(
      sceneAnalysis.detections.map(async (d) => {
        if (!d.mask_url) return null
        try {
          const img = await loadImage(d.mask_url)
          if (cancelled) return null
          const W = img.naturalWidth
          const H = img.naturalHeight
          const canvas = document.createElement('canvas')
          canvas.width = W
          canvas.height = H
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (!ctx) return null
          ctx.drawImage(img, 0, 0)
          const imageData = ctx.getImageData(0, 0, W, H)
          const px = imageData.data
          const data = new Uint8Array(W * H)
          for (let i = 0; i < W * H; i++) {
            const j = i * 4
            const lum = (px[j] + px[j + 1] + px[j + 2]) / 3
            data[i] = lum > 128 ? 1 : 0
          }
          const contours = await maskUrlToContours(d.mask_url)
          return { id: d.id, pixels: { data, width: W, height: H }, contours }
        } catch (err) {
          console.warn('[SceneDetectionsOverlay] decode failed:', d.label, err)
          return null
        }
      }),
    ).then((results) => {
      if (cancelled) return
      const pxMap = new Map<string, MaskPixels>()
      const ctMap = new Map<string, MagicWandContour[]>()
      let ok = 0, ko = 0
      for (const r of results) {
        if (r) {
          pxMap.set(r.id, r.pixels)
          ctMap.set(r.id, r.contours)
          ok++
        } else { ko++ }
      }
      maskPixelsRef.current = pxMap
      contoursRef.current = ctMap
      setDecodeTick(t => t + 1)
      console.log(`[SceneDetectionsOverlay] decoded : ${ok} OK / ${ko} failed`)
    })

    return () => {
      cancelled = true
    }
  }, [sceneAnalysis.detections, hasDetections])

  // Position+taille de l'image
  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    const update = () => {
      setImgRect({
        x: img.offsetLeft,
        y: img.offsetTop,
        w: img.offsetWidth,
        h: img.offsetHeight,
      })
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(img)
    if (img.offsetParent) ro.observe(img.offsetParent as HTMLElement)
    img.addEventListener('load', update)
    window.addEventListener('resize', update)

    return () => {
      ro.disconnect()
      img.removeEventListener('load', update)
      window.removeEventListener('resize', update)
    }
  }, [imgRef])

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const xRel = (e.clientX - rect.left) / rect.width
    const yRel = (e.clientY - rect.top) / rect.height
    if (xRel < 0 || xRel > 1 || yRel < 0 || yRel > 1) {
      if (hoveredId !== null) setHoveredId(null)
      return
    }

    let foundId: string | null = null
    let smallestArea = Infinity

    for (const d of sceneAnalysis.detections) {
      let isInside = false
      const pixels = maskPixelsRef.current.get(d.id)
      if (pixels) {
        const x = Math.floor(xRel * pixels.width)
        const y = Math.floor(yRel * pixels.height)
        if (x >= 0 && x < pixels.width && y >= 0 && y < pixels.height) {
          isInside = pixels.data[y * pixels.width + x] === 1
        }
      } else {
        const [x1, y1, x2, y2] = d.bbox
        isInside = xRel >= x1 && xRel <= x2 && yRel >= y1 && yRel <= y2
      }
      if (isInside) {
        const [bx1, by1, bx2, by2] = d.bbox
        const area = (bx2 - bx1) * (by2 - by1)
        if (area < smallestArea) {
          smallestArea = area
          foundId = d.id
        }
      }
    }
    if (foundId !== hoveredId) setHoveredId(foundId)
  }

  function handleClick() {
    // Click sur un objet → sélectionne (ou bascule sur autre objet) +
    // pousse la découpe dans wandMasks (catalog des découpes du panneau)
    // comme si on avait utilisé Smart visu / Lasso / etc. Comportement
    // unifié : un clic sur une détection auto = un clic sur Smart visu.
    // Click hors de tout objet (hoveredId = null) → désélectionne.
    if (hoveredId) {
      const det = sceneAnalysis.detections.find(d => d.id === hoveredId)
      if (det?.mask_url) {
        const alreadyInPanel = wandMasks.some(m => m.url === det.mask_url)
        if (!alreadyInPanel) {
          const contours = contoursRef.current.get(hoveredId)
          pushWandMask({ url: det.mask_url, contours })
        }
      }
      // Reset cutTool à 'wand' (neutre) pour éviter que la ZoomLoupe + le
      // curseur crosshair d'un sub-tool précédent (Lasso/Brush) s'activent
      // quand le panneau s'ouvre auto. Le user a sélectionné une découpe
      // auto, pas un sub-tool de création.
      setCutTool('wand')
      setSelectedDetection(hoveredId)
    } else if (selectedDetectionId) {
      setSelectedDetection(null)
    }
  }


  // Si cutMode est true MAIS qu'on a une auto-sélection en cours, on garde
  // l'overlay actif pour préserver le contour rouge + gomme, et pour catcher
  // les pointer events au-dessus de CanvasOverlay (évite les triggers legacy
  // d'extract / lasso / etc. sur clic). Sans cette exception, le mount
  // automatique de CatalogEdit (qui met cutMode=true) ferait disparaître
  // toute la UI de sélection auto.
  if (cutMode && !selectedDetectionId) return null
  if (!hasDetections) return null
  if (!imgRect) return null

  void decodeTick

  // Quoi rendre :
  //   - La détection sélectionnée (toujours, en rouge plein)
  //   - La détection survolée (si différente de la sélection, en violet marching ants)
  type RenderItem = { det: typeof sceneAnalysis.detections[number]; mode: 'selected' | 'hovered' }
  const renderItems: RenderItem[] = []
  if (selectedDetectionId) {
    const sel = sceneAnalysis.detections.find(d => d.id === selectedDetectionId)
    if (sel) renderItems.push({ det: sel, mode: 'selected' })
  }
  if (hoveredId && hoveredId !== selectedDetectionId) {
    const hov = sceneAnalysis.detections.find(d => d.id === hoveredId)
    if (hov) renderItems.push({ det: hov, mode: 'hovered' })
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: imgRect.x,
        top: imgRect.y,
        width: imgRect.w,
        height: imgRect.h,
        zIndex: 5,
        cursor: hoveredId ? 'pointer' : 'default',
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoveredId(null)}
      onClick={handleClick}
    >
      {renderItems.length > 0 && (
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          <style>{`
            @keyframes sceneDetMarchingAnts {
              to { stroke-dashoffset: -16; }
            }
          `}</style>

          {renderItems.map(({ det, mode }) => {
            const contours = contoursRef.current.get(det.id)
            if (!contours || contours.length === 0) return null
            const isSel = mode === 'selected'
            const stroke = isSel ? 'rgba(239, 68, 68, 1)' : 'rgba(168, 85, 247, 1)'
            const strokeW = isSel ? 3 : 2
            return (
              <g key={det.id}>
                {contours.map((contour, i) => (
                  <g key={i}>
                    <path
                      d={contourToPathD(contour.points)}
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.95)"
                      strokeWidth={strokeW + 1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={contourToPathD(contour.points)}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={strokeW}
                      strokeDasharray={isSel ? undefined : '10 6'}
                      vectorEffect="non-scaling-stroke"
                      style={isSel ? undefined : { animation: 'sceneDetMarchingAnts 0.7s linear infinite' }}
                    />
                  </g>
                ))}
              </g>
            )
          })}
        </svg>
      )}

    </div>
  )
}

function contourToPathD(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  const head = points[0]
  let d = `M${head.x.toFixed(5)},${head.y.toFixed(5)}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    d += `L${p.x.toFixed(5)},${p.y.toFixed(5)}`
  }
  d += 'Z'
  return d
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image load failed: ${url}`))
    img.src = url
  })
}
