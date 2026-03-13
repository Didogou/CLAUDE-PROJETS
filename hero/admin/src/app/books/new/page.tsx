'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GenerateBookParams, AgeRange, Language, ContextType, Difficulty, ContentMix } from '@/types'

const THEMES = ['Fantasy', 'Science-Fiction', 'Médiéval', 'Post-Apocalyptique', 'Cyberpunk', 'Horreur', 'Polar', 'Historique', 'Contemporain']
const CONTEXTS: ContextType[] = ['Aventure', 'Intrigue', 'Suspense', 'Enquête', 'Horreur', 'Fantasy', 'Science-Fiction']
const AGE_RANGES: AgeRange[] = ['8-12', '13-17', '18+']
const DIFFICULTIES: { value: Difficulty; label: string; icon: string; desc: string }[] = [
  { value: 'facile',    label: 'Facile',    icon: '🌱', desc: 'Ennemis faibles, nombreuses récompenses' },
  { value: 'normal',    label: 'Normal',    icon: '⚔️',  desc: 'Équilibré, challenge modéré' },
  { value: 'difficile', label: 'Difficile', icon: '🔥', desc: 'Ennemis forts, récompenses rares' },
  { value: 'expert',    label: 'Expert',    icon: '💀', desc: 'Redoutable, chaque erreur compte' },
]

const MIX_FIELDS: { key: keyof ContentMix; label: string; icon: string; color: string }[] = [
  { key: 'combat', label: 'Combat',         icon: '⚔️',  color: '#e05c4b' },
  { key: 'chance', label: 'Chance',         icon: '🎲', color: '#f0a742' },
  { key: 'enigme', label: 'Énigme',         icon: '🧩', color: '#6b8cde' },
  { key: 'magie',  label: 'Combat magique', icon: '✨', color: '#b48edd' },
]

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: '6px', padding: '0.6rem 0.75rem', color: 'var(--foreground)',
  fontSize: '0.9rem', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.8rem', color: 'var(--muted)',
  marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em',
}

const DEFAULT_MIX: ContentMix = { combat: 20, chance: 10, enigme: 10, magie: 5 }

// Temps moyen par section selon le type (minutes)
const SECTION_TIME: Record<string, number> = {
  narration: 2, combat: 5, magie: 5, enigme: 4, chance: 2,
}

// Part du livre visitée en une partie selon la difficulté
const VISIT_RATE: Record<Difficulty, number> = {
  facile: 0.42, normal: 0.36, difficile: 0.28, expert: 0.22,
}

// Nombre de parties pour voir toutes les fins selon la difficulté
const REPLAYS: Record<Difficulty, { min: number; max: number }> = {
  facile: { min: 2, max: 3 }, normal: { min: 3, max: 5 },
  difficile: { min: 4, max: 7 }, expert: { min: 6, max: 10 },
}

