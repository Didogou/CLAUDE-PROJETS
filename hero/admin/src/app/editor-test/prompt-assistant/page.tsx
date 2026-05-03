'use client'
/**
 * POC Prompt Assistant — texte libre + aide à la saisie.
 *
 * Principe : l'auteur écrit librement en français. Sous le textarea, des chips
 * cliquables (Persos détectés / Éléments scène / Verbes / Placements / Poses)
 * permettent d'insérer rapidement les bons termes au curseur.
 *
 * Au lancement : parse via Qwen text (/api/parse-swap-command) → routage outil.
 */

import React, { useRef, useState } from 'react'

// ── Vocabulaire (mots-clés que le système comprend) ─────────────────────────

const MOCK_PNJS = [
  { id: 'lyralia',  name: 'Lyralia',  emoji: '🧝' },
  { id: 'alderic',  name: 'Aldéric',  emoji: '🧙' },
  { id: 'krag',     name: 'Krag',     emoji: '🧌' },
]

const MOCK_OBJETS = [
  { id: 'epee',    name: 'épée',    emoji: '⚔️' },
  { id: 'baton',   name: 'bâton',   emoji: '🪄' },
  { id: 'livre',   name: 'livre',   emoji: '📖' },
  { id: 'chope',   name: 'chope',   emoji: '🍺' },
  { id: 'lanterne',name: 'lanterne',emoji: '🏮' },
]

// Éléments scène : `name` = mot-clé, `article` = article défini contextuel
// (la / le / l') pour insérer "la table" plutôt que "table".
const MOCK_SCENE_ELEMENTS: { name: string; article: string }[] = [
  { name: 'table',    article: 'la' },
  { name: 'banc',     article: 'le' },
  { name: 'chaise',   article: 'la' },
  { name: 'comptoir', article: 'le' },
  { name: 'porte',    article: 'la' },
  { name: 'homme',    article: "l'" },
  { name: 'bougie',   article: 'la' },
  { name: 'tonneau',  article: 'le' },
]

const VERBES = ['ajoute', 'remplace', 'change', 'déplace', 'supprime', 'place', 'mets']
const PLACEMENTS = ['sur', 'à côté de', 'à gauche de', 'à droite de', 'devant', 'derrière', 'sous', 'dans']
const POSES = ['debout', 'assis', 'agenouillé', 'accroupi', 'allongé', 'penché', 'en marche']
const ORIENTATIONS = ['face caméra', '3/4 gauche', '3/4 droite', 'profil gauche', 'profil droit', 'de dos']
const EXPRESSIONS = ['neutre', 'sourire', 'colère', 'surprise', 'tristesse', 'concentré']
const COULEURS = ['rouge', 'bleu', 'vert', 'jaune', 'noir', 'blanc', 'rose', 'violet', 'orange', 'or']

// ── Triggers : mots-clés qui déclenchent une suggestion contextuelle ────────
//
// Quand l'auteur termine de taper l'un de ces mots/phrases, on affiche le panel
// de suggestions correspondant. L'ordre compte (le 1er match gagne).

interface Suggestion {
  label: string
  insertText?: string
}

interface Trigger {
  /** Pattern à détecter à la fin du texte avant le curseur. */
  match: RegExp
  /** Titre du panel de suggestions affiché. */
  panel: string
  /** Hint affiché à côté du titre. */
  hint?: string
  /** Liste de chips à proposer. */
  suggestions: Suggestion[]
}

const PNJS_AS_SUGG: Suggestion[] = MOCK_PNJS.map(p => ({ label: `${p.emoji} ${p.name}`, insertText: p.name }))
const OBJETS_AS_SUGG: Suggestion[] = MOCK_OBJETS.map(o => ({ label: `${o.emoji} ${o.name}`, insertText: o.name }))
// Pour la scène, on affiche juste le nom mais on insère avec l'article
// (l'apostrophe colle au mot, sinon espace : "la table" / "l'homme").
const SCENE_AS_SUGG: Suggestion[] = MOCK_SCENE_ELEMENTS.map(e => ({
  label: e.name,
  insertText: e.article.endsWith("'") ? `${e.article}${e.name}` : `${e.article} ${e.name}`,
}))
const PLACE_AS_SUGG: Suggestion[] = PLACEMENTS.map(p => ({ label: p }))
const POSE_AS_SUGG: Suggestion[] = POSES.map(p => ({ label: p }))
const ORIENT_AS_SUGG: Suggestion[] = ORIENTATIONS.map(o => ({ label: o }))
const EXPR_AS_SUGG: Suggestion[] = EXPRESSIONS.map(e => ({ label: e }))
const COULEUR_AS_SUGG: Suggestion[] = COULEURS.map(c => ({ label: c }))
const VERBES_AS_SUGG: Suggestion[] = VERBES.map(v => ({ label: v }))

