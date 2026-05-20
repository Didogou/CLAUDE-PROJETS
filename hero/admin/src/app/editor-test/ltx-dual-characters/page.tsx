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

import React, { useEffect, useState } from 'react'
import { runLtx23Dual, type Ltx23DualProgress } from '@/lib/comfyui-ltx-dual'

interface ElevenVoice {
  voice_id: string
  name: string
  category?: string
  labels: Record<string, string>
  preview_url: string | null
}

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

const DEFAULT_POSITIVE = `scene: A grand victorian library at golden hour, tall arched windows let warm afternoon light flood the room, dark wood bookshelves line the walls, a crystal chandelier hangs from the ceiling, an oxblood leather sofa with red embroidered cushions, a thick crimson rug on dark wood floor.

characters: Duke is a tall man in a long brown leather duster coat and brown cowboy hat, white shirt, black bolo tie, holding a glass of amber whiskey in his right hand, standing on the left side of the room. Epsi is a young woman with short wavy black hair, wearing an elegant strapless emerald green dress, sitting upright on the leather sofa on the right side, hands folded in her lap.

shot 1, medium shot of Duke, 4 seconds, static camera:
  Duke stands tall, raises his glass slightly toward Epsi on the sofa, looks at her with a faintly reproachful expression and says (in French):
  "Je t'ai dit de revenir plus tôt, tu ne m'as pas écouté."

shot 2, medium close-up on Epsi, 4 seconds, slow zoom in:
  Epsi lifts her gaze to Duke, eyes calm but defiant, a soft sad smile, and replies (in French):
  "J'avais peur de ce que j'allais trouver."`

const DEFAULT_NEGATIVE = 'pc game, console game, video game, cartoon, childish, ugly, distorted face, deformed hands, watermark, text, blurry'

