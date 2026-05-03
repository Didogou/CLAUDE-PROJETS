'use client'
/**
 * LightningEffect — rendu des éclairs (kind='lightning' dans WeatherParams).
 *
 * Modèle simplifié 2026-04-25 :
 *   - 4 paramètres user : luminosité, halo intensité, fréquence, flash on/off
 *   - 2 zones distinctes : `zone` (flash) et `lightningBoltZone` (éclair + halo)
 *   - Branches aléatoires 1-3 par éclair
 *   - Tout reste : durée, couleur, épaisseur figés en valeurs sensées
 *
 * Pattern canvas + rAF, zéro re-render React.
 */

import React, { useEffect, useRef } from 'react'
import type { WeatherParams, WeatherZone } from './types'

interface LightningEffectProps {
  weather: WeatherParams
  style?: React.CSSProperties
}

interface BoltSegment {
  x1: number; y1: number
  x2: number; y2: number
  width: number
}

interface ActiveStrike {
  startedAt: number
  duration: number
  brightness: number
  haloIntensity: number
  flashEnabled: boolean
  bolt: BoltSegment[]
}

// Constantes figées (anciennement paramétrables)
const FLASH_DURATION_MS = 220
const FLASH_COLOR_HEX = '#f0f4ff'
const BOLT_COLOR_HEX = '#ffffff'
const BOLT_WIDTH_PX = 3.5
const HALO_COLOR_HEX = '#ffffff'

export default function LightningEffect({ weather, style }: LightningEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const weatherRef = useRef(weather)
  weatherRef.current = weather
  const activeStrikesRef = useRef<ActiveStrike[]>([])
  const nextStrikeAtRef = useRef<number>(0)
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const parent = canvas.parentElement
    if (!parent) return

    nextStrikeAtRef.current = performance.now() + scheduleNext(weatherRef.current)

    let rafId = 0
    const tick = (now: number) => {
      const p = weatherRef.current

      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const targetW = Math.max(1, Math.floor(rect.width * dpr))
      const targetH = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW
        canvas.height = targetH
        canvas.style.width = rect.width + 'px'
        canvas.style.height = rect.height + 'px'
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const boltZone = p.lightningBoltZone ?? p.zone
      const boltZoneValid = isZoneValid(boltZone)

      // Trigger d'un nouvel éclair ?
      // Règle (2026-04-25) : on ne planifie aucun éclair tant que la zone
      // bolt n'est pas valide (pas full, rect avec aire > 0, brush avec
      // strokes). Cohérent avec « les éclairs n'apparaissent que dans les
      // zones dessinées ».
      if (boltZoneValid && now >= nextStrikeAtRef.current) {
        const boltBox = computeZoneBoundingBox(boltZone!, rect.width, rect.height)
        const strike: ActiveStrike = {
          startedAt: now,
          duration: FLASH_DURATION_MS,
          brightness: p.lightningBrightness ?? 0.7,
          haloIntensity: p.lightningHaloIntensity ?? 0.6,
          flashEnabled: p.lightningFlashEnabled !== false && isZoneValid(p.zone),
          bolt: generateBolt(boltBox, BOLT_WIDTH_PX),
        }
        activeStrikesRef.current.push(strike)
        nextStrikeAtRef.current = now + scheduleNext(p)
      } else if (!boltZoneValid) {
        // Reschedule en avant pour que dès que la zone devient valide on
        // déclenche rapidement (pas d'attente longue résiduelle).
        nextStrikeAtRef.current = now + scheduleNext(p)
      }

      ctx.clearRect(0, 0, rect.width, rect.height)

      const stillActive: ActiveStrike[] = []
      for (const s of activeStrikesRef.current) {
        const elapsed = now - s.startedAt
        if (elapsed >= s.duration) continue
        const t = elapsed / s.duration
        // Profil : pic en 0.12, décroissance cubic
        const envelope = t < 0.12
          ? t / 0.12
          : Math.pow(1 - (t - 0.12) / 0.88, 2.5)

        // ── 1) Flash global dans la zone flash ─────────────────────────
        if (s.flashEnabled) {
          const flashAlpha = s.brightness * envelope
          const flashRgb = parseHex(FLASH_COLOR_HEX)
          ctx.save()
          applyZoneClip(ctx, p.zone ?? { mode: 'full' }, rect.width, rect.height, maskCanvasRef)
          ctx.fillStyle = `rgba(${flashRgb.r}, ${flashRgb.g}, ${flashRgb.b}, ${flashAlpha})`
          ctx.fillRect(0, 0, rect.width, rect.height)
          ctx.restore()
        }

        // ── 2) Halo + éclair zigzag dans la zone bolt ──────────────────
        const boltZone = p.lightningBoltZone ?? p.zone ?? { mode: 'full' }
        const boltAlphaBase = t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.4, 1.5)
        const boltAlpha = Math.max(0, boltAlphaBase) * s.brightness

        if (boltAlpha > 0.01) {
          ctx.save()
          applyZoneClip(ctx, boltZone, rect.width, rect.height, maskCanvasRef)

          // Halo : multi-pass avec largeur croissante et alpha décroissante
          const haloStrength = s.haloIntensity * boltAlpha
          if (haloStrength > 0.02) {
            const halo = parseHex(HALO_COLOR_HEX)
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            // 3 passes de halo : large, moyen, fin
            const passes = [
              { mult: 8, alpha: 0.12 },
              { mult: 5, alpha: 0.22 },
              { mult: 2.5, alpha: 0.4 },
            ]
            for (const pass of passes) {
              ctx.strokeStyle = `rgba(${halo.r}, ${halo.g}, ${halo.b}, ${haloStrength * pass.alpha})`
              for (const seg of s.bolt) {
                ctx.lineWidth = seg.width * pass.mult
                ctx.beginPath()
                ctx.moveTo(seg.x1, seg.y1)
                ctx.lineTo(seg.x2, seg.y2)
                ctx.stroke()
              }
            }
          }

          // Éclair zigzag (cœur net)
          const cbg = parseHex(BOLT_COLOR_HEX)
          ctx.strokeStyle = `rgba(${cbg.r}, ${cbg.g}, ${cbg.b}, ${boltAlpha})`
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          for (const seg of s.bolt) {
            ctx.lineWidth = seg.width
            ctx.beginPath()
            ctx.moveTo(seg.x1, seg.y1)
            ctx.lineTo(seg.x2, seg.y2)
            ctx.stroke()
          }

          ctx.restore()
        }

        stillActive.push(s)
      }
      activeStrikesRef.current = stillActive

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return <canvas ref={canvasRef} style={style} />
}

