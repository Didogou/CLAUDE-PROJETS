'use client'
/**
 * ParticleLayer — système de particules canvas pour les calques « Atmosphère »
 * (pluie, neige, brouillard). Rendu 60 fps via requestAnimationFrame, **zéro
 * re-render React** pendant la boucle (le state est dans des refs).
 *
 * Chaque `kind` a sa propre logique de création / update / rendu :
 *   - rain : traits verticaux qui tombent vite, angle ajustable via vent
 *   - snow : cercles blancs qui tombent lentement en oscillant (sway sinus)
 *   - fog  : grosses blob radiales qui dérivent horizontalement
 *
 * Le canvas est dimensionné aux pixels d'affichage du parent (pas à la
 * résolution naturelle image) — la qualité visuelle est parfaite en 60 fps
 * et on économise énormément de VRAM.
 */
import React, { useEffect, useRef } from 'react'
import type { WeatherParams, WeatherBrushStroke, WeatherZone, WeatherRectShape, ImpactSurface, ImpactZoneEntry } from './types'

/** Liste effective des rectangles d'une zone : commits + draft (rect transitoire
 *  pendant le drag, ou legacy single-rect des anciens calques). Le draft est
 *  toujours considéré paint. Helper utilisé par tous les renderers zone-aware. */
function getEffectiveRects(z: WeatherZone): WeatherRectShape[] {
  const list: WeatherRectShape[] = z.rects ? [...z.rects] : []
  if (z.rect && Math.abs(z.rect.x2 - z.rect.x1) > 0.001 && Math.abs(z.rect.y2 - z.rect.y1) > 0.001) {
    list.push({ ...z.rect, mode: 'paint' })
  }
  return list
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
  // snow + fog : phase de l'oscillation sinusoïdale (mouvement horizontal/vertical)
  swayPhase?: number
  swayAmp?: number
  // fog-only : orientation du tendon (en radians) + vitesse angulaire
  rotation?: number
  rotationVel?: number
  // fog-only : phase + fréquence de la pulsation (taille + opacité breathing)
  pulsePhase?: number
  pulseRate?: number
  // rain : marqueur "cette goutte vient de toucher son impact, elle sera
  // remplacée au prochain tick". Permet de la rendre UN frame à la position
  // d'impact (trait s'arrêtant au centre de la zone) avant respawn.
  dying?: boolean
}

/** Impact d'une goutte (rain uniquement). Le rendu varie selon `surface` :
 *   - water : anneau qui s'étend (flaque)
 *   - hard  : éclat bref + gouttelettes éclatées (pavé/pierre)
 *   - soft  : rien de visible (absorption) */
interface Impact {
  x: number
  y: number
  age: number
  maxAge: number
  maxSize: number
  intensity: number
  angleRad: number
  aspect: number
  flash: boolean
  surface: ImpactSurface
  /** Multiplicateur d'opacité de la zone d'impact source (0-1, défaut 1). */
  opacity: number
}

/** Gouttelette d'éclaboussure — projection brève avec gravité. */
interface Splash {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  maxAge: number
  /** Multiplicateur d'opacité hérité de la zone d'impact (0-1, défaut 1). */
  opacity: number
}

/** Gouttelette absorbée — visible sur surface 'soft' (herbe, tissu).
 *  Reste affichée plusieurs secondes puis fade-out. La goutte ne rebondit pas,
 *  elle reste posée jusqu'à séchage. Cap FIFO pour éviter l'accumulation. */
interface AbsorbedDrop {
  x: number
  y: number
  /** Rayon en px (variation aléatoire pour rendu naturel). */
  radius: number
  age: number
  maxAge: number
  /** Variation d'opacité initiale (gouttes plus ou moins visibles). */
  baseAlpha: number
  /** Multiplicateur d'opacité hérité de la zone d'impact (0-1, défaut 1). */
  opacity: number
}

const ABSORBED_DROPS_MAX = 200  // cap FIFO pour éviter l'accumulation infinie

// NOTE : surface 'glass' n'est plus rendue par ParticleLayer depuis l'intégration
// de rainyday.js. Voir RainyDayGlassLayer (mounté en parallèle dans Canvas.tsx
// pour chaque ImpactZoneEntry de surface 'glass'). Tout le code maison glass
// (GlassDrop, updateGlassDrops, renderGlassDrops, applyGlassZonesClip,
// pickGlassSpawnPosition + constantes GLASS_*) a été supprimé.

interface ParticleLayerProps {
  weather: WeatherParams
  style: React.CSSProperties
}

// ── Sprites pré-rendus (soft-dot) pour snow et fog ──────────────────────
// Créés une seule fois, réutilisés via drawImage — bcp plus rapide que
// createRadialGradient() à chaque frame et plus organique qu'un arc dur.
let snowSprite: HTMLCanvasElement | null = null
let fogSprite: HTMLCanvasElement | null = null

function getSnowSprite(): HTMLCanvasElement {
  if (snowSprite) return snowSprite
  const size = 48
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // Plateau central dur + bordure qui fond → halo "pelucheux" type neige
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1)')
  grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.9)')
  grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.35)')
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  snowSprite = c
  return c
}

