'use client'
/**
 * DesignerCharactersDrawer — panneau Personnages du Designer image fixe.
 *
 * Même UX que AnimationStudioCharactersDrawer (animation), mais pour les plans
 * image fixe : 2 sections claires, pas de cible shot (pas d'animation).
 *
 *   Section 1 — "Personnages du plan"
 *     Persos avec un calque (layer.character_id) ou intégrés dans la base
 *     (bakedCharacterIds). Vignette + crayon (édition fiche perso).
 *
 *   Section 2 — "Personnages de la section non détectés dans le plan"
 *     NPCs déclarés présents dans la section MAIS pas encore posés/intégrés
 *     dans CE plan. Vignette + crayon. (En V1, on n'ajoute pas au plan via
 *     un clic ici — l'auteur passe par drag-drop depuis CatalogCharacters
 *     ou la barre IA Ctrl+K pour insérer un perso.)
 *
 * Refonte 2026-05-12 — réplique du pattern Animation Studio.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pencil, X, User, Check } from 'lucide-react'
import { useCharacterStore, type Character } from '@/lib/character-store'
import { useEditorState } from '@/components/image-editor/EditorStateContext'
import CharacterCreatorModal, { type ElevenVoiceOption } from './CharacterCreatorModal'
import type { Npc } from '@/types'

// Cache module-level voix ElevenLabs (1 fetch par session, partagé entre tous
// les drawers persos du projet — fileLevel scope, pas par instance).
let cachedVoices: ElevenVoiceOption[] | null = null

interface DesignerCharactersDrawerProps {
  open: boolean
  onClose: () => void
  /** Tous les NPCs du livre (depuis la DB / hydratation au mount). Utilisé
   *  pour matcher les ids → carte avec vignette + nom. */
  npcs: Npc[]
  /** IDs des persos POSÉS dans CE plan — soit en calque (layer.character_id)
   *  soit intégrés dans la base (bakedCharacterIds). Affichés en section 1. */
  inPlanCharacterIds: Set<string>
  /** IDs des persos DÉCLARÉS présents dans la section (depuis le parsing du
   *  texte de section, ou table de jointure si plus tard mise en place).
   *  Affichés en section 2 SAUF ceux déjà dans inPlanCharacterIds. */
  sectionCharacterIds: string[]
  /** Préfixe storage pour les ré-générations depuis le modal d'édition perso. */
  bookId: string | null
}

