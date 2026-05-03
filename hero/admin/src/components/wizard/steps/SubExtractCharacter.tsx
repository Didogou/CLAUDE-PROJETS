'use client'
/**
 * Sous-wizard "Extraire en fiche" du PlanWizard.
 *
 * Stages :
 *   - 'select'  : désigne le perso (Rectangle / SAM Points / SAM Auto)
 *   - 'done'    : extract fond gris — hub des actions optionnelles
 *   - 'eraser'  : retouche manuelle (gomme grise)
 *   - 'inpaint' : peint un mask + prompt → SDXL inpaint (mains cassées, etc.)
 *   - 'regen'   : régen IA d'un plein-pied via FaceID
 *
 * Chaque stage est soit un composant dédié (EraserCanvas, InpaintMaskCanvas),
 * soit un helper (generateCharacterVariants). Le composant n'a que de
 * l'orchestration — aucune logique métier.
 *
 * Validation finale : clic "✓ Valider cette fiche" → onCompleted(resultUrl).
 * Le parent ouvre alors une modale pour assigner à un NPC ou un Objet.
 */
import React, { useRef, useState } from 'react'
import type { PlanWizardState } from '../types'
import BoxSelector, { type Box } from '../common/BoxSelector'
import SAMSelector, { type SAMPoint } from '../common/SAMSelector'
import AutoSelector from '../common/AutoSelector'
import EraserCanvas from '../common/EraserCanvas'
import InpaintMaskCanvas from '../common/InpaintMaskCanvas'
import { extractByBox, extractByMask, extractByMaskUrl } from '../helpers/extractCharacter'
import { generateCharacterVariants } from '../helpers/generateCharacterVariants'
import { CHECKPOINTS } from '@/lib/comfyui'

export interface SubExtractCharacterProps {
  state: PlanWizardState
  /** Validation : l'utilisateur retourne l'URL de la fiche détourée/générée. */
  onCompleted: (extractedUrl: string) => void
  onCancel: () => void
}

type Stage = 'select' | 'done' | 'eraser' | 'inpaint' | 'regen'
type SelectMode = 'box' | 'sam' | 'auto'
type RegenVariant = 'fullbody_gray' | 'portrait_scenic'
type RegenStatus = { status: 'idle' | 'generating' | 'done' | 'error'; url?: string; error?: string; variant?: RegenVariant }

