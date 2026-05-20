'use client'
/**
 * OverlayCatalog — Refonte 2026-05-15bv.
 *
 * Catalogue d'overlays HTML/CSS pour POC video effects, complémentaires aux
 * effets shader WebGL (VideoEffectsCanvas). Chaque overlay est un composant
 * autonome qui se positionne en absolute par dessus son parent (le parent
 * doit être `position: relative`).
 *
 * Inclus :
 *   - LetterboxOverlay  : bandes noires haut/bas (cinéma 21:9, 2.35:1, etc.)
 *   - PolaroidFrame     : cadre photo blanc + zone de légende en bas
 *   - PhoneFrame        : cadre smartphone iPhone notch + bouton home
 *   - ViewfinderOverlay : 4 coins focus + croix centrale (caméra reflex)
 *   - OldFilmOverlay    : rayures verticales animées + gate weave + dust
 *   - LightLeaksOverlay : taches lumineuses qui passent (lomo vintage)
 *   - LensDirtOverlay   : poussière / gouttes statiques sur l'objectif
 *   - BadSignalOverlay  : interférence statique ("snow" TV cassée)
 *
 * Tous prennent un prop `enabled: boolean`. Toggle on/off propre.
 */

import React from 'react'

// ─── 1. LETTERBOX (bandes cinéma) ───────────────────────────────────────────

interface LetterboxOverlayProps {
  enabled: boolean
  /** Ratio cible. 'cinema_2.35' = 2.35:1 / 'cinema_2.39' = 2.39:1 / '21_9' = 21:9.
   *  Calcule la hauteur des bandes en fonction de l'aspect ratio du parent. */
  ratio?: 'cinema_2.35' | 'cinema_2.39' | '21_9' | '4_3'
}

export function LetterboxOverlay({ enabled, ratio = 'cinema_2.35' }: LetterboxOverlayProps) {
  if (!enabled) return null
  const targetAspect = ratio === 'cinema_2.35' ? 2.35
    : ratio === 'cinema_2.39' ? 2.39
    : ratio === '21_9' ? 21 / 9
    : 4 / 3
  // Pourcentage des bandes : on suppose le parent en 16:9. Si target < 16/9 → no bars.
  const sourceAspect = 16 / 9
  const barPct = targetAspect > sourceAspect
    ? ((1 - sourceAspect / targetAspect) / 2) * 100
    : 0
  return (
    <>
      <div style={letterboxStyle('top', barPct)} aria-hidden />
      <div style={letterboxStyle('bottom', barPct)} aria-hidden />
    </>
  )
}
const letterboxStyle = (pos: 'top' | 'bottom', heightPct: number): React.CSSProperties => ({
  position: 'absolute', left: 0, right: 0,
  [pos]: 0, height: `${heightPct}%`,
  background: '#000', pointerEvents: 'none', zIndex: 9,
})

// ─── 2. POLAROID FRAME ──────────────────────────────────────────────────────

interface PolaroidFrameProps {
  enabled: boolean
  caption?: string
}

export function PolaroidFrame({ enabled, caption }: PolaroidFrameProps) {
  if (!enabled) return null
  return (
    <div className="poc-polaroid" aria-hidden>
      {caption && <div className="poc-polaroid-caption">{caption}</div>}
      <style jsx>{`
        .poc-polaroid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 9;
          box-shadow:
            inset 0 0 0 1.2rem #f8f5ee,
            inset 0 -5rem 0 1.2rem #f8f5ee,
            0 0.5rem 1.5rem rgba(0, 0, 0, 0.4);
        }
        .poc-polaroid-caption {
          position: absolute;
          bottom: 1rem;
          left: 0;
          right: 0;
          text-align: center;
          color: #333;
          font-family: 'Caveat', 'Brush Script MT', cursive;
          font-size: 1.6rem;
          letter-spacing: 0.05em;
        }
      `}</style>
    </div>
  )
}

// ─── 3. PHONE FRAME (iPhone-like) ───────────────────────────────────────────

interface PhoneFrameProps {
  enabled: boolean
}

