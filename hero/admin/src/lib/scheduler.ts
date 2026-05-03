'use client'
/**
 * useScheduler — hook React pour déclencher des callbacks selon un plan temporel.
 *
 * 4 modes :
 *   - 'once'            : 1 seul déclenchement après `delay` ms
 *   - 'periodic'        : déclenchement régulier toutes les `interval` ms
 *   - 'random_interval' : intervalle aléatoire entre `minInterval` et `maxInterval`
 *   - 'manual'          : ne déclenche que via `trigger()` retourné
 *
 * Cas d'usage : rat qui passe toutes les 30-60s, bougie qui change d'intensité
 * aléatoirement, coq qui chante à 7h pile, événement one-shot au démarrage.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

export type SchedulerMode = 'once' | 'periodic' | 'random_interval' | 'manual'

export interface SchedulerConfig {
  mode: SchedulerMode
  /** ms avant le 1er déclenchement. Pour `once`. Défaut 0. */
  delay?: number
  /** ms entre 2 déclenchements. Pour `periodic`. Défaut 1000. */
  interval?: number
  /** ms min pour `random_interval`. Défaut 1000. */
  minInterval?: number
  /** ms max pour `random_interval`. Défaut 5000. */
  maxInterval?: number
  /** Si true, déclenche immédiatement au mount sans attendre le premier intervalle. */
  startImmediate?: boolean
  /** Désactive le scheduler (équivalent à unmount sans le faire). */
  paused?: boolean
}

export function useScheduler(
  config: SchedulerConfig,
  callback: () => void,
) {
  const cbRef = useRef(callback)
  cbRef.current = callback
  const configRef = useRef(config)
  configRef.current = config

  const [fireCount, setFireCount] = useState(0)
  const [nextFireAt, setNextFireAt] = useState<number | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const schedule = useCallback((ms: number) => {
    const at = Date.now() + ms
    setNextFireAt(at)
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => {
      if (configRef.current.paused) return
      cbRef.current()
      setFireCount(n => n + 1)
      const c = configRef.current
      if (c.mode === 'once' || c.mode === 'manual') {
        setNextFireAt(null)
        return
      }
      if (c.mode === 'periodic') {
        schedule(c.interval ?? 1000)
      } else if (c.mode === 'random_interval') {
        const min = c.minInterval ?? 1000
        const max = c.maxInterval ?? 5000
        const next = min + Math.random() * (max - min)
        schedule(next)
      }
    }, Math.max(0, ms))
  }, [])

  const trigger = useCallback(() => {
    if (configRef.current.paused) return
    cbRef.current()
    setFireCount(n => n + 1)
  }, [])

  useEffect(() => {
    const c = config
    if (c.paused || c.mode === 'manual') return

    if (c.startImmediate) {
      cbRef.current()
      setFireCount(n => n + 1)
    }

    if (c.mode === 'once') {
      schedule(c.delay ?? 0)
    } else if (c.mode === 'periodic') {
      schedule(c.interval ?? 1000)
    } else if (c.mode === 'random_interval') {
      const min = c.minInterval ?? 1000
      const max = c.maxInterval ?? 5000
      schedule(min + Math.random() * (max - min))
    }

    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    // Re-schedule when mode ou intervalles-clés changent
  }, [config.mode, config.delay, config.interval, config.minInterval, config.maxInterval, config.paused, schedule])

  return { fireCount, nextFireAt, trigger }
}