// ── Scheduling : convertit `frequency` (0-1) en intervalle aléatoire ──────
// 0 → 8-15s entre flashs ; 1 → 0.5-2s entre flashs
function scheduleNext(w: WeatherParams): number {
  const f = Math.max(0, Math.min(1, w.lightningFrequency ?? 0.4))
  // Min interval : interpolation 8000 → 500
  const minInt = 8000 - f * 7500
  // Max interval : interpolation 15000 → 2000
  const maxInt = 15000 - f * 13000
  return minInt + Math.random() * Math.max(0, maxInt - minInt)
}

// ── Validation d'une zone (pour autoriser/non le déclenchement) ──────────
// Règle : une zone est valide si elle est rect avec aire > 0 OU brush avec
// au moins un stroke peint. 'full' est invalide pour les éclairs (interdit
// le mode "tout l'écran" qui n'a pas de sens narratif).
function isZoneValid(zone?: WeatherZone): boolean {
  if (!zone) return false
  if (zone.mode === 'full') return false
  if (zone.mode === 'rect') {
    if (!zone.rect) return false
    const w = Math.abs(zone.rect.x2 - zone.rect.x1)
    const h = Math.abs(zone.rect.y2 - zone.rect.y1)
    return w > 0.01 && h > 0.01
  }
  if (zone.mode === 'brush') {
    return (zone.strokes?.some(s => s.points.length > 0)) ?? false
  }
  return false
}

// ── Bounding box d'une zone (pour cadrer où démarre/finit l'éclair) ──────
function computeZoneBoundingBox(zone: WeatherZone, w: number, h: number): { x: number; y: number; w: number; h: number } {
  if (zone.mode === 'rect' && zone.rect) {
    const x = Math.min(zone.rect.x1, zone.rect.x2) * w
    const y = Math.min(zone.rect.y1, zone.rect.y2) * h
    const ww = Math.abs(zone.rect.x2 - zone.rect.x1) * w
    const hh = Math.abs(zone.rect.y2 - zone.rect.y1) * h
    return { x, y, w: ww, h: hh }
  }
  if (zone.mode === 'brush' && zone.strokes && zone.strokes.length > 0) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0
    for (const stroke of zone.strokes) {
      for (const pt of stroke.points) {
        if (pt.x < minX) minX = pt.x
        if (pt.y < minY) minY = pt.y
        if (pt.x > maxX) maxX = pt.x
        if (pt.y > maxY) maxY = pt.y
      }
    }
    if (maxX <= minX || maxY <= minY) return { x: 0, y: 0, w, h }
    return { x: minX * w, y: minY * h, w: (maxX - minX) * w, h: (maxY - minY) * h }
  }
  return { x: 0, y: 0, w, h }
}