const TRIGGERS: Trigger[] = [
  // Verbes d'insertion → propose un personnage OU un objet
  { match: /\b(place|placer|ajoute|ajouter|mets|mettre|insère|insérer)\s*$/i,
    panel: 'Quoi ajouter ?', hint: 'personnage ou objet',
    suggestions: [...PNJS_AS_SUGG, ...OBJETS_AS_SUGG] },

  // Mot "personnage" → propose la liste des PNJ
  { match: /\b(personnage|perso|le héros|la héroïne|l[ae] héro[s|ïne])\s*$/i,
    panel: 'Personnages disponibles',
    suggestions: PNJS_AS_SUGG },

  // Mot "objet" → propose la liste des objets
  { match: /\b(objet|chose|item)\s*$/i,
    panel: 'Objets disponibles',
    suggestions: OBJETS_AS_SUGG },

  // Verbe "remplace" → propose les éléments de la scène (à remplacer)
  { match: /\b(remplace|remplacer)\s*$/i,
    panel: 'Quoi remplacer ?', hint: 'éléments détectés dans la scène',
    suggestions: SCENE_AS_SUGG },

  // Verbe "supprime" → propose les éléments de la scène
  { match: /\b(supprime|supprimer|enlève|enlever|retire|retirer)\s*$/i,
    panel: 'Quoi supprimer ?', hint: 'éléments détectés dans la scène',
    suggestions: SCENE_AS_SUGG },

  // Verbe "déplace" → propose les éléments de la scène
  { match: /\b(déplace|déplacer|bouge|bouger)\s*$/i,
    panel: 'Quoi déplacer ?', hint: 'éléments détectés dans la scène',
    suggestions: SCENE_AS_SUGG },

  // Mots de placement → propose les éléments de la scène (la cible du placement)
  { match: /\b(à côté de|sur|devant|derrière|sous|dans|à gauche de|à droite de|près de|au-dessus de|au-dessus du)\s*$/i,
    panel: 'Élément cible', hint: 'auto-détecté du Studio',
    suggestions: SCENE_AS_SUGG },

  // Verbe "change" → propose les attributs modifiables
  { match: /\b(change|changer|modifie|modifier)\s*(la|le|les)?\s*$/i,
    panel: 'Que changer ?',
    suggestions: [
      { label: 'couleur' }, { label: 'taille' }, { label: 'orientation' },
      { label: 'pose' }, { label: 'expression' }, { label: 'tenue' },
    ] },

  // "couleur" → propose les couleurs
  { match: /\b(couleur|teinte)\s*(en|de|du)?\s*$/i,
    panel: 'Couleur',
    suggestions: COULEUR_AS_SUGG },

  // "qui est" / "qui" → propose des poses
  { match: /\b(qui est|est|en train d'être|en posture)\s*$/i,
    panel: 'Pose',
    suggestions: POSE_AS_SUGG },

  // "expression" / "visage" / "air" → propose les expressions
  { match: /\b(expression|visage|air|mine)\s*$/i,
    panel: 'Expression du visage',
    suggestions: EXPR_AS_SUGG },

  // "face" / "orienté" → propose les orientations
  { match: /\b(face|orienté|orientée|tourné|tournée|vu|vue)\s*$/i,
    panel: 'Orientation',
    suggestions: ORIENT_AS_SUGG },

  // Après un nom de personnage → propose un placement (sur, à côté de…)
  { match: new RegExp(`\\b(${MOCK_PNJS.map(p => p.name).join('|')})\\s+$`, 'i'),
    panel: 'Placement',
    hint: 'où placer ce personnage ?',
    suggestions: PLACE_AS_SUGG },
]

// Suggestions par défaut quand aucun trigger n'a matché : verbes courants
const DEFAULT_SUGGESTIONS: Trigger = {
  match: /.*/,
  panel: 'Démarrer',
  hint: 'tape un verbe pour commencer (ou clique l\'un d\'eux)',
  suggestions: VERBES_AS_SUGG,
}

// Détecte le trigger correspondant aux derniers caractères du texte
function detectTrigger(textBeforeCursor: string): Trigger {
  for (const t of TRIGGERS) {
    if (t.match.test(textBeforeCursor)) return t
  }
  return DEFAULT_SUGGESTIONS
}

// ── Theme Studio ────────────────────────────────────────────────────────────

const COLORS = {
  bgPage:     '#0F0F12',
  bgSurface:  '#17171B',
  bgElevated: '#1F1F25',
  bgHover:    '#26262E',
  border:     'rgba(255,255,255,0.08)',
  borderHover:'rgba(255,255,255,0.16)',
  textPrimary:'#FAFAFA',
  textMuted:  '#A1A1AA',
  textFaint:  '#71717A',
  accent:     '#EC4899',
  accentHover:'#DB2777',
  accentSubtle:'rgba(236,72,153,0.12)',
  success:    '#10B981',
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PromptAssistantPage() {
  const [text, setText] = useState('')
  const [cursor, setCursor] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Met à jour la position du curseur depuis le textarea
  function syncCursor() {
    const ta = textareaRef.current
    if (ta) setCursor(ta.selectionStart)
  }

  // Insère un texte au curseur (ou à la fin si pas de focus)
  function insertAtCursor(insertion: string) {
    const ta = textareaRef.current
    if (!ta) {
      setText(t => t + (t.endsWith(' ') || t === '' ? '' : ' ') + insertion + ' ')
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const before = text.slice(0, start)
    const after = text.slice(end)
    const sep = before.length > 0 && !before.endsWith(' ') ? ' ' : ''
    const newText = before + sep + insertion + ' ' + after
    setText(newText)
    const newCursor = (before + sep + insertion + ' ').length
    setCursor(newCursor)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(newCursor, newCursor)
    }, 0)
  }

  function handleLaunch() {
    if (!text.trim()) return
    alert(`POC : la commande qui partirait au backend :\n\n"${text.trim()}"\n\n→ /api/parse-swap-command\n→ Qwen text NLU parse en JSON\n→ Routage vers Flux Kontext / character_swap / etc.\n\n(Phase 3 : connecter le backend)`)
  }

  // Détecte le contexte courant (mot-clé tapé juste avant le curseur)
  const textBeforeCursor = text.slice(0, cursor)
  const trigger = detectTrigger(textBeforeCursor)
  const isDefault = trigger === DEFAULT_SUGGESTIONS

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: COLORS.textPrimary, letterSpacing: -0.2 }}>
            Prompt Assistant
          </h1>
          <p style={{ color: COLORS.textMuted, fontSize: 12, lineHeight: 1.5 }}>
            Écris en français. Les suggestions ci-dessous s&apos;adaptent au mot-clé que tu tapes (ex : <em>place</em> → personnages, <em>à côté de</em> → éléments de la scène).
          </p>
        </div>

        {/* Zone de saisie */}
        <textarea ref={textareaRef}
          value={text}
          onChange={e => { setText(e.target.value); setCursor(e.target.selectionStart) }}
          onSelect={syncCursor}
          onKeyUp={syncCursor}
          onClick={syncCursor}
          onFocus={e => { e.currentTarget.style.borderColor = COLORS.accent; syncCursor() }}
          onBlur={e => { e.currentTarget.style.borderColor = COLORS.border }}
          placeholder="ex: Place Lyralia assise à côté de la table, face caméra, expression neutre"
          rows={5}
          style={{
            width: '100%', padding: '14px 16px',
            background: COLORS.bgSurface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            color: COLORS.textPrimary,
            fontFamily: 'Inter, -apple-system, sans-serif',
            fontSize: 14, lineHeight: 1.6,
            resize: 'vertical', outline: 'none',
            transition: 'border-color 120ms ease',
            boxSizing: 'border-box',
            marginBottom: 12,
          }} />

        {/* Panel contextuel : un seul, basé sur le mot-clé qui précède le curseur */}
        <SuggestionPanel
          title={trigger.panel}
          hint={trigger.hint}
          suggestions={trigger.suggestions}
          onPick={insertAtCursor}
          subtle={isDefault}
        />

        {/* Bouton Lancer */}
        <div style={{ marginTop: 20 }}>
          <button onClick={handleLaunch}
            disabled={!text.trim()}
            onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = COLORS.accentHover }}
            onMouseLeave={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = COLORS.accent }}
            style={{
              padding: '12px 24px',
              background: !text.trim() ? COLORS.bgSurface : COLORS.accent,
              border: `1px solid ${!text.trim() ? COLORS.border : COLORS.accent}`,
              borderRadius: 6,
              color: !text.trim() ? COLORS.textFaint : '#fff',
              fontSize: 13, fontFamily: 'inherit', fontWeight: 600,
              cursor: !text.trim() ? 'not-allowed' : 'pointer',
              opacity: !text.trim() ? 0.5 : 1,
              transition: 'all 120ms ease',
            }}>
            Lancer →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sous-composants ──────────────────────────────────────────────────────────

