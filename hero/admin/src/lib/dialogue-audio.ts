/**
 * dialogue-audio — orchestre la génération de l'audio de dialogue pour une
 * pellicule animée du Studio Designer.
 *
 * Refacto multi-shots β.1+ 2026-05-06 :
 *   - Avant : 1 perCharacter par pellicule → N TTS séquentiels concaténés
 *   - Maintenant : pellicule = shots[] où chaque shot a son perCharacter
 *     → on collecte tous les dialogues dans l'ordre des shots, on génère
 *     les TTS, on concatène, et on retourne aussi la durée mesurée par
 *     shot (= somme des TTS du shot + 1s, ou 3s si pas de dialogue).
 *
 * Fail loud philosophy : si un perso a un dialogue rempli MAIS pas de
 * voice_id, on throw une erreur claire pointant vers la banque persos.
 */

import type { Character } from './character-store'
import type { Shot } from '@/components/image-editor/EditorStateContext'

/** Une réplique = 1 char qui dit 1 texte avec sa voix, dans 1 shot précis. */
export interface DialogueSegment {
  shotId: string
  charId: string
  charName: string
  voiceId: string
  text: string
  /** Durée mesurée en secondes du mp3 TTS (rempli après génération). */
  durationSec?: number
}

export interface BuildDialogueAudioInput {
  /** Liste des shots de la pellicule, dans l'ordre. */
  shots: Shot[]
  /** Ordre des persos PAR SHOT — par défaut on prend l'ordre des clés de
   *  shot.perCharacter, mais le caller peut passer characterIds pour
   *  imposer un ordre déterministe (ex: featured chars de la pellicule). */
  characterIds: string[]
  /** Lookup char → voix. */
  characters: Character[]
  /** Préfixe Supabase pour ranger les mp3 générés. */
  storagePathPrefix: string
}

export interface BuildDialogueAudioResult {
  /** URL Supabase du mp3 final (concaténé si plusieurs segments). */
  audioUrl: string
  /** Description des segments dans l'ordre temporel (= ordre des shots,
   *  puis ordre des persos dans le shot). */
  segments: DialogueSegment[]
  /** Durée calculée par shot — somme des durées TTS du shot + 1s de marge.
   *  Utilisé par handleGeneratePellicule pour patcher les durées des shots
   *  avant de les envoyer à LTX. Clé = shot.id. */
  shotDurations: Record<string, number>
}

/** Erreur typée pour distinguer les cas voice_id manquant des autres. */
export class MissingVoiceError extends Error {
  constructor(public charName: string) {
    super(`Le personnage "${charName}" parle dans cette pellicule mais n'a pas de voix définie. Va dans Banque de personnages > ${charName} pour lui assigner une voix ElevenLabs.`)
    this.name = 'MissingVoiceError'
  }
}

/** Mesure la durée d'un fichier audio (mp3) côté browser via un élément Audio.
 *  Asynchrone : attend `loadedmetadata` puis lit `duration`. Timeout 10s. */
async function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    audio.preload = 'metadata'
    const timer = setTimeout(() => {
      audio.src = ''
      reject(new Error(`probeAudioDuration timeout (${url})`))
    }, 10_000)
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timer)
      resolve(audio.duration)
    })
    audio.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error(`probeAudioDuration failed (${url})`))
    })
    audio.src = url
  })
}

/** Génère l'audio de dialogue d'une pellicule multi-shots. Retourne `null`
 *  si aucun shot n'a de dialogue rempli (= mode foley). */
