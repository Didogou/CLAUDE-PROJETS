'use client'
/**
 * AudioTagPalette — palette d'insertion de tags d'intonation ElevenLabs v3.
 *
 * Click sur un tag d'une catégorie → insère `[tag]` à la position du curseur
 * dans la textarea cible (callback `onInsert`). Le modèle TTS bascule auto
 * sur eleven_v3 dès qu'un tag `[...]` est détecté côté serveur (cf
 * /api/elevenlabs/tts/route.ts).
 *
 * 8 catégories en français — ElevenLabs v3 multilingual interprète les tags
 * FR sémantiquement (vérifié contre l'usage legacy /books/[id]/page.tsx où
 * la palette est en place sans traduction FR→EN avant envoi API).
 *
 * UX :
 *   - Boutons compacts groupés par catégorie, accent color par groupe
 *   - Tooltip au hover montre le tag final inséré
 *   - Insertion à la position du curseur (replace selection si une partie
 *     du texte est sélectionnée), refocus auto sur la textarea
 *
 * Refonte 2026-05-12 — extraction depuis legacy admin (page.tsx:9936).
 */

import React from 'react'

interface TagCategory {
  /** Label affiché en chip catégorie. */
  label: string
  /** Couleur accent (hex). */
  color: string
  /** Tags FR sans crochets — wrapped en `[tag]` à l'insertion. */
  tags: string[]
}

const CATEGORIES: ReadonlyArray<TagCategory> = [
  { label: 'Émotions',     color: '#e879f9', tags: ['excité', 'fatigué', 'nerveux', 'frustré', 'triste', 'calme', 'en colère'] },
  { label: 'Réactions',    color: '#fb923c', tags: ['soupir', 'rire', 'avale', 'halète', 'chuchote'] },
  { label: 'Rythme',       color: '#60a5fa', tags: ['pause', 'pause courte', 'pause longue', 'hésite', 'bégaye', 'pressé'] },
  { label: 'Ton',          color: '#4ade80', tags: ['joyeusement', 'platement', 'impassible', 'enjoué', 'sarcastiquement', 'dramatique', 'pleurnichard', 'résigné', 'factuel'] },
  { label: 'Volume',       color: '#facc15', tags: ['chuchotant', 'criant', 'doucement', 'fort'] },
  { label: 'Accentuation', color: '#f87171', tags: ['accentué', 'atténué', 'accent sur le mot suivant'] },
  { label: 'Accents',      color: '#a78bfa', tags: ['accent britannique', 'accent australien', 'accent du sud des États-Unis'] },
  { label: 'Rôles',        color: '#34d399', tags: ['voix de pirate', 'voix de scientifique maléfique', 'ton enfantin'] },
]

interface AudioTagPaletteProps {
  /** Insère un tag (déjà wrappé `[...]`) dans la textarea cible à la position
   *  du curseur. Le caller gère le state de la textarea. */
  onInsert: (tag: string) => void
  /** Si fourni, déclenche un comportement d'insertion DIRECT à la position du
   *  curseur de cette textarea (replace selection si applicable + refocus). */
  textareaRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  /** Disabled global (ex: pendant une génération). */
  disabled?: boolean
  /** Compact mode = 1 select par catégorie au lieu d'une liste de boutons.
   *  Default true (gain de place). */
  compact?: boolean
}

export default function AudioTagPalette({
  onInsert, textareaRef, disabled, compact = true,
}: AudioTagPaletteProps) {
  /** Insertion intelligente : si textareaRef fourni, insère à la position du
   *  curseur (ou remplace la sélection) puis refocus + place le curseur après
   *  le tag inséré. Sinon délègue tel quel au callback. */
  function handleInsert(tagWrapped: string) {
    if (!textareaRef?.current) {
      onInsert(tagWrapped)
      return
    }
    const el = textareaRef.current
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    // Espace de séparation conditionnel : si le caractère avant n'est pas un
    // espace/début, on insère un espace avant le tag pour éviter "Bonjour[soupir]".
    const before = el.value.slice(0, start)
    const after = el.value.slice(end)
    const needSpaceBefore = before.length > 0 && !/\s$/.test(before)
    const needSpaceAfter = after.length > 0 && !/^\s/.test(after)
    const insertion = `${needSpaceBefore ? ' ' : ''}${tagWrapped}${needSpaceAfter ? ' ' : ''}`
    const newValue = before + insertion + after
    // Met à jour la valeur via dispatcher input event (le parent React picksup)
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el), 'value',
    )?.set
    if (setter) {
      setter.call(el, newValue)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    el.focus()
    const cursorPos = start + insertion.length
    el.setSelectionRange(cursorPos, cursorPos)
    onInsert(tagWrapped)
  }

  if (compact) {
    return (
      <div className="atp-row">
        {CATEGORIES.map(cat => (
          <select
            key={cat.label}
            className="atp-select"
            value=""
            disabled={disabled}
            onChange={e => {
              const t = e.target.value
              if (t) {
                handleInsert(`[${t}]`)
                e.target.value = ''
              }
            }}
            style={{
              borderColor: `${cat.color}55`,
              background: `${cat.color}12`,
              color: cat.color,
            }}
            title={`Insérer un tag ${cat.label.toLowerCase()}`}
          >
            <option value="">{cat.label}</option>
            {cat.tags.map(tag => (
              <option key={tag} value={tag}>[{tag}]</option>
            ))}
          </select>
        ))}
      </div>
    )
  }

  // Mode étendu : liste de boutons par catégorie (= legacy)
  return (
    <div className="atp-grid">
      {CATEGORIES.map(cat => (
        <div key={cat.label} className="atp-group">
          <div className="atp-group-label" style={{ color: cat.color }}>
            {cat.label}
          </div>
          <div className="atp-group-tags">
            {cat.tags.map(tag => (
              <button
                key={tag}
                type="button"
                className="atp-tag-btn"
                onClick={() => handleInsert(`[${tag}]`)}
                disabled={disabled}
                style={{
                  borderColor: `${cat.color}66`,
                  color: cat.color,
                  background: `${cat.color}14`,
                }}
                title={`Insérer [${tag}]`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
