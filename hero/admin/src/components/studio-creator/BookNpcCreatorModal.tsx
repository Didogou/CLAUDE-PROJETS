'use client'
/**
 * BookNpcCreatorModal — wrapper de CharacterCreatorModal qui persiste
 * directement dans la table Supabase `npcs` (au lieu du CharacterStore
 * localStorage utilisé par le Designer).
 *
 * Mapping CharacterCreatorPayload → npcs :
 *   - portraitUrl       → portrait_url       (déjà existant, base IPAdapter)
 *   - fullbodyUrl       → fullbody_gray_url  (cf 071_npcs_character_views.sql)
 *   - prompt            → appearance         (text libre déjà existant)
 *   - style/gender/engine → portrait_settings (jsonb existant, sert à régen)
 *   - name              → name (req)
 *   - voiceId           → voice_id           (utilisé par β.1 lipsync auto)
 *
 * Voix ElevenLabs : on charge la liste des voix au mount + on la passe en
 * prop au CharacterCreatorModal. Si l'auteur en sélectionne une, on persiste
 * voice_id dans la BDD. Sans voice_id, l'auteur sera bloqué fail-loud quand
 * il essaiera de générer une animation avec un dialogue rempli.
 *
 * Le pipeline IA (Z-Image / Flux / FaceDetailer / upload) est entièrement
 * réutilisé via CharacterCreatorModal — aucune duplication.
 */

import React, { useEffect, useState } from 'react'
import CharacterCreatorModal, {
  type CharacterCreatorPayload,
  type ElevenVoiceOption,
  type PortraitEngine,
} from '@/components/image-editor/designer/CharacterCreatorModal'
import type { Character, CharacterStyle, CharacterGender } from '@/lib/character-store'

/** Sous-ensemble des champs `npcs` qu'on lit/écrit ici. */
export interface NpcRow {
  id: string
  book_id: string
  name: string
  type: string
  description: string | null
  portrait_url: string | null
  fullbody_gray_url: string | null
  appearance: string | null
  portrait_settings: NpcPortraitSettings | null
  voice_id: string | null
}

interface NpcPortraitSettings {
  style?: CharacterStyle
  gender?: CharacterGender
  engine?: PortraitEngine
  // Tolère tout autre champ existant (le Designer legacy stocke prompt_fr,
  // steps, cfg, etc. dans portrait_settings — on les préserve).
  [key: string]: unknown
}

interface BookNpcCreatorModalProps {
  open: boolean
  onClose: () => void
  /** Livre dans lequel créer/éditer le NPC. */
  bookId: string
  /** Si fourni → mode édition. Sinon création. */
  editingNpc?: NpcRow | null
  /** Callback après save — reçoit la row complète (créée ou mise à jour). */
  onSaved?: (npc: NpcRow) => void
}

/** Mappe une row `npcs` vers le shape `Character` attendu par le modal en
 *  mode édition. */
function npcToCharacter(npc: NpcRow): Character {
  const ps = npc.portrait_settings ?? {}
  return {
    id: npc.id,
    name: npc.name,
    style: (ps.style as CharacterStyle | undefined) ?? 'anime_modern',
    gender: (ps.gender as CharacterGender | undefined) ?? 'female',
    prompt: npc.appearance ?? undefined,
    portraitUrl: npc.portrait_url,
    fullbodyUrl: npc.fullbody_gray_url,
    voice_id: npc.voice_id ?? undefined,
    createdAt: 0,
  }
}

/** Cache module-scope pour éviter de re-fetch les voix à chaque ouverture
 *  du modal dans la même session. La liste change rarement (l'auteur
 *  n'ajoute pas de voix ElevenLabs toutes les heures). */
let cachedVoices: ElevenVoiceOption[] | null = null

export default function BookNpcCreatorModal({
  open, onClose, bookId, editingNpc, onSaved,
}: BookNpcCreatorModalProps) {
  const editingChar = editingNpc ? npcToCharacter(editingNpc) : null

  // ── Voix ElevenLabs : fetch 1× au premier mount, cache mémoire ────────
  const [voices, setVoices] = useState<ElevenVoiceOption[]>(cachedVoices ?? [])
  useEffect(() => {
    if (cachedVoices !== null) return  // déjà chargées, pas besoin de re-fetch
    let aborted = false
    async function load() {
      try {
        const res = await fetch('/api/elevenlabs/voices')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { voices?: ElevenVoiceOption[]; error?: string }
        if (data.error) throw new Error(data.error)
        if (aborted) return
        cachedVoices = data.voices ?? []
        setVoices(cachedVoices)
      } catch (err) {
        // Échec silencieux : le sélecteur ne s'affichera pas (voices=[]).
        // L'auteur ne pourra pas définir de voix → fail loud à la gen
        // animation avec dialogue. Acceptable car ELEVENLABS_API_KEY
        // manquante = problème de config infra, pas une erreur user.
        console.warn('[BookNpcCreatorModal] échec chargement voix ElevenLabs:', err)
      }
    }
    void load()
    return () => { aborted = true }
  }, [])

  async function persist(payload: CharacterCreatorPayload, mode: 'create' | 'edit'): Promise<string> {
    // On préserve tout le portrait_settings existant (le Designer legacy y
    // stocke prompt_fr/cfg/steps/etc.) et on update juste les 3 champs qu'on
    // gère (style/gender/engine). Permet d'éditer un perso créé via legacy
    // sans détruire ses settings.
    const prevSettings: NpcPortraitSettings = editingNpc?.portrait_settings ?? {}
    const portrait_settings: NpcPortraitSettings = {
      ...prevSettings,
      style: payload.style,
      gender: payload.gender,
      engine: payload.engine,
    }
    const body = {
      name: payload.name,
      portrait_url: payload.portraitUrl,
      fullbody_gray_url: payload.fullbodyUrl,
      fullbody_back_url: payload.fullbodyBackUrl ?? null,
      appearance: payload.prompt,
      portrait_settings,
      voice_id: payload.voiceId,  // null = pas de voix → l'auteur sera fail-loud à la gen
    }

    if (mode === 'edit' && editingNpc) {
      const res = await fetch(`/api/npcs/${editingNpc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as NpcRow & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      onSaved?.(data)
      return data.id
    } else {
      const res = await fetch('/api/npcs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId, ...body }),
      })
      const data = await res.json() as NpcRow & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      onSaved?.(data)
      return data.id
    }
  }

  return (
    <CharacterCreatorModal
      open={open}
      onClose={onClose}
      editingCharacter={editingChar}
      storagePathPrefix={`studio/book_${bookId}/npc_${editingNpc?.id ?? Date.now()}`}
      onPersist={persist}
      title={editingNpc ? `Modifier ${editingNpc.name}` : 'Créer un personnage'}
      voices={voices.length > 0 ? voices : undefined}
      initialVoiceId={editingNpc?.voice_id ?? null}
    />
  )
}
