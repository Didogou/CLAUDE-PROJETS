'use client'
/**
 * SfxGenerationModal — modal de génération d'effet sonore via ElevenLabs.
 *
 * Phase 2 V1 (2026-05-12). UX :
 *   1. L'auteur tape un prompt court (FR ou EN)
 *      ex: "sonnette de porte vintage, ding ding bref"
 *   2. Choisit une durée approximative (slider 0.5-22s, ou Auto)
 *   3. Clique Générer → spinner, appel /api/elevenlabs/sound-effects
 *   4. Au succès : audio preview <audio controls> + label éditable
 *   5. Bouton "Ajouter à la banque" → callback parent + fermeture modal
 *
 * L'audio est uploadé Storage côté serveur, URL persistante retournée.
 */

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, Loader2, Volume2, AlertTriangle, Check } from 'lucide-react'

export interface GeneratedSfx {
  url: string
  durationSec: number | null
  label: string
}

interface SfxGenerationModalProps {
  open: boolean
  onClose: () => void
  /** ID du livre pour scoper l'upload Storage. */
  bookId: string | null
  /** Callback après génération + validation : le parent ajoute le SFX à la
   *  banque locale (et plus tard, persiste en DB). */
  onAdd: (sfx: GeneratedSfx) => void
}

export default function SfxGenerationModal({
  open, onClose, bookId, onAdd,
}: SfxGenerationModalProps) {
  const [prompt, setPrompt] = useState('')
  const [durationSec, setDurationSec] = useState<number | null>(null)  // null = auto
  const [phase, setPhase] = useState<'idle' | 'generating' | 'preview'>('idle')
  const [generated, setGenerated] = useState<GeneratedSfx | null>(null)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset à l'ouverture
  React.useEffect(() => {
    if (open) {
      setPrompt('')
      setDurationSec(null)
      setPhase('idle')
      setGenerated(null)
      setLabel('')
      setError(null)
    }
  }, [open])

  async function handleGenerate() {
    if (!prompt.trim()) return
    setPhase('generating')
    setError(null)
    try {
      const res = await fetch('/api/elevenlabs/sound-effects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: prompt.trim(),
          durationSec,
          bookId,
          label: prompt.trim().slice(0, 60),
        }),
      })
      const data = await res.json() as { url?: string; durationSec?: number | null; label?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error ?? `HTTP ${res.status}`)
      const sfx: GeneratedSfx = {
        url: data.url,
        durationSec: data.durationSec ?? null,
        label: data.label ?? prompt.trim().slice(0, 60),
      }
      setGenerated(sfx)
      setLabel(sfx.label)
      setPhase('preview')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Génération échouée : ${msg}`)
      setPhase('idle')
    }
  }

  function handleAdd() {
    if (!generated) return
    onAdd({ ...generated, label: label.trim() || generated.label })
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sfxg-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="sfxg-modal"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
          >
            <header className="sfxg-header">
              <span className="sfxg-title">
                <Sparkles size={14} /> Générer un effet sonore
              </span>
              <button
                type="button"
                className="sfxg-close"
                onClick={onClose}
                disabled={phase === 'generating'}
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </header>

            <div className="sfxg-body">
              {/* Prompt */}
              <label className="sfxg-field">
                <span className="sfxg-field-label">Description du son</span>
                <textarea
                  className="sfxg-textarea"
                  placeholder="ex : sonnette de porte vintage, ding ding bref · pas dans le gravier · coup de feu lointain"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  disabled={phase === 'generating'}
                  rows={3}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && prompt.trim() && phase === 'idle') {
                      e.preventDefault()
                      void handleGenerate()
                    }
                  }}
                />
              </label>

              {/* Durée */}
              <label className="sfxg-field">
                <span className="sfxg-field-label">
                  Durée :{' '}
                  {durationSec == null ? (
                    <strong>Auto</strong>
                  ) : (
                    <strong>{durationSec.toFixed(1)}s</strong>
                  )}
                </span>
                <div className="sfxg-duration-row">
                  <input
                    type="range"
                    min="0.5"
                    max="22"
                    step="0.5"
                    value={durationSec ?? 3}
                    onChange={e => setDurationSec(parseFloat(e.target.value))}
                    disabled={phase === 'generating'}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="sfxg-btn-ghost"
                    onClick={() => setDurationSec(null)}
                    disabled={phase === 'generating'}
                    title="Laisser ElevenLabs choisir la durée optimale"
                  >
                    Auto
                  </button>
                </div>
              </label>

              {/* Preview audio (après génération) */}
              {phase === 'preview' && generated && (
                <div className="sfxg-preview">
                  <div className="sfxg-preview-row">
                    <Volume2 size={14} className="sfxg-preview-ico" />
                    <audio src={generated.url} controls className="sfxg-audio" />
                  </div>
                  <label className="sfxg-field">
                    <span className="sfxg-field-label">Nom dans la banque</span>
                    <input
                      type="text"
                      className="sfxg-input"
                      value={label}
                      onChange={e => setLabel(e.target.value)}
                      placeholder="ex : Sonnette appartement Duke"
                    />
                  </label>
                </div>
              )}

              {error && (
                <div className="sfxg-error">
                  <AlertTriangle size={12} /> {error}
                </div>
              )}
            </div>

            <footer className="sfxg-footer">
              <button
                type="button"
                className="sfxg-btn-ghost"
                onClick={onClose}
                disabled={phase === 'generating'}
              >
                Annuler
              </button>
              {phase === 'preview' && (
                <button
                  type="button"
                  className="sfxg-btn-ghost"
                  onClick={() => { setPhase('idle'); setGenerated(null) }}
                  title="Reformuler et regénérer"
                >
                  Refaire
                </button>
              )}
              {phase === 'preview' ? (
                <button
                  type="button"
                  className="sfxg-btn-primary"
                  onClick={handleAdd}
                  disabled={!generated}
                >
                  <Check size={12} /> Ajouter à la banque
                </button>
              ) : (
                <button
                  type="button"
                  className="sfxg-btn-primary"
                  onClick={() => void handleGenerate()}
                  disabled={!prompt.trim() || phase === 'generating'}
                >
                  {phase === 'generating'
                    ? <><Loader2 size={12} className="sfxg-spin" /> Génération…</>
                    : 'Générer'}
                </button>
              )}
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
