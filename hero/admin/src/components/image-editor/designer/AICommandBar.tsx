'use client'
/**
 * AICommandBar — barre de commande IA centrée dans le top bar.
 *
 * Pattern Linear / Cursor / Notion AI : input toujours visible, raccourci
 * Ctrl+K pour focus instantané. Au focus, dropdown sous la barre avec
 * suggestions contextuelles + historique.
 *
 * Routing :
 *   Si le texte commence par un verbe d'extraction (extrait/découpe/coupe/isole),
 *   route vers le pipeline AICutCommand (NLU local Qwen + Grounded-SAM).
 *   Sinon, fallback mock pour l'instant.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { useAICutCommandOptional } from '../AICutCommandContext'

interface Suggestion {
  ico: string
  text: string
}

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { ico: '🌧', text: 'Mets de la pluie battante sur la scène' },
  { ico: '🪟', text: 'Ajoute un effet vitre sur les fenêtres' },
  { ico: '🌙', text: "Rends l'ambiance plus sombre / nocturne" },
  { ico: '👤', text: 'Place Travis devant le canapé' },
  { ico: '✨', text: 'Génère une variation plus colorée' },
]

const RECENT_HISTORY: Suggestion[] = [
  { ico: '↩', text: '"Mets une vitre dépolie sur la baie"' },
  { ico: '↩', text: '"Rajoute des plantes près de la fenêtre"' },
  { ico: '↩', text: '"Découpe le canapé"' },
]

// Détecte les commandes de découpe (extrait/découpe/coupe/isole/repère…).
// Si match, on route vers le pipeline AICutCommand. Sinon, fallback mock.
const CUT_INTENT_RE = /\b(extrait?s?|extract|d[ée]coup[ée]r?|coupe[rz]?|isole[rz]?|isolate|rep[èe]re[rz]?|trouve[rz]?)\b/i

export default function AICommandBar() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  // Le hook peut être null si la barre est mountée hors AICutCommandProvider
  // (cas legacy / pages de test). Le fallback mock prend le relais.
  const cutCommand = useAICutCommandOptional()
  const isBusy = cutCommand?.status.phase === 'parsing' || cutCommand?.status.phase === 'searching'

  // Raccourci Ctrl+K (ou Cmd+K) → focus input
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  function handleSubmit(text: string) {
    // Routing : commande de découpe ?
    if (cutCommand && CUT_INTENT_RE.test(text)) {
      void cutCommand.run(text)
      setValue('')
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    // Sinon : mock (sera remplacé par d'autres routings — édit colors,
    // ajout PNJ, génération… au fil des intents implémentés).
    console.log('[AICommandBar] non-cut command (mock):', text)
    alert(`IA (mock) reçoit : "${text}"\n\nSeules les commandes d'extraction sont actives pour l'instant.\nEx: "Extrait le canapé au centre"`)
    setValue('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="dz-aibar">
      <div className="dz-aibar-input">
        {isBusy
          ? <Loader2 size={14} className="dz-aibar-wand dz-aibar-spin" />
          : <Sparkles size={14} className="dz-aibar-wand" />}
        <input
          ref={inputRef}
          type="text"
          placeholder="Demande à l'IA d'éditer ce plan… (ex : pluie battante, ajoute un PNJ)"
          value={value}
          onChange={e => setValue(e.target.value)}
          onFocus={() => setOpen(true)}
          // Délai sur blur pour laisser le clic d'une suggestion se produire avant la fermeture
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Enter' && value.trim()) handleSubmit(value.trim())
            if (e.key === 'Escape') {
              setValue('')
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
        />
        <span className="dz-aibar-kbd" title="Raccourci">Ctrl K</span>
      </div>

      {open && (
        <div className="dz-aibar-dropdown">
          <div className="dz-aibar-dropdown-section">
            <div className="dz-aibar-dropdown-title">Suggestions pour ce plan</div>
            {DEFAULT_SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                type="button"
                className="dz-aibar-suggestion"
                onClick={() => handleSubmit(s.text)}
              >
                <span className="dz-aibar-suggestion-ico">{s.ico}</span>
                <span>{s.text}</span>
              </button>
            ))}
          </div>
          <div className="dz-aibar-dropdown-section">
            <div className="dz-aibar-dropdown-title">Conversation récente</div>
            {RECENT_HISTORY.map((s, i) => (
              <button
                key={i}
                type="button"
                className="dz-aibar-suggestion"
                onClick={() => handleSubmit(s.text)}
              >
                <span className="dz-aibar-suggestion-ico">{s.ico}</span>
                <span>{s.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