export function PhoneFrame({ enabled }: PhoneFrameProps) {
  if (!enabled) return null
  return (
    <div className="poc-phone" aria-hidden>
      <div className="poc-phone-notch" />
      <style jsx>{`
        .poc-phone {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 9;
          border-radius: 1.5rem;
          box-shadow:
            inset 0 0 0 0.4rem #1a1a1a,
            inset 0 0 0 0.5rem #444,
            0 1rem 2rem rgba(0, 0, 0, 0.5);
        }
        .poc-phone-notch {
          position: absolute;
          top: 0.4rem;
          left: 50%;
          transform: translateX(-50%);
          width: 7rem;
          height: 1.5rem;
          background: #000;
          border-radius: 0 0 1rem 1rem;
        }
      `}</style>
    </div>
  )
}

// ─── 4. VIEWFINDER (4 coins focus + croix qui suit la cible si tracking) ───
// Refonte 2026-05-15co — accepte centerX/Y comme SniperScope pour mouse track.

interface ViewfinderOverlayProps {
  enabled: boolean
  /** Position du crosshair central (0-1). Default 0.5/0.5. */
  centerX?: number
  centerY?: number
}

export function ViewfinderOverlay({ enabled, centerX = 0.5, centerY = 0.5 }: ViewfinderOverlayProps) {
  if (!enabled) return null
  const cxPct = `${(centerX * 100).toFixed(2)}%`
  const cyPct = `${(centerY * 100).toFixed(2)}%`
  return (
    <div className="poc-vf" aria-hidden style={{ ['--cx' as string]: cxPct, ['--cy' as string]: cyPct }}>
      {/* Coins focus restent fixes (cadre du viseur) */}
      <span className="poc-vf-corner poc-vf-tl" />
      <span className="poc-vf-corner poc-vf-tr" />
      <span className="poc-vf-corner poc-vf-bl" />
      <span className="poc-vf-corner poc-vf-br" />
      {/* Crosshair central qui suit (--cx, --cy) */}
      <span className="poc-vf-cross-h" />
      <span className="poc-vf-cross-v" />
      <span className="poc-vf-dot" />
      <style jsx>{`
        .poc-vf { position: absolute; inset: 0; pointer-events: none; z-index: 9; }
        .poc-vf-corner {
          position: absolute;
          width: 2rem;
          height: 2rem;
          border: 0.15rem solid rgba(255, 255, 255, 0.85);
        }
        .poc-vf-tl { top: 1rem; left: 1rem; border-right: none; border-bottom: none; }
        .poc-vf-tr { top: 1rem; right: 1rem; border-left: none; border-bottom: none; }
        .poc-vf-bl { bottom: 1rem; left: 1rem; border-right: none; border-top: none; }
        .poc-vf-br { bottom: 1rem; right: 1rem; border-left: none; border-top: none; }
        .poc-vf-cross-h, .poc-vf-cross-v {
          position: absolute;
          background: rgba(255, 255, 255, 0.7);
          transition: top 80ms linear, left 80ms linear;
        }
        .poc-vf-cross-h {
          left: var(--cx, 50%); top: calc(var(--cy, 50%) - 0.05rem);
          transform: translateX(-50%);
          width: 1.5rem; height: 0.1rem;
        }
        .poc-vf-cross-v {
          top: var(--cy, 50%); left: calc(var(--cx, 50%) - 0.05rem);
          transform: translateY(-50%);
          height: 1.5rem; width: 0.1rem;
        }
        .poc-vf-dot {
          position: absolute;
          left: var(--cx, 50%); top: var(--cy, 50%);
          transform: translate(-50%, -50%);
          width: 0.25rem; height: 0.25rem;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 0 0.4rem rgba(255, 255, 255, 0.55);
        }
      `}</style>
    </div>
  )
}

// ─── 5. OLD FILM (rayures + gate weave) ─────────────────────────────────────

interface OldFilmOverlayProps {
  enabled: boolean
}

