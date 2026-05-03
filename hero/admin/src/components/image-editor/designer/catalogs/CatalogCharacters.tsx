'use client'
/**
 * CatalogCharacters — panneau slide "Banque · Personnages".
 *
 * Triggered par Personnage → Ajouter dans la toolbar Phase B.
 *
 * Contenu :
 *   - Prompt textarea en haut : description du placement (ex: "à côté de la
 *     table, assise, face caméra"). Pas d'aide à la saisie pour le POC.
 *   - Grille de vignettes des persos (portrait préféré, fallback fullbody).
 *   - Bouton "+ Nouveau" pour créer un perso (ouvre CharacterCreatorModal).
 *   - Bouton "Ajouter" en bas, sticky, désactivé tant qu'aucune vignette
 *     n'est sélectionnée. À l'usage : route vers le pipeline d'insertion
 *     (Flux Kontext multi-image / composite layered) — TODO.
 */

import React, { useState } from 'react'
import { Check, Plus, ChevronRight, Loader2, Pencil } from 'lucide-react'
import CatalogShell from './CatalogShell'
import CharacterCreatorModal from '../CharacterCreatorModal'
import { useCharacterStore, type Character } from '@/lib/character-store'

interface CatalogCharactersProps {
  onClose: () => void
  /** Callback à l'ajout — reçoit le perso sélectionné + le prompt de placement.
   *  Async : on attend la fin du pipeline d'insertion (Flux Kontext multi-image,
   *  3-7 min sur 8 GB). Si rejette → l'erreur est affichée dans la card. */
  onAdd?: (character: Character, placementPrompt: string) => Promise<void> | void
  /** Callback "remonter d'un niveau" dans la hiérarchie Banques → Personnages.
   *  Click sur "Banques" dans la breadcrumb du titre. */
  onNavigateToBanks?: () => void
  storagePathPrefix: string
}

/** Title breadcrumb-like : "Banques › Personnages". Le parent est cliquable
 *  (remonte à la racine Banques), le current en accent. Mêmes patterns à venir
 *  pour "Banques › Objets", "Banques › Lieux", etc. */
function BreadcrumbTitle({ onNavigateToBanks }: { onNavigateToBanks?: () => void }) {
  return (
    <span className="dz-catalog-breadcrumb">
      <button
        type="button"
        className="dz-breadcrumb-parent"
        onClick={onNavigateToBanks}
        disabled={!onNavigateToBanks}
        title="Retour à Banques"
      >
        Banques
      </button>
      <ChevronRight size={11} className="dz-breadcrumb-sep" aria-hidden />
      <span className="dz-breadcrumb-current">Personnages</span>
    </span>
  )
}

export default function CatalogCharacters({
  onClose, onAdd, onNavigateToBanks, storagePathPrefix,
}: CatalogCharactersProps) {
  const { characters } = useCharacterStore()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placementPrompt, setPlacementPrompt] = useState('')
  const [creatorOpen, setCreatorOpen] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Perso en cours d'édition — null = mode création (pour le modal) */
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null)

  const filtered = characters.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  )

  const selected = characters.find(c => c.id === selectedId) ?? null
  const canAdd = !!selected && !busy

  async function handleAdd() {
    if (!selected || busy) return
    setBusy(true); setError(null)
    try {
      await onAdd?.(selected, placementPrompt.trim())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[CatalogCharacters] insertion failed:', msg)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <CatalogShell
        title={<BreadcrumbTitle onNavigateToBanks={onNavigateToBanks} />}
        onClose={onClose}
        searchPlaceholder="Rechercher un personnage…"
        searchValue={search}
        onSearchChange={setSearch}
      >
        {/* Prompt de placement */}
        <div className="dzc-prompt-area">
          <span className="dzc-prompt-label">Placement</span>
          <textarea
            className="dzc-prompt-textarea"
            value={placementPrompt}
            onChange={e => setPlacementPrompt(e.target.value)}
            placeholder="ex : assise sur le canapé, face caméra"
            rows={2}
          />
        </div>

        {/* Header section + bouton "+ Nouveau" */}
        <div className="dzc-section-title">
          <span className="dzc-section-title-text">
            Personnages ({filtered.length})
          </span>
          <button
            type="button"
            className="dzc-new-btn"
            onClick={() => setCreatorOpen(true)}
            title="Créer un nouveau personnage"
          >
            <Plus size={11} strokeWidth={2.5} />
            Nouveau
          </button>
        </div>

        {/* Grille thumbnails */}
        {filtered.length === 0 ? (
          <div className="dzc-empty-msg">
            {characters.length === 0
              ? 'Aucun personnage — clique « Nouveau » pour en créer un.'
              : 'Aucun résultat.'}
          </div>
        ) : (
          <div className="dzc-grid">
            {filtered.map(char => {
              const thumbUrl = char.portraitUrl ?? char.fullbodyUrl
              const isSelected = char.id === selectedId
              return (
                <div key={char.id} className={`dzc-card ${isSelected ? 'selected' : ''}`}>
                  <button
                    type="button"
                    className="dzc-card-select"
                    onClick={() => setSelectedId(isSelected ? null : char.id)}
                    title={`Sélectionner ${char.name}`}
                    aria-pressed={isSelected}
                  >
                    {thumbUrl ? (
                      <img src={thumbUrl} alt={char.name} className="dzc-card-img" />
                    ) : (
                      <div className="dzc-card-empty">👤</div>
                    )}
                    <div className="dzc-card-name">{char.name}</div>
                  </button>
                  {isSelected && (
                    <span className="dzc-card-check" aria-hidden>
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                  {/* Bouton crayon pour éditer le perso (mode modify ou général) */}
                  <button
                    type="button"
                    className="dzc-card-edit"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingCharacter(char)
                    }}
                    title={`Modifier ${char.name}`}
                    aria-label={`Modifier ${char.name}`}
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Bouton Ajouter sticky bas + état d'insertion en cours */}
        <div className="dzc-add-bar">
          {error && (
            <div className="dzc-add-error" title={error}>⚠ {error.slice(0, 80)}…</div>
          )}
          <button
            type="button"
            className="dzc-add-btn"
            onClick={handleAdd}
            disabled={!canAdd}
            title={
              busy ? 'Insertion en cours…' :
              canAdd ? `Ajouter ${selected?.name} à la scène` :
              'Sélectionne un personnage'
            }
          >
            {busy ? (
              <span className="dzc-add-busy">
                <Loader2 size={14} className="dzc-spin" />
                Insertion en cours… (3-7 min)
              </span>
            ) : (
              selected ? `Ajouter ${selected.name}` : 'Ajouter'
            )}
          </button>
        </div>
      </CatalogShell>

      {/* Modal création (nouveau perso) */}
      <CharacterCreatorModal
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onCreated={(charId) => setSelectedId(charId)}
        storagePathPrefix={storagePathPrefix}
      />

      {/* Modal édition (perso existant) — overlay au-dessus du catalog */}
      <CharacterCreatorModal
        open={editingCharacter !== null}
        editingCharacter={editingCharacter}
        onClose={() => setEditingCharacter(null)}
        storagePathPrefix={storagePathPrefix}
      />
    </>
  )
}