export default function LtxDualCharactersPocPage() {
  const [imageUrl, setImageUrl] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [positivePrompt, setPositivePrompt] = useState(DEFAULT_POSITIVE)
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progressLabel, setProgressLabel] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)

  // ── ElevenLabs TTS state (multi-segments pour dialogue à plusieurs voix) ─
  const [voices, setVoices] = useState<ElevenVoice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [voicesError, setVoicesError] = useState<string | null>(null)
  /** Liste de segments TTS à générer dans l'ordre. Chaque segment = 1 voix +
   *  1 texte. Tous concaténés en 1 mp3 final qu'on passe à LTX. */
  const [ttsSegments, setTtsSegments] = useState<{ voiceId: string; text: string }[]>([
    { voiceId: '', text: '' },
    { voiceId: '', text: '' },
  ])
  const [generatingTts, setGeneratingTts] = useState(false)

  // Charge la liste des voix au mount + préselect la 1ère voix dans tous les
  // segments (les segments sans voix sélectionnée prennent la défaut).
  useEffect(() => {
    let aborted = false
    async function loadVoices() {
      setVoicesLoading(true); setVoicesError(null)
      try {
        const res = await fetch('/api/elevenlabs/voices')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { voices?: ElevenVoice[]; error?: string }
        if (data.error) throw new Error(data.error)
        if (aborted) return
        const list = data.voices ?? []
        setVoices(list)
        if (list.length > 0) {
          // Préselect 1ère voix dans tous les segments encore vides (UX —
          // user n'a qu'à choisir s'il veut une autre voix)
          setTtsSegments(prev => prev.map(s => s.voiceId ? s : { ...s, voiceId: list[0].voice_id }))
        }
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        setVoicesError(msg)
      } finally {
        if (!aborted) setVoicesLoading(false)
      }
    }
    void loadVoices()
    return () => { aborted = true }
  }, [])

  function updateSegment(idx: number, patch: Partial<{ voiceId: string; text: string }>) {
    setTtsSegments(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }
  function addSegment() {
    setTtsSegments(prev => [
      ...prev,
      { voiceId: voices[0]?.voice_id ?? '', text: '' },
    ])
  }
  function removeSegment(idx: number) {
    setTtsSegments(prev => prev.filter((_, i) => i !== idx))
  }

  /** Génère N audios TTS en parallèle puis les concatène en 1 fichier final
   *  qui devient l'audioUrl. Les segments vides (texte = '') sont ignorés. */
  async function handleGenerateTts() {
    const filled = ttsSegments
      .map((s, i) => ({ ...s, originalIdx: i }))
      .filter(s => s.voiceId && s.text.trim())
    if (filled.length === 0 || generatingTts) return
    setGeneratingTts(true); setError(null)
    try {
      const ts = Date.now()
      // Génère tous les TTS en parallèle (ElevenLabs gère le concurrent)
      const ttsResults = await Promise.all(filled.map(async (seg, i) => {
        const r = await fetch('/api/elevenlabs/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voice_id: seg.voiceId,
            text: seg.text.trim(),
            save_path: `test/ltx-dual/tts_${ts}_seg${i}`,
          }),
        })
        const d = await r.json() as { url?: string; error?: string }
        if (!r.ok || !d.url) throw new Error(`segment ${i + 1}: ${d.error ?? `HTTP ${r.status}`}`)
        return d.url
      }))

      // Si 1 seul segment → on l'utilise direct (pas la peine de concat)
      if (ttsResults.length === 1) {
        setAudioUrl(ttsResults[0])
        return
      }

      // Concat des N mp3 via la route serveur
      const cRes = await fetch('/api/audio/concat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: ttsResults,
          path: `test/ltx-dual/concat_${ts}.mp3`,
        }),
      })
      const cData = await cRes.json() as { url?: string; error?: string }
      if (!cRes.ok || !cData.url) throw new Error(`concat: ${cData.error ?? `HTTP ${cRes.status}`}`)
      setAudioUrl(cData.url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[POC ltx-dual] TTS pipeline failed:', msg)
      setError(`TTS / concat échoué : ${msg}`)
    } finally {
      setGeneratingTts(false)
    }
  }

  /** Upload un File vers Supabase via la route adaptée et set l'URL résultat. */
  async function uploadFile(
    file: File,
    kind: 'image' | 'audio',
  ): Promise<void> {
    const setUrl = kind === 'image' ? setImageUrl : setAudioUrl
    const setUploading = kind === 'image' ? setUploadingImage : setUploadingAudio
    const route = kind === 'image' ? '/api/storage/upload-image' : '/api/storage/upload-audio'
    setUploading(true); setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
        reader.readAsDataURL(file)
      })
      const ext = (file.name.split('.').pop() || (kind === 'image' ? 'png' : 'mp3')).toLowerCase()
      const path = `test/ltx-dual/${kind}_${Date.now()}.${ext}`
      const res = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error ?? `HTTP ${res.status}`)
      setUrl(data.url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[POC ltx-dual] upload ${kind} failed:`, msg)
      setError(`Upload ${kind} échoué : ${msg}`)
    } finally {
      setUploading(false)
    }
  }

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
        // Custom audio (lipsync) — si fourni, bascule le builder sur le
        // workflow audio ; sinon mode foley généré.
        audioUrl: audioUrl.trim() || undefined,
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

        {/* Image source — upload local OU URL collée */}
        <Section title="Image source" hint="Importe un fichier OU colle une URL Supabase">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={fileBtnStyle(uploadingImage)}>
              {uploadingImage ? 'Upload…' : '📁 Importer une image'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                disabled={uploadingImage}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) void uploadFile(f, 'image')
                  e.target.value = ''
                }}
              />
            </label>
            <span style={{ fontSize: 11, color: COLORS.textFaint }}>ou</span>
            <input
              type="text"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://...supabase.co/.../composite.png"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
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

        {/* Génération TTS multi-voix via ElevenLabs (auto-concat des segments) */}
        <Section
          title="Générer un audio via ElevenLabs (multi-voix)"
          hint="Ajoute autant de segments que de répliques. Chaque segment = 1 voix + 1 texte. Tous concaténés dans l'ordre → 1 seul mp3 attaché."
        >
          {voicesLoading ? (
            <div style={{ fontSize: 12, color: COLORS.textFaint }}>Chargement des voix…</div>
          ) : voicesError ? (
            <div style={{ fontSize: 12, color: '#FCA5A5' }}>⚠ {voicesError}</div>
          ) : voices.length === 0 ? (
            <div style={{ fontSize: 12, color: COLORS.textFaint }}>Aucune voix disponible (vérifie ELEVENLABS_API_KEY)</div>
          ) : (
            <>
              {ttsSegments.map((seg, idx) => {
                const v = voices.find(x => x.voice_id === seg.voiceId)
                return (
                  <div
                    key={idx}
                    style={{
                      padding: 10, marginBottom: 8,
                      background: COLORS.bgSurface,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: COLORS.accent,
                        textTransform: 'uppercase', letterSpacing: 0.6,
                        minWidth: 60,
                      }}>
                        Segment {idx + 1}
                      </span>
                      <select
                        value={seg.voiceId}
                        onChange={e => updateSegment(idx, { voiceId: e.target.value })}
                        style={{ ...inputStyle, flex: 1, cursor: 'pointer', padding: '6px 10px' }}
                        disabled={generatingTts}
                      >
                        {voices.map(vv => (
                          <option key={vv.voice_id} value={vv.voice_id}>
                            {vv.name}
                            {vv.labels.gender ? ` · ${vv.labels.gender}` : ''}
                            {vv.labels.accent ? ` · ${vv.labels.accent}` : ''}
                          </option>
                        ))}
                      </select>
                      {v?.preview_url && (
                        <audio controls src={v.preview_url} style={{ height: 28 }} />
                      )}
                      {ttsSegments.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSegment(idx)}
                          disabled={generatingTts}
                          style={{
                            ...fileBtnStyle(generatingTts),
                            padding: '6px 10px',
                            color: '#FCA5A5',
                          }}
                          title="Supprimer ce segment"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <textarea
                      value={seg.text}
                      onChange={e => updateSegment(idx, { text: e.target.value })}
                      placeholder={
                        idx === 0
                          ? `Réplique ${idx + 1} — ex: « Je t'ai dit de revenir plus tôt, tu ne m'as pas écouté. »`
                          : `Réplique ${idx + 1} — ex: « J'avais peur de ce que j'allais trouver. »`
                      }
                      rows={2}
                      style={{ ...inputStyle, fontFamily: 'inherit' }}
                      disabled={generatingTts}
                    />
                  </div>
                )
              })}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => { void handleGenerateTts() }}
                  disabled={generatingTts || ttsSegments.every(s => !s.text.trim())}
                  style={fileBtnStyle(generatingTts || ttsSegments.every(s => !s.text.trim()))}
                >
                  {generatingTts ? 'Génération + concat…' : `🎤 Générer + concaténer (${ttsSegments.filter(s => s.text.trim()).length} segment${ttsSegments.filter(s => s.text.trim()).length > 1 ? 's' : ''})`}
                </button>
                <button
                  type="button"
                  onClick={addSegment}
                  disabled={generatingTts}
                  style={fileBtnStyle(generatingTts)}
                >
                  + Ajouter un segment
                </button>
                <span style={{ fontSize: 11, color: COLORS.textFaint }}>
                  L&apos;audio final sera placé automatiquement ci-dessous.
                </span>
              </div>
            </>
          )}
        </Section>

        {/* Custom audio (lipsync) — optionnel */}
        <Section
          title="Audio custom (lipsync) — optionnel"
          hint="Importe un mp3/wav OU colle une URL. Si présent, active le workflow lipsync Vantage. Sinon mode foley généré."
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={fileBtnStyle(uploadingAudio)}>
              {uploadingAudio ? 'Upload…' : '🎵 Importer un audio'}
              <input
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                disabled={uploadingAudio}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) void uploadFile(f, 'audio')
                  e.target.value = ''
                }}
              />
            </label>
            <span style={{ fontSize: 11, color: COLORS.textFaint }}>ou</span>
            <input
              type="text"
              value={audioUrl}
              onChange={e => setAudioUrl(e.target.value)}
              placeholder="https://...supabase.co/.../dialogue.mp3 (vide = mode foley)"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
          {audioUrl && (
            <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
              <audio controls src={audioUrl} style={{ height: 32 }} />
              <span style={{ fontSize: 11, color: COLORS.warning }}>
                ⚠ Mode lipsync activé
              </span>
            </div>
          )}
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

function fileBtnStyle(busy: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 14px',
    background: busy ? COLORS.bgElevated : COLORS.bgSurface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    color: busy ? COLORS.textFaint : COLORS.textPrimary,
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    cursor: busy ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 120ms',
  }
}