function SuggestionPanel({ title, hint, suggestions, onPick, subtle }: {
  title: string
  hint?: string
  suggestions: Suggestion[]
  onPick: (text: string) => void
  /** Style atténué pour le panel "défaut" (pas de trigger spécifique). */
  subtle?: boolean
}) {
  const borderColor = subtle ? COLORS.border : 'rgba(236,72,153,0.25)'
  const titleColor = subtle ? COLORS.textFaint : COLORS.accent
  return (
    <div style={{
      padding: '10px 12px',
      background: COLORS.bgSurface,
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      transition: 'border-color 200ms ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{
          fontSize: 10, color: titleColor,
          textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700,
        }}>
          {title}
        </span>
        {hint && <span style={{ fontSize: 10, color: COLORS.textFaint, fontStyle: 'italic' }}>· {hint}</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => onPick(s.insertText ?? s.label)}
            onMouseEnter={e => {
              e.currentTarget.style.background = COLORS.accent
              e.currentTarget.style.color = '#fff'
              e.currentTarget.style.borderColor = COLORS.accent
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = COLORS.bgElevated
              e.currentTarget.style.color = COLORS.textPrimary
              e.currentTarget.style.borderColor = COLORS.border
            }}
            style={{
              padding: '5px 10px',
              background: COLORS.bgElevated,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              color: COLORS.textPrimary,
              fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
              cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'all 120ms ease',
            }}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Styles globaux ──────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: COLORS.bgPage,
  color: COLORS.textPrimary,
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}
