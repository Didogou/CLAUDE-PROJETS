'use client'
/**
 * POC LTX 2.3 + IC LoRA Dual Characters
 * URL : http://localhost:3000/editor-test/ltx-dual-characters
 *
 * Test de l'animation cinématique multi-perso via :
 *   - LTX-Video 2.3 (Lightricks)
 *   - IC LoRA Dual Characters (MaqueAI / Civitai)
 *   - Gemma 3 12B text encoder
 *
 * Stack installée 2026-05-02 :
 *   - models/diffusion_models/ltx-2.3-22b-distilled-1.1-Q4_K_M.gguf (14.2 GB)
 *   - models/loras/ltxv/ltx2/ltx-2.3-22b-distilled-lora-384-1.1.safetensors (7.6 GB)
 *   - models/loras/LTX2.3-IC-LORA-Dual-Character.safetensors (312 MB)
 *   - models/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors (9.45 GB)
 *   - models/vae/ltx-2.3-22b-distilled_video_vae.safetensors (1.45 GB)
 *
 * ⚠ Sysmem fallback ON obligatoire (start_comfyui_lowvram.bat).
 * ⚠ Workflow JSON template à exporter depuis ComfyUI en API format.
 */

import React, { useState } from 'react'
import { runLtx23Dual, type Ltx23DualProgress } from '@/lib/comfyui-ltx-dual'

const COLORS = {
  bgPage:     '#0F0F12',
  bgSurface:  '#17171B',
  bgElevated: '#1F1F25',
  border:     'rgba(255,255,255,0.08)',
  textPrimary:'#FAFAFA',
  textMuted:  '#A1A1AA',
  textFaint:  '#71717A',
  accent:     '#EC4899',
  accentHover:'#DB2777',
  success:    '#10B981',
  warning:    '#F59E0B',
}

const DEFAULT_POSITIVE = `scene: A modern living room with floor-to-ceiling bay windows opening on a sunny garden, beige sofa and armchair around a wooden round table, warm sunlight streaming in.

characters: Duke is a young distinguished man wearing an elegant brown fedora hat, dark blue casual jacket, orange t-shirt. He sits on the left armchair holding a cigarette.

shot 1, medium close-up, 4 seconds, slow zoom in:
  Duke takes a slow drag from his cigarette, exhales smoke, looks contemplatively out the window.
shot 2, wide shot, 4 seconds, static camera:
  Duke turns his head towards camera and gives a slight knowing smile.`

const DEFAULT_NEGATIVE = 'pc game, console game, video game, cartoon, childish, ugly, distorted face, deformed hands, watermark, text, blurry'

