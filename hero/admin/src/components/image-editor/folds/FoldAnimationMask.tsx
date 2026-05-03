'use client'
/**
 * Fold « Masque / Zone » — région de l'image affectée par l'animation.
 *
 * Scaffolding visuel pour l'instant. Plus tard :
 *   - Mode « Plein calque » (défaut) ou « Zone » avec drag-rect sur Canvas
 *   - Option SAM pour auto-masquer un sujet (arbre, personnage)
 *   - Preview du masque en overlay translucide sur le Canvas
 */
import React from 'react'

export default function FoldAnimationMask() {
  return (
    <div
      style={{
        padding: 'var(--ie-space-3)',
        fontSize: 'var(--ie-text-sm)',
        color: 'var(--ie-text-muted)',
        fontStyle: 'italic',
      }}
    >
      (Masque / zone ciblée — à venir)
    </div>
  )
}
