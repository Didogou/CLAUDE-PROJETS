'use client'
/**
 * InspectorPanel — V1 visuel only (refonte 2026-05-14, option C du merge).
 *
 * Panneau d'édition contextuel qui apparaît EN BAS de la timeline du Studio
 * Section quand l'auteur clique sur une action de création (Animation, Image,
 * Son, Musique, Texte) ou quand il sélectionne un bloc existant.
 *
 * V1 = SHELL VISUEL. Aucune logique de création/édition réelle. Juste le
 * layout pour valider que la place est suffisante avant d'investir dans le
 * refacto complet (phase 2 = brancher l'orchestration AnimationStudio /
 * Designer en place).
 *
 * Architecture : 1 mode = 1 sous-panneau. Header commun (titre + close).
 */

import React from 'react'
import {
  X, Sparkles, Film, Image as ImageIcon, Volume2, Music, Type,
} from 'lucide-react'

export type InspectorMode = 'animation' | 'image' | 'sfx' | 'music' | 'text'

interface InspectorPanelProps {
  mode: InspectorMode
  onClose: () => void
}

const MODE_META: Record<InspectorMode, { icon: React.ReactNode; title: string }> = {
  animation: { icon: <Film size={14} />,      title: 'Animation' },
  image:     { icon: <ImageIcon size={14} />, title: 'Image' },
  sfx:       { icon: <Volume2 size={14} />,   title: 'Son' },
  music:     { icon: <Music size={14} />,     title: 'Musique' },
  text:      { icon: <Type size={14} />,      title: 'Texte' },
}

export default function InspectorPanel({ mode, onClose }: InspectorPanelProps) {
  const meta = MODE_META[mode]
  return (
    <div className="ste-inspector">
      <header className="ste-inspector-header">
        <span className="ste-inspector-title">
          {meta.icon}
          <span>{meta.title}</span>
        </span>
        <button
          type="button"
          className="ste-inspector-close"
          onClick={onClose}
          title="Fermer"
          aria-label="Fermer"
        >
          <X size={14} />
        </button>
      </header>

      {/* Body — switch selon le mode. V1 = placeholders compacts. */}
      <div className="ste-inspector-body">
        {mode === 'animation' && <AnimationInspectorBody />}
        {mode === 'image'     && <ImageInspectorBody />}
        {mode === 'sfx'       && <SfxInspectorBody />}
        {mode === 'music'     && <MusicInspectorBody />}
        {mode === 'text'      && <TextInspectorBody />}
      </div>

      {/* Footer — bouton "Générer" compact (cohérent avec les actions toolbar :
       *  icône + label dessous). À brancher en phase 2. */}
      <footer className="ste-inspector-footer">
        <button type="button" className="ste-inspector-generate" disabled>
          <Sparkles size={14} />
          <span>Générer</span>
        </button>
      </footer>
    </div>
  )
}

// ── Sous-panneaux V1 (visuel only) ─────────────────────────────────────────

function AnimationInspectorBody() {
  return (
    <>
      <div className="ste-inspector-row">
        <button type="button" className="ste-inspector-tab active">Shot 1</button>
        <button type="button" className="ste-inspector-tab-add" title="Ajouter un shot">+</button>
        <span className="ste-inspector-meta">Plan moyen · Caméra fixe · 4s</span>
      </div>
      <div className="ste-inspector-row">
        <button type="button" className="ste-inspector-perso-add">+ Perso</button>
      </div>
      <label className="ste-inspector-field">
        <span className="ste-inspector-field-label">Action de scène</span>
        <textarea
          className="ste-inspector-textarea"
          rows={2}
          placeholder="Décris l'animation sans perso — ex : « Plan aérien qui plonge sur la ville futuriste, descend lentement vers l'entrée d'un immeuble »"
        />
      </label>
    </>
  )
}

function ImageInspectorBody() {
  return (
    <label className="ste-inspector-field">
      <span className="ste-inspector-field-label">Prompt image</span>
      <textarea
        className="ste-inspector-textarea"
        rows={2}
        placeholder="Décris la scène — ex : « Bureau futuriste néon, vue depuis la fenêtre, ambiance crépuscule »"
      />
    </label>
  )
}

function SfxInspectorBody() {
  return (
    <label className="ste-inspector-field">
      <span className="ste-inspector-field-label">Effet sonore</span>
      <input
        type="text"
        className="ste-inspector-input"
        placeholder="Ex : pluie sur vitre, porte qui claque…"
      />
    </label>
  )
}

function MusicInspectorBody() {
  return (
    <label className="ste-inspector-field">
      <span className="ste-inspector-field-label">Musique d'ambiance</span>
      <input
        type="text"
        className="ste-inspector-input"
        placeholder="Ex : nappe synthwave mélancolique, piano solo tendu…"
      />
    </label>
  )
}

function TextInspectorBody() {
  return (
    <>
      <label className="ste-inspector-field">
        <span className="ste-inspector-field-label">Texte à afficher</span>
        <input
          type="text"
          className="ste-inspector-input"
          placeholder="Ex : « Trois jours plus tard… »"
        />
      </label>
      <div className="ste-inspector-row">
        <select className="ste-inspector-select" defaultValue="fade">
          <option value="fade">Fade in/out</option>
          <option value="typewriter">Typewriter</option>
          <option value="slide_up">Slide up</option>
        </select>
        <select className="ste-inspector-select" defaultValue="center">
          <option value="top">Haut</option>
          <option value="center">Centre</option>
          <option value="bottom">Bas</option>
        </select>
      </div>
    </>
  )
}
