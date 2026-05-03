'use client'
/**
 * Scene Analyzer Playground — version initiale épurée.
 *
 * Pipeline : Florence-2 dense_region_caption → liste de labels + bboxes,
 * puis pour chaque bbox : N×SAM 2 (avec bbox tight) → 1 mask PNG par objet.
 *
 * Cette page affiche les masks BRUTS via <img> (zéro CSS magique) pour qu'on
 * juge sur pièces. Les labels sont en input readOnly pour pouvoir les copier
 * dans ai-cut-playground en mode texte.
 */

import React, { useState } from 'react'

interface Detection {
  id: string
  label: string
  source?: 'dense' | 'od'
  bbox: [number, number, number, number]
  bbox_pixels: [number, number, number, number]
  mask_url: string | null
  error?: string
}

interface RawDetection {
  label: string
  bbox: [number, number, number, number]
  dropped_by_iou?: boolean
}

interface AnalysisResult {
  detections: Detection[]
  image_url: string
  analyzed_at: number
  image_size?: { width: number; height: number }
  filter_mode?: FilterMode
  extraction_strategy?: ExtractionStrategy
  extraction_prompt?: string
  extraction_extracted_words?: string[]
  kept?: number
  total_florence?: number
  total_od?: number
  total_merged?: number
  od_raw?: RawDetection[]
  dense_raw?: RawDetection[]
  cleaned_image_url?: string
  erase_debug?: {
    step: string
    raw_caption?: string
    parsed_count?: number
    after_filter_count?: number
    after_iou_count?: number
    error?: string
  }
}

type FilterMode = 'baseline' | 'area_strict' | 'keywords' | 'combined'
type ExtractionStrategy = 'none' | 'florence_od' | 'a_pure' | 'a_baseline' | 'b_qwen' | 'c_erase' | 'd_dino' | 'e_qwen_dino' | 'f_qwen_sam1hq' | 'g_florence_centerpoint' | 'h_florence_bbox_point'

const FILTERS: Array<{ id: FilterMode; label: string; hint: string }> = [
  { id: 'baseline',    label: 'Baseline (area < 0.85)',                hint: 'Élimine juste la caption globale 100%' },
  { id: 'area_strict', label: 'Option 1 — area stricte < 0.4',          hint: 'Vire les régions scéniques larges (~44% area)' },
  { id: 'keywords',    label: 'Option 2 — labels scéniques',            hint: 'area < 0.85 + label ne COMMENCE pas par "modern living room", "view of", etc.' },
  { id: 'combined',    label: 'Option 3 — combiné (1+2)',               hint: 'area < 0.4 + pas de label scénique' },
]

const STRATEGIES: Array<{ id: ExtractionStrategy; label: string; hint: string }> = [
  { id: 'none',        label: 'Aucun (dense_region seul)',     hint: 'Pas de 2ème pass, juste les 9-10 régions Florence' },
  { id: 'florence_od', label: 'Florence <OD> (COCO)',          hint: 'Ancien path, limité à COCO, ne trouve pas les pillows' },
  { id: 'a_pure',      label: 'A — extraction "with X" pure',  hint: 'Regex sur les descriptions Florence, filtrée par stop list' },
  { id: 'a_baseline',  label: 'A + baseline (recommandé)',     hint: 'A + objets d\'intérieur courants (pillow, lamp, vase…)' },
  { id: 'b_qwen',      label: 'B — Qwen sémantique',           hint: 'Qwen analyse les descriptions et liste les objets standalone' },
  { id: 'c_erase',     label: 'C — erase + re-Florence',        hint: 'Efface les masks primaires de l\'image et re-run Florence pour trouver les objets cachés (pillows, lamps…)' },
  { id: 'd_dino',      label: 'D — DINO multi-instance',        hint: 'GroundingDINO open-vocab. 1 appel par class extraite (pillow, cushion, lamp…). Multi-instance natif.' },
  { id: 'e_qwen_dino', label: 'E — Qwen + DINO (only DINO)',     hint: 'Qwen nettoie les descriptions Florence (objets sans couleurs/matériaux), dedup, DINO multi-instance. JETTE les Florence dense_region, garde uniquement DINO.' },
  { id: 'f_qwen_sam1hq', label: 'F — Qwen + DINO+SAM 1 HQ (= ai-cut-playground)', hint: 'Aligné sur ai-cut-playground : Qwen → DINO+SAM 1 HQ (storyicon, threshold 0.30). Bords nets, multi-instance natif.' },
  { id: 'g_florence_centerpoint', label: 'G — Florence center + SAM point (Option 1)', hint: 'TEST : centre de chaque bbox Florence → SAM 2 point-prompt (bbox ignorée). Re-validation honnête de l\'approche originale.' },
  { id: 'h_florence_bbox_point', label: 'H — Florence bbox + center point (Option 3)', hint: 'TEST : bbox Florence + centre comme point positif simultanément. Best-of-both : bbox contraint, point identifie l\'objet dominant.' },
]

