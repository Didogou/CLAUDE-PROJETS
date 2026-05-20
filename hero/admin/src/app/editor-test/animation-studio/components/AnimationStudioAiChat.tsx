'use client'
/**
 * AnimationStudioAiChat — slide panel chat IA conversationnel (refonte 2026-05-11).
 *
 * Remplace l'ancienne palette modal one-shot par un vrai chat multi-turn :
 *   1. Ctrl+K ouvre un slide panel depuis la gauche (~440px)
 *   2. À l'ouverture, l'IA envoie une "card de contexte" (persos + scène)
 *      avec un bouton Confirmer
 *   3. L'auteur confirme puis tape sa scène
 *   4. L'IA propose les shots un par un, l'auteur Accepte (= patch direct
 *      pellicule), Affine (= relance Mistral sur ce shot) ou Rejette
 *   5. L'historique du chat persiste pour toute la session studio
 *
 * State : managé en haut (AnimationStudioInner) pour persistance pendant
 * que le panel est fermé. Communique via props messages + onMessagesChange.
 *
 * Backend : POST /api/ai/chat avec action='open'|'user_message'|'refine_shot'.
 */

import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Loader2, X, Send, Check, RefreshCw, XCircle, Mic, AlertTriangle } from 'lucide-react'
import '../animation-studio-chat.css'
import type {
  ChatMessage,
  ChatMessageAssistantContextCard,
  ChatMessageAssistantShotProposal,
  ChatRequest,
  ChatResponse,
  ChatShotProposal,
} from '@/lib/ai-chat-types'
import { newMessageId } from '@/lib/ai-chat-types'
import type { AiPaletteContext } from './AnimationStudioAiPalette'
import type { Character } from '@/lib/character-store'
// Réutilise le CSS du ConfirmDialog du studio-section pour le ShotApplyTargetModal
import '@/components/studio-section/studio-section.css'

interface AnimationStudioAiChatProps {
  open: boolean
  onClose: () => void
  context: AiPaletteContext | null
  imageDescription?: string
  charactersDescription?: string
  qwenStatus?: 'idle' | 'loading' | 'ready' | 'failed'
  /** Historique de la conversation — vit dans AnimationStudioInner pour
   *  persister à travers les ouvertures/fermetures du panel. */
  messages: ChatMessage[]
  onMessagesChange: (next: ChatMessage[]) => void
  /** Appelé quand l'auteur clique "Accepter" sur un shot — applique le shot
   *  proposé directement sur la pellicule (pas de batch final). */
  onApplyShot: (shot: ChatShotProposal) => void
  /** Persos du store (avec portraitUrl) — utilisés pour afficher le bandeau
   *  vignettes persistant en haut du panel. Refonte 2026-05-11. */
  characters?: Character[]
  /** URL de l'image / 1ère frame de la pellicule active à animer. Affichée en
   *  vignette dans la card de contexte pour que l'auteur visualise ce qu'il
   *  va animer. Refonte 2026-05-11. */
  sceneImageUrl?: string | null
  /** True si la pellicule active a déjà une vidéo générée — pour adapter le
   *  label du bouton "Appliquer et Générer" → "Appliquer et Régénérer". */
  pelliculeHasVideo?: boolean
  /** Callback pour lancer la gen LTX (= clic Régénérer la pellicule).
   *  Appelé après confirmation de la modal "Appliquer et Générer". */
  onGenerate?: () => void
}

