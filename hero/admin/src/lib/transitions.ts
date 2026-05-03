/**
 * Catalogue de transitions cinématiques réutilisables (style Netflix).
 *
 * Conçu pour s'appliquer entre n'importe quels deux médias visuels
 * (image ↔ image, image ↔ vidéo, vidéo ↔ vidéo) sans dépendance
 * externe — purement CSS keyframes injectées une fois dans <head>.
 *
 * Consommé par :
 *   - <CinematicTransition> (composant React générique)
 *   - SectionPlayer (transitions plan → plan)
 *   - Navigation section → section (futur)
 *   - Combat in/out (futur)
 *   - Mini-tel preview (transitions intra-timeline)
 */

export type TransitionEffect =
  | 'cut'                    // pas de transition (saut sec)
  | 'crossfade'              // défaut — opacity 0→1 / 1→0
  | 'fade-to-black'          // out → noir → in
  | 'fade-to-white'          // out → blanc → in
  | 'slide-left'             // sortant glisse à gauche, entrant arrive de droite
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom-in'                // entrant grossit (Ken Burns rentrant)
  | 'zoom-out'               // sortant rétrécit
  | 'iris-in'                // révélation circulaire (entrant)
  | 'iris-out'               // fermeture circulaire (sortant)
  | 'whip-pan'               // pan rapide horizontal + flou
  | 'blur'                   // sortant flou + fondu

export const TRANSITION_EFFECTS: { key: TransitionEffect; label: string; description: string }[] = [
  { key: 'cut', label: 'Cut', description: 'Saut sec, aucune transition' },
  { key: 'crossfade', label: 'Crossfade', description: 'Fondu simultané (défaut)' },
  { key: 'fade-to-black', label: 'Fade noir', description: 'Fondu vers noir puis ouverture' },
  { key: 'fade-to-white', label: 'Fade blanc', description: 'Fondu vers blanc puis ouverture (flash)' },
  { key: 'slide-left', label: 'Slide ←', description: 'Glissement vers la gauche' },
  { key: 'slide-right', label: 'Slide →', description: 'Glissement vers la droite' },
  { key: 'slide-up', label: 'Slide ↑', description: 'Glissement vers le haut' },
  { key: 'slide-down', label: 'Slide ↓', description: 'Glissement vers le bas' },
  { key: 'zoom-in', label: 'Zoom in', description: 'L\'entrant grossit depuis le centre' },
  { key: 'zoom-out', label: 'Zoom out', description: 'Le sortant rétrécit puis disparait' },
  { key: 'iris-in', label: 'Iris in', description: 'Révélation circulaire centrale' },
  { key: 'iris-out', label: 'Iris out', description: 'Fermeture circulaire' },
  { key: 'whip-pan', label: 'Whip pan', description: 'Pan rapide horizontal avec flou (Netflix)' },
  { key: 'blur', label: 'Blur', description: 'Flou + fondu' },
]

/** ID du <style> injecté dans <head>. */
export const TRANSITION_STYLE_ELEMENT_ID = 'hero-transitions-keyframes'

/** Bloc CSS contenant TOUS les keyframes des transitions. Injecté une seule fois. */
export const TRANSITION_KEYFRAMES_CSS = `
@keyframes hero-fade-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes hero-fade-in  { from { opacity: 0 } to { opacity: 1 } }

@keyframes hero-fade-to-black-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes hero-fade-from-black-in { from { opacity: 0 } to { opacity: 1 } }

@keyframes hero-slide-left-out  { from { transform: translateX(0) } to { transform: translateX(-100%) } }
@keyframes hero-slide-left-in   { from { transform: translateX(100%) } to { transform: translateX(0) } }
@keyframes hero-slide-right-out { from { transform: translateX(0) } to { transform: translateX(100%) } }
@keyframes hero-slide-right-in  { from { transform: translateX(-100%) } to { transform: translateX(0) } }
@keyframes hero-slide-up-out    { from { transform: translateY(0) } to { transform: translateY(-100%) } }
@keyframes hero-slide-up-in     { from { transform: translateY(100%) } to { transform: translateY(0) } }
@keyframes hero-slide-down-out  { from { transform: translateY(0) } to { transform: translateY(100%) } }
@keyframes hero-slide-down-in   { from { transform: translateY(-100%) } to { transform: translateY(0) } }

@keyframes hero-zoom-in-out    { from { transform: scale(1); opacity: 1 } to { transform: scale(1.15); opacity: 0 } }
@keyframes hero-zoom-in-in     { from { transform: scale(0.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes hero-zoom-out-out   { from { transform: scale(1); opacity: 1 } to { transform: scale(0.7); opacity: 0 } }
@keyframes hero-zoom-out-in    { from { transform: scale(1.3); opacity: 0 } to { transform: scale(1); opacity: 1 } }

@keyframes hero-iris-in-out    { from { clip-path: circle(150% at 50% 50%); opacity: 1 } to { clip-path: circle(150% at 50% 50%); opacity: 0 } }
@keyframes hero-iris-in-in     { from { clip-path: circle(0% at 50% 50%); opacity: 1 } to { clip-path: circle(150% at 50% 50%); opacity: 1 } }
@keyframes hero-iris-out-out   { from { clip-path: circle(150% at 50% 50%); opacity: 1 } to { clip-path: circle(0% at 50% 50%); opacity: 1 } }
@keyframes hero-iris-out-in    { from { clip-path: circle(0% at 50% 50%); opacity: 1 } to { clip-path: circle(150% at 50% 50%); opacity: 1 } }

@keyframes hero-whip-out { from { transform: translateX(0); filter: blur(0) } to { transform: translateX(-130%); filter: blur(8px) } }
@keyframes hero-whip-in  { from { transform: translateX(130%); filter: blur(8px) } to { transform: translateX(0); filter: blur(0) } }

@keyframes hero-blur-out { from { filter: blur(0); opacity: 1 } to { filter: blur(12px); opacity: 0 } }
@keyframes hero-blur-in  { from { filter: blur(12px); opacity: 0 } to { filter: blur(0); opacity: 1 } }
`

