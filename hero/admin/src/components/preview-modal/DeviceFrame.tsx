'use client'
/**
 * DeviceFrame — wrapper visuel d'un device preview (bezel + radius + screen).
 *
 * Extrait de PreviewModal.tsx 2026-05-17 pour réutilisation (Studio Mono /
 * SourceTile, et tout futur écran qui veut afficher un media dans un cadre
 * device). Le styling (bordures, ombre, bezel) vient de preview-modal.css —
 * importer ce CSS au moins une fois côté caller (PreviewModal le fait déjà).
 *
 * Props :
 *   - device : PreviewDevice (cf devices.ts) → drive width/height/bezel/radius
 *   - children : contenu de l'écran (video, img, PelliculeRenderer…)
 */

import React from 'react'
import { type PreviewDevice, getDeviceHeightRem } from './devices'

export default function DeviceFrame({
  device, children,
}: { device: PreviewDevice; children: React.ReactNode }) {
  const heightRem = getDeviceHeightRem(device)
  return (
    <div
      className="preview-modal-device-frame"
      style={{
        width: `${device.widthRem}rem`,
        height: `${heightRem}rem`,
        padding: `${device.bezelRem}rem`,
        borderRadius: `${device.frameRadiusRem}rem`,
      }}
    >
      <div
        className="preview-modal-device-screen"
        style={{
          borderRadius: `${Math.max(0, device.frameRadiusRem - device.bezelRem * 0.6)}rem`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
