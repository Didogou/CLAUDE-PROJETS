'use client'
/**
 * Page de test isolée pour PlanBankPanel.
 *
 * Mocks tous les types d'items (image, animation, transitions, sections)
 * pour valider la UX (vignette anim avec ▶️ + galerie début/fin, ordre des
 * groupes, recherche).
 *
 * Lancer : npm run dev → /editor-test/plan-bank
 */

import React, { useState } from 'react'
import PlanBankPanel, {
  type PlanBankItem,
  type PlanBankSelection,
} from '@/components/image-editor/designer/bank/PlanBankPanel'
import '@/components/image-editor/designer/designer.css'

// Mock dataset couvrant les 4 sources + les 2 kinds.
// URLs placeholder publiques pour le visuel rapide.
const MOCK_ITEMS: PlanBankItem[] = [
  // ── Source 1 : plans de la section EN COURS (2 items) ──
  {
    id: 'cur-0',
    kind: 'image',
    thumbnailUrl: 'https://picsum.photos/seed/cur0/640/360',
    label: 'Plan 1 — entrée du château',
    tags: ['château', 'extérieur', 'jour'],
    source: 'current_section',
  },
  {
    id: 'cur-1',
    kind: 'animation',
    thumbnailUrl: 'https://picsum.photos/seed/cur1a/640/360',
    lastFrameUrl: 'https://picsum.photos/seed/cur1b/640/360',
    videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
    label: 'Plan 2 — grille qui se lève',
    tags: ['château', 'animation', 'grille'],
    source: 'current_section',
  },

  // ── Source 2 : transitions vers la section courante (2 items) ──
  {
    id: 'trans-0',
    kind: 'image',
    thumbnailUrl: 'https://picsum.photos/seed/trans0/640/360',
    label: 'Sec 5 → ici (choix "approcher")',
    tags: ['transition', 'route', 'approche'],
    source: 'transition_to_current',
  },
  {
    id: 'trans-1',
    kind: 'animation',
    thumbnailUrl: 'https://picsum.photos/seed/trans1a/640/360',
    lastFrameUrl: 'https://picsum.photos/seed/trans1b/640/360',
    videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
    label: 'Sec 7 → ici (choix "courir")',
    tags: ['transition', 'course', 'mouvement'],
    source: 'transition_to_current',
  },

  // ── Source 3 : autres sections (3 items) ──
  {
    id: 'other-0',
    kind: 'image',
    thumbnailUrl: 'https://picsum.photos/seed/other0/640/360',
    label: 'Sec 12 / plan 3',
    tags: ['forêt', 'crépuscule'],
    source: 'other_section',
  },
  {
    id: 'other-1',
    kind: 'image',
    thumbnailUrl: 'https://picsum.photos/seed/other1/640/360',
    label: 'Sec 18 / plan 1',
    tags: ['village', 'nuit'],
    source: 'other_section',
  },
  {
    id: 'other-2',
    kind: 'animation',
    thumbnailUrl: 'https://picsum.photos/seed/other2a/640/360',
    lastFrameUrl: 'https://picsum.photos/seed/other2b/640/360',
    videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
    label: 'Sec 24 / plan 2 (anim)',
    tags: ['intérieur', 'coffre', 'animation'],
    source: 'other_section',
  },

  // ── Source 4 : uploads externes (1 item) ──
  {
    id: 'bank-0',
    kind: 'image',
    thumbnailUrl: 'https://picsum.photos/seed/bank0/640/360',
    label: 'carte_du_monde.jpg',
    tags: ['carte', 'upload'],
    source: 'bank_upload',
  },
]

export default function PlanBankTestPage() {
  const [lastSelection, setLastSelection] = useState<PlanBankSelection | null>(null)
  const [log, setLog] = useState<string[]>([])

  function handleSelect(sel: PlanBankSelection) {
    setLastSelection(sel)
    const msg = `[${new Date().toLocaleTimeString()}] SELECT: ${sel.item.label} (${sel.item.kind}) — mode: ${sel.mode}`
    setLog(prev => [msg, ...prev].slice(0, 20))
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#181818' }}>
      {/* Panneau banque */}
      <div style={{
        width: 360,
        borderRight: '1px solid #2a2a2a',
        height: '100vh',
        overflow: 'hidden',
      }}>
        <PlanBankPanel
          items={MOCK_ITEMS}
          onSelect={handleSelect}
          onGenerateImage={() => {
            const msg = `[${new Date().toLocaleTimeString()}] CLICK: Générer image AI`
            setLog(prev => [msg, ...prev].slice(0, 20))
          }}
          onGenerateAnimation={() => {
            const msg = `[${new Date().toLocaleTimeString()}] CLICK: Générer animation AI (→ CatalogAnimation)`
            setLog(prev => [msg, ...prev].slice(0, 20))
          }}
          onUploadExternal={() => {
            const msg = `[${new Date().toLocaleTimeString()}] CLICK: Upload externe`
            setLog(prev => [msg, ...prev].slice(0, 20))
          }}
          onClose={() => {
            const msg = `[${new Date().toLocaleTimeString()}] CLICK: Close`
            setLog(prev => [msg, ...prev].slice(0, 20))
          }}
        />
      </div>

      {/* Console événements */}
      <div style={{
        flex: 1,
        padding: 24,
        color: '#e8e8e8',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <h1 style={{ marginTop: 0, fontSize: 18, fontWeight: 600 }}>
          PlanBankPanel — Page de test
        </h1>
        <p style={{ color: '#999', fontSize: 13, lineHeight: 1.5 }}>
          Banque mockée avec 8 items couvrant les 4 sources et les 2 kinds (image / animation).
          Clique sur les vignettes pour observer la sélection. Pour les animations,
          tu peux cliquer sur le bouton <strong>▶️</strong> central (animation entière)
          ou sur l'une des 2 sous-vignettes <strong>Début</strong> / <strong>Fin</strong>.
        </p>

        {lastSelection && (
          <div style={{
            background: '#1f1f1f',
            border: '1px solid #2a2a2a',
            borderRadius: 8,
            padding: 14,
            marginTop: 18,
            fontSize: 12,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Dernière sélection :</div>
            <pre style={{
              margin: 0,
              fontSize: 11,
              fontFamily: 'monospace',
              color: '#9cdcfe',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {JSON.stringify(lastSelection, null, 2)}
            </pre>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#999',
            marginBottom: 8,
          }}>
            Console événements (20 derniers)
          </div>
          <div style={{
            background: '#0d0d0d',
            border: '1px solid #2a2a2a',
            borderRadius: 6,
            padding: 12,
            fontFamily: 'monospace',
            fontSize: 11,
            lineHeight: 1.6,
            maxHeight: 400,
            overflowY: 'auto',
          }}>
            {log.length === 0
              ? <span style={{ color: '#555' }}>(rien encore — clique dans la banque)</span>
              : log.map((l, i) => (
                  <div key={i} style={{ color: i === 0 ? '#ddd' : '#666' }}>{l}</div>
                ))}
          </div>
        </div>
      </div>
    </div>
  )
}
