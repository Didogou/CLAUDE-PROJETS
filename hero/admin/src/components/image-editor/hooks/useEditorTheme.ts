'use client'
/**
 * Hook de gestion du thème (light/dark) de l'ImageEditor.
 *
 * Le choix est persisté en localStorage sous la clé `image-editor-theme`
 * pour que l'utilisateur retrouve son réglage à la prochaine ouverture.
 *
 * Le thème est appliqué via l'attribut `data-theme` sur le root de l'éditeur
 * (géré par le composant `ImageEditor.tsx`). Ce hook ne touche PAS au DOM —
 * il expose juste la valeur + le setter.
 */
import { useCallback, useEffect, useState } from 'react'
import type { EditorTheme } from '../types'

const STORAGE_KEY = 'image-editor-theme'
const DEFAULT_THEME: EditorTheme = 'light'

function readInitial(): EditorTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return DEFAULT_THEME
}

export function useEditorTheme(): {
  theme: EditorTheme
  setTheme: (t: EditorTheme) => void
  toggle: () => void
} {
  const [theme, setThemeState] = useState<EditorTheme>(DEFAULT_THEME)

  useEffect(() => {
    setThemeState(readInitial())
  }, [])

  const setTheme = useCallback((t: EditorTheme) => {
    setThemeState(t)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, t)
    }
  }, [])

  const toggle = useCallback(() => {
    setThemeState(prev => {
      const next: EditorTheme = prev === 'light' ? 'dark' : 'light'
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, next)
      }
      return next
    })
  }, [])

  return { theme, setTheme, toggle }
}
