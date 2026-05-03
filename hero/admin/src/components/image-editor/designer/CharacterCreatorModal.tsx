'use client'
/**
 * CharacterCreatorModal — POC pour créer un personnage avec 2 images
 * (portrait + plein pied) avec identité cohérente.
 *
 * Champs :
 *   - Nom (text, requis)
 *   - Style : Réaliste | Animé (drive le suffix de prompt envoyé à Z-Image)
 *   - Prompt (textarea, description visuelle libre — Z-Image bilingue FR/EN)
 *
 * Pipeline portrait (Z-Image Turbo — installé 2026-05-01) :
 *   Z-Image distillé 8 steps, ~20-30s. Excellent instruction-following
 *   (suit "homme + chapeau" sans bias Animagine). NVFP4 4.5 GB sur Blackwell.
 *
 * Pipeline plein pied (T2I + face_detailer_only — primitive validée 2026-04-30) :
 *   1. Disabled tant que portrait pas généré (besoin du face ref)
 *   2. T2I plein pied avec le MÊME moteur que le portrait (Z-Image / Flux)
 *      → body composé librement, style cohérent avec portrait, visage random
 *   3. face_detailer_only(body, portrait_ref) → swap visage via IPAdapter
 *      FaceID Plus v2 → identité du portrait préservée
 *   4. Si portrait régénéré → plein pied invalidé
 *
 * Pourquoi pas InstantID ? Testé puis abandonné 2026-05-01 : son ControlNet
 * face landmarks pèse 75% sur la composition (Cubiq) → portrait close-up forcé,
 * impossible d'avoir un vrai full body. Le combo T2I libre + face_detailer
 * donne une composition naturelle et un style portrait↔body cohérent (pas
 * de mismatch Z-Image vs SDXL).
 *
 * Save : crée le perso dans CharacterStore (au moins 1 image requise).
 */

import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ImagePlus, Loader2, Check } from 'lucide-react'
import { useCharacterStore, type CharacterStyle, type Character } from '@/lib/character-store'
import { runZImage } from '@/lib/comfyui-z-image'
import { runFluxDev } from '@/lib/comfyui-flux-dev'
import { runFaceDetailer } from '@/lib/comfyui-face-detailer'

/** Moteur T2I à utiliser pour le portrait.
 *  - z_image       : ⚡ Z-Image Turbo NVFP4 (~25s, peu de variance entre seeds)
 *  - flux_dev      : ✨ Flux Dev Q5_K_S (~75s, qualité max, peut être lent 8 GB)
 *  - flux_dev_fast : 🚀 Flux Dev Q4_K_S (~40s, meilleur compromis 8 GB) */
type PortraitEngine = 'z_image' | 'flux_dev' | 'flux_dev_fast'

/** Fichier UNet GGUF utilisé selon le moteur Flux choisi (sans impact pour Z-Image). */
const FLUX_DEV_FILES: Record<'flux_dev' | 'flux_dev_fast', string> = {
  flux_dev:      'flux1-dev-Q5_K_S.gguf',
  flux_dev_fast: 'flux1-dev-Q4_K_S.gguf',
}

interface CharacterCreatorModalProps {
  open: boolean
  onClose: () => void
  /** Callback après save (création) — reçoit le perso créé. */
  onCreated?: (characterId: string) => void
  /** Préfixe Supabase Storage pour ranger les images générées. */
  storagePathPrefix: string
  /** Si fourni → mode édition : pré-remplit nom/style/prompt + URLs images.
   *  Sur Enregistrer → updateCharacter au lieu d'addCharacter. */
  editingCharacter?: Character | null
}

/** Suffix de style ajouté au prompt portrait. Vocabulaire calibré pour piloter
 *  Z-Image / Flux Dev sans ambiguïté (camera/lens pour réaliste, références
 *  artistes/œuvres pour stylisé). */
const STYLE_SUFFIX: Record<CharacterStyle, string> = {
  realistic:    'shot on Canon R5, 85mm f/1.4 portrait lens, Kodak Portra 400 tones, natural lighting, visible skin texture, shallow depth of field, candid documentary realism',
  anime_modern: 'modern anime film aesthetic, soft cel shading, painterly background, atmospheric lighting, art style of contemporary anime films, semi-realistic anime',
  manga:        'shonen manga style, bold inked lineart, dynamic expression, halftone shading, japanese manga panel art, expressive eyes',
  bd:           'franco-belgian comic book style, ligne claire, flat clean colors, bande dessinée illustration, Tintin Asterix style, crisp outlines',
  comic:        'american comic book art, clean inking, vibrant full color palette, dynamic composition, Marvel DC modern style, sharp linework, full saturation',
  concept_art:  'video game concept art, painterly style, cinematic lighting, detailed character design, Diablo Dishonored aesthetic, digital painting',
  // Legacy alias : anciens persos avec style 'animated' → traités comme anime moderne
  animated:     'modern anime film aesthetic, soft cel shading, painterly background, atmospheric lighting, art style of contemporary anime films, semi-realistic anime',
}