/** Injecte les keyframes dans <head> une seule fois (idempotent). */
export function ensureTransitionStylesInjected(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(TRANSITION_STYLE_ELEMENT_ID)) return
  const s = document.createElement('style')
  s.id = TRANSITION_STYLE_ELEMENT_ID
  s.textContent = TRANSITION_KEYFRAMES_CSS
  document.head.appendChild(s)
}

// ── Résolution effet → CSS animation shorthand ───────────────────────────────

export interface TransitionAnimations {
  /** CSS `animation` du média sortant (couche du dessous). */
  outAnimation: string
  /** CSS `animation` du média entrant (couche du dessus). */
  inAnimation: string
  /** Couleur de fond de la frame pendant la transition (utile pour fade-to-black/white). */
  background?: string
  /** Décalage temporel à appliquer à `inAnimation` via `animation-delay` (séquentiel). */
  inDelayMs?: number
  /** Durée totale visible de la transition (ms) — out + delay + in. */
  totalDurationMs: number
}

/**
 * Construit les CSS animations à appliquer aux 2 couches du composant.
 * IMPORTANT : le délai `inDelayMs` est intégré DIRECTEMENT dans la string shorthand
 * `inAnimation` (`name duration timing-function delay fill-mode`). Ne pas le passer
 * séparément en `animationDelay` — React warn sur le mix shorthand/longhand.
 *
 * `inDelayMs` reste exposé pour permettre aux consommateurs de calibrer l'opacité
 * initiale de la couche entrante (0 si délai > 0, sinon 1).
 *
 * @param effect type de transition
 * @param durationMs durée d'UNE phase (out OU in). Pour effets séquentiels (fade-to-black),
 *                   la durée totale visible est ~2× cette valeur.
 */
export function getTransitionAnimations(effect: TransitionEffect, durationMs = 600): TransitionAnimations {
  const d = Math.max(50, durationMs)
  const ease = 'cubic-bezier(0.4, 0, 0.2, 1)'
  // Helper : assemble le shorthand `name duration timing-function delay fill-mode`
  const sh = (name: string, delayMs = 0) => `${name} ${d}ms ${ease} ${delayMs}ms forwards`

  switch (effect) {
    case 'cut':
      return { outAnimation: 'none', inAnimation: 'none', totalDurationMs: 0 }

    case 'crossfade':
      return {
        outAnimation: sh('hero-fade-out'),
        inAnimation: sh('hero-fade-in'),
        totalDurationMs: d,
      }

    case 'fade-to-black':
      return {
        outAnimation: sh('hero-fade-to-black-out'),
        inAnimation: sh('hero-fade-from-black-in', d),
        background: '#000',
        inDelayMs: d,
        totalDurationMs: 2 * d,
      }
    case 'fade-to-white':
      return {
        outAnimation: sh('hero-fade-to-black-out'),
        inAnimation: sh('hero-fade-from-black-in', d),
        background: '#fff',
        inDelayMs: d,
        totalDurationMs: 2 * d,
      }

    case 'slide-left':
      return { outAnimation: sh('hero-slide-left-out'), inAnimation: sh('hero-slide-left-in'), totalDurationMs: d }
    case 'slide-right':
      return { outAnimation: sh('hero-slide-right-out'), inAnimation: sh('hero-slide-right-in'), totalDurationMs: d }
    case 'slide-up':
      return { outAnimation: sh('hero-slide-up-out'), inAnimation: sh('hero-slide-up-in'), totalDurationMs: d }
    case 'slide-down':
      return { outAnimation: sh('hero-slide-down-out'), inAnimation: sh('hero-slide-down-in'), totalDurationMs: d }

    case 'zoom-in':
      return { outAnimation: sh('hero-zoom-in-out'), inAnimation: sh('hero-zoom-in-in'), totalDurationMs: d }
    case 'zoom-out':
      return { outAnimation: sh('hero-zoom-out-out'), inAnimation: sh('hero-zoom-out-in'), totalDurationMs: d }

    case 'iris-in':
      return { outAnimation: sh('hero-iris-in-out'), inAnimation: sh('hero-iris-in-in'), totalDurationMs: d }
    case 'iris-out':
      return { outAnimation: sh('hero-iris-out-out'), inAnimation: sh('hero-iris-out-in'), totalDurationMs: d }

    case 'whip-pan':
      return { outAnimation: sh('hero-whip-out'), inAnimation: sh('hero-whip-in'), totalDurationMs: d }

    case 'blur':
      return { outAnimation: sh('hero-blur-out'), inAnimation: sh('hero-blur-in'), totalDurationMs: d }
  }
}
