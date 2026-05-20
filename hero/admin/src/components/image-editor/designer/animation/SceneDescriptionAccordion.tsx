'use client'
/**
 * SceneDescriptionAccordion — bloc accordéon "Description de la scène" en bas
 * de l'AnimationEditor (cf β.1+ 2026-05-06).
 *
 * 3 champs :
 *   - Décor & ambiance (visible)        → scene_visible
 *   - Apparence des persos dans la scène → characters_appearance
 *     (à terme caché en prod, cf project_studio_admin_visibility)
 *   - Décor hors caméra (paramètres avancés, replié)  → scene_offscreen
 *
 * Bouton 🪄 sur chaque textarea : appelle Qwen VL (`/api/describe-scene`)
 * sur l'image source pour pré-remplir.
 *
 * Modèle data : null = hérite pellicule 1. Override possible.
 * `isFirstPellicule = true` → pas d'héritage possible, l'auteur définit
 * tout direct. Les autres pellicules affichent "Hérite de la pellicule 1"
 * en placeholder + valeur de la pellicule 1 en placeholder grisé pour visu.
 *
 * Le corps est extrait en `SceneFieldsBody` (export) pour pouvoir être
 * réutilisé en mode tab dans l'AnimationStudio (refonte 2026-05-10).
 * Le helper `isSceneValidated` permet aux consumers de réutiliser la même
 * règle "est-ce considéré rempli ?" sans recalculer.
 */

import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import type { SceneFields } from '@/lib/scene-description'
import { describeSceneViaVision } from '@/lib/scene-description'
import './scene-description-accordion.css'

// Material 3 "standard easing" — démarrage doux, fin douce. Choisi pour les
// open/close de boîtes (accordéons) afin d'éviter l'effet "snap" qui faisait
// "sauter" le SHOT 1 voisin lors de l'ouverture de la description.
const SDA_EASE = [0.2, 0, 0, 1] as const
const SDA_DUR = 0.32

export interface SceneDescriptionAccordionProps {
  /** Valeurs propres à la pellicule active (peuvent être null = hérite). */
  ownFields: SceneFields
  /** Valeurs effectives après résolution héritage (= ce que LTX recevrait
   *  si on générait maintenant). Affichées en placeholder grisé pour les
   *  pellicules qui héritent de la 1ère. */
  effectiveFields: SceneFields
  /** True si on est sur la pellicule 1 (= pellicule de référence). */
  isFirstPellicule: boolean
  /** Image source disponible (= ce qui sera envoyé à Qwen VL). Si null,
   *  le bouton 🪄 est désactivé. */
  imageSourceUrl: string | null
  /** Callback de patch — patche un ou plusieurs champs sur la pellicule. */
  onChange: (patch: Partial<SceneFields>) => void
}

/** Helper partagé : true si au moins un champ effectif est rempli (= "validée"). */
export function isSceneValidated(effective: SceneFields): boolean {
  return !!effective.scene_visible
    || !!effective.characters_appearance
    || !!effective.scene_offscreen
}

