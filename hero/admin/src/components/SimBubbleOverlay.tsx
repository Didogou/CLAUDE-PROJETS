'use client'
/**
 * Renderer texte/bulles unifié — extrait fidèle du simulateur (page.tsx ~12490-12695).
 *
 * Affiche pour un instant donné :
 *   - soit une BULLE (si chunks ont speaker) : style selon bubbleType (foule/pensee/discussion/radio/bruit/discours)
 *     avec portrait NPC + position depuis bubble_positions
 *   - soit du TEXTE NARRATIF positionné selon text_position
 *
 * Animation per-mot via keyframe `wordAppear` (injectée localement).
 * Mots rouges (NPC + lieux + custom) coloriés.
 *
 * Source unique consommée par : <PlanPlayer> (mini-tel + section preview), futur simulateur après migration.
 */
import React, { useEffect, useMemo } from 'react'
import type { NarrChunk } from '@/lib/sim-text-parser'
import type { Npc } from '@/types'

// ── Keyframes injectés une seule fois ────────────────────────────────────────

const KEYFRAME_STYLE_ID = 'hero-sim-bubble-keyframes'
const KEYFRAMES_CSS = `
@keyframes simBubbleWordAppear { 0% { opacity:0; filter:blur(4px) } 60% { opacity:0.7; filter:blur(1px) } 100% { opacity:1; filter:blur(0) } }
@keyframes simBubbleThoughtAppear { from { opacity:0; transform:translateY(8px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
`