export default function AnimationStudioAiChat({
  open, onClose, context, imageDescription, charactersDescription, qwenStatus,
  messages, onMessagesChange, onApplyShot, characters, sceneImageUrl,
  pelliculeHasVideo, onGenerate,
}: AnimationStudioAiChatProps) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [refiningShotId, setRefiningShotId] = useState<string | null>(null)
  const [refineInput, setRefineInput] = useState('')
  /** Modale "Appliquer ce shot" — gère choix cible (Remplacer X / Ajouter)
   *  + option Générer en plus. null = fermée. Refonte 2026-05-11. */
  const [applyModalState, setApplyModalState] = useState<{ shotMsg: ChatMessageAssistantShotProposal; withGenerate: boolean } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll vers le bas quand un nouveau message arrive
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  // Focus input à l'ouverture
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  // Esc pour fermer
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  // Au 1er affichage avec un context valide, déclenche action='open' pour
  // récupérer la context_card initiale. On évite si messages déjà non-vide
  // (= chat déjà démarré dans une session précédente du panel).
  useEffect(() => {
    if (!open || !context || messages.length > 0) return
    void callChat('open')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context])

  /** Appel backend /api/ai/chat avec l'action + historique courant. */
  async function callChat(action: ChatRequest['action'], extraMessage?: ChatMessage, refineShotMessageId?: string) {
    if (!context) return
    setBusy(true)
    const historyToSend = extraMessage ? [...messages, extraMessage] : messages
    if (extraMessage) onMessagesChange(historyToSend)
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: historyToSend,
          pelliculeContext: context,
          imageDescription,
          charactersDescription,
          action,
          refineShotMessageId,
        } satisfies ChatRequest),
      })
      const data = await res.json() as ChatResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      onMessagesChange([...historyToSend, ...data.newMessages])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onMessagesChange([
        ...historyToSend,
        {
          id: newMessageId(),
          role: 'system',
          level: 'error',
          content: `Erreur IA : ${msg}`,
          ts: Date.now(),
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  /** Submit du message tapé par l'auteur dans la zone input principale. */
  function handleSendMessage() {
    if (!input.trim() || busy || !context) return
    const userMsg: ChatMessage = {
      id: newMessageId(),
      role: 'user',
      content: input.trim(),
      ts: Date.now(),
    }
    setInput('')
    void callChat('user_message', userMsg)
  }

  /** Submit du raffinage d'un shot (apparait inline sous le shot proposal). */
  function handleSendRefine(shotMessageId: string) {
    if (!refineInput.trim() || busy || !context) return
    const userMsg: ChatMessage = {
      id: newMessageId(),
      role: 'user',
      content: `Affiner le shot : ${refineInput.trim()}`,
      ts: Date.now(),
    }
    // Marque le shot proposal en mode 'refining' AVANT le call
    const updatedMessages = messages.map(m => {
      if (m.id === shotMessageId && m.role === 'assistant' && m.kind === 'shot_proposal') {
        return { ...m, status: 'refining' as const }
      }
      return m
    })
    onMessagesChange(updatedMessages)
    setRefineInput('')
    setRefiningShotId(null)
    void callChat('refine_shot', userMsg, shotMessageId)
  }

  /** Click Accepter sur un shot proposal.
   *
   *  Refonte 2026-05-11 — si la pellicule a déjà ≥1 shot existant, on ouvre
   *  une modale qui demande le choix de cible (Remplacer shot X / Ajouter
   *  comme nouveau shot). Sinon (pellicule vide), patch direct sans modale.
   *
   *  Le param `withGenerate` est passé à true quand l'auteur a cliqué
   *  "Appliquer et Générer/Régénérer" → la modale lance ensuite la gen LTX. */
  function handleAcceptShot(msg: ChatMessageAssistantShotProposal, withGenerate = false) {
    const existingShots = context?.pelliculeShots ?? []
    if (existingShots.length === 0 && !withGenerate) {
      // Pellicule vide + pas de gen → patch direct sans modale
      applyShotWithIndex(msg, msg.shot.shotIndex)
    } else {
      // Sinon → modale de choix
      setApplyModalState({ shotMsg: msg, withGenerate })
    }
  }

  /** Patch effectif après confirmation modale (ou directement si pellicule vide). */
  function applyShotWithIndex(msg: ChatMessageAssistantShotProposal, targetIndex: number, withGenerate = false) {
    // Override le shotIndex pour appliquer sur la cible choisie par l'auteur
    const adjustedShot: ChatShotProposal = { ...msg.shot, shotIndex: targetIndex }
    onApplyShot(adjustedShot)
    onMessagesChange(messages.map(m =>
      m.id === msg.id && m.role === 'assistant' && m.kind === 'shot_proposal'
        ? { ...m, status: 'accepted' as const }
        : m,
    ))
    if (withGenerate && onGenerate) {
      // Petit délai pour que le state pellicule ait le temps de se mettre à jour
      // avant le déclenchement gen (race protection vs React batching).
      setTimeout(() => onGenerate(), 50)
    }
  }

  /** Click Rejeter sur un shot proposal → marque ignoré, pas de patch. */
  function handleRejectShot(msg: ChatMessageAssistantShotProposal) {
    onMessagesChange(messages.map(m =>
      m.id === msg.id && m.role === 'assistant' && m.kind === 'shot_proposal'
        ? { ...m, status: 'rejected' as const }
        : m,
    ))
  }

  /** Click Confirmer sur la context_card initiale. */
  function handleConfirmContext(cardId: string) {
    onMessagesChange(messages.map(m =>
      m.id === cardId && m.role === 'assistant' && m.kind === 'context_card'
        ? { ...m, status: 'confirmed' as const }
        : m,
    ))
    // Envoie un message user implicite pour amorcer Mistral à demander la scène
    const userMsg: ChatMessage = {
      id: newMessageId(),
      role: 'user',
      content: '(Contexte confirmé, j\'attends ton input pour décrire la scène)',
      ts: Date.now(),
    }
    void callChat('user_message', userMsg)
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Convention chat standard (Slack/Discord/ChatGPT) : Enter envoie,
    // Shift+Enter insère une newline. Refonte 2026-05-11.
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <>
    <AnimatePresence initial={false}>
      {open && (
        <React.Fragment key="aichat-root">
          {/* Backdrop semi-transparent (clic = ferme, sauf si busy) */}
          <motion.div
            key="aichat-backdrop"
            className="as-aichat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => { if (!busy) onClose() }}
          />
          {/* Slide panel depuis la gauche */}
          <motion.aside
            key="aichat-panel"
            className="as-aichat-panel"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Chat avec l'IA"
          >
            {/* Header */}
            <header className="as-aichat-header">
              <div className="as-aichat-header-title">
                <Sparkles size={14} className="as-aichat-icon" />
                <span>Chat avec l'IA</span>
                {context && (
                  <span className="as-aichat-header-meta">
                    · {context.charactersInPellicule.length} perso(s)
                  </span>
                )}
              </div>
              <button
                type="button"
                className="as-aichat-close"
                onClick={onClose}
                disabled={busy}
                aria-label="Fermer"
              >
                <X size={14} />
              </button>
            </header>

            {/* Vignette de la scène analysée (refonte 2026-05-15) — persistante
             *  en haut du panel, toujours visible. Confirme à l'auteur QUELLE
             *  image l'IA est en train de regarder (= firstFrameUrl si pellicule
             *  générée, sinon image base du plan). */}
            {sceneImageUrl && (
              <div className="as-aichat-scene-thumb">
                <img src={sceneImageUrl} alt="Image analysée par l'IA" />
                <span className="as-aichat-scene-thumb-label">Image analysée</span>
              </div>
            )}

            {/* Bandeau vignettes persos persistant (refonte 2026-05-11) —
             *  affiché en haut, toujours visible quel que soit le scroll du chat.
             *  Aide l'auteur à garder en tête qui est en scène. */}
            {context && context.charactersInPellicule.length > 0 && (
              <div className="as-aichat-chars-strip">
                {context.charactersInPellicule.map(cInCtx => {
                  const char = characters?.find(c => c.id === cInCtx.id)
                  const portraitUrl = char?.portraitUrl ?? null
                  return (
                    <div key={cInCtx.id} className="as-aichat-strip-char" title={`${cInCtx.name}${cInCtx.position ? ` (${cInCtx.position})` : ''}`}>
                      <div className="as-aichat-strip-avatar">
                        {portraitUrl
                          ? <img src={portraitUrl} alt={cInCtx.name} />
                          : <div className="as-aichat-strip-avatar-fallback">{cInCtx.name.charAt(0)}</div>}
                      </div>
                      <span className="as-aichat-strip-name">{cInCtx.name}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Statut Qwen Vision (badge si pas encore prêt) */}
            {qwenStatus && qwenStatus !== 'idle' && qwenStatus !== 'ready' && (
              <div className={`as-aichat-qwen-status as-aichat-qwen-status-${qwenStatus}`}>
                {qwenStatus === 'loading' && (
                  <>
                    <Loader2 size={11} className="as-aichat-spin" />
                    <span>Vision IA analyse l'image (~5s)…</span>
                  </>
                )}
                {qwenStatus === 'failed' && (
                  <>
                    <AlertTriangle size={11} />
                    <span>Vision IA indispo — Mistral devra deviner les vêtements</span>
                  </>
                )}
              </div>
            )}

            {/* Body : messages */}
            <div className="as-aichat-body" ref={scrollRef}>
              {!context && (
                <div className="as-aichat-empty">
                  Sélectionne une pellicule active pour démarrer le chat.
                </div>
              )}
              {context && messages.length === 0 && busy && (
                <div className="as-aichat-empty">
                  <Loader2 size={14} className="as-aichat-spin" />
                  <span>Préparation du contexte…</span>
                </div>
              )}
              {messages.map(m => {
                if (m.role === 'user') {
                  // Cache les messages systèmes implicites (= ceux entre parenthèses
                  // qu'on injecte pour amorcer Mistral après actions UI). Pas affichés
                  // pour ne pas polluer le chat. Refonte 2026-05-11.
                  if (m.content.startsWith('(') && m.content.endsWith(')')) return null
                  return (
                    <div key={m.id} className="as-aichat-msg as-aichat-msg-user">
                      <div className="as-aichat-bubble">{m.content}</div>
                    </div>
                  )
                }
                if (m.role === 'system') {
                  return (
                    <div key={m.id} className={`as-aichat-system as-aichat-system-${m.level}`}>
                      {m.content}
                    </div>
                  )
                }
                if (m.role === 'assistant' && m.kind === 'text') {
                  return (
                    <div key={m.id} className="as-aichat-msg as-aichat-msg-ai">
                      <div className="as-aichat-bubble">{m.content}</div>
                    </div>
                  )
                }
                if (m.role === 'assistant' && m.kind === 'context_card') {
                  return <ContextCardMessage key={m.id} msg={m} sceneImageUrl={sceneImageUrl ?? null} onConfirm={() => handleConfirmContext(m.id)} busy={busy} />
                }
                if (m.role === 'assistant' && m.kind === 'shot_proposal' && context) {
                  // Calcule si ce shot est le DERNIER shot_proposal de la conversation.
                  // Si oui, on affiche le bouton "Appliquer et Générer" en plus.
                  const allShotIds = messages
                    .filter(x => x.role === 'assistant' && x.kind === 'shot_proposal')
                    .map(x => x.id)
                  const isLastShot = allShotIds[allShotIds.length - 1] === m.id
                  return (
                    <ShotProposalMessage
                      key={m.id}
                      msg={m}
                      context={context}
                      busy={busy}
                      isRefining={refiningShotId === m.id}
                      refineInput={refineInput}
                      onRefineInputChange={setRefineInput}
                      onAccept={() => handleAcceptShot(m, false)}
                      onReject={() => handleRejectShot(m)}
                      onStartRefine={() => { setRefiningShotId(m.id); setRefineInput('') }}
                      onCancelRefine={() => { setRefiningShotId(null); setRefineInput('') }}
                      onSendRefine={() => handleSendRefine(m.id)}
                      isLastShot={isLastShot}
                      pelliculeHasVideo={!!pelliculeHasVideo}
                      onApplyAndGenerate={onGenerate ? () => handleAcceptShot(m, true) : undefined}
                    />
                  )
                }
                return null
              })}
              {busy && messages.length > 0 && (
                <div className="as-aichat-typing">
                  <Loader2 size={11} className="as-aichat-spin" />
                  <span>L'IA réfléchit…</span>
                </div>
              )}
            </div>

            {/* Footer : input message principal */}
            <div className="as-aichat-footer">
              <textarea
                ref={inputRef}
                className="as-aichat-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={
                  context
                    ? 'Décris la scène… (Enter pour envoyer, Shift+Enter pour nouvelle ligne)'
                    : 'Sélectionne une pellicule active'
                }
                rows={2}
                disabled={busy || !context}
              />
              <button
                type="button"
                className="as-aichat-send"
                onClick={handleSendMessage}
                disabled={busy || !context || !input.trim()}
                title="Envoyer (Enter)"
              >
                {busy ? <Loader2 size={14} className="as-aichat-spin" /> : <Send size={14} />}
              </button>
            </div>
          </motion.aside>
        </React.Fragment>
      )}
    </AnimatePresence>
    {/* Modale unifiée : choix cible (Replace/Add) + option Générer.
     *  Sortie de l'AnimatePresence pour ne pas créer de conflit de keys
     *  (la modale n'a pas d'animation framer-motion, elle peut vivre seule). */}
    {applyModalState && context && (
      <ShotApplyTargetModal
        shotMsg={applyModalState.shotMsg}
        withGenerate={applyModalState.withGenerate}
        existingShotsCount={context.pelliculeShots.length}
        pelliculeHasVideo={!!pelliculeHasVideo}
        onConfirm={(targetIndex, generate) => {
          const msg = applyModalState.shotMsg
          setApplyModalState(null)
          applyShotWithIndex(msg, targetIndex, generate)
        }}
        onCancel={() => setApplyModalState(null)}
      />
    )}
    </>
  )
}

// ─── Sous-composants : ContextCard et ShotProposal ────────────────────────

function ContextCardMessage({
  msg, sceneImageUrl, onConfirm, busy,
}: { msg: ChatMessageAssistantContextCard; sceneImageUrl: string | null; onConfirm: () => void; busy: boolean }) {
  // Refonte 2026-05-11 : la card de contexte est simplifiée à l'extrême.
  //  - Pas de description EN du décor (déjà dans le state pellicule)
  //  - Pas de liste persos (déjà dans le strip d'avatars en haut du panel)
  //  - Vignette grande de la scène à animer
  //  - Bouton Confirmer pour démarrer
  return (
    <div className="as-aichat-msg as-aichat-msg-ai">
      <div className="as-aichat-context-card">
        <p className="as-aichat-context-intro">{msg.intro}</p>
        {sceneImageUrl && (
          <div className="as-aichat-context-thumb">
            <img src={sceneImageUrl} alt="Scène à animer" />
          </div>
        )}
        {msg.status === 'pending' ? (
          <button type="button" className="as-aichat-confirm-btn" onClick={onConfirm} disabled={busy}>
            <Check size={12} /> Confirmer le contexte
          </button>
        ) : (
          <div className="as-aichat-confirmed-badge"><Check size={11} /> Contexte confirmé</div>
        )}
      </div>
    </div>
  )
}

function ShotProposalMessage({
  msg, context, busy, isRefining, refineInput, onRefineInputChange,
  onAccept, onReject, onStartRefine, onCancelRefine, onSendRefine,
  isLastShot, pelliculeHasVideo, onApplyAndGenerate,
}: {
  msg: ChatMessageAssistantShotProposal
  context: AiPaletteContext
  busy: boolean
  isRefining: boolean
  refineInput: string
  onRefineInputChange: (v: string) => void
  onAccept: () => void
  onReject: () => void
  onStartRefine: () => void
  onCancelRefine: () => void
  onSendRefine: () => void
  /** Si true et status pending, affiche en plus le bouton "Appliquer et Générer/Régénérer". */
  isLastShot: boolean
  /** Pellicule a déjà une vidéo générée → label "Régénérer", sinon "Générer". */
  pelliculeHasVideo: boolean
  /** Callback pour ouvrir la modale Appliquer + Gen. Si undefined, le bouton n'apparaît pas. */
  onApplyAndGenerate?: () => void
}) {
  const charNameById = new Map<string, string>([
    ...context.charactersInPellicule.map(c => [c.id, c.name] as const),
    ...context.bookCharacters.map(c => [c.id, c.name] as const),
  ])
  const charsInShot = Object.keys(msg.shot.perCharacter)

  const statusBadge = msg.status === 'accepted' ? <span className="as-aichat-shot-status accepted"><Check size={11} /> Appliqué</span>
    : msg.status === 'rejected' ? <span className="as-aichat-shot-status rejected"><XCircle size={11} /> Ignoré</span>
    : msg.status === 'refining' ? <span className="as-aichat-shot-status refining"><Loader2 size={11} className="as-aichat-spin" /> Affinage…</span>
    : null

  return (
    <div className="as-aichat-msg as-aichat-msg-ai">
      <div className={`as-aichat-shot-card status-${msg.status}`}>
        <header className="as-aichat-shot-header">
          <strong>{msg.intro}</strong>
          {statusBadge}
        </header>
        <div className="as-aichat-shot-meta">
          <span>⏱ {msg.shot.suggestedDurationSec}s</span>
          {msg.shot.speakerId && (
            <span>🎙 {charNameById.get(msg.shot.speakerId) ?? msg.shot.speakerId}</span>
          )}
        </div>
        {/* Refonte 2026-05-16 — affiche le sceneAction (= vrai prompt LTX en
         *  MODE SCÈNE, et complément descriptif en MODE MIXTE). Sans ça l'auteur
         *  acceptait à l'aveugle, surtout en mode scène sans perso. */}
        {msg.shot.sceneAction && (
          <div className="as-aichat-shot-scene">
            <span className="as-aichat-shot-scene-label">Scène :</span>{' '}
            <span className="as-aichat-shot-scene-text">{msg.shot.sceneAction}</span>
          </div>
        )}
        {charsInShot.length > 0 && (
          <ul className="as-aichat-shot-actions">
            {charsInShot.map(cid => {
              const data = msg.shot.perCharacter[cid]
              return (
                <li key={cid}>
                  <strong>{charNameById.get(cid) ?? cid} :</strong> {data.action}
                  {data.dialogue && <em className="as-aichat-shot-dialogue"> &quot;{data.dialogue}&quot;</em>}
                </li>
              )
            })}
          </ul>
        )}
        {/* Boutons d'action si pending */}
        {msg.status === 'pending' && !isRefining && (
          <div className="as-aichat-shot-buttons">
            <button type="button" className="as-aichat-shot-btn accept" onClick={onAccept} disabled={busy}>
              <Check size={12} /> Accepter
            </button>
            {/* Bouton "Appliquer et Générer/Régénérer" — affiché UNIQUEMENT
             *  sur le dernier shot pending. Refonte 2026-05-11. */}
            {isLastShot && onApplyAndGenerate && (
              <button type="button" className="as-aichat-shot-btn accept-gen" onClick={onApplyAndGenerate} disabled={busy}>
                <Check size={12} /> Appliquer + {pelliculeHasVideo ? 'Régénérer' : 'Générer'}
              </button>
            )}
            <button type="button" className="as-aichat-shot-btn refine" onClick={onStartRefine} disabled={busy}>
              <RefreshCw size={12} /> Affiner
            </button>
            <button type="button" className="as-aichat-shot-btn reject" onClick={onReject} disabled={busy}>
              <XCircle size={12} /> Rejeter
            </button>
          </div>
        )}
        {/* Inline refine input */}
        {isRefining && (
          <div className="as-aichat-refine-row">
            <textarea
              className="as-aichat-refine-input"
              value={refineInput}
              onChange={e => onRefineInputChange(e.target.value)}
              onKeyDown={e => {
                // Enter envoie, Shift+Enter newline (cohérent avec input principal)
                if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                  e.preventDefault()
                  if (refineInput.trim() && !busy) onSendRefine()
                }
              }}
              placeholder="Que changer dans ce shot ? (ex: rends-le plus rapide, ajoute un dialogue…)"
              rows={2}
              autoFocus
            />
            <div className="as-aichat-refine-buttons">
              <button type="button" className="as-aichat-shot-btn" onClick={onCancelRefine} disabled={busy}>
                Annuler
              </button>
              <button type="button" className="as-aichat-shot-btn refine" onClick={onSendRefine} disabled={busy || !refineInput.trim()}>
                <Send size={12} /> Envoyer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Modale unifiée : choix cible (Replace shot X / Add) + option Générer ──

function ShotApplyTargetModal({
  shotMsg, withGenerate, existingShotsCount, pelliculeHasVideo, onConfirm, onCancel,
}: {
  shotMsg: ChatMessageAssistantShotProposal
  withGenerate: boolean
  existingShotsCount: number
  pelliculeHasVideo: boolean
  onConfirm: (targetIndex: number, generate: boolean) => void
  onCancel: () => void
}) {
  const mistralProposedIndex = shotMsg.shot.shotIndex
  const cap = 2
  const canAdd = existingShotsCount < cap
  const initialTarget = mistralProposedIndex < existingShotsCount
    ? mistralProposedIndex
    : (canAdd ? existingShotsCount : Math.max(0, existingShotsCount - 1))
  const [targetIndex, setTargetIndex] = useState(initialTarget)
  const [generateAfter, setGenerateAfter] = useState(withGenerate)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const replaceOptions: { idx: number; label: string }[] = []
  for (let i = 0; i < existingShotsCount; i++) {
    replaceOptions.push({ idx: i, label: `Remplacer le shot ${i + 1}` })
  }
  const addOption: { idx: number; label: string } | null = canAdd
    ? { idx: existingShotsCount, label: `Ajouter comme shot ${existingShotsCount + 1}` }
    : null

  const isAddTarget = targetIndex === existingShotsCount && canAdd
  const confirmLabel = generateAfter
    ? (pelliculeHasVideo ? 'Appliquer et Régénérer' : 'Appliquer et Générer')
    : 'Appliquer'

  return (
    <div
      className="ss-confirm-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 1200 }}
    >
      <div className="ss-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="ss-confirm-title">Appliquer ce shot</h3>
        <div className="ss-confirm-message">
          <p style={{ marginTop: 0 }}>
            Où appliquer la proposition <strong>« {shotMsg.intro} »</strong> ?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.6rem' }}>
            {replaceOptions.map(opt => (
              <label key={opt.idx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', padding: '0.35rem 0.5rem', border: targetIndex === opt.idx ? '1px solid var(--ie-accent)' : '1px solid var(--ie-border)', borderRadius: '0.35rem' }}>
                <input
                  type="radio"
                  name="apply-target"
                  checked={targetIndex === opt.idx}
                  onChange={() => setTargetIndex(opt.idx)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
            {addOption && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', padding: '0.35rem 0.5rem', border: isAddTarget ? '1px solid var(--ie-accent)' : '1px solid var(--ie-border)', borderRadius: '0.35rem' }}>
                <input
                  type="radio"
                  name="apply-target"
                  checked={isAddTarget}
                  onChange={() => setTargetIndex(addOption.idx)}
                />
                <span>{addOption.label}</span>
              </label>
            )}
          </div>
          {!canAdd && (
            <p style={{ fontSize: '0.7rem', color: 'var(--ie-text-faint)', marginTop: '0.5rem' }}>
              Limite de 2 shots atteinte — uniquement remplacement possible.
            </p>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.7rem', cursor: 'pointer', fontSize: '0.78rem' }}>
            <input
              type="checkbox"
              checked={generateAfter}
              onChange={e => setGenerateAfter(e.target.checked)}
            />
            <span>Lancer la {pelliculeHasVideo ? 'régénération' : 'génération'} vidéo après</span>
          </label>
        </div>
        <div className="ss-confirm-actions">
          <button type="button" className="ss-confirm-btn ss-confirm-btn-cancel" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="ss-confirm-btn ss-confirm-btn-primary" onClick={() => onConfirm(targetIndex, generateAfter)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