export default function DesignerCharactersDrawer({
  open, onClose, npcs, inPlanCharacterIds, sectionCharacterIds, bookId,
}: DesignerCharactersDrawerProps) {
  const { characters } = useCharacterStore()
  // addBakedCharacter — utilisé par "Marquer comme posé" sur les cartes
  // section 2. Bascule le perso en section 1 au render suivant (présent dans
  // le plan via bakedCharacterIds, sans avoir besoin d'un calque dédié).
  const { addBakedCharacter } = useEditorState()

  /** Perso en cours d'édition (modal overlay). null = modal fermé. Stocke un
   *  Character (store) pour matcher la prop attendue par CharacterCreatorModal. */
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null)

  /** Catalogue voix ElevenLabs — fetch 1× et cache. Vide = modal cache le sélecteur. */
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
        console.warn('[DesignerCharactersDrawer] échec chargement voix:', err)
      }
    })()
    return () => { aborted = true }
  }, [])

  // Découpe les NPCs en 2 buckets sans doublon (priorité section 1 = plan).
  const { inPlan, inSectionNotInPlan } = useMemo(() => {
    const inPlanList = npcs.filter(n => inPlanCharacterIds.has(n.id))
    const sectionSet = new Set(sectionCharacterIds)
    const inSectionList = npcs.filter(n => sectionSet.has(n.id) && !inPlanCharacterIds.has(n.id))
    return { inPlan: inPlanList, inSectionNotInPlan: inSectionList }
  }, [npcs, inPlanCharacterIds, sectionCharacterIds])

  function handleEditNpc(npc: Npc) {
    const fromStore = characters.find(c => c.id === npc.id)
    if (fromStore) {
      setEditingCharacter(fromStore)
      return
    }
    // Fallback minimal si pas hydraté (rare au load initial)
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

  return (
    <>
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            key="dz-chars-drawer"
            className="dz-chars-drawer"
            initial={{ x: '-100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '-100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 32 }}
            aria-label="Personnages du plan"
          >
            <header className="dz-chars-drawer-header">
              <h3>Personnages du plan</h3>
              <button
                type="button"
                className="dz-chars-drawer-close"
                onClick={onClose}
                aria-label="Fermer"
              >
                <X size={14} />
              </button>
            </header>

            {/* Section 1 — Persos placés dans ce plan */}
            <section className="dz-chars-drawer-section">
              <h4 className="dz-chars-drawer-section-title">
                Dans ce plan <span className="dz-chars-drawer-count">({inPlan.length})</span>
              </h4>
              <p className="dz-chars-drawer-hint">
                Persos posés (calque) ou intégrés dans la base. Clique sur ✎ pour éditer la fiche.
              </p>
              <div className="dz-chars-drawer-grid">
                {inPlan.length === 0 ? (
                  <div className="dz-chars-drawer-empty">
                    Aucun perso dans ce plan. Ajoute-en via le drag-drop depuis la banque persos
                    (icône <Sparkles14 />) ou via Ctrl+K (« Place X sur la gauche »).
                  </div>
                ) : (
                  inPlan.map(n => <CharCard key={n.id} npc={n} onEdit={handleEditNpc} />)
                )}
              </div>
            </section>

            {/* Section 2 — Persos de la section non détectés dans le plan */}
            <section className="dz-chars-drawer-section">
              <h4 className="dz-chars-drawer-section-title">
                De la section, pas encore posés <span className="dz-chars-drawer-count">({inSectionNotInPlan.length})</span>
              </h4>
              <p className="dz-chars-drawer-hint">
                Persos déclarés présents dans le résumé de section, mais absents de ce plan précis.
              </p>
              <div className="dz-chars-drawer-grid">
                {inSectionNotInPlan.length === 0 ? (
                  <div className="dz-chars-drawer-empty">
                    Tous les persos de la section sont déjà dans ce plan.
                  </div>
                ) : (
                  inSectionNotInPlan.map(n => (
                    <CharCard
                      key={n.id}
                      npc={n}
                      onEdit={handleEditNpc}
                      onMarkPlaced={() => addBakedCharacter(n.id)}
                      dimmed
                    />
                  ))
                )}
              </div>
            </section>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Modal édition (hors drawer pour ne pas être clipped par le slide) */}
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

// ── Carte perso (réutilisée dans les 2 sections) ──────────────────────────

interface CharCardProps {
  npc: Npc
  onEdit: (npc: Npc) => void
  /** Si true, carte rendue dimmed (cas section 2 = persos hors plan). Garde
   *  l'édition fiche accessible mais signale visuellement qu'ils ne sont pas
   *  dans la scène courante. */
  dimmed?: boolean
  /** Callback bouton "Marquer comme posé" (section 2 uniquement). Ajoute le
   *  perso à bakedCharacterIds → la carte bascule en section 1 au render
   *  suivant. */
  onMarkPlaced?: () => void
}

function CharCard({ npc, onEdit, dimmed, onMarkPlaced }: CharCardProps) {
  const ext = npc as Npc & { portrait_url?: string | null }
  return (
    <div className={`dz-chars-drawer-card-wrap${dimmed ? ' dz-chars-drawer-card-dimmed' : ''}`}>
      <div className="dz-chars-drawer-card" title={npc.name}>
        <div className="dz-chars-drawer-card-thumb">
          {ext.portrait_url
            ? <img src={ext.portrait_url} alt={npc.name} />
            : <User size={26} />}
        </div>
        <div className="dz-chars-drawer-card-name">{npc.name}</div>
      </div>
      <button
        type="button"
        className="dz-chars-drawer-card-edit"
        onClick={(e) => {
          e.stopPropagation()
          onEdit(npc)
        }}
        title={`Éditer ${npc.name} (apparence, voix, vues)`}
        aria-label={`Éditer ${npc.name}`}
      >
        <Pencil size={11} />
      </button>
      {onMarkPlaced && (
        <button
          type="button"
          className="dz-chars-drawer-card-mark"
          onClick={(e) => {
            e.stopPropagation()
            onMarkPlaced()
          }}
          title={`Marquer ${npc.name} comme présent dans ce plan (intégré dans la base)`}
          aria-label={`Marquer ${npc.name} comme posé`}
        >
          <Check size={11} />
        </button>
      )}
    </div>
  )
}

// Mini-icône Sparkles inline pour le texte vide (évite import en plus dans
// le scope global du module — on garde lucide-react user-facing dans CharCard).
function Sparkles14() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         style={{ display: 'inline-block', verticalAlign: '-1px' }}>
      <path d="M12 3 14 9 20 12 14 15 12 21 10 15 4 12 10 9z"/>
    </svg>
  )
}
