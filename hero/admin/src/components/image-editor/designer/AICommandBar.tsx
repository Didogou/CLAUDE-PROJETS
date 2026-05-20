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

import React, { useRef, useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { useAICutCommandOptional } from '../AICutCommandContext'
import { runQwenImageEdit } from '@/lib/comfyui-qwen-edit'

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
// Si match, on route vers le pipeline AICutCommand. Sinon, route vers
// Qwen Image Edit (refonte 2026-05-11).
const CUT_INTENT_RE = /\b(extrait?s?|extract|d[ée]coup[ée]r?|coupe[rz]?|isole[rz]?|isolate|rep[èe]re[rz]?|trouve[rz]?)\b/i

interface AICommandBarProps {
  /** URL de l'image source à éditer si l'auteur tape une commande non-cut.
   *  Si null/undefined, les commandes d'édition sont disabled (alert). */
  currentImageUrl?: string | null
  /** Callback après édition Qwen réussie — passe la nouvelle URL Supabase
   *  qui remplace la base. Typiquement câblé sur replaceBase() du parent. */
  onEditApplied?: (newImageUrl: string) => void
  /** Préfixe Storage pour ranger les résultats d'édition. */
  storagePathPrefix?: string
}

export default function AICommandBar({
  currentImageUrl, onEditApplied, storagePathPrefix = 'studio/qwen-edit',
}: AICommandBarProps = {}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  /** Édition Qwen en cours (≠ découpe). Local state — la barre montre son
   *  spinner + label propres, indépendamment du AICutCommand global. */
  const [editBusy, setEditBusy] = useState(false)
  const [editLabel, setEditLabel] = useState('')

  // Le hook peut être null si la barre est mountée hors AICutCommandProvider
  // (cas legacy / pages de test). Le fallback mock prend le relais.
  const cutCommand = useAICutCommandOptional()
  const cutBusy = cutCommand?.status.phase === 'parsing' || cutCommand?.status.phase === 'searching'
  const isBusy = cutBusy || editBusy

  // Refonte 2026-05-12 : Ctrl+K capturé désormais par DesignerLayout (ouvre
  // le nouveau AIAssistantPanel). L'input reste accessible au clic pour qui
  // veut taper directement une commande de découpe ("découpe le canapé") ou
  // une édition Qwen rapide sans passer par le panneau structuré.

  async function handleSubmit(text: string) {
    // Routing : commande de découpe ?
    if (cutCommand && CUT_INTENT_RE.test(text)) {
      void cutCommand.run(text)
      setValue('')
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    // Sinon : édition de la base via Qwen Image Edit (refonte 2026-05-11).
    // Tous les autres verbes (ajoute, change, déplace, supprime, rends, etc.)
    // sont compris naturellement par Qwen — pas besoin de parser le verbe
    // ni de router vers des backends différents (Kontext / Composite / Swap).
    if (!currentImageUrl || !onEditApplied) {
      console.warn('[AICommandBar] non-cut command sans currentImageUrl/onEditApplied — fallback alert')
      alert(`L'édition IA n'est pas disponible sur cette page (image source manquante).`)
      return
    }
    setOpen(false)
    inputRef.current?.blur()
    setEditBusy(true)
    setEditLabel('Préparation…')
    try {
      const newUrl = await runQwenImageEdit({
        sourceUrl: currentImageUrl,
        prompt: text,
        storagePathPrefix,
        useLightning: true,
        onProgress: p => setEditLabel(p.label ?? p.stage),
      })
      onEditApplied(newUrl)
      setValue('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[AICommandBar] Qwen edit failed:', msg)
      alert(`Édition IA échouée : ${msg}`)
    } finally {
      setEditBusy(false)
      setEditLabel('')
    }
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
          placeholder={editBusy && editLabel
            ? editLabel
            : "Demande à l'IA d'éditer ce plan… (ex : pluie battante, ajoute un PNJ)"}
          value={value}
          onChange={e => setValue(e.target.value)}
          onFocus={() => setOpen(true)}
          // Délai sur blur pour laisser le clic d'une suggestion se produire avant la fermeture
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={editBusy}
          onKeyDown={e => {
            if (e.key === 'Enter' && value.trim()) void handleSubmit(value.trim())
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
                onClick={() => void handleSubmit(s.text)}
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
                onClick={() => void handleSubmit(s.text)}
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
