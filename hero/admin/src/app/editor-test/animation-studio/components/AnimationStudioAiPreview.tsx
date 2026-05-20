'use client'
/**
 * AnimationStudioAiPreview — formulaire éditable de l'extraction Mistral.
 *
 * Phase 3 du chantier IA (refonte 2026-05-10). Remplace l'aperçu JSON brut
 * du Phase 2 par des champs éditables inline. L'auteur peut corriger les
 * actions/dialogues avant d'appliquer (pattern Linear/Notion AI).
 *
 * Refonte 2026-05-11 — support 1 ou 2 shots. Quand Mistral détecte une césure
 * chronologique nette ("Roman dribble PUIS dunk"), il génère 2 shots et le
 * preview les affiche dans 2 cards séparées. La scène (décor/apparences) reste
 * unique pour les 2.
 *
 * Indicateurs de confiance Mistral :
 *   - high   ✅ : mention explicite par l'auteur
 *   - medium 🤔 : déduction raisonnable
 *   - low    ❓ : devinette — focus visuel à mettre en priorité
 *
 * L'apply final est délégué au parent (handleAiApply) qui sait comment
 * patcher le state pellicule (action, dialogue, speaker, scène, durée). Pour
 * 2 shots, le parent crée le 2nd shot via addAnimationShot.
 */

import React, { useEffect, useState } from 'react'
import { Check, AlertTriangle, HelpCircle, UserPlus, Mic, Clock, Film } from 'lucide-react'
import type { AiExtraction, AiPaletteContext } from './AnimationStudioAiPalette'

interface AnimationStudioAiPreviewProps {
  extraction: AiExtraction
  context: AiPaletteContext
  busy: boolean
  onCancel: () => void
  onApply: (edited: AiExtraction) => void
}

/** Icône + couleur selon le niveau de confiance Mistral. */
function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  if (level === 'high') {
    return <span className="as-aip2-conf as-aip2-conf-high" title="Confiance haute (mentionné explicitement)"><Check size={11} /></span>
  }
  if (level === 'medium') {
    return <span className="as-aip2-conf as-aip2-conf-medium" title="Confiance moyenne (déduction)">🤔</span>
  }
  return <span className="as-aip2-conf as-aip2-conf-low" title="Confiance basse (Mistral devine — vérifie)"><HelpCircle size={11} /></span>
}

