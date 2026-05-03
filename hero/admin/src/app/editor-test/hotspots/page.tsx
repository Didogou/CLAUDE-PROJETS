'use client'
/**
 * Démo Hotspot conditionnel — primitive §7 (dernière MVP).
 * URL : http://localhost:3000/editor-test/hotspots
 *
 * Scène avec 5 hotspots qui montrent les capacités clés :
 *   1. Toujours visible + enabled  → porte qui mène à section suivante
 *   2. Visible toujours, enabled si a la clé → porte verrouillée
 *   3. Visible seulement si pas déjà fouillé → poubelle (flag dynamique)
 *   4. Visible si possède objet magique → coffre apparu
 *   5. Cache + reveal au clic → trésor caché
 *
 * Le moteur de conditions (lib/conditions-engine) et les composants d'UI
 * no-code (ConditionBuilder/ActionsEditor) sont prêts à être branchés
 * quand on passera en mode édition auteur.
 */

import React, { useState } from 'react'
import HotspotLayer, { type HotspotShape } from '@/components/image-editor/HotspotLayer'
import LightLayer from '@/components/image-editor/LightLayer'
import HudLayer, { type HudWidget } from '@/components/image-editor/HudLayer'
import { applyActions } from '@/lib/conditions-engine'
import type { Condition, PlayerState } from '@/types/conditions'
import type { Action, SideEffect } from '@/types/actions'

interface HotspotSpec {
  id: string
  label: string
  shape: HotspotShape
  visibleIf?: Condition
  enabledIf?: Condition
  actions: Action[]
  feedback?: {
    halo?: boolean
    haloColor?: string
    haloStyle?: 'glow' | 'border' | 'both'
    tooltip?: string
  }
}

const INITIAL_STATE: PlayerState = {
  inventory: {},
  stats: { reputation_johnny: 0, health: 10 },
  flags: {},
  visited: {},
  vars: {},
}

// 5 hotspots démonstratifs couvrant les cas d'usage principaux
const HOTSPOTS: HotspotSpec[] = [
  {
    id: 'door-exit',
    label: 'Porte de sortie',
    shape: { kind: 'rect', x: 0.08, y: 0.45, w: 0.08, h: 0.28 },
    actions: [
      { kind: 'navigate', section_id: 'section-exit' },
    ],
    feedback: { halo: true, haloColor: '#10B981', haloStyle: 'border', tooltip: 'Sortir par la porte' },
  },
  {
    id: 'door-locked',
    label: 'Porte verrouillée',
    shape: { kind: 'rect', x: 0.72, y: 0.35, w: 0.1, h: 0.4 },
    enabledIf: { kind: 'item', item_id: 'item-key' },
    actions: [
      { kind: 'take_item', item_id: 'item-key', quantity: 1 },
      { kind: 'set_flag', flag: 'door_unlocked', value: true },
      { kind: 'navigate', section_id: 'section-secret' },
    ],
    feedback: { halo: true, haloColor: '#ffb366', tooltip: 'Verrouillée — il faut une clé' },
  },
  {
    id: 'trash',
    label: 'Poubelle',
    shape: { kind: 'rect', x: 0.3, y: 0.6, w: 0.08, h: 0.2 },
    visibleIf: { kind: 'flag', flag: 'trash_searched', value: false },
    actions: [
      { kind: 'give_item', item_id: 'item-key' },
      { kind: 'set_flag', flag: 'trash_searched', value: true },
    ],
    feedback: { halo: true, haloColor: '#f97316', tooltip: 'Fouiller (à usage unique)' },
  },
  {
    id: 'chest-magic',
    label: 'Coffre magique',
    shape: { kind: 'circle', cx: 0.55, cy: 0.72, r: 0.07 },
    visibleIf: { kind: 'item', item_id: 'item-amulet' },
    actions: [
      { kind: 'give_item', item_id: 'item-gold', quantity: 50 },
      { kind: 'set_stat', stat: 'reputation_johnny', op: 'add', value: 2 },
      { kind: 'set_flag', flag: 'chest_opened', value: true },
    ],
    feedback: { halo: true, haloColor: '#a855f7', haloStyle: 'both', tooltip: 'Ouvrir le coffre' },
  },
  {
    id: 'hidden-treasure',
    label: 'Tableau',
    shape: { kind: 'rect', x: 0.45, y: 0.25, w: 0.1, h: 0.15 },
    actions: [
      { kind: 'give_item', item_id: 'item-amulet' },
      { kind: 'set_flag', flag: 'treasure_found', value: true },
    ],
    feedback: { halo: false, haloColor: '#ede9df', tooltip: 'Examiner le tableau' },
  },
]

