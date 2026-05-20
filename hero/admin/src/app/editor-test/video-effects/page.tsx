'use client'
/**
 * Video Effects POC — Catalogue exhaustif (refonte 2026-05-15bv).
 *
 * Tous les effets shader (Phase B + nouveaux 6) + tous les overlays HTML/CSS
 * (Camcorder, Letterbox, Polaroid, Phone, Viewfinder, OldFilm, LightLeaks,
 * LensDirt, BadSignal). L'auteur teste, prend des screenshots et liste ceux
 * à garder. On supprimera les autres en post-validation.
 */

import React, { useCallback, useState } from 'react'
import VideoEffectsCanvas, {
  type VideoEffectsParams, PRESETS, PRESET_LABELS,
} from '@/lib/video-effects/VideoEffectsCanvas'
import CamcorderOverlay from '@/lib/video-effects/CamcorderOverlay'
import {
  LetterboxOverlay, PolaroidFrame, PhoneFrame, ViewfinderOverlay,
  OldFilmOverlay, LightLeaksOverlay, LensDirtOverlay, BadSignalOverlay,
  SniperScopeOverlay,
} from '@/lib/video-effects/OverlayCatalog'
import { useMouseTrack } from '@/lib/video-effects/useMouseTrack'

const NEUTRAL: VideoEffectsParams = {
  brightness: 0, contrast: 0, saturate: 0, hue: 0,
  vignette: 0, filmGrain: 0, chromaticAberration: 0, bloom: 0,
  pixelate: 0, glitch: 'off',
  sepia: 0, dotScreen: 0, scanline: 0, grid: 0, colorAverage: 0, colorDepth: 0,
}

interface OverlayState {
  camcorder: boolean
  letterbox: 'off' | 'cinema_2.35' | 'cinema_2.39' | '21_9' | '4_3'
  polaroid: boolean
  phone: boolean
  viewfinder: boolean
  oldFilm: boolean
  lightLeaks: boolean
  lensDirt: boolean
  badSignal: number  // 0 = off, sinon intensité 0-1
  sniperScope: 'off' | 'black' | 'red' | 'green'
}
const NEUTRAL_OVERLAYS: OverlayState = {
  camcorder: false, letterbox: 'off', polaroid: false, phone: false,
  viewfinder: false, oldFilm: false, lightLeaks: false, lensDirt: false,
  badSignal: 0, sniperScope: 'off',
}

