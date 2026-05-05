'use client'
/**
 * CatalogAnimation — drawer gauche minimal (refonte Phase A 2026-05-05).
 *
 * Triggered par Personnage → Animer. Contenu strict :
 *   1. Import d'une vidéo existante (PC → Supabase /videos)
 *   2. Sélection des persos disponibles (max 2 — limite IC LoRA Dual)
 *
 * Le STORYBOARD a déménagé : la timeline horizontale + l'éditeur inline
 * vivent désormais dans la bande basse (`AnimationTimeline` + `AnimationEditor`),
 * branchés dans DesignerLayout. Tout l'état partagé est dans EditorState
 * (animationPellicules / animationSelectedPelliculeId / animationSelectedCharIds).
 *
 * Cette séparation libère le drawer pour qu'il reste un drawer (= 20rem de
 * large), évite de gérer un layout dans-le-drawer-ET-dans-la-page, et permet
 * au canvas central de rétrécir verticalement sans toucher au drawer.
 *
 * V1 : tous les types de pellicule sont 'animation' (gen LTX). Les types
 * `image_static` / `conversation` viendront en Phase C.
 */

import React, { useRef, useState, useMemo } from 'react'
import { ChevronRight, Loader2, Check, Upload, Image as ImageIcon } from 'lucide-react'
import CatalogShell from './CatalogShell'
import { useCharacterStore, type Character } from '@/lib/character-store'
import { useEditorState } from '@/components/image-editor/EditorStateContext'
import { extractFramesFromVideo } from '@/lib/extract-frames'
import type { BankImage } from '../types'

interface CatalogAnimationProps {
  onClose: () => void
  onNavigateToBanks?: () => void
  storagePathPrefix: string
  /** IDs des Characters réellement présents dans le plan (extraits des
   *  calques avec character_id renseigné OU bakedCharacterIds).
   *  Liste vide => fallback B (l'auteur sélectionne manuellement parmi tous). */
  presentCharacterIds?: string[]
  /** Phase E (2026-05-05) : banque d'images affichée dans le drawer quand
   *  la pellicule sélectionnée est de type 'image_static'. Click sur une
   *  image = la set comme firstFrame/lastFrame de la pellicule courante. */
  bankImages?: BankImage[]
}

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
      <span className="dz-breadcrumb-parent" style={{ cursor: 'default' }}>Personnages</span>
      <ChevronRight size={11} className="dz-breadcrumb-sep" aria-hidden />
      <span className="dz-breadcrumb-current">Animation</span>
    </span>
  )
}

