'use client'
/**
 * PromptInspector — panel de debug pour visualiser tous les prompts/payloads
 * envoyés aux APIs AI/vidéo/audio de Hero.
 *
 * UX :
 *   - Bouton flottant bottom-right avec badge nb d'entrées
 *   - Click → panel slide-out depuis la droite (full-height)
 *   - Liste de cards : timestamp + endpoint + status + durée
 *   - Click card → expand pour voir le body request + response complets
 *   - Filter par URL substring (ex: "ltx" pour ne voir que les calls LTX)
 *   - Bouton "Tout effacer"
 *
 * Mounté globalement dans le root layout pour être dispo partout (books page,
 * editor-test, animation-studio, etc.). Le bouton trigger est discret pour
 * pas gêner — il prend de la place uniquement quand le panel est ouvert.
 *
 * Refonte 2026-05-10.
 */

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, Trash2, ChevronDown, ChevronRight, Code2, Check, AlertTriangle } from 'lucide-react'
import {
  getEntries,
  subscribe,
  clearAll,
  installFetchInterceptor,
  type PromptLogEntry,
} from '@/lib/prompt-log'

export default function PromptInspector() {
  // Install l'interceptor au mount du composant (idempotent — multiple mounts
  // OK). Côté SSR, le module est no-op donc safe.
  useEffect(() => { installFetchInterceptor() }, [])

  // Snapshot des entries via useSyncExternalStore — re-render au moindre push.
  const entries = useSyncExternalStore(
    subscribe,
    getEntries,
    getEntries,  // server snapshot = idem (vide en pratique)
  )

  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Filtre par URL substring (case-insensitive)
  const filtered = useMemo(() => {
    if (!filter.trim()) return entries
    const q = filter.toLowerCase()
    return entries.filter(e => e.url.toLowerCase().includes(q))
  }, [entries, filter])

  return (
    <>
      {/* ── Bouton flottant ────────────────────────────────────────────── */}
      <button
        type="button"
        className="pi-fab"
        onClick={() => setOpen(o => !o)}
        title={`Prompt Inspector (${entries.length} requêtes captées)`}
        aria-label="Ouvrir le Prompt Inspector"
      >
        <Code2 size={14} />
        {entries.length > 0 && (
          <span className="pi-fab-badge">{entries.length}</span>
        )}
      </button>

      {/* ── Panel slide-out ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop discret pour click-outside-to-close */}
            <motion.div
              className="pi-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              className="pi-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
              role="dialog"
              aria-label="Prompt Inspector"
            >
              <header className="pi-header">
                <Code2 size={14} className="pi-header-icon" />
                <span className="pi-header-title">Prompt Inspector</span>
                <span className="pi-header-count">{filtered.length}/{entries.length}</span>
                <button
                  type="button"
                  className="pi-header-clear"
                  onClick={() => { clearAll(); setExpandedId(null) }}
                  title="Tout effacer"
                  aria-label="Tout effacer"
                  disabled={entries.length === 0}
                >
                  <Trash2 size={12} />
                </button>
                <button
                  type="button"
                  className="pi-header-close"
                  onClick={() => setOpen(false)}
                  aria-label="Fermer"
                >
                  <X size={14} />
                </button>
              </header>

              <div className="pi-search">
                <Search size={11} className="pi-search-icon" />
                <input
                  type="search"
                  placeholder="Filtrer par URL (ex: ltx, mistral, qwen…)"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>

              <div className="pi-list">
                {filtered.length === 0 ? (
                  <div className="pi-empty">
                    {entries.length === 0
                      ? 'Aucune requête captée pour l\'instant. Lance une génération AI / LTX / TTS pour les voir apparaître.'
                      : 'Aucune requête ne matche ton filtre.'}
                  </div>
                ) : (
                  filtered.map(entry => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      expanded={expandedId === entry.id}
                      onToggleExpand={() => setExpandedId(prev => prev === entry.id ? null : entry.id)}
                    />
                  ))
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

// ── Card d'une entrée ──────────────────────────────────────────────────────

function EntryCard({
  entry, expanded, onToggleExpand,
}: {
  entry: PromptLogEntry
  expanded: boolean
  onToggleExpand: () => void
}) {
  const time = new Date(entry.timestamp)
  const timeStr = time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  // Trim URL pour affichage : retire l'origin + les query params longs
  const shortUrl = entry.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
  const isOk = entry.status !== undefined && entry.status >= 200 && entry.status < 300
  const isErr = entry.error !== undefined || (entry.status !== undefined && entry.status >= 400)
  // Extrait un résumé du prompt depuis le body si applicable — visible
  // direct dans le header sans expand (refonte 2026-05-12).
  const promptSummary = extractPromptSummary(entry.body)

  return (
    <div className={`pi-entry ${expanded ? 'expanded' : ''} ${isErr ? 'err' : isOk ? 'ok' : ''}`}>
      <button
        type="button"
        className="pi-entry-header"
        onClick={onToggleExpand}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="pi-entry-method">{entry.method}</span>
        <span className="pi-entry-url" title={entry.url}>{shortUrl}</span>
        <span className="pi-entry-meta">
          {entry.status !== undefined && (
            isOk
              ? <Check size={10} className="pi-entry-ok-icon" />
              : <AlertTriangle size={10} className="pi-entry-err-icon" />
          )}
          {entry.status ?? '—'}
          {entry.durationMs !== undefined && <span className="pi-entry-dur">{entry.durationMs}ms</span>}
        </span>
        <span className="pi-entry-time">{timeStr}</span>
      </button>
      {/* Prompt résumé sur 1 ligne, visible direct sans expand. Tronqué si
          long, full text au hover via title. Refonte 2026-05-12. */}
      {promptSummary && !expanded && (
        <div className="pi-entry-prompt-summary" title={promptSummary}>
          <Code2 size={10} />
          <span>{promptSummary.slice(0, 180)}{promptSummary.length > 180 ? '…' : ''}</span>
        </div>
      )}

      {expanded && promptSummary && (
        <div className="pi-entry-prompt-full" title="Prompt principal de la requête">
          <div className="pi-entry-section-title">Prompt</div>
          <div className="pi-entry-prompt-text">{promptSummary}</div>
        </div>
      )}
      {expanded && (
        <div className="pi-entry-body">
          {/* REQUEST body */}
          <div className="pi-entry-section">
            <div className="pi-entry-section-title">Request body</div>
            {entry.body !== undefined ? (
              <pre className="pi-entry-pre">{JSON.stringify(entry.body, null, 2)}</pre>
            ) : entry.bodyText ? (
              <pre className="pi-entry-pre">{entry.bodyText}</pre>
            ) : (
              <div className="pi-entry-empty">(pas de body)</div>
            )}
          </div>

          {/* RESPONSE body */}
          <div className="pi-entry-section">
            <div className="pi-entry-section-title">
              Response {entry.status !== undefined && `(${entry.status})`}
            </div>
            {entry.error ? (
              <pre className="pi-entry-pre pi-entry-err">⚠ {entry.error}</pre>
            ) : entry.response !== undefined ? (
              <pre className="pi-entry-pre">{JSON.stringify(entry.response, null, 2)}</pre>
            ) : entry.responseText ? (
              <pre className="pi-entry-pre">{entry.responseText}</pre>
            ) : (
              <div className="pi-entry-empty">(pas de réponse capturée)</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Extrait un résumé du prompt principal d'une requête (image/text/audio).
 *  Ordre de priorité :
 *    1. body.prompt_positive (ComfyUI image/video workflows)
 *    2. body.prompt (Qwen Edit, Mistral fallback simple)
 *    3. body.messages[].content (Mistral / Anthropic format chat)
 *    4. body.text (TTS ElevenLabs)
 *    5. body.text_fr (translate)
 *  Retourne null si aucun prompt extractable.
 */
function extractPromptSummary(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>

  if (typeof b.prompt_positive === 'string' && b.prompt_positive.trim()) {
    return b.prompt_positive.trim()
  }
  if (typeof b.prompt === 'string' && b.prompt.trim()) {
    return b.prompt.trim()
  }
  if (Array.isArray(b.messages)) {
    const msgs = b.messages as Array<{ role?: string; content?: unknown }>
    // Récupère le DERNIER message user (le plus récent dans la conv)
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m?.role === 'user' && m.content) {
        if (typeof m.content === 'string') return m.content.trim()
        if (Array.isArray(m.content)) {
          // Anthropic-style content blocks
          const txt = (m.content as Array<{ type?: string; text?: string }>)
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text!).join(' ')
          if (txt.trim()) return txt.trim()
        }
      }
    }
  }
  if (typeof b.text === 'string' && b.text.trim()) {
    return b.text.trim()
  }
  if (typeof b.text_fr === 'string' && b.text_fr.trim()) {
    return b.text_fr.trim()
  }
  if (typeof b.prompt_fr === 'string' && b.prompt_fr.trim()) {
    return b.prompt_fr.trim()
  }
  return null
}
