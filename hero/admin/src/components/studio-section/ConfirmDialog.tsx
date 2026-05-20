'use client'
/**
 * ConfirmDialog — modal de confirmation réutilisable.
 *
 * Pour les actions destructrices (suppression, reset, etc.). Backdrop
 * blur, animation fade+scale au mount, Esc/click backdrop ferment.
 *
 * V1 : pas de dépendance framer-motion — juste CSS transitions pour
 * keep it simple.
 */

import React, { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: React.ReactNode
  /** Texte du bouton confirmation (default : "Confirmer"). */
  confirmLabel?: string
  /** Texte du bouton annulation (default : "Annuler"). */
  cancelLabel?: string
  /** Variant visuel : 'danger' (rouge, default pour delete) ou 'primary'. */
  variant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
  /** Si true, le bouton confirmation est désactivé + spinner (action en cours). */
  loading?: boolean
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'danger',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)

  // Esc ferme
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, loading, onCancel])

  // Auto-focus sur Annuler au mount (bouton non-destructeur par défaut)
  useEffect(() => {
    if (open) {
      // Focus après que la modal ait fini son fade-in
      const t = setTimeout(() => cancelBtnRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="ss-confirm-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onCancel() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ss-confirm-title"
    >
      <div className="ss-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="ss-confirm-close"
          onClick={onCancel}
          disabled={loading}
          aria-label="Fermer"
        >
          <X size={16} />
        </button>

        <div className={`ss-confirm-icon ss-confirm-icon-${variant}`}>
          <AlertTriangle size={24} />
        </div>

        <h3 id="ss-confirm-title" className="ss-confirm-title">{title}</h3>
        <div className="ss-confirm-message">{message}</div>

        <div className="ss-confirm-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="ss-confirm-btn ss-confirm-btn-cancel"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`ss-confirm-btn ss-confirm-btn-${variant}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'En cours…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
