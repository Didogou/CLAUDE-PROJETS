'use client'
/**
 * AnimationStudioCharactersDrawer — drawer slide depuis la gauche pour la
 * banque de personnages.
 *
 * Refonte 2026-05-07 :
 *   - Slide animation framer-motion
 *   - Liste des NPCs du book avec vignettes portrait
 *   - Click sur une vignette = ajoute le perso au shot ciblé (targetShotId)
 *
 * Refonte 2026-05-10 :
 *   - Mode "vue plan" (targetShotId === null) : filtre sur les persos déjà
 *     placés dans le plan (= référencés par au moins un shot). Évite que
 *     l'auteur soit noyé sous tous les NPCs du livre quand il vient juste
 *     ajuster une fiche.
 *   - Bouton crayon ✏ sur chaque vignette → ouvre CharacterCreatorModal en
 *     mode édition (ex : ajouter une voix ElevenLabs pour le TTS lipsync).
 *     La persistance passe par CharacterPersistProvider (POST/PATCH /api/npcs).
 */

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pencil, Trash2, X, User } from 'lucide-react'
import { useEditorState } from '@/components/image-editor/EditorStateContext'
import { useCharacterStore, type Character } from '@/lib/character-store'
import CharacterCreatorModal, { type ElevenVoiceOption } from '@/components/image-editor/designer/CharacterCreatorModal'
import type { Npc } from '@/types'

// Cache module-level pour ne fetcher les voix ElevenLabs qu'une fois par
// session (l'API renvoie ~30-50 voix, payload léger mais pas la peine de
// re-fetch à chaque ouverture du drawer).
let cachedVoices: ElevenVoiceOption[] | null = null

interface AnimationStudioCharactersDrawerProps {
  open: boolean
  npcs: Npc[]
  /** Si défini, click sur un NPC l'ajoute aux characterIds de CE shot. */
  targetShotId: string | null
  /** Pellicule active (nécessaire pour le dispatch shot_add_character). */
  activePelliculeId: string | null
  /** IDs des persos déjà référencés par au moins un shot du plan. Sert à
   *  filtrer la grille en mode "vue plan" (targetShotId === null). */
  inPlanCharacterIds: Set<string>
  /** ID du book — utilisé comme préfixe storage pour les images générées
   *  par le modal d'édition (Qwen vues alternatives, gallery, etc.). */
  bookId: string | null
  onClose: () => void
}

