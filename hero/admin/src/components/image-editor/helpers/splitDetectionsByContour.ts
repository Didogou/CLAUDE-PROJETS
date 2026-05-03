/**
 * Split client-side des détections multi-contour en détections individuelles.
 *
 * Pourquoi : la pré-analyse SAM groupe parfois plusieurs objets visuellement
 * distincts dans UNE seule détection (ex: "3 tonneaux" → 1 détection avec
 * un mask qui contient 3 zones blanches disjointes). Pour permettre à
 * l'utilisateur de manipuler chaque tonneau individuellement, on splitte
 * via les composantes connexes du mask (magic-wand-tool en sort 1 contour
 * outer par composante).
 *
 * Pipeline :
 *   1. Pour chaque détection : charger le mask, extraire les contours
 *   2. Filtrer les contours trop petits (bruit SAM, < MIN_AREA)
 *   3. Si 1 seul contour outer → la détection est gardée telle quelle
 *   4. Si N contours outer (N > 1) → splitter en N nouvelles détections,
 *      chacune avec son propre mask PNG (ré-rasterisé via canvas + clip path)
 *
 * Le résultat est purement client-side (data URLs). La persistance est
 * faite par /api/comfyui/analyze-scene/split qui upload les PNG, PATCH la
 * ligne DB et supprime les masks groupés obsolètes.
 */

import { maskUrlToContours } from './maskUrlToContours'
import type { MagicWandContour } from './magicWand'
import type { SceneDetection } from '../EditorStateContext'

/** Aire minimum (en fraction d'image) pour qu'un contour soit gardé.
 *  Filtre les bruits du mask SAM (taches de quelques pixels). */
const MIN_CONTOUR_AREA = 0.001  // 0.1% de l'image

/** ID-friendly suffix : conserve l'id parent + index pour traçabilité. */
function genSplitId(parentId: string, idx: number): string {
  return `${parentId}__s${idx}`
}

/** Aire absolue d'un polygone (formule du lacet). Coords arbitraires. */
function polygonArea(points: Array<{ x: number; y: number }>): number {
  let s = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    s += (points[j].x + points[i].x) * (points[j].y - points[i].y)
  }
  return Math.abs(s) / 2
}

/** Bbox normalisée [x1, y1, x2, y2] d'un contour (coords 0-1). */
function contourBbox(points: Array<{ x: number; y: number }>): [number, number, number, number] {
  let minX = 1, minY = 1, maxX = 0, maxY = 0
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return [minX, minY, maxX, maxY]
}

/**
 * Crée un PNG mask binaire (blanc = intérieur du contour, noir ailleurs)
 * aux dimensions PLEINES de l'image source. Conserve le repère absolu pour
 * que les coords bbox/contours restent exploitables sans re-mapping.
 *
 * Retourne une dataURL `image/png` (utilisée ensuite par l'API split pour
 * upload Supabase).
 */
function rasterizeContourToMaskDataUrl(
  contour: MagicWandContour,
  imageWidth: number,
  imageHeight: number,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = imageWidth
  canvas.height = imageHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  // Fond noir
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, imageWidth, imageHeight)

  // Trace le contour en blanc plein (fill rule par défaut nonzero — ok)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  const pts = contour.points
  if (pts.length === 0) return canvas.toDataURL('image/png')
  ctx.moveTo(pts[0].x * imageWidth, pts[0].y * imageHeight)
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x * imageWidth, pts[i].y * imageHeight)
  }
  ctx.closePath()
  ctx.fill()

  return canvas.toDataURL('image/png')
}

/** Une détection issue du split, avec marqueurs pour le backend. */
export interface SplitOutputDetection {
  id: string
  label: string
  bbox: [number, number, number, number]
  bbox_pixels: [number, number, number, number]
  source?: 'dense' | 'od'
  /** True si c'est une nouvelle détection issue d'un split (mask à upload).
   *  False si la détection est gardée telle quelle (single-contour). */
  is_split: boolean
  /** Nouveau mask PNG en data URL (si is_split=true). */
  mask_data_url?: string
  /** URL du mask original (si is_split=false, pas modifiée). */
  mask_url?: string | null
  /** ID de la détection parent (si is_split=true) — utile pour traçabilité. */
  parent_id?: string
}

