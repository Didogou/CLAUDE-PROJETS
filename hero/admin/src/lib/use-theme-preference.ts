'use client'
/**
 * useThemePreference — hook partagé pour le toggle dark/light persistent
 * dans localStorage. Utilisé par Library / Studio Creator / Studio Section
 * (et tout futur écran Studio).
 *
 * Default = 'dark' si rien en localStorage (cohérent avec le mockup initial).
 * Tolérant SSR / mode privé : si localStorage indispo, fallback silencieux
 * sur 'dark' sans crash.
 *
 * Note : il y a un léger flash possible au mount (1 frame en dark avant que
 * useEffect lise la pref light). Acceptable V1 — sinon il faudrait inline
 * un script dans <head> pour set la classe avant React hydrate.
 */

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'hero-studio-theme'
export type StudioTheme = 'dark' | 'light'

export function useThemePreference(): {
  theme: StudioTheme
  toggleTheme: () => void
  setTheme: (t: StudioTheme) => void
} {
  const [theme, setThemeState] = useState<StudioTheme>('dark')

  // Lecture localStorage au mount (client-only). Pas en useState lazy pour
  // rester compatible SSR Next.js.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'dark' || stored === 'light') {
        setThemeState(stored)
      }
    } catch {
      /* SSR / private mode / storage disabled — fallback silencieux */
    }
  }, [])

  const setTheme = useCallback((t: StudioTheme) => {
    setThemeState(t)
    try { localStorage.setItem(STORAGE_KEY, t) } catch {}
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem(STORAGE_KEY, next) } catch {}
      return next
    })
  }, [])

  return { theme, toggleTheme, setTheme }
}