export function OldFilmOverlay({ enabled }: OldFilmOverlayProps) {
  if (!enabled) return null
  return (
    <div className="poc-oldfilm" aria-hidden>
      <div className="poc-oldfilm-scratches" />
      <div className="poc-oldfilm-dust" />
      <style jsx>{`
        .poc-oldfilm {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 9;
          animation: poc-gate-weave 0.13s steps(2, end) infinite;
        }
        @keyframes poc-gate-weave {
          0%   { transform: translate(0, 0); }
          25%  { transform: translate(-0.1%, 0.05%); }
          50%  { transform: translate(0.05%, -0.1%); }
          75%  { transform: translate(-0.05%, 0.1%); }
          100% { transform: translate(0, 0); }
        }
        .poc-oldfilm-scratches {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(to right, transparent 32%, rgba(255,255,255,0.25) 32.1%, transparent 32.4%),
            linear-gradient(to right, transparent 67%, rgba(0,0,0,0.4) 67.05%, transparent 67.3%),
            linear-gradient(to right, transparent 84%, rgba(255,255,255,0.18) 84.05%, transparent 84.2%);
          mix-blend-mode: overlay;
          animation: poc-scratches-shift 0.4s steps(3, end) infinite;
        }
        @keyframes poc-scratches-shift {
          0%   { transform: translateX(0); opacity: 0.7; }
          33%  { transform: translateX(-3%); opacity: 0.4; }
          66%  { transform: translateX(2%); opacity: 0.6; }
          100% { transform: translateX(0); opacity: 0.7; }
        }
        .poc-oldfilm-dust {
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle 0.15rem at 20% 30%, rgba(0,0,0,0.5), transparent),
            radial-gradient(circle 0.1rem at 70% 80%, rgba(0,0,0,0.4), transparent),
            radial-gradient(circle 0.2rem at 50% 60%, rgba(255,255,255,0.3), transparent),
            radial-gradient(circle 0.12rem at 85% 20%, rgba(0,0,0,0.45), transparent);
          animation: poc-dust-shift 0.2s steps(4, end) infinite;
        }
        @keyframes poc-dust-shift {
          0%   { transform: translate(0, 0); }
          25%  { transform: translate(0.3%, 0.5%); }
          50%  { transform: translate(-0.2%, 0.3%); }
          75%  { transform: translate(0.4%, -0.3%); }
          100% { transform: translate(0, 0); }
        }
      `}</style>
    </div>
  )
}

// ─── 6. LIGHT LEAKS (taches lumineuses qui passent) ────────────────────────

interface LightLeaksOverlayProps {
  enabled: boolean
}

export function LightLeaksOverlay({ enabled }: LightLeaksOverlayProps) {
  if (!enabled) return null
  return (
    <div className="poc-leaks" aria-hidden>
      <style jsx>{`
        .poc-leaks {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 9;
          background:
            radial-gradient(ellipse 60% 80% at 100% 50%, rgba(255, 180, 80, 0.4) 0%, transparent 40%),
            radial-gradient(ellipse 40% 60% at 0% 30%, rgba(255, 100, 60, 0.3) 0%, transparent 50%),
            radial-gradient(ellipse 30% 40% at 80% 90%, rgba(255, 220, 100, 0.25) 0%, transparent 60%);
          mix-blend-mode: screen;
          animation: poc-leaks-shift 7s ease-in-out infinite;
        }
        @keyframes poc-leaks-shift {
          0%, 100% { opacity: 0.85; transform: translate(0, 0); }
          25%      { opacity: 1;   transform: translate(2%, -1%); }
          50%      { opacity: 0.7; transform: translate(-1%, 2%); }
          75%      { opacity: 0.95; transform: translate(1%, 1%); }
        }
      `}</style>
    </div>
  )
}

// ─── 7. LENS DIRT (poussière statique sur l'objectif) ──────────────────────

interface LensDirtOverlayProps {
  enabled: boolean
}