function getFogSprite(): HTMLCanvasElement {
  if (fogSprite) return fogSprite
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // Blob très fondu sur les bords — seule la zone centrale a de la densité
  grad.addColorStop(0.0, 'rgba(235, 235, 245, 0.85)')
  grad.addColorStop(0.5, 'rgba(235, 235, 245, 0.35)')
  grad.addColorStop(1.0, 'rgba(235, 235, 245, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  fogSprite = c
  return c
}

// Sprite nuage : core plus dense et plus étendu que le fog (cotton ball look).
// Blanc légèrement plus chaud (ton crème) pour un rendu diurne.
let cloudSprite: HTMLCanvasElement | null = null
function getCloudSprite(): HTMLCanvasElement {
  if (cloudSprite) return cloudSprite
  const size = 160
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // Plateau central large et opaque, transition plus franche que le fog
  // → volumes "cotonneux" plutôt que "vapoureux".
  grad.addColorStop(0.0, 'rgba(252, 250, 245, 0.95)')
  grad.addColorStop(0.35, 'rgba(250, 248, 242, 0.75)')
  grad.addColorStop(0.7, 'rgba(245, 243, 238, 0.3)')
  grad.addColorStop(1.0, 'rgba(240, 238, 232, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  cloudSprite = c
  return c
}

export default function ParticleLayer({ weather, style }: ParticleLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** Params dans une ref pour que la boucle RAF lise toujours la valeur
   *  courante sans recréer les particules à chaque changement de slider. */
  const weatherRef = useRef(weather)
  weatherRef.current = weather
  const particlesRef = useRef<Particle[]>([])
  /** Impacts au sol (anneaux concentriques qui grandissent). Remplis quand
   *  une goutte de pluie atteint le niveau du sol. */
  const impactsRef = useRef<Impact[]>([])
  /** Gouttelettes d'éclaboussure — spawn à chaque impact si `impactSplash`. */
  const splashesRef = useRef<Splash[]>([])
  /** Gouttelettes absorbées sur surface 'soft' — restent posées plusieurs
   *  secondes puis fade. Cap FIFO à ABSORBED_DROPS_MAX. */
  const absorbedDropsRef = useRef<AbsorbedDrop[]>([])
  /** Canvas offscreen pour le masque brush (réutilisé chaque frame → allocation
   *  unique par instance de ParticleLayer, pas de conflit entre calques). */
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const parent = canvas.parentElement
    if (!parent) return

    let rafId = 0
    let lastTime = performance.now()

    function tick(now: number) {
      if (!canvas || !ctx || !parent) return
      const dt = Math.min(0.05, (now - lastTime) / 1000)   // clamp dt (tab switch protection)
      lastTime = now

      // Resize canvas si le parent a changé (redimensionnement des panneaux)
      const pw = parent.clientWidth
      const ph = parent.clientHeight
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
      }
      const w = canvas.width, h = canvas.height

      // Guard global : si dimensions 0 (parent pas encore monté/sized),
      // on skip tout le rendu pour éviter InvalidStateError sur drawImage
      // d'un canvas 0×0 (mask brush, trail glass, etc.).
      if (w <= 0 || h <= 0) {
        rafId = requestAnimationFrame(tick)
        return
      }

      const p = weatherRef.current
      adjustParticleCount(particlesRef.current, p, w, h)
      updateParticles(
        particlesRef.current, p, dt, w, h,
        impactsRef.current, splashesRef.current, absorbedDropsRef.current,
      )
      updateImpactsAndSplashes(impactsRef.current, splashesRef.current, dt)
      updateAbsorbedDrops(absorbedDropsRef.current, dt)

      // Clear full canvas d'abord (les particules précédentes). Le rendu
      // suivant applique le clip éventuel (rect ou brush) sans repeindre
      // les zones hors zone.
      ctx.clearRect(0, 0, w, h)
      const zone = p.zone

      // Helper : rend particules + impacts + splashes + gouttelettes
      // absorbées dans le ctx courant.
      //
      // Ordre important pour le masquage 2026-04-25 :
      //   1. Particules (pluie en mouvement)
      //   2. Impact zones mask (destination-out) → efface les particules
      //      dans les zones d'impact (le sol/herbe agit comme un masque
      //      qui bloque la pluie traversante)
      //   3. Impacts (anneaux water, éclats hard) → re-dessinés par-dessus
      //   4. Splashes (éclaboussures)
      //   5. Gouttelettes absorbées (perles posées sur l'herbe)
      const effectiveImpactZones = (p.impactZones && p.impactZones.length > 0)
        ? p.impactZones
        : p.impactZone ? [{ id: 'legacy', surface: 'water' as const, zone: p.impactZone }] : []
      const renderAll = () => {
        renderParticles(ctx, particlesRef.current, p)
        applyImpactZonesMask(ctx, effectiveImpactZones, w, h)
        renderImpacts(ctx, impactsRef.current)
        renderSplashes(ctx, splashesRef.current)
        renderAbsorbedDrops(ctx, absorbedDropsRef.current)
        // Surface 'glass' : rendue séparément par RainyDayGlassLayer
        // (mounté en parallèle dans Canvas.tsx). Pas de rendu ici.
      }

      // Mode 'full' (ou rect/brush sans donnée) → plein canvas. Sinon, on
      // construit un mask composite (tous les rects[] + tous les strokes) et
      // on coupe le rendu particules avec en 'destination-in'.
      const effRects = getEffectiveRects(zone)
      const hasRectsAny = effRects.length > 0
      const hasStrokes = !!zone.strokes && zone.strokes.some(s => s.points.length > 0)
      if (zone.mode === 'full' || (!hasRectsAny && !hasStrokes)) {
        renderAll()
      } else {
        // Render plein écran puis appliquer le mask pour clipper aux zones définies.
        renderAll()
        if (!maskCanvasRef.current) maskCanvasRef.current = document.createElement('canvas')
        const mask = maskCanvasRef.current
        mask.width = Math.max(1, Math.floor(w))
        mask.height = Math.max(1, Math.floor(h))
        const mctx = mask.getContext('2d')
        if (mctx) {
          mctx.clearRect(0, 0, w, h)
          // Passe 1 : tous les rects (paint = remplit blanc, erase = découpe)
          for (const r of effRects) {
            const rx = Math.min(r.x1, r.x2) * w
            const ry = Math.min(r.y1, r.y2) * h
            const rw = Math.abs(r.x2 - r.x1) * w
            const rh = Math.abs(r.y2 - r.y1) * h
            mctx.globalCompositeOperation = r.mode === 'erase' ? 'destination-out' : 'source-over'
            mctx.fillStyle = r.mode === 'erase' ? '#000' : '#fff'
            mctx.fillRect(rx, ry, rw, rh)
          }
          // Passe 2 : strokes pinceau (paint additif, erase soustractif)
          if (zone.strokes) {
            const scale = Math.min(w, h)
            for (const stroke of zone.strokes) {
              if (stroke.points.length === 0) continue
              const r = Math.max(1, stroke.radius * scale)
              mctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'
              mctx.fillStyle = stroke.mode === 'erase' ? '#000' : '#fff'
              for (const pt of stroke.points) {
                mctx.beginPath()
                mctx.arc(pt.x * w, pt.y * h, r, 0, Math.PI * 2)
                mctx.fill()
              }
            }
          }
        }
        // Applique : ne garde que les pixels du canvas principal qui sont sous
        // les zones blanches du mask.
        ctx.save()
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(mask, 0, 0)
        ctx.restore()
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
    // Effet unique — le RAF prend les params en live via weatherRef.
  }, [])

  return <canvas ref={canvasRef} style={style} />
}

// ── Particle system ────────────────────────────────────────────────────

/** Ajuste la taille du tableau pour matcher la density cible. Recycle les
 *  particules existantes plutôt que recréer tout (meilleur pour la perf).
 *
 *  Cas spécial brush mode + strokes vides : on garde 0 particule. Sinon, au
 *  premier frame on spawnerait des particules sur toute l'image (bbox =
 *  full canvas en l'absence de strokes), elles seraient clippées invisibles
 *  quand l'utilisateur commence à peindre, et mettraient plusieurs minutes
 *  à respawn dans la zone peinte. Résultat attendu par l'utilisateur :
 *  "je peins et je vois rien". */
function adjustParticleCount(arr: Particle[], p: WeatherParams, w: number, h: number) {
  // Mode rect/brush sans aucune donnée tracée : pas de spawn (sinon les
  // particules apparaissent puis sont clippées invisibles quand l'utilisateur
  // commence à tracer). Seul le mode 'full' explicite spawn sans zone.
  const z = p.zone
  if (z.mode !== 'full') {
    const hasPaintRect = getEffectiveRects(z).some(r => r.mode === 'paint')
    const hasStrokes = !!z.strokes && z.strokes.some(s => s.mode === 'paint' && s.points.length > 0)
    if (!hasPaintRect && !hasStrokes) {
      if (arr.length > 0) arr.length = 0
      return
    }
  }
  const target = Math.max(0, Math.floor(p.density))
  while (arr.length < target) arr.push(createParticle(p, w, h, true))
  if (arr.length > target) arr.length = target
}

/** Bounds de spawn/respawn en pixels canvas, selon la zone. Compose rect ET
 * strokes (l'utilisateur peut combiner les deux). 'full' (ou rect/brush sans
 * donnée) = plein canvas. Sinon = union des bbox du rect (si défini) et de
 * la bbox des strokes 'paint' (les 'erase' ne contribuent pas à étendre). */
function getSpawnBounds(p: WeatherParams, w: number, h: number) {
  const z = p.zone
  if (z.mode === 'full') return { x1: 0, y1: 0, x2: w, y2: h }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  // Tous les rects[] paint contribuent à la bbox d'union.
  for (const r of getEffectiveRects(z)) {
    if (r.mode !== 'paint') continue
    const rx1 = Math.min(r.x1, r.x2) * w, rx2 = Math.max(r.x1, r.x2) * w
    const ry1 = Math.min(r.y1, r.y2) * h, ry2 = Math.max(r.y1, r.y2) * h
    minX = Math.min(minX, rx1); minY = Math.min(minY, ry1)
    maxX = Math.max(maxX, rx2); maxY = Math.max(maxY, ry2)
  }
  if (z.strokes && z.strokes.length > 0) {
    const scale = Math.min(w, h)
    for (const stroke of z.strokes) {
      // Seuls les strokes 'paint' contribuent à l'aire visible.
      if (stroke.mode !== 'paint') continue
      const radiusPx = stroke.radius * scale
      for (const pt of stroke.points) {
        const x = pt.x * w
        const y = pt.y * h
        if (x - radiusPx < minX) minX = x - radiusPx
        if (y - radiusPx < minY) minY = y - radiusPx
        if (x + radiusPx > maxX) maxX = x + radiusPx
        if (y + radiusPx > maxY) maxY = y + radiusPx
      }
    }
  }
  if (minX === Infinity) {
    // Mode rect/brush sans donnée valide → fallback plein canvas (évite
    // d'avoir 0 spawn ; comportement attendu = "comme full tant que pas tracé")
    return { x1: 0, y1: 0, x2: w, y2: h }
  }
  return {
    x1: Math.max(0, minX),
    y1: Math.max(0, minY),
    x2: Math.min(w, maxX),
    y2: Math.min(h, maxY),
  }
}

/** Multiplicateurs de perspective atmosphérique basés sur la position Y.
 *
 *   t = 0 (haut de zone) → lointain : size ×(1-0.45·s), speed ×(1-0.4·s), opacity ×(1-0.3·s)
 *   t = 1 (bas de zone)  → proche   : size ×(1+0.45·s), speed ×(1+0.4·s), opacity ×(1+0.2·s)
 *
 * Les multiplicateurs sont appliqués à la CRÉATION de la particule → elle garde
 * son identité (taille, opacité) pendant toute sa vie. Pour la vitesse, vx/vy
 * sont modifiés à la création → pas de changement de trajectoire en cours de vie.
 * Le rendu d'ensemble donne l'illusion d'une population à différentes distances. */
function getDepthMultipliers(p: WeatherParams, y: number, b: { y1: number; y2: number }) {
  if (!p.depthEnabled) return { size: 1, speed: 1, opacity: 1 }
  // Clamp defensif : depthStrength doit être dans [0, 1] (slider UI le garantit
  // mais données importées pourraient contenir n'importe quoi → particles taille
  // négative = crash canvas).
  const s = Math.max(0, Math.min(1, p.depthStrength ?? 0.5))
  const range = Math.max(1, b.y2 - b.y1)
  const t = Math.max(0, Math.min(1, (y - b.y1) / range))
  // Chaque paramètre a son amplitude de variation. t=0.5 → multiplicateur = 1 (neutre).
  // size : amplitude 0.9 centrée → 0.55 ↔ 1.45 (à s=1)
  // speed : amplitude 0.8 → 0.60 ↔ 1.40
  // opacity : amplitude 0.5 → 0.75 ↔ 1.25 (moins agressive, évite les fantômes)
  return {
    size: Math.max(0.1, 1 + s * (t - 0.5) * 0.9),      // size >= 0.1 → jamais 0 ou négatif
    speed: 1 + s * (t - 0.5) * 0.8,
    opacity: Math.max(0, 1 + s * (t - 0.5) * 0.5),     // opacity >= 0
  }
}

function createParticle(p: WeatherParams, w: number, h: number, initialSpawn: boolean): Particle {
  const angleRad = (p.angle * Math.PI) / 180
  const b = getSpawnBounds(p, w, h)
  const bw = Math.max(1, b.x2 - b.x1)
  const bh = Math.max(1, b.y2 - b.y1)
  switch (p.kind) {
    case 'rain': {
      // Base 450-750 px/s — ressemble à de la pluie d'ambiance, pas à une
      // averse furieuse. Le multiplicateur `p.speed` permet d'accélérer
      // vers l'orage (1.5×) ou de ralentir vers la bruine (0.3×).
      const baseSpeed = 450 + Math.random() * 300
      // Initial spawn : partout dans la zone. Respawn : bande juste au-dessus
      // de la zone (petit offset pour que l'entrée semble organique).
      const spawnY = initialSpawn ? b.y1 + Math.random() * bh : b.y1 - 20
      const d = getDepthMultipliers(p, spawnY, b)
      const vx = Math.sin(angleRad) * baseSpeed * p.speed * d.speed
      const vy = Math.cos(angleRad) * baseSpeed * p.speed * d.speed
      return {
        x: b.x1 + Math.random() * bw,
        y: spawnY,
        vx, vy,
        size: (1 + Math.random() * 1.2) * d.size,
        opacity: (0.5 + Math.random() * 0.4) * d.opacity,
      }
    }
    case 'snow': {
      const baseSpeed = 40 + Math.random() * 100
      const spawnY = initialSpawn ? b.y1 + Math.random() * bh : b.y1 - 10
      const d = getDepthMultipliers(p, spawnY, b)
      return {
        x: b.x1 + Math.random() * bw,
        y: spawnY,
        vx: Math.sin(angleRad) * baseSpeed * p.speed * 0.4 * d.speed,
        vy: baseSpeed * p.speed * d.speed,
        size: (2 + Math.random() * 5) * d.size,
        opacity: (0.55 + Math.random() * 0.4) * d.opacity,
        swayPhase: Math.random() * Math.PI * 2,
        swayAmp: 8 + Math.random() * 25,
      }
    }
    case 'fog': {
      // Brouillard : volutes qui entrent par le bord GAUCHE (ou DROIT si reverse)
      // de la zone. Angle = inclinaison verticale de la dérive (-30 = monte légèrement,
      // +30 = descend). Direction horizontale via `reverse`.
      const spawnY = b.y1 + Math.random() * bh
      const d = getDepthMultipliers(p, spawnY, b)
      const dirSign = p.reverse ? -1 : 1
      const incRad = (p.angle * Math.PI) / 180
      const speedMag = (12 + Math.random() * 22) * p.speed * d.speed
      return {
        x: initialSpawn
          ? b.x1 + Math.random() * bw
          : dirSign > 0 ? b.x1 - 60 : b.x2 + 60,
        y: spawnY,
        vx: dirSign * Math.cos(incRad) * speedMag,
        vy: Math.sin(incRad) * speedMag,
        size: (140 + Math.random() * 240) * d.size,
        opacity: (0.4 + Math.random() * 0.35) * d.opacity,
        rotation: (Math.random() - 0.5) * 0.7,
        rotationVel: (Math.random() - 0.5) * 0.2,
        swayPhase: Math.random() * Math.PI * 2,
        swayAmp: 20 + Math.random() * 30,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseRate: 0.25 + Math.random() * 0.35,
      }
    }
    case 'cloud': {
      // Nuages : gros amas qui traversent le ciel HORIZONTALEMENT uniquement.
      //   - PAS de rotation (physique absurde)
      //   - PAS de sway Y (retiré dans updateParticles)
      //   - PAS de pulsation (user feedback : trop visible)
      //   - Aspect 1.6:1 préservé → étirement naturel en entrée/sortie du
      //     mask grâce au feather (effet "queue de nuage")
      //
      // Size scalée à la taille de la zone (brush mode) pour que le nuage
      // soit visiblement en mouvement dans un mask pinceau petit.
      const spawnY = b.y1 + Math.random() * bh
      const d = getDepthMultipliers(p, spawnY, b)
      const dirSign = p.reverse ? -1 : 1
      const incRad = (p.angle * Math.PI) / 180
      const speedMag = (5 + Math.random() * 12) * p.speed * d.speed
      const zoneScale = Math.min(1, Math.min(bw, bh) / 600)
      // Respawn staggered : chaque nuage qui respawn a un offset X aléatoire
      // 20-200 px avant la bbox → ils ne reviennent PAS tous en bloc (évite
      // l'effet "un gros paquet passe une fois puis plus rien").
      const respawnOffset = 20 + Math.random() * 180
      return {
        x: initialSpawn
          ? b.x1 + Math.random() * bw
          : dirSign > 0 ? b.x1 - respawnOffset : b.x2 + respawnOffset,
        y: spawnY,
        vx: dirSign * Math.cos(incRad) * speedMag,
        vy: Math.sin(incRad) * speedMag,
        size: (240 + Math.random() * 260) * d.size * zoneScale,
        opacity: (0.55 + Math.random() * 0.3) * d.opacity,
      }
    }
    default:
      // 'lightning' n'est pas géré ici (rendu par LightningEffect séparément)
      // mais TS ne le sait pas → fallback minimal pour satisfaire l'exhaustivité.
      throw new Error(`createParticle: kind non géré (${p.kind})`)
  }
}

function updateParticles(
  arr: Particle[],
  p: WeatherParams,
  dt: number,
  w: number,
  h: number,
  impacts?: Impact[],
  splashes?: Splash[],
  absorbedDrops?: AbsorbedDrop[],
) {
  const b = getSpawnBounds(p, w, h)
  // Pluie + impacts activés. Deux modes de détection :
  //
  //   (1) Sans impactZones (liste vide) : la goutte déclenche un impact
  //       "water" quand elle dépasse groundYPx (ligne horizontale). Comportement
  //       par défaut — aucune zone spécifique = pluie qui touche le sol partout.
  //
  //   (2) Avec impactZones : détection d'ENTRÉE dans CHAQUE zone, avec
  //       effet visuel selon le type de surface (water/hard/soft).
  //       Migration : si `impactZone` (legacy, singulier) est défini et
  //       `impactZones` vide, on le convertit en une zone water.
  const impactEnabled = p.kind === 'rain' && p.impactEnabled && impacts
  const groundYPx = impactEnabled ? b.y1 + (p.impactGroundY ?? 1.0) * (b.y2 - b.y1) : null
  // Résout la liste effective de zones (migration du champ legacy `impactZone`).
  const effectiveZones: ImpactZoneEntry[] = !impactEnabled ? [] :
    (p.impactZones && p.impactZones.length > 0)
      ? p.impactZones
      : p.impactZone
        ? [{ id: 'legacy', surface: 'water', zone: p.impactZone }]
        : []
  const useZoneEntry = impactEnabled && effectiveZones.length > 0
  for (let i = 0; i < arr.length; i++) {
    const part = arr[i]
    // Goutte "dying" = vient d'impacter au frame précédent → on l'a affichée
    // à la position centre/sol avec son trait, maintenant on la remplace
    // (respawn au top de la zone). La nouvelle goutte reprend son cycle normal.
    if (part.dying) {
      arr[i] = createParticle(p, w, h, false)
      continue
    }
    // Sauvegarde position précédente pour détection d'entrée dans la zone
    const prevX = part.x
    const prevY = part.y
    part.x += part.vx * dt
    part.y += part.vy * dt

    // Détection d'impact — pluie uniquement
    let shouldSpawn = false
    let impactX = 0, impactY = 0
    let impactSurface: ImpactSurface = 'water'
    let matchedEntry: ImpactZoneEntry | null = null
    if (impactEnabled) {
      if (useZoneEntry) {
        // Mode multi-zones : on cherche la PREMIÈRE zone NON-GLASS dans laquelle
        // la goutte vient d'entrer (transition outside → inside). Les zones
        // glass sont SAUTÉES dans la détection : la pluie traverse la vitre
        // sans être consommée — sinon les gouttes mourraient sur la vitre et
        // n'atteindraient jamais une flaque positionnée plus bas. Le rendu
        // visuel des gouttes-sur-vitre est délégué à RainyDayGlassLayer
        // (canvas séparé), qui ne dépend pas des particules ParticleLayer.
        for (const entry of effectiveZones) {
          if (entry.zone.mode === 'full') continue  // 'full' ne participe pas à la détection d'entrée
          if (entry.surface === 'glass') continue   // glass = traversée libre
          const prevIn = isPointInZone(entry.zone, prevX, prevY, w, h)
          const currIn = isPointInZone(entry.zone, part.x, part.y, w, h)
          if (currIn && !prevIn) {
            shouldSpawn = true
            impactX = part.x
            impactY = getImpactYAtX(entry.zone, part.x, w, h, part.y)
            impactSurface = entry.surface
            matchedEntry = entry
            part.y = impactY
            part.vx = 0
            part.vy = 0
            part.dying = true
            break
          }
        }
      } else if (groundYPx !== null && part.y >= groundYPx) {
        // Mode fallback : pas de zones définies, on utilise la ligne groundY
        // avec une surface water par défaut.
        shouldSpawn = true
        impactX = part.x
        impactY = groundYPx
        impactSurface = 'water'
        part.y = groundYPx
        part.vx = 0
        part.vy = 0
        part.dying = true
      }
    }

    if (shouldSpawn) {
      const angleRad = (p.angle * Math.PI) / 180
      // Résout les params de l'impact en priorité sur la zone matchée, puis
      // sur les champs legacy de WeatherParams (migration), puis défauts.
      // Clamps defensifs : NaN/Infinity dans la data (import/migration) →
      // maxAge deviendrait NaN → t=NaN → ellipse plantée au rendu.
      const rawSize = matchedEntry?.size ?? p.impactSize ?? 16
      const rawIntensity = matchedEntry?.intensity ?? p.impactIntensity ?? 0.7
      const size = Number.isFinite(rawSize) ? Math.max(1, rawSize) : 16
      const intensity = Number.isFinite(rawIntensity) ? Math.max(0.05, Math.min(1, rawIntensity)) : 0.7
      const splash = matchedEntry?.splash ?? p.impactSplash ?? false
      const flash = matchedEntry?.flash ?? p.impactFlash ?? false

      // Surface 'glass' filtrée en amont dans la boucle de détection : la pluie
      // traverse la vitre sans matcher, ne tue pas la goutte. Donc impactSurface
      // ici est forcément water/hard/soft.

      // Opacity per-zone : multiplie l'alpha au rendu de chaque effet visuel
      // (anneaux, éclats, gouttelettes). Permet à l'utilisateur de moduler
      // la visibilité d'une zone indépendamment de sa intensity (qui contrôle
      // taille + durée). Lecture : opacity (nouveau, générique) avec fallback
      // sur glassOpacity (legacy) pour les anciens calques migrés.
      const zoneOpacity = matchedEntry?.opacity ?? matchedEntry?.glassOpacity ?? 1

      impacts!.push({
        x: impactX,
        y: impactY,
        age: 0,
        maxAge: 0.45 * intensity + 0.25,
        maxSize: size,
        intensity,
        angleRad,
        aspect: 1 + Math.abs(Math.sin(angleRad)) * 1.3,
        flash,
        surface: impactSurface,
        opacity: zoneOpacity,
      })

      // Surface 'soft' : créer une (ou plusieurs si splash activé) gouttelette
      // persistante (humidité absorbée visible sur l'herbe / tissu).
      //
      // Câblage 2026-04-25 :
      //   - `size`      → multiplie le rayon de base de la gouttelette
      //   - `intensity` → multiplie le baseAlpha (gouttes plus/moins visibles)
      //   - `splash`    → si activé, crée 2-3 gouttes par impact avec dispersion
      //                   plus large (simulation projection mouillante)
      //   - `flash`     → ignoré (pas applicable à soft, par défaut sensible)
      if (impactSurface === 'soft' && absorbedDrops) {
        // Facteur taille : size de la zone (5-50) → multiplicateur 0.7-1.6
        // (minimum 0.7 pour rester visible même avec slider Size bas)
        const sizeFactor = Math.max(0.7, Math.min(1.6, size / 16))
        // Facteur intensité : sqrt pour adoucir l'effet (intensity bas ne tue
        // pas la visibilité, intensity haut booste un peu).
        const intensityFactor = Math.max(0.5, Math.sqrt(intensity))
        // Nombre de drops : 1 par défaut, 2-3 si splash activé
        const dropCount = splash ? 2 + Math.floor(Math.random() * 2) : 1
        // Dispersion : élargie si splash activé
        const dispersion = splash ? 12 : 4
        for (let k = 0; k < dropCount; k++) {
          const jitterX = (Math.random() - 0.5) * dispersion
          const jitterY = (Math.random() - 0.5) * dispersion * 0.7
          absorbedDrops.push({
            x: impactX + jitterX,
            y: impactY + jitterY,
            radius: (0.9 + Math.random() * 1.1) * sizeFactor,
            age: 0,
            maxAge: 3 + Math.random() * 2.5,                              // 3 → 5.5 s
            baseAlpha: (0.16 + Math.random() * 0.14) * intensityFactor,   // proportionnel à intensity
            opacity: zoneOpacity,
          })
        }
        // Cap FIFO : si on dépasse, on retire les plus vieilles
        if (absorbedDrops.length > ABSORBED_DROPS_MAX) {
          absorbedDrops.splice(0, absorbedDrops.length - ABSORBED_DROPS_MAX)
        }
      }
      // Éclaboussures : uniquement si `splash` activé ET surface != soft.
      //   - water : gouttelettes qui montent verticalement puis retombent
      //   - hard  : plus nombreuses, plus dispersées latéralement (splatter)
      //   - soft  : aucune (absorbé)
      if (splash && splashes && impactSurface !== 'soft') {
        const count = impactSurface === 'hard' ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2)
        for (let j = 0; j < count; j++) {
          const vyMag = impactSurface === 'hard' ? 40 + Math.random() * 80 : 90 + Math.random() * 70
          const vxSpread = impactSurface === 'hard' ? 280 : 140
          splashes.push({
            x: impactX + (Math.random() - 0.5) * 4,
            y: impactY,
            vx: (Math.random() - 0.5) * vxSpread + Math.sin(angleRad) * 40,
            vy: -vyMag,
            age: 0,
            maxAge: impactSurface === 'hard' ? 0.2 + Math.random() * 0.12 : 0.3 + Math.random() * 0.15,
            opacity: zoneOpacity,
          })
        }
      }
      // On ne remplace PAS la goutte ici : elle est marquée `dying` et sera
      // remplacée au prochain tick. Ce frame-ci, elle est rendue à la
      // position d'impact (centre de zone ou groundY) avec son trait qui
      // se termine pile là → lecture visuelle "la goutte finit sa course".
      continue
    }
    if (p.kind === 'snow' && part.swayPhase !== undefined && part.swayAmp !== undefined) {
      part.swayPhase += 1.8 * dt
      part.x += Math.sin(part.swayPhase) * part.swayAmp * dt
    } else if (p.kind === 'fog') {
      // Brouillard : ondulation verticale (sway) + rotation continue +
      // cadence propre pour la pulsation (taille/opacité dans le render).
      if (part.swayPhase !== undefined && part.swayAmp !== undefined) {
        part.swayPhase += 0.3 * dt * Math.PI * 2
        part.y += Math.sin(part.swayPhase) * part.swayAmp * dt
      }
      if (part.rotationVel !== undefined) {
        part.rotation = (part.rotation ?? 0) + part.rotationVel * dt
      }
      if (part.pulsePhase !== undefined && part.pulseRate !== undefined) {
        part.pulsePhase += part.pulseRate * dt * Math.PI * 2
      }
    } else if (p.kind === 'cloud') {
      // Nuages : PAS de sway vertical (physiquement absurde — un nuage ne
      // monte/descend pas tout seul). Seul `angle` (inclinaison) peut produire
      // du vertical si l'utilisateur le décide. On garde rotation + pulsation
      // pour la vie visuelle (dérive angulaire et respiration).
      if (part.rotationVel !== undefined) {
        part.rotation = (part.rotation ?? 0) + part.rotationVel * dt
      }
      if (part.pulsePhase !== undefined && part.pulseRate !== undefined) {
        part.pulsePhase += part.pulseRate * dt * Math.PI * 2
      }
    }
    // Respawn quand sorti des bounds effectifs (= zone en mode 'rect' sinon canvas).
    // Évite que les particules errent longtemps hors zone avant d'y revenir.
    // (b est déjà calculé en tête de la fonction — pas de redéclaration.)
    // Marge de respawn plus serrée en mode brush (la bbox est déjà tight → pas
    // besoin de 200 px de margin). 200 en full/rect est OK car on veut laisser
    // les particules sortir proprement avant respawn sur les grands cadres.
    const edgeMargin = p.zone.mode === 'brush' ? 50 : 200
    const outBottom = part.y > b.y2 + 20
    const outRight = part.x > b.x2 + edgeMargin
    const outLeft = part.x < b.x1 - edgeMargin
    if (p.kind === 'fog' || p.kind === 'cloud') {
      if (outRight || outLeft) {
        const newP = createParticle(p, w, h, false)
        // Pour les nuages : on préserve la Y track du nuage sortant (avec
        // un léger bruit ±10 px) → évite l'illusion d'un nuage qui "monte
        // ou descend" quand un successeur apparaît à une hauteur différente.
        if (p.kind === 'cloud') {
          newP.y = part.y + (Math.random() - 0.5) * 20
        }
        arr[i] = newP
      }
    } else if (outBottom || outRight || outLeft) {
      arr[i] = createParticle(p, w, h, false)
    }
  }
}

