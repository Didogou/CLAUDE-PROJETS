'use client'
/**
 * CharacterStore — store partagé des personnages POC du Studio.
 *
 * Persistance : localStorage clé `hero_studio_characters_v1`. À migrer vers
 * la table Supabase `npcs` quand le SaaS sera connecté à Supabase Pro.
 *
 * Disponible globalement via `useCharacterStore()` — n'importe quel composant
 * du Studio peut lire / créer / supprimer des personnages.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** Style visuel du perso. Détermine le suffix de prompt ajouté lors de la
 *  génération T2I (Z-Image / Flux Dev). 6 styles distincts pour couvrir les
 *  vibes courantes des livres-jeu. La clé 'animated' est conservée pour la
 *  compat avec les persos déjà sauvegardés en localStorage. */
export type CharacterStyle =
  | 'realistic'    // 📷 Photo réaliste (Mr Robot)
  | 'anime_modern' // 🎨 Anime moderne (Ghibli, Makoto Shinkai)
  | 'manga'        // 💢 Manga shonen (One Piece, MHA)
  | 'bd'           // 📖 BD franco-belge (Tintin, Astérix)
  | 'comic'        // 🦸 Comic américain (Marvel, DC)
  | 'concept_art'  // 🖌 Concept art jeu vidéo (Diablo, Dishonored)
  | 'animated'     // [legacy] = anime_modern, pour compat localStorage

export interface Character {
  id: string
  name: string
  /** Style visuel choisi à la création — utile pour relancer une génération
   *  cohérente (ex : portrait alternatif). Optionnel pour back-compat. */
  style?: CharacterStyle
  /** Description visuelle qui a servi à générer / ou note libre. */
  prompt?: string
  /** URL portrait (cadrage tête/épaules) — null si pas encore généré. */
  portraitUrl: string | null
  /** URL plein pied (cadrage corps entier) — null si pas encore généré. */
  fullbodyUrl: string | null
  createdAt: number
}

const STORAGE_KEY = 'hero_studio_characters_v1'

interface CharacterStoreValue {
  characters: Character[]
  addCharacter: (c: Omit<Character, 'id' | 'createdAt'>) => Character
  updateCharacter: (id: string, patch: Partial<Character>) => void
  removeCharacter: (id: string) => void
  /** Helper : renvoie le perso par id, ou undefined si supprimé. */
  getCharacter: (id: string) => Character | undefined
}

const CharacterStoreContext = createContext<CharacterStoreValue | null>(null)

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function loadFromStorage(): Character[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // Filtre minimal — garde seulement les entrées qui ressemblent à des persos
    return parsed.filter((c): c is Character =>
      !!c && typeof c === 'object' && 'id' in c && 'name' in c
    )
  } catch {
    return []
  }
}

function saveToStorage(chars: Character[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chars))
  } catch {
    // Quota dépassé / privé — silent (les data sont en mémoire de toute façon)
  }
}

export function CharacterStoreProvider({ children }: { children: ReactNode }) {
  const [characters, setCharacters] = useState<Character[]>([])

  // Hydrate depuis localStorage au mount (côté client uniquement)
  useEffect(() => {
    setCharacters(loadFromStorage())
  }, [])

  // Persiste à chaque changement
  useEffect(() => {
    saveToStorage(characters)
  }, [characters])

  const addCharacter = useCallback((c: Omit<Character, 'id' | 'createdAt'>): Character => {
    const newChar: Character = { ...c, id: genId(), createdAt: Date.now() }
    setCharacters(prev => [newChar, ...prev])
    return newChar
  }, [])

  const updateCharacter = useCallback((id: string, patch: Partial<Character>) => {
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }, [])

  const removeCharacter = useCallback((id: string) => {
    setCharacters(prev => prev.filter(c => c.id !== id))
  }, [])

  const getCharacter = useCallback((id: string) =>
    characters.find(c => c.id === id), [characters])

  const value = useMemo<CharacterStoreValue>(() => ({
    characters, addCharacter, updateCharacter, removeCharacter, getCharacter,
  }), [characters, addCharacter, updateCharacter, removeCharacter, getCharacter])

  return (
    <CharacterStoreContext.Provider value={value}>
      {children}
    </CharacterStoreContext.Provider>
  )
}

export function useCharacterStore(): CharacterStoreValue {
  const ctx = useContext(CharacterStoreContext)
  if (!ctx) throw new Error('useCharacterStore doit être utilisé dans <CharacterStoreProvider>')
  return ctx
}
