'use client'
/**
 * AIAssistantPanel — panneau d'édition conversationnel Ctrl+K du Studio Designer.
 *
 * Flow :
 *   1. Ouverture (Ctrl+K ou clic top bar) → affiche contexte (persos de la scène
 *      + résumé du plan) + zone prompt.
 *   2. L'auteur écrit "Enlève les lunettes de Duke" + Entrée.
 *   3. Appel `/api/ai/edit-plan-intent` (Mistral) → classification en 1 des 4
 *      actions (modify_scene · modify_character · remove_element · add_object)
 *      + prompt final pour Qwen Edit.
 *   4. Carte de confirmation : explanation_fr + prompt final + boutons
 *      Valider / Modifier / Annuler.
 *   5a. Si action = add_object && is_narrative_object → délègue au parent
 *      (onAddNarrativeObject) qui ouvre ItemAttachmentPickerModal.
 *   5b. Sinon → runQwenImageEdit + onEditApplied(newUrl).
 *
 * Mode confirmation détaillée par défaut (refonte 2026-05-12, mode test).
 *
 * Refonte 2026-05-12.
 */

import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Sparkles, X, CheckCircle2, AlertTriangle, Edit3 } from 'lucide-react'
import { runQwenImageEdit } from '@/lib/comfyui-qwen-edit'

// ── Types ─────────────────────────────────────────────────────────────────

export type IntentActionType = 'modify_scene' | 'modify_character' | 'remove_element' | 'add_object'

export interface IntentResponse {
  action_type: IntentActionType
  target_character_id: string | null
  is_narrative_object: boolean | null
  object_name: string | null
  edit_prompt: string
  explanation_fr: string
  confidence: 'high' | 'medium' | 'low'
  warnings: Array<{ type: 'unknown_character' | 'ambiguous'; message: string }>
}

export interface AIAssistantContextChar {
  id: string
  name: string
  description?: string
  thumbUrl?: string
}

interface AIAssistantPanelProps {
  open: boolean
  onClose: () => void
  /** URL Supabase de l'image courante (= base du plan). null = pas d'image
   *  donc édition impossible — le panneau affiche un message guide. */
  currentImageUrl: string | null
  /** Persos présents dans la scène (depuis presentCharacterIds + character store). */
  charactersInScene: AIAssistantContextChar[]
  /** Résumé narratif du plan (optionnel). */
  planSummary?: string
  /** Préfixe Storage pour ranger les résultats d'édition. */
  storagePathPrefix?: string
  /** Callback après édition Qwen réussie (cas non-narratif). Reçoit la nouvelle
   *  URL Supabase qui remplace la base. */
  onEditApplied: (newImageUrl: string) => void
  /** Callback si l'intent est add_object + is_narrative_object=true. Le parent
   *  ouvre ItemAttachmentPickerModal et choisit existant / nouveau / no-item,
   *  puis exécute l'édition. Si non fourni, on exécute en direct (fallback). */
  onAddNarrativeObject?: (params: { objectName: string; editPrompt: string }) => void
}

// ── Labels actions (FR humain) ────────────────────────────────────────────

const ACTION_LABELS: Record<IntentActionType, { ico: string; label: string }> = {
  modify_scene:     { ico: '🌆', label: 'Modifier la scène' },
  modify_character: { ico: '🧍', label: 'Modifier un personnage' },
  remove_element:   { ico: '🗑',  label: 'Supprimer un élément' },
  add_object:       { ico: '➕', label: 'Ajouter un objet' },
}

const CONFIDENCE_LABELS = {
  high:   { color: 'var(--ie-success)', label: 'Sûre' },
  medium: { color: 'var(--ie-warning)', label: 'Probable' },
  low:    { color: 'var(--ie-danger)',  label: 'Incertaine' },
} as const

// ── Component ─────────────────────────────────────────────────────────────

