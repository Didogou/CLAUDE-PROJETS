'use client'
/**
 * HeroToast — micro-composant toast réutilisable (refonte 2026-05-12).
 *
 * Apparaît en bas centre de l'écran, fade in/out, disparaît auto après
 * `durationMs`. Pas de gestion stack pour V1 (un seul toast à la fois,
 * le suivant écrase le précédent).
 *
 * Usage :
 *   const [toast, setToast] = useState<{ message: string; kind?: 'success' | 'error' } | null>(null)
 *   ...
 *   setToast({ message: 'Sauvegardé ✓', kind: 'success' })
 *   <HeroToast toast={toast} onDismiss={() => setToast(null)} />
 */

import React, { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, AlertCircle } from 'lucide-react'

export interface HeroToastValue {
  message: string
  kind?: 'success' | 'error'
}

interface HeroToastProps {
  toast: HeroToastValue | null
  onDismiss: () => void
  /** Durée auto-dismiss en ms. Défaut 2400. */
  durationMs?: number
}

export default function HeroToast({ toast, onDismiss, durationMs = 2400 }: HeroToastProps) {
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(id)
  }, [toast, durationMs, onDismiss])

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          className={`hero-toast hero-toast-${toast.kind ?? 'success'}`}
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          {toast.kind === 'error'
            ? <AlertCircle size={15} />
            : <Check size={15} />}
          <span>{toast.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
