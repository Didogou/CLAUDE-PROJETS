/**
 * Type shims pour vanta.js — chaque effet expose un default export factory.
 * La lib n'embarque aucune définition TypeScript ; on déclare l'API minimale
 * qu'on consomme côté Hero (factory(opts) → instance avec setOptions+destroy).
 *
 * three-r134 = alias npm vers three@0.134.0, version compatible avec vanta
 * (qui a été buildé contre cette version). Importé uniquement par la page
 * vanta, n'affecte pas la version r184 utilisée par Pano360Viewer.
 */
declare module 'glfx' {
  // glfx.js (Evan Wallace) — pas de typings officiels. On expose juste
  // l'export par défaut comme objet ouvert ; le typage précis se fait dans
  // la page de test via une interface locale.
  const glfx: { canvas(): HTMLCanvasElement } & Record<string, unknown>
  export default glfx
}

declare module 'three-r134' {
  // Ré-exporte le namespace three (toutes les classes : Scene, WebGLRenderer,
  // PerspectiveCamera, Color, Mesh, etc.). Les types officiels @types/three
  // matchent la version installée dans node_modules/three (r184) — pour le
  // POC vanta on ne s'en sert que pour passer en option, donc unknown OK.
  const THREE: Record<string, unknown> & { REVISION?: string }
  export = THREE
}

declare module 'vanta/dist/vanta.fog.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.clouds.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.clouds2.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.birds.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.net.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.waves.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.halo.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.topology.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.cells.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.globe.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.rings.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.dots.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
declare module 'vanta/dist/vanta.trunk.min' {
  const factory: (opts: Record<string, unknown>) => { setOptions(o: Record<string, unknown>): void; destroy(): void }
  export default factory
}