function ensureKeyframesInjected() {
  if (typeof document === 'undefined') return
  if (document.getElementById(KEYFRAME_STYLE_ID)) return
  const s = document.createElement('style')
  s.id = KEYFRAME_STYLE_ID
  s.textContent = KEYFRAMES_CSS
  document.head.appendChild(s)
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface SimBubbleOverlayProps {
  /** Chunks visibles à l'instant courant (subset de allChunks). */
  visibleChunks: NarrChunk[]
  /** Tous les chunks de la phrase (pour détecter mono-chunk → centrage). */
  allChunks?: NarrChunk[]
  /** Liste de tous les PNJ pour lookup portrait par speaker.name. */
  npcs: Npc[]
  /** Positions des bulles par clé "speaker:type" (image.bubble_positions). */
  bubblePositions?: Record<string, { x: number; y: number }>
  /** Position du texte narratif (% sur l'image). Défaut centre. */
  textPosition?: { x: number; y: number }
  /** Taille de texte de base (px). Défaut 15 (== simPrefs.textFontSize default). */
  textFontSize: number
  /** Mots à colorier en rouge (lowercase, sans ponctuation). */
  redWords: Set<string>
  /** Largeur du conteneur en px (CW dans le simulateur). Détermine bulle/portrait/bruit sizing. */
  containerWidth: number
  /** Si false, masque le fond semi-opaque sous le texte narratif. */
  showNarrativeBackground?: boolean
}

// ── Composant principal ──────────────────────────────────────────────────────

export default function SimBubbleOverlay({
  visibleChunks,
  allChunks,
  npcs,
  bubblePositions,
  textPosition,
  textFontSize,
  redWords,
  containerWidth,
  showNarrativeBackground = true,
}: SimBubbleOverlayProps) {
  useEffect(() => { ensureKeyframesInjected() }, [])

  // ── Calcul state dérivé (calque exact du simulateur) ────────────────────
  const CW = containerWidth
  const allCh = allChunks ?? visibleChunks
  // Largeur de référence du simulateur (CW = 390 dans SectionPreviewCard, ligne 11384).
  // On scale les tailles de texte par CW/REF_W pour que le rendu paraisse proportionnel
  // quelle que soit la taille du conteneur (mini-tel ~280, simulateur 390, modal 360).
  const REF_W = 390
  const scale = CW / REF_W

  // Trouver le début de la phrase courante (après le dernier lineBreak)
  let currentSentenceStart = 0
  for (let ci = 0; ci < visibleChunks.length - 1; ci++) {
    if (visibleChunks[ci].lineBreak) currentSentenceStart = ci + 1
  }
  const currentSentenceChunks = visibleChunks.slice(currentSentenceStart)

  // Mono-chunk sentence → centré
  let fullSentenceEnd = allCh.length - 1
  for (let ci = currentSentenceStart; ci < allCh.length; ci++) {
    if (allCh[ci].lineBreak) { fullSentenceEnd = ci; break }
  }
  const isSingleChunkSentence = (fullSentenceEnd - currentSentenceStart) === 0
  const sentenceAlign: 'center' | 'left' = isSingleChunkSentence ? 'center' : 'left'

  // Speaker + type de bulle du chunk courant
  const currentSpeaker = currentSentenceChunks[0]?.speaker ?? null
  const currentBubbleType = currentSentenceChunks[0]?.bubbleType ?? (currentSpeaker === 'foule' ? 'foule' : 'discours')
  const isFoule = currentBubbleType === 'foule'

  // Position de la bulle — clé = "speaker:type", fallback ancienne clé sans type
  const bubblePosKey = currentSpeaker ? `${currentSpeaker}:${currentBubbleType}` : null
  const bubblePos = bubblePosKey
    ? (bubblePositions?.[bubblePosKey] ?? bubblePositions?.[currentSpeaker as string] ?? null)
    : null

  // Portrait NPC
  const speakerNpc = useMemo(
    () => currentSpeaker ? npcs.find(n => n.name?.toLowerCase() === currentSpeaker.toLowerCase()) ?? null : null,
    [currentSpeaker, npcs],
  )

  // Sizes — scalées par `scale` (CW/REF_W) pour rester proportionnelles au conteneur.
  const normalFontSize = Math.round((textFontSize + 10) * scale)
  const discoursFontSize = Math.round((textFontSize + 10) * scale)
  const scaledTextFontSize = Math.round(textFontSize * scale)  // pour bulles foule/pensee/discussion/radio
  const LH = Math.round(normalFontSize * 1.7)

  // Older words count : pour animer SEULEMENT les mots du dernier chunk visible
  const olderWordCount = currentSentenceChunks.slice(0, -1).map(c => c.text).join(' ').split(/\s+/).filter(Boolean).length

  // ── renderWords (calque exact ; noRed = true pour bulles) ─────────────────
  function renderWords(chunks: NarrChunk[], startKey: number, olderWC: number, noRed = false) {
    const items: { word: string; isParaEnd: boolean }[] = []
    chunks.forEach((chunk, ci) => {
      const words = chunk.text.split(/\s+/).filter(Boolean)
      const isLastChunk = ci === chunks.length - 1
      words.forEach((word, wi) => {
        const isParaEnd = (chunk.lineBreak || isLastChunk) && wi === words.length - 1
        items.push({ word, isParaEnd })
      })
    })
    return items.map(({ word, isParaEnd }, idx) => {
      const isPunctOnly = /^[.,!?;:…»«\-–—()[\]"']+$/.test(word)
      const clean = word.toLowerCase().replace(/[.,!?;:'"«»()\[\]!]/g, '')
      const isRed = !noRed && !isPunctOnly && (isParaEnd || (clean.length > 0 && redWords.has(clean)))
      const isNew = idx >= olderWC
      return (
        <React.Fragment key={`${startKey}-${idx}`}>
          {idx > 0 && ' '}
          <span style={{ color: isRed ? '#e03030' : 'inherit', animation: isNew ? 'simBubbleWordAppear 0.35s ease both' : undefined }}>
            {word}
          </span>
        </React.Fragment>
      )
    })
  }

  // ── renderBubble (calque exact) ──────────────────────────────────────────
  function renderBubble() {
    const bx = bubblePos ? bubblePos.x : 50
    const by = bubblePos ? bubblePos.y : 50
    const pad = `${Math.round(CW * 0.025)}px ${Math.round(CW * 0.04)}px`
    const bubbleW = Math.round(CW * (isFoule ? 0.72 : 0.68))
    const portraitSize = Math.round(CW * 0.10)

    let bubbleStyle: React.CSSProperties
    let flexDir: 'row' | 'row-reverse' = 'row'
    let portraitBorder = 'rgba(255,255,255,0.8)'

    switch (currentBubbleType) {
      case 'foule':
        bubbleStyle = {
          background: 'rgba(240,167,66,0.92)', borderRadius: '12px 12px 2px 12px', padding: pad,
          boxShadow: '0 2px 16px rgba(0,0,0,0.6)', fontFamily: '"Courier New", monospace',
          fontSize: `${Math.max(8, scaledTextFontSize - 1)}px`, fontWeight: 700, color: '#1a0a00',
          lineHeight: 1.4, textAlign: 'center', letterSpacing: '0.03em',
        }
        flexDir = 'row-reverse'; portraitBorder = 'rgba(240,167,66,0.9)'
        break
      case 'pensee':
        bubbleStyle = {
          background: 'rgba(200,228,255,0.88)', borderRadius: '20px', padding: pad,
          boxShadow: '0 2px 16px rgba(0,0,0,0.4)', border: '3px dotted rgba(100,170,255,0.65)',
          fontFamily: 'Georgia, serif', fontSize: `${scaledTextFontSize}px`, fontStyle: 'italic',
          color: '#1a304e', lineHeight: 1.55, textAlign: 'left',
        }
        portraitBorder = 'rgba(100,170,255,0.8)'
        break
      case 'discussion':
        bubbleStyle = {
          background: 'rgba(128,210,168,0.90)', borderRadius: '16px', padding: pad,
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)', border: '2px solid rgba(90,185,135,0.5)',
          fontFamily: 'Georgia, serif', fontSize: `${scaledTextFontSize}px`,
          color: '#0a281a', lineHeight: 1.5, textAlign: 'left',
        }
        portraitBorder = 'rgba(90,185,135,0.8)'
        break
      case 'radio':
        bubbleStyle = {
          background: 'rgba(0,14,8,0.96)', borderRadius: '6px', padding: pad,
          boxShadow: '0 2px 16px rgba(0,0,0,0.85)', border: '2px solid rgba(0,210,90,0.45)',
          fontFamily: '"Courier New", monospace', fontSize: `${Math.max(8, scaledTextFontSize - 1)}px`,
          color: '#00ee78', lineHeight: 1.5, letterSpacing: '0.04em',
          textShadow: '0 0 8px rgba(0,240,100,0.55)',
        }
        portraitBorder = 'rgba(0,200,90,0.7)'
        break
      case 'bruit': {
        const bruitSize = Math.round(CW * 0.18)
        return (
          <div style={{ position: 'absolute', left: `${bx}%`, top: `${by}%`, transform: 'translate(-50%,-50%)', zIndex: 24, pointerEvents: 'none', textAlign: 'center' }}>
            <span style={{
              display: 'inline-block',
              fontFamily: '"Impact", "Arial Black", sans-serif',
              fontSize: `${bruitSize}px`,
              fontWeight: 900,
              color: '#fff',
              textShadow: '0 0 8px #e03030, 0 0 24px #e03030, -3px -3px 0 #c00, 3px -3px 0 #c00, -3px 3px 0 #c00, 3px 3px 0 #c00',
              letterSpacing: '-0.02em',
              lineHeight: 1,
              textTransform: 'uppercase',
              animation: 'simBubbleThoughtAppear 0.15s ease both',
              filter: 'drop-shadow(0 4px 16px rgba(200,0,0,0.8))',
            }}>
              {currentSentenceChunks.map(c => c.text).join(' ')}
            </span>
          </div>
        )
      }
      default: // 'discours'
        bubbleStyle = {
          background: 'rgba(255,255,255,0.95)', borderRadius: '12px 12px 12px 2px', padding: pad,
          boxShadow: '0 2px 16px rgba(0,0,0,0.5)',
          fontFamily: 'Georgia, serif', fontSize: `${discoursFontSize}px`,
          color: '#111', lineHeight: 1.5, textAlign: 'left',
        }
        break
    }

    return (
      <div style={{
        position: 'absolute', left: `${bx}%`, top: `${by}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: 24, pointerEvents: 'none', width: `${bubbleW}px`,
        display: 'flex', alignItems: 'flex-end', gap: `${Math.round(CW * 0.02)}px`,
        flexDirection: flexDir,
      }}>
        {speakerNpc?.portrait_url && (
          <img src={speakerNpc.portrait_url} alt={speakerNpc.name ?? ''} style={{ width: portraitSize, height: portraitSize, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${portraitBorder}`, boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }} />
        )}
        <div style={{ ...bubbleStyle, flex: 1, textAlign: currentBubbleType === 'foule' ? 'center' : sentenceAlign }}>
          {renderWords(currentSentenceChunks, currentSentenceStart, olderWordCount, true)}
        </div>
      </div>
    )
  }

  // ── Render principal ─────────────────────────────────────────────────────
  if (visibleChunks.length === 0) return null

  const tp = textPosition ?? { x: 50, y: 50 }
  const pStyle: React.CSSProperties = {
    margin: 0, fontFamily: 'Georgia, serif', fontSize: `${normalFontSize}px`,
    lineHeight: 1.7, color: '#f0ece4',
    textShadow: '0 2px 20px rgba(0,0,0,1), 0 0 40px rgba(0,0,0,0.9)',
    pointerEvents: 'none',
  }

  return (
    <>
      {/* Fond semi-opaque sous narration (absent pour bulles) */}
      {!currentSpeaker && showNarrativeBackground && (
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 40% at 50% 50%, rgba(0,0,0,0.55) 0%, transparent 100%)', pointerEvents: 'none' }} />
      )}

      {currentSpeaker ? renderBubble() : (
        <div style={{ position: 'absolute', left: `${tp.x}%`, top: `${tp.y}%`, transform: 'translate(-50%, -50%)', width: `${Math.round(CW * 0.82)}px`, pointerEvents: 'none' }}>
          <p style={{ ...pStyle, textAlign: sentenceAlign, minHeight: `${LH}px` }}>
            {renderWords(currentSentenceChunks, currentSentenceStart, olderWordCount)}
          </p>
        </div>
      )}
    </>
  )
}