export default function SceneDescriptionAccordion({
  ownFields, effectiveFields, isFirstPellicule, imageSourceUrl, onChange,
}: SceneDescriptionAccordionProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="sda-root">
      {/* ── Titre cliquable (replié par défaut) ────────────────────────── */}
      <button
        type="button"
        className="sda-toggle"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="sda-title">Description de la scène</span>
        {isSceneValidated(effectiveFields) && (
          <span className="sda-status">· ✓ validée</span>
        )}
      </button>

      {/* ── Contenu déplié ─────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="sda-body-wrap"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: SDA_DUR, ease: SDA_EASE },
              opacity: { duration: SDA_DUR * 0.7, ease: SDA_EASE },
            }}
            style={{ overflow: 'hidden' }}
          >
            <SceneFieldsBody
              ownFields={ownFields}
              effectiveFields={effectiveFields}
              isFirstPellicule={isFirstPellicule}
              imageSourceUrl={imageSourceUrl}
              onChange={onChange}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Body partagé ──────────────────────────────────────────────────────────
// Extrait du composant Accordion pour pouvoir être inséré tel quel comme
// contenu d'un onglet (PromptZone du Studio Animation, refonte 2026-05-10).

export interface SceneFieldsBodyProps extends Omit<SceneDescriptionAccordionProps, never> {}

export function SceneFieldsBody({
  ownFields, effectiveFields, isFirstPellicule, imageSourceUrl, onChange,
}: SceneFieldsBodyProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [busyVisible, setBusyVisible] = useState(false)
  const [busyCharacters, setBusyCharacters] = useState(false)
  // Pas de busy state pour offscreen : Qwen VL ne peut pas inventer ce qui
  // n'est pas dans l'image, donc pas de bouton 🪄 sur ce champ.
  const [error, setError] = useState<string | null>(null)

  /** Lance Qwen VL sur l'image source pour le mode demandé et set le résultat. */
  async function handleSuggest(mode: 'scene' | 'characters') {
    if (!imageSourceUrl) return
    const setBusy = mode === 'scene' ? setBusyVisible : setBusyCharacters
    setBusy(true); setError(null)
    try {
      const res = await describeSceneViaVision(imageSourceUrl, mode)
      if (mode === 'scene') {
        onChange({ scene_visible: res.description })
      } else {
        onChange({ characters_appearance: res.description })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sda-body">
      {error && <div className="sda-error">⚠ {error}</div>}

      {/* Visible — décor & ambiance */}
      <SceneField
        label="Décor & ambiance"
        value={ownFields.scene_visible}
        inheritedValue={isFirstPellicule ? null : effectiveFields.scene_visible}
        onChange={v => onChange({ scene_visible: v })}
        placeholder="Le décor visible dans l'image (FR ou EN). Clique 🪄 pour suggérer depuis l'image."
        onSuggest={() => handleSuggest('scene')}
        busy={busyVisible}
        disabled={!imageSourceUrl}
      />

      {/* Apparence persos (à terme caché en prod) */}
      <SceneField
        label="Apparence des persos dans la scène"
        value={ownFields.characters_appearance}
        inheritedValue={isFirstPellicule ? null : effectiveFields.characters_appearance}
        onChange={v => onChange({ characters_appearance: v })}
        placeholder={'Apparence des persos visibles dans cette scène (vêtements, accessoires).\nFormat: Female: ...\\nMale: ...'}
        onSuggest={() => handleSuggest('characters')}
        busy={busyCharacters}
        disabled={!imageSourceUrl}
        multilineRows={3}
      />

      {/* Paramètres avancés (replié) */}
      <button
        type="button"
        className="sda-advanced-toggle"
        onClick={() => setAdvancedOpen(o => !o)}
      >
        {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Paramètres avancés</span>
      </button>
      <AnimatePresence initial={false}>
        {advancedOpen && (
          <motion.div
            key="sda-adv-wrap"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: SDA_DUR * 0.85, ease: SDA_EASE },
              opacity: { duration: SDA_DUR * 0.6, ease: SDA_EASE },
            }}
            style={{ overflow: 'hidden' }}
          >
            <div className="sda-advanced-body">
              <SceneField
                label="Décor hors caméra"
                value={ownFields.scene_offscreen}
                inheritedValue={isFirstPellicule ? null : effectiveFields.scene_offscreen}
                onChange={v => onChange({ scene_offscreen: v })}
                placeholder='Ce qui n&apos;est pas dans l&apos;image mais devrait être plausible si la caméra bouge. Ex: « fenêtre cathédrale à droite, escalier hors cadre à gauche »'
                onSuggest={undefined}
                busy={false}
                multilineRows={2}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Champ scène individuel — extrait pour ne pas répéter 3× le même JSX ───

interface SceneFieldProps {
  label: string
  /** Valeur propre (peut être null = hérite). */
  value: string | null
  /** Valeur héritée (depuis pellicule 1) — affichée en placeholder grisé si
   *  `value === null`. null si pas d'héritage (1ère pellicule). */
  inheritedValue: string | null
  onChange: (v: string | null) => void
  placeholder: string
  /** Si fourni, affiche un bouton 🪄 qui le déclenche. */
  onSuggest?: () => void
  busy: boolean
  disabled?: boolean
  multilineRows?: number
}

function SceneField({
  label, value, inheritedValue, onChange, placeholder, onSuggest,
  busy, disabled = false, multilineRows = 2,
}: SceneFieldProps) {
  // Affichage : si value === null → on montre la valeur héritée comme
  // placeholder visuel grisé. Quand l'auteur tape, on bascule vers value.
  const displayValue = value ?? ''
  const showInheritedHint = value === null && inheritedValue !== null

  return (
    <div className="sda-field">
      <div className="sda-field-header">
        <label className="sda-field-label">{label}</label>
        {onSuggest && (
          <button
            type="button"
            className="sda-suggest-btn"
            onClick={onSuggest}
            disabled={busy || disabled}
            title={
              disabled
                ? 'Pas d\'image source disponible'
                : 'Suggérer depuis l\'image'
            }
          >
            {busy ? <Loader2 size={12} className="sda-spin" /> : <Sparkles size={12} />}
            <span>{busy ? 'En cours…' : 'Suggérer'}</span>
          </button>
        )}
      </div>
      <textarea
        value={displayValue}
        rows={multilineRows}
        placeholder={showInheritedHint ? `Hérite : ${inheritedValue}` : placeholder}
        onChange={e => {
          const v = e.target.value
          // Si l'auteur efface tout → revient à null (re-hérite). Sinon set
          // la valeur explicitement.
          onChange(v.trim().length === 0 ? null : v)
        }}
        className="sda-textarea"
      />
    </div>
  )
}