export default function AnimationStudioAiPreview({
  extraction, context, busy, onCancel, onApply,
}: AnimationStudioAiPreviewProps) {
  // Copie locale éditable. L'auteur tweake ces champs avant d'appliquer.
  const [edited, setEdited] = useState<AiExtraction>(() => structuredClone(extraction))

  // Sync si Mistral renvoie une nouvelle extraction (re-submit dans le palette)
  useEffect(() => {
    setEdited(structuredClone(extraction))
  }, [extraction])

  // Lookup nom perso pour affichage humain
  const charNameById = new Map<string, string>([
    ...context.charactersInPellicule.map(c => [c.id, c.name] as const),
    ...context.bookCharacters.map(c => [c.id, c.name] as const),
  ])

  if (edited.shots.length === 0) {
    return <div className="as-aip2-empty">Aucun shot extrait — réessaie avec une description plus précise.</div>
  }

  const isMultiShot = edited.shots.length > 1

  /** Patch d'un champ action/dialogue d'un perso dans un shot donné. */
  function patchCharField(shotIdx: number, charId: string, field: 'action' | 'dialogue', value: string) {
    setEdited(prev => {
      const copy = structuredClone(prev)
      const shot = copy.shots[shotIdx]
      if (!shot) return copy
      const cur = shot.perCharacter[charId] ?? { action: '', dialogue: null, confidence: 'low' as const }
      shot.perCharacter[charId] = {
        ...cur,
        [field]: field === 'dialogue' ? (value.trim() ? value : null) : value,
      }
      return copy
    })
  }

  function patchScene(field: 'scene_visible' | 'characters_appearance', value: string) {
    setEdited(prev => {
      const copy = structuredClone(prev)
      copy.scene[field] = value.trim() ? value : null
      return copy
    })
  }

  function patchDuration(shotIdx: number, value: number) {
    setEdited(prev => {
      const copy = structuredClone(prev)
      const shot = copy.shots[shotIdx]
      if (shot) shot.suggestedDurationSec = Math.max(1, Math.min(20, Math.round(value)))
      return copy
    })
  }

  function patchSpeaker(shotIdx: number, charId: string | null) {
    setEdited(prev => {
      const copy = structuredClone(prev)
      const shot = copy.shots[shotIdx]
      if (shot) shot.speakerId = charId
      return copy
    })
  }

  // Icônes warnings (regroupés par type)
  const warningIcon = (type: string) => {
    if (type === 'character_added') return <UserPlus size={11} />
    if (type === 'unknown_character') return <AlertTriangle size={11} />
    if (type === 'missing_voice') return <Mic size={11} />
    if (type === 'multi_shot_truncated') return <Film size={11} />
    return <AlertTriangle size={11} />
  }

  const totalCharsInExtraction = new Set<string>()
  edited.shots.forEach(s => Object.keys(s.perCharacter).forEach(id => totalCharsInExtraction.add(id)))

  return (
    <div className="as-aip2-root">
      {/* ── Warnings en tête (les choses non-bloquantes mais à savoir) ── */}
      {edited.warnings.length > 0 && (
        <div className="as-aip2-warnings">
          {edited.warnings.map((w, i) => (
            <div key={i} className={`as-aip2-warning as-aip2-warning-${w.type}`}>
              {warningIcon(w.type)}
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Bandeau multi-shot ── */}
      {isMultiShot && (
        <div className="as-aip2-multishot-banner">
          <Film size={11} />
          <span>Mistral a détecté {edited.shots.length} séquences distinctes — un shot par séquence sera appliqué.</span>
        </div>
      )}

      {/* ── Cards par shot ── */}
      {edited.shots.map((shot, shotIdx) => {
        const charsInShot = Object.keys(shot.perCharacter)
        return (
          <div key={shotIdx} className={`as-aip2-shot-card ${isMultiShot ? 'multi' : ''}`}>
            {isMultiShot && (
              <header className="as-aip2-shot-header">
                <span className="as-aip2-shot-badge">Shot {shotIdx + 1}</span>
                <span className="as-aip2-shot-hint">
                  {shotIdx === 0 ? 'remplacera le shot actif' : 'créera un nouveau shot'}
                </span>
              </header>
            )}

            {/* Métadonnées du shot (durée + speaker) */}
            <div className="as-aip2-meta-row">
              <label className="as-aip2-meta-label">
                <Clock size={11} />
                <span>Durée</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={shot.suggestedDurationSec}
                  onChange={e => patchDuration(shotIdx, Number(e.target.value))}
                  disabled={busy}
                  className="as-aip2-duration-input"
                />
                <span className="as-aip2-meta-unit">s</span>
              </label>
              <label className="as-aip2-meta-label">
                <Mic size={11} />
                <span>Speaker</span>
                <select
                  value={shot.speakerId ?? ''}
                  onChange={e => patchSpeaker(shotIdx, e.target.value || null)}
                  disabled={busy}
                  className="as-aip2-speaker-select"
                >
                  <option value="">— aucun —</option>
                  {charsInShot.map(id => (
                    <option key={id} value={id}>{charNameById.get(id) ?? id}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Champs Action / Dialogue par perso */}
            {charsInShot.length === 0 ? (
              <p className="as-aip2-empty">Aucun perso identifié dans ce shot.</p>
            ) : (
              <div className="as-aip2-chars">
                {charsInShot.map(charId => {
                  const data = shot.perCharacter[charId]
                  const name = charNameById.get(charId) ?? `(${charId})`
                  const isSpeaker = shot.speakerId === charId
                  return (
                    <div key={charId} className={`as-aip2-char ${isSpeaker ? 'speaker' : ''}`}>
                      <div className="as-aip2-char-header">
                        <strong>{name}</strong>
                        {isSpeaker && <span className="as-aip2-speaker-badge">🎙 parle</span>}
                        <ConfidenceBadge level={data.confidence} />
                      </div>
                      <label className="as-aip2-field">
                        <span className="as-aip2-field-label">Action</span>
                        <textarea
                          value={data.action}
                          onChange={e => patchCharField(shotIdx, charId, 'action', e.target.value)}
                          disabled={busy}
                          rows={2}
                          className="as-aip2-textarea"
                          placeholder="ex : fait rebondir la balle main droite, regarde Marvyn"
                        />
                      </label>
                      {isSpeaker && (
                        <label className="as-aip2-field">
                          <span className="as-aip2-field-label">Dialogue (TTS lipsync)</span>
                          <textarea
                            value={data.dialogue ?? ''}
                            onChange={e => patchCharField(shotIdx, charId, 'dialogue', e.target.value)}
                            disabled={busy}
                            rows={2}
                            className="as-aip2-textarea"
                            placeholder="ex : Regarde, je vais marquer."
                          />
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Champs scène (commune aux N shots — uniquement si Mistral a proposé qqch) ── */}
      {(edited.scene.scene_visible !== null || edited.scene.characters_appearance !== null) && (
        <div className="as-aip2-scene">
          <div className="as-aip2-scene-header">
            <strong>Scène {isMultiShot && <span className="as-aip2-scene-hint">(commune aux {edited.shots.length} shots)</span>}</strong>
            <ConfidenceBadge level={edited.scene.confidence} />
          </div>
          {edited.scene.scene_visible !== null && (
            <label className="as-aip2-field">
              <span className="as-aip2-field-label">Décor & ambiance</span>
              <textarea
                value={typeof edited.scene.scene_visible === 'string' ? edited.scene.scene_visible : ''}
                onChange={e => patchScene('scene_visible', e.target.value)}
                disabled={busy}
                rows={2}
                className="as-aip2-textarea"
              />
            </label>
          )}
          {edited.scene.characters_appearance !== null && (
            <label className="as-aip2-field">
              <span className="as-aip2-field-label">Apparence persos</span>
              <textarea
                value={typeof edited.scene.characters_appearance === 'string' ? edited.scene.characters_appearance : ''}
                onChange={e => patchScene('characters_appearance', e.target.value)}
                disabled={busy}
                rows={2}
                className="as-aip2-textarea"
              />
            </label>
          )}
        </div>
      )}

      {/* ── Actions ── */}
      <div className="as-aip2-actions">
        <button
          type="button"
          className="as-aip-cancel"
          onClick={onCancel}
          disabled={busy}
        >
          Annuler
        </button>
        <button
          type="button"
          className="as-aip-apply"
          onClick={() => onApply(edited)}
          disabled={busy || totalCharsInExtraction.size === 0}
        >
          {isMultiShot ? `Appliquer aux ${edited.shots.length} shots` : 'Appliquer au shot'}
        </button>
      </div>
    </div>
  )
}