export default function CatalogAnimation({
  onClose, onNavigateToBanks, presentCharacterIds = [],
  bankImages = [],
}: CatalogAnimationProps) {
  const { characters } = useCharacterStore()
  const {
    setBakeStatus,
    animationSelectedCharIds,
    setAnimationSelectedChars,
    addAnimationPellicule,
    updateAnimationPellicule,  // smart fill : remplit la pellicule sélectionnée si vide
    animationPellicules,
    animationSelectedPelliculeId,
    setCurrentVideo,  // pour auto-play dans Canvas après upload (cohérent avec gen LTX)
  } = useEditorState()

  // Phase E : pellicule sélectionnée → drive le contenu du drawer.
  // Si type='image_static' → drawer affiche la banque d'images au lieu des
  // sections vidéo + persos (qui ne s'appliquent pas à une image fixe).
  const selectedPellicule = useMemo(
    () => animationSelectedPelliculeId
      ? animationPellicules.find(p => p.id === animationSelectedPelliculeId) ?? null
      : null,
    [animationSelectedPelliculeId, animationPellicules],
  )
  const isImageStaticMode = selectedPellicule?.type === 'image_static'

  /** Click sur une image de la banque → set comme image de la pellicule
   *  image_static courante. firstFrame == lastFrame (statique). */
  function pickBankImage(img: BankImage) {
    if (!selectedPellicule || selectedPellicule.type !== 'image_static') return
    updateAnimationPellicule(selectedPellicule.id, {
      firstFrameUrl: img.url,
      lastFrameUrl: img.url,
    })
  }

  // Upload manuel : ref input + busy flag (bloque les double-clics)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [progressLabel, setProgressLabel] = useState<string>('')

  /** Source des persos dans le sélecteur :
   *  - presentCharacterIds non vide → filtre (auto-detect via calques+baked)
   *  - vide → fallback B : tous les persos de la banque (sélection manuelle) */
  const persosInScene = useMemo(
    () => presentCharacterIds.length > 0
      ? characters.filter(c => presentCharacterIds.includes(c.id))
      : characters,
    [characters, presentCharacterIds],
  )
  const fallbackManual = presentCharacterIds.length === 0 && characters.length > 0

  function toggleCharacter(charId: string) {
    const current = animationSelectedCharIds
    if (current.includes(charId)) {
      setAnimationSelectedChars(current.filter(id => id !== charId))
    } else if (current.length >= 2) {
      // Max 2 — remplace le 1er (le plus ancien)
      setAnimationSelectedChars([current[1], charId])
    } else {
      setAnimationSelectedChars([...current, charId])
    }
  }

  /** Upload manuel d'une vidéo existante depuis le PC.
   *  Comportement = pellicule générée :
   *   1. Read file → data URL → POST /api/storage/upload-video → URL Supabase
   *   2. Extract first/last frames côté client
   *   3. Crée une nouvelle pellicule avec videoUrl + frames + auto-select
   *  L'utilisateur la voit immédiatement dans la timeline (bande basse) +
   *  Canvas affiche la firstFrame.  */
  async function handleVideoUpload(file: File) {
    if (!file.type.startsWith('video/')) {
      setUploadError(`Format non supporté : ${file.type || 'inconnu'} (attendu : video/mp4, webm, mov…)`)
      return
    }

    setUploading(true); setUploadError(null)
    setBakeStatus({
      startedAt: Date.now(),
      phase: 'Lecture du fichier…',
      kind: 'animation',
      estimatedTotalSec: 30,
    })
    try {
      setProgressLabel('Lecture…')
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
        reader.readAsDataURL(file)
      })

      setProgressLabel('Upload Supabase…')
      setBakeStatus({
        startedAt: Date.now(),
        phase: 'Upload Supabase…',
        kind: 'animation',
        estimatedTotalSec: 30,
      })
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `studio/uploads/video_${Date.now()}.${ext}`
      const upRes = await fetch('/api/storage/upload-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path }),
      })
      const upData = await upRes.json() as { url?: string; error?: string }
      if (!upRes.ok || !upData.url) {
        throw new Error(upData.error ?? `HTTP ${upRes.status}`)
      }
      const videoUrl = upData.url

      // Extraction frames best-effort (poster + lastFrame pour continuité)
      setProgressLabel('Capture des miniatures…')
      setBakeStatus({
        startedAt: Date.now(),
        phase: 'Capture des miniatures…',
        kind: 'animation',
        estimatedTotalSec: 15,
      })
      let firstFrameUrl: string | null = null
      let lastFrameUrl: string | null = null
      try {
        const frames = await extractFramesFromVideo({
          videoUrl,
          storagePathPrefix: 'studio/uploads/frames',
        })
        firstFrameUrl = frames.first_frame_url
        lastFrameUrl = frames.last_frame_url
      } catch (frameErr) {
        console.warn('[CatalogAnimation] frame extraction failed (non-bloquant):', frameErr)
      }

      // Smart fill (2026-05-05) : si la pellicule sélectionnée est VIDE
      // (pas encore générée/uploadée), on la remplit avec le contenu uploadé
      // au lieu de créer une nouvelle pellicule. Évite l'effet "pellicule
      // vide oubliée au milieu" quand l'auteur clique + puis Choisir une vidéo.
      const selectedPell = animationSelectedPelliculeId
        ? animationPellicules.find(p => p.id === animationSelectedPelliculeId)
        : null
      if (selectedPell && !selectedPell.videoUrl) {
        // Remplit la pellicule vide sélectionnée
        updateAnimationPellicule(selectedPell.id, {
          videoUrl,
          firstFrameUrl,
          lastFrameUrl,
        })
      } else {
        // Sinon ajoute une nouvelle pellicule (auto-select via reducer)
        addAnimationPellicule({
          videoUrl,
          firstFrameUrl,
          lastFrameUrl,
        })
      }
      // Sync currentVideoUrl → Canvas joue automatiquement la vidéo
      // ET le Save Ctrl+S persiste base_video_url + frames + kind='animation'.
      // Sans ça : pellicule visible dans la timeline mais perdue au reload.
      setCurrentVideo(videoUrl, firstFrameUrl, lastFrameUrl)
      console.log('[CatalogAnimation] manual video upload OK:', videoUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[CatalogAnimation] video upload failed:', msg)
      setUploadError(msg)
    } finally {
      setUploading(false)
      setProgressLabel('')
      setBakeStatus(null)
    }
  }

  function pickVideoFile() {
    if (uploading) return
    fileInputRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleVideoUpload(file)
    e.target.value = ''
  }

  // Phase E — Mode image_static : drawer affiche la banque d'images au lieu
  // des sections vidéo + persos. Ces sections n'ont pas de sens pour une image
  // fixe (pas de gen LTX, pas de chars actifs).
  if (isImageStaticMode) {
    return (
      <CatalogShell
        title={<BreadcrumbTitle onNavigateToBanks={onNavigateToBanks} />}
        onClose={onClose}
        showSearch={false}
      >
        <div className="dza-section">
          <div className="dza-section-title">
            <span>Banque d'images</span>
            <span className="dza-hint">{bankImages.length} disponible{bankImages.length > 1 ? 's' : ''}</span>
          </div>
          {bankImages.length === 0 ? (
            <div className="dza-empty">
              La banque est vide. Upload une image dans la banque depuis la Phase A,
              ou utilise le bouton <strong>Choisir une image</strong> dans l'éditeur en bas
              pour importer directement depuis ton ordinateur.
            </div>
          ) : (
            <div className="dza-bank-grid">
              {bankImages.map(img => {
                const isPicked = selectedPellicule?.firstFrameUrl === img.url
                return (
                  <button
                    key={img.id}
                    type="button"
                    className={`dza-bank-thumb ${isPicked ? 'picked' : ''}`}
                    onClick={() => pickBankImage(img)}
                    title={img.label ?? img.tags?.join(', ') ?? 'Image de la banque'}
                  >
                    <img src={img.thumbnailUrl ?? img.url} alt={img.label ?? ''} />
                    {isPicked && (
                      <span className="dza-bank-thumb-check">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                    {img.label && <span className="dza-bank-thumb-label">{img.label}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="dza-section">
          <div className="dza-hint" style={{ textAlign: 'center', padding: '0.5rem' }}>
            <ImageIcon size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.25rem' }} />
            Pellicule fixe — l'image s'affichera pendant la durée configurée.
            Tu peux aussi importer une image depuis ton ordinateur via le bouton dans l'éditeur en bas.
          </div>
        </div>
      </CatalogShell>
    )
  }

  return (
    <CatalogShell
      title={<BreadcrumbTitle onNavigateToBanks={onNavigateToBanks} />}
      onClose={onClose}
      showSearch={false}
    >
      {/* Section 1 — Import d'une vidéo existante */}
      <div className="dza-section">
        <div className="dza-section-title">
          <span>Importer une vidéo existante</span>
          <span className="dza-hint">MP4, WebM, MOV</span>
        </div>
        <button
          type="button"
          className="dza-upload-btn"
          onClick={pickVideoFile}
          disabled={uploading}
          title="Importe une vidéo depuis ton ordinateur. Elle apparaîtra dans la timeline comme une pellicule générée."
        >
          {uploading ? (
            <>
              <Loader2 size={14} className="dza-spin" />
              <span>{progressLabel || 'Upload en cours…'}</span>
            </>
          ) : (
            <>
              <Upload size={14} />
              <span>Choisir une vidéo</span>
            </>
          )}
        </button>
        {uploadError && (
          <div className="dza-upload-error" title={uploadError}>
            ⚠ {uploadError.length > 90 ? uploadError.slice(0, 90) + '…' : uploadError}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* Section 2 — Sélecteur de persos (max 2, IC LoRA Dual limit) */}
      <div className="dza-section">
        <div className="dza-section-title">
          <span>{fallbackManual ? 'Personnages disponibles' : 'Personnages dans la scène'}</span>
          <span className="dza-hint">2 max</span>
        </div>
        {fallbackManual && (
          <div className="dza-empty" style={{ marginBottom: 8, fontSize: 10, fontStyle: 'italic' }}>
            Aucun perso identifié auto. Sélectionne ceux que tu vois dans la scène.
          </div>
        )}
        <div className="dza-char-row">
          {persosInScene.length === 0 ? (
            <div className="dza-empty">
              Aucun perso dans la banque. Crée-en un d&apos;abord (Personnage → Ajouter → Nouveau).
            </div>
          ) : persosInScene.map(c => {
            const checked = animationSelectedCharIds.includes(c.id)
            const thumbUrl = c.portraitUrl ?? c.fullbodyUrl
            return (
              <button
                key={c.id}
                type="button"
                className={`dza-char-card ${checked ? 'selected' : ''}`}
                onClick={() => toggleCharacter(c.id)}
                title={`${checked ? 'Retirer' : 'Sélectionner'} ${c.name}`}
              >
                {thumbUrl
                  ? <img src={thumbUrl} alt={c.name} className="dza-char-img" />
                  : <div className="dza-char-empty">👤</div>}
                <div className="dza-char-name">{c.name}</div>
                {checked && (
                  <span className="dza-char-check">
                    <Check size={11} strokeWidth={3} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Indication discrète : la timeline est en bas */}
      <div className="dza-section">
        <div className="dza-hint" style={{ textAlign: 'center', padding: '0.5rem' }}>
          Le storyboard est en bas. Clique sur <strong>+</strong> pour ajouter une pellicule.
        </div>
      </div>
    </CatalogShell>
  )
}

// Workaround : on conserve le placeholder pour ne pas casser l'import depuis
// DesignerCatalog tant que la prop ancien-modèle (currentLayers, baseImageUrl)
// n'est pas nettoyée. Référencé via _ pour suppress l'unused warning.
export type { Character as _CharacterRef }
