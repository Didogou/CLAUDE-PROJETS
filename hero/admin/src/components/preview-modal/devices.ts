/**
 * Catalogue de devices preview unifié Hero — utilisé par PreviewModal.
 * V1 2026-05-16 : iPhone 16 portrait/landscape, iPad Pro, Desktop.
 * V2 : ajouter watch, foldable, ratios custom, frame avec notch/punch-hole.
 */

export interface PreviewDevice {
  id: string
  label: string
  /** Largeur écran utile (rem). Hauteur déduite via aspectRatio si non fournie. */
  widthRem: number
  /** Hauteur écran utile (rem). Si omise, déduite via widthRem * aspectRatio. */
  heightRem?: number
  /** Ratio aspect (width / height), utilisé pour calculer heightRem si absent. */
  aspectRatio: number
  /** Style frame V1 = simple bordure arrondie. V2 : notch/punch-hole. */
  frameRadiusRem: number
  /** Épaisseur du bezel autour de l'écran (rem). */
  bezelRem: number
  /** Pour différencier portrait/landscape dans l'UI. */
  orientation: 'portrait' | 'landscape'
}

export const PREVIEW_DEVICES: PreviewDevice[] = [
  {
    id: 'iphone16-portrait',
    label: 'iPhone 16',
    widthRem: 18,
    aspectRatio: 9 / 19.5,
    frameRadiusRem: 2,
    bezelRem: 0.7,
    orientation: 'portrait',
  },
  {
    id: 'iphone16-landscape',
    label: 'iPhone 16 (paysage)',
    widthRem: 32,
    aspectRatio: 19.5 / 9,
    frameRadiusRem: 2,
    bezelRem: 0.7,
    orientation: 'landscape',
  },
  {
    id: 'ipad-pro',
    label: 'iPad Pro',
    widthRem: 26,
    aspectRatio: 4 / 3,
    frameRadiusRem: 1.4,
    bezelRem: 1,
    orientation: 'portrait',
  },
  {
    id: 'desktop',
    label: 'Desktop 16:9',
    widthRem: 36,
    aspectRatio: 16 / 9,
    frameRadiusRem: 0.5,
    bezelRem: 0.4,
    orientation: 'landscape',
  },
]

export const DEFAULT_DEVICE_ID = 'iphone16-portrait'

export function getDeviceById(id: string): PreviewDevice {
  return PREVIEW_DEVICES.find(d => d.id === id) ?? PREVIEW_DEVICES[0]
}

/** Calcule la hauteur écran utile en rem pour un device. */
export function getDeviceHeightRem(d: PreviewDevice): number {
  return d.heightRem ?? d.widthRem / d.aspectRatio
}
