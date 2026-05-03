'use client'

import React, { useEffect, useState } from 'react'

interface ServiceInfo {
  name: string
  label: string
  port: number
  description: string
  running: boolean
  managed: boolean
  pid?: number
  uptime_ms?: number | null
  recent_logs?: string[]
}

/**
 * Widget flottant bottom-right qui montre l'état des services locaux (ComfyUI,
 * rembg, Kohya) et permet de les démarrer/arrêter sans quitter l'admin.
 *
 * Polling toutes les 5s. Discret quand replié (3 pastilles colorées),
 * panneau complet à l'expansion.
 */
export default function SystemServicesWidget() {
  const [services, setServices] = useState<ServiceInfo[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [showLogsFor, setShowLogsFor] = useState<string | null>(null)

  // Polling status
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const r = await fetch('/api/system/services', { cache: 'no-store' })
        const data = await r.json()
        if (!cancelled && data.services) setServices(data.services)
      } catch {
        // silencieux — l'admin peut tourner avant que la route soit prête
      }
      if (!cancelled) timer = setTimeout(poll, 5000)
    }
    poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [])

  async function action(serviceName: string, act: 'start' | 'stop') {
    setLoading(l => ({ ...l, [serviceName]: true }))
    try {
      const r = await fetch('/api/system/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act, service: serviceName }),
      })
      const data = await r.json()
      if (!r.ok) alert(`Erreur: ${data.error}`)
      else if (data.message) console.log('[services]', data.message)
      // Refresh immédiat
      const s = await fetch('/api/system/services', { cache: 'no-store' }).then(x => x.json())
      if (s.services) setServices(s.services)
    } catch (err) {
      alert('Erreur réseau: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(l => ({ ...l, [serviceName]: false }))
    }
  }

  const runningCount = services.filter(s => s.running).length

  // ── Vue repliée : pastille discrète ──
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        title={`${runningCount}/${services.length} services actifs — clic pour gérer`}
        style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 2500,
          background: 'rgba(15,15,20,0.92)', border: '1px solid var(--border)', borderRadius: '20px',
          padding: '0.4rem 0.7rem', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '0.4rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)',
          fontSize: '0.7rem', color: 'var(--foreground)',
        }}
      >
        <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>⚙️</span>
        {services.map(s => (
          <span key={s.name} title={`${s.label} ${s.running ? 'actif' : 'arrêté'}`}
            style={{ width: 8, height: 8, borderRadius: '50%', background: s.running ? '#52c484' : '#c94c4c66', boxShadow: s.running ? '0 0 6px #52c48477' : undefined }} />
        ))}
        <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{runningCount}/{services.length}</span>
      </button>
    )
  }

  // ── Vue dépliée ──
  return (
    <div
      style={{
        position: 'fixed', bottom: 16, right: 16, zIndex: 2500,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        width: 360, maxHeight: '80vh', overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0.6rem 0.8rem', borderBottom: '1px solid var(--border)' }}>
        <strong style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>⚙️ Services locaux</strong>
        <span style={{ marginLeft: '0.5rem', fontSize: '0.6rem', color: 'var(--muted)' }}>{runningCount}/{services.length} actifs</span>
        <button onClick={() => setExpanded(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
      </div>

      {/* Liste */}
      <div style={{ padding: '0.4rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {services.length === 0 && <div style={{ padding: '0.6rem', fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic' }}>Chargement…</div>}
        {services.map(s => {
          const busy = !!loading[s.name]
          return (
            <div key={s.name} style={{ padding: '0.5rem 0.6rem', background: 'var(--surface-2)', border: `1px solid ${s.running ? '#52c48433' : 'var(--border)'}`, borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.running ? '#52c484' : '#c94c4c66', boxShadow: s.running ? '0 0 8px #52c48499' : undefined, flexShrink: 0 }} />
                <strong style={{ fontSize: '0.75rem' }}>{s.label}</strong>
                <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>:{s.port}</span>
                {s.running && s.uptime_ms != null && (
                  <span style={{ fontSize: '0.55rem', color: '#52c484', fontFamily: 'monospace' }}>
                    {Math.floor(s.uptime_ms / 60000)}m{Math.floor((s.uptime_ms % 60000) / 1000)}s
                  </span>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                  {s.running ? (
                    <button disabled={busy || !s.managed} onClick={() => action(s.name, 'stop')}
                      title={s.managed ? 'Arrêter' : 'Lancé hors admin — arrête-le dans son terminal'}
                      style={{ fontSize: '0.6rem', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #c94c4c44', background: '#c94c4c22', color: '#c94c4c', cursor: (busy || !s.managed) ? 'default' : 'pointer', opacity: (!s.managed) ? 0.4 : 1 }}>
                      {busy ? '⏳' : '⏹ Stop'}
                    </button>
                  ) : (
                    <button disabled={busy} onClick={() => action(s.name, 'start')}
                      style={{ fontSize: '0.6rem', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #52c48466', background: '#52c48422', color: '#52c484', cursor: busy ? 'default' : 'pointer', fontWeight: 'bold' }}>
                      {busy ? '⏳' : '▶ Démarrer'}
                    </button>
                  )}
                  {s.recent_logs && s.recent_logs.length > 0 && (
                    <button onClick={() => setShowLogsFor(showLogsFor === s.name ? null : s.name)}
                      style={{ fontSize: '0.6rem', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer' }}>
                      📋
                    </button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '0.6rem', color: 'var(--muted)', fontStyle: 'italic' }}>{s.description}</div>
              {!s.managed && s.running && (
                <div style={{ fontSize: '0.55rem', color: '#f0a742', fontStyle: 'italic' }}>
                  ⚠ Lancé en dehors de l'admin (PID inconnu, arrêt impossible d'ici)
                </div>
              )}
              {showLogsFor === s.name && s.recent_logs && (
                <pre style={{ margin: 0, padding: '0.4rem 0.5rem', background: '#0a0a0e', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.55rem', color: '#a8c8d8', maxHeight: '180px', overflowY: 'auto', fontFamily: 'Consolas, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {s.recent_logs.length === 0 ? '(aucun log capturé)' : s.recent_logs.join('\n')}
                </pre>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ padding: '0.4rem 0.8rem', borderTop: '1px solid var(--border)', fontSize: '0.55rem', color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center' }}>
        Mode local uniquement. Polling /5s.
      </div>
    </div>
  )
}