const SAMPLE_IMAGES = [
  {
    label: 'Salon canapé baie vitrée',
    url: 'https://mgdaydimtlletsoedntn.supabase.co/storage/v1/object/public/images/test-scenes/int_living_bay_day_juggernaut_1777096855927.png',
  },
]

export default function SceneAnalyzerPage() {
  const [imageUrl, setImageUrl] = useState(SAMPLE_IMAGES[0].url)
  const [model, setModel] = useState<'base' | 'large'>('large')
  const [filterMode, setFilterMode] = useState<FilterMode>('baseline')
  const [strategy, setStrategy] = useState<ExtractionStrategy>('a_baseline')
  const [groupByClass, setGroupByClass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)

  async function analyze() {
    if (busy || !imageUrl) return
    setBusy(true)
    setError(null)
    setResult(null)
    const startedAt = performance.now()
    try {
      const res = await fetch('/api/comfyui/analyze-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          model,
          filter_mode: filterMode,
          extraction_strategy: strategy,
          group_by_class: groupByClass,
        }),
      })
      const data = await res.json()
      setElapsedMs(Math.round(performance.now() - startedAt))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
        return
      }
      setResult(data as AnalysisResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const allLabels = result?.detections.map(d => d.label).join('\n') ?? ''
  const successCount = result?.detections.filter(d => d.mask_url).length ?? 0
  const totalCount = result?.detections.length ?? 0

  return (
    <div style={{ padding: 24, maxWidth: 1500, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 8 }}>🔍 Scene Analyzer (version brute)</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14, lineHeight: 1.5 }}>
        Pipeline : Florence-2 dense_region_caption → N×SAM 2 (bbox tight). Chaque mask est affiché en
        <code> &lt;img&gt; </code> brut, pas de mask-image CSS — on voit ce qui sort réellement.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24 }}>
        {/* Left : controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Image source</label>
            <input
              type="text"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              style={inputStyle}
            />
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SAMPLE_IMAGES.map((s, i) => (
                <button key={i} type="button" onClick={() => setImageUrl(s.url)} style={pillStyle}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Florence-2 model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value as 'base' | 'large')}
              style={inputStyle}
            >
              <option value="base">base (270MB) — rapide</option>
              <option value="large">large (770MB) — meilleure précision</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Filtre des détections</label>
            <select
              value={filterMode}
              onChange={e => setFilterMode(e.target.value as FilterMode)}
              style={inputStyle}
            >
              {FILTERS.map(f => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              {FILTERS.find(f => f.id === filterMode)?.hint}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Stratégie petits objets (2ème pass)</label>
            <select
              value={strategy}
              onChange={e => setStrategy(e.target.value as ExtractionStrategy)}
              style={inputStyle}
            >
              {STRATEGIES.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              {STRATEGIES.find(s => s.id === strategy)?.hint}
            </div>
          </div>

          <div>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              cursor: 'pointer',
              padding: '8px 10px',
              background: groupByClass ? '#f5f0ff' : '#fff',
              border: `1px solid ${groupByClass ? '#a855f7' : '#ccc'}`,
              borderRadius: 6,
            }}>
              <input
                type="checkbox"
                checked={groupByClass}
                onChange={e => setGroupByClass(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Grouper par classe</span>
            </label>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              Si ON : 1 card par classe avec mask combiné (ex: tous les pillows ensemble). Si OFF : 1 card par instance.
            </div>
          </div>

          <button
            type="button"
            onClick={analyze}
            disabled={busy || !imageUrl}
            style={{
              ...inputStyle,
              background: busy ? '#aaa' : '#a855f7',
              color: 'white',
              border: 'none',
              cursor: busy ? 'wait' : 'pointer',
              fontWeight: 600,
              padding: '10px',
            }}
          >
            {busy ? 'Analyse en cours… (~1-2 min)' : '▶ Analyser la scène'}
          </button>

          {imageUrl && (
            // Image source brute, sans overlay
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="source" style={{ width: '100%', borderRadius: 8, border: '1px solid #ddd' }} />
          )}

          {result?.cleaned_image_url && (
            <div>
              <label style={{ ...labelStyle, color: '#a855f7' }}>Image cleanée (input 2ème Florence)</label>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.cleaned_image_url} alt="cleaned" style={{ width: '100%', borderRadius: 8, border: '1px solid #a855f7' }} />
            </div>
          )}

          {result?.erase_debug && (
            <div>
              <label style={{ ...labelStyle, color: '#a855f7' }}>Debug c_erase</label>
              <div style={{
                background: '#fff8e6',
                border: '1px solid #f5d878',
                borderRadius: 6,
                padding: 8,
                fontSize: 11,
                fontFamily: 'monospace',
              }}>
                <div>step : <strong>{result.erase_debug.step}</strong></div>
                {typeof result.erase_debug.parsed_count === 'number' && (
                  <div>parsed : {result.erase_debug.parsed_count} → après filtre : {result.erase_debug.after_filter_count} → après IoU : {result.erase_debug.after_iou_count}</div>
                )}
                {result.erase_debug.error && (
                  <div style={{ color: '#c00', marginTop: 4 }}>error : {result.erase_debug.error.slice(0, 200)}</div>
                )}
                {result.erase_debug.raw_caption && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', color: '#666' }}>raw caption Florence 2</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10, marginTop: 4, maxHeight: 160, overflow: 'auto' }}>
                      {result.erase_debug.raw_caption}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          )}

          {error && (
            <div style={{ background: '#fee', border: '1px solid #fcc', borderRadius: 6, padding: 10, fontSize: 12, color: '#900' }}>
              <strong>Erreur :</strong>
              <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 11 }}>{error}</pre>
            </div>
          )}

          {result && (
            <div style={{ background: '#f0f0ff', borderRadius: 6, padding: 10, fontSize: 12 }}>
              <div><strong>{successCount} / {totalCount} masks générés</strong></div>
              {typeof result.total_florence === 'number' && (
                <div style={{ color: '#666', fontSize: 11 }}>
                  🎯 filtre <code>{result.filter_mode}</code> : {result.kept} gardés
                </div>
              )}
              {typeof result.total_florence === 'number' && (
                <div style={{ color: '#666', fontSize: 11 }}>
                  📊 dense_region : {result.total_florence} · 2nd pass : {result.total_od ?? 0} · merged : {result.total_merged ?? 0}
                </div>
              )}
              {result.extraction_strategy && (
                <div style={{ color: '#666', fontSize: 11 }}>
                  🎯 stratégie : <code>{result.extraction_strategy}</code>
                </div>
              )}
              {result.extraction_prompt && (
                <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
                  📝 prompt CTPG : <code style={{ background: '#fff', padding: '1px 4px', borderRadius: 3 }}>{result.extraction_prompt}</code>
                </div>
              )}
              <div style={{ color: '#666', fontSize: 11 }}>⏱ {elapsedMs} ms total</div>
              {result.image_size && (
                <div style={{ color: '#666', fontSize: 11 }}>📐 {result.image_size.width}×{result.image_size.height}px</div>
              )}
            </div>
          )}

          {result && totalCount > 0 && (
            <div>
              <label style={labelStyle}>Tous les labels (copiable)</label>
              <textarea
                readOnly
                value={allLabels}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, minHeight: 140 }}
              />
            </div>
          )}

          {result && result.od_raw && result.od_raw.length > 0 && (
            <div>
              <label style={labelStyle}>Florence &lt;OD&gt; brut ({result.od_raw.length})</label>
              <div style={{
                background: '#fff8e6',
                border: '1px solid #f5d878',
                borderRadius: 6,
                padding: 8,
                fontSize: 11,
                fontFamily: 'monospace',
                maxHeight: 220,
                overflowY: 'auto',
              }}>
                {result.od_raw.map((r, i) => (
                  <div key={i} style={{
                    padding: '3px 0',
                    borderBottom: '1px dashed #eee',
                    color: r.dropped_by_iou ? '#c00' : '#080',
                  }}>
                    <strong>{r.label}</strong>
                    <span style={{ color: '#888', marginLeft: 8 }}>
                      [{r.bbox.map(v => v.toFixed(2)).join(', ')}]
                    </span>
                    {r.dropped_by_iou
                      ? <span style={{ color: '#c00', marginLeft: 6 }}>✗ dropped (IoU)</span>
                      : <span style={{ color: '#080', marginLeft: 6 }}>✓ kept</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right : detections */}
        <div>
          <label style={labelStyle}>Masks générés (PNG bruts depuis Supabase)</label>
          {!result && !busy && (
            <div style={emptyStateStyle}>Lance l&apos;analyse pour voir les masks.</div>
          )}
          {busy && (
            <div style={{ ...emptyStateStyle, color: '#a855f7' }}>
              <div style={{ fontSize: 24 }}>⏳</div>
              <div style={{ marginTop: 8 }}>Florence + N×SAM 2 en cours…</div>
            </div>
          )}
          {result && totalCount === 0 && (
            <div style={emptyStateStyle}>Aucun objet détecté.</div>
          )}
          {result && totalCount > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
            }}>
              {result.detections.map((d, i) => (
                <div
                  key={d.id}
                  style={{
                    border: '1px solid #ddd',
                    borderRadius: 8,
                    background: '#fff',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{
                    background: '#222',
                    padding: 6,
                    color: '#888',
                    fontSize: 9,
                    fontFamily: 'monospace',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <span>#{i + 1} · bbox {d.bbox_pixels.join(',')}</span>
                    <span style={{
                      padding: '1px 6px',
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 600,
                      background: d.source === 'od' ? '#a855f7' : '#3b82f6',
                      color: 'white',
                    }}>
                      {d.source === 'od' ? 'OD' : 'DENSE'}
                    </span>
                  </div>
                  {d.mask_url ? (
                    <>
                      {/* 1. EXTRACTION : source × mask via SVG (alignement explicite par viewBox) */}
                      {result.image_size && (
                        <div style={{
                          backgroundColor: '#fff',
                          backgroundImage:
                            'linear-gradient(45deg, #ddd 25%, transparent 25%), ' +
                            'linear-gradient(-45deg, #ddd 25%, transparent 25%), ' +
                            'linear-gradient(45deg, transparent 75%, #ddd 75%), ' +
                            'linear-gradient(-45deg, transparent 75%, #ddd 75%)',
                          backgroundSize: '12px 12px',
                          backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
                        }}>
                          <svg
                            viewBox={`0 0 ${result.image_size.width} ${result.image_size.height}`}
                            preserveAspectRatio="xMidYMid meet"
                            style={{ width: '100%', height: 'auto', display: 'block' }}
                          >
                            <defs>
                              <mask id={`mask-${d.id}`}>
                                <image
                                  href={d.mask_url}
                                  x="0"
                                  y="0"
                                  width={result.image_size.width}
                                  height={result.image_size.height}
                                />
                              </mask>
                            </defs>
                            <image
                              href={imageUrl}
                              x="0"
                              y="0"
                              width={result.image_size.width}
                              height={result.image_size.height}
                              mask={`url(#mask-${d.id})`}
                            />
                          </svg>
                        </div>
                      )}
                      {/* 2. MASK BRUT (silhouette binaire) en plus petit pour vérification */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={d.mask_url}
                        alt={`mask ${i}`}
                        style={{
                          width: '100%',
                          height: 'auto',
                          display: 'block',
                          background: '#000',
                          borderTop: '1px solid #333',
                          opacity: 0.85,
                        }}
                      />
                    </>
                  ) : (
                    <div style={{
                      padding: 30,
                      textAlign: 'center',
                      background: '#fee',
                      color: '#c00',
                      fontSize: 11,
                    }}>
                      ✗ pas de mask
                      {d.error && <div style={{ fontSize: 9, marginTop: 4, opacity: 0.7 }}>{d.error.slice(0, 80)}</div>}
                    </div>
                  )}
                  <div style={{ padding: 8, borderTop: '1px solid #eee' }}>
                    <input
                      readOnly
                      value={d.label}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        border: '1px solid #ccc',
                        borderRadius: 4,
                        fontSize: 12,
                        fontFamily: 'monospace',
                        background: '#f9f9f9',
                        color: '#222',
                        boxSizing: 'border-box',
                      }}
                      onFocus={e => e.target.select()}
                    />
                    {d.mask_url && (
                      <a
                        href={d.mask_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'block', fontSize: 10, marginTop: 4, color: '#a855f7' }}
                      >
                        ↗ ouvrir le PNG mask dans un onglet
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#444',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #ccc',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'system-ui, sans-serif',
  boxSizing: 'border-box',
}

const pillStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '4px 10px',
  border: '1px solid #ddd',
  borderRadius: 999,
  background: '#fff',
  cursor: 'pointer',
  color: '#444',
}

const emptyStateStyle: React.CSSProperties = {
  border: '2px dashed #ddd',
  borderRadius: 8,
  padding: 32,
  textAlign: 'center',
  color: '#888',
  fontSize: 13,
}
