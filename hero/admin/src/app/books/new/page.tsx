'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GenerateBookParams, AiModel, AddressForm, AgeRange, Language, ContextType, Difficulty, ContentMix, MapStyle, MapVisibility, IllustrationStyle } from '@/types'

// ── Blocs d'inspiration ───────────────────────────────────────────────────────

interface InspirationBlock {
  id: string
  type: string
  content: string
}

const BLOCK_TYPES = [
  { value: 'Description',         icon: '📝' },
  { value: 'Inspiration',         icon: '💡' },
  { value: 'Ambiance',            icon: '🌫️' },
  { value: 'Contexte politique',  icon: '⚖️' },
  { value: 'Géographie',          icon: '🗺️' },
  { value: 'Histoire du monde',   icon: '📜' },
  { value: 'Personnages clés',    icon: '👤' },
  { value: 'Factions',            icon: '⚔️' },
  { value: 'Règles spéciales',    icon: '🎲' },
  { value: 'Références',         icon: '🎬' },
]

function blockIcon(type: string) {
  return BLOCK_TYPES.find(b => b.value === type)?.icon ?? '📄'
}

function serializeBlocks(blocks: InspirationBlock[]): string {
  return blocks
    .filter(b => b.content.trim())
    .map(b => `[${b.type}]\n${b.content.trim()}`)
    .join('\n\n')
}

function newBlock(type = 'Description'): InspirationBlock {
  return { id: Math.random().toString(36).slice(2), type, content: '' }
}

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

const MAP_STYLES: { value: MapStyle; icon: string; label: string; desc: string }[] = [
  { value: 'subway',  icon: '🚇', label: 'Métro',    desc: 'Plan de métro coloré (NYC, Tokyo...)' },
  { value: 'city',    icon: '🏙️', label: 'Ville',    desc: 'Carte de ville réaliste' },
  { value: 'dungeon', icon: '🏰', label: 'Donjon',   desc: 'Plan de donjon fantasy' },
  { value: 'forest',  icon: '🌲', label: 'Forêt',    desc: 'Carte de territoire sauvage' },
  { value: 'sea',     icon: '⚓', label: 'Maritime',  desc: 'Carte nautique, îles et mers' },
]

const ILLUSTRATION_STYLES: { value: IllustrationStyle; icon: string; label: string; desc: string }[] = [
  { value: 'realistic',   icon: '🖼️',  label: 'Réaliste',      desc: 'Peinture numérique détaillée' },
  { value: 'manga',       icon: '⛩️',  label: 'Manga',          desc: 'Style manga, trames et encrage' },
  { value: 'bnw',         icon: '⬛',  label: 'Noir & Blanc',   desc: 'Encre de Chine, lavis' },
  { value: 'watercolor',  icon: '🎨',  label: 'Aquarelle',      desc: 'Couleurs douces, transparences' },
  { value: 'comic',       icon: '💬',  label: 'BD franco-belge',desc: 'Ligne claire, style Hergé' },
  { value: 'dark_fantasy',icon: '🩸',  label: 'Dark Fantasy',   desc: 'Style Frazetta, ombres profondes' },
  { value: 'pixel',       icon: '👾',  label: 'Pixel Art',      desc: 'Rétro 16-bit, style jeu vidéo' },
]

