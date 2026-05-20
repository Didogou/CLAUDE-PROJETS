'use client'
/**
 * character-persist-context — context React pour la persistance distante
 * (Supabase npcs) des persos créés/édités via CharacterCreatorModal.
 *
 * Refonte 2026-05-09 : avant, seul le modal d'extraction (new-layout/page.tsx)
 * passait un onPersist explicite. Les modals d'édition dans CatalogCharacters
 * tombaient sur le fallback CharacterStore (localStorage uniquement). Au reload,
 * loadBookCatalog écrasait les changements localStorage avec les données DB
 * obsolètes → bug "j'ai save mais ça n'est pas persisté".
 *
 * Solution : context provider au niveau page (new-layout) → tous les
 * CharacterCreatorModal sous l'arbre récupèrent automatiquement la fonction
 * de persist DB via useCharacterPersist(), sans prop drilling.
 *
 * Si null/non-providé : fallback sur CharacterStore local (= comportement
 * historique pour les pages test isolées).
 */

import React, { createContext, useContext } from 'react'
import type { CharacterCreatorPayload } from '@/components/image-editor/designer/CharacterCreatorModal'

export type CharacterPersistFn = (
  payload: CharacterCreatorPayload,
  mode: 'create' | 'edit',
  editingNpcId?: string,
) => Promise<string>

const CharacterPersistContext = createContext<CharacterPersistFn | null>(null)

export function CharacterPersistProvider({
  persist, children,
}: {
  persist: CharacterPersistFn
  children: React.ReactNode
}) {
  return (
    <CharacterPersistContext.Provider value={persist}>
      {children}
    </CharacterPersistContext.Provider>
  )
}

/** Hook à utiliser dans les composants qui veulent persister un perso en DB.
 *  Retourne null si pas de provider → caller doit fallback sur CharacterStore. */
export function useCharacterPersist(): CharacterPersistFn | null {
  return useContext(CharacterPersistContext)
}
