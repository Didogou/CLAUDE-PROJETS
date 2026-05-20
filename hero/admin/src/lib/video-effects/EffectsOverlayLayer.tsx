'use client'
/**
 * EffectsOverlayLayer — Rend tous les overlays HTML actifs selon ComposedEffectsState.
 *
 * Refonte 2026-05-15ca — Wrapper unique pour ne pas avoir à câbler chaque overlay
 * à la main dans chaque consumer. Le composant lit `resolveOverlays(state)` et
 * monte les composants correspondants.
 *
 * Pour le sniper (mouse track), le parent passe `currentXY` (= position lue par
 * useMouseTrack pendant record/play, sinon centre par défaut).
 *
 * Le layer doit être placé au-dessus du <VideoEffectsCanvas> dans un parent
 * `position: relative`.
 */

import React from 'react'
import {
  PolaroidFrame, PhoneFrame, ViewfinderOverlay, OldFilmOverlay,
  LightLeaksOverlay, LensDirtOverlay, LetterboxOverlay,
  SniperScopeOverlay, HudReticleOverlay, NightVisionOverlay,
  SecurityCamHud, MilitaryDroneHud,
} from './OverlayCatalog'
import type { ComposedEffectsState, OverlayKind } from './looks-catalog'
import { resolveOverlays } from './looks-catalog'

interface EffectsOverlayLayerProps {
  state: ComposedEffectsState
  /** Position courante du sniper (mouse track ou centre). Default 0.5/0.5. */
  currentXY?: { x: number; y: number } | null
  /** Force désactivation du mask sniper (ex: pendant countdown record). */
  sniperMaskOff?: boolean
  /** Élément vidéo source — pour sync timecode des HUDs Surveillance/Drone. */
  videoEl?: HTMLVideoElement | null
}

export default function EffectsOverlayLayer({
  state, currentXY, sniperMaskOff = false, videoEl,
}: EffectsOverlayLayerProps) {
  const overlays = resolveOverlays(state)
  const has = (k: OverlayKind) => overlays.includes(k)
  // HUDs auto-activés par certains looks (refonte 2026-05-15cc)
  const isSecurityCam = state.look_id === 'security_cam' || state.look_id === 'hidden_cam'
  const isMilitaryDrone = state.look_id === 'military_drone'
  return (
    <>
      {has('letterbox_235') && <LetterboxOverlay enabled ratio="cinema_2.35" />}
      {has('phone_frame') && <PhoneFrame enabled />}
      {has('polaroid') && <PolaroidFrame enabled />}
      {has('old_film') && <OldFilmOverlay enabled />}
      {has('light_leaks') && <LightLeaksOverlay enabled />}
      {has('lens_dirt') && <LensDirtOverlay enabled />}
      {has('viewfinder_photo') && (
        <ViewfinderOverlay
          enabled
          centerX={currentXY?.x ?? 0.5}
          centerY={currentXY?.y ?? 0.5}
        />
      )}
      {has('hud_reticle') && (
        <HudReticleOverlay
          enabled
          color="red"
          centerX={currentXY?.x ?? 0.5}
          centerY={currentXY?.y ?? 0.5}
        />
      )}
      {has('night_vision') && <NightVisionOverlay enabled />}
      {/* HUDs auto-activés selon look */}
      {isSecurityCam && (
        <SecurityCamHud
          enabled
          videoEl={videoEl}
          camId={state.look_id === 'hidden_cam' ? 'CAM XX — UNKNOWN' : 'CAM 03 — ZONE A'}
          channel={state.look_id === 'hidden_cam' ? 0 : 2}
        />
      )}
      {isMilitaryDrone && (
        <MilitaryDroneHud enabled videoEl={videoEl} color="green" />
      )}
      {has('sniper_scope') && (
        <SniperScopeOverlay
          enabled
          reticleColor={state.sniper_color ?? 'red'}
          centerX={currentXY?.x ?? 0.5}
          centerY={currentXY?.y ?? 0.5}
          scopeSize={state.scope_size ?? 0.22}
          showMask={!sniperMaskOff}
        />
      )}
    </>
  )
}