// ── Application d'un clip selon la zone (full / rect / brush) ─────────────
function applyZoneClip(
  ctx: CanvasRenderingContext2D,
  zone: WeatherZone,
  w: number, h: number,
  maskRef: React.MutableRefObject<HTMLCanvasElement | null>,
) {
  if (zone.mode === 'rect' && zone.rect) {
    ctx.beginPath()
    const x = Math.min(zone.rect.x1, zone.rect.x2) * w
    const y = Math.min(zone.rect.y1, zone.rect.y2) * h
    const ww = Math.abs(zone.rect.x2 - zone.rect.x1) * w
    const hh = Math.abs(zone.rect.y2 - zone.rect.y1) * h
    ctx.rect(x, y, ww, hh)
    ctx.clip()
    return
  }
  if (zone.mode === 'brush' && zone.strokes && zone.strokes.length > 0) {
    // Crée un path composé de cercles le long des strokes (approx du brush
    // épais). Plus rapide qu'un offscreen mask + composite.
    const radiusFrac = zone.brushSize ?? 0.04
    const r = radiusFrac * Math.min(w, h)
    ctx.beginPath()
    for (const stroke of zone.strokes) {
      if (stroke.mode === 'erase') continue  // ignore erase pour ce clip simple
      for (const pt of stroke.points) {
        ctx.moveTo(pt.x * w + r, pt.y * h)
        ctx.arc(pt.x * w, pt.y * h, r, 0, Math.PI * 2)
      }
    }
    ctx.clip()
    return
  }
  // mode 'full' : pas de clip
}

// ── Génération de l'éclair (zigzag fractal + 1-3 branches aléatoires) ─────
function generateBolt(box: { x: number; y: number; w: number; h: number }, mainWidth: number): BoltSegment[] {
  // Point de départ : haut de la zone, position aléatoire 30-70% horizontal
  const x0 = box.x + box.w * (0.3 + Math.random() * 0.4)
  const y0 = box.y
  // Point d'arrivée : bas de la zone, dérive horizontale
  const x1 = x0 + (Math.random() - 0.5) * box.w * 0.4
  const y1 = box.y + box.h * (0.78 + Math.random() * 0.18)

  const segments: BoltSegment[] = []
  const offset = box.w * 0.08
  const mainPath = subdivide(x0, y0, x1, y1, 4, offset)

  for (let i = 0; i < mainPath.length - 1; i++) {
    segments.push({
      x1: mainPath[i].x, y1: mainPath[i].y,
      x2: mainPath[i + 1].x, y2: mainPath[i + 1].y,
      width: mainWidth,
    })
  }

  // 1-3 branches aléatoires sur des segments aléatoires du chemin principal
  const branchCount = 1 + Math.floor(Math.random() * 3)  // 1, 2 ou 3
  const candidateIndexes: number[] = []
  for (let i = 1; i < mainPath.length - 2; i++) candidateIndexes.push(i)
  // Shuffle
  candidateIndexes.sort(() => Math.random() - 0.5)
  for (let b = 0; b < Math.min(branchCount, candidateIndexes.length); b++) {
    const idx = candidateIndexes[b]
    const px = mainPath[idx].x
    const py = mainPath[idx].y
    // Branche : descend en dérivant à droite ou à gauche
    const sign = Math.random() > 0.5 ? 1 : -1
    const bx = px + sign * box.w * (0.1 + Math.random() * 0.2)
    const by = py + box.h * (0.1 + Math.random() * 0.18)
    const branchPath = subdivide(px, py, bx, by, 2, box.w * 0.04)
    for (let j = 0; j < branchPath.length - 1; j++) {
      segments.push({
        x1: branchPath[j].x, y1: branchPath[j].y,
        x2: branchPath[j + 1].x, y2: branchPath[j + 1].y,
        width: Math.max(1, mainWidth * 0.55),
      })
    }
  }
  return segments
}

function subdivide(x1: number, y1: number, x2: number, y2: number, depth: number, maxOffset: number): { x: number; y: number }[] {
  if (depth === 0) return [{ x: x1, y: y1 }, { x: x2, y: y2 }]
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * maxOffset
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * maxOffset * 0.3
  const left = subdivide(x1, y1, mx, my, depth - 1, maxOffset * 0.55)
  const right = subdivide(mx, my, x2, y2, depth - 1, maxOffset * 0.55)
  return [...left.slice(0, -1), ...right]
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const s = hex.trim().startsWith('#') ? hex.trim().slice(1) : hex.trim()
  const full = s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}