function renderParticles(ctx: CanvasRenderingContext2D, arr: Particle[], p: WeatherParams) {
  // NB : le clear est fait par le caller (tick) AVANT d'appliquer le clip,
  // donc pas de clearRect ici — sinon on effacerait le contenu CLIPPED.
  const angleRad = (p.angle * Math.PI) / 180
  switch (p.kind) {
    case 'rain': {
      // Traits orientés selon la vitesse pour un effet « vitesse ». Longueur
      // ajustable via `trailLength` (défaut 14 px) : court = drizzle, long
      // = pluie cinéma avec motion blur prononcé.
      const tailLen = p.trailLength ?? 14
      const tdx = Math.sin(angleRad) * tailLen
      const tdy = Math.cos(angleRad) * tailLen
      ctx.strokeStyle = '#E8F0FF'
      ctx.lineCap = 'round'
      for (const part of arr) {
        // Guard : lineWidth doit être > 0 (sinon canvas error sur certains browsers).
        ctx.globalAlpha = Math.max(0, Math.min(1, part.opacity))
        ctx.lineWidth = Math.max(0.1, part.size)
        ctx.beginPath()
        ctx.moveTo(part.x, part.y)
        ctx.lineTo(part.x - tdx, part.y - tdy)
        ctx.stroke()
      }
      break
    }
    case 'snow': {
      // Sprite pré-rendu (halo doux) — chaque flocon = drawImage scalé.
      // `size` est le rayon visuel, on dessine à 2.4× la taille pour laisser
      // de la place au halo du gradient sans perdre de densité visuelle.
      const sprite = getSnowSprite()
      for (const part of arr) {
        ctx.globalAlpha = part.opacity
        const draw = part.size * 2.4
        ctx.drawImage(sprite, part.x - draw / 2, part.y - draw / 2, draw, draw)
      }
      break
    }
    case 'fog': {
      // Sprite blob pré-rendu, dessiné ÉTIRÉ horizontalement (2.4:1), avec
      // rotation propre à chaque volute ET pulsation vivante :
      //   - taille ±12 % sur le cycle pulsePhase → la volute "respire"
      //   - opacité ±12 % décalée de 1.3× en phase → flicker léger non-sync
      // Chaque volute a sa propre cadence → lecture organique, pas robotique.
      const sprite = getFogSprite()
      for (const part of arr) {
        const pulse = part.pulsePhase !== undefined ? Math.sin(part.pulsePhase) : 0
        const flicker = part.pulsePhase !== undefined ? Math.sin(part.pulsePhase * 1.3) : 0
        const sizeMul = 1 + 0.12 * pulse
        const opacityMul = 0.88 + 0.12 * flicker
        ctx.globalAlpha = part.opacity * opacityMul
        const drawW = part.size * 2.4 * sizeMul
        const drawH = part.size * 1.0 * sizeMul
        ctx.save()
        ctx.translate(part.x, part.y)
        if (part.rotation) ctx.rotate(part.rotation)
        ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH)
        ctx.restore()
      }
      break
    }
    case 'cloud': {
      // Nuages : sprite cotonneux, étirement 1.6:1 (masses solides). Pas de
      // pulsation (un nuage réel ne "respire" pas — c'est le brouillard qui
      // fait ça). Pas de rotation (physique absurde). Les étirements subtils
      // en entrée/sortie viennent du feather du mask, pas de transformations
      // artificielles.
      const sprite = getCloudSprite()
      for (const part of arr) {
        ctx.globalAlpha = part.opacity
        const drawW = part.size * 1.6
        const drawH = part.size * 1.0
        ctx.drawImage(sprite, part.x - drawW / 2, part.y - drawH / 2, drawW, drawH)
      }
      break
    }
  }
  ctx.globalAlpha = 1
}

