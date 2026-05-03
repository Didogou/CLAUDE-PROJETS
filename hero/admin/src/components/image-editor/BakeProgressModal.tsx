'use client'
/**
 * Modal plein-écran pendant un bake animation (motion_brush / cinemagraph).
 *
 * Intercepté tous les clics pour éviter que l'utilisateur lance des actions
 * en parallèle ou change d'onglet (ce qui perdrait le state local du fold).
 *
 * Lifté depuis EditorStateContext.bakeStatus → survit aux re-render et
 * unmount de FoldAnimationBake.
 *
 * Contenu :
 *   - Spinner animé + icône du kind
 *   - Label de phase (mis à jour depuis le bake en cours)
 *   - Compteur de temps écoulé (live, 1 Hz)
 *   - Progress bar indicative (basée sur l'estimation totale)
 *   - Avertissement "Ne ferme pas la fenêtre"
 */
import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Film, Loader2, AlertCircle, X, Scissors } from 'lucide-react'
import { useEditorState } from './EditorStateContext'

export default function BakeProgressModal() {
  const { bakeStatus, setBakeStatus } = useEditorState()
  const [elapsedSec, setElapsedSec] = useState(0)

  // Met à jour le compteur toutes les secondes tant qu'un bake est actif
  useEffect(() => {
    if (!bakeStatus) return
    const tick = () => {
      setElapsedSec(Math.floor((Date.now() - bakeStatus.startedAt) / 1000))
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [bakeStatus])

  if (!bakeStatus) return null

  const { phase, kind, estimatedTotalSec } = bakeStatus
  const progressPct = Math.min(100, Math.round((elapsedSec / estimatedTotalSec) * 100))
  const isOvertime = elapsedSec > estimatedTotalSec
  const mm = Math.floor(elapsedSec / 60).toString().padStart(2, '0')
  const ss = (elapsedSec % 60).toString().padStart(2, '0')
  const totalMm = Math.floor(estimatedTotalSec / 60).toString().padStart(2, '0')
  const totalSs = (estimatedTotalSec % 60).toString().padStart(2, '0')

  return (
    <AnimatePresence>
      <motion.div
        key="bake-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.72)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Bloque tous les clics en dessous (fold/canvas/etc.)
          pointerEvents: 'auto',
        }}
        // Intercepte Escape, mousedown sur tout le backdrop → impossible de fermer
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        <motion.div
          key="bake-card"
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          style={{
            background: 'var(--ie-surface)',
            color: 'var(--ie-text)',
            borderRadius: 'var(--ie-radius-lg)',
            border: '1px solid var(--ie-border-strong)',
            padding: 'var(--ie-space-6) var(--ie-space-8)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
            minWidth: 420,
            maxWidth: 520,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--ie-space-4)',
          }}
        >
          {/* Icône + spinner rose */}
          <div style={{
            position: 'relative',
            width: 64, height: 64,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              style={{
                position: 'absolute',
                inset: 0,
                border: '3px solid rgba(236, 72, 153, 0.15)',
                borderTopColor: 'var(--ie-accent)',
                borderRadius: '50%',
              }}
            />
            {kind === 'sam_cut' || kind === 'grabcut'
              ? <Scissors size={24} style={{ color: 'var(--ie-accent)', zIndex: 1 }} />
              : <Film size={24} style={{ color: 'var(--ie-accent)', zIndex: 1 }} />}
          </div>

          {/* Titre du kind */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 'var(--ie-text-lg)',
              fontWeight: 700,
              color: 'var(--ie-text)',
              letterSpacing: '0.01em',
            }}>
              {kind === 'cinemagraph' ? 'Génération Cinemagraph'
                : kind === 'sam_cut' ? 'SAM analyse l\'image'
                : kind === 'grabcut' ? 'GrabCut extrait l\'objet'
                : 'Génération Motion Brush'}
            </div>
            <div style={{
              fontSize: 'var(--ie-text-sm)',
              color: 'var(--ie-text-muted)',
              marginTop: 'var(--ie-space-1)',
              minHeight: 20,
            }}>
              {phase}
            </div>
          </div>

          {/* Progress bar (indicative, basée sur estimé) */}
          <div style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ie-space-2)',
          }}>
            <div style={{
              width: '100%',
              height: 8,
              background: 'var(--ie-surface-2)',
              borderRadius: 4,
              overflow: 'hidden',
              position: 'relative',
            }}>
              <motion.div
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background: isOvertime
                    ? 'var(--ie-warning)'
                    : 'linear-gradient(90deg, var(--ie-accent) 0%, #F472B6 100%)',
                  borderRadius: 4,
                  boxShadow: '0 0 8px rgba(236, 72, 153, 0.4)',
                }}
              />
              {/* Shimmer effect quand en overtime (prend plus de temps que prévu) */}
              {isOvertime && (
                <motion.div
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '40%',
                    height: '100%',
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
                  }}
                />
              )}
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--ie-text-xs)',
              color: 'var(--ie-text-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <span>{mm}:{ss} écoulé</span>
              <span>~ {totalMm}:{totalSs} estimé</span>
            </div>
          </div>

          {/* Avertissement */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--ie-space-2)',
            padding: 'var(--ie-space-2) var(--ie-space-3)',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 'var(--ie-radius)',
            fontSize: 'var(--ie-text-xs)',
            color: 'var(--ie-text-muted)',
            width: '100%',
          }}>
            <AlertCircle size={14} style={{ color: 'var(--ie-warning)', flexShrink: 0 }} />
            <span>Ne ferme pas la fenêtre — le GPU tourne, ton résultat arrive.</span>
          </div>

          {/* Spinner loader mini (au cas où le spinner principal passe inaperçu) */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--ie-space-2)',
            fontSize: 'var(--ie-text-xs)',
            color: 'var(--ie-text-faint)',
          }}>
            <Loader2 size={12} className="ie-spin" />
            <span>GPU : AnimateDiff + VAE encode + VideoCombine…</span>
          </div>

          {/* Bouton d'annulation d'urgence — visible en overtime (2× l'estimé).
               Il ferme juste la modal côté UI ; le GPU continue son calcul,
               mais l'utilisateur n'est plus bloqué si le polling a un bug. */}
          {elapsedSec > estimatedTotalSec * 2 && (
            <button
              onClick={() => setBakeStatus(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--ie-space-2)',
                padding: 'var(--ie-space-2) var(--ie-space-3)',
                marginTop: 'var(--ie-space-2)',
                background: 'transparent',
                border: '1px solid var(--ie-border-strong)',
                borderRadius: 'var(--ie-radius)',
                color: 'var(--ie-text-muted)',
                fontSize: 'var(--ie-text-xs)',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
              title="Ferme la fenêtre — le GPU continue de calculer en arrière-plan. À utiliser si le suivi semble figé."
            >
              <X size={12} />
              Fermer le suivi (le GPU continue)
            </button>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
