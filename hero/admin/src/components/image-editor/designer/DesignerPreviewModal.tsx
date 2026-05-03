'use client'
/**
 * DesignerPreviewModal — modal qui montre comment le lecteur verra ce plan
 * sur un device réel (iPhone 16, Galaxy S24, iPad Pro, etc.).
 *
 * Layout : tout est centré dans le viewport et groupé.
 *   ┌───────────────────────────────────────────┐
 *   │      [📱 iPhone 16  ▾]                    │  ← dropdown picker centré
 *   │   ┌──────────┐    ┌──────────────────┐    │
 *   │   │          │    │  iPhone 16   ✕   │    │
 *   │   │  device  │    │  393 × 852       │    │
 *   │   │  frame   │    ├──────────────────┤    │
 *   │   │          │    │  Calques  …      │    │
 *   │   │          │    │  Objets   …      │    │
 *   │   │          │    │                  │    │
 *   │   │          │    │  Esc pour fermer │    │
 *   │   └──────────┘    └──────────────────┘    │
 *   └───────────────────────────────────────────┘
 *
 * - Le device picker est un dropdown custom (3 catégories : Mobile / Tablet
 *   / Desktop) avec dimensions réelles.
 * - Le frame device adapte sa taille au preset sélectionné.
 * - La croix ✕ vit dans le panneau (toujours dans le champ visuel central).
 * - Le tout est groupé et scale ensemble en responsive.
 */

import React, { useEffect, useRef, useState } from 'react'
import { X, Smartphone, Tablet, Monitor, ChevronDown, Check, Layers, Box } from 'lucide-react'

type DeviceCategory = 'mobile' | 'tablet' | 'desktop'

interface DevicePreset {
  id: string
  name: string
  category: DeviceCategory
  /** Largeur logique CSS (px) */
  width: number
  /** Hauteur logique CSS (px) */
  height: number
}

/** Dimensions logiques réelles (CSS pixels) des principaux devices 2024-2026. */
const DEVICE_PRESETS: DevicePreset[] = [
  // Mobile
  { id: 'iphone-16',         name: 'iPhone 16',          category: 'mobile',  width: 393, height: 852 },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max',  category: 'mobile',  width: 440, height: 956 },
  { id: 'iphone-se',         name: 'iPhone SE',          category: 'mobile',  width: 375, height: 667 },
  { id: 'galaxy-s24',        name: 'Samsung Galaxy S24', category: 'mobile',  width: 360, height: 780 },
  { id: 'galaxy-s24-ultra',  name: 'Galaxy S24 Ultra',   category: 'mobile',  width: 412, height: 883 },
  { id: 'pixel-8',           name: 'Google Pixel 8',     category: 'mobile',  width: 412, height: 915 },
  // Tablet
  { id: 'ipad-mini',         name: 'iPad Mini',          category: 'tablet',  width: 744, height: 1133 },
  { id: 'ipad-air',          name: 'iPad Air 11"',       category: 'tablet',  width: 820, height: 1180 },
  { id: 'ipad-pro-11',       name: 'iPad Pro 11"',       category: 'tablet',  width: 834, height: 1194 },
  { id: 'ipad-pro-13',       name: 'iPad Pro 13"',       category: 'tablet',  width: 1024, height: 1366 },
  { id: 'galaxy-tab-s9',     name: 'Galaxy Tab S9',      category: 'tablet',  width: 800, height: 1280 },
  // Desktop
  { id: 'desktop-720p',      name: 'Desktop 720p',       category: 'desktop', width: 1280, height: 720 },
  { id: 'desktop-1080p',     name: 'Desktop 1080p',      category: 'desktop', width: 1920, height: 1080 },
  { id: 'desktop-1440p',     name: 'Desktop 1440p',      category: 'desktop', width: 2560, height: 1440 },
]

const CATEGORY_LABEL: Record<DeviceCategory, string> = {
  mobile: 'Mobile',
  tablet: 'Tablette',
  desktop: 'Desktop',
}

const CATEGORY_ICON: Record<DeviceCategory, React.ComponentType<{ size?: number }>> = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
}

interface DesignerPreviewModalProps {
  open: boolean
  onClose: () => void
  imageUrl: string | null
  sectionText?: string
  choices?: Array<{ id: string; label: string }>
}

/** Durée du fadeout à la fermeture (doit matcher l'animation CSS dz-fadeout) */
const CLOSE_ANIM_MS = 220