/**
 * Applique un masque peint à la main sur le canvas des particules.
 *
 * Approche en 2 passes pour que les strokes s'UNISSENT (pas intersection) :
 *   1. Construit le mask complet sur un canvas offscreen : paint = white
 *      opaque (source-over → union), erase = effacement (destination-out →
 *      soustraction). Ordre chronologique respecté.
 *   2. Applique ce mask UNE seule fois au canvas visible via `destination-in` →
 *      seuls les pixels de particules sous une zone paint survivent.
 *
 * ⚠ Appliquer `destination-in` par stroke (ancienne version) produisait une
 * INTERSECTION : 2 zones disjointes → mask vide → aucune particule visible.
 */
function applyBrushMask(
  ctx: CanvasRenderingContext2D,
  strokes: WeatherBrushStroke[],
  w: number,
  h: number,
  maskCanvas: HTMLCanvasElement,
) {
  if (maskCanvas.width !== w) maskCanvas.width = w
  if (maskCanvas.height !== h) maskCanvas.height = h
  const mctx = maskCanvas.getContext('2d')
  if (!mctx) return
  mctx.clearRect(0, 0, w, h)

  const scale = Math.min(w, h)
  // Feather proportionnel au plus GROS pinceau utilisé → les bords du masque
  // se dissolvent sur une distance cohérente avec la taille du stroke.
  // Évite l'effet "rectangle de brume tranché" quand on peint une bande
  // et que les volutes de fog (140-380 px) sont clippées net.
  const maxRadius = strokes.reduce((m, s) => Math.max(m, s.radius), 0)
  const featherPx = Math.max(4, Math.min(80, maxRadius * scale * 0.35))

  for (const stroke of strokes) {
    const radiusPx = Math.max(1, stroke.radius * scale)
    mctx.lineWidth = radiusPx * 2
    mctx.lineCap = 'round'
    mctx.lineJoin = 'round'
    if (stroke.mode === 'paint') {
      mctx.globalCompositeOperation = 'source-over'
      mctx.strokeStyle = '#FFFFFF'
      mctx.fillStyle = '#FFFFFF'
    } else {
      mctx.globalCompositeOperation = 'destination-out'
      mctx.strokeStyle = '#000'
      mctx.fillStyle = '#000'
    }
    if (stroke.points.length === 1) {
      const p = stroke.points[0]
      mctx.beginPath()
      mctx.arc(p.x * w, p.y * h, radiusPx, 0, Math.PI * 2)
      mctx.fill()
    } else if (stroke.points.length > 1) {
      mctx.beginPath()
      const first = stroke.points[0]
      mctx.moveTo(first.x * w, first.y * h)
      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i]
        mctx.lineTo(p.x * w, p.y * h)
      }
      mctx.stroke()
    }
  }
  mctx.globalCompositeOperation = 'source-over'

  // Applique le masque feathré au canvas visible. Le `filter: blur(...)` est
  // appliqué DURANT drawImage : chaque pixel du masque est adouci → les bords
  // passent graduellement d'opaque à transparent → les particules (surtout les
  // grosses volutes de fog) se fondent naturellement aux frontières de la zone.
  const prev = ctx.globalCompositeOperation
  const prevFilter = ctx.filter
  ctx.globalCompositeOperation = 'destination-in'
  ctx.globalAlpha = 1
  ctx.filter = `blur(${featherPx}px)`
  ctx.drawImage(maskCanvas, 0, 0)
  ctx.filter = prevFilter
  ctx.globalCompositeOperation = prev
}