export default function VideoEffectsTestPage() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [params, setParams] = useState<VideoEffectsParams>(NEUTRAL)
  const [overlays, setOverlays] = useState<OverlayState>(NEUTRAL_OVERLAYS)
  // Refonte 2026-05-15bz — callback ref propre depuis VideoEffectsCanvas
  // (remplace le hack querySelector qui pouvait pointer sur un orphelin
  // post-cleanup en StrictMode dev → play() rejetait NotSupportedError).
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

  // ── Mouse tracking pour suivre un objet (refonte 2026-05-15bw/by) ──────────
  const [scopeSize, setScopeSize] = useState(0.22)
  const [playbackRate, setPlaybackRate] = useState(0.5)
  const tracker = useMouseTrack({ videoEl, playbackRate })

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) {
      alert('Choisis un fichier vidéo (MP4/WebM/MOV).')
      return
    }
    const url = URL.createObjectURL(file)
    setVideoUrl(url)
  }, [])

  function applyPreset(key: keyof typeof PRESETS) {
    setParams({ ...NEUTRAL, ...PRESETS[key] })
  }
  function reset() {
    setParams(NEUTRAL)
    setOverlays(NEUTRAL_OVERLAYS)
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#fff', color: '#222',
      fontFamily: 'system-ui, sans-serif',
    }}>
    <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '2rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Video Effects — POC catalogue exhaustif</h1>
      <p style={{ color: '#666', fontSize: '0.9rem', marginTop: 0, marginBottom: '1.5rem' }}>
        15 effets shader + 9 overlays HTML/CSS. Test tout, prends note des keepers.
      </p>

      {/* Upload */}
      <section style={{ marginBottom: '1.5rem' }}>
        <input
          type="file" accept="video/*"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <span style={{ marginLeft: '1rem', fontSize: '0.85rem', color: '#666' }}>Ou URL :</span>
        <input
          type="text" placeholder="https://..."
          style={{ marginLeft: '0.5rem', padding: '0.3rem', minWidth: '20rem' }}
          onBlur={e => e.target.value.trim() && setVideoUrl(e.target.value.trim())}
        />
      </section>

      {/* Layout 2 col : canvas+overlays à gauche, contrôles à droite */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', alignItems: 'flex-start' }}>
        <div>
          {/* Canvas + overlays empilés */}
          <div
            ref={tracker.attachTarget}
            style={{
              position: 'relative', width: '100%', aspectRatio: '16 / 9',
              cursor: tracker.mode === 'recording' ? 'crosshair' : 'default',
            }}
          >
            {videoUrl ? (
              <VideoEffectsCanvas
                videoUrl={videoUrl}
                params={params}
                width="100%"
                aspectRatio={16 / 9}
                loop={false}
                autoPlay={false}
                onVideoElement={setVideoEl}
              />
            ) : (
              <div style={{
                width: '100%', height: '100%', background: '#eee',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999',
              }}>
                Choisis une vidéo pour démarrer
              </div>
            )}
            {/* Overlays — z-index 9-10, position: absolute */}
            <CamcorderOverlay enabled={overlays.camcorder} videoEl={videoEl} />
            <LetterboxOverlay
              enabled={overlays.letterbox !== 'off'}
              ratio={overlays.letterbox === 'off' ? 'cinema_2.35' : overlays.letterbox}
            />
            <PolaroidFrame enabled={overlays.polaroid} caption="HERO — souvenir" />
            <PhoneFrame enabled={overlays.phone} />
            <ViewfinderOverlay enabled={overlays.viewfinder} />
            <OldFilmOverlay enabled={overlays.oldFilm} />
            <LightLeaksOverlay enabled={overlays.lightLeaks} />
            <LensDirtOverlay enabled={overlays.lensDirt} />
            <BadSignalOverlay enabled={overlays.badSignal > 0} intensity={overlays.badSignal} />
            <SniperScopeOverlay
              enabled={overlays.sniperScope !== 'off'}
              reticleColor={overlays.sniperScope === 'off' ? 'black' : overlays.sniperScope}
              centerX={tracker.currentXY?.x ?? 0.5}
              centerY={tracker.currentXY?.y ?? 0.5}
              scopeSize={scopeSize}
              // Refonte 2026-05-15by — pendant countdown, mask off pour voir
              // toute l'image et positionner la cible avec la croix.
              showMask={tracker.mode !== 'countdown'}
            />

            {/* Countdown overlay 3-2-1 (refonte 2026-05-15bx) */}
            {tracker.mode === 'countdown' && tracker.countdownValue !== null && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.4)', pointerEvents: 'none',
              }}>
                <div style={{
                  fontSize: '12rem', fontWeight: 800, color: '#fff',
                  textShadow: '0 0 2rem rgba(255, 45, 45, 0.8)',
                  fontFamily: 'system-ui, sans-serif',
                  animation: 'cd-pop 0.8s ease-out',
                }}>
                  {tracker.countdownValue}
                </div>
                <style jsx>{`
                  @keyframes cd-pop {
                    0%   { opacity: 0; transform: scale(2); }
                    20%  { opacity: 1; transform: scale(1); }
                    100% { opacity: 0.8; transform: scale(1); }
                  }
                `}</style>
              </div>
            )}

            {/* Indicator REC pendant recording (en haut à gauche) */}
            {tracker.mode === 'recording' && (
              <div style={{
                position: 'absolute', top: '0.5rem', left: '0.5rem', zIndex: 20,
                padding: '0.25rem 0.6rem', background: 'rgba(0, 0, 0, 0.7)',
                color: '#ff2d2d', fontFamily: 'monospace', fontWeight: 700,
                fontSize: '0.85rem', borderRadius: '0.2rem',
                pointerEvents: 'none',
                animation: 'rec-blink 1.2s steps(2, end) infinite',
              }}>
                ● REC
                <style jsx>{`
                  @keyframes rec-blink {
                    0%, 50%   { opacity: 1; }
                    50.01%, 100% { opacity: 0.3; }
                  }
                `}</style>
              </div>
            )}
          </div>

          {/* Presets */}
          <section style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '0.4rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Presets cinéma (shader)</h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map(key => (
                <button key={key} type="button" onClick={() => applyPreset(key)}
                  style={presetBtn}>{PRESET_LABELS[key]}</button>
              ))}
              <button type="button" onClick={reset} style={resetBtn}>Reset all</button>
            </div>
          </section>

          {/* Mouse tracking — record / play / clear (refonte 2026-05-15bx).
           * Flow : Record → countdown 3-2-1 → vidéo joue auto, suis la cible.
           * Stop auto à fin vidéo. Play replay la trajectoire. */}
          <section style={{
            marginTop: '0.75rem', padding: '0.75rem',
            border: '1px solid #ddd', borderRadius: '0.4rem',
          }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
              🎯 Mouse tracking (Record → countdown → suis la cible)
            </h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {tracker.mode === 'idle' && (
                <button
                  type="button"
                  onClick={tracker.start}
                  disabled={!videoUrl}
                  style={{
                    padding: '0.4rem 0.8rem', background: '#ff2d2d', color: '#fff',
                    border: 'none', borderRadius: '0.3rem',
                    cursor: videoUrl ? 'pointer' : 'not-allowed',
                    fontSize: '0.85rem', opacity: videoUrl ? 1 : 0.5,
                  }}
                >
                  ● Record
                </button>
              )}
              {tracker.mode === 'idle' && tracker.hasTrack && (
                <button
                  type="button"
                  onClick={tracker.play}
                  style={{
                    padding: '0.4rem 0.8rem', background: '#22c55e', color: '#fff',
                    border: 'none', borderRadius: '0.3rem', cursor: 'pointer', fontSize: '0.85rem',
                  }}
                >
                  ▶ Play tracking
                </button>
              )}
              {tracker.mode !== 'idle' && (
                <button
                  type="button"
                  onClick={tracker.stop}
                  style={{
                    padding: '0.4rem 0.8rem', background: '#333', color: '#fff',
                    border: 'none', borderRadius: '0.3rem', cursor: 'pointer', fontSize: '0.85rem',
                  }}
                >
                  ■ Stop
                </button>
              )}
              {tracker.hasTrack && tracker.mode === 'idle' && (
                <button
                  type="button"
                  onClick={tracker.clear}
                  style={presetBtn}
                >
                  Clear path
                </button>
              )}
              <span style={{ fontSize: '0.78rem', color: '#666' }}>
                Mode : <strong>{tracker.mode}</strong> · {tracker.points.length} points
              </span>
            </div>
            {/* Sliders config tracking (refonte 2026-05-15by) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.6rem', marginTop: '0.6rem' }}>
              <label style={{ display: 'grid', gridTemplateColumns: '7rem 1fr 3rem', gap: '0.4rem', alignItems: 'center', fontSize: '0.78rem' }}>
                <span>Taille zone</span>
                <input type="range" min={0.05} max={0.5} step={0.01} value={scopeSize}
                  onChange={e => setScopeSize(parseFloat(e.target.value))} style={{ width: '100%' }} />
                <span style={{ textAlign: 'right', fontFamily: 'monospace', color: '#666' }}>{scopeSize.toFixed(2)}</span>
              </label>
              <label style={{ display: 'grid', gridTemplateColumns: '7rem 1fr 3rem', gap: '0.4rem', alignItems: 'center', fontSize: '0.78rem' }}>
                <span>Vitesse vidéo</span>
                <input type="range" min={0.1} max={1} step={0.05} value={playbackRate}
                  onChange={e => setPlaybackRate(parseFloat(e.target.value))} style={{ width: '100%' }} />
                <span style={{ textAlign: 'right', fontFamily: 'monospace', color: '#666' }}>{playbackRate.toFixed(2)}×</span>
              </label>
            </div>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#888' }}>
              Active "Sniper scope" d'abord. Pendant le countdown, le mask est désactivé pour positionner la cible avec la croix. Au record, vidéo au ralenti ({playbackRate}×).
            </p>
          </section>
        </div>

        {/* Contrôles */}
        <section style={{
          padding: '1rem', border: '1px solid #ddd', borderRadius: '0.4rem',
          display: 'grid', gap: '0.5rem',
          maxHeight: '52rem', overflowY: 'auto',
        }}>
          <Group title="🎨 Color">
            <Slider label="Brightness" value={params.brightness ?? 0} min={-1} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, brightness: v }))} />
            <Slider label="Contrast" value={params.contrast ?? 0} min={-1} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, contrast: v }))} />
            <Slider label="Saturate" value={params.saturate ?? 0} min={-1} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, saturate: v }))} />
            <Slider label="Hue" value={params.hue ?? 0} min={-1} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, hue: v }))} />
          </Group>

          <Group title="🎬 Cinéma (shader)">
            <Slider label="Vignette" value={params.vignette ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, vignette: v }))} />
            <Slider label="Film grain" value={params.filmGrain ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, filmGrain: v }))} />
            <Slider label="Bloom" value={params.bloom ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, bloom: v }))} />
            <Slider label="Chrom. Aberr." value={params.chromaticAberration ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, chromaticAberration: v }))} />
            <Slider label="Sépia" value={params.sepia ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, sepia: v }))} />
            <Slider label="Color Average" value={params.colorAverage ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, colorAverage: v }))} />
            <Slider label="Color Depth" value={params.colorDepth ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, colorDepth: v }))} />
          </Group>

          <Group title="📺 Surveillance (shader)">
            <Slider label="Scanline" value={params.scanline ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, scanline: v }))} />
            <Slider label="DotScreen" value={params.dotScreen ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, dotScreen: v }))} />
            <Slider label="Grid" value={params.grid ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, grid: v }))} />
          </Group>

          <Group title="⚡ Glitch (shader)">
            <Slider label="Pixelate" value={params.pixelate ?? 0} min={0} max={1} step={0.01}
              onChange={v => setParams(p => ({ ...p, pixelate: v }))} />
            <label style={labelStyle}>
              <span>Glitch</span>
              <select
                value={params.glitch ?? 'off'}
                onChange={e => setParams(p => ({ ...p, glitch: e.target.value as VideoEffectsParams['glitch'] }))}
              >
                <option value="off">Off</option>
                <option value="sporadic">Sporadique</option>
                <option value="constant">Constant</option>
              </select>
            </label>
          </Group>

          <Group title="🎥 Overlays HTML">
            <Toggle label="Camcorder HUD" value={overlays.camcorder}
              onChange={v => setOverlays(o => ({ ...o, camcorder: v }))} />
            <label style={labelStyle}>
              <span>Letterbox</span>
              <select
                value={overlays.letterbox}
                onChange={e => setOverlays(o => ({ ...o, letterbox: e.target.value as OverlayState['letterbox'] }))}
              >
                <option value="off">Off</option>
                <option value="cinema_2.35">Cinéma 2.35:1</option>
                <option value="cinema_2.39">Cinéma 2.39:1</option>
                <option value="21_9">21:9</option>
                <option value="4_3">4:3 (carré-ish)</option>
              </select>
            </label>
            <Toggle label="Polaroid frame" value={overlays.polaroid}
              onChange={v => setOverlays(o => ({ ...o, polaroid: v }))} />
            <Toggle label="Phone frame" value={overlays.phone}
              onChange={v => setOverlays(o => ({ ...o, phone: v }))} />
            <Toggle label="Viewfinder (caméra)" value={overlays.viewfinder}
              onChange={v => setOverlays(o => ({ ...o, viewfinder: v }))} />
            <Toggle label="Old film (rayures)" value={overlays.oldFilm}
              onChange={v => setOverlays(o => ({ ...o, oldFilm: v }))} />
            <Toggle label="Light leaks" value={overlays.lightLeaks}
              onChange={v => setOverlays(o => ({ ...o, lightLeaks: v }))} />
            <Toggle label="Lens dirt" value={overlays.lensDirt}
              onChange={v => setOverlays(o => ({ ...o, lensDirt: v }))} />
            <Slider label="Bad signal" value={overlays.badSignal} min={0} max={1} step={0.01}
              onChange={v => setOverlays(o => ({ ...o, badSignal: v }))} />
            <label style={labelStyle}>
              <span>Sniper scope</span>
              <select
                value={overlays.sniperScope}
                onChange={e => setOverlays(o => ({ ...o, sniperScope: e.target.value as OverlayState['sniperScope'] }))}
              >
                <option value="off">Off</option>
                <option value="black">Réticule noir</option>
                <option value="red">Réticule rouge</option>
                <option value="green">Réticule vert (NV)</option>
              </select>
            </label>
          </Group>
        </section>
      </div>

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#888' }}>
        Test tous les effets seuls et combinés. Note les keepers (label exact). On nettoie après.
      </p>
    </div>
    </div>
  )
}

const presetBtn: React.CSSProperties = {
  padding: '0.4rem 0.8rem', background: '#f7f7f7',
  border: '1px solid #ccc', borderRadius: '0.3rem', cursor: 'pointer', fontSize: '0.85rem',
}
const resetBtn: React.CSSProperties = {
  padding: '0.4rem 0.8rem', background: '#fff',
  border: '1px solid #ec4899', color: '#ec4899',
  borderRadius: '0.3rem', cursor: 'pointer', fontSize: '0.85rem',
}
const labelStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '7rem 1fr', gap: '0.5rem',
  alignItems: 'center', fontSize: '0.78rem',
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: '1px solid #eee', paddingBottom: '0.5rem', marginBottom: '0.25rem' }}>
      <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>{children}</div>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '7rem 1fr 3rem', gap: '0.5rem', alignItems: 'center', fontSize: '0.78rem' }}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} style={{ width: '100%' }} />
      <span style={{ textAlign: 'right', fontFamily: 'monospace', color: '#666' }}>{value.toFixed(2)}</span>
    </label>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.78rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
