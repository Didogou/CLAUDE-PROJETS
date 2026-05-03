'use client'
/**
 * Composant réutilisable : génère N images en parallèle séquentiel, puis laisse
 * l'utilisateur sélectionner celles à garder. Les non-sélectionnées sont
 * listées pour cleanup ultérieur (via callback onCompleted).
 *
 * Utilisé par :
 *   - Sous-wizard Variantes (6 images, multi-sélection)
 *   - Sous-wizard Dérivations (plus tard)
 *   - Etc.
 *
 * Contrat :
 *   - parent fournit un `generateOne(i)` qui retourne une Promise<url|null>
 *   - le composant gère la séquence, l'affichage, la sélection multi
 *   - au clic "✓ Garder la sélection" → appel onCompleted(kept, discarded)
 */
import React, { useEffect, useRef, useState } from 'react'

export interface BatchItem {
  index: number
  status: 'pending' | 'generating' | 'done' | 'error'
  url?: string
  error?: string
  /** Label optionnel à afficher sous l'image (ex: nom du modèle). */
  label?: string
}

export interface GenerateAndSelectBatchProps {
  /** Nombre total d'images à générer. */
  count: number
  /** Labels optionnels par index (ex: ['Juggernaut', 'Animagine'...]). */
  labels?: string[]
  /** Ratio d'aspect pour la preview (ex: '16/9', '9/16', '1'). */
  aspectRatio: string
  /** Génère l'image à l'index i. Renvoie null si erreur. */
  generateOne: (i: number, onProgress?: (msg: string) => void) => Promise<string | null>
  /** Titre affiché en haut. */
  title?: string
  /** Appelé quand l'utilisateur valide sa sélection. */
  onCompleted: (kept: string[], discarded: string[]) => void | Promise<void>
  /** Appelé quand l'utilisateur annule (retour au dashboard sans garder). */
  onCancel: () => void
  /** Si true (défaut false), permet de regénérer individuellement une tuile. */
  allowRegenerate?: boolean
  /** generateOne appelé à nouveau pour regénérer un index spécifique. */
  regenerateOne?: (i: number) => Promise<string | null>
}

