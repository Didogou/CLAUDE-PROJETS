'use client'
/**
 * AI Parser Playground — outil pour valider le system prompt Qwen.
 *
 * URL : /editor-test/ai-parser-playground
 *
 * Tape une requête FR, visualise ce que Qwen retourne (JSON brut + interprétation
 * "ce qu'on enverra à DINO/Florence"). But : itérer sur le system prompt jusqu'à
 * ce que toutes les requêtes types soient classifiées correctement.
 */

import React, { useState } from 'react'

// Requêtes de référence pour tester chaque pattern. Cliquer une remplit l'input.
const PRESETS: Array<{ label: string; query: string; expected: string }> = [
  // ── Patterns simples ──
  { label: 'Single', query: 'Extrais le canapé', expected: 'pattern=single, subject=sofa' },
  { label: 'Structural', query: 'Découpe la baie vitrée', expected: 'pattern=single (or structural), subject=glass door' },
  { label: 'Multi-instance', query: 'Extrais tous les fauteuils', expected: 'pattern=single, subject=armchair (DINO multi-instance)' },
  // ── Multi-class ──
  { label: 'Multi-class', query: 'Extrais le canapé et les coussins', expected: 'pattern=multi_class, subject=sofa . cushions' },
  { label: 'Multi-class 3', query: 'Découpe la lampe, le tableau et la plante', expected: 'pattern=multi_class, subject=lamp . painting . plant' },
  // ── Hierarchical (subject in container) ──
  { label: 'Hierarchical', query: 'Extrais les coussins qui sont sur le canapé', expected: 'pattern=hierarchical, subject=pillows, container=sofa' },
  { label: 'Hierarchical 2', query: 'Trouve les livres sur l\'étagère', expected: 'pattern=hierarchical, subject=books, container=shelf' },
  // ── Composite (container + subject in container) ──
  { label: 'Composite', query: 'Extrais le canapé et les coussins qui sont dessus', expected: 'pattern=composite, container=sofa, subject=pillows' },
  { label: 'Composite 2', query: 'Découpe la table avec les verres dessus', expected: 'pattern=composite, container=table, subject=glasses' },
  // ── Spatial filter ──
  { label: 'Spatial right', query: 'Extrais la plante à droite', expected: 'pattern=spatial_filter, subject=plant, zone=right' },
  { label: 'Spatial center', query: 'Découpe le fauteuil au centre', expected: 'pattern=spatial_filter, subject=armchair, zone=center' },
  { label: 'Spatial top', query: 'Trouve les nuages en haut', expected: 'pattern=spatial_filter, subject=clouds, zone=top' },
  // ── Edge cases ──
  { label: 'Adjacency', query: 'Extrais la lampe à côté du fauteuil', expected: 'pattern=hierarchical or spatial?, subject=lamp' },
  { label: 'Color descriptor', query: 'Extrais la voiture rouge', expected: 'pattern=single, subject=red car' },
  { label: 'Negation', query: 'Extrais tout sauf le canapé', expected: 'pattern=? not supported yet' },
]

export default function AIParserPlaygroundPage() {
  const [text, setText] = useState('Extrais le canapé et les coussins qui sont dessus')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; data: unknown; elapsedMs: number } | null>(null)

  async function run() {
    if (busy || !text.trim()) return
    setBusy(true)
    setResult(null)
    const startedAt = performance.now()
    try {
      const res = await fetch('/api/ai/parse-cut-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      const elapsedMs = Math.round(performance.now() - startedAt)
      setResult({ ok: res.ok, data, elapsedMs })
    } catch (err) {
      setResult({ ok: false, data: { error: err instanceof Error ? err.message : String(err) }, elapsedMs: 0 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 8 }}>🧠 AI Parser Playground</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Teste ce que Qwen NLU classifie depuis une requête utilisateur en français. Pas
        d'appel à ComfyUI — juste le parser. Itère sur le system prompt avant intégration prod.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left : input + presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Requête utilisateur (français)</label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={3}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 14 }}
            />
          </div>

          <button
            type="button"
            onClick={run}
            disabled={busy || !text.trim()}
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
            {busy ? 'Parsing en cours…' : '▶ Parser'}
          </button>

          <div>
            <label style={labelStyle}>Presets (cliquer pour remplir)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setText(p.query)}
                  style={presetStyle}
                  title={p.expected}
                >
                  <span style={{ color: '#a855f7', fontWeight: 600, fontSize: 10, minWidth: 90 }}>{p.label}</span>
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}>{p.query}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right : result */}
        <div>
          <label style={labelStyle}>Réponse Qwen</label>
          {!result && (
            <div style={emptyStateStyle}>Lance une requête pour voir la réponse parsée.</div>
          )}
          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: '#666' }}>
                ⏱ {result.elapsedMs} ms · {result.ok ? '✓ ok' : '✗ erreur'}
              </div>
              <pre style={{
                background: '#1a1a1a',
                color: '#9bf',
                padding: 16,
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.5,
                overflow: 'auto',
                maxHeight: 500,
              }}>{JSON.stringify(result.data, null, 2)}</pre>

              {result.ok && (
                <Interpretation data={result.data as Record<string, unknown>} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Interpretation({ data }: { data: Record<string, unknown> }) {
  const intent = String(data.intent ?? '')
  const objectEn = String(data.object_en ?? '')
  const engine = String(data.suggested_engine ?? '')
  const spatial = data.spatial as string | null

  let summary = ''
  if (engine === 'dino') {
    summary = `→ DINO + SAM 1 avec prompt "${objectEn}"`
  } else if (engine === 'florence_res') {
    summary = `→ Florence-2 RES avec phrase "${objectEn}"`
  } else if (engine === 'florence_ctpg') {
    summary = `→ Florence-2 CTPG multi-query, prompt "${objectEn}"`
  }

  return (
    <div style={{ background: '#f0f0ff', borderRadius: 6, padding: 12, fontSize: 13, lineHeight: 1.6 }}>
      <div><strong>Intent :</strong> {intent}</div>
      <div><strong>Engine routé :</strong> {engine}</div>
      <div><strong>object_en :</strong> <code>{objectEn}</code></div>
      {spatial && <div><strong>spatial filter :</strong> {String(spatial)}</div>}
      <div style={{ marginTop: 8, color: '#666', fontStyle: 'italic' }}>{summary}</div>
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

const presetStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 4,
  cursor: 'pointer',
  textAlign: 'left',
}

const emptyStateStyle: React.CSSProperties = {
  border: '2px dashed #ddd',
  borderRadius: 8,
  padding: 32,
  textAlign: 'center',
  color: '#888',
  fontSize: 13,
}
