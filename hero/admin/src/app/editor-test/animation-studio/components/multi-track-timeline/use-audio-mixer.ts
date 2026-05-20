'use client'
/**
 * useAudioMixer — joue les blocs audio (SFX + musique) en synchro avec
 * `cursorMsRef` pendant la lecture timeline.
 *
 * Phase 2 V1 (2026-05-12). Approche minimale :
 *   - 1 HTMLAudioElement par bloc audio (lazy-créé au mount, ré-utilisé)
 *   - Boucle rAF qui poll cursorMsRef + pour chaque bloc :
 *     - si cursor ∈ [block.startMs, block.startMs + block.durationMs] :
 *         - audio démarré si pas déjà en cours (audio.play())
 *         - currentTime synchronisé si dérive > 100ms
 *     - sinon : audio.pause() si en cours
 *   - Volume et fade in/out appliqués via audio.volume = ...
 *
 * Limites V1 (à améliorer V2) :
 *   - Pas d'AudioContext / Web Audio API → pas de mix précis avec audio TTS
 *     déjà encodé dans la vidéo LTX (le SFX vient PAR-DESSUS la vidéo, mixé
 *     par le navigateur via 2 sources audio simultanées)
 *   - Fades : opacity-style sur volume, pas de courbe gain
 *   - Pas de pré-buffer pour latence drop
 */

import { useEffect, useRef } from 'react'
import type { TimelineBlock } from './types'

interface UseAudioMixerOptions {
  /** Tous les blocs audio (SFX + musique) à jouer. */
  audioBlocks: TimelineBlock[]
  /** Ref position courante en ms — polled par rAF. */
  cursorMsRef: React.MutableRefObject<number>
  /** True si lecture en cours — pause tous les sons sinon. */
  isPlaying: boolean
}

export function useAudioMixer({ audioBlocks, cursorMsRef, isPlaying }: UseAudioMixerOptions) {
  // Map id de bloc → HTMLAudioElement (créé lazy au 1er besoin, ré-utilisé)
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  // Cleanup au démontage : pause + remove src tous les éléments
  useEffect(() => {
    const elements = audioElementsRef.current
    return () => {
      elements.forEach(audio => {
        audio.pause()
        audio.src = ''
      })
      elements.clear()
    }
  }, [])

  // Pause tous les sons quand isPlaying passe à false
  useEffect(() => {
    if (!isPlaying) {
      audioElementsRef.current.forEach(audio => audio.pause())
    }
  }, [isPlaying])

  // Boucle rAF qui synchronise les sons avec cursorMsRef
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    function tick() {
      const cursorMs = cursorMsRef.current
      for (const block of audioBlocks) {
        if (block.kind !== 'sfx' && block.kind !== 'music') continue
        const audioMap = audioElementsRef.current
        let audio = audioMap.get(block.id)
        // Lazy-create
        if (!audio) {
          audio = new Audio(block.audioUrl)
          audio.preload = 'auto'
          if (block.kind === 'music' && block.loop) audio.loop = true
          audioMap.set(block.id, audio)
        }
        const blockEnd = block.startMs + block.durationMs
        const inWindow = cursorMs >= block.startMs && cursorMs < blockEnd
        if (inWindow) {
          // Volume avec fade in/out
          const sinceStart = cursorMs - block.startMs
          const untilEnd = blockEnd - cursorMs
          let volume = block.volume
          if (block.fadeInMs > 0 && sinceStart < block.fadeInMs) {
            volume *= sinceStart / block.fadeInMs
          }
          if (block.fadeOutMs > 0 && untilEnd < block.fadeOutMs) {
            volume *= untilEnd / block.fadeOutMs
          }
          audio.volume = Math.max(0, Math.min(1, volume))

          // Démarre la lecture si en pause
          if (audio.paused) {
            audio.currentTime = sinceStart / 1000
            void audio.play().catch(() => { /* ignore autoplay block */ })
          } else {
            // Resync si dérive > 200ms (peut arriver après seek du curseur)
            const expected = sinceStart / 1000
            if (Math.abs(audio.currentTime - expected) > 0.2) {
              audio.currentTime = expected
            }
          }
        } else if (!audio.paused) {
          audio.pause()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [audioBlocks, cursorMsRef, isPlaying])
}
