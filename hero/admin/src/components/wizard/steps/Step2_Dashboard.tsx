'use client'
/**
 * Step 2 du PlanWizard : dashboard du plan.
 *
 * Après sélection de l'image principale (Step 1), ce dashboard affiche l'image
 * à gauche et une série de boutons pour lancer des sous-wizards (variantes,
 * dérivations, travelling, animations...).
 *
 * Chaque clic sur un bouton → remplace cette modale par le sous-wizard
 * correspondant. Retour → cette modale ré-affichée.
 */
import React, { useState } from 'react'
import type { PlanWizardState, WizardStep } from '../types'

export interface Step2DashboardProps {
  state: PlanWizardState
  /** Lance un sous-wizard (variantes, dérivations, etc.). */
  onLaunchSubWizard: (step: Exclude<WizardStep, 'image' | 'dashboard'>) => void
  /** Ferme le wizard complet (clic "Terminer" ou extérieur). */
  onClose: () => void
  /** Permet de revenir à Step 1 (changer d'image). Déclenche un avertissement. */
  onBackToImage: () => void
}

export default function Step2Dashboard({ state, onLaunchSubWizard, onClose, onBackToImage }: Step2DashboardProps) {
  const [zoomed, setZoomed] = useState(false)
  const img = state.selectedImage

  if (!img) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
        Pas d'image sélectionnée. Reviens au Step 1.
      </div>
    )
  }

  // Sous-wizards disponibles (vague 1 : Variantes uniquement ; vagues suivantes : les autres)
  const subWizards: Array<{ step: Exclude<WizardStep, 'image' | 'dashboard'>; label: string; emoji: string; desc: string; color: string; enabled: boolean }> = [
    { step: 'variants',          emoji: '🎲', label: 'Variantes',         desc: '6 alternatives de la même scène, choisis celles à garder',       color: '#b48edd', enabled: true },
    { step: 'extract_character', emoji: '🧍', label: 'Extraire en fiche', desc: 'Détourer un personnage de l\'image pour en faire un portrait',    color: '#52c484', enabled: true },
    { step: 'derivations',       emoji: '🔄', label: 'Dérivations',       desc: 'Séquence de frames pour animation frame-by-frame',               color: '#64b5f6', enabled: true },
    { step: 'panorama_360',      emoji: '🌐', label: 'Panorama 360°',     desc: 'Vue immersive sphérique pour les moments de choix (FPS Travis)', color: '#b48edd', enabled: true },
    { step: 'travelling',        emoji: '📐', label: 'Travelling',        desc: 'Mouvement caméra Qwen multi-angles',                             color: '#7ab8d8', enabled: false },
    { step: 'wan_camera',        emoji: '📷', label: 'Caméra Wan',        desc: 'Pan/zoom/orbit cinématographique',                               color: '#e0a742', enabled: false },
    { step: 'video_wan',         emoji: '🎬', label: 'Vidéo Wan',         desc: 'Animation vidéo complète (Wan 2.2 TI2V)',                        color: '#e8a84c', enabled: false },
    { step: 'motion_brush',      emoji: '🎨', label: 'Motion Brush',      desc: 'Animer une zone spécifique via masque',                          color: '#f0a742', enabled: false },
    { step: 'tooncrafter',       emoji: '🎭', label: 'ToonCrafter',       desc: 'Interpolation cartoon/anime entre 2 keyframes',                  color: '#ff7eb6', enabled: false },
    { step: 'extra_image',       emoji: '🖼️', label: 'Image variante',    desc: 'Image variante IPAdapter (pose/angle différent)',                color: '#e0a742', enabled: false },
  ]

  const totalVariants = state.keptVariants.length

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: '0.95rem' }}>🧭 Étape 2 — Dashboard du plan</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            Image figée · {totalVariants > 0 ? `${totalVariants} variante${totalVariants > 1 ? 's' : ''}` : 'aucune variante'}
          </span>
          <button onClick={onClose} style={{ marginLeft: 'auto', fontSize: '0.72rem', fontWeight: 'bold', padding: '0.4rem 1rem', borderRadius: '4px', border: '1px solid var(--accent)', background: 'rgba(212,168,76,0.15)', color: 'var(--accent)', cursor: 'pointer' }}>
            ✓ Terminer le plan
          </button>
        </div>

        {/* Layout 2 colonnes : image gauche | actions droite */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) 1fr', gap: '1rem' }}>

          {/* Colonne image */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Image principale sélectionnée</div>
            <div onClick={() => setZoomed(true)} style={{ background: '#000', borderRadius: '6px', overflow: 'hidden', cursor: 'zoom-in', border: '2px solid var(--accent)', maxHeight: 'calc(95vh - 220px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={img.url} alt="image principale" style={{ maxWidth: '100%', maxHeight: 'calc(95vh - 220px)', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }} />
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', fontSize: '0.6rem', color: 'var(--muted)' }}>
              <span>Checkpoint : <code style={{ color: '#7ab8d8' }}>{img.checkpointKey}</code></span>
              <button onClick={onBackToImage} style={{ marginLeft: 'auto', fontSize: '0.6rem', padding: '0.15rem 0.4rem', borderRadius: '3px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
                ← Changer l'image
              </button>
            </div>

            {/* Variantes gardées (preview) */}
            {state.keptVariants.length > 0 && (
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Variantes gardées ({state.keptVariants.length})</div>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {state.keptVariants.slice(0, 8).map((url, i) => (
                    <img key={i} src={url} alt={`variante ${i + 1}`} onClick={() => { /* TODO zoom variante */ }}
                      style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: '3px', border: '1px solid #b48edd66', cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Colonne actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Enrichir ce plan</div>
            {subWizards.map(sw => (
              <button
                key={sw.step}
                onClick={() => sw.enabled && onLaunchSubWizard(sw.step)}
                disabled={!sw.enabled}
                title={sw.enabled ? sw.desc : 'Bientôt disponible'}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.8rem',
                  borderRadius: '6px', border: `1px solid ${sw.enabled ? sw.color + '66' : 'var(--border)'}`,
                  background: sw.enabled ? `${sw.color}15` : 'var(--surface-2)',
                  color: sw.enabled ? sw.color : 'var(--muted)',
                  cursor: sw.enabled ? 'pointer' : 'not-allowed',
                  opacity: sw.enabled ? 1 : 0.5,
                  textAlign: 'left', fontSize: '0.7rem', fontWeight: 'bold',
                }}
              >
                <span style={{ fontSize: '1.2rem' }}>{sw.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div>{sw.label}</div>
                  <div style={{ fontSize: '0.55rem', fontWeight: 'normal', opacity: 0.7, marginTop: '0.1rem' }}>{sw.desc}</div>
                </div>
                {!sw.enabled && <span style={{ fontSize: '0.55rem', opacity: 0.6 }}>bientôt</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {zoomed && (
        <div onClick={() => setZoomed(false)} style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#000000f5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: '2rem' }}>
          <img src={img.url} alt="zoom" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </>
  )
}