/** Calcule le Y "central" d'une zone à un X donné — utilisé pour positionner
 *  l'impact au MILIEU de la zone (visuel : la goutte s'enfonce dans la
 *  flaque et son trait se termine au centre). Fallback sur `fallbackY` si
 *  la zone n'a pas de bounds à cet X ou mode 'full'. */
function getImpactYAtX(zone: WeatherZone, x: number, w: number, h: number, fallbackY: number): number {
  // Renvoie un Y aléatoire dans la bande verticale couverte par la zone à cette
  // position X. Compose tous les rects paint + strokes paint. Si aucune source
  // ne couvre x, fallback fourni.
  let minY = Infinity, maxY = -Infinity
  for (const r of getEffectiveRects(zone)) {
    if (r.mode !== 'paint') continue
    const rx1 = Math.min(r.x1, r.x2) * w
    const rx2 = Math.max(r.x1, r.x2) * w
    if (x >= rx1 && x <= rx2) {
      const ry1 = Math.min(r.y1, r.y2) * h
      const ry2 = Math.max(r.y1, r.y2) * h
      if (ry1 < minY) minY = ry1
      if (ry2 > maxY) maxY = ry2
    }
  }
  if (zone.strokes && zone.strokes.length > 0) {
    const scale = Math.min(w, h)
    for (const stroke of zone.strokes) {
      if (stroke.mode !== 'paint') continue
      const radiusPx = stroke.radius * scale
      for (const pt of stroke.points) {
        const px = pt.x * w
        if (Math.abs(px - x) <= radiusPx) {
          const py = pt.y * h
          if (py - radiusPx < minY) minY = py - radiusPx
          if (py + radiusPx > maxY) maxY = py + radiusPx
        }
      }
    }
  }
  if (minY === Infinity) return fallbackY
  return minY + Math.random() * (maxY - minY)
}