export function LensDirtOverlay({ enabled }: LensDirtOverlayProps) {
  if (!enabled) return null
  return (
    <div className="poc-dirt" aria-hidden>
      <style jsx>{`
        .poc-dirt {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 9;
          background-image:
            radial-gradient(circle 0.4rem at 18% 22%, rgba(0, 0, 0, 0.18), transparent 70%),
            radial-gradient(circle 0.6rem at 70% 35%, rgba(0, 0, 0, 0.12), transparent 70%),
            radial-gradient(circle 0.3rem at 45% 65%, rgba(0, 0, 0, 0.2), transparent 70%),
            radial-gradient(circle 0.7rem at 88% 78%, rgba(0, 0, 0, 0.1), transparent 70%),
            radial-gradient(circle 0.25rem at 25% 80%, rgba(255, 255, 255, 0.18), transparent 60%),
            radial-gradient(circle 0.35rem at 60% 12%, rgba(255, 255, 255, 0.12), transparent 60%);
          mix-blend-mode: multiply;
        }
      `}</style>
    </div>
  )
}

// ─── 8. BAD SIGNAL (snow / static interference) ───────────────────────────

interface BadSignalOverlayProps {
  enabled: boolean
  /** 0 (off) → 1 (signal très dégradé). */
  intensity?: number
}

export function BadSignalOverlay({ enabled, intensity = 0.5 }: BadSignalOverlayProps) {
  if (!enabled) return null
  return (
    <div className="poc-signal" style={{ opacity: intensity }} aria-hidden>
      <div className="poc-signal-noise" />
      <div className="poc-signal-bands" />
      <style jsx>{`
        .poc-signal {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 9;
          mix-blend-mode: screen;
        }
        .poc-signal-noise {
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.65'/></svg>");
          background-size: 100% 100%;
          animation: poc-signal-flicker 0.05s steps(2, end) infinite;
        }
        @keyframes poc-signal-flicker {
          0%   { background-position: 0 0; }
          50%  { background-position: -50% 25%; }
          100% { background-position: 30% -40%; }
        }
        .poc-signal-bands {
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            to bottom,
            transparent 0,
            transparent 0.4rem,
            rgba(255, 255, 255, 0.05) 0.4rem,
            rgba(255, 255, 255, 0.05) 0.5rem
          );
        }
      `}</style>
    </div>
  )
}

// ─── 9. SNIPER SCOPE (lunette fusil avec réticule) ─────────────────────────

interface SniperScopeOverlayProps {
  enabled: boolean
  /** Couleur du réticule (default 'red'). 'green' pour night vision. */
  reticleColor?: 'red' | 'green' | 'black'
  /** Mil-dots (graduations sur les axes) on/off. */
  milDots?: boolean
  /** Position du centre du scope (0-1, normalisé sur le viewport). */
  centerX?: number
  centerY?: number
  /** Taille de la zone visible (0.05 → 0.5 = % du plus petit côté).
   *  Default 0.22. Refonte 2026-05-15by — paramétrable. */
  scopeSize?: number
  /** Si false, désactive le mask noir extérieur (toute l'image visible).
   *  Refonte 2026-05-15by — utile pendant countdown pour positionner la cible. */
  showMask?: boolean
}