/** Label affiché dans le dropdown UI. */
const STYLE_LABELS: Record<CharacterStyle, string> = {
  realistic:    '📷 Photo réaliste',
  anime_modern: '🎨 Anime moderne (Ghibli, Makoto Shinkai)',
  manga:        '💢 Manga shonen (One Piece, MHA)',
  bd:           '📖 BD franco-belge (Tintin, Astérix)',
  comic:        '🦸 Comic américain (Marvel, DC)',
  concept_art:  '🖌 Concept art (Dishonored, Diablo)',
  animated:     '🎨 Anime moderne (Ghibli, Makoto Shinkai)',
}

/** Ordre d'affichage du dropdown (legacy 'animated' exclu pour ne pas
 *  doublonner avec 'anime_modern' dans la liste). */
const STYLE_ORDER: CharacterStyle[] = [
  'realistic', 'anime_modern', 'manga', 'bd', 'comic', 'concept_art',
]

/** Tags injectés en TÊTE pour cadrage swap-friendly (visage de face, sans hood,
 *  bien éclairé). Critical pour que YOLO/InsightFace détecte le visage côté
 *  FaceDetailer ensuite. */
const PORTRAIT_FRAMING = 'portrait headshot, head and shoulders centered, front view, looking directly at camera, face fully visible and well lit, eyes open and visible, neutral expression, neutral background'
const FULLBODY_FRAMING = 'full body shot, head to toes visible, standing pose, character centered in frame, front view, facing camera, face fully visible, neutral background'
const FULLBODY_NEGATIVE = 'close-up, headshot, cropped, face only, head only, zoom on face'

/** État du pipeline plein pied. T2I + face_detailer en chaîne (2 phases). */
type FullbodyPhase = 'idle' | 't2i' | 'facedetailer' | 'done' | 'error'

/** État du pipeline portrait (Z-Image — 1 pass). */
type PortraitPhase = 'idle' | 'generating' | 'done' | 'error'