export default function GenerateAndSelectBatch({
  count,
  labels,
  aspectRatio,
  generateOne,
  title = 'Sélectionne les images à garder',
  onCompleted,
  onCancel,
  allowRegenerate = false,
  regenerateOne,
}: GenerateAndSelectBatchProps) {
  const [items, setItems] = useState<BatchItem[]>(
    Array.from({ length: count }, (_, i) => ({ index: i, status: 'pending' as const })),
  )
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set())
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const cancelledRef = useRef(false)
  const startedRef = useRef(false)

  // Lance la séquence au mount.
  // En dev (React StrictMode), useEffect est doublé : mount → unmount → mount.
  // Le cleanup du 1er mount mettrait cancelledRef=true, puis le 2e mount serait
  // skippé (startedRef=true) → la boucle déjà lancée verrait cancelled=true et
  // se casserait juste après la 1re await. D'où "rien ne se queue dans ComfyUI".
  // Fix : ré-annuler la cancellation sur tout re-mount (startedRef garde l'état
  // "déjà lancé", cancelledRef reste false). La cancellation effective passe par
  // le bouton "Annuler" qui appelle onCancel (callback parent).
  useEffect(() => {
    cancelledRef.current = false
    if (startedRef.current) return
    startedRef.current = true
    void runSequence()
    // Pas de cleanup qui set cancelledRef=true — ça casse en StrictMode.
    // Les générations en cours continuent si le composant est démonté en prod ;
    // c'est acceptable car le parent gère la navigation (Dashboard) et le
    // cleanup des URLs non validées via pendingCleanup du PlanWizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runSequence() {
    setRunning(true)
    for (let i = 0; i < count; i++) {
      if (cancelledRef.current) break
      setItems(prev => prev.map(it => it.index === i ? { ...it, status: 'generating' } : it))
      try {
        const url = await generateOne(i, (msg) => {
          setItems(prev => prev.map(it => it.index === i ? { ...it, status: 'generating', error: msg } : it))
        })
        if (cancelledRef.current) break
        if (url) {
          setItems(prev => prev.map(it => it.index === i ? { ...it, status: 'done', url, error: undefined } : it))
          // Auto-select par défaut pour l'utilisateur — il décoche ce qu'il ne veut pas
          setSelectedIdx(prev => new Set(prev).add(i))
        } else {
          setItems(prev => prev.map(it => it.index === i ? { ...it, status: 'error', error: 'Pas d\'URL reçue' } : it))
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setItems(prev => prev.map(it => it.index === i ? { ...it, status: 'error', error: msg } : it))
      }
    }
    setRunning(false)
  }

  async function regenerateIdx(i: number) {
    if (!regenerateOne) return
    setItems(prev => prev.map(it => it.index === i ? { ...it, status: 'generating', error: undefined, url: undefined } : it))
    try {
      const url = await regenerateOne(i)
      if (url) {
        setItems(prev => prev.map(it => it.index === i ? { ...it, status: 'done', url, error: undefined } : it))
      } else {
        setItems(prev => prev.map(it => it.index === i ? { ...it, status: 'error', error: 'Pas d\'URL' } : it))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setItems(prev => prev.map(it => it.index === i ? { ...it, status: 'error', error: msg } : it))
    }
  }

  function toggleSelected(i: number) {
    setSelectedIdx(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  function handleValidate() {
    const kept: string[] = []
    const discarded: string[] = []
    for (const it of items) {
      if (!it.url) continue
      if (selectedIdx.has(it.index)) kept.push(it.url)
      else discarded.push(it.url)
    }
    void onCompleted(kept, discarded)
  }

  const doneCount = items.filter(it => it.status === 'done').length
  const errCount = items.filter(it => it.status === 'error').length
  const selectedCount = selectedIdx.size

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        {/* Header status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.85rem', color: 'var(--foreground)' }}>{title}</strong>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            {doneCount}/{count} générées{errCount > 0 ? ` · ${errCount} erreur${errCount > 1 ? 's' : ''}` : ''}{running ? ' · ⏳ en cours' : ''} · {selectedCount} sélectionnée{selectedCount > 1 ? 's' : ''}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button onClick={async () => {
              cancelledRef.current = true
              try { await fetch('http://127.0.0.1:8188/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }) } catch {}
              try { await fetch('http://127.0.0.1:8188/interrupt', { method: 'POST' }) } catch {}
              onCancel()
            }} style={{ fontSize: '0.7rem', padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer' }}>
              ← Annuler
            </button>
            <button
              onClick={handleValidate}
              disabled={doneCount === 0}
              style={{ fontSize: '0.72rem', fontWeight: 'bold', padding: '0.4rem 1rem', borderRadius: '4px', border: 'none', background: 'var(--accent)', color: '#0f0f14', cursor: doneCount === 0 ? 'not-allowed' : 'pointer', opacity: doneCount === 0 ? 0.5 : 1 }}>
              ✓ Garder la sélection ({selectedCount})
            </button>
          </div>
        </div>

        {/* Grille images */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.8rem' }}>
          {items.map(it => {
            const selected = selectedIdx.has(it.index)
            const label = labels?.[it.index] ?? `#${it.index + 1}`
            return (
              <div key={it.index} style={{ border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '6px', padding: '0.5rem', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <strong style={{ fontSize: '0.7rem', color: selected ? 'var(--accent)' : 'var(--foreground)' }}>{label}</strong>
                  {it.status === 'pending' && <span style={{ fontSize: '0.55rem', color: 'var(--muted)' }}>⏸ attente</span>}
                  {it.status === 'generating' && <span style={{ fontSize: '0.55rem', color: '#f0a742' }}>⏳ {it.error || 'génération'}</span>}
                  {it.status === 'done' && <span style={{ fontSize: '0.55rem', color: '#52c484' }}>✓</span>}
                  {it.status === 'error' && <span style={{ fontSize: '0.55rem', color: '#c94c4c' }}>✕ erreur</span>}
                </div>
                <div
                  onClick={() => it.url && setZoomedUrl(it.url)}
                  style={{ aspectRatio, background: '#000', borderRadius: '4px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: it.url ? 'zoom-in' : 'default' }}>
                  {it.url ? (
                    <img src={it.url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : it.status === 'error' ? (
                    <span style={{ fontSize: '0.6rem', color: '#c94c4c', textAlign: 'center', padding: '0.5rem' }}>{it.error ?? 'Erreur'}</span>
                  ) : (
                    <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>{it.status === 'generating' ? '⏳ Génération…' : '⏸'}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                  {it.url ? (
                    <button onClick={() => toggleSelected(it.index)} style={{ flex: 1, background: selected ? 'var(--accent)' : 'transparent', border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '4px', padding: '0.3rem 0.5rem', color: selected ? '#0f0f14' : 'var(--muted)', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>
                      {selected ? '✓ Sélectionnée' : '○ Cocher'}
                    </button>
                  ) : <div style={{ flex: 1 }} />}
                  {allowRegenerate && regenerateOne && it.status !== 'generating' && (
                    <button onClick={() => void regenerateIdx(it.index)} title="Regénérer" style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.3rem 0.5rem', color: 'var(--muted)', fontSize: '0.65rem', cursor: 'pointer' }}>🔄</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Zoom plein écran */}
      {zoomedUrl && (
        <div onClick={() => setZoomedUrl(null)} style={{ position: 'fixed', inset: 0, zIndex: 4500, background: '#000000f5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: '2rem' }}>
          <img src={zoomedUrl} alt="zoom" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </>
  )
}
