'use client'
/**
 * Page POC de l'IA co-auteur (Couche 3 conversationnelle).
 * URL : http://localhost:3000/editor-test/ai-author
 *
 * Toggle provider Gemini Flash (cloud gratuit) / Ollama local (self-host).
 * Crée des PNJ via conversation naturelle.
 */

import React, { useRef, useState, useEffect } from 'react'
import type { Message, ToolCall } from '@/lib/author-ai/types'
import type { CreatedNpc } from '@/lib/author-ai/tools'

const PROVIDERS = [
  { id: 'gemini-flash',                    label: 'Gemini 2.5 Flash',       icon: '☁️', hint: 'Cloud Google, gratuit 1500 req/jour' },
  { id: 'ollama:qwen2.5:7b-instruct',      label: 'Qwen 2.5 7B',            icon: '💻', hint: 'Local — meilleur function calling 7B' },
  { id: 'ollama:llama3.1:8b-instruct-q4_K_M', label: 'Llama 3.1 8B',        icon: '💻', hint: 'Local — Meta, bien supporté' },
  { id: 'ollama:mistral:7b-instruct',      label: 'Mistral 7B',             icon: '💻', hint: 'Local — français natif' },
]

interface UiMessage {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  provider?: string
  timeMs?: number
}

export default function AiAuthorPage() {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [npcs, setNpcs] = useState<CreatedNpc[]>([])
  const [input, setInput] = useState('')
  const [providerId, setProviderId] = useState(PROVIDERS[0].id)
  const [loading, setLoading] = useState(false)
  const [pendingText, setPendingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll sur nouveaux messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pendingText])

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: UiMessage = { role: 'user', content: text }
    const nextUi = [...messages, userMsg]
    setMessages(nextUi)
    setInput('')
    setLoading(true)
    setPendingText('')
    setError(null)

    const startTime = Date.now()

    // Convert UI messages to API format (toolCalls included for assistant)
    const apiMessages: Message[] = nextUi.map(m => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
    }))

    try {
      const res = await fetch('/api/author-ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, providerId, existingNpcs: npcs }),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`HTTP ${res.status} — ${errText}`)
      }
      if (!res.body) throw new Error('Pas de body de réponse')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulatedText = ''
      const accumulatedToolCalls: ToolCall[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const ev of events) {
          if (!ev.startsWith('data: ')) continue
          let data: any
          try { data = JSON.parse(ev.slice(6)) } catch { continue }

          if (data.type === 'text') {
            accumulatedText += data.delta
            setPendingText(accumulatedText)
          } else if (data.type === 'tool_call') {
            accumulatedToolCalls.push(data.toolCall)
          } else if (data.type === 'tool_result') {
            // no-op — les NPCs arrivent via session_npcs
          } else if (data.type === 'session_npcs') {
            setNpcs(data.npcs)
          } else if (data.type === 'error') {
            setError(data.message)
          }
        }
      }

      const elapsed = Date.now() - startTime
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: accumulatedText,
        toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        provider: providerId,
        timeMs: elapsed,
      }])
      setPendingText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  function resetConversation() {
    if (messages.length > 0 && !confirm('Effacer la conversation et les PNJ créés ?')) return
    setMessages([])
    setNpcs([])
    setPendingText('')
    setError(null)
  }

  const currentProvider = PROVIDERS.find(p => p.id === providerId) ?? PROVIDERS[0]

  return (
    <div style={pageStyle}>
      {/* Header */}
      <header style={headerStyle}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 2 }}>
            IA co-auteur — POC
          </h1>
          <div style={{ fontSize: 12, color: '#9898b4' }}>
            Crée des PNJ via conversation. Compare Gemini (cloud) et Ollama (local).
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={providerId}
            onChange={e => setProviderId(e.target.value)}
            disabled={loading}
            style={providerSelect}
            title={currentProvider.hint}
          >
            {PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
            ))}
          </select>
          <button onClick={resetConversation} style={resetBtn} title="Nouvelle conversation">
            ↻
          </button>
        </div>
      </header>

      {/* Hint provider */}
      <div style={{ padding: '4px 16px', fontSize: 11, color: '#6e6e85', fontStyle: 'italic' }}>
        {currentProvider.hint}
      </div>

      {error && (
        <div style={errorBanner}>
          <strong>Erreur :</strong> {error}
        </div>
      )}

      {/* Main area : chat + NPCs panel */}
      <main style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12, flex: 1, minHeight: 0, padding: 12 }}>
        {/* Chat */}
        <div style={chatColumn}>
          <div ref={scrollRef} style={chatScroll}>
            {messages.length === 0 && !pendingText && (
              <div style={emptyState}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>💬</div>
                <div style={{ fontSize: 14, color: '#9898b4', maxWidth: 480 }}>
                  Présente ton idée de livre. L&apos;IA va te poser des questions pour créer les PNJ de ton gang, de tes ennemis, des passants importants…
                  <br /><br />
                  <strong style={{ color: '#d4a84c' }}>Exemple d&apos;amorce</strong> : « Je fais un livre-jeu dans le Bronx des années 2000, autour d&apos;un gang de 5 personnes. Le héros s&apos;appelle Travis. »
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}

            {pendingText && (
              <MessageBubble message={{ role: 'assistant', content: pendingText }} streaming />
            )}

            {loading && !pendingText && (
              <div style={{ color: '#9898b4', fontSize: 13, fontStyle: 'italic', padding: '8px 12px' }}>
                L&apos;IA réfléchit…
              </div>
            )}
          </div>

          {/* Input */}
          <div style={inputArea}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendMessage()
                }
              }}
              placeholder="Écris ton message… (Enter pour envoyer, Shift+Enter pour saut de ligne)"
              disabled={loading}
              style={inputStyle}
              rows={2}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim()}
              style={{ ...sendBtn, opacity: loading || !input.trim() ? 0.5 : 1 }}
            >
              {loading ? '…' : 'Envoyer'}
            </button>
          </div>
        </div>

        {/* NPCs panel */}
        <aside style={npcsPanel}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
            PNJ créés ({npcs.length})
          </div>
          {npcs.length === 0 ? (
            <div style={{ color: '#6e6e85', fontSize: 12, fontStyle: 'italic' }}>
              Aucun PNJ pour l&apos;instant. L&apos;IA en ajoutera au fur et à mesure de la conversation.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {npcs.map(npc => (
                <div key={npc.id} style={npcCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{npc.name}</span>
                    <span style={npcTypeBadge(npc.type)}>{npc.type}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#9898b4', lineHeight: 1.4 }}>
                    {npc.description}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function MessageBubble({ message, streaming }: { message: UiMessage; streaming?: boolean }) {
  const isUser = message.role === 'user'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
      <div style={{
        maxWidth: '85%',
        padding: '8px 12px',
        background: isUser ? '#EC4899' : '#1a1a1e',
        color: isUser ? 'white' : '#ede9df',
        borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        border: isUser ? 'none' : '1px solid #2a2a30',
        fontSize: 13,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {message.content}
        {streaming && <span style={{ opacity: 0.5, marginLeft: 4 }}>▊</span>}
      </div>
      {message.toolCalls && message.toolCalls.map(tc => (
        <div key={tc.id} style={{
          marginTop: 4,
          padding: '4px 8px',
          background: 'rgba(212, 168, 76, 0.1)',
          border: '1px solid rgba(212, 168, 76, 0.3)',
          borderRadius: 4,
          fontSize: 11,
          color: '#d4a84c',
          fontFamily: 'monospace',
        }}>
          🔧 {tc.name}({Object.entries(tc.args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})
        </div>
      ))}
      {(message.provider || message.timeMs) && !isUser && (
        <div style={{ fontSize: 10, color: '#6e6e85', marginTop: 2 }}>
          {message.provider?.replace('ollama:', '').replace('-flash', ' Flash')}
          {message.timeMs && ` · ${(message.timeMs / 1000).toFixed(1)}s`}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: '#0d0d0d',
  color: '#ede9df',
  fontFamily: 'Inter, -apple-system, sans-serif',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 16px 4px',
  borderBottom: '1px solid #1a1a1e',
}

const providerSelect: React.CSSProperties = {
  padding: '6px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 6,
  color: '#ede9df',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const resetBtn: React.CSSProperties = {
  width: 32, height: 32,
  padding: 0,
  background: 'transparent',
  border: '1px solid #2a2a30',
  borderRadius: 6,
  color: '#9898b4',
  fontSize: 16,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const errorBanner: React.CSSProperties = {
  margin: '8px 16px',
  padding: '8px 12px',
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  borderRadius: 4,
  color: '#ef4444',
  fontSize: 13,
}

const chatColumn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: '#0f0f13',
  border: '1px solid #1a1a1e',
  borderRadius: 8,
  overflow: 'hidden',
  minHeight: 0,
}

const chatScroll: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 16,
}

const emptyState: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  textAlign: 'center',
  padding: 32,
}

const inputArea: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: 12,
  borderTop: '1px solid #1a1a1e',
  background: '#0d0d0d',
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 6,
  color: '#ede9df',
  fontSize: 13,
  fontFamily: 'inherit',
  resize: 'none',
  outline: 'none',
}

const sendBtn: React.CSSProperties = {
  padding: '0 20px',
  background: '#EC4899',
  border: 'none',
  borderRadius: 6,
  color: 'white',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const npcsPanel: React.CSSProperties = {
  background: '#0f0f13',
  border: '1px solid #1a1a1e',
  borderRadius: 8,
  padding: 12,
  overflowY: 'auto',
}

const npcCard: React.CSSProperties = {
  padding: 10,
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 6,
}

function npcTypeBadge(type: 'ally' | 'enemy' | 'neutral'): React.CSSProperties {
  const colors = {
    ally:    { bg: 'rgba(16, 185, 129, 0.2)', fg: '#10B981' },
    enemy:   { bg: 'rgba(239, 68, 68, 0.2)',  fg: '#ef4444' },
    neutral: { bg: 'rgba(156, 163, 175, 0.2)', fg: '#9ca3af' },
  }[type]
  return {
    padding: '1px 6px',
    background: colors.bg,
    color: colors.fg,
    fontSize: 10,
    fontWeight: 600,
    borderRadius: 3,
    textTransform: 'uppercase',
    letterSpacing: '.05em',
  }
}