export default function LtxDualCharactersPocPage() {
  const [imageUrl, setImageUrl] = useState('')
  const [positivePrompt, setPositivePrompt] = useState(DEFAULT_POSITIVE)
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progressLabel, setProgressLabel] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)

  async function handleGenerate() {
    if (!imageUrl.trim() || !positivePrompt.trim()) return
    setBusy(true); setError(null); setResultUrl(null); setElapsed(null)
    setProgressLabel('Démarrage…')
    const startedAt = Date.now()

    try {
      const result = await runLtx23Dual({
        imageUrl: imageUrl.trim(),
        positivePrompt,
        negativePrompt,
        // POC : skip extraction frames (page de test pure, pas de persistance)
        extractFrames: false,
        onProgress: (p: Ltx23DualProgress) => {
          if (p.label) setProgressLabel(p.label)
        },
      })
      setResultUrl(result.video_url)
      setElapsed(Math.round((Date.now() - startedAt) / 1000))
      setProgressLabel('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[POC ltx-dual] failed:', msg)
      setError(msg); setProgressLabel('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: COLORS.textPrimary }}>
            🎬 POC LTX 2.3 + IC LoRA Dual Characters
          </h1>
          <p style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 1.5, margin: 0 }}>
            Test cinématique multi-perso avec audio/lip-sync potentiel. Source = composite Hero (Duke + scène) ou
            n'importe quelle image. Prompt structuré scene/characters/shots. ~3-5 min/run sur 8 GB lowvram.
          </p>
        </header>

        {/* Image source */}
        <Section title="Image source" hint="URL Supabase ou drag image-here-later (TODO)">
          <input
            type="text"
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            placeholder="https://...supabase.co/.../composite_duke.png"
            style={inputStyle}
          />
          {imageUrl && (
            <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
              <img
                src={imageUrl}
                alt="source"
                style={{
                  maxWidth: 200, maxHeight: 120, objectFit: 'contain',
                  border: `1px solid ${COLORS.border}`, borderRadius: 6,
                  background: COLORS.bgElevated,
                }}
              />
              <span style={{ fontSize: 11, color: COLORS.textFaint }}>
                Preview de la source qui sera animée
              </span>
            </div>
          )}
        </Section>

        {/* Positive prompt */}
        <Section title="Prompt positif (structuré scene/characters/shots)" hint="Format reco par MaqueAI">
          <textarea
            value={positivePrompt}
            onChange={e => setPositivePrompt(e.target.value)}
            rows={14}
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}
          />
        </Section>

        {/* Negative prompt */}
        <Section title="Prompt négatif" hint="Court, anti-cartoon/anti-distortion">
          <textarea
            value={negativePrompt}
            onChange={e => setNegativePrompt(e.target.value)}
            rows={3}
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
          />
        </Section>

        {/* Generate */}
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy || !imageUrl.trim() || !positivePrompt.trim()}
            onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = COLORS.accentHover }}
            onMouseLeave={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = COLORS.accent }}
            style={{
              padding: '14px 28px',
              background: busy || !imageUrl.trim() || !positivePrompt.trim()
                ? COLORS.bgElevated : COLORS.accent,
              border: `1px solid ${busy || !imageUrl.trim() || !positivePrompt.trim() ? COLORS.border : COLORS.accent}`,
              borderRadius: 6,
              color: busy || !imageUrl.trim() || !positivePrompt.trim() ? COLORS.textFaint : '#fff',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
              cursor: busy || !imageUrl.trim() || !positivePrompt.trim() ? 'not-allowed' : 'pointer',
              transition: 'all 120ms',
            }}
          >
            {busy ? `${progressLabel || 'Génération…'}` : '🎬 Générer animation (~3-5 min)'}
          </button>
          {elapsed !== null && (
            <span style={{ color: COLORS.success, fontSize: 13 }}>
              ✓ Généré en {elapsed}s
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginTop: 16, padding: 12,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6, color: '#FCA5A5', fontSize: 13,
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Result */}
        {resultUrl && (
          <Section title="🎉 Résultat" hint="Vidéo animée">
            <video
              src={resultUrl}
              controls
              autoPlay
              loop
              style={{
                width: '100%', maxHeight: 600, objectFit: 'contain',
                border: `1px solid ${COLORS.border}`, borderRadius: 8,
                background: '#000',
              }}
            />
            <div style={{ marginTop: 8, fontSize: 11, color: COLORS.textFaint, fontFamily: 'monospace' }}>
              {resultUrl}
            </div>
          </Section>
        )}

        {/* État install */}
        <details style={{ marginTop: 32, padding: 12, background: COLORS.bgSurface, border: `1px solid ${COLORS.border}`, borderRadius: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: COLORS.textMuted }}>
            État install LTX 2.3 (cliquer pour déplier)
          </summary>
          <pre style={{ fontSize: 10, color: COLORS.textFaint, marginTop: 8, lineHeight: 1.6 }}>
{`models/diffusion_models/ltx-2.3-22b-distilled-1.1-Q4_K_M.gguf      14.2 GB ⏳
models/loras/ltxv/ltx2/ltx-2.3-22b-distilled-lora-384-1.1.safetensors 7.6 GB ✓
models/loras/LTX2.3-IC-LORA-Dual-Character.safetensors                312 MB ✓
models/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors             9.45 GB ⏳
models/vae/ltx-2.3-22b-distilled_video_vae.safetensors                1.45 GB ✓
custom_nodes/ComfyUI-LTXVideo                                          ✓ à jour

Workflow API format à exporter manuellement depuis ComfyUI :
1. Lancer start_comfyui_lowvram.bat
2. Drag : ComfyUI-LTXVideo/example_workflows/2.3/LTX-2.3_ICLoRA_Motion_Track_Distilled.json
3. Remplacer la LoRA Motion Track par LTX2.3-IC-LORA-Dual-Character.safetensors
4. Settings → Dev Mode → "Save (API Format)" → JSON à embarquer dans Hero`}
          </pre>
        </details>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
          {title}
        </span>
        {hint && <span style={{ fontSize: 10, color: COLORS.textFaint, fontStyle: 'italic' }}>· {hint}</span>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: COLORS.bgSurface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  color: COLORS.textPrimary,
  fontFamily: 'Inter, sans-serif',
  fontSize: 13, lineHeight: 1.5,
  outline: 'none',
  resize: 'vertical',
  boxSizing: 'border-box',
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: COLORS.bgPage,
  color: COLORS.textPrimary,
  fontFamily: 'Inter, -apple-system, sans-serif',
}