export function SniperScopeOverlay({
  enabled, reticleColor = 'black', milDots = true,
  centerX = 0.5, centerY = 0.5,
  scopeSize = 0.22, showMask = true,
}: SniperScopeOverlayProps) {
  // Refonte 2026-05-15bz — Taille en pixels via ResizeObserver pour stabilité
  // absolue. Avant, radial-gradient(circle at X% Y%) utilisait farthest-corner
  // par défaut → la zone visible grossissait quand le curseur s'éloignait du
  // centre. Maintenant on impose une taille px fixe (= scopeSize × min(W, H))
  // et le mask devient `radial-gradient(circle SIZE_PX at ...)` indépendant
  // de la position du curseur.
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [sizePx, setSizePx] = React.useState<number>(0)
  React.useEffect(() => {
    if (!enabled) return
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      const minSide = Math.min(r.width, r.height)
      setSizePx(minSide * scopeSize)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled, scopeSize])

  if (!enabled) return null
  const color = reticleColor === 'red' ? '#ff2d2d'
    : reticleColor === 'green' ? '#39ff14'
    : '#000'
  const cxPct = `${(centerX * 100).toFixed(2)}%`
  const cyPct = `${(centerY * 100).toFixed(2)}%`
  return (
    <div className="poc-scope" aria-hidden
      ref={containerRef}
      style={{
        ['--cx' as string]: cxPct,
        ['--cy' as string]: cyPct,
        ['--scope-r' as string]: `${sizePx}px`,
        ['--scope-r-out' as string]: `${sizePx + 8}px`,
        ['--reticle-size' as string]: `${sizePx * 2}px`,
      }}
    >
      {/* Cercle externe noir (= bord lunette qui masque les coins) — toggle */}
      {showMask && <div className="poc-scope-mask" />}
      {/* Réticule SVG centré (refonte 2026-05-15ca — axes raccourcis à 75/200
       *  pour ne plus déborder du cercle visible. Avant les axes allaient
       *  jusqu'aux bords du SVG (x=0/200) et étaient tangents au clip-path
       *  circle, ce qui les rendait visibles hors zone "lunette". */}
      <svg className="poc-scope-reticle" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
        {/* Point central (point de visée) */}
        <circle cx="100" cy="100" r="2.5" fill={color} />
        {/* Cercle moyen (zone de tir) */}
        <circle cx="100" cy="100" r="32" stroke={color} strokeWidth="0.8" fill="none" opacity="0.55" />
        {/* Croix horizontale + verticale — DE 25 à 80 (et 120 à 175) pour
         *  rester franchement DANS le cercle visible (rayon ~95 du centre 100). */}
        <line x1="25" y1="100" x2="80" y2="100" stroke={color} strokeWidth="1.5" />
        <line x1="120" y1="100" x2="175" y2="100" stroke={color} strokeWidth="1.5" />
        <line x1="100" y1="25" x2="100" y2="80" stroke={color} strokeWidth="1.5" />
        <line x1="100" y1="120" x2="100" y2="175" stroke={color} strokeWidth="1.5" />
        {/* Mil-dots (graduations sur les axes) */}
        {milDots && (
          <>
            {[45, 58, 71, 129, 142, 155].map(x => (
              <circle key={`h${x}`} cx={x} cy="100" r="1.4" fill={color} />
            ))}
            {[45, 58, 71, 129, 142, 155].map(y => (
              <circle key={`v${y}`} cx="100" cy={y} r="1.4" fill={color} />
            ))}
          </>
        )}
      </svg>
      <style jsx>{`
        .poc-scope {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 10;
        }
        /* Mask noir radial. Refonte 2026-05-15by — taille FIXE via var
         * (--scope-r) ne change pas avec mouvement souris (= cercle visible
         * stable, pas d'effet zoom involontaire). */
        .poc-scope-mask {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            circle at var(--cx, 50%) var(--cy, 50%),
            transparent 0%,
            transparent var(--scope-r, 22%),
            rgba(0, 0, 0, 0.85) var(--scope-r-out, 25%),
            #000 calc(var(--scope-r-out, 25%) + 3%)
          );
        }
        /* Réticule SVG centré sur (--cx, --cy). HEIGHT (pas width) pour
         * matcher le diamètre du mask radial qui est en % du plus petit
         * côté du parent (= height en 16:9). Refonte 2026-05-15bz : avant
         * width: 44% donnait 563px sur un canvas 1280px alors que le mask
         * faisait 316px → débordement. */
        .poc-scope-reticle {
          position: absolute;
          left: var(--cx, 50%);
          top: var(--cy, 50%);
          height: var(--reticle-size, 44%);
          width: auto;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%);
          opacity: 0.9;
          clip-path: circle(50% at 50% 50%);
        }
      `}</style>
    </div>
  )
}

// ─── 10. HUD RÉTICULE (réticule simple, sans mask) ─────────────────────────

interface HudReticleOverlayProps {
  enabled: boolean
  /** Couleur (default rouge). */
  color?: 'red' | 'green' | 'cyan' | 'white'
  /** Position du réticule (0-1). Default 0.5/0.5. Refonte 2026-05-15co. */
  centerX?: number
  centerY?: number
}

