'use client'
/**
 * AnimationStudioAiPalette — modal command palette "Demande à l'IA" (Ctrl+K).
 *
 * UX style Linear / Raycast / Notion AI : input centré haut écran avec backdrop
 * léger, preview qui apparaît sous l'input après extraction Mistral.
 *
 * Refonte 2026-05-10 (Phase 2 du chantier IA).
 *
 * Flow :
 *   1. L'auteur tape une phrase libre type "Roman dribble et Marvyn défend"
 *   2. Cmd/Ctrl+Enter (ou click bouton) → POST /api/ai/extract-shot-prompt
 *   3. Mistral renvoie un JSON structuré (action décomposée, durée auto, etc.)
 *   4. (Phase 3) Preview éditable avec champs inline + Apply
 *   5. (V1 Phase 2) Affichage brut du JSON pour debug avant le polish UI
 *
 * Trigger : Ctrl/Cmd+K depuis n'importe où dans l'AnimationStudio. Esc pour
 * fermer. Cmd+Enter pour submit. Auto-focus à l'ouverture.
 */

import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Loader2, X, ArrowRight } from 'lucide-react'
import AnimationStudioAiPreview from './AnimationStudioAiPreview'

/** Type miroir de la réponse de l'API extract-shot-prompt. Importé localement
 *  ici (pas de cross-import avec le route handler) pour éviter le bundle
 *  des helpers serveur côté client. */
export interface AiExtractionShot {
  shotIndex: number
  speakerId: string | null
  perCharacter: Record<string, {
    action: string
    dialogue: string | null
    confidence: 'high' | 'medium' | 'low'
  }>
  suggestedDurationSec: number
  /** Refonte 2026-05-14az — Action de scène SANS perso (mouvement caméra,
   *  ambiance, plan d'établissement). Utilisé quand perCharacter est vide
   *  pour les scènes atmosphère (LTX I2V classique sans Vantage Dual). */
  sceneAction?: string
}
export interface AiExtractionScene {
  scene_visible: string | null
  characters_appearance: string | null
  confidence: 'high' | 'medium' | 'low'
}
export interface AiExtractionWarning {
  type: 'unknown_character' | 'missing_voice' | 'character_added' | 'multi_shot_truncated'
  message: string
  characterId?: string
}
export interface AiExtraction {
  intent: 'configure_pellicule'
  shots: AiExtractionShot[]
  scene: AiExtractionScene
  warnings: AiExtractionWarning[]
}

/** Contexte pellicule envoyé à l'API. Mirroir du type côté serveur. */
export interface AiPaletteContext {
  pelliculeId: string
  activeShotIndex: number
  pelliculeShots: Array<{ id: string; characterIds: string[]; speakerId: string | null }>
  charactersInPellicule: Array<{
    id: string
    name: string
    gender: 'male' | 'female'
    hasVoice: boolean
    /** Description physique (apparence, vêtements) — aide Mistral à désambiguïser. */
    description?: string
    /** Position spatiale dans la scène source — aide pour les indications directionnelles. */
    position?: 'left' | 'center' | 'right'
  }>
  bookCharacters: Array<{
    id: string
    name: string
    gender: 'male' | 'female'
    hasVoice: boolean
    description?: string
    position?: 'left' | 'center' | 'right'
  }>
  sceneVisible?: string
  sceneAppearance?: string
}

interface AnimationStudioAiPaletteProps {
  open: boolean
  onClose: () => void
  /** Contexte pellicule courant — null si aucune pellicule active (palette
   *  alors affiche un message guide au lieu de l'input). */
  context: AiPaletteContext | null
  /** Description Qwen VL de l'image source mode 'scene' (décor / ambiance). Optionnel. */
  imageDescription?: string
  /** Description Qwen VL de l'image source mode 'characters' au format Vantage
   *  (Male: ... / Female: ...). Source de vérité pour les vêtements visibles
   *  → évite que Mistral invente shorts/sneakers stéréotypiques. Refonte
   *  2026-05-11 (fix bug shorts noirs). Optionnel. */
  charactersDescription?: string
  /** Statut du pré-fetch Qwen VL (loading/ready/failed). Affiché en badge
   *  au-dessus du submit pour que l'auteur sache quand soumettre sans rater
   *  le contexte vision (~51s sur 8 GB VRAM = courant de soumettre tôt). */
  qwenStatus?: 'idle' | 'loading' | 'ready' | 'failed'
  /** Callback appelé quand l'auteur applique l'extraction. Phase 3 : le parent
   *  patche la pellicule avec les valeurs. Pour V1 (Phase 2), juste un noop. */
  onApply?: (extraction: AiExtraction) => void
}

