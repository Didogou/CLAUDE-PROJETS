'use client'
/**
 * Démo isolée du moteur conditions + actions.
 * URL : http://localhost:3000/editor-test/conditions
 *
 * Permet de construire visuellement une condition et une cascade d'actions,
 * puis de tester l'évaluation contre un PlayerState factice. Sert aussi de
 * doc vivante pour valider l'UX avant intégration dans l'éditeur de Choice.
 */

import React, { useState } from 'react'
import ConditionBuilder, { ConditionBuilderDatalists } from '@/components/conditions/ConditionBuilder'
import ActionsEditor from '@/components/conditions/ActionsEditor'
import { evaluateCondition, applyActions } from '@/lib/conditions-engine'
import type { Condition, PlayerState } from '@/types/conditions'
import type { Action } from '@/types/actions'

// ── Données factices (mocks) ────────────────────────────────────────────

const MOCK_ITEMS = [
  { id: 'item-key-tavern', name: 'Clé de la taverne' },
  { id: 'item-colt',       name: 'Colt Python .357' },
  { id: 'item-note',       name: 'Note de Johnny' },
  { id: 'item-cash',       name: 'Liasse de billets' },
]

const MOCK_SECTIONS = [
  { id: 'section-1',  number: 1 },
  { id: 'section-12', number: 12 },
  { id: 'section-42', number: 42 },
  { id: 'section-57', number: 57 },
]

const INITIAL_STATE: PlayerState = {
  inventory: { 'item-cash': 1 },
  stats: { reputation_johnny: 2, health: 10 },
  flags: { intro_seen: true },
  visited: { 'section-1': true },
  vars: {},
}

export default function ConditionsDemoPage() {
  const [condition, setCondition] = useState<Condition | undefined>(undefined)
  const [actions, setActions] = useState<Action[]>([])
  const [state, setState] = useState<PlayerState>(INITIAL_STATE)

  const conditionResult = condition ? evaluateCondition(condition, state) : null
  const applyResult = actions.length > 0 ? applyActions(actions, state) : null

  const context = { items: MOCK_ITEMS, sections: MOCK_SECTIONS, knownStats: ['reputation_johnny', 'health', 'money'], knownFlags: ['intro_seen', 'trash_searched_s12'] }

  return (
    <div style={pageStyle}>
      <ConditionBuilderDatalists context={context} />

      <div style={{ maxWidth: 1300, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: '.5rem' }}>
          Moteur conditions + actions — démo
        </h1>
        <p style={{ color: '#9898b4', marginBottom: '2rem', fontSize: 14 }}>
          Construis une condition et une cascade d&apos;actions avec l&apos;UI no-code.
          Le panneau de droite évalue en live contre le PlayerState factice.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* ── Colonne gauche : UI de construction ──────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <Section title="Condition (visible si…)">
              <ConditionBuilder value={condition} onChange={setCondition} context={context} />
            </Section>

            <Section title="Actions au clic">
              <ActionsEditor value={actions} onChange={setActions} context={context} />
            </Section>
          </div>

          {/* ── Colonne droite : state + résultats ───────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <Section title="PlayerState actuel">
              <pre style={preStyle}>{JSON.stringify(state, null, 2)}</pre>
              <button onClick={() => setState(INITIAL_STATE)} style={resetBtn}>
                Reset au state initial
              </button>
            </Section>

            <Section title="Évaluation de la condition">
              {condition ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ ...resultBadge, background: conditionResult ? '#10B981' : '#ef4444' }}>
                    {conditionResult ? 'VRAI' : 'FAUX'}
                  </div>
                  <span style={{ color: '#9898b4', fontSize: 13 }}>
                    → le choix/hotspot serait {conditionResult ? 'visible' : 'caché'}
                  </span>
                </div>
              ) : (
                <div style={{ color: '#9898b4', fontSize: 13, fontStyle: 'italic' }}>
                  Aucune condition → toujours vrai (affichage par défaut)
                </div>
              )}
            </Section>

            <Section title="Aperçu de la condition (JSON)">
              <pre style={preStyle}>{JSON.stringify(condition ?? null, null, 2)}</pre>
            </Section>

            <Section title="Aperçu des actions (JSON)">
              <pre style={preStyle}>{JSON.stringify(actions, null, 2)}</pre>
            </Section>

            {applyResult && (
              <Section title="Simulation : cliquer sur le choix/hotspot">
                <button
                  onClick={() => setState(applyResult.state)}
                  style={applyBtn}
                >
                  Appliquer les actions au state
                </button>
                <div style={{ color: '#9898b4', fontSize: 12, marginTop: 6 }}>
                  State suivant : <code style={{ fontSize: 11 }}>{JSON.stringify(applyResult.state)}</code>
                </div>
                {applyResult.sideEffects.length > 0 && (
                  <div style={{ color: '#EC4899', fontSize: 12, marginTop: 6 }}>
                    Side effects à exécuter : {applyResult.sideEffects.map((se, i) => (
                      <code key={i} style={{ fontSize: 11, marginRight: 8 }}>{JSON.stringify(se)}</code>
                    ))}
                  </div>
                )}
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers visuels ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {title}
      </div>
      <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6 }}>
        {children}
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '3rem 2rem',
  background: '#0d0d0d',
  color: '#ede9df',
  fontFamily: 'Inter, -apple-system, sans-serif',
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 10,
  background: '#000',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#9898b4',
  fontSize: 11,
  fontFamily: 'JetBrains Mono, monospace',
  maxHeight: 280,
  overflow: 'auto',
}

const resultBadge: React.CSSProperties = {
  padding: '6px 14px',
  color: 'white',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '.05em',
  borderRadius: 4,
}

const resetBtn: React.CSSProperties = {
  marginTop: 6,
  padding: '4px 10px',
  background: 'transparent',
  border: '1px solid #3a3a42',
  borderRadius: 4,
  color: '#9898b4',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const applyBtn: React.CSSProperties = {
  padding: '8px 14px',
  background: '#EC4899',
  border: 'none',
  borderRadius: 4,
  color: 'white',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