// ── Point-dans-zone (pour filtrer les impacts via impactZone) ─────────────
//
// Pour le mode 'full' : toujours true.
// Pour 'rect' : test AABB simple.
// Pour 'brush' : on vérifie si le point tombe dans l'UNION des strokes 'paint'
// (distance au segment le plus proche ≤ radius). Les strokes 'erase' sont
// testées en second pour retirer — ordre chronologique respecté.
function isPointInZone(zone: WeatherZone, x: number, y: number, w: number, h: number): boolean {
  if (zone.mode === 'full') return true
  // Compose tous les rects[] + strokes[] (paint additifs, erase soustractifs).
  // Si zone vide (aucun shape) → false, évite l'effet "tout l'écran" quand
  // l'utilisateur a sélectionné mode rect/brush sans encore tracer.
  let inside = false
  for (const r of getEffectiveRects(zone)) {
    const rx1 = Math.min(r.x1, r.x2) * w, rx2 = Math.max(r.x1, r.x2) * w
    const ry1 = Math.min(r.y1, r.y2) * h, ry2 = Math.max(r.y1, r.y2) * h
    const hit = x >= rx1 && x <= rx2 && y >= ry1 && y <= ry2
    if (hit && r.mode === 'paint') inside = true
    else if (hit && r.mode === 'erase') inside = false
  }
  if (zone.strokes && zone.strokes.length > 0) {
    const scale = Math.min(w, h)
    for (const stroke of zone.strokes) {
      const radiusPx = Math.max(1, stroke.radius * scale)
      const hit = strokeContainsPoint(stroke, x, y, w, h, radiusPx)
      if (stroke.mode === 'paint' && hit) inside = true
      else if (stroke.mode === 'erase' && hit) inside = false
    }
  }
  return inside
}

