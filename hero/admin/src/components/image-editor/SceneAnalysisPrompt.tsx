'use client'
/**
 * Modal popup demandant à l'utilisateur s'il veut lancer l'analyse de scène
 * (détection des objets et personnages) sur l'image courante du Studio Designer.
 *
 * S'affiche UNIQUEMENT si :
 *   - On est en Phase B (editing) : enabled=true côté usePreAnalyzeImage
 *   - L'image n'a PAS d'analyse en cache DB (1ère ouverture du plan)
 *   - L'utilisateur n'a pas déjà skippé cette image dans la session
 *
 * Au clic Analyser : déclenche l'analyse + affiche BakeProgressModal pendant ~50s.
 * Au clic Annuler : ferme la popup, l'image n'est pas analysée (peut être
 *   re-déclenchée manuellement plus tard via un bouton dédié — TODO V2).
 *
 * Props pilotées par le hook usePreAnalyzeImage. Composant 100% présentation.
 */

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ScanSearch, X } from 'lucide-react'

interface SceneAnalysisPromptProps {
  open: boolean
  onConfirm: () => void
  onSkip: () => void
}

export default function SceneAnalysisPrompt({
  open, onConfirm, onSkip,
}: SceneAnalysisPromptProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="sap-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(3px)',
            zIndex: 9998,  // sous BakeProgressModal (9999) si les 2 doivent se chevaucher
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onMouseDown={onSkip}  // clic à l'extérieur = skip
        >
          <motion.div
            key="sap-card"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{
              background: 'var(--ie-surface)',
              color: 'var(--ie-text)',
              borderRadius: 12,
              border: '1px solid var(--ie-border-strong)',
              padding: '24px 28px',
              boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45)',
              minWidth: 380,
              maxWidth: 460,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
            onMouseDown={(e) => e.stopPropagation()}  // empêche click-outside de fermer si clic dans la card
          >
            {/* Bouton X discret en haut à droite */}
            <button
              type="button"
              onClick={onSkip}
              style={{
                position: 'absolute',
                top: 10, right: 10,
                width: 24, height: 24,
                background: 'transparent',
                border: 'none',
                color: 'var(--ie-text-faint)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
              }}
              aria-label="Fermer"
              title="Fermer (analyse non lancée)"
            >
              <X size={14} />
            </button>

            {/* Icône scan */}
            <div style={{
              width: 56, height: 56,
              borderRadius: '50%',
              background: 'color-mix(in srgb, var(--ie-accent) 14%, transparent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ie-accent)',
            }}>
              <ScanSearch size={26} />
            </div>

            {/* Titre + sous-titre */}
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 700,
                color: 'var(--ie-text)',
                letterSpacing: '-0.01em',
              }}>
                Voulez-vous une analyse de l&apos;image&nbsp;?
              </h2>
              <p style={{
                margin: 0,
                fontSize: 12,
                color: 'var(--ie-text-muted)',
                fontStyle: 'italic',
                lineHeight: 1.4,
              }}>
                Identification des objets et des personnages
              </p>
            </div>

            {/* Boutons */}
            <div style={{
              display: 'flex',
              gap: 8,
              width: '100%',
              marginTop: 4,
            }}>
              <button
                type="button"
                onClick={onSkip}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  background: 'transparent',
                  border: '1px solid var(--ie-border)',
                  borderRadius: 6,
                  color: 'var(--ie-text-muted)',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'all 120ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ie-text)'
                  e.currentTarget.style.color = 'var(--ie-text)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ie-border)'
                  e.currentTarget.style.color = 'var(--ie-text-muted)'
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={onConfirm}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  background: 'var(--ie-accent)',
                  border: '1px solid var(--ie-accent)',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'background 120ms',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'color-mix(in srgb, #000 10%, var(--ie-accent))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--ie-accent)'
                }}
              >
                <ScanSearch size={14} />
                Analyser
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