export default function AnimationStudioCharactersDrawer({
  open, npcs, targetShotId, activePelliculeId,
  inPlanCharacterIds, bookId, onClose,
}: AnimationStudioCharactersDrawerProps) {
  const { shotAddCharacter, animationPellicules } = useEditorState()
  const { characters, setCharacters } = useCharacterStore()
  /** State pour la confirmation de suppression — id du perso à supprimer
   *  pendant que l'auteur confirme dans le toast. null = pas de confirmation
   *  en cours. */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  /** Perso en cours d'édition (modal overlay) — null = modal fermé. On stocke
   *  un Character (du store) plutôt qu'un Npc, car le modal attend ce type. */
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null)

  /** Catalogue des voix ElevenLabs — fetché 1× et caché en mémoire module.
   *  Sans ça, le sélecteur de voix dans le modal ne s'affiche pas (le modal
   *  cache le bloc voix si la prop `voices` est vide). */
  const [voices, setVoices] = useState<ElevenVoiceOption[]>(cachedVoices ?? [])
  useEffect(() => {
    if (cachedVoices !== null) return
    let aborted = false
    void (async () => {
      try {
        const res = await fetch('/api/elevenlabs/voices')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { voices?: ElevenVoiceOption[]; error?: string }
        if (data.error) throw new Error(data.error)
        if (aborted) return
        cachedVoices = data.voices ?? []
        setVoices(cachedVoices)
      } catch (err) {
        // Échec silencieux : sélecteur masqué. ELEVENLABS_API_KEY manquante
        // = problème infra, fail loud à la gen LTX avec dialogue (pas ici).
        console.warn('[AnimationStudioCharactersDrawer] échec chargement voix:', err)
      }
    })()
    return () => { aborted = true }
  }, [])

  function handlePickNpc(npc: Npc) {
    if (!targetShotId || !activePelliculeId) {
      // Mode "vue plan" — pas d'ajout, juste l'édition via le crayon
      return
    }
    shotAddCharacter(activePelliculeId, targetShotId, npc.id)
    onClose()
  }

  function handleEditNpc(npc: Npc) {
    // Convertit l'Npc → Character (lookup dans le store qui a la version
    // hydratée avec voice_id, gender, etc.). Fallback minimal si pas dans
    // le store (cas rare au load initial).
    const fromStore = characters.find(c => c.id === npc.id)
    if (fromStore) {
      setEditingCharacter(fromStore)
      return
    }
    const ext = npc as Npc & {
      portrait_url?: string | null
      voice_id?: string | null
      appearance?: string | null
    }
    setEditingCharacter({
      id: npc.id,
      name: npc.name,
      portraitUrl: ext.portrait_url ?? null,
      fullbodyUrl: null,
      gender: 'female' as const,
      voice_id: ext.voice_id ?? undefined,
      prompt: ext.appearance ?? undefined,
      createdAt: 0,
    })
  }

  /** Supprime définitivement un perso (DB + store local + retire des
   *  pellicules en cours qui le référencent). Refonte 2026-05-11.
   *
   *  Garde-fou : si le perso est utilisé dans des pellicules, on warne mais
   *  on ne bloque pas — l'auteur est censé savoir ce qu'il fait, et le clear
   *  des characterIds des shots est non-destructif (les actions sous ce
   *  charId restent en data, juste plus appliquées). Ils peuvent toujours
   *  re-créer un perso et patcher les actions à la main.
   *
   *  L'API DELETE /api/npcs/[id] ne cascade pas vers les pellicules (juste
   *  supprime la row npcs). On nettoie côté client. */
  async function handleDeleteNpc(npc: Npc) {
    // Compte les pellicules qui référencent ce perso pour message confirm
    const referencedIn = animationPellicules.filter(p =>
      p.shots.some(s => (s.characterIds ?? []).includes(npc.id))
    ).length
    const msg = referencedIn > 0
      ? `Supprimer "${npc.name}" ?\n\n⚠ Ce perso est utilisé dans ${referencedIn} pellicule(s) — il sera retiré des shots. Les actions/dialogues que tu lui avais écrits seront perdus.\n\nCette action est irréversible.`
      : `Supprimer "${npc.name}" ?\n\nCette action est irréversible.`
    if (!window.confirm(msg)) return
    setPendingDeleteId(npc.id)
    try {
      const res = await fetch(`/api/npcs/${npc.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `DELETE HTTP ${res.status}`)
      }
      // Retire du store local pour feedback immédiat (sans full reload)
      setCharacters(characters.filter(c => c.id !== npc.id))
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      alert(`Suppression échouée : ${m}`)
      console.error('[AnimationStudioCharactersDrawer] delete failed:', m)
    } finally {
      setPendingDeleteId(null)
    }
  }

  // Filtre selon le mode :
  //   - targetShotId défini = mode "+ Perso" sur un shot → tous les NPCs du livre
  //     (l'auteur a besoin du catalogue complet pour assigner)
  //   - targetShotId null = mode banque depuis le rail → uniquement les persos
  //     déjà placés dans le plan (l'auteur veut éditer leur fiche, pas
  //     scroller toute la liste du livre)
  const visibleNpcs = targetShotId
    ? npcs
    : npcs.filter(n => inPlanCharacterIds.has(n.id))

  return (
    <>
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            className="as-drawer as-drawer-characters"
            initial={{ x: '-100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '-100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 32 }}
            aria-label="Banque de personnages"
          >
            <header className="as-drawer-header">
              <h3>
                {targetShotId ? 'Ajouter un personnage' : 'Personnages du plan'}
              </h3>
              <button type="button" className="as-drawer-close" onClick={onClose} aria-label="Fermer">
                <X size={14} />
              </button>
            </header>
            {targetShotId ? (
              <p className="as-drawer-hint">
                Clique un perso pour l&apos;ajouter au shot. Crayon ✎ pour éditer sa fiche.
              </p>
            ) : (
              <p className="as-drawer-hint">
                Persos placés dans ce plan. Clique sur ✎ pour éditer (ex : ajouter une voix).
              </p>
            )}
            <div className="as-drawer-grid">
              {visibleNpcs.length === 0 ? (
                <div className="as-drawer-empty">
                  {targetShotId
                    ? 'Aucun personnage dans le livre. Va dans le Studio Creator → Banque de personnages.'
                    : 'Aucun perso dans ce plan. Ajoute-en un via « + Perso » sur un shot.'}
                </div>
              ) : (
                visibleNpcs.map(n => {
                  const ext = n as Npc & { portrait_url?: string | null }
                  return (
                    <div key={n.id} className="as-drawer-card-wrap">
                      <button
                        type="button"
                        className="as-drawer-card"
                        onClick={() => handlePickNpc(n)}
                        disabled={!targetShotId}
                        title={targetShotId
                          ? `Ajouter ${n.name} au shot`
                          : `${n.name} (clique ✎ pour éditer)`}
                      >
                        <div className="as-drawer-card-thumb">
                          {ext.portrait_url
                            ? <img src={ext.portrait_url} alt={n.name} />
                            : <User size={28} />}
                        </div>
                        <div className="as-drawer-card-name">{n.name}</div>
                      </button>
                      <button
                        type="button"
                        className="as-drawer-card-edit"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleEditNpc(n)
                        }}
                        title={`Éditer ${n.name} (voix, apparence, vues)`}
                        aria-label={`Éditer ${n.name}`}
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        className="as-drawer-card-delete"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDeleteNpc(n)
                        }}
                        disabled={pendingDeleteId === n.id}
                        title={`Supprimer ${n.name} définitivement`}
                        aria-label={`Supprimer ${n.name}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Modal édition (overlay, hors du drawer pour ne pas être clipped par
       *  le slide). La persistance DB passe par useCharacterPersist() lue
       *  par le modal lui-même (provider en haut de l'arbre). voices +
       *  initialVoiceId activent le sélecteur de voix ElevenLabs (sinon
       *  le modal cache ce bloc). */}
      <CharacterCreatorModal
        open={editingCharacter !== null}
        editingCharacter={editingCharacter}
        onClose={() => setEditingCharacter(null)}
        storagePathPrefix={bookId ? `books/${bookId}/characters` : 'characters/orphan'}
        voices={voices.length > 0 ? voices : undefined}
        initialVoiceId={editingCharacter?.voice_id ?? null}
      />
    </>
  )
}