export default function AnimationStudioAiPalette({
  open, onClose, context, imageDescription, charactersDescription, qwenStatus, onApply,
}: AnimationStudioAiPaletteProps) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<AiExtraction | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus à l'ouverture, reset state à la fermeture
  useEffect(() => {
    if (open) {
      // setTimeout pour attendre la fin de l'anim mount
      setTimeout(() => inputRef.current?.focus(), 60)
    } else {
      setPrompt('')
      setError(null)
      setExtraction(null)
      setBusy(false)
    }
  }, [open])

  // Esc pour fermer
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  async function handleSubmit() {
    if (!prompt.trim() || busy) return
    if (!context) {
      setError('Sélectionne d\'abord une pellicule active.')
      return
    }
    setBusy(true)
    setError(null)
    setExtraction(null)
    try {
      const res = await fetch('/api/ai/extract-shot-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: prompt.trim(),
          pelliculeContext: context,
          imageDescription,
          charactersDescription,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setExtraction(data as AiExtraction)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Cmd/Ctrl+Enter pour submit depuis le textarea
  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className="as-aip-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          /* Click outside DÉSACTIVÉ (refonte 2026-05-10) — fix UX : l'auteur
           *  peut taper un long prompt et perdre tout son input par
           *  inadvertance en cliquant à côté. Fermeture uniquement via le
           *  bouton X header ou la touche Esc (cf useEffect onKey). */
          role="dialog"
          aria-modal="true"
          aria-label="Demande à l'IA"
        >
          <motion.div
            className="as-aip-panel"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          >
            {/* Header */}
            <header className="as-aip-header">
              <Sparkles size={14} className="as-aip-header-icon" />
              <span className="as-aip-header-title">Demande à l'IA</span>
              <span className="as-aip-header-hint">
                <kbd>⌘</kbd>+<kbd>Enter</kbd> pour valider · <kbd>Esc</kbd> pour fermer
              </span>
              <button
                type="button"
                className="as-aip-close"
                onClick={onClose}
                disabled={busy}
                aria-label="Fermer"
              >
                <X size={13} />
              </button>
            </header>

            {/* Input */}
            <div className="as-aip-input-row">
              <textarea
                ref={inputRef}
                className="as-aip-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={
                  context
                    ? "ex : Roman fait rebondir la balle puis dribble vers le panier, Marvyn se met en défense"
                    : "Aucune pellicule active — sélectionne une pellicule dans la timeline d'abord."
                }
                rows={3}
                disabled={busy || !context}
              />
              <button
                type="button"
                className="as-aip-submit"
                onClick={handleSubmit}
                disabled={busy || !context || !prompt.trim()}
                title={!context ? 'Sélectionne une pellicule' : 'Envoyer (Cmd+Enter)'}
              >
                {busy ? <Loader2 size={14} className="as-aip-spin" /> : <ArrowRight size={14} />}
                <span>{busy ? 'Mistral analyse…' : 'Envoyer'}</span>
              </button>
            </div>

            {/* Statut Qwen vision (refonte 2026-05-11) — affiché entre input
             *  et submit pour que l'auteur sache si soumettre maintenant rate
             *  le contexte vision (51s sur 8 GB VRAM = très probable). On
             *  N'EMPÊCHE PAS le submit si loading — on prévient juste. */}
            {qwenStatus && qwenStatus !== 'idle' && (
              <div className={`as-aip-qwen-status as-aip-qwen-status-${qwenStatus}`}>
                {qwenStatus === 'loading' && (
                  <>
                    <Loader2 size={11} className="as-aip-spin" />
                    <span>Qwen Vision analyse l'image (~50s)… soumettre maintenant = vêtements possiblement inventés</span>
                  </>
                )}
                {qwenStatus === 'ready' && (
                  <>
                    <span className="as-aip-qwen-dot" />
                    <span>Qwen Vision prêt — vêtements sourcés depuis l'image</span>
                  </>
                )}
                {qwenStatus === 'failed' && (
                  <>
                    <span>⚠ Qwen Vision indispo — Mistral va devoir deviner les vêtements (vérifie les fiches NPC ou retente plus tard)</span>
                  </>
                )}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="as-aip-error">⚠ {error}</div>
            )}

            {/* Preview Phase 3 — formulaire éditable inline. L'auteur ajuste
             *  les actions/dialogues/scène avant Apply. */}
            {extraction && context && (
              <div className="as-aip-preview">
                <AnimationStudioAiPreview
                  extraction={extraction}
                  context={context}
                  busy={busy}
                  onCancel={() => setExtraction(null)}
                  onApply={(edited) => {
                    onApply?.(edited)
                    onClose()
                  }}
                />
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