export default function AIAssistantPanel({
  open, onClose,
  currentImageUrl,
  charactersInScene,
  planSummary,
  storagePathPrefix = 'studio/qwen-edit',
  onEditApplied,
  onAddNarrativeObject,
}: AIAssistantPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [prompt, setPrompt] = useState('')
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'confirm' | 'executing'>('idle')
  const [intent, setIntent] = useState<IntentResponse | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Focus auto à l'ouverture
  useEffect(() => {
    if (open) {
      // Léger délai pour laisser l'anim slide-in finir
      const t = setTimeout(() => inputRef.current?.focus(), 200)
      return () => clearTimeout(t)
    }
    // Reset à la fermeture
    setPrompt('')
    setIntent(null)
    setPhase('idle')
    setError(null)
    setEditLabel('')
  }, [open])

  // Escape pour fermer (mais pas pendant une exec en cours — risque de perdre
  // un résultat en route)
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'executing') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, phase, onClose])

  async function handleAnalyze() {
    const text = prompt.trim()
    if (!text) return
    if (!currentImageUrl) {
      setError("Pas d'image source — génère d'abord une base.")
      return
    }
    setPhase('analyzing')
    setError(null)
    setIntent(null)
    try {
      const res = await fetch('/api/ai/edit-plan-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: text,
          charactersInScene: charactersInScene.map(c => ({
            id: c.id, name: c.name, description: c.description,
          })),
          planSummary,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setIntent(data as IntentResponse)
      setPhase('confirm')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Analyse échouée : ${msg}`)
      setPhase('idle')
    }
  }

  async function handleValidate() {
    if (!intent || !currentImageUrl) return

    // Branche objet narratif : délègue au parent qui ouvre la modal item.
    if (intent.action_type === 'add_object'
        && intent.is_narrative_object
        && onAddNarrativeObject
        && intent.object_name) {
      onAddNarrativeObject({
        objectName: intent.object_name,
        editPrompt: intent.edit_prompt,
      })
      onClose()
      return
    }

    // Cas standard : exécution Qwen Edit directe.
    setPhase('executing')
    setError(null)
    setEditLabel('Préparation…')
    try {
      const newUrl = await runQwenImageEdit({
        sourceUrl: currentImageUrl,
        prompt: intent.edit_prompt,
        storagePathPrefix,
        useLightning: true,
        onProgress: p => setEditLabel(p.label ?? p.stage),
      })
      onEditApplied(newUrl)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Édition échouée : ${msg}`)
      setPhase('confirm')
      setEditLabel('')
    }
  }

  function handleBackToEdit() {
    setIntent(null)
    setPhase('idle')
    setError(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const charTarget = intent?.target_character_id
    ? charactersInScene.find(c => c.id === intent.target_character_id) ?? null
    : null

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="dz-ai-panel"
          className="dz-ai-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: '24rem', opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="dz-ai-panel-inner">
            {/* Header */}
            <div className="dz-ai-panel-header">
              <div className="dz-ai-panel-title">
                <Sparkles size={14} />
                <span>Assistant IA</span>
              </div>
              <button
                type="button"
                className="dz-ai-panel-close"
                onClick={onClose}
                disabled={phase === 'executing'}
                aria-label="Fermer"
                title="Fermer (Échap)"
              >
                <X size={14} />
              </button>
            </div>

            {/* Contexte (persos + résumé) */}
            <div className="dz-ai-panel-context">
              <div className="dz-ai-panel-context-title">Contexte du plan</div>
              {planSummary && (
                <div className="dz-ai-panel-context-summary">{planSummary}</div>
              )}
              {charactersInScene.length > 0 ? (
                <div className="dz-ai-panel-context-chars">
                  {charactersInScene.map(c => (
                    <div key={c.id} className="dz-ai-panel-context-char" title={c.description}>
                      {c.thumbUrl
                        ? <img src={c.thumbUrl} alt={c.name} className="dz-ai-panel-context-char-thumb" />
                        : <div className="dz-ai-panel-context-char-thumb dz-ai-panel-context-char-thumb-empty">{c.name.charAt(0)}</div>}
                      <span className="dz-ai-panel-context-char-name">{c.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dz-ai-panel-context-empty">Aucun personnage dans la scène.</div>
              )}
            </div>

            {/* Phase IDLE / ANALYZING : zone prompt */}
            {(phase === 'idle' || phase === 'analyzing') && (
              <div className="dz-ai-panel-prompt">
                <label className="dz-ai-panel-prompt-label">Comment je peux t'aider ?</label>
                <textarea
                  ref={inputRef}
                  className="dz-ai-panel-prompt-input"
                  placeholder="Ex: enlève les lunettes de Duke, change le ciel en orage, ajoute une épée près du rocher…"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && prompt.trim() && phase === 'idle') {
                      e.preventDefault()
                      void handleAnalyze()
                    }
                  }}
                  disabled={phase === 'analyzing'}
                  rows={3}
                />
                <div className="dz-ai-panel-prompt-actions">
                  <span className="dz-ai-panel-prompt-hint">Entrée pour analyser · Maj+Entrée = retour à la ligne</span>
                  <button
                    type="button"
                    className="dz-ai-panel-btn dz-ai-panel-btn-primary"
                    onClick={() => void handleAnalyze()}
                    disabled={!prompt.trim() || phase === 'analyzing'}
                  >
                    {phase === 'analyzing'
                      ? <><Loader2 size={12} className="dz-ai-panel-spin" /> Analyse…</>
                      : 'Demander'}
                  </button>
                </div>
                {error && (
                  <div className="dz-ai-panel-error">
                    <AlertTriangle size={12} /> {error}
                  </div>
                )}
              </div>
            )}

            {/* Phase CONFIRM : carte récap + boutons */}
            {phase === 'confirm' && intent && (
              <div className="dz-ai-panel-confirm">
                <div className="dz-ai-panel-confirm-header">
                  <span className="dz-ai-panel-confirm-action">
                    <span className="dz-ai-panel-confirm-ico">{ACTION_LABELS[intent.action_type].ico}</span>
                    {ACTION_LABELS[intent.action_type].label}
                  </span>
                  <span
                    className="dz-ai-panel-confirm-confidence"
                    style={{ color: CONFIDENCE_LABELS[intent.confidence].color }}
                    title={`Confiance : ${CONFIDENCE_LABELS[intent.confidence].label}`}
                  >
                    {CONFIDENCE_LABELS[intent.confidence].label}
                  </span>
                </div>

                <div className="dz-ai-panel-confirm-explain">{intent.explanation_fr}</div>

                {charTarget && (
                  <div className="dz-ai-panel-confirm-target">
                    Cible : <strong>{charTarget.name}</strong>
                  </div>
                )}

                {intent.action_type === 'add_object' && intent.object_name && (
                  <div className="dz-ai-panel-confirm-target">
                    Objet : <strong>{intent.object_name}</strong>
                    {intent.is_narrative_object && (
                      <span className="dz-ai-panel-confirm-narrative" title="Objet potentiellement interactif/cliquable — tu pourras l'attacher à un item">
                        narratif
                      </span>
                    )}
                  </div>
                )}

                <details className="dz-ai-panel-confirm-prompt">
                  <summary>Voir le prompt envoyé au moteur</summary>
                  <code>{intent.edit_prompt}</code>
                </details>

                {intent.warnings.length > 0 && (
                  <div className="dz-ai-panel-confirm-warnings">
                    {intent.warnings.map((w, i) => (
                      <div key={i} className="dz-ai-panel-confirm-warning">
                        <AlertTriangle size={11} /> {w.message}
                      </div>
                    ))}
                  </div>
                )}

                <div className="dz-ai-panel-confirm-actions">
                  <button
                    type="button"
                    className="dz-ai-panel-btn dz-ai-panel-btn-secondary"
                    onClick={onClose}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="dz-ai-panel-btn dz-ai-panel-btn-ghost"
                    onClick={handleBackToEdit}
                    title="Modifier ma demande"
                  >
                    <Edit3 size={11} /> Modifier
                  </button>
                  <button
                    type="button"
                    className="dz-ai-panel-btn dz-ai-panel-btn-primary"
                    onClick={() => void handleValidate()}
                  >
                    <CheckCircle2 size={12} /> Valider
                  </button>
                </div>

                {error && (
                  <div className="dz-ai-panel-error">
                    <AlertTriangle size={12} /> {error}
                  </div>
                )}
              </div>
            )}

            {/* Phase EXECUTING : spinner + label */}
            {phase === 'executing' && (
              <div className="dz-ai-panel-executing">
                <Loader2 size={20} className="dz-ai-panel-spin" />
                <div className="dz-ai-panel-executing-label">{editLabel || 'Édition en cours…'}</div>
                <div className="dz-ai-panel-executing-hint">
                  Édition via Qwen Image Edit · ~30-60s
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
