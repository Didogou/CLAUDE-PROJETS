/**
 * ai-chat-types — types partagés client/server pour la conversation IA du
 * Studio Animation (refonte 2026-05-11, phase chat conversationnel).
 *
 * Le pipeline précédent était one-shot : l'auteur tape un prompt → Mistral
 * extrait JSON structuré → preview édit → apply. Cette refonte introduit un
 * vrai chat multi-turn où l'IA pose des questions, propose des shots un par
 * un, et l'auteur peut accepter / affiner / rejeter chaque shot individuellement.
 *
 * État conservé pour toute la session du Studio Animation (= persiste à
 * travers les ouvertures/fermetures du panel Ctrl+K, perdu au refresh page).
 */

import type { AiPaletteContext, AiExtractionShot, AiExtractionScene } from '@/app/editor-test/animation-studio/components/AnimationStudioAiPalette'

// ─── Cards de contexte (1er message AI) ─────────────────────────────────────

/** Représentation d'un perso dans la card de contexte initiale (photo + résumé). */
export interface ChatContextCharacter {
  id: string
  name: string
  portraitUrl: string | null
  description: string | null
  position: 'left' | 'center' | 'right' | null
  hasVoice: boolean
}

// ─── Proposition de shot ────────────────────────────────────────────────────

/** Données d'un shot proposé par l'IA — réutilise la structure existante
 *  AiExtractionShot pour rester compatible avec handleAiApply. */
export interface ChatShotProposal extends AiExtractionShot {
  /** Index dans la pellicule où ce shot sera appliqué. 0 = remplace le shot
   *  actif. 1 = ajoute un nouveau shot. */
  shotIndex: number
}

// ─── Messages de la conversation ────────────────────────────────────────────

export interface ChatMessageBase {
  /** ID local stable (pour key React + ré-référence par l'IA). */
  id: string
  /** Timestamp epoch ms (tri + affichage temporel). */
  ts: number
}

/** Message tapé par l'auteur. */
export interface ChatMessageUser extends ChatMessageBase {
  role: 'user'
  content: string
}

/** Message texte simple de l'IA (questions de clarification, transitions,
 *  confirmations de fin, erreurs gracieuses). */
export interface ChatMessageAssistantText extends ChatMessageBase {
  role: 'assistant'
  kind: 'text'
  content: string
}

/** Card de confirmation de contexte — affiche les persos avec photo +
 *  description et propose un bouton "Confirmer le contexte" pour démarrer
 *  la conversation. Toujours envoyé en 1er par l'IA à l'ouverture du chat. */
export interface ChatMessageAssistantContextCard extends ChatMessageBase {
  role: 'assistant'
  kind: 'context_card'
  /** Petit texte d'intro affiché au-dessus des cards. */
  intro: string
  characters: ChatContextCharacter[]
  /** Le décor effectif de la pellicule (snippet). */
  sceneSummary: string | null
  /** Statut : pending = attend confirmation auteur, confirmed = validé. */
  status: 'pending' | 'confirmed'
}

/** Proposition d'un shot par l'IA. L'auteur peut Accepter (= patch direct
 *  pellicule), Affiner (= renvoie un message de raffinage à l'IA pour ce shot
 *  uniquement), ou Rejeter (= shot ignoré, IA passe au suivant ou attend). */
export interface ChatMessageAssistantShotProposal extends ChatMessageBase {
  role: 'assistant'
  kind: 'shot_proposal'
  /** Petit texte d'intro pour ce shot ("Shot 1 sur 2 : ..."). */
  intro: string
  shot: ChatShotProposal
  /** Statut : pending = attend décision, accepted = patché dans pellicule,
   *  rejected = ignoré, refining = l'auteur tape un message de raffinage. */
  status: 'pending' | 'accepted' | 'rejected' | 'refining'
}

/** Message système : info technique (apply succès, erreur API…). Affiché
 *  discrètement (pas comme un message principal). */
export interface ChatMessageSystem extends ChatMessageBase {
  role: 'system'
  /** info | warning | error pour le styling. */
  level: 'info' | 'warning' | 'error'
  content: string
}

export type ChatMessage =
  | ChatMessageUser
  | ChatMessageAssistantText
  | ChatMessageAssistantContextCard
  | ChatMessageAssistantShotProposal
  | ChatMessageSystem

// ─── API contract ───────────────────────────────────────────────────────────

/** Body POST /api/ai/chat. Envoie l'historique COMPLET de la conversation
 *  (l'API est stateless côté server — le state vit côté client). Mistral
 *  reconstruit le contexte depuis ces messages pour produire une réponse
 *  cohérente. */
export interface ChatRequest {
  /** Historique complet (= tous les messages déjà échangés, dans l'ordre). */
  messages: ChatMessage[]
  /** Contexte pellicule (persos, scène existante, etc.). Identique à celui
   *  qui était passé à l'ancien endpoint extract-shot-prompt. */
  pelliculeContext: AiPaletteContext
  /** Description Qwen Vision de l'image source (mode 'scene'). */
  imageDescription?: string
  /** Description Qwen Vision des persos visibles (mode 'characters', format
   *  Vantage). Source de vérité prioritaire pour les vêtements. */
  charactersDescription?: string
  /** Action contextuelle qui a déclenché ce call :
   *    - 'open' : 1ère ouverture du chat → IA doit envoyer le context_card
   *    - 'user_message' : auteur a envoyé un message texte
   *    - 'refine_shot' : auteur a demandé d'affiner un shot précis (id ref) */
  action: 'open' | 'user_message' | 'refine_shot'
  /** Si action='refine_shot', l'id du message shot_proposal à raffiner. */
  refineShotMessageId?: string
}

/** Réponse de /api/ai/chat. L'API renvoie un OU plusieurs nouveaux messages
 *  à appendre à la conversation côté client (ex : un texte d'intro + un
 *  shot_proposal, ou juste un texte de question, etc.). */
export interface ChatResponse {
  newMessages: ChatMessage[]
  /** Si l'IA estime avoir fini sa proposition, true (pour que le client
   *  désactive le spinner ou montre un état "waiting your input"). */
  done: boolean
}

// ─── Utilitaires ────────────────────────────────────────────────────────────

/** Génère un id de message court mais unique (pas besoin d'UUID full). */
export function newMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Re-export pour réutiliser le type côté backend sans cycle d'import. */
export type { AiPaletteContext, AiExtractionShot, AiExtractionScene }