export function HudReticleOverlay({
  enabled, color = 'red', centerX = 0.5, centerY = 0.5,
}: HudReticleOverlayProps) {
  if (!enabled) return null
  const c = color === 'red' ? '#ff2d2d'
    : color === 'green' ? '#39ff14'
    : color === 'cyan' ? '#00e6ff'
    : '#fff'
  return (
    <div aria-hidden style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
    }}>
      <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet"
        style={{
          position: 'absolute',
          left: `${(centerX * 100).toFixed(2)}%`,
          top: `${(centerY * 100).toFixed(2)}%`,
          width: '12rem', height: '12rem',
          transform: 'translate(-50%, -50%)',
          opacity: 0.85,
          filter: `drop-shadow(0 0 0.3rem ${c})`,
          transition: 'left 80ms linear, top 80ms linear',
        }}>
        <circle cx="100" cy="100" r="55" stroke={c} strokeWidth="1.2" fill="none" opacity="0.7" />
        <circle cx="100" cy="100" r="20" stroke={c} strokeWidth="0.8" fill="none" opacity="0.6" />
        <circle cx="100" cy="100" r="2" fill={c} />
        <line x1="40" y1="100" x2="80" y2="100" stroke={c} strokeWidth="1" />
        <line x1="120" y1="100" x2="160" y2="100" stroke={c} strokeWidth="1" />
        <line x1="100" y1="40" x2="100" y2="80" stroke={c} strokeWidth="1" />
        <line x1="100" y1="120" x2="100" y2="160" stroke={c} strokeWidth="1" />
      </svg>
    </div>
  )
}

// ─── 12. SECURITY CAM HUD (overlay caméra surveillance complet) ────────────
// Refonte 2026-05-15cc — auto-activé par le look "Caméra de sécurité".

interface SecurityCamHudProps {
  enabled: boolean
  /** Élément vidéo source pour synchroniser le timecode (optionnel). */
  videoEl?: HTMLVideoElement | null
  fps?: number
  /** Identifiant de caméra affiché (ex: "CAM 03 — ENTRÉE"). */
  camId?: string
  /** Canal vidéo (ex: 2). */
  channel?: number
}

