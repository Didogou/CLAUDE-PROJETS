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
  | 'dark_fantasy' // 🗡 Dark fantasy peinture (Frazetta, Brom, Souls)
  | 'animated'     // [legacy] = anime_modern, pour compat localStorage

/** Apparence du perso. Utilisée par les pipelines qui ont des slots typés
 *  (LTX 2.3 IC LoRA Dual entraîné sur les labels `Male:` / `Female:`).
 *  Limité à 2 valeurs : c'est un mapping technique vers les slots du LoRA,
 *  pas une déclaration sociale. Optionnel pour back-compat (persos créés
 *  avant le champ → fallback 'female' à la lecture). */
export type CharacterGender = 'male' | 'female'

export interface Character {
  id: string
  name: string
  /** Style visuel choisi à la création — utile pour relancer une génération
   *  cohérente (ex : portrait alternatif). Optionnel pour back-compat. */
  style?: CharacterStyle
  /** Apparence du perso (homme/femme) — drive les slots typés des modèles
   *  dual (LTX IC LoRA Dual `Male:`/`Female:`). Optionnel pour back-compat ;
   *  si manquant ou valeur héritée invalide, défaut 'female'. */
  gender?: CharacterGender
  /** Description visuelle qui a servi à générer / ou note libre. */
  prompt?: string
  /** URL portrait (cadrage tête/épaules) — null si pas encore généré. */
  portraitUrl: string | null
  /** URL plein pied (cadrage corps entier) — null si pas encore généré. */
  fullbodyUrl: string | null
  /** URL plein pied vue de DOS (Qwen multi-angle, refonte 2026-05-09).
   *  Optionnel : null si pas encore généré.
   *  ⚠ DÉPRÉCIÉ depuis migration 079 — utilisé uniquement pour back-compat
   *  des persos déjà sauvegardés. Les nouvelles vues alternatives vont dans
   *  `images` (galerie). */
  fullbodyBackUrl?: string | null
  /** Galerie d'images additionnelles (refonte 2026-05-09 — option B).
   *  Vues alternatives, variantes scéniques, uploads custom, extractions.
   *  Hydraté depuis npcs.images jsonb. Chaque item est draggable séparément
   *  dans CatalogCharacters → utilise son URL pour le placement CSS. */
  images?: import('@/types').NpcImage[]
  /** ElevenLabs voice_id — copié depuis la table `npcs` au mount du Designer.
   *  Utilisé par le pipeline lipsync (β.1 2026-05-06) : si une pellicule a
   *  un dialogue rempli pour ce perso, on génère son audio TTS via cette
   *  voix avant de l'envoyer à LTX 2.3. Optionnel : un perso peut ne pas
   *  avoir de voix définie (alors fail loud à la génération avec dialogue). */
  voice_id?: string
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
  /** Remplace TOUS les characters (utile pour injecter les NPCs d'un livre
   *  depuis l'API au mount du Designer). Persiste en localStorage. */
  setCharacters: (chars: Character[]) => void
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

  const replaceCharacters = useCallback((chars: Character[]) => {
    setCharacters(chars)
  }, [])

  const value = useMemo<CharacterStoreValue>(() => ({
    characters, addCharacter, updateCharacter, removeCharacter, getCharacter,
    setCharacters: replaceCharacters,
  }), [characters, addCharacter, updateCharacter, removeCharacter, getCharacter, replaceCharacters])

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

/** Variante non-throw pour CharacterCreatorModal réutilisé hors Designer
 *  (ex : Studio Creator avec persistance Supabase via prop onPersist).
 *  Retourne null si pas de provider. */
export function useOptionalCharacterStore(): CharacterStoreValue | null {
  return useContext(CharacterStoreContext)
}
