'use client'
/**
 * Toaster — système de notifications bottom-center, auto-dismiss.
 *
 * Refonte 2026-05-20 — utilisé par Studio Section pour les feedbacks rapides
 * (frame supprimée, split effectué, etc.) à la place des alert() bloquants.
 *
 * Usage :
 *   const [toasts, addToast] = useToasts()
 *   addToast({ message: 'Frame supprimée', type: 'success' })
 *   <Toaster toasts={toasts} onDismiss={...} />
 */

import React, { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import './toaster.css'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
  /** ms avant auto-dismiss. Default 3000. 0 = pas d'auto-dismiss. */
  durationMs?: number
}

/** Hook minimaliste. Retourne [toasts, addToast, dismissToast].
 *  addToast retourne l'id généré pour permettre dismissToast(id) ciblé
 *  (ex: dismiss un toast "en cours" quand l'op finit). */
export function useToasts(): [Toast[], (t: Omit<Toast, 'id'>) => string, (id: string) => void] {
  const [toasts, setToasts] = useState<Toast[]>([])
  const addToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts(prev => [...prev, { ...t, id }])
    return id
  }, [])
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])
  return [toasts, addToast, dismissToast]
}

interface ToasterProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

export default function Toaster({ toasts, onDismiss }: ToasterProps) {
  if (toasts.length === 0) return null
  return (
    <div className="hero-toaster" role="status" aria-live="polite">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const durationMs = toast.durationMs ?? 3000
  useEffect(() => {
    if (durationMs <= 0) return
    const t = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(t)
  }, [durationMs, onDismiss])
  const Icon = toast.type === 'success' ? CheckCircle2
    : toast.type === 'error' ? AlertCircle
    : Info
  return (
    <div className={`hero-toast hero-toast-${toast.type}`}>
      <Icon size={14} className="hero-toast-icon" />
      <span className="hero-toast-message">{toast.message}</span>
      <button
        type="button"
        className="hero-toast-close"
        onClick={onDismiss}
        aria-label="Fermer"
      >
        <X size={11} />
      </button>
    </div>
  )
}