export default function DesignerPreviewModal({
  open,
  onClose,
  imageUrl,
  sectionText,
  choices = [],
}: DesignerPreviewModalProps) {
  const [selectedId, setSelectedId] = useState<string>('iphone-16')
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Phase du modal : géré en interne pour pouvoir jouer un fadeout avant unmount.
  // open prop=true → phase 'open' immédiat ; open prop=false → 'closing' (anim)
  // → 'closed' après CLOSE_ANIM_MS.
  const [phase, setPhase] = useState<'open' | 'closing' | 'closed'>(open ? 'open' : 'closed')

  useEffect(() => {
    if (open) {
      setPhase('open')
      return
    }
    if (phase === 'open') {
      setPhase('closing')
      const t = setTimeout(() => setPhase('closed'), CLOSE_ANIM_MS)
      return () => clearTimeout(t)
    }
  }, [open, phase])

  const preset = DEVICE_PRESETS.find(d => d.id === selectedId) ?? DEVICE_PRESETS[0]

  // Esc ferme le modal (ou le picker s'il est ouvert)
  useEffect(() => {
    if (phase !== 'open') return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (pickerOpen) setPickerOpen(false)
        else onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [phase, onClose, pickerOpen])

  // Click outside du picker → ferme
  useEffect(() => {
    if (!pickerOpen) return
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  if (phase === 'closed') return null
  const closing = phase === 'closing'

  // Calcul du scale : device doit tenir dans ~80% du viewport (laisse place
  // au panneau + marges). Plus petit des deux ratios w/h.
  const FRAME_PADDING = 12 // padding noir autour de l'écran
  const frameW = preset.width + 2 * FRAME_PADDING
  const frameH = preset.height + 2 * FRAME_PADDING
  // Scale dynamique calculé côté CSS via vmin clamp (cf. .dz-preview-frame).

  const Icon = CATEGORY_ICON[preset.category]
  const groupedPresets: Record<DeviceCategory, DevicePreset[]> = {
    mobile: DEVICE_PRESETS.filter(d => d.category === 'mobile'),
    tablet: DEVICE_PRESETS.filter(d => d.category === 'tablet'),
    desktop: DEVICE_PRESETS.filter(d => d.category === 'desktop'),
  }

  return (
    <div
      className={`dz-preview-backdrop ${closing ? 'closing' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dz-preview-group">
        {/* Colonne gauche : device frame, avec dropdown picker positionné absolu au-dessus */}
        <div className="dz-preview-device-col">
          {/* Picker de device — dropdown custom centré au-dessus du device */}
          <div className="dz-preview-picker" ref={pickerRef}>
            <button
              type="button"
              className={`dz-preview-picker-trigger ${pickerOpen ? 'open' : ''}`}
              onClick={() => setPickerOpen(o => !o)}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
            >
              <Icon size={16} />
              <span className="dz-preview-picker-name">{preset.name}</span>
              <span className="dz-preview-picker-dim">
                {preset.width} × {preset.height}
              </span>
              <ChevronDown size={16} className="dz-preview-picker-chevron" />
            </button>

            {pickerOpen && (
              <div className="dz-preview-picker-menu" role="listbox">
                {(['mobile', 'tablet', 'desktop'] as DeviceCategory[]).map(cat => {
                  const CatIcon = CATEGORY_ICON[cat]
                  return (
                    <div key={cat} className="dz-preview-picker-group">
                      <div className="dz-preview-picker-group-title">
                        <CatIcon size={12} />
                        <span>{CATEGORY_LABEL[cat]}</span>
                      </div>
                      {groupedPresets[cat].map(d => (
                        <button
                          key={d.id}
                          type="button"
                          role="option"
                          aria-selected={d.id === selectedId}
                          className={`dz-preview-picker-item ${d.id === selectedId ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedId(d.id)
                            setPickerOpen(false)
                          }}
                        >
                          <span className="dz-preview-picker-item-name">{d.name}</span>
                          <span className="dz-preview-picker-item-dim">
                            {d.width} × {d.height}
                          </span>
                          {d.id === selectedId && (
                            <Check size={12} className="dz-preview-picker-item-check" />
                          )}
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Frame device : dimensions inline depuis le preset, scale auto via CSS */}
          <div
            className="dz-preview-frame"
            style={{
              ['--frame-w' as string]: `${frameW}px`,
              ['--frame-h' as string]: `${frameH}px`,
            }}
          >
            <div
              className="dz-preview-screen"
              style={{
                backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
              }}
            >
              {(sectionText || choices.length > 0) && (
                <div className="dz-preview-narrative">
                  {sectionText && <div className="dz-preview-text">{sectionText}</div>}
                  {choices.length > 0 && (
                    <div className="dz-preview-choices">
                      {choices.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          className="dz-preview-choice"
                          onClick={(e) => e.preventDefault()}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Colonne droite : panneau info ancré au device (mêmes vars pour matcher
         * la hauteur scalée du device) */}
        <aside
          className="dz-preview-panel"
          style={{
            ['--frame-w' as string]: `${frameW}px`,
            ['--frame-h' as string]: `${frameH}px`,
          }}
        >
          <header className="dz-preview-panel-header">
            <div className="dz-preview-panel-meta">
              <span className="dz-preview-panel-device">{preset.name}</span>
              <span className="dz-preview-panel-dim">
                {preset.width} × {preset.height}
              </span>
            </div>
            <button
              type="button"
              className="dz-preview-close"
              onClick={onClose}
              title="Fermer (Esc)"
              aria-label="Fermer l'aperçu"
            >
              <X size={16} />
            </button>
          </header>

          <div className="dz-preview-panel-body">
            <section className="dz-preview-panel-section">
              <h4 className="dz-preview-panel-title">
                <Layers size={13} />
                <span>Calques</span>
              </h4>
              <div className="dz-preview-panel-empty">
                Bientôt — visibilité par calque pour l&apos;aperçu
              </div>
            </section>

            <section className="dz-preview-panel-section">
              <h4 className="dz-preview-panel-title">
                <Box size={13} />
                <span>Objets</span>
              </h4>
              <div className="dz-preview-panel-empty">
                Bientôt — NPCs, items, choix interactifs
              </div>
            </section>
          </div>

          <footer className="dz-preview-panel-footer">
            <kbd>Esc</kbd>
            <span>pour fermer</span>
          </footer>
        </aside>
      </div>
    </div>
  )
}