function estimatePlayTime(num_sections: number, mix: ContentMix, difficulty: Difficulty) {
  const total = mix.combat + mix.chance + mix.enigme + mix.magie
  const narration = Math.max(0, 100 - total)
  // Temps moyen pondéré par section (en minutes)
  const avgTimePerSection =
    (mix.combat  / 100) * SECTION_TIME.combat  +
    (mix.magie   / 100) * SECTION_TIME.magie   +
    (mix.enigme  / 100) * SECTION_TIME.enigme  +
    (mix.chance  / 100) * SECTION_TIME.chance  +
    (narration   / 100) * SECTION_TIME.narration
  const sectionsVisited = Math.round(num_sections * VISIT_RATE[difficulty])
  const avgMin = Math.round(sectionsVisited * avgTimePerSection)
  const minTime = Math.round(avgMin * 0.75)
  const maxTime = Math.round(avgMin * 1.35)
  return { minTime, maxTime, sectionsVisited, replays: REPLAYS[difficulty] }
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h${m.toString().padStart(2, '0')}`
}

export default function NewBookPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<GenerateBookParams>({
    title: '', theme: 'Fantasy', age_range: '13-17', context_type: 'Aventure',
    language: 'fr', difficulty: 'normal', num_sections: 30,
    content_mix: { ...DEFAULT_MIX }, description: '',
  })

  function set(field: keyof GenerateBookParams, value: any) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function setMix(key: keyof ContentMix, value: number) {
    setForm(f => ({ ...f, content_mix: { ...f.content_mix, [key]: value } }))
  }

  const totalMix = form.content_mix.combat + form.content_mix.chance + form.content_mix.enigme + form.content_mix.magie
  const narration = Math.max(0, 100 - totalMix)
  const mixOver = totalMix > 90
  const estimate = estimatePlayTime(form.num_sections, form.content_mix, form.difficulty)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { setError('Le titre est requis.'); return }
    if (mixOver) { setError('Le total des épreuves dépasse 90%. Réduisez les curseurs.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/books/${data.book_id}`)
    } catch (err: any) {
      setError(err.message); setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '640px' }}>
      <h2 style={{ fontSize: '1.75rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>Nouveau livre</h2>
      <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Remplissez les paramètres — Claude générera le livre dans le style de Pierre Bordage.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Titre */}
        <div>
          <label style={labelStyle}>Titre *</label>
          <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Ex: Les Ombres de Néo-Paris" />
        </div>

        {/* Thème + ambiance */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>Thème</label>
            <select style={inputStyle} value={form.theme} onChange={e => set('theme', e.target.value)}>
              {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Ambiance narrative</label>
            <select style={inputStyle} value={form.context_type} onChange={e => set('context_type', e.target.value as ContextType)}>
              {CONTEXTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Difficulté */}
        <div>
          <label style={labelStyle}>Difficulté</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            {DIFFICULTIES.map(d => (
              <button key={d.value} type="button" onClick={() => set('difficulty', d.value)} style={{
                padding: '0.6rem 0.5rem', borderRadius: '6px', cursor: 'pointer',
                border: `2px solid ${form.difficulty === d.value ? 'var(--accent)' : 'var(--border)'}`,
                background: form.difficulty === d.value ? 'var(--accent)22' : 'var(--surface-2)',
                color: form.difficulty === d.value ? 'var(--accent)' : 'var(--muted)',
                textAlign: 'center', transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: '1.2rem', marginBottom: '0.2rem' }}>{d.icon}</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{d.label}</div>
                <div style={{ fontSize: '0.62rem', opacity: 0.8, marginTop: '0.1rem' }}>{d.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Répartition du contenu */}
        <div>
          <label style={labelStyle}>Répartition des épreuves</label>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

            {MIX_FIELDS.map(f => (
              <div key={f.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', color: f.color, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {f.icon} {f.label}
                  </span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 'bold', color: f.color, minWidth: '36px', textAlign: 'right' }}>
                    {form.content_mix[f.key]}%
                  </span>
                </div>
                <input
                  type="range" min={0} max={50} step={5}
                  value={form.content_mix[f.key]}
                  onChange={e => setMix(f.key, parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: f.color, cursor: 'pointer' }}
                />
              </div>
            ))}

            {/* Barre de répartition visuelle */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                <span>Répartition</span>
                <span style={{ color: mixOver ? '#c94c4c' : 'var(--muted)' }}>
                  {totalMix}% épreuves · {narration}% narration{mixOver ? ' ⚠ Dépassement !' : ''}
                </span>
              </div>
              <div style={{ height: '10px', borderRadius: '5px', background: 'var(--surface-2)', overflow: 'hidden', display: 'flex' }}>
                {MIX_FIELDS.map(f => (
                  <div key={f.key} style={{
                    width: `${form.content_mix[f.key]}%`, background: f.color,
                    transition: 'width 0.2s', minWidth: form.content_mix[f.key] > 0 ? '2px' : '0',
                  }} title={`${f.label} : ${form.content_mix[f.key]}%`} />
                ))}
                <div style={{ flex: 1, background: '#6b6b8044' }} title={`Narration : ${narration}%`} />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                {MIX_FIELDS.map(f => (
                  <span key={f.key} style={{ fontSize: '0.65rem', color: f.color }}>
                    {f.icon} {form.content_mix[f.key]}%
                  </span>
                ))}
                <span style={{ fontSize: '0.65rem', color: '#6b6b80' }}>📖 {narration}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Options */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>Tranche d'âge</label>
            <select style={inputStyle} value={form.age_range} onChange={e => set('age_range', e.target.value as AgeRange)}>
              {AGE_RANGES.map(a => <option key={a} value={a}>{a} ans</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Langue</label>
            <select style={inputStyle} value={form.language} onChange={e => set('language', e.target.value as Language)}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Nb. sections</label>
            <input style={inputStyle} type="number" min={20} max={100} value={form.num_sections} onChange={e => set('num_sections', parseInt(e.target.value))} />
          </div>
        </div>

        {/* Description */}
        <div>
          <label style={labelStyle}>Description (optionnel)</label>
          <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
            value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="Décrivez l'intrigue principale, les personnages clés, l'atmosphère..." />
        </div>

        {/* Estimation temps de jeu */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '10px', padding: '1rem 1.25rem',
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>
              ⏱ Durée par partie
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--accent)' }}>
              {formatTime(estimate.minTime)} – {formatTime(estimate.maxTime)}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
              ~{estimate.sectionsVisited} sections visitées / partie
            </div>
          </div>
          <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>
              🔄 Rejouabilité
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--accent)' }}>
              {estimate.replays.min}–{estimate.replays.max} parties
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
              pour voir toutes les fins
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>
              📖 Sections totales
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--accent)' }}>
              {form.num_sections}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
              sections générées
            </div>
          </div>
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.875rem', background: '#c94c4c11', padding: '0.75rem', borderRadius: '6px' }}>
            ⚠ {error}
          </p>
        )}

        <button type="submit" disabled={loading || mixOver} style={{
          background: loading || mixOver ? 'var(--muted)' : 'var(--accent)',
          color: '#0f0f14', border: 'none', borderRadius: '6px',
          padding: '0.75rem 1.5rem', fontWeight: 'bold', fontSize: '0.9rem',
          cursor: loading || mixOver ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          {loading ? (
            <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙</span> Génération en cours...</>
          ) : '✨ Générer le livre'}
        </button>

        {loading && (
          <p style={{ color: 'var(--muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            Claude rédige votre aventure... Cela peut prendre 1 à 2 minutes.
          </p>
        )}
      </form>
    </div>
  )
}
