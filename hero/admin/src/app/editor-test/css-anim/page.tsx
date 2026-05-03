'use client'
/**
 * POC CSS Animation sur découpe — alternative à Rive/Wan pour animations
 * légères, déterministes, web-native.
 *
 * Pipeline :
 *   1. Auteur tape un prompt
 *   2. Génération image (réutilise useImageGeneration : Juggernaut XL via ComfyUI)
 *   3. Auto-découpe (Scene Analyzer F : Qwen + DINO + SAM 1 HQ + split client)
 *   4. Chaque détection est rendue comme un <div> avec mask-image CSS
 *   5. Préset d'animation CSS (pulse, sway, bounce, stretch) appliqué à toutes
 *      les parties → preview live, 60fps, GPU accéléré, zéro IA en runtime
 *
 * Cas d'usage Hero : animations interactives sur des images générées AI,
 * sans tooling externe (Rive) ni génération vidéo (Wan), zéro learning curve
 * auteur. Tradeoff : mouvements limités à transform 2D (rotate/translate/scale)
 * — pas de soft-body, pas de morphing pixel.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useImageGeneration } from '@/components/image-editor/hooks/useImageGeneration'

interface RawDetection {
  id: string
  label: string
  bbox: [number, number, number, number]      // 0-1 normalisée
  bbox_pixels: [number, number, number, number]
  mask_url: string | null
  source?: 'dense' | 'od'
}

interface SplitInDetection extends RawDetection {
  is_split: boolean
  mask_data_url?: string
  parent_id?: string
}

interface AnalyzeResp {
  detections?: RawDetection[]
  image_size?: { width: number; height: number }
  error?: string
}

interface SplitResp {
  detections?: RawDetection[]
  error?: string
}

const ANIMATION_PRESETS = [
  { id: 'pulse',   label: '💓 Pulse',   keyframes: [
    { offset: 0,   transform: 'scale(1)' },
    { offset: 0.5, transform: 'scale(1.08)' },
    { offset: 1,   transform: 'scale(1)' },
  ], duration: 1.4 },
  { id: 'sway',    label: '🌬 Sway',    keyframes: [
    { offset: 0,    transform: 'rotate(-3deg)' },
    { offset: 0.5,  transform: 'rotate(3deg)' },
    { offset: 1,    transform: 'rotate(-3deg)' },
  ], duration: 2.5 },
  { id: 'bounce',  label: '⬆️ Bounce',  keyframes: [
    { offset: 0,   transform: 'translateY(0)' },
    { offset: 0.5, transform: 'translateY(-8px)' },
    { offset: 1,   transform: 'translateY(0)' },
  ], duration: 1.0 },
  { id: 'stretch', label: '🐱 Stretch', keyframes: [
    { offset: 0,    transform: 'scale(1, 1)' },
    { offset: 0.4,  transform: 'scale(1.18, 0.86) translateY(2px)' },
    { offset: 0.7,  transform: 'scale(1.18, 0.86) translateY(2px)' },
    { offset: 1,    transform: 'scale(1, 1)' },
  ], duration: 1.6 },
] as const

type PresetId = typeof ANIMATION_PRESETS[number]['id']

export default function CssAnimTestPage() {
  const [prompt, setPrompt] = useState('a fluffy ginger cat lying on a wooden barrel, medieval tavern, painterly digital art')
  const [genError, setGenError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const [detections, setDetections] = useState<RawDetection[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [activePreset, setActivePreset] = useState<PresetId>('stretch')
  const [playing, setPlaying] = useState(false)
  const [stagger, setStagger] = useState(0.08)
  const [sourceOpacity, setSourceOpacity] = useState(0)        // 0 = parts visibles seules
  const [showOutlines, setShowOutlines] = useState(true)       // glow rose autour de chaque part
  const [soloPartId, setSoloPartId] = useState<string | null>(null) // null = toutes visibles

  // Réutilise le hook officiel de génération multi-modèle (on n'en sélectionne
  // qu'un = 'juggernaut'). statuses[0] expose stage/url quand prêt.
  const { statuses, isRunning, start } = useImageGeneration()

  const handleGenerate = useCallback(() => {
    if (!prompt.trim() || isRunning) return
    setGenError(null)
    setImageUrl(null)
    setDetections([])
    setImageSize(null)
    setPlaying(false)
    void start({
      promptFr: prompt,
      negativeFr: '',
      type: 'plan_standard',
      format: '1:1',
      modelKeys: ['juggernaut'],
      storagePathPrefix: 'test/css-anim',
      steps: 30,
      cfg: 7,
    })
  }, [prompt, isRunning, start])

  // Quand la première variante est done → on chope l'URL et on lance l'analyse
  useEffect(() => {
    const first = statuses[0]
    if (!first || first.stage !== 'done' || !first.url) return
    if (imageUrl === first.url) return
    setImageUrl(first.url)
  }, [statuses, imageUrl])

  // Lance l'analyse + split à chaque nouvelle imageUrl
  useEffect(() => {
    if (!imageUrl) return
    let cancelled = false
    setAnalyzing(true)
    setGenError(null)

    ;(async () => {
      try {
        const analyzeRes = await fetch('/api/comfyui/analyze-scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: imageUrl,
            model: 'large',
            filter_mode: 'combined',
            extraction_strategy: 'f_qwen_sam1hq',
            group_by_class: false,
          }),
        })
        const analyzeData = (await analyzeRes.json()) as AnalyzeResp
        if (cancelled) return
        if (!analyzeRes.ok || analyzeData.error) {
          throw new Error(analyzeData.error ?? `analyse HTTP ${analyzeRes.status}`)
        }
        const W = analyzeData.image_size?.width ?? 1024
        const H = analyzeData.image_size?.height ?? 1024
        setImageSize({ w: W, h: H })

        const rawDets = analyzeData.detections ?? []

        const { splitDetectionsByContour } = await import('@/components/image-editor/helpers/splitDetectionsByContour')
        const splitInput = rawDets.map(d => ({
          id: d.id, label: d.label, bbox: d.bbox, bbox_pixels: d.bbox_pixels,
          mask_url: d.mask_url, source: d.source,
        }))
        const split = await splitDetectionsByContour(splitInput, W, H)
        if (cancelled) return
        let finalDetections: RawDetection[] = rawDets

        if (split.stats.split_parents > 0) {
          const persistRes = await fetch('/api/comfyui/analyze-scene/split', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: imageUrl,
              image_width: W,
              image_height: H,
              detections: split.detections as SplitInDetection[],
              obsolete_mask_urls: split.obsolete_mask_urls,
            }),
          })
          const persistData = (await persistRes.json()) as SplitResp
          if (cancelled) return
          if (persistRes.ok && persistData.detections) {
            finalDetections = persistData.detections
          }
        }

        setDetections(finalDetections.filter(d => d.mask_url))
      } catch (err) {
        if (cancelled) return
        setGenError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setAnalyzing(false)
      }
    })()
    return () => { cancelled = true }
  }, [imageUrl])

  const genStage = statuses[0]?.stage ?? 'idle'

  // ── Animation : applique les keyframes via Web Animations API ─────────
  const partRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const runningAnimations = useRef<Animation[]>([])

  useEffect(() => {
    // Stop animations en cours
    for (const a of runningAnimations.current) a.cancel()
    runningAnimations.current = []
    if (!playing) return

    const preset = ANIMATION_PRESETS.find(p => p.id === activePreset)
    if (!preset) return

    let i = 0
    for (const [, el] of partRefs.current) {
      const anim = el.animate(
        preset.keyframes as unknown as Keyframe[],
        {
          duration: preset.duration * 1000,
          delay: i * stagger * 1000,
          iterations: Infinity,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        },
      )
      runningAnimations.current.push(anim)
      i++
    }

    return () => {
      for (const a of runningAnimations.current) a.cancel()
      runningAnimations.current = []
    }
  }, [playing, activePreset, stagger, detections])

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC CSS Animation sur découpe
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Prompt → image AI → découpe auto → animation CSS sur chaque partie.
          Aucun runtime externe, 60fps GPU.
        </p>

        {/* Prompt + Generate */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Décris la scène à générer…"
            disabled={isRunning || analyzing}
            style={{
              flex: 1, padding: '10px 12px',
              background: '#1a1a1e', border: '1px solid #2a2a30',
              borderRadius: 4, color: '#ede9df', fontSize: 13,
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={isRunning || analyzing || !prompt.trim()}
            style={{ ...btnStyle, background: '#EC4899', minWidth: 160 }}
          >
            {isRunning
              ? `⏳ ${genStage === 'translating' ? 'Traduction'
                  : genStage === 'queuing' ? 'Queue'
                  : genStage === 'generating' ? 'Génération'
                  : genStage === 'uploading' ? 'Upload'
                  : 'Préparation'}…`
              : analyzing
                ? '🔍 Analyse découpe…'
                : '🎨 Générer'}
          </button>
        </div>

        {genError && (
          <div style={{ padding: 10, background: '#7f1d1d', borderRadius: 4, marginBottom: 12, fontSize: 12 }}>
            ❌ {genError}
          </div>
        )}

        {/* Stage */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12 }}>
          <div style={{
            position: 'relative',
            aspectRatio: imageSize ? `${imageSize.w}/${imageSize.h}` : '1/1',
            background: '#1a1a1e',
            border: '1px solid #2a2a30',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {!imageUrl && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#666', fontSize: 14, textAlign: 'center', padding: 16,
              }}>
                {isRunning
                  ? '⏳ Génération en cours… (peut prendre 30-90s)'
                  : 'Tape un prompt et clique Générer'}
              </div>
            )}
            {imageUrl && (
              <>
                <img
                  src={imageUrl}
                  alt="generated"
                  crossOrigin="anonymous"
                  style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    objectFit: 'contain',
                    opacity: sourceOpacity,
                    transition: 'opacity 200ms',
                  }}
                />
                {detections.map(d => {
                  const dimmed = soloPartId !== null && soloPartId !== d.id
                  return (
                    <PartLayer
                      key={d.id}
                      detection={d}
                      sourceUrl={imageUrl}
                      refMap={partRefs}
                      showOutline={showOutlines}
                      dimmed={dimmed}
                    />
                  )
                })}
              </>
            )}
          </div>

          {/* Controls */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 10,
            padding: 12, background: '#0f0f13',
            border: '1px solid #2a2a30', borderRadius: 6,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase' }}>
              Animation
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {ANIMATION_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setActivePreset(p.id)}
                  style={{ ...btnStyle, background: activePreset === p.id ? '#EC4899' : '#1a1a1e', fontSize: 11 }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setPlaying(p => !p)}
              disabled={detections.length === 0}
              style={{ ...btnStyle, background: playing ? '#10B981' : '#1a1a1e' }}
            >
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#9898b4' }}>
              <span>Stagger entre parts : <code>{stagger.toFixed(2)}s</code></span>
              <input
                type="range"
                min={0} max={0.3} step={0.02}
                value={stagger}
                onChange={e => setStagger(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>

            {/* ── Visualisation debug ──────────────────────────────────── */}
            <div style={{ borderTop: '1px solid #2a2a30', paddingTop: 10, marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase', marginBottom: 6 }}>
                Visualisation
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#9898b4' }}>
                <span>Image source : <code>{(sourceOpacity * 100).toFixed(0)}%</code></span>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={sourceOpacity}
                  onChange={e => setSourceOpacity(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9898b4', marginTop: 6 }}>
                <input type="checkbox" checked={showOutlines} onChange={e => setShowOutlines(e.target.checked)} />
                Glow rose autour des parts
              </label>
            </div>

            {/* ── Liste cliquable des parts (mode solo) ─────────────────── */}
            <div style={{ borderTop: '1px solid #2a2a30', paddingTop: 10, marginTop: 4 }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase', marginBottom: 6,
              }}>
                <span>Parts détectées ({detections.length})</span>
                {soloPartId && (
                  <button
                    onClick={() => setSoloPartId(null)}
                    style={{ ...btnStyle, padding: '2px 6px', fontSize: 10 }}
                  >
                    Tout voir
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
                {detections.map(d => (
                  <button
                    key={d.id}
                    onClick={() => setSoloPartId(s => s === d.id ? null : d.id)}
                    style={{
                      ...btnStyle, fontSize: 11, padding: '4px 8px',
                      background: soloPartId === d.id ? '#EC4899' : '#1a1a1e',
                      textAlign: 'left',
                    }}
                    title="Click pour isoler cette part"
                  >
                    • {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>À évaluer :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>L&apos;animation tourne fluide à 60fps même avec 10+ parties ?</li>
            <li>Le rendu est-il convaincant (chat qui s&apos;étire, etc.) ou trop artificiel ?</li>
            <li>Stagger : effet cascade vs synchronisé — lequel marche mieux ?</li>
            <li>Les parties non-personnage (mur, sol) animées créent-elles des artefacts ? → futur filtre par label</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Composant : 1 partie de la découpe rendue comme div masquée + animée ──

interface PartLayerProps {
  detection: RawDetection
  sourceUrl: string
  refMap: React.RefObject<Map<string, HTMLDivElement>>
  showOutline: boolean
  dimmed: boolean
}

function PartLayer({ detection, sourceUrl, refMap, showOutline, dimmed }: PartLayerProps) {
  const localRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = localRef.current
    const map = refMap.current
    if (!el || !map) return
    map.set(detection.id, el)
    return () => { map.delete(detection.id) }
  }, [detection.id, refMap])

  if (!detection.mask_url) return null

  // Bbox normalisée → CSS positioning sur le conteneur
  const [x1, y1, x2, y2] = detection.bbox

  // Filter chain : drop-shadow (outline) + dimmer (mode solo)
  const filterParts: string[] = []
  if (showOutline) filterParts.push('drop-shadow(0 0 2px rgba(236,72,153,0.95)) drop-shadow(0 0 4px rgba(236,72,153,0.6))')
  if (dimmed) filterParts.push('opacity(0.15)')
  const filter = filterParts.length > 0 ? filterParts.join(' ') : undefined

  return (
    <div
      ref={localRef}
      title={detection.label}
      style={{
        position: 'absolute',
        left: 0, top: 0,
        width: '100%', height: '100%',
        backgroundImage: `url(${sourceUrl})`,
        backgroundSize: '100% 100%',
        backgroundPosition: 'center',
        WebkitMaskImage: `url(${detection.mask_url})`,
        maskImage: `url(${detection.mask_url})`,
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        // WebkitMaskMode/maskMode pas typés dans React.CSSProperties → cast ad-hoc
        ...({ WebkitMaskMode: 'luminance', maskMode: 'luminance' } as React.CSSProperties),
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        // Pivot autour du centre de la bbox de cette part — pour que rotate/scale
        // pivote autour de l'objet, pas du centre du canvas entier.
        transformOrigin: `${((x1 + x2) / 2) * 100}% ${((y1 + y2) / 2) * 100}%`,
        willChange: 'transform',
        pointerEvents: 'none',
        filter,
        transition: 'filter 200ms',
      }}
    />
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: '#0d0d0d',
  color: '#ede9df',
  fontFamily: 'Inter, -apple-system, sans-serif',
}

const btnStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