export default function SubExtractCharacter({ state, onCompleted, onCancel }: SubExtractCharacterProps) {
  const img = state.selectedImage
  const imgRef = useRef<HTMLImageElement | null>(null)

  // Sélection
  const [mode, setMode] = useState<SelectMode>('box')
  const [box, setBox] = useState<Box | null>(null)
  const [samPoints, setSamPoints] = useState<SAMPoint[]>([])
  const [autoMaskUrl, setAutoMaskUrl] = useState<string | null>(null) // mode 'auto' : URL du mask sélectionné

  // État général
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('select')
  /**
   * Historique des refinements successifs (extract → gomme → inpaint → régen → …).
   * Mis à jour à chaque validation d'opération. Permet d'afficher un compteur et
   * de revenir en arrière si besoin.
   */
  const [history, setHistory] = useState<string[]>([])

  /** Helper : met à jour l'extract courant + pousse dans l'historique. */
  function updateResult(url: string) {
    setResultUrl(url)
    setHistory(prev => [...prev, url])
  }

  // Régen IA "plein-pied fond gris" (1 seule image, pas de matrice).
  const [regen, setRegen] = useState<RegenStatus>({ status: 'idle' })
  const variantCheckpoint = state.selectedImage?.checkpointKey
    ? (CHECKPOINTS.find(c => c.key === state.selectedImage!.checkpointKey) ?? CHECKPOINTS[0])
    : CHECKPOINTS[0]

  if (!img) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Pas d&apos;image principale — retour au dashboard.</div>
  }

  // ── Extraction (select → done) ──────────────────────────────────────
  async function handleExtract() {
    setError(null)
    setProcessing(true)
    try {
      let url: string
      if (mode === 'box') {
        if (!box || !imgRef.current) throw new Error('Trace d\'abord un rectangle.')
        if (box.w < 20 || box.h < 20) throw new Error('Zone trop petite.')
        url = await extractByBox({ imgEl: imgRef.current, sourceUrl: img!.url, box })
      } else if (mode === 'sam') {
        if (samPoints.length === 0 || !imgRef.current) throw new Error('Clique sur le perso (au moins 1 point positif).')
        url = await extractByMask({ imgEl: imgRef.current, sourceUrl: img!.url, points: samPoints })
      } else {
        // mode === 'auto' : mask déjà choisi via AutoSelector
        if (!autoMaskUrl || !imgRef.current) throw new Error('Clique sur un objet détecté pour le sélectionner.')
        url = await extractByMaskUrl({ imgEl: imgRef.current, sourceUrl: img!.url, maskUrl: autoMaskUrl })
      }
      updateResult(url)
      setStage('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProcessing(false)
    }
  }

  function handleRestart() {
    setBox(null); setSamPoints([]); setAutoMaskUrl(null)
    setResultUrl(null); setHistory([]); setError(null); setStage('select')
    setRegen({ status: 'idle' })
  }

  /**
   * Régénération IA, paramétrable :
   *   - 'fullbody_gray'   → plein-pied fond gris (référence IPAdapter, fiche complète)
   *   - 'portrait_scenic' → portrait visage avec décor (vignette joueur agréable)
   *
   * Dans les deux cas, FaceID à 1.0 sur l'extract courant + pas d'IPAdapter Plus
   * (évite la dérive couleurs/ethnie observée en stack).
   */
  async function handleRegen(variant: RegenVariant) {
    if (!resultUrl) return
    setError(null); setRegen({ status: 'generating', variant })
    setStage('regen')
    try {
      await generateCharacterVariants({
        portraitUrl: resultUrl,
        checkpoint: variantCheckpoint.filename,
        style: state.params.style,
        sceneContext: state.params.prompt,
        baseDescription: state.params.prompt,
        storagePathPrefix: `${state.params.storagePathPrefix}_regen_${variant}`,
        variants: [variant],
        faceWeight: 1.0,
        styleWeight: 0,
        onProgress: (_key, status, url, err) => {
          if (status === 'done' && url) setRegen(prev => ({ ...prev, status: 'done', url }))
          else if (status === 'error')  setRegen(prev => ({ ...prev, status: 'error', error: err }))
        },
      })
    } catch (err: unknown) {
      setRegen(prev => ({ ...prev, status: 'error', error: err instanceof Error ? err.message : String(err) }))
    }
  }

  // ── Rendu ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
        <span style={{ color: '#52c484', fontWeight: 'bold', fontSize: '0.95rem' }}>🧍 Sous-wizard — Extraire un personnage en fiche</span>
        <button onClick={onCancel} disabled={processing || regen.status === 'generating'} style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: (processing || regen.status === 'generating') ? 'wait' : 'pointer', opacity: (processing || regen.status === 'generating') ? 0.5 : 1 }}>← Retour dashboard</button>
      </div>

      {/* Stage : SELECT */}
      {stage === 'select' && (
        <>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Mode :</span>
            <button onClick={() => setMode('box')} disabled={processing}
              style={{ fontSize: '0.65rem', padding: '0.25rem 0.7rem', borderRadius: '4px', border: `1px solid ${mode === 'box' ? '#52c484' : 'var(--border)'}`, background: mode === 'box' ? 'rgba(82,196,132,0.15)' : 'transparent', color: mode === 'box' ? '#52c484' : 'var(--muted)', cursor: processing ? 'wait' : 'pointer', fontWeight: mode === 'box' ? 'bold' : 'normal' }}>📦 Rectangle</button>
            <button onClick={() => setMode('sam')} disabled={processing}
              style={{ fontSize: '0.65rem', padding: '0.25rem 0.7rem', borderRadius: '4px', border: `1px solid ${mode === 'sam' ? '#52c484' : 'var(--border)'}`, background: mode === 'sam' ? 'rgba(82,196,132,0.15)' : 'transparent', color: mode === 'sam' ? '#52c484' : 'var(--muted)', cursor: processing ? 'wait' : 'pointer', fontWeight: mode === 'sam' ? 'bold' : 'normal' }}
              title="Segmentation par points via SAM 2. Requiert ComfyUI-segment-anything-2 installé.">🎯 Points SAM</button>
            <button onClick={() => setMode('auto')} disabled={processing}
              style={{ fontSize: '0.65rem', padding: '0.25rem 0.7rem', borderRadius: '4px', border: `1px solid ${mode === 'auto' ? '#4ed5d5' : 'var(--border)'}`, background: mode === 'auto' ? 'rgba(78,213,213,0.15)' : 'transparent', color: mode === 'auto' ? '#4ed5d5' : 'var(--muted)', cursor: processing ? 'wait' : 'pointer', fontWeight: mode === 'auto' ? 'bold' : 'normal' }}
              title="SAM 2 auto-segmente toute l'image ; hover → clique pour sélectionner un objet. Requiert ComfyUI-segment-anything-2 installé.">✨ Baguette magique</button>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            {mode === 'box'  && 'Trace un rectangle autour du personnage.'}
            {mode === 'sam'  && 'Clique sur le perso (positif). Shift-clic = point négatif (exclure).'}
            {mode === 'auto' && 'Hover l\'image, SAM détecte automatiquement les objets — clique pour sélectionner.'}
          </div>

          {mode === 'box' && (
            <BoxSelector imageUrl={img.url} box={box} onBoxChange={setBox} disabled={processing} imgRefCallback={el => { imgRef.current = el }} />
          )}
          {mode === 'sam' && (
            <SAMSelector imageUrl={img.url} points={samPoints} onPointsChange={setSamPoints} disabled={processing} imgRefCallback={el => { imgRef.current = el }} />
          )}
          {mode === 'auto' && (
            <AutoSelector imageUrl={img.url} selectedMaskUrl={autoMaskUrl} onMaskSelected={setAutoMaskUrl} disabled={processing} imgRefCallback={el => { imgRef.current = el }} />
          )}

          {error && <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>⚠ {error}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={() => { setBox(null); setSamPoints([]); setAutoMaskUrl(null) }}
              disabled={processing || (!box && samPoints.length === 0 && !autoMaskUrl)}
              style={{ fontSize: '0.7rem', padding: '0.35rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Effacer</button>
            <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
              {mode === 'box'  && (box ? `${Math.round(box.w)}×${Math.round(box.h)}px` : '—')}
              {mode === 'sam'  && `${samPoints.filter(p => p.positive).length}+ / ${samPoints.filter(p => !p.positive).length}-`}
              {mode === 'auto' && (autoMaskUrl ? '✓ mask sélectionné' : '—')}
            </span>
            <button onClick={() => void handleExtract()}
              disabled={processing || (mode === 'box' ? !box : mode === 'sam' ? samPoints.length === 0 : !autoMaskUrl)}
              style={{ marginLeft: 'auto', background: '#52c484', border: 'none', borderRadius: '4px', padding: '0.5rem 1.1rem', color: '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: processing ? 'wait' : 'pointer', opacity: processing ? 0.6 : 1 }}>
              {processing ? '⏳ Extraction…' : '✂ Extraire'}
            </button>
          </div>
        </>
      )}

      {/* Stage : DONE — vue d'ensemble side-by-side + actions en row */}
      {stage === 'done' && resultUrl && (
        <>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            Vue d&apos;ensemble du personnage. Chaque opération (gomme, inpaint, régen, variantes) met à jour l&apos;extrait à droite.
            {history.length > 1 && <span style={{ marginLeft: '0.5rem', opacity: 0.7 }}>— {history.length} itération{history.length > 1 ? 's' : ''}</span>}
          </div>

          {/* Double vue : source (gauche) | extract courant (droite) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>📷 Source</div>
              <img src={img.url} alt="source" style={{ width: '100%', height: 'auto', maxHeight: 'calc(95vh - 420px)', objectFit: 'contain', borderRadius: '6px', border: '1px solid var(--border)', background: '#000' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ fontSize: '0.65rem', color: '#52c484' }}>🧍 Fiche extraite</div>
              <img src={resultUrl} alt="extract" style={{ width: '100%', height: 'auto', maxHeight: 'calc(95vh - 420px)', objectFit: 'contain', borderRadius: '6px', border: '2px solid #52c484', background: '#808080' }} />
            </div>
          </div>

          {/* Mini-historique si plusieurs itérations */}
          {history.length > 1 && (
            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.6rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
              <span>Historique :</span>
              {history.map((url, i) => (
                <button key={i} onClick={() => setResultUrl(url)}
                  title={`Revenir à l'itération ${i + 1}`}
                  style={{ padding: 0, border: `2px solid ${url === resultUrl ? '#52c484' : 'var(--border)'}`, background: 'transparent', cursor: 'pointer', borderRadius: '3px' }}>
                  <img src={url} alt={`iter ${i + 1}`} style={{ width: 42, height: 42, objectFit: 'cover', borderRadius: '2px', background: '#808080', display: 'block' }} />
                </button>
              ))}
            </div>
          )}

          {error && <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px' }}>⚠ {error}</div>}

          {/* Actions en row (wrap sur petites largeurs) */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', paddingTop: '0.4rem', borderTop: '1px solid var(--border)' }}>
            <button onClick={() => setStage('eraser')} title="Efface les bouts de voisins/fond accrochés au détourage"
              style={{ padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>
              ✏️ Retoucher
            </button>
            <button onClick={() => setStage('inpaint')} title="Reconstruit mains/parties tronquées via prompt local (SDXL inpaint)"
              style={{ padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>
              🩹 Réparer
            </button>
            <button onClick={() => void handleRegen('fullbody_gray')} title="IA reproduit le perso sur fond gris, plein-pied, mains anatomiquement correctes (référence IPAdapter + fiche complète)"
              style={{ padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid #b48eddaa', background: 'rgba(180,142,221,0.12)', color: '#b48edd', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>
              🪄 Régénérer plein-pied (gris)
            </button>
            <button onClick={() => void handleRegen('portrait_scenic')} title="Génère un portrait visage avec décor (idéal pour la vignette joueur — évite le fond gris)"
              style={{ padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid #64b5f6aa', background: 'rgba(100,181,246,0.12)', color: '#64b5f6', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>
              🎭 Générer portrait scénique
            </button>
            <button onClick={handleRestart} title="Recommencer à zéro (perd l'historique)"
              style={{ padding: '0.5rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: '0.7rem', cursor: 'pointer' }}>
              ↻ Recommencer
            </button>
            <button onClick={() => onCompleted(resultUrl)} title="Envoie cette fiche au parent pour assignation NPC"
              style={{ marginLeft: 'auto', padding: '0.55rem 1rem', borderRadius: '6px', border: 'none', background: '#52c484', color: '#0f0f14', fontSize: '0.72rem', fontWeight: 'bold', cursor: 'pointer' }}>
              ✓ Valider cette fiche
            </button>
          </div>
        </>
      )}

      {/* Stage : ERASER */}
      {stage === 'eraser' && resultUrl && (
        <EraserCanvas
          imageUrl={resultUrl}
          storagePathPrefix={`${state.params.storagePathPrefix}_eraser`}
          onCompleted={url => { updateResult(url); setStage('done') }}
          onCancel={() => setStage('done')}
        />
      )}

      {/* Stage : INPAINT */}
      {stage === 'inpaint' && resultUrl && (
        <InpaintMaskCanvas
          imageUrl={resultUrl}
          checkpoint={variantCheckpoint.filename}
          storagePathPrefix={`${state.params.storagePathPrefix}_inpaint`}
          defaultPrompt="hands, detailed fingers, anatomically correct"
          onCompleted={url => { updateResult(url); setStage('done') }}
          onCancel={() => setStage('done')}
        />
      )}

      {/* Stage : REGEN — régen IA 1-image via FaceID (paramétrable) */}
      {stage === 'regen' && resultUrl && (() => {
        const isPortrait = regen.variant === 'portrait_scenic'
        const headerColor = isPortrait ? '#64b5f6' : '#b48edd'
        const headerLabel = isPortrait ? '🎭 Portrait scénique' : '✨ Plein-pied régénéré'
        const aspectRatio = isPortrait ? '1' : '9/16'
        const description = isPortrait
          ? '🎭 Génération d\'un portrait visage + décor (~30-60s) pour la vignette joueur. FaceID 1.0 sur ton extract → identité préservée.'
          : '🪄 Génération d\'un plein-pied fond gris (~30-60s). FaceID 1.0 + tags hand-safe. Idéal comme référence IPAdapter pour de futures scènes.'
        return <>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{description}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>🧍 Référence FaceID</div>
              <img src={resultUrl} alt="ref" style={{ width: '100%', height: 'auto', borderRadius: '6px', border: '1px solid var(--border)', background: '#808080' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ fontSize: '0.65rem', color: headerColor }}>{headerLabel}</div>
              <div style={{ aspectRatio, background: '#000', borderRadius: '6px', border: `2px solid ${regen.status === 'done' ? headerColor : regen.status === 'error' ? '#c94c4c' : 'var(--border)'}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {regen.url ? (
                  <img src={regen.url} alt={headerLabel} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : regen.status === 'error' ? (
                  <span style={{ fontSize: '0.7rem', color: '#c94c4c', textAlign: 'center', padding: '0.8rem' }}>{regen.error}</span>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic' }}>⏳ Génération…</span>
                )}
              </div>
            </div>
          </div>

          {error && <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px' }}>⚠ {error}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => setStage('done')} disabled={regen.status === 'generating'}
              style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: regen.status === 'generating' ? 'wait' : 'pointer' }}>
              ← Retour
            </button>
            <button onClick={() => regen.variant && void handleRegen(regen.variant)} disabled={regen.status === 'generating'}
              style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: regen.status === 'generating' ? 'wait' : 'pointer' }}>
              ↻ Regénérer (nouveau seed)
            </button>
            {regen.status === 'done' && regen.url && (
              <button
                onClick={() => { updateResult(regen.url!); setStage('done') }}
                title="Remplace l'extract courant par cette régen et retourne au hub"
                style={{ marginLeft: 'auto', background: headerColor, border: 'none', borderRadius: '4px', padding: '0.5rem 1.2rem', color: '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}
              >
                ↩ Utiliser cette régen
              </button>
            )}
          </div>
        </>
      })()}
    </div>
  )
}