function strokeContainsPoint(
  stroke: { points: Array<{ x: number; y: number }> },
  x: number, y: number, w: number, h: number, radiusPx: number,
): boolean {
  if (stroke.points.length === 0) return false
  if (stroke.points.length === 1) {
    const p = stroke.points[0]
    const dx = p.x * w - x
    const dy = p.y * h - y
    return dx * dx + dy * dy <= radiusPx * radiusPx
  }
  // Distance au segment le plus proche
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i]
    const b = stroke.points[i + 1]
    const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h
    const abx = bx - ax, aby = by - ay
    const apx = x - ax, apy = y - ay
    const abLen2 = abx * abx + aby * aby
    const t = abLen2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2)) : 0
    const cx = ax + t * abx, cy = ay + t * aby
    const dx = x - cx, dy = y - cy
    if (dx * dx + dy * dy <= radiusPx * radiusPx) return true
  }
  return false
}

// ── Impacts au sol (pluie) ──────────────────────────────────────────────

/** Update age + purge des impacts/splashes expirés. Les splashes subissent
 *  aussi une gravité (gouttelettes qui retombent après leur rebond). */
function updateImpactsAndSplashes(impacts: Impact[], splashes: Splash[], dt: number) {
  for (let i = impacts.length - 1; i >= 0; i--) {
    impacts[i].age += dt
    if (impacts[i].age >= impacts[i].maxAge) impacts.splice(i, 1)
  }
  const GRAVITY = 520  // px/s² — suffisamment pour que les gouttes retombent < 0.5 s
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i]
    s.age += dt
    if (s.age >= s.maxAge) { splashes.splice(i, 1); continue }
    s.vy += GRAVITY * dt
    s.x += s.vx * dt
    s.y += s.vy * dt
  }
}

/** Rend les impacts avec un visuel spécifique par surface :
 *    - 'water' : anneaux qui s'étendent (double anneau + flash optionnel)
 *    - 'hard'  : éclat brillant bref (pas d'anneau, pic lumineux + chute)
 *    - 'soft'  : rien (absorbé) */
