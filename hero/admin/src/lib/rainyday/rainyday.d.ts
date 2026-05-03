/**
 * Type declarations minimales pour rainyday.js (forké de
 * konstantinos-tsatsarounos/rainyday.js, lui-même fork de maroslaw/rainyday.js).
 *
 * API minimale qu'on utilise : constructor + .rain() + .gravity().
 * Les autres méthodes du prototype sont disponibles mais pas typées ici.
 */

declare class RainyDay {
  constructor(
    canvasid: string,
    sourceid: string,
    width: number,
    height: number,
    opacity?: number,
    blur?: number,
  )
  /** Lance l'animation. presets = liste de [maxRadius, minRadius, chance]. */
  rain(presets: Array<[number, number, number]>, speed: number): void
  /** Vitesse de chute. */
  gravity(drop: unknown): void
  /** Largeur calculée du canvas. */
  w: number
  /** Hauteur calculée du canvas. */
  h: number
}

declare module '@/lib/rainyday/rainyday.js' {
  const RainyDay: typeof globalThis extends { RainyDay: infer R } ? R : new (
    canvasid: string,
    sourceid: string,
    width: number,
    height: number,
    opacity?: number,
    blur?: number,
  ) => {
    rain(presets: Array<[number, number, number]>, speed: number): void
    w: number
    h: number
  }
  export default RainyDay
}