export function SecurityCamHud({
  enabled, videoEl, fps = 25, camId = 'CAM 03 — ZONE A', channel = 2,
}: SecurityCamHudProps) {
  const [now, setNow] = React.useState(() => new Date())
  const [tcSec, setTcSec] = React.useState(0)
  const rafRef = React.useRef<number>(0)
  React.useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [enabled])
  React.useEffect(() => {
    if (!enabled || !videoEl) return
    function tick() {
      if (videoEl) setTcSec(videoEl.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [enabled, videoEl])
  if (!enabled) return null
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yyyy = String(now.getFullYear())
  const hh = String(now.getHours()).padStart(2, '0')
  const mn = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const total = Math.max(0, tcSec)
  const tcH = String(Math.floor(total / 3600)).padStart(2, '0')
  const tcM = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const tcS = String(Math.floor(total % 60)).padStart(2, '0')
  const tcF = String(Math.floor((total - Math.floor(total)) * fps)).padStart(2, '0')
  return (
    <div className="schud-root" aria-hidden>
      {/* TL — REC pulsant + identité caméra */}
      <div className="schud-tl">
        <div className="schud-rec">● REC</div>
        <div className="schud-cam-id">{camId}</div>
        <div className="schud-channel">CH {String(channel).padStart(2, '0')}</div>
      </div>
      {/* TR — date + heure */}
      <div className="schud-tr">
        <div>{`${dd}/${mm}/${yyyy}`}</div>
        <div>{`${hh}:${mn}:${ss}`}</div>
      </div>
      {/* BL — timecode + signal indicator */}
      <div className="schud-bl">
        <div>TC {`${tcH}:${tcM}:${tcS}:${tcF}`}</div>
        <div className="schud-signal">▮▮▮▮▯</div>
      </div>
      {/* BR — qualité signal + résolution */}
      <div className="schud-br">
        <div>720p · 25fps</div>
        <div className="schud-storage">HDD 64%</div>
      </div>
      {/* Crosshair central fin */}
      <svg className="schud-cross" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="48" y1="50" x2="52" y2="50" stroke="rgba(255,255,255,0.55)" strokeWidth="0.4" />
        <line x1="50" y1="48" x2="50" y2="52" stroke="rgba(255,255,255,0.55)" strokeWidth="0.4" />
      </svg>
      <style jsx>{`
        .schud-root {
          position: absolute; inset: 0; pointer-events: none; z-index: 11;
          font-family: 'Courier New', 'Consolas', monospace;
          font-weight: 700; color: #fff;
          text-shadow: 0 0 0.3rem rgba(0, 0, 0, 0.95), 0 0 0.15rem rgba(0, 0, 0, 0.9);
        }
        .schud-tl, .schud-tr, .schud-bl, .schud-br {
          position: absolute; padding: 0.45rem 0.7rem;
          font-size: 0.78rem; line-height: 1.25; letter-spacing: 0.06em;
        }
        .schud-tl { top: 0; left: 0; }
        .schud-tr { top: 0; right: 0; text-align: right; }
        .schud-bl { bottom: 0; left: 0; }
        .schud-br { bottom: 0; right: 0; text-align: right; }
        .schud-rec {
          color: #ff2d2d;
          text-shadow: 0 0 0.5rem rgba(255, 45, 45, 0.7), 0 0 0.3rem rgba(0, 0, 0, 0.9);
          animation: schud-rec-blink 1.2s steps(2, end) infinite;
          margin-bottom: 0.1rem;
        }
        @keyframes schud-rec-blink {
          0%, 50%   { opacity: 1; }
          50.01%, 100% { opacity: 0.25; }
        }
        .schud-cam-id { font-size: 0.72rem; opacity: 0.92; }
        .schud-channel { font-size: 0.7rem; opacity: 0.78; }
        .schud-signal { font-size: 0.72rem; color: #66ff7a; opacity: 0.85; }
        .schud-storage { font-size: 0.7rem; opacity: 0.78; }
        .schud-cross {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 4rem; height: 4rem; opacity: 0.85;
        }
      `}</style>
    </div>
  )
}

// ─── 13. MILITARY DRONE HUD (altitude + distance + coords + crosshair) ─────
// Refonte 2026-05-15cc — auto-activé par le look "Drone militaire".

interface MilitaryDroneHudProps {
  enabled: boolean
  videoEl?: HTMLVideoElement | null
  /** Couleur HUD (default vert tactique). */
  color?: 'green' | 'orange' | 'cyan'
}

export function MilitaryDroneHud({
  enabled, videoEl, color = 'green',
}: MilitaryDroneHudProps) {
  const [tcSec, setTcSec] = React.useState(0)
  const rafRef = React.useRef<number>(0)
  React.useEffect(() => {
    if (!enabled || !videoEl) return
    function tick() {
      if (videoEl) setTcSec(videoEl.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [enabled, videoEl])
  if (!enabled) return null
  const c = color === 'green' ? '#39ff14' : color === 'orange' ? '#ffa500' : '#00e6ff'
  // Données pseudo-tactiques qui évoluent dans le temps pour donner du vivant
  const totalSec = Math.max(0, tcSec)
  const altitude = Math.round(1247 + Math.sin(totalSec * 0.3) * 12)  // ALT m
  const targetDist = Math.round(384 - totalSec * 1.4)  // distance cible décroissante
  const heading = ((45 + totalSec * 0.8) % 360).toFixed(1)  // cap °
  const lat = (48.8566 + Math.sin(totalSec * 0.05) * 0.001).toFixed(4)
  const lon = (2.3522 + Math.cos(totalSec * 0.05) * 0.001).toFixed(4)
  const tcH = String(Math.floor(totalSec / 3600)).padStart(2, '0')
  const tcM = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')
  const tcS = String(Math.floor(totalSec % 60)).padStart(2, '0')
  return (
    <div className="mdhd-root" aria-hidden>
      {/* TL — Mission timer + ALT */}
      <div className="mdhd-tl">
        <div>MISSION T+{tcH}:{tcM}:{tcS}</div>
        <div>ALT {altitude}m AGL</div>
        <div>HDG {heading}°</div>
      </div>
      {/* TR — coordonnées GPS + status */}
      <div className="mdhd-tr">
        <div>LAT {lat}°N</div>
        <div>LON {lon}°E</div>
        <div className="mdhd-lock">● LOCK</div>
      </div>
      {/* BL — état drone */}
      <div className="mdhd-bl">
        <div>BATT 78%</div>
        <div>SIGNAL ▮▮▮▮▯</div>
      </div>
      {/* BR — distance cible */}
      <div className="mdhd-br">
        <div className="mdhd-tgt-label">TARGET</div>
        <div className="mdhd-tgt-dist">{Math.max(0, targetDist)}m</div>
      </div>
      {/* Crosshair tactique central */}
      <svg className="mdhd-crosshair" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
        {/* Brackets coins (style militaire) */}
        <path d="M 60 70 L 60 60 L 70 60" stroke={c} strokeWidth="2" fill="none" />
        <path d="M 130 60 L 140 60 L 140 70" stroke={c} strokeWidth="2" fill="none" />
        <path d="M 60 130 L 60 140 L 70 140" stroke={c} strokeWidth="2" fill="none" />
        <path d="M 130 140 L 140 140 L 140 130" stroke={c} strokeWidth="2" fill="none" />
        {/* Croix centrale fine */}
        <line x1="92" y1="100" x2="98" y2="100" stroke={c} strokeWidth="1.5" />
        <line x1="102" y1="100" x2="108" y2="100" stroke={c} strokeWidth="1.5" />
        <line x1="100" y1="92" x2="100" y2="98" stroke={c} strokeWidth="1.5" />
        <line x1="100" y1="102" x2="100" y2="108" stroke={c} strokeWidth="1.5" />
        {/* Point central */}
        <circle cx="100" cy="100" r="1.2" fill={c} />
        {/* Cercle externe LOCK */}
        <circle cx="100" cy="100" r="48" stroke={c} strokeWidth="0.8" fill="none" opacity="0.45" strokeDasharray="3 3" />
      </svg>
      <style jsx>{`
        .mdhd-root {
          position: absolute; inset: 0; pointer-events: none; z-index: 11;
          font-family: 'Courier New', 'Consolas', monospace;
          font-weight: 600; color: ${c};
          text-shadow: 0 0 0.3rem rgba(0, 0, 0, 0.95), 0 0 0.15rem rgba(0, 0, 0, 0.9);
        }
        .mdhd-tl, .mdhd-tr, .mdhd-bl, .mdhd-br {
          position: absolute; padding: 0.5rem 0.75rem;
          font-size: 0.76rem; line-height: 1.35; letter-spacing: 0.05em;
        }
        .mdhd-tl { top: 0; left: 0; }
        .mdhd-tr { top: 0; right: 0; text-align: right; }
        .mdhd-bl { bottom: 0; left: 0; }
        .mdhd-br { bottom: 0; right: 0; text-align: right; }
        .mdhd-lock {
          color: ${c};
          animation: mdhd-lock-blink 0.9s steps(2, end) infinite;
        }
        @keyframes mdhd-lock-blink {
          0%, 50%   { opacity: 1; }
          50.01%, 100% { opacity: 0.4; }
        }
        .mdhd-tgt-label { font-size: 0.65rem; opacity: 0.7; }
        .mdhd-tgt-dist { font-size: 1.05rem; font-weight: 800; }
        .mdhd-crosshair {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 14rem; height: 14rem;
          filter: drop-shadow(0 0 0.4rem ${c});
        }
      `}</style>
    </div>
  )
}

// ─── 11. NIGHT VISION OVERLAY (cercle vert, sans changer le shader) ────────

interface NightVisionOverlayProps {
  enabled: boolean
}

export function NightVisionOverlay({ enabled }: NightVisionOverlayProps) {
  if (!enabled) return null
  return (
    <div aria-hidden style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
      background: 'radial-gradient(circle at 50% 50%, rgba(57, 255, 20, 0.18) 0%, rgba(57, 255, 20, 0.1) 35%, rgba(0, 30, 0, 0.45) 75%, rgba(0, 0, 0, 0.85) 100%)',
      mixBlendMode: 'screen' as const,
    }} />
  )
}