function renderImpacts(ctx: CanvasRenderingContext2D, impacts: Impact[]) {
  ctx.lineCap = 'round'
  for (const im of impacts) {
    if (im.surface === 'soft') continue  // absorbé → aucun visuel
    const t = im.age / im.maxAge
    const invT = 1 - t
    const op = im.opacity  // multiplicateur d'opacité hérité de la zone

    if (im.surface === 'hard') {
      const sizeNorm = Math.max(0, Math.min(1, (im.maxSize - 5) / 45))
      const maxPeak = 0.5 + sizeNorm * 7.5

      if (t < 0.5) {
        const hardT = t / 0.5
        const peakRadius = Math.max(0.5, maxPeak * (0.3 + hardT * 0.7))
        ctx.globalAlpha = 0.95 * (1 - hardT) * im.intensity * op
        ctx.fillStyle = '#FFFFFF'
        ctx.beginPath()
        ctx.arc(im.x, im.y, peakRadius, 0, Math.PI * 2)
        ctx.fill()
      }
      if (im.flash && t < 0.15) {
        const flashT = t / 0.15
        const flashRadius = Math.max(0.5, maxPeak * (0.5 + flashT * 0.5))
        ctx.globalAlpha = 0.9 * (1 - flashT) * im.intensity * op
        ctx.fillStyle = '#FFFFFF'
        ctx.beginPath()
        ctx.arc(im.x, im.y, flashRadius, 0, Math.PI * 2)
        ctx.fill()
      }
      continue
    }

    // 'water' (défaut) : anneaux concentriques qui grandissent
    if (im.flash && t < 0.15) {
      const flashT = t / 0.15
      ctx.globalAlpha = 0.8 * (1 - flashT) * im.intensity * op
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(im.x, im.y, 2 + flashT * 5, 0, Math.PI * 2)
      ctx.fill()
    }

    const r = Math.max(0, im.maxSize * t)
    if (r > 0) {
      ctx.globalAlpha = im.intensity * invT * 0.85 * op
      ctx.strokeStyle = '#DFF0FF'
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.ellipse(im.x, im.y, r * Math.max(1, im.aspect), r, im.angleRad, 0, Math.PI * 2)
      ctx.stroke()
    }

    if (t > 0.25) {
      const t2 = (t - 0.25) / 0.75
      const r2 = Math.max(0, im.maxSize * 0.55 * t2)
      if (r2 > 0) {
        ctx.globalAlpha = im.intensity * (1 - t2) * 0.5 * op
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(im.x, im.y, r2 * Math.max(1, im.aspect), r2, im.angleRad, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }
  ctx.globalAlpha = 1
}

/** Rend les gouttelettes d'éclaboussure — petits traits suivant leur velocité
 *  (trail de 2 frames), couleur bleu-clair comme la pluie. */
function renderSplashes(ctx: CanvasRenderingContext2D, splashes: Splash[]) {
  ctx.strokeStyle = '#DFE8FF'
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.2
  for (const s of splashes) {
    const t = s.age / s.maxAge
    ctx.globalAlpha = (1 - t) * 0.9 * s.opacity
    // Trail court : position courante - (vx, vy) * ~0.015 s
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(s.x - s.vx * 0.015, s.y - s.vy * 0.015)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// ── Masque des zones d'impact (efface la pluie traversante) ─────────────
//
// Quand une zone d'impact est définie (le "sol" peint), la pluie ne doit
// pas être visible AU TRAVERS de cette zone — physiquement, la pluie frappe
// le sol et ne le traverse pas. Cette fonction efface (composite=destination-out)
// les particules de pluie déjà rendues qui seraient dans la zone d'impact.
//
// Mode 'full' : ignoré (un masque pleine zone n'a pas de sens — équivaut à
// effacer toute la pluie).

function applyImpactZonesMask(
  ctx: CanvasRenderingContext2D,
  zones: ImpactZoneEntry[],
  w: number,
  h: number,
) {
  if (!zones || zones.length === 0) return
  // Pour chaque zone, on construit le mask composite (rects[] + strokes[]) dans
  // un canvas temp puis on l'applique en 'destination-out' sur le canvas principal.
  // Compose : tous les rects paint en blanc + tous les rects erase en découpe +
  // strokes paint additifs + strokes erase soustractifs.
  for (const entry of zones) {
    // Surface 'glass' : on NE masque PAS la pluie. Une vitre est transparente,
    // on doit voir la pluie tomber derrière. Le rendu des gouttes glissantes
    // est délégué à RainyDayGlassLayer (mounté en parallèle dans Canvas.tsx).
    if (entry.surface === 'glass') continue
    const z = entry.zone
    // mode 'full' : ignoré (pas de masquage zone-spécifique)
    if (z.mode === 'full') continue
    // Si ni rects ni strokes : zone vide, ne rien masquer (évite le bug "tout
    // l'écran masqué" quand l'utilisateur a sélectionné rect/brush sans rien
    // tracer encore).
    const effRects = getEffectiveRects(z)
    const hasStrokes = !!z.strokes && z.strokes.some(s => s.points.length > 0)
    if (effRects.length === 0 && !hasStrokes) continue

    const scale = Math.min(w, h)
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(1, Math.floor(w))
    tmp.height = Math.max(1, Math.floor(h))
    const tctx = tmp.getContext('2d')
    if (!tctx) continue

    // Passe 1 : tous les rects (paint = remplit blanc, erase = découpe)
    for (const r of effRects) {
      const rx = Math.min(r.x1, r.x2) * w
      const ry = Math.min(r.y1, r.y2) * h
      const rw = Math.abs(r.x2 - r.x1) * w
      const rh = Math.abs(r.y2 - r.y1) * h
      tctx.globalCompositeOperation = r.mode === 'erase' ? 'destination-out' : 'source-over'
      tctx.fillStyle = r.mode === 'erase' ? '#000' : '#fff'
      tctx.fillRect(rx, ry, rw, rh)
    }

    // Passe 2 : strokes (paint additif / erase soustractif, ordre respecté)
    if (z.strokes) {
      for (const stroke of z.strokes) {
        if (stroke.points.length === 0) continue
        const r = Math.max(1, stroke.radius * scale)
        tctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'
        tctx.fillStyle = stroke.mode === 'erase' ? '#000' : '#fff'
        for (const pt of stroke.points) {
          tctx.beginPath()
          tctx.arc(pt.x * w, pt.y * h, r, 0, Math.PI * 2)
          tctx.fill()
        }
      }
    }

    // Composite final : utiliser l'alpha du tmp comme zone à effacer dans ctx
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(tmp, 0, 0)
    ctx.restore()
  }
}

// ── Gouttelettes absorbées (surface 'soft') ─────────────────────────────
// Persistantes ~5s, fade-out en 2 phases :
//   - 70% premiers : pleine visibilité (la goutte est posée et brillante)
//   - 30% finaux   : fade-out progressif (séchage)

function updateAbsorbedDrops(drops: AbsorbedDrop[], dt: number) {
  let writeIdx = 0
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i]
    d.age += dt
    if (d.age < d.maxAge) {
      drops[writeIdx++] = d
    }
  }
  drops.length = writeIdx
}

function renderAbsorbedDrops(ctx: CanvasRenderingContext2D, drops: AbsorbedDrop[]) {
  for (const d of drops) {
    const t = d.age / d.maxAge
    // Phase 1 (0-70%) : pleine visibilité ; phase 2 (70-100%) : fade
    const alpha = t < 0.7 ? d.baseAlpha : d.baseAlpha * (1 - (t - 0.7) / 0.3)
    if (alpha <= 0.01) continue

    // Effet suggéré : halo léger + corps subtil. Pas de highlight blanc
    // agressif (sinon ça ressemble à des étoiles posées). On multiplie alpha
    // par d.opacity (modulateur visuel hérité de la zone d'impact).
    const op = d.opacity
    ctx.globalAlpha = alpha * 0.25 * op
    ctx.fillStyle = '#cfe6ff'
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.radius * 1.6, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = alpha * 0.55 * op
    ctx.fillStyle = '#e8f3ff'
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// ── Surface 'glass' supprimée — déléguée à RainyDayGlassLayer ────────────
// Tout le code maison glass (applyGlassZonesClip, pickGlassSpawnPosition,
// updateGlassDrops, renderGlassDrops + constantes GLASS_*) a été supprimé
// après l'intégration de rainyday.js. Le rendu des gouttes sur vitre est
// maintenant fait par <RainyDayGlassLayer> mounté dans Canvas.tsx en
// parallèle de ParticleLayer pour chaque zone d'impact glass.


// Re-export pour les composants qui ont besoin de visualiser les strokes en
// temps réel (CanvasOverlay pour le preview live pendant que l'utilisateur peint).
export type { WeatherZone }
