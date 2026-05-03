'use client'
/**
 * Bouton flottant pour ouvrir/fermer manuellement la ZoomLoupe.
 *
 * Comportement :
 *   - Click → ouvre la loupe (la même que pendant Lasso/Brush, voir ZoomLoupe.tsx)
 *   - Re-click → ferme la loupe
 *   - Si déjà ouverte par un autre flow (Lasso, Brush, weather), no-op
 *     (l'état de la loupe est dérivé d'un OR de plusieurs sources)
 *   - ESC ferme la loupe (handled par CanvasOverlay)
 *
 * Positionné en absolute à DROITE dans la toolbar (à côté du ciseau centré).
 * Le parent doit être en position:relative (la toolbar l'est).
 */
import React from 'react'
import { Search } from 'lucide-react'
import { useEditorState } from './EditorStateContext'

export default function ZoomLoupeToggleButton() {
  const { imageUrl, zoomLoupeManualOpen, setZoomLoupeManualOpen } = useEditorState()

  if (!imageUrl) return null

  const active = zoomLoupeManualOpen

  return (
    <button
      type="button"
      onClick={() => setZoomLoupeManualOpen(!zoomLoupeManualOpen)}
      title={active ? 'Fermer la loupe (Esc)' : 'Loupe — zoom de visualisation'}
      aria-label={active ? 'Fermer la loupe' : 'Ouvrir la loupe'}
      aria-pressed={active}
      style={{
        // Positionné à droite dans la toolbar, centré verticalement
        position: 'absolute',
        right: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 2,
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        background: active ? '#ec4899' : 'rgba(255, 255, 255, 0.92)',
        color: active ? '#fff' : '#374151',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: active
          ? '0 4px 12px rgba(236, 72, 153, 0.35)'
          : '0 2px 6px rgba(0, 0, 0, 0.15)',
        transition: 'background 140ms, color 140ms, box-shadow 140ms, transform 80ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-50%) scale(1.06)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(-50%) scale(1)' }}
    >
      <Search size={18} strokeWidth={2.2} />
    </button>
  )
}