export interface SplitResult {
  /** Tableau final de détections (mix : non-splittées + splittées) */
  detections: SplitOutputDetection[]
  /** mask_urls des détections parents qui ont été splittées (à delete sur Storage) */
  obsolete_mask_urls: string[]
  /** Stats de log */
  stats: {
    input: number
    kept_unchanged: number
    split_parents: number
    split_children: number
    filtered_too_small: number
  }
}

export async function splitDetectionsByContour(
  detections: SceneDetection[],
  imageWidth: number,
  imageHeight: number,
): Promise<SplitResult> {
  const out: SplitOutputDetection[] = []
  const obsolete: string[] = []
  let kept = 0
  let parents = 0
  let children = 0
  let filtered = 0

  for (const d of detections) {
    if (!d.mask_url) {
      // Pas de mask → on la conserve tel quel (rare, mais on ne casse pas)
      out.push({
        id: d.id,
        label: d.label,
        bbox: d.bbox,
        bbox_pixels: d.bbox_pixels,
        source: d.source,
        is_split: false,
        mask_url: null,
      })
      kept++
      continue
    }

    let contours: MagicWandContour[]
    try {
      contours = await maskUrlToContours(d.mask_url)
    } catch (err) {
      console.warn('[splitDetectionsByContour] decode failed for', d.label, err)
      out.push({
        id: d.id,
        label: d.label,
        bbox: d.bbox,
        bbox_pixels: d.bbox_pixels,
        source: d.source,
        is_split: false,
        mask_url: d.mask_url,
      })
      kept++
      continue
    }

    // Garde uniquement les contours OUTERS (les `inner` sont des trous,
    // pas des objets séparables) au-dessus du seuil d'aire.
    const outers = contours
      .filter(c => !c.inner)
      .map(c => ({ contour: c, area: polygonArea(c.points) }))
    const filteredOut = outers.filter(o => o.area < MIN_CONTOUR_AREA).length
    filtered += filteredOut
    const keptOuters = outers.filter(o => o.area >= MIN_CONTOUR_AREA)

    if (keptOuters.length === 0) {
      // Tout a été filtré → on garde la détection mère telle quelle (sécurité,
      // évite de perdre l'info si seuil trop agressif).
      out.push({
        id: d.id,
        label: d.label,
        bbox: d.bbox,
        bbox_pixels: d.bbox_pixels,
        source: d.source,
        is_split: false,
        mask_url: d.mask_url,
      })
      kept++
      continue
    }

    if (keptOuters.length === 1) {
      // Single-contour → conservée intacte
      out.push({
        id: d.id,
        label: d.label,
        bbox: d.bbox,
        bbox_pixels: d.bbox_pixels,
        source: d.source,
        is_split: false,
        mask_url: d.mask_url,
      })
      kept++
      continue
    }

    // Multi-contour → split
    parents++
    obsolete.push(d.mask_url)
    keptOuters.forEach((o, idx) => {
      const bbox = contourBbox(o.contour.points)
      const bboxPx: [number, number, number, number] = [
        Math.round(bbox[0] * imageWidth),
        Math.round(bbox[1] * imageHeight),
        Math.round(bbox[2] * imageWidth),
        Math.round(bbox[3] * imageHeight),
      ]
      const dataUrl = rasterizeContourToMaskDataUrl(o.contour, imageWidth, imageHeight)
      out.push({
        id: genSplitId(d.id, idx),
        label: d.label,                 // label hérité du parent (ex: "barrels" → "barrels" ×3)
        bbox,
        bbox_pixels: bboxPx,
        source: d.source,
        is_split: true,
        mask_data_url: dataUrl,
        parent_id: d.id,
      })
      children++
    })
  }

  const stats = {
    input: detections.length,
    kept_unchanged: kept,
    split_parents: parents,
    split_children: children,
    filtered_too_small: filtered,
  }
  console.log('[splitDetectionsByContour]', stats)

  return { detections: out, obsolete_mask_urls: obsolete, stats }
}