export async function buildDialogueAudio(
  input: BuildDialogueAudioInput,
): Promise<BuildDialogueAudioResult | null> {
  const { shots, characterIds, characters, storagePathPrefix } = input

  // Collecte les segments dans l'ordre temporel : pour chaque shot, on
  // boucle sur les persos (ordre characterIds, fallback ordre des clés).
  const segments: DialogueSegment[] = []
  for (const shot of shots) {
    const charsInOrder = characterIds.filter(id => shot.perCharacter[id])
    // Fallback : si characterIds ne contient pas tous les persos qui parlent
    // dans ce shot, on ajoute les manquants en fin (improbable mais safe).
    for (const id of Object.keys(shot.perCharacter)) {
      if (!charsInOrder.includes(id)) charsInOrder.push(id)
    }
    for (const charId of charsInOrder) {
      const data = shot.perCharacter[charId]
      if (!data || !data.dialogue.trim()) continue
      const char = characters.find(c => c.id === charId)
      if (!char) {
        console.warn(`[dialogue-audio] character ${charId} introuvable dans le store, skip dialogue`)
        continue
      }
      if (!char.voice_id) {
        throw new MissingVoiceError(char.name)
      }
      segments.push({
        shotId: shot.id,
        charId,
        charName: char.name,
        voiceId: char.voice_id,
        text: data.dialogue.trim(),
      })
    }
  }

  if (segments.length === 0) return null

  const ts = Date.now()

  // Padding silence en début (refonte 2026-05-10) — fix bug LTX qui fige
  // l'image quand l'audio attaque immédiatement à t=0 (constaté empirique-
  // ment sur la chaîne YT Vantage / LTX 2). Astuce : prépend ". . . " au
  // texte du PREMIER segment, ElevenLabs (eleven_multilingual_v2) interprète
  // les ellipses comme une pause TTS naturelle (~0.4-0.5s). Pas besoin de
  // générer un MP3 silence server-side, pas de fichier asset, pas de dep.
  // Le coût TTS est marginal (~5 chars de plus). À ne PAS appliquer aux
  // segments suivants — la respiration entre répliques se fait déjà avec
  // la concat naturelle ElevenLabs.
  const LEAD_SILENCE_PREFIX = '. . . '
  const ttsTexts = segments.map((seg, i) => i === 0 ? LEAD_SILENCE_PREFIX + seg.text : seg.text)

  // Génère tous les TTS en parallèle, mesure leur durée individuelle
  const ttsResults = await Promise.all(segments.map(async (seg, i) => {
    const r = await fetch('/api/elevenlabs/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice_id: seg.voiceId,
        text: ttsTexts[i],
        save_path: `${storagePathPrefix}/dialogue_${ts}_seg${i}_${seg.charName.replace(/[^a-z0-9]/gi, '_')}`,
      }),
    })
    const data = await r.json() as { url?: string; error?: string }
    if (!r.ok || !data.url) {
      throw new Error(`TTS échoué pour ${seg.charName} (segment ${i + 1}) : ${data.error ?? `HTTP ${r.status}`}`)
    }
    // Mesure la durée pour calculer ensuite la durée du shot. Si la mesure
    // échoue (CORS, format inattendu), on tombe sur un fallback estim'
    // 5s/segment qui n'est pas catastrophique.
    let duration = 5
    try {
      duration = await probeAudioDuration(data.url)
    } catch (err) {
      console.warn(`[dialogue-audio] probe failed for ${seg.charName}, fallback 5s:`, err)
    }
    return { url: data.url, duration }
  }))

  // Inscrit la durée mesurée dans chaque segment
  ttsResults.forEach((r, i) => {
    segments[i].durationSec = r.duration
  })

  // Calcul durée par shot : somme des TTS du shot + marge de respiration.
  // Si un shot n'a pas de dialogue → 3s par défaut (cf cadrage UX validé).
  // Marge ajustée à 0.3s (2026-05-06) — initialement 1s, jugé trop long
  // visuellement (~5s pour 1 réplique courte). 0.3s = juste un beat avant
  // le cut au shot suivant.
  const POST_DIALOGUE_BREATH_SEC = 0.3
  const shotDurations: Record<string, number> = {}
  for (const shot of shots) {
    const segDurations = segments
      .filter(s => s.shotId === shot.id)
      .map(s => s.durationSec ?? 5)
    if (segDurations.length === 0) {
      shotDurations[shot.id] = 3
    } else {
      const sum = segDurations.reduce((a, b) => a + b, 0)
      // Arrondi à 1 décimale pour éviter des durées genre 3.247199s
      shotDurations[shot.id] = Math.round((sum + POST_DIALOGUE_BREATH_SEC) * 10) / 10
    }
  }

  // Cas dégénéré : 1 seul segment → on retourne tel quel sans concat
  if (ttsResults.length === 1) {
    return { audioUrl: ttsResults[0].url, segments, shotDurations }
  }

  // Concat des N mp3 (avec strip ID3 côté serveur)
  const cRes = await fetch('/api/audio/concat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls: ttsResults.map(r => r.url),
      path: `${storagePathPrefix}/dialogue_${ts}_concat.mp3`,
    }),
  })
  const cData = await cRes.json() as { url?: string; error?: string }
  if (!cRes.ok || !cData.url) {
    throw new Error(`Concat audio échoué : ${cData.error ?? `HTTP ${cRes.status}`}`)
  }

  return { audioUrl: cData.url, segments, shotDurations }
}