const MAP_VISIBILITIES: { value: MapVisibility; icon: string; label: string; desc: string }[] = [
  { value: 'full',  icon: '👁️',  label: 'Connue',             desc: 'Le joueur voit tout dès le début' },
  { value: 'found', icon: '🗺️', label: 'Trouvée en chemin',   desc: 'Obtenue lors de l\'aventure' },
  { value: 'fog',   icon: '🌫️', label: 'Brouillard de guerre', desc: 'Révélée au fur et à mesure' },
]

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
  const [blocks, setBlocks] = useState<InspirationBlock[]>([newBlock('Description')])
  const [aiModel, setAiModel] = useState<AiModel>('claude')
  const [addressForm, setAddressForm] = useState<AddressForm>('vous')
  const [form, setForm] = useState<GenerateBookParams>({
    title: '', theme: 'Fantasy', age_range: '13-17', context_type: 'Aventure',
    language: 'fr', difficulty: 'normal', num_sections: 30,
    map_style: null, map_visibility: 'full',
    content_mix: { ...DEFAULT_MIX }, description: '',
    illustration_style: 'realistic',
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
      const payload = { ...form, description: serializeBlocks(blocks), ai_model: aiModel, address_form: addressForm }
      const res = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
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
        Remplissez les paramètres — Claude ou Mistral générera le livre dans le style de Pierre Bordage.
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
            <input style={inputStyle} type="number" min={20} max={150} value={form.num_sections} onChange={e => set('num_sections', parseInt(e.target.value))} />
          </div>
        </div>

        {/* Tutoiement / Vouvoiement */}
        <div>
          <label style={labelStyle}>Adresse au lecteur</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            {([
              { value: 'vous' as AddressForm, label: 'Vouvoiement', example: '"Vous avancez dans l\'obscurité…"', icon: '🎩' },
              { value: 'tu'   as AddressForm, label: 'Tutoiement',  example: '"Tu avances dans l\'obscurité…"',   icon: '🤝' },
            ] as const).map(opt => (
              <button key={opt.value} type="button" onClick={() => setAddressForm(opt.value)} style={{
                padding: '0.65rem 0.75rem', borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
                border: `2px solid ${addressForm === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                background: addressForm === opt.value ? 'var(--accent)18' : 'var(--surface-2)',
                transition: 'all 0.15s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <span>{opt.icon}</span>
                  <span style={{ fontWeight: 'bold', fontSize: '0.82rem', color: addressForm === opt.value ? 'var(--accent)' : 'var(--foreground)' }}>{opt.label}</span>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.3 }}>{opt.example}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Carte */}
        <div>
          <label style={labelStyle}>🗺 Carte / Plan</label>
          {/* Toggle: avec ou sans carte */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {[
              { hasMap: false, icon: '🚫', label: 'Pas de carte' },
              { hasMap: true,  icon: '🗺️', label: 'Avec une carte' },
            ].map(opt => (
              <button key={String(opt.hasMap)} type="button"
                onClick={() => set('map_style', opt.hasMap ? 'city' : null)}
                style={{
                  flex: 1, padding: '0.5rem 0.75rem', borderRadius: '6px', cursor: 'pointer',
                  border: `2px solid ${(form.map_style !== null && form.map_style !== undefined) === opt.hasMap ? 'var(--accent)' : 'var(--border)'}`,
                  background: (form.map_style !== null && form.map_style !== undefined) === opt.hasMap ? 'var(--accent)22' : 'var(--surface-2)',
                  color: (form.map_style !== null && form.map_style !== undefined) === opt.hasMap ? 'var(--accent)' : 'var(--muted)',
                  display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center',
                  fontSize: '0.82rem', fontWeight: 'bold', transition: 'all 0.15s',
                }}>
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>

          {form.map_style && (
            <>
              {/* Style visuel */}
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Style de carte
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {MAP_STYLES.map(m => (
                  <button key={m.value} type="button" onClick={() => set('map_style', m.value)} style={{
                    padding: '0.6rem 0.4rem', borderRadius: '6px', cursor: 'pointer',
                    border: `2px solid ${form.map_style === m.value ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.map_style === m.value ? 'var(--accent)22' : 'var(--surface-2)',
                    color: form.map_style === m.value ? 'var(--accent)' : 'var(--muted)',
                    textAlign: 'center', transition: 'all 0.15s',
                  }}>
                    <div style={{ fontSize: '1.2rem', marginBottom: '0.2rem' }}>{m.icon}</div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 'bold' }}>{m.label}</div>
                    <div style={{ fontSize: '0.58rem', opacity: 0.8, marginTop: '0.1rem' }}>{m.desc}</div>
                  </button>
                ))}
              </div>

              {/* Visibilité joueur */}
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Visibilité joueur
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                {MAP_VISIBILITIES.map(v => (
                  <button key={v.value} type="button" onClick={() => set('map_visibility', v.value)} style={{
                    padding: '0.6rem 0.5rem', borderRadius: '6px', cursor: 'pointer',
                    border: `2px solid ${form.map_visibility === v.value ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.map_visibility === v.value ? 'var(--accent)22' : 'var(--surface-2)',
                    color: form.map_visibility === v.value ? 'var(--accent)' : 'var(--muted)',
                    textAlign: 'center', transition: 'all 0.15s',
                  }}>
                    <div style={{ fontSize: '1.2rem', marginBottom: '0.2rem' }}>{v.icon}</div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 'bold' }}>{v.label}</div>
                    <div style={{ fontSize: '0.58rem', opacity: 0.8, marginTop: '0.1rem' }}>{v.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Blocs d'inspiration */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <label style={{ ...labelStyle, margin: 0 }}>Contexte &amp; inspiration (optionnel)</label>
            <span style={{ fontSize: '0.65rem', color: 'var(--muted)', opacity: 0.7 }}>Lu et interprété par le modèle choisi</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {blocks.map((block, i) => (
              <div key={block.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                {/* En-tête du bloc */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.9rem' }}>{blockIcon(block.type)}</span>
                  <select
                    value={block.type}
                    onChange={e => setBlocks(bs => bs.map(b => b.id === block.id ? { ...b, type: e.target.value } : b))}
                    style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--foreground)', fontSize: '0.78rem', fontWeight: 'bold', outline: 'none', cursor: 'pointer' }}
                  >
                    {BLOCK_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.value}</option>)}
                  </select>
                  {blocks.length > 1 && (
                    <button type="button" onClick={() => setBlocks(bs => bs.filter(b => b.id !== block.id))}
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem', opacity: 0.6, padding: '0 0.2rem' }}>
                      ✕
                    </button>
                  )}
                </div>
                {/* Contenu */}
                <textarea
                  value={block.content}
                  onChange={e => setBlocks(bs => bs.map(b => b.id === block.id ? { ...b, content: e.target.value } : b))}
                  placeholder={
                    block.type === 'Description'        ? "Résumé de l'histoire, concept principal..." :
                    block.type === 'Ambiance'            ? "Sombre et oppressant, brume permanente, ville délabrée..." :
                    block.type === 'Contexte politique'  ? "Trois factions se disputent le pouvoir depuis la chute de l'empire..." :
                    block.type === 'Géographie'          ? "La cité est construite sur trois niveaux, entourée d'un marais toxique..." :
                    block.type === 'Personnages clés'    ? "Le Général Vorn : militaire impitoyable. Lena : jeune espionne rebelle..." :
                    block.type === 'Références'         ? "Inspiré de Blade Runner, 1984, et Le Nom de la Rose..." :
                    "Détaillez ce contexte pour guider Claude..."
                  }
                  rows={3}
                  style={{ width: '100%', background: 'transparent', border: 'none', padding: '0.6rem 0.75rem', color: 'var(--foreground)', fontSize: '0.85rem', resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              </div>
            ))}

            {/* Bouton ajouter un bloc */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {BLOCK_TYPES.filter(t => !blocks.some(b => b.type === t.value)).map(t => (
                <button key={t.value} type="button"
                  onClick={() => setBlocks(bs => [...bs, newBlock(t.value)])}
                  style={{
                    fontSize: '0.68rem', padding: '0.25rem 0.6rem', borderRadius: '20px',
                    background: 'var(--surface-2)', border: '1px dashed var(--border)',
                    color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
                  }}>
                  + {t.icon} {t.value}
                </button>
              ))}
            </div>
          </div>
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

        {/* Style d'illustration */}
        <div>
          <label style={labelStyle}>🎨 Style d'illustration</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            {ILLUSTRATION_STYLES.map(s => (
              <button key={s.value} type="button" onClick={() => set('illustration_style', s.value)} style={{
                padding: '0.6rem 0.5rem', borderRadius: '6px', cursor: 'pointer',
                border: `2px solid ${form.illustration_style === s.value ? 'var(--accent)' : 'var(--border)'}`,
                background: form.illustration_style === s.value ? 'var(--accent)22' : 'var(--surface-2)',
                color: form.illustration_style === s.value ? 'var(--accent)' : 'var(--muted)',
                textAlign: 'center', transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: '1.2rem', marginBottom: '0.2rem' }}>{s.icon}</div>
                <div style={{ fontSize: '0.72rem', fontWeight: 'bold' }}>{s.label}</div>
                <div style={{ fontSize: '0.58rem', opacity: 0.8, marginTop: '0.1rem', lineHeight: 1.3 }}>{s.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Sélecteur de modèle IA */}
        <div>
          <label style={labelStyle}>🤖 Modèle de génération</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            {([
              { value: 'claude'  as AiModel, icon: '⚡', label: 'Claude Sonnet', desc: 'Structure + textes Anthropic', color: '#c9a84c' },
              { value: 'mistral' as AiModel, icon: '🌟', label: 'Mistral Large', desc: 'Structure + textes Mistral', color: '#f0824c' },
              { value: 'mixed'   as AiModel, icon: '⚡🌟', label: 'Mixte', desc: 'Claude → structure · Mistral → textes', color: '#7c9ef0' },
            ] as const).map(m => (
              <button key={m.value} type="button" onClick={() => setAiModel(m.value)} style={{
                padding: '0.7rem 0.75rem', borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
                border: `2px solid ${aiModel === m.value ? m.color : 'var(--border)'}`,
                background: aiModel === m.value ? m.color + '18' : 'var(--surface-2)',
                transition: 'all 0.15s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>{m.icon}</span>
                  <span style={{ fontWeight: 'bold', fontSize: '0.82rem', color: aiModel === m.value ? m.color : 'var(--foreground)' }}>{m.label}</span>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--muted)', lineHeight: 1.3 }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.875rem', background: '#c94c4c11', padding: '0.75rem', borderRadius: '6px' }}>
            ⚠ {error}
          </p>
        )}

        <button type="submit" disabled={loading || mixOver} style={{
          background: loading || mixOver ? 'var(--muted)' : aiModel === 'mistral' ? '#f0824c' : 'var(--accent)',
          color: '#0f0f14', border: 'none', borderRadius: '6px',
          padding: '0.75rem 1.5rem', fontWeight: 'bold', fontSize: '0.9rem',
          cursor: loading || mixOver ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          {loading ? (
            <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙</span> Génération en cours...</>
          ) : aiModel === 'mistral' ? '🌟 Générer avec Mistral' : '✨ Générer avec Claude'}
        </button>

        {loading && (
          <p style={{ color: 'var(--muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            {aiModel === 'mistral' ? 'Mistral' : 'Claude'} rédige votre aventure... Cela peut prendre 1 à 2 minutes.
          </p>
        )}
      </form>
    </div>
  )
}