export default function CharacterCreatorModal({
  open, onClose, onCreated, storagePathPrefix, editingCharacter,
}: CharacterCreatorModalProps) {
  const { addCharacter, updateCharacter } = useCharacterStore()
  const isEditMode = !!editingCharacter
  const [name, setName] = useState('')
  const [style, setStyle] = useState<CharacterStyle>('anime_modern')
  const [engine, setEngine] = useState<PortraitEngine>('z_image')
  const [prompt, setPrompt] = useState('')

  // ── Portrait : Z-Image Turbo (T2I distillé, 8 steps) ──────────────────
  const [portraitPhase, setPortraitPhase] = useState<PortraitPhase>('idle')
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [portraitError, setPortraitError] = useState<string | null>(null)
  const [portraitProgressLabel, setPortraitProgressLabel] = useState<string>('')

  // ── Plein pied : pipeline InstantID (1 pass, identité depuis portrait) ──
  const [fullbodyPhase, setFullbodyPhase] = useState<FullbodyPhase>('idle')
  const [fullbodyUrl, setFullbodyUrl] = useState<string | null>(null)
  const [fullbodyError, setFullbodyError] = useState<string | null>(null)
  const [fullbodyProgressLabel, setFullbodyProgressLabel] = useState<string>('')

  // Reset complet au close
  useEffect(() => {
    if (!open) {
      // Reset complet à la fermeture
      setName(''); setPrompt(''); setStyle('anime_modern'); setEngine('z_image')
      setPortraitPhase('idle'); setPortraitUrl(null); setPortraitError(null)
      setPortraitProgressLabel('')
      setFullbodyPhase('idle'); setFullbodyUrl(null); setFullbodyError(null)
      setFullbodyProgressLabel('')
    } else if (editingCharacter) {
      // Mode édition : hydrate les champs depuis le perso existant
      setName(editingCharacter.name)
      // 'animated' (legacy) → 'anime_modern' pour cohérence dropdown
      const styleKey: CharacterStyle = editingCharacter.style === 'animated'
        ? 'anime_modern'
        : (editingCharacter.style ?? 'anime_modern')
      setStyle(styleKey)
      setPrompt(editingCharacter.prompt ?? '')
      setPortraitUrl(editingCharacter.portraitUrl)
      setFullbodyUrl(editingCharacter.fullbodyUrl)
      // Phases done si l'image existe déjà
      setPortraitPhase(editingCharacter.portraitUrl ? 'done' : 'idle')
      setFullbodyPhase(editingCharacter.fullbodyUrl ? 'done' : 'idle')
      setPortraitError(null); setFullbodyError(null)
      setPortraitProgressLabel(''); setFullbodyProgressLabel('')
    }
  }, [open, editingCharacter])

  // Invalidation : si le portrait change (regen ou clear), on jette le plein
  // pied — il a été swappé sur l'ancien portrait, plus valide.
  const prevPortraitUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevPortraitUrlRef.current !== portraitUrl && prevPortraitUrlRef.current !== null) {
      // Vraie transition (pas le mount initial où prev=null)
      setFullbodyPhase('idle'); setFullbodyUrl(null); setFullbodyError(null)
      setFullbodyProgressLabel('')
    }
    prevPortraitUrlRef.current = portraitUrl
  }, [portraitUrl])

  // ── Computed ───────────────────────────────────────────────────────────
  const portraitBusy = portraitPhase === 'generating'
  const fullbodyBusy = fullbodyPhase === 't2i' || fullbodyPhase === 'facedetailer'
  const promptOk = prompt.trim().length > 0
  const canGenerateFullbody = !!portraitUrl && !portraitBusy && !fullbodyBusy && promptOk
  const canSave = name.trim().length > 0 && (portraitUrl || fullbodyUrl)

  async function generatePortrait() {
    if (!promptOk || portraitBusy) return
    setPortraitPhase('generating'); setPortraitError(null); setPortraitUrl(null)
    setPortraitProgressLabel('Préparation…')

    try {
      let url: string
      if (engine === 'z_image') {
        // Z-Image bilingue (text encoder Qwen 3) → comprend le FR directement,
        // pas besoin de traduire. Prompt = framing + user + style suffix.
        const fullPrompt = `${PORTRAIT_FRAMING}, ${prompt.trim()}, ${STYLE_SUFFIX[style]}`
        url = await runZImage({
          prompt: fullPrompt,
          width: 1024, height: 1024,
          storagePathPrefix: `${storagePathPrefix}_char_portrait_zimage`,
          onProgress: (p) => { if (p.label) setPortraitProgressLabel(p.label) },
        })
      } else {
        // Flux Dev (Q5_K_S qualité OU Q4_K_S rapide) via T5 → préfère
        // l'anglais. On traduit le prompt user FR→EN via /api/translate-prompt.
        setPortraitProgressLabel('Traduction du prompt…')
        let userPromptEn = prompt.trim()
        try {
          const trRes = await fetch('/api/translate-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_fr: prompt.trim(), is_portrait: true }),
          })
          if (trRes.ok) {
            const td = await trRes.json() as { positive?: string }
            if (td.positive) userPromptEn = td.positive
          }
        } catch (trErr) {
          console.warn('[CharacterCreator] Flux translation fallback to raw FR:', trErr)
        }
        const fullPrompt = `${PORTRAIT_FRAMING}, ${userPromptEn}, ${STYLE_SUFFIX[style]}`
        url = await runFluxDev({
          prompt: fullPrompt,
          width: 1024, height: 1024,
          // Q5_K_S (qualité, ~75s) ou Q4_K_S (rapide, ~40s, sweet spot 8 GB)
          unetFile: FLUX_DEV_FILES[engine],
          storagePathPrefix: `${storagePathPrefix}_char_portrait_flux`,
          onProgress: (p) => { if (p.label) setPortraitProgressLabel(p.label) },
        })
      }
      setPortraitUrl(url); setPortraitPhase('done'); setPortraitProgressLabel('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[CharacterCreator] portrait failed:', msg)
      setPortraitError(msg); setPortraitPhase('error'); setPortraitProgressLabel('')
    }
  }

  async function generateFullbody() {
    if (!canGenerateFullbody || !portraitUrl) return
    setFullbodyPhase('t2i'); setFullbodyError(null); setFullbodyUrl(null)
    setFullbodyProgressLabel('Génération du corps…')

    try {
      // ── PHASE 1 : T2I body avec le MÊME moteur que le portrait ────────
      // → style cohérent portrait↔body (couleurs, anime/comic/etc. matchent)
      // Le visage généré ici est random — on le swap juste après avec FaceDetailer.
      let bodyT2IUrl: string

      if (engine === 'z_image') {
        // Z-Image bilingue (FR direct, pas de translation)
        const fullPrompt = `${FULLBODY_FRAMING}, ${prompt.trim()}, ${STYLE_SUFFIX[style]}`
        bodyT2IUrl = await runZImage({
          prompt: fullPrompt,
          width: 832, height: 1216,  // ~9:13 vertical, multiple de 64
          storagePathPrefix: `${storagePathPrefix}_char_fullbody_t2i_zimage`,
          onProgress: (p) => { if (p.label) setFullbodyProgressLabel(`Corps · ${p.label}`) },
        })
      } else {
        // Flux Dev → translate FR→EN (T5 préfère l'anglais)
        let userPromptEn = prompt.trim()
        let negativeEn = ''
        try {
          const trRes = await fetch('/api/translate-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_fr: prompt.trim() }),
          })
          if (trRes.ok) {
            const td = await trRes.json() as { positive?: string; negative?: string }
            if (td.positive) userPromptEn = td.positive
            if (td.negative) negativeEn = td.negative
          }
        } catch {/* fallback raw FR */}
        const fullPrompt = `${FULLBODY_FRAMING}, ${userPromptEn}, ${STYLE_SUFFIX[style]}`
        const fullNegative = [FULLBODY_NEGATIVE, negativeEn].filter(Boolean).join(', ')
        bodyT2IUrl = await runFluxDev({
          prompt: fullPrompt,
          negativePrompt: fullNegative,
          width: 832, height: 1216,
          unetFile: FLUX_DEV_FILES[engine],
          storagePathPrefix: `${storagePathPrefix}_char_fullbody_t2i_flux`,
          onProgress: (p) => { if (p.label) setFullbodyProgressLabel(`Corps · ${p.label}`) },
        })
      }

      // ── PHASE 2 : FaceDetailer swap visage avec portrait_ref ──────────
      // → identité du portrait projetée sur le visage du body T2I
      setFullbodyPhase('facedetailer')
      setFullbodyProgressLabel('Affinage du visage…')

      const finalUrl = await runFaceDetailer({
        sourceUrl: bodyT2IUrl,
        refUrl: portraitUrl,
        prompt: prompt.trim() || undefined,
        storagePathPrefix: `${storagePathPrefix}_char_fullbody_face`,
        onProgress: (p) => { if (p.label) setFullbodyProgressLabel(`Visage · ${p.label}`) },
      })

      setFullbodyUrl(finalUrl); setFullbodyPhase('done'); setFullbodyProgressLabel('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[CharacterCreator] fullbody pipeline failed:', msg)
      setFullbodyError(msg); setFullbodyPhase('error'); setFullbodyProgressLabel('')
    }
  }

  function handleSave() {
    if (!canSave) return
    if (isEditMode && editingCharacter) {
      // Mode édition : update du perso existant (préserve id, createdAt)
      updateCharacter(editingCharacter.id, {
        name: name.trim(),
        style,
        prompt: prompt.trim() || undefined,
        portraitUrl,
        fullbodyUrl,
      })
      onCreated?.(editingCharacter.id)
    } else {
      // Mode création : nouveau perso
      const created = addCharacter({
        name: name.trim(),
        style,
        prompt: prompt.trim() || undefined,
        portraitUrl,
        fullbodyUrl,
      })
      onCreated?.(created.id)
    }
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ccm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          // Pas de onClick={onClose} — modal sticky : seul X / Annuler ferme.
          // Évite la perte de travail si l'auteur clique en dehors par erreur
          // (les générations + métadonnées prennent du temps à recréer).
        >
          <motion.div
            className="ccm-modal"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ccm-title"
          >
            <header className="ccm-header">
              <h2 id="ccm-title">{isEditMode ? `Modifier ${editingCharacter?.name}` : 'Créer un personnage'}</h2>
              <button type="button" onClick={onClose} className="ccm-close" aria-label="Fermer">
                <X size={16} />
              </button>
            </header>

            <div className="ccm-body">
              {/* Nom */}
              <div className="ccm-field">
                <label htmlFor="ccm-name">Nom</label>
                <input
                  id="ccm-name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="ex : Lyralia"
                  className="ccm-input"
                  autoFocus
                />
              </div>

              {/* Style — dropdown 6 options */}
              <div className="ccm-field">
                <label htmlFor="ccm-style-select">Style</label>
                <select
                  id="ccm-style-select"
                  className="ccm-select"
                  value={style}
                  onChange={e => setStyle(e.target.value as CharacterStyle)}
                >
                  {STYLE_ORDER.map(key => (
                    <option key={key} value={key}>{STYLE_LABELS[key]}</option>
                  ))}
                </select>
              </div>

              {/* Moteur portrait : 3 options (Z-Image rapide, Flux Dev rapide, Flux Dev qualité) */}
              <div className="ccm-field">
                <label>Moteur du portrait</label>
                <div className="ccm-radio-row">
                  <label className={`ccm-radio ${engine === 'z_image' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="ccm-engine"
                      checked={engine === 'z_image'}
                      onChange={() => setEngine('z_image')}
                    />
                    <span>⚡ Z-Image · ~25s</span>
                  </label>
                  <label className={`ccm-radio ${engine === 'flux_dev_fast' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="ccm-engine"
                      checked={engine === 'flux_dev_fast'}
                      onChange={() => setEngine('flux_dev_fast')}
                    />
                    <span>🚀 Flux rapide · ~40s</span>
                  </label>
                  <label className={`ccm-radio ${engine === 'flux_dev' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="ccm-engine"
                      checked={engine === 'flux_dev'}
                      onChange={() => setEngine('flux_dev')}
                    />
                    <span>✨ Flux qualité · ~75s</span>
                  </label>
                </div>
              </div>

              {/* Prompt */}
              <div className="ccm-field">
                <label htmlFor="ccm-prompt">Description visuelle</label>
                <textarea
                  id="ccm-prompt"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="ex : Jeune elfe aux cheveux blonds tressés, robe verte, diadème argenté"
                  rows={3}
                  className="ccm-textarea"
                />
              </div>

              {/* 2 slots image */}
              <div className="ccm-slots">
                <ImageSlot
                  label="Portrait"
                  hint={
                    engine === 'z_image'       ? 'Z-Image · ~25s' :
                    engine === 'flux_dev_fast' ? 'Flux rapide · ~40s' :
                                                  'Flux qualité · ~75s'
                  }
                  url={portraitUrl}
                  busy={portraitBusy}
                  busyLabel={portraitProgressLabel || 'Génération…'}
                  disabled={!promptOk || portraitBusy}
                  onGenerate={generatePortrait}
                  warning={portraitError ?? undefined}
                />
                <ImageSlot
                  label="Plein pied"
                  hint={portraitUrl ? 'InstantID — visage du portrait' : 'génère d\'abord le portrait'}
                  url={fullbodyUrl}
                  busy={fullbodyBusy}
                  busyLabel={fullbodyProgressLabel || 'Génération…'}
                  disabled={!canGenerateFullbody}
                  onGenerate={generateFullbody}
                  warning={fullbodyError ?? undefined}
                />
              </div>
            </div>

            <footer className="ccm-footer">
              <button type="button" onClick={onClose} className="ccm-btn-ghost">
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="ccm-btn-primary"
                title={!canSave ? 'Renseigne un nom et génère au moins une image' : 'Enregistrer le personnage'}
              >
                Enregistrer
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ImageSlot({ label, hint, url, busy, busyLabel = 'Génération…', disabled, onGenerate, warning }: {
  label: string
  hint: string
  url: string | null
  busy: boolean
  busyLabel?: string
  disabled: boolean
  onGenerate: () => void
  /** Si fourni, affiché en bas de slot (ex: "FaceDetailer skipped — visage non détecté"). */
  warning?: string
}) {
  return (
    <div className="ccm-slot">
      <div className="ccm-slot-header">
        <span className="ccm-slot-label">{label}</span>
        <span className="ccm-slot-hint">{hint}</span>
      </div>
      <div className="ccm-slot-preview">
        {url ? (
          <img src={url} alt={label} className="ccm-slot-img" />
        ) : busy ? (
          <div className="ccm-slot-busy">
            <Loader2 size={20} className="ccm-spin" />
            <span>{busyLabel}</span>
          </div>
        ) : (
          <div className="ccm-slot-empty">
            <ImagePlus size={20} />
          </div>
        )}
        {url && !busy && (
          <span className="ccm-slot-check" aria-label="Image générée">
            <Check size={11} strokeWidth={3} />
          </span>
        )}
      </div>
      {warning && (
        <div className="ccm-slot-warning" title={warning}>⚠ Erreur : {warning.slice(0, 60)}…</div>
      )}
      <button
        type="button"
        onClick={onGenerate}
        disabled={disabled || busy}
        className="ccm-slot-btn"
      >
        {busy ? busyLabel : url ? 'Régénérer' : 'Générer'}
      </button>
    </div>
  )
}