export default function HotspotsTestPage() {
  const [state, setState] = useState<PlayerState>(INITIAL_STATE)
  const [log, setLog] = useState<string[]>([])
  const [debug, setDebug] = useState(true)
  const [bgUrl, setBgUrl] = useState('')

  function handleTrigger(id: string, actions: Action[]) {
    const { state: nextState, sideEffects } = applyActions(actions, state)
    setState(nextState)
    const summary = actions.map(a => describeAction(a)).join(' + ')
    const sideSummary = sideEffects.length > 0 ? ` → effets: ${sideEffects.map(describeSideEffect).join(', ')}` : ''
    setLog(l => [`✓ [${id}] ${summary}${sideSummary}`, ...l].slice(0, 20))
  }

  function reset() {
    setState(INITIAL_STATE)
    setLog([])
  }

  // HUD widgets qui reflètent le state
  const hudWidgets: HudWidget[] = [
    { kind: 'counter', id: 'gold',  anchor: 'top-right', icon: '💰', value: state.inventory['item-gold'] ?? 0, label: '$' },
    { kind: 'counter', id: 'key',   anchor: 'top-right', offsetY: 36, icon: '🔑', value: state.inventory['item-key'] ?? 0, label: 'clé' },
    { kind: 'counter', id: 'amul',  anchor: 'top-right', offsetY: 72, icon: '🔮', value: state.inventory['item-amulet'] ?? 0, label: 'amu.' },
    { kind: 'bar',     id: 'rep',   anchor: 'top-left',  icon: '⭐', label: 'Réputation', value: Math.max(0, Math.min(1, (state.stats.reputation_johnny ?? 0) / 5)), color: '#d4a84c', width: 140 },
  ]

  const bgStyle: React.CSSProperties = bgUrl.trim()
    ? { backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: 'linear-gradient(180deg, #2a1a1a 0%, #1a0a0a 100%)' }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>
          HotspotLayer — primitive §7 (cœur du moat)
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Zones cliquables conditionnelles qui déclenchent des cascades d&apos;actions via le moteur
          (evaluateCondition + applyActions). 5 hotspots démontrent les cas clés : visibilité conditionnelle,
          enabled conditionnel, cascade d&apos;actions, side effects (navigate).
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12 }}>
          {/* Scène avec hotspots */}
          <div style={{ position: 'relative', aspectRatio: '16/9', border: '1px solid #2a2a30', borderRadius: 8, overflow: 'hidden', ...bgStyle }}>
            {/* Ambiance */}
            <LightLayer position={{ x: 0.1, y: 0.55 }} color="#ff8c40" intensity={0.7} radius={180} mode="flicker" flickerAmount={0.3} speed={1.3} />
            <LightLayer position={{ x: 0.78, y: 0.4 }} color="#ffd580" intensity={0.6} radius={120} mode="pulse" flickerAmount={0.3} speed={0.8} />

            {/* Hotspots */}
            {HOTSPOTS.map(h => (
              <HotspotLayer
                key={h.id}
                id={h.id}
                label={h.label}
                shape={h.shape}
                visibleIf={h.visibleIf}
                enabledIf={h.enabledIf}
                actions={h.actions}
                feedback={h.feedback}
                state={state}
                onTrigger={handleTrigger}
                debug={debug}
              />
            ))}

            {/* HUD */}
            <HudLayer widgets={hudWidgets} />
          </div>

          {/* Panneau droit */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={sectionBox}>
              <div style={sectionTitle}>Panneau debug</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={debug} onChange={e => setDebug(e.target.checked)} />
                Afficher les contours debug (même hotspots cachés)
              </label>
              <button onClick={reset} style={{ ...btnStyle, marginTop: 8 }}>↻ Reset state</button>
            </div>

            <div style={sectionBox}>
              <div style={sectionTitle}>State courant</div>
              <pre style={preStyle}>{JSON.stringify(state, null, 2)}</pre>
            </div>

            <div style={sectionBox}>
              <div style={sectionTitle}>Log des déclenchements ({log.length})</div>
              <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                {log.length === 0 && <div style={{ color: '#6e6e85', fontStyle: 'italic' }}>Clique sur un hotspot pour voir les actions s&apos;exécuter.</div>}
                {log.map((l, i) => (
                  <div key={i} style={{ color: '#10B981', marginBottom: 2, lineHeight: 1.4 }}>{l}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Guide */}
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
          <HintBox label="🚪 Porte (vert)" text="Toujours cliquable. Navigate vers section-exit." />
          <HintBox label="🚪 Porte verrouillée (orange)" text="Visible mais non-cliquable tant que la clé n'est pas dans l'inventaire. Essaye : fouille la poubelle pour l'obtenir." />
          <HintBox label="🗑 Poubelle (orange)" text="Disparaît après clic (flag trash_searched). Donne la clé." />
          <HintBox label="💎 Coffre magique (violet)" text="Invisible jusqu'à ce que tu aies l'amulette. Clique sur le tableau pour la trouver." />
          <HintBox label="🖼 Tableau (discret)" text="Pas de halo visible (spot caché). Donne l'amulette." />
        </div>

        <div style={{ marginTop: 12 }}>
          <input type="url" value={bgUrl} onChange={e => setBgUrl(e.target.value)} placeholder="URL image de fond (optionnel)" style={inputStyle} />
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>Parcours de test recommandé :</strong>
          <ol style={{ margin: '6px 0 0 16px', lineHeight: 1.7 }}>
            <li>Au démarrage : 3 hotspots visibles (porte verte, porte orange, poubelle, tableau). Coffre invisible.</li>
            <li>Clique <b>Tableau</b> → gagne l&apos;amulette. Le <b>Coffre violet</b> apparaît.</li>
            <li>Clique <b>Poubelle</b> → gagne la clé. Poubelle disparaît.</li>
            <li>Clique <b>Porte orange</b> → maintenant active (enabledIf = a la clé). Consomme la clé + navigate.</li>
            <li>Clique <b>Coffre</b> → +50$, +2 réputation.</li>
            <li>Regarde le state muter à droite, le log s&apos;enrichir, le HUD refléter les changements.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

function HintBox({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ padding: 10, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 11, color: '#9898b4' }}>
      <div style={{ fontWeight: 600, color: '#ede9df', marginBottom: 3 }}>{label}</div>
      {text}
    </div>
  )
}

function describeAction(a: Action): string {
  switch (a.kind) {
    case 'give_item':    return `+${a.quantity ?? 1} ${a.item_id}`
    case 'take_item':    return `-${a.quantity ?? 1} ${a.item_id}`
    case 'set_flag':     return `${a.flag}=${a.value}`
    case 'set_stat':     return `${a.stat} ${a.op} ${a.value}`
    case 'set_var':      return `${a.var}=${JSON.stringify(a.value)}`
    case 'navigate':     return `→ ${a.section_id}`
    case 'start_dialog': return `dialog(${a.dialog_id})`
  }
}

function describeSideEffect(se: SideEffect): string {
  if (se.kind === 'navigate') return `navigate(${se.section_id})`
  return `dialog(${se.dialog_id})`
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: '#0d0d0d',
  color: '#ede9df',
  fontFamily: 'Inter, -apple-system, sans-serif',
}

const sectionBox: React.CSSProperties = {
  padding: 12,
  background: '#0f0f13',
  border: '1px solid #2a2a30',
  borderRadius: 6,
}

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#d4a84c',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  marginBottom: 8,
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  background: '#000',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#9898b4',
  fontSize: 10,
  fontFamily: 'JetBrains Mono, monospace',
  maxHeight: 200,
  overflow: 'auto',
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
  width: '100%',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
}
