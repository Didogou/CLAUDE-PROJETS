'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { Book, Section, Choice, SectionStatus, Npc, NpcType, Location } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StructureIssue {
  id: string
  severity: 'critical' | 'important' | 'narrative'
  type: string
  sections: number[]
  description: string
  section_id?: string
  choice_id?: string
  autofix?: { label: string; action: string; params: Record<string, any> }
  manual?: { fields: { key: string; label: string; placeholder: string }[]; action: string; static_params?: Record<string, any> }
}

interface AgentLogEntry {
  type: 'start' | 'thinking' | 'tool_call' | 'tool_result' | 'tool_error' | 'done' | 'error'
  message?: string
  name?: string
  input?: any
  result?: any
  error?: string
  summary?: string
  corrections?: number
  remaining?: string
  ts: number
}

// ── Musique par défaut par type de section ────────────────────────────────────

const DEFAULT_MUSIC: Record<string, string> = {
  'Narration':   'https://opengameart.org/sites/default/files/dungeon_ambient_1_0.ogg',
  'Combat':      'https://opengameart.org/sites/default/files/battleThemeA.mp3',
  'Énigme':      'https://opengameart.org/sites/default/files/Memoraphile%20-%20Spooky%20Dungeon.mp3',
  'Magie':       'https://opengameart.org/sites/default/files/FantasyOrchestralTheme_1.mp3',
  'Chance':      'https://opengameart.org/sites/default/files/urban_shop_bpm92.mp3',
  'Dialogue':    'https://opengameart.org/sites/default/files/Tavern_0.ogg',
  'Crochetage':  'https://opengameart.org/sites/default/files/Stealth%20in%20the%20Woods_0.mp3',
  'Victoire':    'https://opengameart.org/sites/default/files/Victory_0.mp3',
  'Mort':        'https://opengameart.org/sites/default/files/ambient3%28ominous%29_0.mp3',
  'Agilité':     'https://opengameart.org/sites/default/files/Stealth%20in%20the%20Woods_0.mp3',
}

// ── Config ────────────────────────────────────────────────────────────────────

const BOOK_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', published: 'Publié', archived: 'Archivé',
}

const SECTION_STATUS_CONFIG: Record<SectionStatus, { label: string; color: string; bg: string }> = {
  draft:       { label: 'Brouillon',  color: '#6b6b80', bg: '#6b6b8022' },
  in_progress: { label: 'En cours',   color: '#c9a84c', bg: '#c9a84c22' },
  validated:   { label: 'Validé',     color: '#4caf7d', bg: '#4caf7d22' },
}

// ── Type de section ────────────────────────────────────────────────────────────

type SectionTypeInfo = { icon: string; label: string; color: string }

const SECTION_TYPES: SectionTypeInfo[] = [
  { icon: '📖', label: 'Narration',   color: '#6b6b80' },
  { icon: '⚔️',  label: 'Combat',     color: '#e05c4b' },
  { icon: '🧩', label: 'Énigme',      color: '#6b8cde' },
  { icon: '🏃', label: 'Agilité',     color: '#4ec9b0' },
  { icon: '✨', label: 'Magie',       color: '#b48edd' },
  { icon: '🎲', label: 'Chance',      color: '#f0a742' },
  { icon: '🔓', label: 'Crochetage',  color: '#a8c97f' },
  { icon: '🏆', label: 'Victoire',    color: '#4caf7d' },
  { icon: '💀', label: 'Mort',        color: '#c94c4c' },
  { icon: '💬', label: 'Dialogue',    color: '#64b5f6' },
]

function getSectionType(section: Section): SectionTypeInfo {
  if (section.is_ending)
    return section.ending_type === 'victory' ? SECTION_TYPES[7] : SECTION_TYPES[8]
  if (section.trial) {
    const map: Record<string, SectionTypeInfo> = {
      combat: SECTION_TYPES[1], intelligence: SECTION_TYPES[2],
      agilite: SECTION_TYPES[3], magie: SECTION_TYPES[4],
      chance: SECTION_TYPES[5], crochetage: SECTION_TYPES[6],
      dialogue: SECTION_TYPES[9],
    }
    return map[section.trial.type] ?? { icon: '⚡', label: section.trial.type, color: '#c9a84c' }
  }
  return SECTION_TYPES[0]
}

// ── NPC config ────────────────────────────────────────────────────────────────

const NPC_TYPE_CONFIG: Record<NpcType, { label: string; color: string; icon: string }> = {
  ennemi:   { label: 'Ennemi',    color: '#e05c4b', icon: '👹' },
  boss:     { label: 'Boss',      color: '#c94c4c', icon: '💀' },
  allié:    { label: 'Allié',     color: '#4caf7d', icon: '🤝' },
  neutre:   { label: 'Neutre',    color: '#6b8cde', icon: '🧑' },
  marchand: { label: 'Marchand',  color: '#f0a742', icon: '🛒' },
}

const STATS = [
  { key: 'force',        label: 'Force',        color: '#e05c4b', icon: '💪' },
  { key: 'agilite',      label: 'Agilité',      color: '#4ec9b0', icon: '🏃' },
  { key: 'intelligence', label: 'Intelligence',  color: '#6b8cde', icon: '🧠' },
  { key: 'magie',        label: 'Magie',         color: '#b48edd', icon: '✨' },
  { key: 'endurance',    label: 'Endurance (PV)', color: '#4caf7d', icon: '❤️' },
  { key: 'chance',       label: 'Chance',        color: '#f0a742', icon: '🎲' },
] as const

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BookPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [book, setBook] = useState<Book | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [choices, setChoices] = useState<Choice[]>([])
  const [npcs, setNpcs] = useState<Npc[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [bookSaving, setBookSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [editingIntro, setEditingIntro] = useState(false)
  const [introText, setIntroText] = useState('')
  const [introSaving, setIntroSaving] = useState(false)
  const [introGenerating, setIntroGenerating] = useState(false)
  const [prologueExpanded, setPrologueExpanded] = useState(false)
  const [storyPanel, setStoryPanel] = useState(false)
  const [storyTab, setStoryTab] = useState<'narrative' | 'language'>('narrative')
  const [storySummary, setStorySummary] = useState('')
  const [storyGenerating, setStoryGenerating] = useState(false)
  const [storyError, setStoryError] = useState<string | null>(null)
  const [fixingInconsistencies, setFixingInconsistencies] = useState(false)
  const [fixResult, setFixResult] = useState<{ applied: number[]; structural: string[]; skipped: { number: number; reason: string }[]; summary: string } | null>(null)
  const [langReport, setLangReport] = useState('')
  const [langErrors, setLangErrors] = useState<any[]>([])
  const [langGenerating, setLangGenerating] = useState(false)
  const [langFixing, setLangFixing] = useState(false)
  const [langFixResult, setLangFixResult] = useState<number[]>([])
  const [fixingErrorKeys, setFixingErrorKeys] = useState<Set<string>>(new Set())
  const [ignoredErrorKeys, setIgnoredErrorKeys] = useState<Set<string>>(new Set())
  const [sectionPreview, setSectionPreview] = useState<{ number: number; content: string; errors: { original: string; type: string }[] } | null>(null)
  const [showCoverModal, setShowCoverModal] = useState(false)
  const [coverDescription, setCoverDescription] = useState('')
  const [coverStyle, setCoverStyle] = useState('realistic')
  const [coverIncludeProtagonist, setCoverIncludeProtagonist] = useState(false)
  const [protagonistInput, setProtagonistInput] = useState('')
  const [protagonistSaving, setProtagonistSaving] = useState(false)
  const [illustrationBibleInput, setIllustrationBibleInput] = useState('')
  const [illustrationBibleEn, setIllustrationBibleEn] = useState<string | null>(null)
  const [savingBible, setSavingBible] = useState(false)
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editHint, setEditHint] = useState('')
  const [editImages, setEditImages] = useState<Array<{ url?: string; description: string; description_fr?: string; style: string; includeProtagonist: boolean }>>(Array.from({ length: 4 }, () => ({ description: '', style: 'realistic', includeProtagonist: false })))
  const [editMusicUrl, setEditMusicUrl] = useState('')
  const [freesoundModal, setFreesoundModal] = useState<{ sectionType: string; onSelect?: (url: string) => void } | null>(null)
  const [narrationPanel, setNarrationPanel] = useState<{ sectionId: string; content: string } | null>(null)
  const [sectionSaving, setSectionSaving] = useState<string | null>(null)
  const [tab, setTab] = useState<'sections' | 'plan' | 'npcs' | 'fiche' | 'carte' | 'coherence' | 'objets' | 'intro' | 'fbi' | 'intro_order' | 'player_settings' | 'section_layout' | 'dialogue' | 'game_sim'>('sections')
  const [introGroupOpen, setIntroGroupOpen] = useState(false)
  const [introFrames, setIntroFrames] = useState<import('@/types').IntroFrame[]>(book?.intro_sequence ?? [])
  const [introAudioUrl, setIntroAudioUrl] = useState<string>(book?.intro_audio_url ?? '')
  const [introMusicPrompt, setIntroMusicPrompt] = useState(`dark cinematic intro, urban tension, ${book?.theme ?? ''}`)
  const [introGeneratingMusic, setIntroGeneratingMusic] = useState(false)
  const [introAudioBuster, setIntroAudioBuster] = useState(0)
  const [seqGenerating, setSeqGenerating] = useState(false)
  const [seqTranslating, setSeqTranslating] = useState<string | null>(null)
  const [seqImgGenerating, setSeqImgGenerating] = useState<string | null>(null)
  const [seqSaving, setSeqSaving] = useState(false)
  const [seqAllGenerating, setSeqAllGenerating] = useState(false)
  const [seqAllProgress, setSeqAllProgress] = useState<{ done: number; total: number; waitSec?: number } | null>(null)
  const [seqAllErrors, setSeqAllErrors] = useState<string[]>([])
  const [frameImageVersions, setFrameImageVersions] = useState<Record<string, number>>({})
  const [cardImageIndex, setCardImageIndex] = useState<Record<string, number>>({})
  const [frameVideoGenerating, setFrameVideoGenerating] = useState<Record<string, boolean>>({})
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  const [introViewer, setIntroViewer] = useState(false)
  const [items, setItems] = useState<import('@/types').Item[]>([])
  const [itemsLoaded, setItemsLoaded] = useState(false)
  const [editingItem, setEditingItem] = useState<string | null>(null) // item id or 'new'
  const [itemForm, setItemForm] = useState<Partial<import('@/types').Item>>({})
  const [itemSaving, setItemSaving] = useState(false)
  const [planHighlight, setPlanHighlight] = useState<number | null>(null)
  const [currentTrack, setCurrentTrack] = useState<{ url: string; label: string } | null>(null)
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
  const [editingTransition, setEditingTransition] = useState<string | null>(null) // choiceId
  const [transitionDraft, setTransitionDraft] = useState('')
  const [generatingTransition, setGeneratingTransition] = useState<string | null>(null) // choiceId
  const [editingReturn, setEditingReturn] = useState<string | null>(null) // choiceId
  const [returnDraft, setReturnDraft] = useState('')
  const [generatingReturn, setGeneratingReturn] = useState<string | null>(null) // choiceId
  const [illustratingAll, setIllustratingAll] = useState(false)
  const [illustrationProgress, setIllustrationProgress] = useState<{ current: number; total: number } | null>(null)
  const [writingAll, setWritingAll] = useState(false)
  const [resettingStructure, setResettingStructure] = useState(false)
  const [generatingReadTimes, setGeneratingReadTimes] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [consultingCompanion, setConsultingCompanion] = useState<string | null>(null) // "sectionId:npcId"
  const [sectionModal, setSectionModal] = useState<string | null>(null)
  const [previousSectionId, setPreviousSectionId] = useState<string | null>(null)
  const [sectionDetailId, setSectionDetailId] = useState<string | null>(null)
  const [sectionDetailTab, setSectionDetailTab] = useState<'resume' | 'compagnons' | 'conversation' | 'dialogues' | 'illustrations' | 'musique' | 'choix'>('resume')
  const [dialogueTestNpcId, setDialogueTestNpcId] = useState<string>('')
  const [dialogueTestQuestion, setDialogueTestQuestion] = useState<string>('')
  const [dialogueTestResult, setDialogueTestResult] = useState<{ npc_reply: string; test_result: string; suggested_choice_index: number | null } | null>(null)
  const [dialogueTestLoading, setDialogueTestLoading] = useState(false)
  // ── Conversation tab state ─────────────────────────────────────────────────
  const [convEditMode, setConvEditMode] = useState(false)
  const [convDraftQuestions, setConvDraftQuestions] = useState<string[]>([])
  const [convSavingQuestions, setConvSavingQuestions] = useState(false)
  const [convGeneratingFor, setConvGeneratingFor] = useState<string | null>(null)
  const [convResponseDrafts, setConvResponseDrafts] = useState<Record<string, string>>({})
  const [convSavedKey, setConvSavedKey] = useState<string | null>(null)
  const [convNpcVoiceForm, setConvNpcVoiceForm] = useState({ voice_id: '', voice_settings: { stability: 0.5, style: 0, speed: 1, similarity_boost: 0.75 }, voice_prompt: '' })
  const [convNpcVoiceSaving, setConvNpcVoiceSaving] = useState(false)
  const [convNpcVoiceSaved, setConvNpcVoiceSaved] = useState(false)
  const [convVoiceTestText, setConvVoiceTestText] = useState('')
  const [convVoicePlaying, setConvVoicePlaying] = useState(false)
  const [convGeneratingAll, setConvGeneratingAll] = useState(false)
  const [convGenerateProgress, setConvGenerateProgress] = useState('')
  const [convGenAudioFor, setConvGenAudioFor] = useState<string | null>(null)
  const [convPlayerAudioGen, setConvPlayerAudioGen] = useState<string | null>(null)
  const [convVoices, setConvVoices] = useState<{ voice_id: string; name: string; labels: Record<string, string>; preview_url: string | null }[]>([])
  const [convVoicesLoaded, setConvVoicesLoaded] = useState(false)
  const convVoiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const convCursorPosRef = useRef<Record<string, { start: number; end: number }>>({})

  // ── Mode Correction ────────────────────────────────────────────────────────
  const [correctionMode, setCorrectionMode] = useState(false)
  const [correctionPaths, setCorrectionPaths] = useState<string[][]>([])
  const [correctionPathIdx, setCorrectionPathIdx] = useState(0)
  const [correctionStepIdx, setCorrectionStepIdx] = useState(0)
  const [showCorrectionOverview, setShowCorrectionOverview] = useState(false)

  const [writeProgress, setWriteProgress] = useState<{ written: number; total: number } | null>(null)
  const [writeMessage, setWriteMessage] = useState<string | null>(null)
  const [imageProvider, setImageProvider] = useState<'replicate' | 'leonardo'>('replicate')
  const [generatingStructure, setGeneratingStructure] = useState(false)
  const [structureError, setStructureError] = useState('')
  const [structureResult, setStructureResult] = useState<{ sections_count: number; npcs_count: number; choices_count: number; validation?: { fixed: number; remaining_critical: number; log: string[] } } | null>(null)
  const [coherenceIssues, setCoherenceIssues] = useState<StructureIssue[] | null>(null)
  const [coherenceLoading, setCoherenceLoading] = useState(false)
  const [combatFixLoading, setCombatFixLoading] = useState(false)
  const [combatFixResult, setCombatFixResult] = useState<{ assigned: number; total: number; errors: string[] } | null>(null)
  const [loopFixLoading, setLoopFixLoading] = useState(false)
  const [loopFixResult, setLoopFixResult] = useState<{ fixed: number; total: number; errors: string[] } | null>(null)
  const [coherenceFixing, setCoherenceFixing] = useState<Set<string>>(new Set())
  const [coherenceInputs, setCoherenceInputs] = useState<Record<string, Record<string, string>>>({})
  const [coherenceFixed, setCoherenceFixed] = useState<Set<string>>(new Set())
  const [coherenceError, setCoherenceError] = useState<Record<string, string>>({})
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([])
  const [agentDone, setAgentDone] = useState(false)
  const [agentAfterGeneration, setAgentAfterGeneration] = useState(false)

  useEffect(() => {
    async function load() {
      const [bookRes, npcRes, locRes] = await Promise.all([
        fetch(`/api/books/${id}`),
        fetch(`/api/books/${id}/npcs`),
        fetch(`/api/books/${id}/locations`),
      ])
      if (!bookRes.ok) { setLoading(false); return }
      const { book: b, sections: s, choices: c } = await bookRes.json()
      const npcData = await npcRes.json()
      const locData = await locRes.json()
      setBook(b); setSections(s ?? []); setChoices(c ?? [])
      setIntroFrames(b.intro_sequence ?? [])
      setIntroAudioUrl(b.intro_audio_url ?? '')
      setIntroText(b.intro_text ?? '')
      setProtagonistInput(b.protagonist_description ?? '')
      setIllustrationBibleInput(b.illustration_bible ?? '')
      if (b.illustration_bible) {
        fetch(`/api/books/${id}/illustration-bible`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text_fr: b.illustration_bible }),
        }).then(r => r.json()).then(d => { if (d.illustration_bible_en) setIllustrationBibleEn(d.illustration_bible_en) }).catch(() => {})
      }
      if (b.story_analysis) setStorySummary(b.story_analysis)
      if (b.lang_analysis) {
        setLangReport(b.lang_analysis)
        // Reconstruire les erreurs structurées depuis le markdown pour les boutons individuels
        const parsedErrors = parseLangAnalysis(b.lang_analysis)
        // Charger les erreurs ignorées depuis localStorage
        const storedIgnored = JSON.parse(localStorage.getItem(`lang-ignored:${id}`) ?? '[]') as string[]
        const ignoredSet = new Set<string>(storedIgnored)
        setIgnoredErrorKeys(ignoredSet)
        // Filtrer les erreurs ignorées (clé = "sectionNum:original")
        const filtered = parsedErrors.map(s => ({
          ...s,
          errors: s.errors.filter((e: any) => !ignoredSet.has(`${s.number}:${e.original}`))
        })).filter((s: any) => s.errors.length > 0)
        if (filtered.length > 0) setLangErrors(filtered)
      }
      setNpcs(Array.isArray(npcData) ? npcData : [])
      setLocations(Array.isArray(locData) ? locData : [])
      setLoading(false)
    }
    load()
  }, [id])

  // ── Détection automatique des compagnons au chargement ───────────────────
  useEffect(() => {
    if (!sections.length || !npcs.length) return
    const companionEligible = npcs.filter(n => n.type === 'allié' || n.type === 'neutre')
    if (!companionEligible.length) return
    sections.forEach(section => {
      if (!section.content || (section.companion_npc_ids?.length ?? 0) > 0) return
      const found = companionEligible
        .filter(npc => new RegExp(`\\b${npc.name}\\b`, 'i').test(section.content))
        .map(npc => npc.id)
      if (!found.length) return
      setSections(ss => ss.map(s => s.id === section.id ? { ...s, companion_npc_ids: found } : s))
      fetch(`/api/sections/${section.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companion_npc_ids: found }),
      })
    })
  }, [sections.length, npcs.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initialiser l'état d'édition quand on ouvre une section en vue détail ──
  useEffect(() => {
    if (!sectionDetailId) return
    const sec = sections.find(s => s.id === sectionDetailId)
    if (!sec) return
    setEditContent(sec.content)
    setEditSummary(sec.summary ?? '')
    setEditHint(sec.hint_text ?? '')
    setEditMusicUrl(sec.music_url ?? '')
    const imgs = sec.images ?? []
    setEditImages(Array.from({ length: 4 }, (_, i) => ({ url: imgs[i]?.url, description: imgs[i]?.description ?? '', style: imgs[i]?.style ?? book?.illustration_style ?? 'realistic', includeProtagonist: false })))
    setEditingSection(sectionDetailId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionDetailId])

  // ── Auto-détection des compagnons à l'ouverture de l'onglet ─────────────
  useEffect(() => {
    if (sectionDetailTab !== 'compagnons' || !sectionDetailId) return
    const sec = sections.find(s => s.id === sectionDetailId)
    if (!sec?.content) return
    const excluded = sec.companion_npc_excluded ?? []
    const detected = npcs.filter(n => sec.content.includes(n.name) && !excluded.includes(n.id)).map(n => n.id)
    if (detected.length === 0) return
    const current = sec.companion_npc_ids ?? []
    const merged = [...new Set([...current, ...detected])]
    if (merged.length === current.length && merged.every(id => current.includes(id))) return
    fetch(`/api/sections/${sectionDetailId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companion_npc_ids: merged }) }).then(() => {
      setSections(prev => prev.map(s => s.id === sectionDetailId ? { ...s, companion_npc_ids: merged } : s))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionDetailTab, sectionDetailId])

  // ── Antidote : activation dynamique quand on entre en mode édition ────────
  useEffect(() => {
    if (!editingSection) return

    const syncCallback = () => {
      const textarea = document.querySelector(
        'textarea[data-antidoteapi_jsconnect_groupe_id="hero_section"]'
      ) as HTMLTextAreaElement | null
      if (textarea) {
        const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        if (nativeSet) {
          nativeSet.call(textarea, textarea.value)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
      const input = document.querySelector(
        'input[data-antidoteapi_jsconnect_groupe_id="hero_section"]'
      ) as HTMLInputElement | null
      if (input) {
        const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        if (nativeSet) {
          nativeSet.call(input, input.value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
    }

    // L'extension peut injecter la fonction après le rendu — on réessaie jusqu'à 2s
    let attempts = 0
    const tryActivate = () => {
      const fn = (window as any).activeAntidoteAPI_JSConnect
      if (typeof fn === 'function') {
        fn(syncCallback)
      } else if (attempts++ < 10) {
        setTimeout(tryActivate, 200)
      }
    }
    tryActivate()
  }, [editingSection])

  // ── Détection section visible → changement de piste ──────────────────────
  useEffect(() => {
    if (tab !== 'sections' || sections.length === 0) return
    const observer = new IntersectionObserver(entries => {
      // Prendre la section la plus visible
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (!visible) return
      const num = parseInt(visible.target.getAttribute('data-section-number') ?? '0')
      const section = sections.find(s => s.number === num)
      if (!section) return
      const typeLabel = getSectionType(section).label
      const url = section.music_url || DEFAULT_MUSIC[typeLabel] || null
      const label = `${getSectionType(section).icon} §${num} — ${typeLabel}`
      if (url) setCurrentTrack(t => t?.url === url ? t : { url, label })
    }, { threshold: 0.4 })

    sections.forEach(s => {
      const el = document.getElementById(`sec-${s.number}`)
      if (el) { el.setAttribute('data-section-number', String(s.number)); observer.observe(el) }
    })
    return () => observer.disconnect()
  }, [tab, sections])

  // ── Conversation tab side-effects ──────────────────────────────────────────
  useEffect(() => {
    setConvEditMode(false)
    setConvDraftQuestions([])
    setConvResponseDrafts({})
    setConvSavedKey(null)
    setConvVoiceTestText('')
    setDialogueTestResult(null)
    setDialogueTestNpcId('')
    setConvGeneratingAll(false)
    setConvGenerateProgress('')
    setConvGenAudioFor(null)
  }, [sectionDetailId])

  useEffect(() => {
    const npc = dialogueTestNpcId ? npcs.find(n => n.id === dialogueTestNpcId) : (npcs.find(n => n.id === npcs[0]?.id) ?? null)
    if (npc) setConvNpcVoiceForm({ voice_id: npc.voice_id ?? '', voice_settings: npc.voice_settings ?? { stability: 0.5, style: 0, speed: 1, similarity_boost: 0.75 }, voice_prompt: npc.voice_prompt ?? '' })
  }, [dialogueTestNpcId])

  // Recharge les drafts depuis la BDD à chaque changement de PNJ sélectionné
  useEffect(() => {
    if (!dialogueTestNpcId || sectionDetailTab !== 'conversation') { setConvResponseDrafts({}); return }
    const sec = sections.find(s => s.id === sectionDetailId)
    const saved: Record<string, string> = (sec as any)?.player_responses?.[dialogueTestNpcId] ?? {}
    const qs: string[] = sec?.player_questions ?? []
    const drafts: Record<string, string> = {}
    for (const q of qs) { if (saved[q]) drafts[q] = saved[q] }
    setConvResponseDrafts(drafts)
  }, [dialogueTestNpcId, sectionDetailId, sectionDetailTab])

  useEffect(() => {
    if (convVoicesLoaded) return
    fetch('/api/elevenlabs/voices').then(r => r.json()).then(d => { if (d.voices) setConvVoices(d.voices) }).catch(() => {}).finally(() => setConvVoicesLoaded(true))
  }, [convVoicesLoaded])

  // ── Auto-sélection premier PNJ qui parle ───────────────────────────────────
  useEffect(() => {
    if (sectionDetailTab !== 'conversation' || !sectionDetailId) return
    const sec = sections.find(s => s.id === sectionDetailId)
    if (!sec || (sec as any).conv_first_npc_id) return
    const alliedInSection = npcs.filter(n => (sec.companion_npc_ids ?? []).includes(n.id) && n.type === 'allié')
    if (alliedInSection.length === 0) return
    const picked = alliedInSection[Math.floor(Math.random() * alliedInSection.length)]
    fetch(`/api/sections/${sec.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conv_first_npc_id: picked.id }) }).catch(() => {})
    setSections(prev => prev.map(s => s.id === sec.id ? { ...s, conv_first_npc_id: picked.id } as any : s))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionDetailTab, sectionDetailId])

  // ── Actions livre ──────────────────────────────────────────────────────────

  async function deleteBook() {
    setBookSaving(true)
    await fetch(`/api/books/${id}`, { method: 'DELETE' })
    router.push('/')
  }

  async function updateBookStatus(status: string) {
    setBookSaving(true)
    await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book_id: id, status }) })
    setBook(b => b ? { ...b, status: status as any } : b)
    setBookSaving(false)
  }

  async function saveTitle() {
    const t = titleInput.trim()
    if (!t || t === book?.title) { setEditingTitle(false); return }
    setBookSaving(true)
    await fetch(`/api/books/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) })
    setBook(b => b ? { ...b, title: t } : b)
    setBookSaving(false)
    setEditingTitle(false)
  }

  // ── Génération de la structure ─────────────────────────────────────────────

  async function generateStructure() {
    setGeneratingStructure(true)
    setStructureError('')
    try {
      const res = await fetch(`/api/books/${id}/generate-sections`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setStructureResult(data)
      // Recharger book + sections + PNJ + lieux
      const [bookRes, npcRes, locRes] = await Promise.all([
        fetch(`/api/books/${id}`),
        fetch(`/api/books/${id}/npcs`),
        fetch(`/api/books/${id}/locations`),
      ])
      if (bookRes.ok) {
        const { book: b, sections: s, choices: c } = await bookRes.json()
        setBook(b); setSections(s ?? []); setChoices(c ?? [])
      }
      if (npcRes.ok) { const d = await npcRes.json(); setNpcs(Array.isArray(d) ? d : []) }
      if (locRes.ok) { const d = await locRes.json(); setLocations(Array.isArray(d) ? d : []) }
      if (agentAfterGeneration) {
        setTab('coherence')
        runAgentRepair()
      }
    } catch (err: any) {
      setStructureError(err.message)
    } finally {
      setGeneratingStructure(false)
    }
  }

  // ── Analyse de cohérence structurelle ─────────────────────────────────────

  async function analyzeCoherence() {
    setCoherenceLoading(true)
    try {
      const res = await fetch(`/api/books/${id}/analyze-structure`)
      const data = await res.json()
      setCoherenceIssues(data.issues ?? [])
      setCoherenceFixed(new Set())
      setCoherenceInputs({})
      setCoherenceError({})
    } finally {
      setCoherenceLoading(false)
    }
  }

  async function fixSelfLoops() {
    setLoopFixLoading(true)
    setLoopFixResult(null)
    try {
      const res = await fetch(`/api/books/${id}/fix-self-loops`, { method: 'POST' })
      const data = await res.json()
      setLoopFixResult(data)
      if (data.ok) analyzeCoherence()
    } finally {
      setLoopFixLoading(false)
    }
  }

  async function fixCombatEnemies() {
    setCombatFixLoading(true)
    setCombatFixResult(null)
    try {
      const res = await fetch(`/api/books/${id}/fix-combat-enemies`, { method: 'POST' })
      const data = await res.json()
      setCombatFixResult(data)
      if (data.ok) analyzeCoherence()
    } finally {
      setCombatFixLoading(false)
    }
  }

  async function applyCoherenceFix(issue: StructureIssue, customParams?: Record<string, any>) {
    const action = customParams ? (issue.manual?.action ?? issue.autofix?.action) : issue.autofix?.action
    const params = customParams
      ? { ...(issue.manual?.static_params ?? {}), ...customParams }
      : issue.autofix?.params
    if (!action || !params) return
    setCoherenceFixing(prev => new Set([...prev, issue.id]))
    setCoherenceError(prev => { const e = { ...prev }; delete e[issue.id]; return e })
    try {
      const res = await fetch(`/api/books/${id}/analyze-structure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params }),
      })
      const data = await res.json()
      if (data.ok) {
        setCoherenceFixed(prev => new Set([...prev, issue.id]))
      } else {
        setCoherenceError(prev => ({ ...prev, [issue.id]: data.error ?? 'Erreur inconnue' }))
      }
    } catch (e: any) {
      setCoherenceError(prev => ({ ...prev, [issue.id]: e.message }))
    } finally {
      setCoherenceFixing(prev => { const s = new Set(prev); s.delete(issue.id); return s })
    }
  }

  async function runAgentRepair() {
    setAgentRunning(true)
    setAgentDone(false)
    setAgentLog([])
    try {
      const res = await fetch(`/api/books/${id}/agent-repair`, { method: 'POST' })
      if (!res.body) throw new Error('Pas de stream')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const entry: AgentLogEntry = { ...JSON.parse(line.slice(6)), ts: Date.now() }
            setAgentLog(prev => [...prev, entry])
            if (entry.type === 'done' || entry.type === 'error') {
              setAgentDone(true)
              // Reload sections after agent finishes
              const bookRes = await fetch(`/api/books/${id}`)
              if (bookRes.ok) {
                const { book: b, sections: s, choices: c } = await bookRes.json()
                setBook(b); setSections(s ?? []); setChoices(c ?? [])
              }
              // Re-analyze
              analyzeCoherence()
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setAgentLog(prev => [...prev, { type: 'error', message: err.message, ts: Date.now() }])
    } finally {
      setAgentRunning(false)
    }
  }

  // ── Agent illustrations ─────────────────────────────────────────────────────

  function illustrateAll() {
    if (illustratingAll) return
    setIllustratingAll(true)
    setIllustrationProgress(null)

    const es = new EventSource(`/api/books/${id}/illustrate-all?provider=${imageProvider}`)
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'start') {
        setIllustrationProgress({ current: 0, total: msg.total })
      } else if (msg.type === 'progress') {
        setIllustrationProgress({ current: msg.current, total: msg.total })
        if (msg.status === 'done' && msg.imageUrl) {
          setSections(prev => prev.map(s =>
            s.number === msg.sectionNumber ? { ...s, image_url: msg.imageUrl } : s
          ))
        }
      } else if (msg.type === 'done' || msg.type === 'error') {
        es.close()
        setIllustratingAll(false)
        if (msg.type === 'done') setIllustrationProgress(null)
      }
    }
    es.onerror = () => { es.close(); setIllustratingAll(false) }
  }

  // ── Rédaction Mistral ──────────────────────────────────────────────────────

  async function writeAll(overwrite = false) {
    setWritingAll(true)
    setWriteProgress(null)
    setWriteMessage(null)
    try {
      const res = await fetch(`/api/books/${id}/write-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, overwrite }),
      })
      if (!res.body) throw new Error('Pas de stream')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'start') setWriteProgress({ written: 0, total: ev.total })
            if (ev.type === 'section_done') {
              setWriteProgress({ written: ev.written, total: ev.total })
              setSections(ss => ss.map(s => s.number === ev.number ? { ...s, content: s.content || '…' } : s))
            }
            if (ev.type === 'done') setWriteMessage(`✅ ${ev.written}/${ev.total} sections rédigées`)
            if (ev.type === 'error') setWriteMessage(`❌ ${ev.message}`)
          } catch {}
        }
      }
      // Reload sections after writing
      const res2 = await fetch(`/api/books/${id}`)
      if (res2.ok) {
        const { sections: s2, choices: c2 } = await res2.json()
        if (s2) setSections(s2)
        if (c2) setChoices(c2)
      }
    } catch (err: any) {
      setWriteMessage(`❌ ${err.message}`)
    } finally {
      setWritingAll(false)
      setWriteProgress(null)
    }
  }

  // ── Réinitialisation structure ─────────────────────────────────────────────

  async function resetStructure() {
    if (!confirm('⚠️ Réinitialiser la structure ?\n\nCela supprimera toutes les sections, choix, PNJ et lieux générés. Cette action est irréversible.')) return
    setResettingStructure(true)
    try {
      const res = await fetch(`/api/books/${id}/reset-structure`, { method: 'POST' })
      if (!res.ok) {
        const { error } = await res.json()
        alert(`Erreur : ${error}`)
        return
      }
      // Reload the book
      const res2 = await fetch(`/api/books/${id}`)
      if (res2.ok) {
        const { book: b, sections: s, choices: c } = await res2.json()
        setBook(b); setSections(s ?? []); setChoices(c ?? [])
      }
      setWriteMessage(null)
    } catch (err: any) {
      alert(`Erreur : ${err.message}`)
    } finally {
      setResettingStructure(false)
    }
  }

  // ── Génération temps de lecture ────────────────────────────────────────────

  async function generateReadTimes() {
    setGeneratingReadTimes(true)
    try {
      const res = await fetch(`/api/books/${id}/generate-read-times`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { alert(`Erreur : ${data.error}`); return }
      // Reload sections pour afficher les nouvelles valeurs
      const res2 = await fetch(`/api/books/${id}`)
      if (res2.ok) {
        const { sections: s2 } = await res2.json()
        if (s2) setSections(s2)
      }
      setWriteMessage(`⏱ ${data.updated} sections mises à jour, ${data.with_initiative} textes d'initiative générés`)
    } catch (err: any) {
      alert(`Erreur : ${err.message}`)
    } finally {
      setGeneratingReadTimes(false)
    }
  }

  // ── Consultation de compagnon ──────────────────────────────────────────────

  async function consultCompanion(sectionId: string, npcId: string) {
    const key = `${sectionId}:${npcId}`
    setConsultingCompanion(key)
    try {
      const res = await fetch(`/api/sections/${sectionId}/consult-companion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npc_id: npcId }),
      })
      const data = await res.json()
      if (!res.ok) { alert(`Erreur : ${data.error}`); return }
      // Mise à jour du state local sans rechargement
      setSections(ss => [...ss, data.new_section])
      setChoices(cc => [...cc, data.choice_in_source, ...data.choices_in_new_section])
      // Ouvrir la nouvelle section
      setExpandedSections(s => new Set([...s, data.new_section.id]))
    } catch (err: any) {
      alert(`Erreur : ${err.message}`)
    } finally {
      setConsultingCompanion(null)
    }
  }

  // ── Détection textuelle des compagnons ─────────────────────────────────────

  function detectCompanionsInText(sectionId: string, content: string) {
    const companionEligible = npcs // tous les types de PNJ
    const found = companionEligible
      .filter(npc => content && new RegExp(`\\b${npc.name}\\b`, 'i').test(content))
      .map(npc => npc.id)
    if (found.length === 0) return
    setSections(ss => ss.map(s => s.id === sectionId ? { ...s, companion_npc_ids: [...new Set([...(s.companion_npc_ids ?? []), ...found])] } : s))
    fetch(`/api/sections/${sectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companion_npc_ids: [...new Set([...(sections.find(s => s.id === sectionId)?.companion_npc_ids ?? []), ...found])] }),
    })
  }

  // ── Actions section ────────────────────────────────────────────────────────

  async function saveSection(sectionId: string) {
    setSectionSaving(sectionId)
    const cleanImages = editImages
      .filter(img => img.url || img.description.trim())
      .map(img => ({ url: img.url, description: img.description, style: img.style as any }))
    const cleanMusicUrl = editMusicUrl.trim() || undefined
    const body: Record<string, any> = { content: editContent, summary: editSummary, hint_text: editHint.trim() || null, images: cleanImages, music_url: editMusicUrl.trim() || null }
    await fetch(`/api/sections/${sectionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSections(ss => ss.map(s => s.id === sectionId ? { ...s, content: editContent, summary: editSummary, hint_text: editHint.trim() || undefined, music_url: cleanMusicUrl, images: cleanImages } : s))
    setEditingSection(null); setSectionSaving(null)
  }

  async function updateSectionStatus(sectionId: string, status: SectionStatus) {
    setSectionSaving(sectionId)
    await fetch(`/api/sections/${sectionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    setSections(ss => ss.map(s => s.id === sectionId ? { ...s, status } : s))
    setSectionSaving(null)
  }

  // ── Mode Correction : algorithme + navigation ────────────────────────────
  function computeAllPaths(): string[][] {
    const start = sections.find(s => s.number === 1)
    if (!start) return []
    const adj = new Map<string, string[]>()
    for (const c of choices) {
      if (!c.target_section_id) continue
      const list = adj.get(c.section_id) ?? []
      if (!list.includes(c.target_section_id)) { list.push(c.target_section_id); adj.set(c.section_id, list) }
    }
    const paths: string[][] = []
    const MAX_PATHS = 60
    function dfs(nodeId: string, path: string[], visited: Set<string>) {
      if (paths.length >= MAX_PATHS) return
      const nexts = (adj.get(nodeId) ?? []).filter(id => !visited.has(id))
      if (nexts.length === 0) { paths.push([...path]); return }
      for (const nextId of nexts) {
        if (paths.length >= MAX_PATHS) return
        visited.add(nextId); dfs(nextId, [...path, nextId], visited); visited.delete(nextId)
      }
    }
    dfs(start.id, [start.id], new Set([start.id]))
    return paths.sort((a, b) => {
      const unvalidated = (p: string[]) => p.filter(id => sections.find(s => s.id === id)?.status !== 'validated').length
      return unvalidated(b) - unvalidated(a)
    })
  }

  function openSectionInModal(sectionId: string) {
    const s = sections.find(sec => sec.id === sectionId)
    if (!s || !book) return
    setSectionModal(sectionId); setEditingSection(sectionId)
    setEditContent(s.content); setEditSummary(s.summary ?? ''); setEditHint(s.hint_text ?? ''); setEditMusicUrl(s.music_url ?? '')
    const imgs = s.images ?? []
    setEditImages(Array.from({ length: 4 }, (_, i) => ({ url: imgs[i]?.url, description: imgs[i]?.description ?? '', description_fr: (imgs[i] as any)?.description_fr, style: imgs[i]?.style ?? book.illustration_style ?? 'realistic', includeProtagonist: false })))
  }

  function startCorrectionPath(pathIdx: number) {
    setShowCorrectionOverview(false)
    setCorrectionPathIdx(pathIdx)
    const path = correctionPaths[pathIdx]
    const firstStep = Math.max(0, path.findIndex(id => sections.find(s => s.id === id)?.status !== 'validated'))
    setCorrectionStepIdx(firstStep)
    setCorrectionMode(true)
    openSectionInModal(path[firstStep])
  }

  async function correctionValidateAndNext() {
    const currentId = correctionPaths[correctionPathIdx]?.[correctionStepIdx]
    if (!currentId) return
    await saveSection(currentId)
    await updateSectionStatus(currentId, 'validated')
    advanceCorrectionStep()
  }

  function advanceCorrectionStep() {
    const path = correctionPaths[correctionPathIdx]
    const nextStep = correctionStepIdx + 1
    if (nextStep < path.length) {
      setCorrectionStepIdx(nextStep); openSectionInModal(path[nextStep])
    } else {
      // Fin du parcours — retour à l'overview avec chemins recalculés
      setSectionModal(null); setCorrectionMode(false)
      const newPaths = computeAllPaths(); setCorrectionPaths(newPaths)
      setShowCorrectionOverview(true)
    }
  }

  function correctionPrev() {
    if (correctionStepIdx === 0) return
    const prevStep = correctionStepIdx - 1
    setCorrectionStepIdx(prevStep); openSectionInModal(correctionPaths[correctionPathIdx][prevStep])
  }

  function quitCorrectionMode() {
    setCorrectionMode(false); setSectionModal(null); setShowCorrectionOverview(false)
  }

  function scrollToSection(number: number) {
    // Si la section cible est masquée par le filtre actif, on le désactive
    const target = sections.find(s => s.number === number)
    if (target && activeFilters.size > 0 && !activeFilters.has(getSectionType(target).label)) {
      setActiveFilters(new Set())
    }
    const doScroll = () =>
      document.getElementById(`sec-${number}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Si l'élément est déjà dans le DOM (même onglet), scroll immédiat
    if (document.getElementById(`sec-${number}`)) { doScroll() }
    // Sinon, attendre le prochain rendu (changement d'onglet ou suppression du filtre)
    else { setTimeout(doScroll, 80) }
  }

  const sectionChoices = (sectionId: string) =>
    choices.filter(c => c.section_id === sectionId).sort((a, b) => a.sort_order - b.sort_order)

  if (loading) return <p style={{ color: 'var(--muted)' }}>Chargement...</p>
  if (!book) return <p style={{ color: 'var(--danger)' }}>Livre introuvable.</p>

  const validated = sections.filter(s => s.status === 'validated').length
  const inProgress = sections.filter(s => s.status === 'in_progress').length

  return (
    <>
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0d0d0d' }}>
      {/* ── Lecteur audio flottant ──────────────────────────────────────────── */}
      <AudioPlayer trackUrl={currentTrack?.url ?? null} trackLabel={currentTrack?.label ?? ''} />

      {/* ── Secondary Sidebar (collapsed to icons when viewing section detail) ── */}
      {sectionDetailId ? (
        <aside style={{
          width: '52px', background: 'var(--sidebar-bg, #141416)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '0.75rem 0', gap: '0.4rem', flexShrink: 0,
        }}>
          <button onClick={() => setSectionDetailId(null)} title="Retour au storyboard"
            style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
          <div style={{ width: '28px', height: '1px', background: '#333', margin: '0.2rem 0' }} />
          {([
            { key: 'sections' as const,    icon: '📋', title: 'Storyboard' },
            { key: 'plan' as const,        icon: '📊', title: 'Plan' },
            { key: 'coherence' as const,   icon: '🔍', title: 'Cohérence' },
            { key: 'intro_order' as const, icon: '🗂', title: 'Intro — Ordre & timing' },
            { key: 'intro' as const,       icon: '🎬', title: 'Animatic' },
            { key: 'fbi' as const,         icon: '🖥', title: 'Intro FBI' },
            { key: 'fiche' as const,       icon: '🃏', title: 'Fiche personnage' },
            { key: 'npcs' as const,        icon: '👥', title: 'Personnages' },
            { key: 'objets' as const,      icon: '🎒', title: 'Objets' },
          ]).map(item => (
            <button key={item.key} onClick={() => { setTab(item.key); setSectionDetailId(null) }} title={item.title}
              style={{ width: '36px', height: '36px', borderRadius: '8px', background: tab === item.key ? 'var(--surface-2)' : 'none', border: 'none', color: tab === item.key ? 'var(--foreground)' : 'var(--muted)', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {item.icon}
            </button>
          ))}
        </aside>
      ) : (
        <aside style={{
          width: '220px', background: 'var(--sidebar-bg, #141416)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          flexShrink: 0, overflow: 'hidden',
        }}>
          {/* Book cover + title compact */}
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
            <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.72rem', padding: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              ← Bibliothèque
            </button>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              {book.cover_image_url
                ? <img src={book.cover_image_url} alt="" style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                : <div style={{ width: '36px', height: '36px', borderRadius: '4px', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '1rem' }}>🎨</div>
              }
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book.title}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{book.context_type} · {book.age_range} ans</div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav style={{ padding: '0.75rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.15rem', flexGrow: 1, height: 0, overflowY: 'auto' }}>
            {([
              { key: 'sections' as const, icon: '📋', label: 'Storyboard', sub: sections.length ? `${sections.length} sections` : '' },
              { key: 'plan' as const,     icon: '📊', label: 'Plan graphique', sub: '' },
              { key: 'coherence' as const,icon: '🔍', label: 'Cohérence', sub: coherenceIssues ? `${coherenceIssues.filter(i => !coherenceFixed.has(i.id) && i.severity === 'critical').length} critiques` : '' },
            ]).map(item => (
              <button key={item.key} onClick={() => setTab(item.key)} style={{
                display: 'flex', alignItems: 'center', gap: '0.65rem',
                padding: '0.55rem 0.75rem', borderRadius: '7px',
                background: tab === item.key ? 'var(--surface-2)' : 'transparent',
                border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                borderLeft: tab === item.key ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
                <span style={{ fontSize: '0.95rem' }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: tab === item.key ? 'bold' : 'normal', color: tab === item.key ? 'var(--foreground)' : 'var(--muted)' }}>{item.label}</div>
                  {item.sub && <div style={{ fontSize: '0.63rem', color: 'var(--muted)' }}>{item.sub}</div>}
                </div>
              </button>
            ))}

            <div style={{ height: '1px', background: 'var(--border)', margin: '0.5rem 0.25rem' }} />

            {/* Personnages, Objets, Carte */}
            {([
              { key: 'npcs' as const,    icon: '👥', label: 'Personnages', sub: `${npcs.length} PNJ` },
              { key: 'objets' as const,  icon: '🎒', label: 'Objets', sub: items.length ? `${items.length} objets` : '' },
              ...(book.map_style ? [{ key: 'carte' as const, icon: '🗺', label: 'Carte', sub: `${locations.length} lieux` }] : []),
            ]).map(item => (
              <button key={item.key} onClick={() => setTab(item.key)} style={{
                display: 'flex', alignItems: 'center', gap: '0.65rem',
                padding: '0.55rem 0.75rem', borderRadius: '7px',
                background: tab === item.key ? 'var(--surface-2)' : 'transparent',
                border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                borderLeft: tab === item.key ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
                <span style={{ fontSize: '0.95rem' }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: tab === item.key ? 'bold' : 'normal', color: tab === item.key ? 'var(--foreground)' : 'var(--muted)' }}>{item.label}</div>
                  {item.sub && <div style={{ fontSize: '0.63rem', color: 'var(--muted)' }}>{item.sub}</div>}
                </div>
              </button>
            ))}

            <div style={{ height: '1px', background: 'var(--border)', margin: '0.5rem 0.25rem' }} />

            {/* Groupe Intro — collapsible */}
            <button onClick={() => setIntroGroupOpen(v => !v)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.25rem 0.75rem 0.1rem', fontSize: '0.63rem', color: 'var(--muted)',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              background: 'transparent', border: 'none', cursor: 'pointer', width: '100%',
            }}>
              <span>Intro</span>
              <span style={{ fontSize: '0.7rem', transition: 'transform 0.2s', display: 'inline-block', transform: introGroupOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
            </button>
            {introGroupOpen && ([
              { key: 'intro_order' as const,      icon: '🗂', label: 'Ordre & timing', sub: '' },
              { key: 'intro' as const,            icon: '🎬', label: 'Animatic', sub: introFrames.length ? `${introFrames.length} frames` : '' },
              { key: 'fbi' as const,              icon: '🖥', label: 'Intro FBI', sub: '' },
              { key: 'fiche' as const,            icon: '🃏', label: 'Fiche personnage', sub: book.protagonist_npc_id ? '✓' : '' },
              { key: 'player_settings' as const,  icon: '⚙', label: 'Préférences joueur', sub: '' },
              { key: 'section_layout' as const,   icon: '📖', label: 'Écran section', sub: '' },
              { key: 'dialogue' as const,         icon: '🎭', label: 'Dialogue Manga', sub: '' },
              { key: 'game_sim' as const,         icon: '🎮', label: 'Simulation du jeu', sub: '' },
            ]).map(item => (
              <button key={item.key} onClick={() => setTab(item.key)} style={{
                display: 'flex', alignItems: 'center', gap: '0.55rem',
                padding: '0.45rem 0.75rem 0.45rem 1.25rem', borderRadius: '7px',
                background: tab === item.key ? 'var(--surface-2)' : 'transparent',
                border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                borderLeft: tab === item.key ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
                <span style={{ fontSize: '0.85rem' }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: tab === item.key ? 'bold' : 'normal', color: tab === item.key ? 'var(--foreground)' : 'var(--muted)' }}>{item.label}</div>
                  {item.sub && <div style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>{item.sub}</div>}
                </div>
              </button>
            ))}
          </nav>

          {/* Book status + progress at bottom */}
          {sections.length > 0 && (
            <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.4rem' }}>
                <span style={{ color: '#4caf7d' }}>{validated} ✓</span>
                <span style={{ color: '#c9a84c' }}>{inProgress} ⏳</span>
                <span>{sections.length - validated - inProgress} ○</span>
              </div>
              <div style={{ height: '4px', background: 'var(--surface-2)', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${(validated/sections.length)*100}%`, background: '#4caf7d' }} />
                <div style={{ width: `${(inProgress/sections.length)*100}%`, background: '#c9a84c' }} />
              </div>
            </div>
          )}
        </aside>
      )}

      {/* ── Section sub-nav panel (only when detail view active) ───────────── */}
      {sectionDetailId && tab === 'sections' && (() => {
        const detailSec = sections.find(s => s.id === sectionDetailId)
        if (!detailSec) return null
        const t = getSectionType(detailSec)
        const sc = SECTION_STATUS_CONFIG[detailSec.status ?? 'draft']
        const sChoices = choices.filter(c => c.section_id === sectionDetailId)
        const hasTrial = detailSec.trial && (detailSec.trial.success_section_id || detailSec.trial.failure_section_id)
        const secImages = (detailSec.images ?? []).filter(img => img.url)

        const companionCount = (detailSec.companion_npc_ids ?? []).length
        const autoDetectedCount = npcs.filter(n => detailSec.content && detailSec.content.includes(n.name)).length

        const subTabs: { key: typeof sectionDetailTab; icon: string; label: string; sub?: string }[] = [
          { key: 'resume',        icon: '📝', label: 'Résumé & Contenu', sub: detailSec.content ? `${Math.round(detailSec.content.length / 5)} mots` : undefined },
          { key: 'compagnons',    icon: '👥', label: 'Compagnons',       sub: companionCount ? `${companionCount} PNJ` : (autoDetectedCount ? `${autoDetectedCount} détecté${autoDetectedCount > 1 ? 's' : ''}` : undefined) },
          { key: 'conversation',  icon: '💬', label: 'Conversation',     sub: companionCount ? `${companionCount} PNJ` : undefined },
          { key: 'dialogues',     icon: '🗨', label: 'Dialogues',        sub: detailSec.dialogues?.length ? `${detailSec.dialogues.length} répliques` : undefined },
          { key: 'illustrations', icon: '🖼', label: 'Illustrations',    sub: secImages.length ? `${secImages.length} image${secImages.length > 1 ? 's' : ''}` : undefined },
          { key: 'musique',       icon: '🎵', label: 'Musique',          sub: detailSec.music_url ? '♪ piste' : undefined },
          { key: 'choix',         icon: '🔀', label: 'Choix & Épreuve',  sub: [sChoices.length ? `${sChoices.length} choix` : '', hasTrial ? 'épreuve' : ''].filter(Boolean).join(' · ') || undefined },
        ]

        return (
          <aside style={{
            width: '220px', background: 'var(--sidebar-bg)', borderRight: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
          }}>
            {/* Section header */}
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.6rem' }}>
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: t.color + '33', color: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0 }}>{t.icon}</div>
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--accent)' }}>§{String(detailSec.number).padStart(2, '0')}</div>
                  <div style={{ fontSize: '0.6rem', color: t.color }}>{t.label}</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: '0.55rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: sc.bg, color: sc.color, fontWeight: 'bold' }}>{sc.label}</span>
              </div>
              {detailSec.summary && (
                <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any }}>
                  {detailSec.summary}
                </p>
              )}
            </div>

            {/* Sub-section nav */}
            <nav style={{ flex: 1, padding: '0.6rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
              {subTabs.map(item => (
                <button key={item.key} onClick={() => setSectionDetailTab(item.key)} style={{
                  display: 'flex', alignItems: 'center', gap: '0.65rem',
                  padding: '0.6rem 0.75rem', borderRadius: '7px',
                  background: sectionDetailTab === item.key ? 'var(--surface-2)' : 'transparent',
                  border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                  borderLeft: sectionDetailTab === item.key ? '2px solid var(--accent)' : '2px solid transparent',
                }}>
                  <span style={{ fontSize: '0.95rem' }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: sectionDetailTab === item.key ? 'bold' : 'normal', color: sectionDetailTab === item.key ? 'var(--foreground)' : 'var(--muted)' }}>{item.label}</div>
                    {item.sub && <div style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>{item.sub}</div>}
                  </div>
                </button>
              ))}
            </nav>
          </aside>
        )
      })()}

      {/* ── Main area ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div style={{
          height: '56px', background: 'var(--topbar-bg, #111)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center',
          padding: '0 1.25rem', gap: '1rem', flexShrink: 0,
        }}>
          {/* Title */}
          {editingTitle ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input autoFocus value={titleInput} onChange={e => setTitleInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
                style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--accent)', background: 'var(--surface-2)', border: '1px solid var(--accent)', borderRadius: '6px', padding: '0.2rem 0.6rem', outline: 'none', width: '280px' }}
              />
              <button onClick={saveTitle} disabled={bookSaving} style={{ background: 'var(--accent)', color: '#0f0f14', border: 'none', borderRadius: '5px', padding: '0.25rem 0.6rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}>{bookSaving ? '...' : '✓'}</button>
              <button onClick={() => setEditingTitle(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
            </div>
          ) : (
            <button onClick={() => { setTitleInput(book.title); setEditingTitle(true) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: 0 }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--foreground)' }}>{book.title}</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', opacity: 0.5 }}>✏</span>
            </button>
          )}

          {/* Genre + status badges */}
          <span style={{ fontSize: '0.7rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '20px', padding: '0.15rem 0.6rem', color: 'var(--muted)' }}>{book.context_type}</span>
          <span style={{ fontSize: '0.7rem', background: book.status === 'published' ? '#4caf7d22' : 'var(--surface-2)', border: `1px solid ${book.status === 'published' ? '#4caf7d55' : 'var(--border)'}`, borderRadius: '20px', padding: '0.15rem 0.6rem', color: book.status === 'published' ? '#4caf7d' : 'var(--muted)' }}>{BOOK_STATUS_LABELS[book.status]}</span>

          <div style={{ flex: 1 }} />

          {/* Actions IA */}
          {sections.length > 0 && (<>
            {/* Provider selector */}
            <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: '6px', border: '1px solid var(--border)', overflow: 'hidden' }}>
              {(['replicate', 'leonardo'] as const).map(p => (
                <button key={p} onClick={() => setImageProvider(p)} style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', border: 'none', cursor: 'pointer', background: imageProvider === p ? 'var(--accent)' : 'transparent', color: imageProvider === p ? '#0f0f14' : 'var(--muted)', fontWeight: imageProvider === p ? 'bold' : 'normal' }}>
                  {p === 'replicate' ? '⚡' : '🎨'} {p}
                </button>
              ))}
            </div>

            <button
              onClick={() => writeAll(false)}
              disabled={writingAll || illustratingAll}
              style={{ padding: '0.3rem 0.75rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: writingAll ? 'var(--muted)' : 'var(--foreground)', cursor: writingAll ? 'default' : 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              {writingAll ? `✍ ${writeProgress ? `${writeProgress.written}/${writeProgress.total}` : '…'}` : '✍ Rédiger'}
            </button>

            <button
              onClick={illustrateAll}
              disabled={illustratingAll || writingAll}
              style={{ padding: '0.3rem 0.75rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: illustratingAll ? 'var(--muted)' : 'var(--foreground)', cursor: illustratingAll ? 'default' : 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              {illustratingAll ? '🖼 Illustration…' : '🖼 Illustrer'}
            </button>
          </>)}

          {/* Overflow menu */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setStoryPanel(true)} style={{ padding: '0.3rem 0.6rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem' }}>···</button>
          </div>
        </div>

        {/* ── Content area ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: (tab === 'fiche' || tab === 'player_settings' || tab === 'section_layout' || tab === 'dialogue' || tab === 'game_sim') ? 'hidden' : 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, padding: (tab === 'fiche' || tab === 'player_settings' || tab === 'section_layout' || tab === 'dialogue' || tab === 'game_sim') ? 0 : '1.5rem', overflow: (tab === 'fiche' || tab === 'player_settings' || tab === 'section_layout' || tab === 'dialogue' || tab === 'game_sim') ? 'hidden' : 'visible', display: (tab === 'fiche' || tab === 'player_settings' || tab === 'section_layout' || tab === 'dialogue' || tab === 'game_sim') ? 'flex' : 'block', flexDirection: 'column' }}>
      {/* ── Section detail view (sub-tab content) ───────────────────────────── */}
      {tab === 'sections' && sectionDetailId && (() => {
        const detailSec = sections.find(s => s.id === sectionDetailId)
        if (!detailSec) return null
        const t = getSectionType(detailSec)
        const sc = SECTION_STATUS_CONFIG[detailSec.status ?? 'draft']
        const secImages = (detailSec.images ?? []).filter(img => img.url)
        const isSaving = sectionSaving === detailSec.id
        const sChoices = choices.filter(c => c.section_id === sectionDetailId).sort((a, b) => a.sort_order - b.sort_order)
        const hasTrial = detailSec.trial && (detailSec.trial.success_section_id || detailSec.trial.failure_section_id)

        const labelStyle: React.CSSProperties = { fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 'bold', marginBottom: '0.6rem' }
        const detailCompanionIds: string[] = detailSec.companion_npc_ids ?? []
        const detailExcludedIds: string[] = detailSec.companion_npc_excluded ?? []
        const autoDetectedNpcIds = npcs
          .filter(n => detailSec.content && detailSec.content.includes(n.name) && !detailExcludedIds.includes(n.id))
          .map(n => n.id)

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '860px' }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: t.color + '33', color: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>{t.icon}</div>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--accent)', lineHeight: 1 }}>§{String(detailSec.number).padStart(2, '0')}</div>
                <div style={{ fontSize: '0.65rem', color: t.color }}>{t.label}</div>
              </div>
              <span style={{ fontSize: '0.65rem', padding: '0.18rem 0.55rem', borderRadius: '20px', background: sc.bg, color: sc.color, fontWeight: 'bold' }}>{sc.label}</span>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                {(['draft', 'in_progress', 'validated'] as SectionStatus[]).map(s => (
                  <button key={s} onClick={() => updateSectionStatus(detailSec.id, s)} disabled={isSaving || detailSec.status === s}
                    style={{ fontSize: '0.65rem', padding: '0.22rem 0.55rem', borderRadius: '5px', border: `1px solid ${SECTION_STATUS_CONFIG[s].color}`, background: detailSec.status === s ? SECTION_STATUS_CONFIG[s].bg : 'transparent', color: SECTION_STATUS_CONFIG[s].color, cursor: detailSec.status === s ? 'default' : 'pointer' }}>
                    {SECTION_STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Sub-tab: Résumé & Contenu (édition directe) ── */}
            {sectionDetailTab === 'resume' && (<>
              {/* Résumé */}
              <div style={{ background: 'var(--surface)', border: `1px solid ${t.color}33`, borderLeft: `3px solid ${t.color}`, borderRadius: '8px', padding: '1rem 1.25rem' }}>
                <div style={labelStyle}>Résumé</div>
                <textarea
                  value={editSummary}
                  onChange={e => setEditSummary(e.target.value)}
                  rows={3}
                  placeholder="Résumé de la section…"
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.65rem 0.85rem', color: 'var(--foreground)', fontSize: '0.9rem', resize: 'vertical', outline: 'none', fontFamily: 'Georgia, serif', boxSizing: 'border-box', lineHeight: 1.6 }}
                />
              </div>

              {/* Contenu narratif */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <div style={labelStyle}>Texte narratif</div>
                  <button onClick={() => setNarrationPanel({ sectionId: detailSec.id, content: editContent })}
                    style={{ fontSize: '0.65rem', padding: '0.2rem 0.55rem', borderRadius: '5px', background: '#b48edd22', border: '1px solid #b48edd44', color: '#b48edd', cursor: 'pointer' }}>✨ Narration IA</button>
                </div>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={14}
                  placeholder="Texte narratif de la section…"
                  data-antidoteapi_jsconnect_groupe_id="hero_section"
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem 1rem', color: 'var(--foreground)', fontSize: '0.92rem', resize: 'vertical', outline: 'none', fontFamily: 'Georgia, serif', boxSizing: 'border-box', lineHeight: 1.8 }}
                />
              </div>

              {/* Astuce */}
              <div style={{ background: 'var(--surface)', border: '1px solid #f0a74233', borderLeft: '3px solid #f0a742', borderRadius: '8px', padding: '1rem 1.25rem' }}>
                <div style={labelStyle}>Astuce / Indice</div>
                <textarea
                  value={editHint}
                  onChange={e => setEditHint(e.target.value)}
                  rows={2}
                  placeholder="Astuce affichée au joueur…"
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem 0.75rem', color: 'var(--foreground)', fontSize: '0.85rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: 1.6 }}
                />
              </div>

              {/* Bouton Sauvegarder */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => saveSection(detailSec.id)}
                  disabled={isSaving}
                  style={{ padding: '0.55rem 1.5rem', background: 'var(--accent)', color: '#0f0f14', border: 'none', borderRadius: '8px', cursor: isSaving ? 'default' : 'pointer', fontWeight: 'bold', fontSize: '0.9rem', opacity: isSaving ? 0.6 : 1 }}
                >
                  {isSaving ? '…' : '✓ Sauvegarder'}
                </button>
              </div>
            </>)}

            {/* ── Sub-tab: Conversation (test dialogue) ── */}
            {sectionDetailTab === 'conversation' && (() => {
              const contextualQuestions: string[] = detailSec.player_questions ?? []
              const QUESTIONS = contextualQuestions.length > 0 ? contextualQuestions : ["On fait quoi ?", "T'es avec moi ?", "C'est quoi le plan ?"]
              const companionNpcs = npcs.filter(n => detailCompanionIds.includes(n.id))
              const alliedNpcs = companionNpcs.filter(n => n.type === 'allié')
              const testNpc = companionNpcs.find(n => n.id === dialogueTestNpcId) ?? companionNpcs[0]
              const tension = (detailSec as any).tension_level ?? 5
              const savedResponses: Record<string, Record<string, string>> = (detailSec as any).player_responses ?? {}
              const firstNpcId: string | null = (detailSec as any).conv_first_npc_id ?? null

              const saveFirstNpc = async (npcId: string) => {
                await fetch(`/api/sections/${detailSec.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conv_first_npc_id: npcId }) })
                setSections(prev => prev.map(s => s.id === detailSec.id ? { ...s, conv_first_npc_id: npcId } as any : s))
              }

              const saveQuestions = async (qs: string[]) => {
                setConvSavingQuestions(true)
                await fetch(`/api/sections/${detailSec.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_questions: qs }) })
                setSections(prev => prev.map(s => s.id === detailSec.id ? { ...s, player_questions: qs } : s))
                setConvEditMode(false)
                setConvSavingQuestions(false)
              }

              const saveAllResponses = async (newResponses: Record<string, Record<string, string>>) => {
                await fetch(`/api/sections/${detailSec.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_responses: newResponses }) })
                setSections(prev => prev.map(s => s.id === detailSec.id ? { ...s, player_responses: newResponses } as any : s))
              }

              const generateQuestions = async () => {
                setDialogueTestLoading(true)
                try {
                  const res = await fetch('/api/dialogue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'generate_questions', section_context: detailSec.summary ?? detailSec.content?.slice(0, 400) ?? '', tension_level: tension, book_theme: book?.theme ?? '', age_range: book?.age_range ?? '13-17', address_form: book?.address_form ?? 'tu' }) })
                  const data = await res.json()
                  if (data.questions?.length) { await saveQuestions(data.questions); setConvDraftQuestions(data.questions) }
                } finally { setDialogueTestLoading(false) }
              }

              const generateResponse = async (question: string) => {
                if (!testNpc) return
                setConvGeneratingFor(question)
                try {
                  const res = await fetch('/api/dialogue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'question', npc: { id: testNpc.id, name: testNpc.name, description: testNpc.description, speech_style: testNpc.speech_style, type: testNpc.type, intelligence: testNpc.intelligence }, section_context: detailSec.summary ?? detailSec.content?.slice(0, 300) ?? '', tension_level: tension, player_question: question, choices: sChoices.map(c => ({ label: c.label, section_number: 0 })), book_theme: book?.theme ?? '', age_range: book?.age_range ?? '13-17' }) })
                  const data = await res.json()
                  if (data.npc_reply) setConvResponseDrafts(prev => ({ ...prev, [question]: data.npc_reply }))
                } finally { setConvGeneratingFor(null) }
              }

              const saveResponse = async (question: string, response: string) => {
                if (!testNpc) return
                const npcResponses = { ...(savedResponses[testNpc.id] ?? {}), [question]: response }
                const newResponses = { ...savedResponses, [testNpc.id]: npcResponses }
                await saveAllResponses(newResponses)
                setConvSavedKey(question)
                setTimeout(() => setConvSavedKey(null), 2000)
              }

              const generateAudio = async (npcObj: import('@/types').Npc, question: string, text: string) => {
                if (!npcObj.voice_id) return
                const key = `${npcObj.id}__${question}`
                setConvGenAudioFor(key)
                try {
                  const qi = QUESTIONS.indexOf(question)
                  const savePath = `books/${book?.id}/sections/${detailSec.id}/conv/${npcObj.id}/${qi >= 0 ? qi : question.slice(0, 20).replace(/[^a-z0-9]/gi, '_')}`
                  const cleanText = text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim()
                  const res = await fetch('/api/elevenlabs/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_id: npcObj.voice_id, text: cleanText, voice_settings: npcObj.voice_settings, save_path: savePath, with_timestamps: true }) })
                  const data = await res.json()
                  if (data.url) {
                    // Sauvegarder le texte (avec tags) + l'URL audio + alignment ensemble
                    const npcResponses: Record<string, any> = { ...(savedResponses[npcObj.id] ?? {}), [question]: text, [`${question}__audio`]: data.url }
                    if (data.alignment) npcResponses[`${question}__alignment`] = data.alignment
                    const newResponses = { ...savedResponses, [npcObj.id]: npcResponses }
                    await saveAllResponses(newResponses)
                  }
                } finally { setConvGenAudioFor(null) }
              }

              const generateAll = async () => {
                // Uniquement les PNJ alliés, ni ennemis/boss ni le protagoniste
                const genNpcs = companionNpcs.filter(n => n.type === 'allié' && n.id !== book?.protagonist_npc_id)
                if (genNpcs.length === 0) return
                setConvGeneratingAll(true)
                try {
                  // 0. Initialiser le premier PNJ (ordre companion_npc_ids) + vider la BDD
                  setConvGenerateProgress('Initialisation…')
                  const sectionCompanionOrder = detailSec.companion_npc_ids ?? []
                  const orderedNpcs = [
                    ...sectionCompanionOrder.map(id => genNpcs.find(n => n.id === id)).filter(Boolean) as typeof genNpcs,
                    ...genNpcs.filter(n => !sectionCompanionOrder.includes(n.id))
                  ]
                  // Enregistrer le premier PNJ qui parle
                  if (orderedNpcs[0]) {
                    await fetch(`/api/sections/${detailSec.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conv_first_npc_id: orderedNpcs[0].id }) })
                    setSections(prev => prev.map(s => s.id === detailSec.id ? { ...s, conv_first_npc_id: orderedNpcs[0].id } as any : s))
                    setDialogueTestNpcId(orderedNpcs[0].id)
                  }
                  // Vider les réponses existantes en BDD pour repartir de zéro
                  await saveAllResponses({})
                  setConvResponseDrafts({})

                  // 1. Générer questions (min 3 — pad avec défauts si Claude en retourne moins)
                  setConvGenerateProgress('Questions…')
                  let questions: string[] = QUESTIONS
                  try {
                    const qRes = await fetch('/api/dialogue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'generate_questions', section_context: detailSec.summary ?? detailSec.content?.slice(0, 400) ?? '', tension_level: tension, book_theme: book?.theme ?? '', age_range: book?.age_range ?? '13-17', address_form: book?.address_form ?? 'tu' }) })
                    const qData = await qRes.json()
                    const genQs: string[] = Array.isArray(qData.questions) ? qData.questions.filter(Boolean) : []
                    questions = genQs.length >= 3 ? genQs.slice(0, 3) : [...new Set([...genQs, ...QUESTIONS])].slice(0, 3)
                  } catch { /* garder les questions par défaut */ }
                  await saveQuestions(questions)
                  setConvDraftQuestions(questions)

                  // Normalise le npc_id retourné par Claude (peut être "uuid", "[id:uuid]" ou "id:uuid")
                  const normalizeNpcId = (raw: string): string =>
                    raw.replace(/^\[id:([^\]]+)\]$/, '$1').replace(/^id:/, '').trim() || raw

                  // Partir d'un slate propre (pas de merge avec les anciennes données)
                  let accResponses: Record<string, Record<string, string>> = {}

                  // 2. Pour chaque question : réponses groupe + voix
                  for (let qi = 0; qi < questions.length; qi++) {
                    const question = questions[qi]
                    setConvGenerateProgress(`Q${qi + 1}/${questions.length} — réponses…`)
                    try {
                      const dRes = await fetch('/api/dialogue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'manga_group', npcs: orderedNpcs.map(n => ({ id: n.id, name: n.name, description: n.description, speech_style: n.speech_style, type: n.type, intelligence: n.intelligence, available_emotions: Object.keys(n.portrait_emotions ?? {}) })), player_question: question, section_context: detailSec.summary ?? detailSec.content?.slice(0, 400) ?? '', tension_level: tension, book_theme: book?.theme ?? '', age_range: book?.age_range ?? '13-17' }) })
                      const dData = await dRes.json()
                      if (!dRes.ok || !Array.isArray(dData.npc_responses) || dData.npc_responses.length === 0) {
                        setConvGenerateProgress(`Q${qi + 1}/${questions.length} — ⚠ réponse invalide (${dData.error ?? dRes.status}), on continue…`)
                        await new Promise(r => setTimeout(r, 800))
                      } else {
                        // Résolution robuste : UUID exact → normalisé → fallback positionnel
                        const resolveNpc = (rawId: string, idx: number) =>
                          orderedNpcs.find(n => n.id === rawId) ??
                          orderedNpcs.find(n => n.id === normalizeNpcId(rawId)) ??
                          orderedNpcs[idx] ?? null
                        for (let ri = 0; ri < dData.npc_responses.length; ri++) {
                          const resp = dData.npc_responses[ri]
                          const npcObj = resolveNpc(resp.npc_id ?? '', ri)
                          if (!npcObj) continue
                          if (!accResponses[npcObj.id]) accResponses[npcObj.id] = {}
                          accResponses[npcObj.id][question] = resp.text
                        }
                        // Voix séquentielles
                        for (let ri = 0; ri < dData.npc_responses.length; ri++) {
                          const resp = dData.npc_responses[ri]
                          const npcObj = resolveNpc(resp.npc_id ?? '', ri)
                          if (!npcObj?.voice_id) continue
                          setConvGenerateProgress(`Q${qi + 1}/${questions.length} — voix ${npcObj.name}…`)
                          try {
                            const savePath = `books/${book?.id}/sections/${detailSec.id}/conv/${npcObj.id}/${qi}`
                            const cleanText = resp.text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim()
                            const tRes = await fetch('/api/elevenlabs/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_id: npcObj.voice_id, text: cleanText, voice_settings: npcObj.voice_settings ?? null, save_path: savePath, with_timestamps: true }) })
                            const tData = await tRes.json()
                            console.log(`[npc voice ${npcObj.name} Q${qi + 1}] status=${tRes.status}`, tData)
                            if (tData.url) {
                              if (!accResponses[npcObj.id]) accResponses[npcObj.id] = {}
                              accResponses[npcObj.id][`${question}__audio`] = tData.url
                              if (tData.alignment) accResponses[npcObj.id][`${question}__alignment`] = tData.alignment
                            } else {
                              console.error(`[npc voice ${npcObj.name} Q${qi + 1}] error:`, tData.error ?? 'pas d\'URL')
                            }
                          } catch (e: any) { console.error(`[npc voice ${npcObj.name} Q${qi + 1}] fetch error:`, e) }
                        }
                      }
                    } catch (e: any) {
                      setConvGenerateProgress(`Q${qi + 1}/${questions.length} — ⚠ erreur : ${e?.message ?? 'inconnue'}, on continue…`)
                      await new Promise(r => setTimeout(r, 800))
                    }
                  }

                  // 2.5. Voix joueur (protagoniste) pour chaque question
                  const protagonistNpc = npcs.find(n => n.id === book?.protagonist_npc_id)
                  if (!protagonistNpc) {
                    setConvGenerateProgress('⚠ Protagoniste non défini — voix joueur ignorée')
                    await new Promise(r => setTimeout(r, 1000))
                  } else if (!protagonistNpc.voice_id) {
                    setConvGenerateProgress('⚠ Pas de voix sur le protagoniste — voix joueur ignorée')
                    await new Promise(r => setTimeout(r, 1000))
                  } else {
                    if (!accResponses['__player__']) accResponses['__player__'] = {}
                    const playerErrors: string[] = []
                    for (let qi = 0; qi < questions.length; qi++) {
                      const question = questions[qi]
                      setConvGenerateProgress(`Voix joueur Q${qi + 1}/${questions.length}…`)
                      try {
                        const bookId = book?.id
                        if (!bookId) throw new Error('book.id undefined')
                        const savePath = `books/${bookId}/sections/${detailSec.id}/conv/__player__/${qi}`
                        const tRes = await fetch('/api/elevenlabs/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_id: protagonistNpc.voice_id, text: question, voice_settings: protagonistNpc.voice_settings ?? null, save_path: savePath, with_timestamps: true }) })
                        const tData = await tRes.json()
                        console.log(`[player voice Q${qi + 1}] status=${tRes.status}`, tData)
                        if (tData.url) {
                          accResponses['__player__'][`${question}__audio`] = tData.url
                          if (tData.alignment) accResponses['__player__'][`${question}__alignment`] = tData.alignment
                        } else {
                          playerErrors.push(`Q${qi + 1} [${tRes.status}]: ${tData.error ?? 'pas d\'URL'}`)
                        }
                      } catch (e: any) {
                        console.error(`[player voice Q${qi + 1}] fetch error`, e)
                        playerErrors.push(`Q${qi + 1}: ${e?.message ?? 'erreur inconnue'}`)
                      }
                    }
                    if (playerErrors.length > 0) {
                      setConvGenerateProgress(`⚠ Voix joueur — ${playerErrors.join(' | ')}`)
                      await new Promise(r => setTimeout(r, 4000))
                    }
                  }

                  // 3. Sauvegarder tout
                  setConvGenerateProgress('Sauvegarde…')
                  await saveAllResponses(accResponses)
                  setConvGenerateProgress('')

                  // Sélectionner le premier allié + peupler les drafts pour affichage immédiat
                  if (orderedNpcs[0]) {
                    setDialogueTestNpcId(orderedNpcs[0].id)
                    const npcResps = accResponses[orderedNpcs[0].id] ?? {}
                    const drafts: Record<string, string> = {}
                    for (const q of questions) { if (npcResps[q]) drafts[q] = npcResps[q] }
                    if (Object.keys(drafts).length > 0) setConvResponseDrafts(drafts)
                  }
                } finally {
                  setConvGeneratingAll(false)
                  setConvGenerateProgress('')
                }
              }

              const saveNpcVoice = async () => {
                if (!testNpc) return
                setConvNpcVoiceSaving(true)
                await fetch(`/api/npcs/${testNpc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_id: convNpcVoiceForm.voice_id, voice_settings: convNpcVoiceForm.voice_settings, voice_prompt: convNpcVoiceForm.voice_prompt }) })
                setNpcs(prev => prev.map(n => n.id === testNpc.id ? { ...n, voice_id: convNpcVoiceForm.voice_id, voice_settings: convNpcVoiceForm.voice_settings, voice_prompt: convNpcVoiceForm.voice_prompt } : n))
                setConvNpcVoiceSaving(false)
                setConvNpcVoiceSaved(true)
                setTimeout(() => setConvNpcVoiceSaved(false), 2500)
              }

              const playVoiceTest = async (text: string, voiceId?: string, settings?: any) => {
                const vid = voiceId ?? convNpcVoiceForm.voice_id
                const vs = settings ?? convNpcVoiceForm.voice_settings
                if (!vid || !text.trim()) return
                setConvVoicePlaying(true)
                try {
                  const res = await fetch('/api/elevenlabs/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_id: vid, text, voice_settings: vs }) })
                  if (!res.ok) return
                  const blob = await res.blob()
                  if (convVoiceAudioRef.current) { convVoiceAudioRef.current.pause(); convVoiceAudioRef.current = null }
                  const audio = new Audio(URL.createObjectURL(blob))
                  convVoiceAudioRef.current = audio
                  audio.onended = () => setConvVoicePlaying(false)
                  audio.onerror = () => setConvVoicePlaying(false)
                  audio.play().catch(() => setConvVoicePlaying(false))
                } catch { setConvVoicePlaying(false) }
              }

              const draftQs = convEditMode ? convDraftQuestions : QUESTIONS

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                  {/* ── Bouton Générer tout ── */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                    <button onClick={generateAll} disabled={convGeneratingAll || companionNpcs.filter(n => n.type !== 'ennemi' && n.type !== 'boss').length === 0}
                      style={{ fontSize: '0.8rem', padding: '0.45rem 1.1rem', borderRadius: '6px', border: '1px solid var(--accent)', background: convGeneratingAll ? 'rgba(212,168,76,0.05)' : 'rgba(212,168,76,0.12)', color: 'var(--accent)', cursor: (convGeneratingAll || companionNpcs.filter(n => n.type !== 'ennemi' && n.type !== 'boss').length === 0) ? 'default' : 'pointer', fontWeight: 600, opacity: companionNpcs.filter(n => n.type !== 'ennemi' && n.type !== 'boss').length === 0 ? 0.4 : 1, whiteSpace: 'nowrap' }}>
                      {convGeneratingAll ? '⏳' : '✨'} Générer tout
                    </button>
                    {convGeneratingAll && convGenerateProgress && (
                      <span style={{ fontSize: '0.72rem', color: convGenerateProgress.includes('⚠') ? 'var(--danger)' : 'var(--accent)', fontStyle: 'italic' }}>{convGenerateProgress}</span>
                    )}
                    {!convGeneratingAll && (() => {
                      const genNpcs = companionNpcs.filter(n => n.type === 'allié' && n.id !== book?.protagonist_npc_id)
                      return (
                        <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                          {genNpcs.length === 0 ? 'Aucun PNJ compagnon dans cette section' : `Questions + réponses + voix pour ${genNpcs.length} PNJ`}
                        </span>
                      )
                    })()}
                  </div>

                  {/* ── PNJ sélecteur + Premier PNJ ── */}
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                      <div>
                        <div style={labelStyle}>Tension</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: tension >= 7 ? 'var(--danger)' : tension >= 4 ? 'var(--accent)' : 'var(--success)' }}>{tension}/10</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={labelStyle}>PNJ actif (réponses)</div>
                        {companionNpcs.length === 0
                          ? <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucun compagnon — configurez l'onglet Compagnons.</p>
                          : <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                              {companionNpcs.map(n => {
                                const cfg = NPC_TYPE_CONFIG[n.type as keyof typeof NPC_TYPE_CONFIG] ?? NPC_TYPE_CONFIG['ennemi']
                                const selected = (dialogueTestNpcId || companionNpcs[0]?.id) === n.id
                                return (
                                  <button key={n.id} onClick={() => { setDialogueTestNpcId(n.id); setDialogueTestResult(null); setConvNpcVoiceForm({ voice_id: n.voice_id ?? '', voice_settings: n.voice_settings ?? { stability: 0.5, style: 0, speed: 1, similarity_boost: 0.75 }, voice_prompt: n.voice_prompt ?? '' }) }}
                                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', borderRadius: '6px', border: `1px solid ${cfg.color}${selected ? 'ff' : '44'}`, background: selected ? cfg.color + '22' : 'transparent', color: cfg.color, cursor: 'pointer', fontWeight: selected ? 'bold' : 'normal' }}>
                                    {cfg.icon} {n.name} <span style={{ opacity: 0.6 }}>int.{n.intelligence}</span>
                                  </button>
                                )
                              })}
                            </div>
                        }
                      </div>
                    </div>
                    {/* Premier PNJ qui parle — désactivé (ordre défini par companion_npc_ids) */}
                    {alliedNpcs.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.25rem', borderTop: '1px solid var(--border)', opacity: 0.35, pointerEvents: 'none' }}>
                        <span style={{ fontSize: '0.68rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>1er qui parle :</span>
                        {alliedNpcs.map(n => (
                          <button key={n.id}
                            style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '5px', border: `1px solid ${firstNpcId === n.id ? '#4ec9b0' : 'var(--border)'}`, background: firstNpcId === n.id ? 'rgba(78,201,176,0.15)' : 'transparent', color: firstNpcId === n.id ? '#4ec9b0' : 'var(--muted)', cursor: 'default', fontWeight: firstNpcId === n.id ? 700 : 400 }}>
                            {firstNpcId === n.id ? '★ ' : ''}{n.name}
                          </button>
                        ))}
                        <span style={{ fontSize: '0.6rem', color: 'var(--muted)', fontStyle: 'italic' }}>(ordre défini dans Compagnons)</span>
                      </div>
                    )}
                    {testNpc && <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>{testNpc.speech_style ?? testNpc.description ?? ''}</div>}
                  </div>

                  {/* ── Questions ── */}
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={labelStyle}>Questions du joueur</span>
                      {contextualQuestions.length > 0
                        ? <span style={{ fontSize: '0.6rem', color: 'var(--success)' }}>✓ contextuelles</span>
                        : <span style={{ fontSize: '0.6rem', color: 'var(--muted)', fontStyle: 'italic' }}>génériques</span>
                      }
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
                        <button onClick={generateQuestions} disabled={dialogueTestLoading || convGeneratingAll} style={{ fontSize: '0.65rem', padding: '0.2rem 0.6rem', borderRadius: '5px', border: '1px solid var(--accent)', background: 'rgba(212,168,76,0.1)', color: 'var(--accent)', cursor: 'pointer', opacity: (dialogueTestLoading || convGeneratingAll) ? 0.5 : 1 }}>✨ Générer</button>
                        {!convEditMode
                          ? <button onClick={() => { setConvEditMode(true); setConvDraftQuestions([...QUESTIONS]) }} style={{ fontSize: '0.65rem', padding: '0.2rem 0.6rem', borderRadius: '5px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>✏ Modifier</button>
                          : <>
                              <button onClick={() => saveQuestions(convDraftQuestions)} disabled={convSavingQuestions} style={{ fontSize: '0.65rem', padding: '0.2rem 0.6rem', borderRadius: '5px', border: '1px solid #4caf7d', background: 'rgba(76,175,125,0.1)', color: '#4caf7d', cursor: 'pointer' }}>{convSavingQuestions ? '…' : '✓ Sauver'}</button>
                              <button onClick={() => setConvEditMode(false)} style={{ fontSize: '0.65rem', padding: '0.2rem 0.6rem', borderRadius: '5px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Annuler</button>
                            </>
                        }
                      </div>
                    </div>
                    {convEditMode ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {convDraftQuestions.map((q, i) => (
                          <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <input value={q} onChange={e => setConvDraftQuestions(prev => prev.map((x, j) => j === i ? e.target.value : x))} style={{ ...inputStyle, flex: 1 }} />
                            <button onClick={() => setConvDraftQuestions(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}>✕</button>
                          </div>
                        ))}
                        <button onClick={() => setConvDraftQuestions(prev => [...prev, ''])} style={{ alignSelf: 'flex-start', fontSize: '0.72rem', padding: '0.25rem 0.75rem', borderRadius: '5px', border: '1px dashed var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>+ Ajouter</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {(() => {
                          const protagonistNpc = npcs.find(n => n.id === book?.protagonist_npc_id)
                          const playerSaved = (savedResponses as any)['__player__'] as Record<string, string> | undefined
                          const generatePlayerAudio = async (question: string, qi: number) => {
                            if (!protagonistNpc?.voice_id) return
                            console.log('[player audio] voice_id =', protagonistNpc.voice_id, '| question =', question)
                            setConvPlayerAudioGen(question)
                            try {
                              const savePath = `books/${book?.id}/sections/${detailSec.id}/conv/__player__/${qi}`
                              const tRes = await fetch('/api/elevenlabs/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_id: protagonistNpc.voice_id, text: question, voice_settings: protagonistNpc.voice_settings ?? null, save_path: savePath }) })
                              const tData = await tRes.json()
                              console.log('[player audio] response status =', tRes.status, tData)
                              if (tData.url) {
                                const playerResponses = { ...(playerSaved ?? {}), [`${question}__audio`]: tData.url }
                                const newResponses = { ...(savedResponses as any), '__player__': playerResponses }
                                await saveAllResponses(newResponses)
                              } else {
                                console.error('[player audio] TTS error:', tData.error ?? 'pas d\'URL')
                              }
                            } catch (e: any) {
                              console.error('[player audio] fetch error:', e)
                            } finally { setConvPlayerAudioGen(null) }
                          }
                          return QUESTIONS.map((q, qi) => {
                            const hasSaved = testNpc ? !!(savedResponses[testNpc.id]?.[q]) : false
                            const audioUrl = playerSaved?.[`${q}__audio`]
                            const isGenning = convPlayerAudioGen === q
                            return (
                              <div key={q} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', borderRadius: '20px', border: `1px solid ${hasSaved ? '#4caf7d44' : 'var(--border)'}`, background: hasSaved ? 'rgba(76,175,125,0.07)' : 'transparent', color: hasSaved ? '#4caf7d' : 'var(--muted)', flex: 1, minWidth: 0 }}>
                                  {hasSaved ? '✓ ' : ''}{`"${q}"`}
                                </span>
                                <button onClick={() => { if (audioUrl) { const a = new Audio(audioUrl); a.play().catch(() => {}) } }}
                                  disabled={!audioUrl}
                                  style={{ fontSize: '0.62rem', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #4caf7d44', background: 'rgba(76,175,125,0.08)', color: '#4caf7d', cursor: audioUrl ? 'pointer' : 'default', opacity: audioUrl ? 1 : 0.35, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                  ▶ Écouter
                                </button>
                                {protagonistNpc?.voice_id && (
                                  <button onClick={() => generatePlayerAudio(q, qi)} disabled={isGenning || !!convPlayerAudioGen}
                                    style={{ fontSize: '0.62rem', padding: '0.2rem 0.5rem', borderRadius: '4px', border: `1px solid ${audioUrl ? '#4caf7d44' : '#e879f944'}`, background: audioUrl ? 'rgba(76,175,125,0.08)' : 'rgba(232,121,249,0.08)', color: audioUrl ? '#4caf7d' : '#e879f9', cursor: 'pointer', opacity: (isGenning || !!convPlayerAudioGen) ? 0.5 : 1, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                    {isGenning ? '⏳' : audioUrl ? '↺ Régénérer' : '🎙 Générer'}
                                  </button>
                                )}
                              </div>
                            )
                          })
                        })()}
                      </div>
                    )}
                  </div>

                  {/* ── Réponses ── */}
                  {QUESTIONS.length > 0 && testNpc && (
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={labelStyle}>Réponses de {testNpc.name}</span>
                        {!testNpc.voice_id && (
                          <span style={{ fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic' }}>⚠ Pas de voix configurée</span>
                        )}
                      </div>
                      {QUESTIONS.map(q => {
                        const draft = convResponseDrafts[q] ?? (testNpc ? savedResponses[testNpc.id]?.[q] : undefined) ?? ''
                        const savedAudioUrl: string | undefined = testNpc ? (savedResponses[testNpc.id] as any)?.[`${q}__audio`] : undefined
                        const isGenerating = convGeneratingFor === q
                        const isSaved = convSavedKey === q
                        const audioKey = `${testNpc.id}__${q}`
                        const isGenAudio = convGenAudioFor === audioKey
                        const paletteKey = `resp_${q}`
                        const saveCursor = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
                          const el = e.currentTarget
                          convCursorPosRef.current[paletteKey] = { start: el.selectionStart, end: el.selectionEnd }
                        }
                        const insertTag = (tag: string) => {
                          const pos = convCursorPosRef.current[paletteKey]
                          const start = pos?.start ?? draft.length
                          const end = pos?.end ?? draft.length
                          const newText = draft.slice(0, start) + `[${tag}]` + draft.slice(end)
                          setConvResponseDrafts(prev => ({ ...prev, [q]: newText }))
                          convCursorPosRef.current[paletteKey] = { start: start + tag.length + 2, end: start + tag.length + 2 }
                        }
                        return (
                          <div key={q} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderLeft: '2px solid var(--border)', paddingLeft: '0.75rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic', flex: 1 }}>"{q}"</span>
                              <button onClick={() => generateResponse(q)} disabled={!!convGeneratingFor || convGeneratingAll}
                                style={{ fontSize: '0.62rem', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid var(--accent)', background: 'rgba(212,168,76,0.1)', color: 'var(--accent)', cursor: 'pointer', opacity: (convGeneratingFor || convGeneratingAll) ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                                {isGenerating ? '⏳' : '✨ Générer'}
                              </button>
                            </div>
                            {(draft || isGenerating) && (
                              <>
                                <textarea value={draft} onChange={e => setConvResponseDrafts(prev => ({ ...prev, [q]: e.target.value }))}
                                  onSelect={saveCursor} onMouseUp={saveCursor} onKeyUp={saveCursor}
                                  disabled={isGenerating} placeholder={isGenerating ? 'Génération…' : 'Réponse du PNJ…'}
                                  style={{ ...inputStyle, minHeight: '56px', resize: 'vertical', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '0.85rem' }} />
                                <AudioTagPalette onInsert={insertTag} />
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                  {testNpc.voice_id && draft && (
                                    <button onClick={() => playVoiceTest(draft, testNpc.voice_id!, testNpc.voice_settings)}
                                      disabled={convVoicePlaying}
                                      style={{ fontSize: '0.65rem', padding: '0.2rem 0.6rem', borderRadius: '4px', border: '1px solid #4ec9b044', background: '#4ec9b011', color: '#4ec9b0', cursor: 'pointer', opacity: convVoicePlaying ? 0.5 : 1 }}>
                                      ▶ Écouter
                                    </button>
                                  )}
                                  {testNpc.voice_id && draft && (
                                    <button onClick={() => generateAudio(testNpc, q, draft)} disabled={isGenAudio || convGeneratingAll}
                                      style={{ fontSize: '0.65rem', padding: '0.2rem 0.6rem', borderRadius: '4px', border: `1px solid ${savedAudioUrl ? '#4caf7d44' : '#e879f944'}`, background: savedAudioUrl ? 'rgba(76,175,125,0.08)' : 'rgba(232,121,249,0.08)', color: savedAudioUrl ? '#4caf7d' : '#e879f9', cursor: 'pointer', opacity: (isGenAudio || convGeneratingAll) ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                                      {isGenAudio ? '⏳' : savedAudioUrl ? '✓ Audio' : '🎙 Générer audio'}
                                    </button>
                                  )}
                                  {savedAudioUrl && (
                                    <button onClick={() => { const a = new Audio(savedAudioUrl); a.play().catch(() => {}) }}
                                      style={{ fontSize: '0.65rem', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid #4caf7d44', background: 'transparent', color: '#4caf7d', cursor: 'pointer' }}>
                                      ▶
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* ── Voix du PNJ ── */}
                  {testNpc && (
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={labelStyle}>🎙 Voix de {testNpc.name}</span>
                        <button onClick={saveNpcVoice} disabled={convNpcVoiceSaving}
                          style={{ fontSize: '0.7rem', padding: '0.25rem 0.75rem', borderRadius: '5px', border: `1px solid ${convNpcVoiceSaved ? '#4caf7d' : 'var(--accent)'}`, background: convNpcVoiceSaved ? 'rgba(76,175,125,0.1)' : 'rgba(212,168,76,0.1)', color: convNpcVoiceSaved ? '#4caf7d' : 'var(--accent)', cursor: 'pointer' }}>
                          {convNpcVoiceSaving ? '…' : convNpcVoiceSaved ? '✓ Sauvegardé' : '✓ Sauvegarder la voix'}
                        </button>
                      </div>
                      <VoicePanel form={convNpcVoiceForm} setForm={setConvNpcVoiceForm as any} voices={convVoices} voicesLoaded={convVoicesLoaded} playVoicePreview={(vid) => { const v = convVoices.find(x => x.voice_id === vid); if (v?.preview_url) { const a = new Audio(v.preview_url); a.play().catch(() => {}) } }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input value={convVoiceTestText} onChange={e => setConvVoiceTestText(e.target.value)}
                            placeholder="Texte à tester… [tag] inclus → eleven_v3 auto"
                            style={{ ...inputStyle, flex: 1 }}
                            onSelect={e => { const el = e.currentTarget; convCursorPosRef.current['test'] = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 } }}
                            onMouseUp={e => { const el = e.currentTarget; convCursorPosRef.current['test'] = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 } }}
                            onKeyUp={e => { const el = e.currentTarget; convCursorPosRef.current['test'] = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 } }}
                            onKeyDown={e => { if (e.key === 'Enter') playVoiceTest(convVoiceTestText) }} />
                          <button onClick={() => playVoiceTest(convVoiceTestText)} disabled={convVoicePlaying || !convNpcVoiceForm.voice_id || !convVoiceTestText.trim()}
                            style={{ fontSize: '0.78rem', padding: '0.4rem 0.9rem', borderRadius: '5px', border: '1px solid #4ec9b044', background: '#4ec9b011', color: '#4ec9b0', cursor: 'pointer', whiteSpace: 'nowrap', opacity: (convVoicePlaying || !convNpcVoiceForm.voice_id || !convVoiceTestText.trim()) ? 0.5 : 1 }}>
                            {convVoicePlaying ? '⏳' : '▶ Tester'}
                          </button>
                        </div>
                        <AudioTagPalette onInsert={tag => {
                          const pos = convCursorPosRef.current['test']
                          const start = pos?.start ?? convVoiceTestText.length
                          const end = pos?.end ?? convVoiceTestText.length
                          const newText = convVoiceTestText.slice(0, start) + `[${tag}]` + convVoiceTestText.slice(end)
                          setConvVoiceTestText(newText)
                          convCursorPosRef.current['test'] = { start: start + tag.length + 2, end: start + tag.length + 2 }
                        }} />
                        {/\[.+?\]/.test(convVoiceTestText) && (
                          <div style={{ fontSize: '0.6rem', color: '#e879f9', fontStyle: 'italic' }}>✦ Tags détectés — modèle eleven_v3 utilisé automatiquement</div>
                        )}
                      </div>
                    </div>
                  )}

                </div>
              )
            })()}

            {/* ── Sub-tab: Dialogues ── */}
            {sectionDetailTab === 'dialogues' && (() => {
              const dialogues: import('@/types').SectionDialogue[] = detailSec.dialogues ?? []
              const sectionNpcs = npcs.filter(n =>
                detailSec.companion_npc_ids?.includes(n.id) ||
                detailSec.content?.toLowerCase().includes(n.name.toLowerCase())
              )

              async function extractDialogues() {
                const res = await fetch(`/api/books/${book.id}/fix-language`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ section_id: detailSec.id, action: 'extract_dialogues' }),
                })
              }

              async function saveDialogues(updated: import('@/types').SectionDialogue[]) {
                await fetch(`/api/sections/${detailSec.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ dialogues: updated }),
                })
                setSections(prev => prev.map(s => s.id === detailSec.id ? { ...s, dialogues: updated } : s))
              }

              function addLine() {
                saveDialogues([...dialogues, { text: '', speaker: 'joueur', source: 'content' as const }])
              }
              function removeLine(i: number) {
                saveDialogues(dialogues.filter((_, idx) => idx !== i))
              }
              function updateLine(i: number, patch: Partial<import('@/types').SectionDialogue>) {
                saveDialogues(dialogues.map((d, idx) => idx === i ? { ...d, ...patch } : d))
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {/* Toolbar */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{dialogues.length} réplique{dialogues.length !== 1 ? 's' : ''}</span>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button onClick={addLine} style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>+ Ajouter</button>
                    </div>
                  </div>

                  {dialogues.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontSize: '0.72rem', fontStyle: 'italic', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                      Aucun dialogue — cliquez sur "+ Ajouter"
                    </div>
                  )}

                  {dialogues.map((d, i) => {
                    const isPlayer = d.speaker === 'joueur' || !d.speaker
                    const matchedNpc = sectionNpcs.find(n => n.id === d.npc_id || n.name === d.speaker)
                    return (
                      <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.6rem 0.75rem', borderRadius: '8px', background: isPlayer ? 'rgba(212,168,76,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isPlayer ? 'rgba(212,168,76,0.2)' : 'var(--border)'}` }}>
                        {/* Avatar / speaker badge */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flexShrink: 0, width: '44px' }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden', background: 'var(--surface-2)', border: `1px solid ${isPlayer ? '#d4a84c44' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {matchedNpc?.image_url
                              ? <img src={matchedNpc.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <span style={{ fontSize: '0.9rem', opacity: 0.4 }}>{isPlayer ? '🧑' : '👤'}</span>
                            }
                          </div>
                          <span style={{ fontSize: '0.55rem', color: isPlayer ? '#d4a84c' : 'var(--muted)', textAlign: 'center', lineHeight: 1.2 }}>{d.speaker || 'joueur'}</span>
                        </div>

                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {/* Speaker selector */}
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                            <button onClick={() => updateLine(i, { speaker: 'joueur', npc_id: undefined })} style={{ padding: '1px 8px', borderRadius: '4px', fontSize: '0.6rem', cursor: 'pointer', border: `1px solid ${d.speaker === 'joueur' || !d.speaker ? '#d4a84c' : 'var(--border)'}`, background: d.speaker === 'joueur' || !d.speaker ? 'rgba(212,168,76,0.12)' : 'var(--surface-2)', color: d.speaker === 'joueur' || !d.speaker ? '#d4a84c' : 'var(--muted)' }}>Joueur</button>
                            {sectionNpcs.map(n => (
                              <button key={n.id} onClick={() => updateLine(i, { speaker: n.name, npc_id: n.id })} style={{ padding: '1px 8px', borderRadius: '4px', fontSize: '0.6rem', cursor: 'pointer', border: `1px solid ${d.npc_id === n.id ? '#9898b4' : 'var(--border)'}`, background: d.npc_id === n.id ? 'rgba(152,152,180,0.12)' : 'var(--surface-2)', color: d.npc_id === n.id ? '#9898b4' : 'var(--muted)' }}>{n.name}</button>
                            ))}
                          </div>
                          {/* Texte */}
                          <textarea value={d.text} onChange={e => updateLine(i, { text: e.target.value })}
                            rows={2}
                            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem 0.6rem', color: 'var(--foreground)', fontSize: '0.75rem', fontFamily: 'Georgia, serif', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 }}
                          />
                          {/* Voice prompt */}
                          <input placeholder="Jeu d'acteur… (ex: tense, breathless)" value={d.voice_prompt ?? ''}
                            onChange={e => updateLine(i, { voice_prompt: e.target.value })}
                            style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '2px 0', color: 'var(--muted)', fontSize: '0.65rem', fontStyle: 'italic', outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>

                        {/* Source badge + delete */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                          <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.8rem', padding: '2px 4px' }}>✕</button>
                          <span style={{ fontSize: '0.55rem', padding: '1px 5px', borderRadius: '3px', background: d.source === 'transition' ? 'rgba(76,155,240,0.12)' : 'rgba(255,255,255,0.05)', color: d.source === 'transition' ? '#4c9bf0' : 'var(--muted)', border: `1px solid ${d.source === 'transition' ? 'rgba(76,155,240,0.3)' : 'var(--border)'}`, cursor: 'pointer' }}
                            onClick={() => updateLine(i, { source: d.source === 'transition' ? 'content' : 'transition' })}>
                            {d.source === 'transition' ? 'transit.' : 'contenu'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* ── Sub-tab: Illustrations (édition complète) ── */}
            {sectionDetailTab === 'illustrations' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={labelStyle}>Illustrations (4 plans)</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
                      {(['replicate', 'leonardo'] as const).map(p => (
                        <button key={p} onClick={() => setImageProvider(p)} style={{ padding: '0.2rem 0.55rem', fontSize: '0.65rem', border: 'none', cursor: 'pointer', background: imageProvider === p ? 'var(--accent)' : 'transparent', color: imageProvider === p ? '#0f0f14' : 'var(--muted)', fontWeight: imageProvider === p ? 'bold' : 'normal' }}>
                          {p === 'replicate' ? '⚡' : '🎨'} {p}
                        </button>
                      ))}
                    </div>
                    <SectionImagePromptsButton
                      sectionId={detailSec.id}
                      onPrompts={(prompts, promptsFr) => setEditImages(imgs => imgs.map((img, i) => ({ ...img, description: prompts[i] ?? img.description, description_fr: promptsFr[i] || img.description_fr })))}
                    />
                  </div>
                </div>
                {[0, 1, 2, 3].map(i => (
                  <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--muted)', fontWeight: 'bold' }}>Plan {i + 1}</div>
                    {editImages[i]?.url && (
                      <div style={{ position: 'relative' }}>
                        <img src={editImages[i].url} onClick={() => editImages[i].url && setZoomedImage(editImages[i].url!)} style={{ width: '100%', maxHeight: '280px', objectFit: 'contain', borderRadius: '6px', border: '1px solid var(--border)', background: '#000', cursor: 'zoom-in', display: 'block' }} />
                        <button onClick={() => setEditImages(imgs => imgs.map((img, idx) => idx === i ? { ...img, url: undefined } : img))} style={{ position: 'absolute', top: '6px', right: '6px', background: '#c94c4ccc', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', padding: '0.15rem 0.4rem', fontSize: '0.65rem' }}>✕</button>
                      </div>
                    )}
                    <textarea
                      value={editImages[i]?.description ?? ''}
                      onChange={e => setEditImages(imgs => imgs.map((img, idx) => idx === i ? { ...img, description: e.target.value } : img))}
                      placeholder={`Prompt / description du plan ${i + 1}…`}
                      rows={2}
                      style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '5px', padding: '0.4rem 0.6rem', color: 'var(--foreground)', fontSize: '0.8rem', resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    {editImages[i]?.description_fr && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--muted)', fontStyle: 'italic', padding: '0 0.2rem' }}>🇫🇷 {editImages[i].description_fr}</div>
                    )}
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <select value={editImages[i]?.style ?? 'realistic'} onChange={e => setEditImages(imgs => imgs.map((img, idx) => idx === i ? { ...img, style: e.target.value } : img))} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.28rem 0.5rem', color: 'var(--foreground)', fontSize: '0.72rem', outline: 'none', cursor: 'pointer' }}>
                        <option value="realistic">🖼️ Réaliste</option>
                        <option value="manga">⛩️ Manga</option>
                        <option value="bnw">⬛ Noir & Blanc</option>
                        <option value="watercolor">🎨 Aquarelle</option>
                        <option value="comic">💬 BD franco-belge</option>
                        <option value="dark_fantasy">🩸 Dark Fantasy</option>
                        <option value="pixel">👾 Pixel Art</option>
                      </select>
                      {book.protagonist_description && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--muted)' }} title={book.protagonist_description}>
                          <input type="checkbox" checked={editImages[i]?.includeProtagonist ?? false} onChange={e => setEditImages(imgs => imgs.map((img, idx) => idx === i ? { ...img, includeProtagonist: e.target.checked } : img))} style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                          🧑 Perso.
                        </label>
                      )}
                      <ImageGenButton
                        type="section" provider={imageProvider}
                        storagePath={`books/${id}/sections/${detailSec.id}_${i}`}
                        data={(() => {
                          const descText = editImages[i]?.description || editSummary || editContent
                          const npcApps = npcs.filter(n => n.name && descText.toLowerCase().includes(n.name.toLowerCase()) && (n.appearance || n.description)).map(n => [n.appearance || n.description, n.origin].filter(Boolean).join(' ')).join(' | ')
                          return { summary: editImages[i]?.description || editSummary, content: editContent, theme: book.theme, style: editImages[i]?.style ?? book.illustration_style ?? 'realistic', protagonist: editImages[i]?.includeProtagonist ? (book.protagonist_description ?? '') : '', illustration_bible: book.illustration_bible ?? '', npc_appearances: npcApps }
                        })()}
                        currentUrl={editImages[i]?.url}
                        onSaved={url => {
                          const displayUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now()
                          const newImgs = editImages.map((img, idx) => idx === i ? { ...img, url: displayUrl } : img)
                          setEditImages(() => newImgs)
                          const cleanImgs = newImgs.filter(img => img.url || img.description.trim()).map(img => ({ url: img.url?.split('?')[0], description: img.description, style: img.style as any }))
                          fetch(`/api/sections/${detailSec.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: cleanImgs }) })
                          setSections(ss => ss.map(s => s.id === detailSec.id ? { ...s, images: cleanImgs } : s))
                        }}
                      />
                    </div>
                    {editImages[i]?.description.trim() && !editImages[i]?.url && (
                      <button onClick={() => {
                        const cleanImgs = editImages.filter(img => img.url || img.description.trim()).map(img => ({ url: img.url, description: img.description, style: img.style as any }))
                        fetch(`/api/sections/${detailSec.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: cleanImgs }) })
                        setSections(ss => ss.map(s => s.id === detailSec.id ? { ...s, images: cleanImgs } : s))
                      }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.2rem 0.5rem', fontSize: '0.65rem', alignSelf: 'flex-start' }}>
                        💾 Sauvegarder le prompt
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Sub-tab: Compagnons ── */}
            {sectionDetailTab === 'compagnons' && (() => {
              const visibleNpcs = npcs.filter(n => detailCompanionIds.includes(n.id) || autoDetectedNpcIds.includes(n.id))
              const addableNpcs = npcs.filter(n => !detailCompanionIds.includes(n.id) && !autoDetectedNpcIds.includes(n.id))
              const toggleNpc = async (npcId: string, checked: boolean) => {
                const nextIds = checked ? detailCompanionIds.filter(id => id !== npcId) : [...detailCompanionIds, npcId]
                // décocher → ajouter aux exclus ; cocher → retirer des exclus
                const nextExcluded = checked
                  ? [...new Set([...detailExcludedIds, npcId])]
                  : detailExcludedIds.filter(id => id !== npcId)
                await fetch(`/api/sections/${sectionDetailId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companion_npc_ids: nextIds, companion_npc_excluded: nextExcluded }) })
                setSections(prev => prev.map(s => s.id === sectionDetailId ? { ...s, companion_npc_ids: nextIds, companion_npc_excluded: nextExcluded } : s))
              }
              return (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={labelStyle}>Compagnons</div>
                  {npcs.length === 0
                    ? <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucun PNJ défini pour ce livre.</p>
                    : <>
                        {visibleNpcs.length === 0 && (
                          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucun compagnon détecté.</p>
                        )}
                        {visibleNpcs.map(npc => {
                          const checked = detailCompanionIds.includes(npc.id)
                          const cfg = NPC_TYPE_CONFIG[npc.type as keyof typeof NPC_TYPE_CONFIG] ?? NPC_TYPE_CONFIG['ennemi']
                          return (
                            <label key={npc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
                              <input type="checkbox" checked={checked} onChange={() => toggleNpc(npc.id, checked)}
                                style={{ accentColor: cfg.color, width: '14px', height: '14px', flexShrink: 0 }} />
                              <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--foreground)' }}>{npc.name}</span>
                              <span style={{ fontSize: '0.65rem', color: cfg.color }}>{cfg.icon} {cfg.label}</span>
                            </label>
                          )
                        })}
                        {addableNpcs.length > 0 && (
                          <div style={{ marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                            <div style={{ ...labelStyle, marginBottom: '0.5rem' }}>Ajouter un PNJ</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                              {addableNpcs.map(npc => {
                                const cfg = NPC_TYPE_CONFIG[npc.type as keyof typeof NPC_TYPE_CONFIG] ?? NPC_TYPE_CONFIG['ennemi']
                                return (
                                  <button key={npc.id} onClick={() => toggleNpc(npc.id, false)}
                                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '5px', background: 'var(--surface-2)', border: `1px solid ${cfg.color}44`, color: cfg.color, cursor: 'pointer' }}>
                                    + {npc.name}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </>
                  }
                </div>
              )
            })()}

            {/* ── Sub-tab: Musique (édition complète) ── */}
            {sectionDetailTab === 'musique' && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={labelStyle}>Piste musicale</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    value={editMusicUrl}
                    onChange={e => setEditMusicUrl(e.target.value)}
                    placeholder={`Par défaut : ${DEFAULT_MUSIC[t.label] ?? '(aucune)'}`}
                    style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.45rem 0.75rem', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                  <button onClick={() => setFreesoundModal({ sectionType: t.label })} style={{ background: 'none', border: '1px solid #4c9bf044', borderRadius: '5px', color: '#4c9bf0', cursor: 'pointer', padding: '0.35rem 0.6rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>🔍 Freesound</button>
                  {editMusicUrl && (
                    <button onClick={() => setEditMusicUrl('')} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--muted)', cursor: 'pointer', padding: '0.35rem 0.5rem', fontSize: '0.78rem' }}>✕</button>
                  )}
                </div>
                {(editMusicUrl || DEFAULT_MUSIC[t.label]) && (
                  <audio key={editMusicUrl || DEFAULT_MUSIC[t.label]} controls src={editMusicUrl || DEFAULT_MUSIC[t.label]} style={{ width: '100%', height: '36px', accentColor: 'var(--accent)' }} />
                )}
                {!editMusicUrl && detailSec.music_url && (
                  <p style={{ fontSize: '0.72rem', color: '#f0a742', margin: 0, fontStyle: 'italic' }}>⚠ Musique personnalisée en base — le champ est vide, sauvegarder supprimera cette musique.</p>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => saveSection(detailSec.id)} disabled={isSaving} style={{ padding: '0.5rem 1.4rem', background: 'var(--accent)', color: '#0f0f14', border: 'none', borderRadius: '7px', cursor: isSaving ? 'default' : 'pointer', fontWeight: 'bold', fontSize: '0.88rem', opacity: isSaving ? 0.6 : 1 }}>
                    {isSaving ? '…' : '✓ Sauvegarder'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Sub-tab: Choix & Épreuve (avec transitions/retours/images) ── */}
            {sectionDetailTab === 'choix' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {sChoices.map(choice => {
                  const targetSection = sections.find(s => s.id === choice.target_section_id)
                  const targetNum = targetSection?.number
                  const tt = targetSection ? getSectionType(targetSection) : null
                  const isEditingTransition_ = editingTransition === choice.id
                  const isGenerating = generatingTransition === choice.id
                  const isEditingReturn_ = editingReturn === choice.id
                  const isGeneratingReturn_ = generatingReturn === choice.id
                  const arrow = choice.is_back ? '↩' : '→'
                  const arrowColor = choice.is_back ? '#6b8cde' : 'var(--accent)'

                  return (
                    <div key={choice.id} style={{ border: `1px solid ${choice.is_back ? '#6b8cde44' : 'var(--border)'}`, borderRadius: '8px', overflow: 'hidden', background: 'var(--surface)' }}>
                      {/* Header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.85rem', background: choice.is_back ? '#6b8cde0a' : 'var(--surface-2)' }}>
                        <span style={{ color: arrowColor, fontWeight: 'bold', fontSize: '1rem' }}>{arrow}</span>
                        <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--foreground)' }}>{choice.label}</span>
                        {tt && targetNum && (
                          <button onClick={() => { setSectionDetailId(targetSection!.id); setSectionDetailTab('resume') }}
                            style={{ fontSize: '0.65rem', padding: '0.2rem 0.55rem', borderRadius: '5px', background: tt.color + '22', border: `1px solid ${tt.color}44`, color: tt.color, cursor: 'pointer', fontWeight: 'bold' }}>
                            {tt.icon} §{targetNum}
                          </button>
                        )}
                        <button onClick={() => { isEditingTransition_ ? setEditingTransition(null) : (setEditingTransition(choice.id), setTransitionDraft(choice.transition_text ?? '')) }}
                          style={{ fontSize: '0.65rem', padding: '0.18rem 0.5rem', borderRadius: '5px', border: '1px solid var(--border)', background: 'transparent', color: choice.transition_text ? '#b48edd' : 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {choice.transition_text ? '✨ Transition' : '+ Transition'}
                        </button>
                      </div>

                      {/* ── Édition transition ── */}
                      {isEditingTransition_ && (
                        <div style={{ padding: '0.75rem 0.85rem', background: '#b48edd08', borderTop: '1px solid #b48edd33', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div style={{ fontSize: '0.65rem', color: '#b48edd', fontWeight: 'bold' }}>✨ Texte de transition — §{detailSec.number} → §{targetNum ?? '?'}</div>
                          <textarea value={transitionDraft} onChange={e => setTransitionDraft(e.target.value)} rows={3}
                            placeholder="Texte affiché au joueur quand il fait ce choix (30–60 mots)…"
                            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid #b48edd55', borderRadius: '6px', padding: '0.5rem 0.75rem', color: 'var(--foreground)', fontSize: '0.85rem', resize: 'vertical', outline: 'none', fontFamily: 'Georgia, serif', boxSizing: 'border-box', lineHeight: 1.6 }} />
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <button onClick={async () => {
                              if (!targetSection) return
                              setGeneratingTransition(choice.id)
                              try {
                                const res = await fetch(`/api/books/${id}/generate-transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choiceId: choice.id, sourceContent: detailSec.content, choiceLabel: choice.label, targetContent: targetSection.content }) })
                                const data = await res.json()
                                if (data.transition) { setTransitionDraft(data.transition); setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_text: data.transition } : c)); setEditingTransition(null) }
                              } finally { setGeneratingTransition(null) }
                            }} disabled={isGenerating || !targetSection}
                              style={{ fontSize: '0.72rem', padding: '0.28rem 0.65rem', borderRadius: '5px', border: 'none', background: '#b48edd', color: '#0f0f14', cursor: isGenerating ? 'default' : 'pointer', fontWeight: 'bold', opacity: isGenerating ? 0.6 : 1 }}>
                              {isGenerating ? '…' : '✨ Générer'}
                            </button>
                            <button onClick={async () => {
                              await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_text: transitionDraft || null }) })
                              setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_text: transitionDraft || undefined } : c))
                              setEditingTransition(null)
                            }} style={{ fontSize: '0.72rem', padding: '0.28rem 0.65rem', borderRadius: '5px', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>Sauvegarder</button>
                            {choice.transition_text && (
                              <button onClick={async () => {
                                await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_text: null }) })
                                setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_text: undefined } : c))
                                setEditingTransition(null)
                              }} style={{ fontSize: '0.72rem', padding: '0.28rem 0.65rem', borderRadius: '5px', border: '1px solid #c94c4c55', background: 'transparent', color: '#c94c4c', cursor: 'pointer' }}>Supprimer</button>
                            )}
                          </div>
                          {/* Sélecteur image transition */}
                          {detailSec.images && detailSec.images.some(img => img.url) && (
                            <div>
                              <div style={{ fontSize: '0.62rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>Image de transition :</div>
                              <div style={{ display: 'flex', gap: '0.35rem' }}>
                                {[0, 1, 2, 3].map(idx => {
                                  const imgUrl = detailSec.images?.[idx]?.url
                                  const selected = (choice.transition_image_index ?? 3) === idx
                                  return (
                                    <button key={idx} onClick={async () => {
                                      await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_image_index: idx }) })
                                      setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_image_index: idx } : c))
                                    }} style={{ padding: 0, border: selected ? '2px solid #b48edd' : '2px solid transparent', borderRadius: '4px', background: 'none', cursor: 'pointer' }}>
                                      {imgUrl
                                        ? <img src={imgUrl} alt="" style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '3px', display: 'block' }} />
                                        : <div style={{ width: '48px', height: '48px', background: 'var(--surface-2)', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: 'var(--muted)' }}>{idx + 1}</div>
                                      }
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {/* Image dédiée transition */}
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                            {choice.transition_image_url && (
                              <img src={choice.transition_image_url} alt="" onClick={() => setZoomedImage(choice.transition_image_url!)} style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #b48edd55', cursor: 'zoom-in', flexShrink: 0 }} />
                            )}
                            <ImageGenButton type="section" provider={imageProvider}
                              storagePath={`books/${id}/transitions/${choice.id}`}
                              data={{ summary: transitionDraft || choice.transition_text || choice.label, content: transitionDraft || '', theme: book.theme, style: book.illustration_style ?? 'realistic', protagonist: book.protagonist_description ?? '', illustration_bible: book.illustration_bible ?? '' }}
                              currentUrl={choice.transition_image_url} label="🖼 Illustrer"
                              onSaved={async (url) => {
                                const cleanUrl = url.split('?')[0]
                                await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_image_url: cleanUrl }) })
                                setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_image_url: cleanUrl } : c))
                              }} />
                          </div>
                        </div>
                      )}
                      {/* Affichage transition (non édition) */}
                      {!isEditingTransition_ && choice.transition_text && (
                        <div style={{ padding: '0.5rem 0.85rem', background: '#b48edd08', borderTop: '1px solid #b48edd22', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                          {(() => { const imgUrl = choice.transition_image_url || detailSec.images?.[(choice.transition_image_index ?? 3)]?.url; return imgUrl ? <img src={imgUrl} alt="" style={{ width: '52px', height: '52px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} /> : null })()}
                          <p style={{ fontSize: '0.78rem', color: '#b48edd', fontStyle: 'italic', margin: 0, lineHeight: 1.5 }}>{choice.transition_text}</p>
                        </div>
                      )}

                      {/* ── Texte de retour ── */}
                      <div style={{ borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.85rem', background: '#4ec9b008' }}>
                          <span style={{ fontSize: '0.62rem', color: '#4ec9b0', fontWeight: 'bold', flex: 1 }}>↩ Texte de retour</span>
                          <button onClick={() => { isEditingReturn_ ? setEditingReturn(null) : (setEditingReturn(choice.id), setReturnDraft(choice.return_text ?? '')) }}
                            style={{ fontSize: '0.62rem', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: choice.return_text ? '#4ec9b0' : 'var(--muted)', cursor: 'pointer' }}>
                            {choice.return_text ? '✏ Modifier' : '+ Ajouter'}
                          </button>
                        </div>
                        {isEditingReturn_ && (
                          <div style={{ padding: '0.65rem 0.85rem', background: '#4ec9b008', borderTop: '1px solid #4ec9b022', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <textarea value={returnDraft} onChange={e => setReturnDraft(e.target.value)} rows={3}
                              placeholder="Texte mémoriel affiché quand le joueur revient ici (30–60 mots)…"
                              style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid #4ec9b044', borderRadius: '6px', padding: '0.5rem 0.75rem', color: 'var(--foreground)', fontSize: '0.85rem', resize: 'vertical', outline: 'none', fontFamily: 'Georgia, serif', boxSizing: 'border-box', lineHeight: 1.6 }} />
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button onClick={async () => {
                                if (!targetSection) return
                                setGeneratingReturn(choice.id)
                                try {
                                  const res = await fetch(`/api/books/${id}/generate-transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choiceId: choice.id, sourceContent: detailSec.content, choiceLabel: choice.label, targetContent: targetSection.content, mode: 'return' }) })
                                  const data = await res.json()
                                  if (data.return_text) { setReturnDraft(data.return_text); setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, return_text: data.return_text } : c)); setEditingReturn(null) }
                                } finally { setGeneratingReturn(null) }
                              }} disabled={isGeneratingReturn_ || !targetSection}
                                style={{ fontSize: '0.72rem', padding: '0.28rem 0.65rem', borderRadius: '5px', border: 'none', background: '#4ec9b0', color: '#0f0f14', cursor: isGeneratingReturn_ ? 'default' : 'pointer', fontWeight: 'bold', opacity: isGeneratingReturn_ ? 0.6 : 1 }}>
                                {isGeneratingReturn_ ? '…' : '✨ Générer'}
                              </button>
                              <button onClick={async () => {
                                await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ return_text: returnDraft || null }) })
                                setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, return_text: returnDraft || undefined } : c))
                                setEditingReturn(null)
                              }} style={{ fontSize: '0.72rem', padding: '0.28rem 0.65rem', borderRadius: '5px', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>Sauvegarder</button>
                            </div>
                            {/* Image retour */}
                            {detailSec.images && detailSec.images.some(img => img.url) && (
                              <div>
                                <div style={{ fontSize: '0.62rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>Image de retour :</div>
                                <div style={{ display: 'flex', gap: '0.35rem' }}>
                                  {[0, 1, 2, 3].map(idx => {
                                    const imgUrl = detailSec.images?.[idx]?.url
                                    const selected = (choice.return_image_index ?? 3) === idx
                                    return (
                                      <button key={idx} onClick={async () => {
                                        await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ return_image_index: idx }) })
                                        setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, return_image_index: idx } : c))
                                      }} style={{ padding: 0, border: selected ? '2px solid #4ec9b0' : '2px solid transparent', borderRadius: '4px', background: 'none', cursor: 'pointer' }}>
                                        {imgUrl
                                          ? <img src={imgUrl} alt="" style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '3px', display: 'block' }} />
                                          : <div style={{ width: '48px', height: '48px', background: 'var(--surface-2)', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: 'var(--muted)' }}>{idx + 1}</div>
                                        }
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {!isEditingReturn_ && choice.return_text && (
                          <div style={{ padding: '0.35rem 0.85rem', background: '#4ec9b008', borderTop: '1px solid #4ec9b022' }}>
                            <p style={{ fontSize: '0.75rem', color: '#4ec9b0', fontStyle: 'italic', margin: 0 }}>{choice.return_text}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {/* Épreuve */}
                {hasTrial && (() => {
                  const sucSec = sections.find(s => s.id === detailSec.trial!.success_section_id)
                  const failSec = sections.find(s => s.id === detailSec.trial!.failure_section_id)
                  const trialNpc = detailSec.trial?.npc_id ? npcs.find(n => n.id === detailSec.trial!.npc_id) : null
                  return (
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem 1.1rem' }}>
                      <div style={labelStyle}>Épreuve{trialNpc ? ` — ${trialNpc.name}` : ''}</div>
                      <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {sucSec && (
                          <button onClick={() => { setSectionDetailId(sucSec.id); setSectionDetailTab('resume') }}
                            style={{ flex: 1, padding: '0.75rem', background: '#4caf7d12', border: '1px solid #4caf7d44', borderRadius: '8px', cursor: 'pointer', textAlign: 'left' }}>
                            <div style={{ fontSize: '0.6rem', color: 'var(--success)', fontWeight: 'bold', marginBottom: '0.25rem' }}>✓ SUCCÈS</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--foreground)', fontWeight: 'bold' }}>{getSectionType(sucSec).icon} §{sucSec.number}</div>
                            {sucSec.summary && <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{sucSec.summary.slice(0, 70)}</div>}
                          </button>
                        )}
                        {failSec && (
                          <button onClick={() => { setSectionDetailId(failSec.id); setSectionDetailTab('resume') }}
                            style={{ flex: 1, padding: '0.75rem', background: '#c94c4c12', border: '1px solid #c94c4c44', borderRadius: '8px', cursor: 'pointer', textAlign: 'left' }}>
                            <div style={{ fontSize: '0.6rem', color: 'var(--danger)', fontWeight: 'bold', marginBottom: '0.25rem' }}>✗ ÉCHEC</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--foreground)', fontWeight: 'bold' }}>{getSectionType(failSec).icon} §{failSec.number}</div>
                            {failSec.summary && <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{failSec.summary.slice(0, 70)}</div>}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })()}
                {!sChoices.length && !hasTrial && (
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>Aucun choix ni épreuve définis pour cette section.</p>
                )}
              </div>
            )}

          </div>
        )
      })()}

      {/* ── Onglet Sections (grille) ─────────────────────────────────────────── */}
      {tab === 'sections' && !sectionDetailId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* ── Légende + Filtres ──────────────────────────────────────────── */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
            padding: '0.6rem 0.9rem',
            background: 'var(--surface)', borderRadius: '8px',
            border: '1px solid var(--border)', alignItems: 'center',
          }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginRight: '0.25rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Filtrer
            </span>
            {SECTION_TYPES.map(t => {
              const active = activeFilters.has(t.label)
              return (
                <button key={t.label} onClick={() => {
                  setActiveFilters(prev => {
                    const next = new Set(prev)
                    active ? next.delete(t.label) : next.add(t.label)
                    return next
                  })
                }} style={{
                  fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '20px',
                  background: active ? t.color + '44' : t.color + '18',
                  color: t.color, display: 'flex', alignItems: 'center', gap: '0.3rem',
                  border: active ? `1.5px solid ${t.color}` : '1.5px solid transparent',
                  cursor: 'pointer', fontWeight: active ? 'bold' : 'normal',
                  transition: 'all 0.15s',
                }}>
                  {t.icon} {t.label}
                </button>
              )
            })}
            {activeFilters.size > 0 && (
              <button onClick={() => setActiveFilters(new Set())} style={{
                fontSize: '0.68rem', padding: '0.2rem 0.55rem', borderRadius: '20px',
                background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)',
                cursor: 'pointer', marginLeft: '0.25rem',
              }}>
                ✕ Réinitialiser
              </button>
            )}
          </div>

          {/* ── Panneau de génération de structure (phase draft) ─────────────── */}
          {sections.length === 0 && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--accent)44',
              borderLeft: '3px solid var(--accent)', borderRadius: '10px', padding: '1.5rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
                <span style={{ fontSize: '1.2rem' }}>🏗</span>
                <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--accent)' }}>Paramètres de structure</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)', marginLeft: '0.25rem' }}>— Configurez avant de générer</span>
              </div>

              {/* Nb sections + difficulté */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                    Nb. sections
                  </div>
                  <input
                    type="number" min={20} max={100}
                    defaultValue={book.num_sections ?? 30}
                    onBlur={async e => {
                      const v = parseInt(e.target.value)
                      if (!v || v === book.num_sections) return
                      await fetch(`/api/books/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ num_sections: v }) })
                      setBook(b => b ? { ...b, num_sections: v } : b)
                    }}
                    style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem 0.6rem', color: 'var(--foreground)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                    Difficulté
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {([
                      { value: 'facile', icon: '🌱' }, { value: 'normal', icon: '⚔️' },
                      { value: 'difficile', icon: '🔥' }, { value: 'expert', icon: '💀' },
                    ] as const).map(d => (
                      <button key={d.value} type="button"
                        onClick={async () => {
                          await fetch(`/api/books/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ difficulty: d.value }) })
                          setBook(b => b ? { ...b, difficulty: d.value } : b)
                        }}
                        style={{
                          flex: 1, padding: '0.45rem 0.3rem', borderRadius: '6px', cursor: 'pointer', border: 'none',
                          background: book.difficulty === d.value ? 'var(--accent)' : 'var(--surface-2)',
                          color: book.difficulty === d.value ? '#0f0f14' : 'var(--muted)',
                          fontSize: '0.72rem', fontWeight: 'bold', transition: 'all 0.15s',
                        }}>
                        {d.icon} {d.value.charAt(0).toUpperCase() + d.value.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Adresse au lecteur */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                  Adresse au lecteur
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {([
                    { value: 'vous' as const, icon: '🎩', label: 'Vouvoiement' },
                    { value: 'tu' as const, icon: '🤝', label: 'Tutoiement' },
                  ]).map(opt => (
                    <button key={opt.value} type="button"
                      onClick={async () => {
                        await fetch(`/api/books/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address_form: opt.value }) })
                        setBook(b => b ? { ...b, address_form: opt.value } : b)
                      }}
                      style={{
                        flex: 1, padding: '0.45rem 0.75rem', borderRadius: '6px', cursor: 'pointer',
                        border: `2px solid ${(book.address_form ?? 'vous') === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                        background: (book.address_form ?? 'vous') === opt.value ? 'var(--accent)18' : 'var(--surface-2)',
                        color: (book.address_form ?? 'vous') === opt.value ? 'var(--accent)' : 'var(--muted)',
                        fontSize: '0.78rem', fontWeight: 'bold', transition: 'all 0.15s',
                      }}>
                      {opt.icon} {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mix de contenu */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                  Répartition des épreuves
                </div>
                {([
                  { key: 'combat' as const, label: 'Combat',   icon: '⚔️',  color: '#e05c4b' },
                  { key: 'chance' as const, label: 'Chance',   icon: '🎲', color: '#f0a742' },
                  { key: 'enigme' as const, label: 'Énigme',   icon: '🧩', color: '#6b8cde' },
                  { key: 'magie'  as const, label: 'Magie',    icon: '✨', color: '#b48edd' },
                ]).map(f => (
                  <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: f.color, width: '80px', flexShrink: 0 }}>{f.icon} {f.label}</span>
                    <input
                      type="range" min={0} max={50} step={5}
                      defaultValue={book.content_mix?.[f.key] ?? 0}
                      onMouseUp={async e => {
                        const v = parseInt((e.target as HTMLInputElement).value)
                        const newMix = { ...(book.content_mix ?? { combat: 20, chance: 10, enigme: 10, magie: 5 }), [f.key]: v }
                        await fetch(`/api/books/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content_mix: newMix }) })
                        setBook(b => b ? { ...b, content_mix: newMix } : b)
                      }}
                      style={{ flex: 1, accentColor: f.color, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.72rem', color: f.color, width: '30px', textAlign: 'right' }}>
                      {book.content_mix?.[f.key] ?? 0}%
                    </span>
                  </div>
                ))}
              </div>

              {structureError && (
                <p style={{ color: 'var(--danger)', fontSize: '0.82rem', background: '#c94c4c11', padding: '0.6rem 0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>
                  ⚠ {structureError}
                </p>
              )}
              {structureResult && !structureError && (
                <div style={{ fontSize: '0.78rem', background: '#4caf7d11', border: '1px solid #4caf7d44', borderRadius: '6px', padding: '0.6rem 0.75rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', gap: '1rem', color: '#4caf7d', marginBottom: structureResult.validation ? '0.4rem' : 0 }}>
                    <span>✅ {structureResult.sections_count} sections</span>
                    <span>👥 {structureResult.npcs_count} PNJ</span>
                    <span>🔀 {structureResult.choices_count} choix</span>
                  </div>
                  {structureResult.validation && (
                    <div style={{ borderTop: '1px solid #4caf7d22', paddingTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      {structureResult.validation.log.map((line, i) => (
                        <span key={i} style={{ color: line.startsWith('⚠') ? '#f0a742' : '#4caf7d' }}>{line}</span>
                      ))}
                      {structureResult.validation.remaining_critical === 0
                        ? <span style={{ color: '#4caf7d', fontWeight: 'bold' }}>🎯 Structure validée — 0 problème critique</span>
                        : <span style={{ color: '#f0a742' }}>⚠ {structureResult.validation.remaining_critical} problème(s) critique(s) restant(s) — vérifier l'onglet Cohérence</span>
                      }
                    </div>
                  )}
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--muted)', cursor: 'pointer', marginBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={agentAfterGeneration}
                  onChange={e => setAgentAfterGeneration(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                Lancer l'agent correcteur après la génération
              </label>
              <button
                onClick={generateStructure}
                disabled={generatingStructure}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '8px', border: 'none',
                  background: generatingStructure ? 'var(--muted)' : 'var(--accent)',
                  color: '#0f0f14', fontWeight: 'bold', fontSize: '0.95rem',
                  cursor: generatingStructure ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                }}
              >
                {generatingStructure
                  ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙</span> Génération de la structure…</>
                  : '🏗 Générer la structure'}
              </button>
            </div>
          )}

          {/* ── Barre d'outils sections ───────────────────────────────────────── */}
          {sections.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* Ligne 1 : Génération de texte */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 'bold', minWidth: '42px' }}>Texte</span>
              <button onClick={() => writeAll(false)} disabled={writingAll || illustratingAll || resettingStructure} style={{
                background: writingAll ? 'var(--surface-2)' : 'var(--surface)',
                border: `1px solid ${writingAll ? 'var(--border)' : 'var(--success)55'}`, borderRadius: '7px',
                padding: '0.4rem 0.85rem', fontSize: '0.78rem', cursor: (writingAll || illustratingAll || resettingStructure) ? 'default' : 'pointer',
                color: writingAll ? 'var(--muted)' : 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.4rem',
              }}>
                ✍️ {writingAll
                  ? writeProgress ? `${writeProgress.written}/${writeProgress.total} rédigées…` : 'Démarrage…'
                  : 'Rédiger (Mistral)'}
              </button>
              <button onClick={() => { if (confirm('Tout réécrire ? Les textes existants seront remplacés.')) writeAll(true) }} disabled={writingAll || illustratingAll || resettingStructure} style={{
                background: 'transparent', border: '1px solid var(--success)33', borderRadius: '7px',
                padding: '0.4rem 0.85rem', fontSize: '0.78rem', cursor: (writingAll || illustratingAll || resettingStructure) ? 'default' : 'pointer',
                color: 'var(--success)88' as any, display: 'flex', alignItems: 'center', gap: '0.4rem',
              }}>
                🔄 Tout réécrire
              </button>
              {sections.some(s => s.content) && (
                <button onClick={generateReadTimes} disabled={generatingReadTimes || writingAll || resettingStructure} style={{
                  background: 'transparent', border: '1px solid #a084c844', borderRadius: '7px',
                  padding: '0.4rem 0.85rem', fontSize: '0.78rem', cursor: (generatingReadTimes || writingAll || resettingStructure) ? 'default' : 'pointer',
                  color: generatingReadTimes ? 'var(--muted)' : '#b89edd', display: 'flex', alignItems: 'center', gap: '0.4rem',
                }}>
                  {generatingReadTimes ? '⏳ Calcul…' : '⏱ Temps de lecture'}
                </button>
              )}
            </div>
            {/* Ligne 2 : Illustrations */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 'bold', minWidth: '42px' }}>Image</span>
              {/* Sélecteur provider */}
              <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                {(['replicate', 'leonardo'] as const).map(p => (
                  <button key={p} onClick={() => setImageProvider(p)} disabled={illustratingAll} style={{
                    padding: '0.3rem 0.7rem', fontSize: '0.73rem', border: 'none', cursor: 'pointer',
                    background: imageProvider === p ? 'var(--accent)' : 'transparent',
                    color: imageProvider === p ? '#0f0f14' : 'var(--muted)',
                    fontWeight: imageProvider === p ? 'bold' : 'normal',
                  }}>
                    {p === 'replicate' ? '⚡ Replicate' : '🎨 Leonardo'}
                  </button>
                ))}
              </div>
              <button onClick={illustrateAll} disabled={illustratingAll || writingAll} style={{
                background: illustratingAll ? 'var(--surface-2)' : 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: '7px',
                padding: '0.4rem 0.85rem', fontSize: '0.78rem', cursor: (illustratingAll || writingAll) ? 'default' : 'pointer',
                color: illustratingAll ? 'var(--muted)' : 'var(--foreground)', display: 'flex', alignItems: 'center', gap: '0.4rem',
              }}>
                🖼 {illustratingAll ? 'Illustration en cours…' : 'Illustrer toutes les sections'}
              </button>
              {/* Zone danger */}
              <div style={{ marginLeft: 'auto' }}>
                <button onClick={resetStructure} disabled={writingAll || illustratingAll || resettingStructure} style={{
                  background: 'transparent', border: '1px solid var(--danger)33', borderRadius: '7px',
                  padding: '0.4rem 0.85rem', fontSize: '0.78rem', cursor: (writingAll || illustratingAll || resettingStructure) ? 'default' : 'pointer',
                  color: resettingStructure ? 'var(--muted)' : 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.4rem',
                }}>
                  {resettingStructure ? '⏳ Réinitialisation…' : '🗑 Réinitialiser la structure'}
                </button>
              </div>
            </div>
            {illustrationProgress && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                <div style={{ flex: 1, height: '6px', background: 'var(--surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(illustrationProgress.current / illustrationProgress.total) * 100}%`,
                    height: '100%', background: 'var(--accent)', transition: 'width 0.5s',
                  }} />
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {illustrationProgress.current} / {illustrationProgress.total}
                </span>
              </div>
            )}
            {writeProgress && !writingAll && null}
            {writingAll && writeProgress && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                <div style={{ flex: 1, height: '6px', background: 'var(--surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(writeProgress.written / writeProgress.total) * 100}%`,
                    height: '100%', background: '#4caf7d', transition: 'width 0.5s',
                  }} />
                </div>
                <span style={{ fontSize: '0.75rem', color: '#4caf7d', whiteSpace: 'nowrap' }}>
                  {writeProgress.written} / {writeProgress.total}
                </span>
              </div>
            )}
          </div>}
          {writeMessage && (
            <p style={{ fontSize: '0.8rem', color: writeMessage.startsWith('✅') ? '#4caf7d' : '#c94c4c', margin: '0.4rem 0 0' }}>
              {writeMessage}
            </p>
          )}

          {/* ── Bloc Prologue ────────────────────────────────────────────────── */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid #c9a84c44',
            borderLeft: '3px solid var(--accent)',
            borderRadius: '10px', padding: '1.25rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: prologueExpanded ? '0.9rem' : 0 }}>
              <div onClick={() => setPrologueExpanded(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', flex: 1 }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', transition: 'transform 0.15s', transform: prologueExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', userSelect: 'none' }}>▶</span>
                <span style={{ fontSize: '1.1rem' }}>📖</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--accent)' }}>Prologue</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>— Texte d'introduction avant §1</span>
                {!prologueExpanded && introText && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                    {introText.slice(0, 80)}…
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {prologueExpanded && !editingIntro && (
                  <button
                    onClick={async () => {
                      setIntroGenerating(true)
                      try {
                        const res = await fetch(`/api/books/${id}/generate-intro`, { method: 'POST' })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data.error)
                        setIntroText(data.intro_text)
                        setBook(b => b ? { ...b, intro_text: data.intro_text } : b)
                      } catch (err: any) { alert(err.message) }
                      finally { setIntroGenerating(false) }
                    }}
                    disabled={introGenerating}
                    style={{
                      fontSize: '0.72rem', padding: '0.25rem 0.65rem', borderRadius: '5px',
                      background: introGenerating ? 'var(--surface-2)' : 'var(--accent)22',
                      border: `1px solid ${introGenerating ? 'var(--border)' : 'var(--accent)66'}`,
                      color: introGenerating ? 'var(--muted)' : 'var(--accent)',
                      cursor: introGenerating ? 'not-allowed' : 'pointer', fontWeight: 'bold',
                    }}
                  >{introGenerating ? '⏳ Génération...' : introText ? '🔄 Régénérer' : '✨ Générer'}</button>
                )}
                {prologueExpanded && <button
                  onClick={() => { setEditingIntro(v => !v) }}
                  style={{
                    fontSize: '0.72rem', padding: '0.25rem 0.65rem', borderRadius: '5px',
                    background: editingIntro ? 'var(--accent)' : 'var(--surface-2)',
                    border: `1px solid ${editingIntro ? 'var(--accent)' : 'var(--border)'}`,
                    color: editingIntro ? '#0f0f14' : 'var(--muted)',
                    cursor: 'pointer', fontWeight: 'bold',
                  }}
                >{editingIntro ? '✕ Annuler' : '✏ Modifier'}</button>}
                {editingIntro && (
                  <button
                    onClick={async () => {
                      setIntroSaving(true)
                      await fetch(`/api/books/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ intro_text: introText }),
                      })
                      setBook(b => b ? { ...b, intro_text: introText } : b)
                      setIntroSaving(false)
                      setEditingIntro(false)
                    }}
                    disabled={introSaving}
                    style={{
                      fontSize: '0.72rem', padding: '0.25rem 0.65rem', borderRadius: '5px',
                      background: '#4caf7d', border: 'none',
                      color: '#fff', cursor: introSaving ? 'not-allowed' : 'pointer', fontWeight: 'bold',
                    }}
                  >{introSaving ? '...' : '✓ Sauvegarder'}</button>
                )}
              </div>
            </div>

            {prologueExpanded && (editingIntro ? (
              <textarea
                value={introText}
                onChange={e => setIntroText(e.target.value)}
                rows={10}
                style={{
                  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: '6px', padding: '0.75rem', color: 'var(--foreground)',
                  fontSize: '0.875rem', lineHeight: 1.7, resize: 'vertical',
                  outline: 'none', fontFamily: 'Georgia, serif', boxSizing: 'border-box',
                }}
              />
            ) : introText ? (
              <div style={{
                fontSize: '0.875rem', lineHeight: 1.8, color: 'var(--foreground)',
                fontFamily: 'Georgia, serif', whiteSpace: 'pre-wrap',
                borderLeft: '2px solid var(--border)', paddingLeft: '1rem',
                maxHeight: '320px', overflowY: 'auto',
              }}>
                {introText}
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: '0.82rem', fontStyle: 'italic', margin: 0 }}>
                Aucun prologue rédigé. Cliquez sur "Générer" pour qu'il soit écrit automatiquement par Claude,
                ou sur "Modifier" pour le saisir manuellement.
              </p>
            ))}
          </div>
          {/* ── Section cards grid ─────────────────────────────────────────── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '0.85rem',
          }}>
            {sections.filter(s => {
              if (activeFilters.size === 0) return true
              return activeFilters.has(getSectionType(s).label)
            }).map(section => {
              const sc = SECTION_STATUS_CONFIG[section.status ?? 'draft']
              const t = getSectionType(section)
              const isSaving = sectionSaving === section.id
              const allImgs = (section.images ?? []).filter(img => img.url)
              const imgIdx = cardImageIndex[section.id] ?? 0
              const imgUrl = allImgs[imgIdx]?.url || section.image_url
              const sChoices = choices.filter(c => c.section_id === section.id).sort((a, b) => a.sort_order - b.sort_order)
              const hasTrial = section.trial && (section.trial.success_section_id || section.trial.failure_section_id)
              const trialNpc = section.trial?.npc_id ? npcs.find(n => n.id === section.trial!.npc_id) : null
              const companions = (section.companion_npc_ids ?? []).map(cid => npcs.find(n => n.id === cid)).filter(Boolean)

              const openEditModal = (sec: Section) => {
                setPreviousSectionId(null)
                setSectionModal(sec.id)
                setEditingSection(sec.id)
                setEditContent(sec.content)
                setEditSummary(sec.summary ?? '')
                setEditHint(sec.hint_text ?? '')
                setEditMusicUrl(sec.music_url ?? '')
                const imgs = sec.images ?? []
                setEditImages(Array.from({ length: 4 }, (_, i) => ({ url: imgs[i]?.url, description: imgs[i]?.description ?? '', style: imgs[i]?.style ?? book.illustration_style ?? 'realistic', includeProtagonist: false })))
              }

              return (
                <div key={section.id} id={`sec-${section.number}`}
                  onClick={() => { setSectionDetailId(section.id); setSectionDetailTab('resume') }}
                  style={{
                    background: 'var(--card-bg)',
                    border: `2px solid ${t.color}55`,
                    borderRadius: '10px', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    cursor: 'pointer', scrollMarginTop: '1rem',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                    boxShadow: `0 0 0 0px ${t.color}00`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = t.color + 'aa'; e.currentTarget.style.boxShadow = `0 0 12px ${t.color}33` }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = t.color + '55'; e.currentTarget.style.boxShadow = 'none' }}
                >
                  {/* ── Image area ── */}
                  <div style={{ position: 'relative', aspectRatio: '16/9', background: '#0a0a0c', overflow: 'hidden', flexShrink: 0 }}
                    onClick={e => e.stopPropagation()}
                  >
                    {imgUrl
                      ? <img src={imgUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'opacity 0.2s' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', opacity: 0.15 }}>{t.icon}</div>
                    }
                    {/* Carousel arrows — only when multiple images */}
                    {allImgs.length > 1 && (<>
                      <button
                        onClick={e => { e.stopPropagation(); setCardImageIndex(p => ({ ...p, [section.id]: (imgIdx - 1 + allImgs.length) % allImgs.length })) }}
                        style={{ position: 'absolute', left: '0.3rem', top: '50%', transform: 'translateY(-50%)', background: '#000000cc', border: 'none', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
                      >‹</button>
                      <button
                        onClick={e => { e.stopPropagation(); setCardImageIndex(p => ({ ...p, [section.id]: (imgIdx + 1) % allImgs.length })) }}
                        style={{ position: 'absolute', right: '0.3rem', top: '50%', transform: 'translateY(-50%)', background: '#000000cc', border: 'none', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
                      >›</button>
                      {/* Dots indicator */}
                      <div style={{ position: 'absolute', bottom: '0.3rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '3px', zIndex: 2 }}>
                        {allImgs.map((_, i) => (
                          <div key={i} onClick={e => { e.stopPropagation(); setCardImageIndex(p => ({ ...p, [section.id]: i })) }} style={{ width: '5px', height: '5px', borderRadius: '50%', background: i === imgIdx ? '#fff' : '#ffffff55', cursor: 'pointer', transition: 'background 0.15s' }} />
                        ))}
                      </div>
                    </>)}
                    {/* Type badge */}
                    <div style={{
                      position: 'absolute', top: '0.45rem', left: '0.45rem',
                      background: t.color + 'dd', color: '#fff',
                      fontSize: '0.58rem', fontWeight: 'bold',
                      padding: '0.12rem 0.42rem', borderRadius: '4px',
                      pointerEvents: 'none',
                    }}>
                      {t.icon} {t.label}
                    </div>
                    {/* Section number — top right */}
                    <div style={{
                      position: 'absolute', top: '0.45rem', right: '0.45rem',
                      background: '#000000cc', color: 'var(--accent)',
                      fontSize: '1rem', fontWeight: 'bold',
                      padding: '0.15rem 0.55rem', borderRadius: '5px',
                      pointerEvents: 'none', letterSpacing: '0.03em',
                    }}>
                      §{String(section.number).padStart(2, '0')}
                    </div>
                    {/* Status — only when validated */}
                    {section.status === 'validated' && (
                      <div style={{
                        position: 'absolute', bottom: '0.45rem', right: '0.45rem',
                        background: 'var(--success)cc', color: '#fff',
                        fontSize: '0.58rem', fontWeight: 'bold',
                        padding: '0.12rem 0.45rem', borderRadius: '4px',
                        pointerEvents: 'none',
                      }}>
                        ✓ Validé
                      </div>
                    )}
                  </div>

                  {/* ── Card body ── */}
                  <div style={{ padding: '0.55rem 0.7rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {section.summary
                      ? <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                          {section.summary}
                        </p>
                      : <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--muted)', opacity: 0.4, fontStyle: 'italic' }}>Aucun résumé</p>
                    }
                    {/* NPC + choices chips */}
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      {trialNpc && (
                        <span style={{ fontSize: '0.56rem', padding: '0.08rem 0.35rem', borderRadius: '4px', background: NPC_TYPE_CONFIG[trialNpc.type].color + '22', color: NPC_TYPE_CONFIG[trialNpc.type].color }}>
                          {NPC_TYPE_CONFIG[trialNpc.type].icon} {trialNpc.name}
                        </span>
                      )}
                      {companions.map(c => c && (
                        <span key={c.id} style={{ fontSize: '0.56rem', padding: '0.08rem 0.35rem', borderRadius: '4px', background: 'var(--success)15', color: 'var(--success)' }}>
                          👥 {c.name}
                        </span>
                      ))}
                      {sChoices.length > 0 && (
                        <span style={{ fontSize: '0.56rem', padding: '0.08rem 0.35rem', borderRadius: '4px', background: 'var(--surface-2)', color: 'var(--muted)' }}>
                          {sChoices.length} choix
                        </span>
                      )}
                      {hasTrial && (
                        <span style={{ fontSize: '0.56rem', padding: '0.08rem 0.35rem', borderRadius: '4px', background: '#f0a74220', color: '#f0a742' }}>
                          ⚡ épreuve
                        </span>
                      )}
                      {section.continues_timer && (
                        <span style={{ fontSize: '0.56rem', padding: '0.08rem 0.35rem', borderRadius: '4px', background: '#4ec9b018', color: '#4ec9b0' }}>⏱</span>
                      )}
                    </div>
                  </div>

                  {/* ── Footer actions ── */}
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{ borderTop: '1px solid var(--card-border)', padding: '0.4rem 0.55rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}
                  >
                    {section.status === 'validated'
                      ? <button onClick={() => updateSectionStatus(section.id, 'draft')} disabled={isSaving}
                          style={{ fontSize: '0.55rem', padding: '0.1rem 0.38rem', borderRadius: '4px', border: `1px solid ${SECTION_STATUS_CONFIG.validated.color}`, background: SECTION_STATUS_CONFIG.validated.bg, color: SECTION_STATUS_CONFIG.validated.color, cursor: 'pointer', opacity: isSaving ? 0.5 : 1 }}>
                          ✓ Validé
                        </button>
                      : <button onClick={() => updateSectionStatus(section.id, 'validated')} disabled={isSaving}
                          style={{ fontSize: '0.55rem', padding: '0.1rem 0.38rem', borderRadius: '4px', border: '1px solid #ffffff22', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', opacity: isSaving ? 0.5 : 1 }}>
                          Valider
                        </button>
                    }
                    <div style={{ flex: 1 }} />
                    <button onClick={() => setNarrationPanel({ sectionId: section.id, content: section.content })}
                      style={{ fontSize: '0.6rem', padding: '0.1rem 0.38rem', borderRadius: '4px', background: 'none', border: '1px solid #b48edd44', color: '#b48edd', cursor: 'pointer' }} title="Narration">✨</button>
                    <button onClick={() => openEditModal(section)}
                      style={{ fontSize: '0.6rem', padding: '0.1rem 0.45rem', borderRadius: '4px', background: 'var(--accent)22', border: '1px solid var(--accent)55', color: 'var(--accent)', cursor: 'pointer', fontWeight: 'bold' }}>
                      ✏ Éditer
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Modal Section ───────────────────────────────────────────────────── */}
      {sectionModal && (() => {
        const sec = sections.find(s => s.id === sectionModal)
        if (!sec) return null
        const sChoices = choices.filter(c => c.section_id === sectionModal)
        return (
          <SectionModal
            section={sec}
            choices={sChoices}
            book={book}
            npcs={npcs}
            sections={sections}
            editContent={editContent}
            editSummary={editSummary}
            editHint={editHint}
            editImages={editImages}
            editMusicUrl={editMusicUrl}
            imageProvider={imageProvider}
            isSaving={sectionSaving === sectionModal}
            editingTransition={editingTransition}
            transitionDraft={transitionDraft}
            generatingTransition={generatingTransition}
            editingReturn={editingReturn}
            returnDraft={returnDraft}
            generatingReturn={generatingReturn}
            setEditContent={setEditContent}
            setEditSummary={setEditSummary}
            setEditHint={setEditHint}
            setEditImages={setEditImages}
            setEditMusicUrl={setEditMusicUrl}
            setImageProvider={setImageProvider}
            setEditingTransition={setEditingTransition}
            setTransitionDraft={setTransitionDraft}
            setGeneratingTransition={setGeneratingTransition}
            setEditingReturn={setEditingReturn}
            setReturnDraft={setReturnDraft}
            setGeneratingReturn={setGeneratingReturn}
            setFreesoundModal={setFreesoundModal}
            setSections={setSections}
            setChoices={setChoices}
            onSave={saveSection}
            scrollToSection={scrollToSection}
            detectCompanionsInText={detectCompanionsInText}
            consultCompanion={consultCompanion}
            consultingCompanion={consultingCompanion}
            bookId={id}
            onOpenSection={async (targetId) => {
              const target = sections.find(s => s.id === targetId)
              if (!target) return

              // Si c'est une section compagnon, synchroniser les labels des choix copiés
              if (target.trial?.type === 'dialogue') {
                // Trouver la section source : celle qui a un choix pointant vers targetId
                const incomingChoice = choices.find(c => c.target_section_id === targetId)
                if (incomingChoice) {
                  const sourceChoices = choices.filter(c => c.section_id === incomingChoice.section_id)
                  const targetChoices = choices.filter(c => c.section_id === targetId)
                  // Pour chaque choix de la section compagnon avec une cible connue,
                  // aligner son label sur celui de la section source (même target_section_id)
                  const updates: { id: string; label: string }[] = []
                  for (const tc of targetChoices) {
                    if (!tc.target_section_id) continue
                    const matching = sourceChoices.find(sc => sc.target_section_id === tc.target_section_id)
                    if (matching && matching.label !== tc.label) {
                      updates.push({ id: tc.id, label: matching.label })
                    }
                  }
                  if (updates.length > 0) {
                    const npcName = target.trial?.npc_id
                      ? (npcs.find(n => n.id === target.trial!.npc_id)?.name ?? 'le compagnon')
                      : 'le compagnon'
                    const srcSection = sections.find(s => s.id === incomingChoice.section_id)
                    const summary = updates.map(u => `• "${u.label}"`).join('\n')
                    const confirmed = confirm(
                      `Mettre à jour les choix de la section compagnon §${target.number} (${npcName}) ` +
                      `pour les aligner sur ceux de §${srcSection?.number ?? '?'} ?\n\n` +
                      `Choix concernés :\n${summary}`
                    )
                    if (confirmed) {
                      await Promise.all(updates.map(u =>
                        fetch(`/api/choices/${u.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: u.label }) })
                      ))
                      setChoices(cs => cs.map(c => {
                        const u = updates.find(x => x.id === c.id)
                        return u ? { ...c, label: u.label } : c
                      }))
                    }
                  }
                }
              }

              setPreviousSectionId(sectionModal)
              setSectionModal(targetId)
              setEditingSection(targetId)
              setEditContent(target.content)
              setEditSummary(target.summary ?? '')
              setEditHint(target.hint_text ?? '')
              setEditMusicUrl(target.music_url ?? '')
              const imgs = target.images ?? []
              setEditImages(Array.from({ length: 4 }, (_, i) => ({ url: imgs[i]?.url, description: imgs[i]?.description ?? '', style: imgs[i]?.style ?? book.illustration_style ?? 'realistic', includeProtagonist: false })))
            }}
            previousSection={previousSectionId ? sections.find(s => s.id === previousSectionId) ?? null : null}
            onGoBack={() => {
              const prev = sections.find(s => s.id === previousSectionId)
              if (!prev) return
              setPreviousSectionId(null)
              setSectionModal(prev.id)
              setEditingSection(prev.id)
              setEditContent(prev.content)
              setEditSummary(prev.summary ?? '')
              setEditHint(prev.hint_text ?? '')
              setEditMusicUrl(prev.music_url ?? '')
              const imgs = prev.images ?? []
              setEditImages(Array.from({ length: 4 }, (_, i) => ({ url: imgs[i]?.url, description: imgs[i]?.description ?? '', style: imgs[i]?.style ?? book.illustration_style ?? 'realistic', includeProtagonist: false })))
            }}
            onClose={() => { setSectionModal(null); setEditingSection(null); setPreviousSectionId(null) }}
            highlightChoiceId={(() => {
              if (!correctionMode) return undefined
              const path = correctionPaths[correctionPathIdx] ?? []
              const nextId = path[correctionStepIdx + 1]
              if (!nextId) return undefined
              return choices.find(c => c.section_id === sectionModal && c.target_section_id === nextId)?.id
            })()}
          />
        )
      })()}

      {/* ── Mode Correction : Overview ──────────────────────────────────────── */}
      {showCorrectionOverview && (
        <div style={{ position: 'fixed', inset: 0, background: '#0008', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', width: '100%', maxWidth: '680px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>🔖 Mode Correction</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', flex: 1 }}>
                {sections.filter(s => s.status === 'validated').length}/{sections.length} sections validées
              </span>
              <button onClick={() => setShowCorrectionOverview(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
            </div>
            {correctionPaths.length === 0 ? (
              <p style={{ padding: '2rem', color: 'var(--muted)', textAlign: 'center', fontSize: '0.85rem' }}>Aucun parcours calculable — vérifiez que §1 existe et a des choix.</p>
            ) : (
              <div style={{ overflowY: 'auto', padding: '0.75rem 1.25rem', flex: 1 }}>
                {(() => {
                  const allValidated = correctionPaths.every(path => path.every(id => sections.find(s => s.id === id)?.status === 'validated'))
                  if (allValidated) return (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#4caf7d' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✓</div>
                      <div style={{ fontWeight: 'bold' }}>Toutes les sections sont validées !</div>
                    </div>
                  )
                  return correctionPaths.map((path, pi) => {
                    const sectionNums = path.map(id => sections.find(s => s.id === id)?.number ?? '?')
                    const unvalidatedCount = path.filter(id => sections.find(s => s.id === id)?.status !== 'validated').length
                    if (unvalidatedCount === 0) return null
                    return (
                      <div key={pi} style={{ marginBottom: '0.6rem', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', background: 'var(--surface-2)' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>Parcours {pi + 1}</span>
                          <span style={{ fontSize: '0.7rem', flex: 1, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sectionNums.map((n, i) => {
                              const id = path[i]
                              const status = sections.find(s => s.id === id)?.status
                              const color = status === 'validated' ? '#4caf7d' : status === 'in_progress' ? '#c9a84c' : 'var(--foreground)'
                              return <span key={i} style={{ color }}>{i > 0 && <span style={{ color: 'var(--muted)' }}> → </span>}§{n}</span>
                            })}
                          </span>
                          <span style={{ fontSize: '0.65rem', color: unvalidatedCount > 0 ? '#c9a84c' : '#4caf7d', flexShrink: 0 }}>{unvalidatedCount} à corriger</span>
                          <button onClick={() => startCorrectionPath(pi)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.65rem', borderRadius: '4px', border: 'none', background: '#4caf7d', color: '#0f0f14', cursor: 'pointer', fontWeight: 'bold', flexShrink: 0 }}>
                            ▶ Commencer
                          </button>
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Mode Correction : Bannière de navigation ─────────────────────────── */}
      {correctionMode && (() => {
        const path = correctionPaths[correctionPathIdx] ?? []
        const currentId = path[correctionStepIdx]
        const prevId = correctionStepIdx > 0 ? path[correctionStepIdx - 1] : null
        const incomingChoice = prevId ? choices.find(c => c.section_id === prevId && c.target_section_id === currentId) : null
        const currentSection = sections.find(s => s.id === currentId)
        const isValidated = currentSection?.status === 'validated'
        return (
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, background: '#1a1a2e', borderTop: '2px solid #4caf7d', padding: '0.4rem 1rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {incomingChoice && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', fontSize: '0.72rem' }}>
                <span style={{ color: 'var(--muted)', flexShrink: 0 }}>Choix pris :</span>
                <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>« {incomingChoice.label} »</span>
                {incomingChoice.transition_text && (
                  <span style={{ color: '#b48edd', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {incomingChoice.transition_text}</span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Breadcrumb */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.2rem', overflow: 'hidden', minWidth: 0 }}>
              {path.map((id, i) => {
                const s = sections.find(sec => sec.id === id)
                const isCurrent = i === correctionStepIdx
                const isDone = s?.status === 'validated'
                const color = isCurrent ? '#4caf7d' : isDone ? '#4caf7d88' : 'var(--muted)'
                return (
                  <span key={id} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                    {i > 0 && <span style={{ color: 'var(--muted)', fontSize: '0.65rem' }}>→</span>}
                    <button onClick={() => { setCorrectionStepIdx(i); openSectionInModal(id) }}
                      style={{ fontSize: isCurrent ? '0.8rem' : '0.7rem', fontWeight: isCurrent ? 'bold' : 'normal', color, background: isCurrent ? '#4caf7d22' : 'transparent', border: isCurrent ? '1px solid #4caf7d55' : 'none', borderRadius: '3px', padding: '0.1rem 0.3rem', cursor: 'pointer' }}>
                      §{s?.number ?? '?'}
                    </button>
                  </span>
                )
              })}
            </div>
            {/* Compteur */}
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)', flexShrink: 0 }}>
              {correctionStepIdx + 1}/{path.length}
            </span>
            {/* Boutons */}
            <button onClick={correctionPrev} disabled={correctionStepIdx === 0} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: correctionStepIdx === 0 ? 'var(--muted)' : 'var(--foreground)', cursor: correctionStepIdx === 0 ? 'default' : 'pointer' }}>← Préc.</button>
            <button onClick={advanceCorrectionStep} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '4px', border: '1px solid #c9a84c55', background: 'transparent', color: '#c9a84c', cursor: 'pointer' }}>Passer →</button>
            <button onClick={correctionValidateAndNext} style={{ fontSize: '0.75rem', padding: '0.3rem 0.85rem', borderRadius: '4px', border: 'none', background: isValidated ? '#4caf7d88' : '#4caf7d', color: '#0f0f14', cursor: 'pointer', fontWeight: 'bold' }}>
              {isValidated ? '✓ Déjà validé → Suivant' : '✓ Valider → Suivant'}
            </button>
            <button onClick={quitCorrectionMode} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '4px', border: '1px solid #c94c4c44', background: 'transparent', color: '#c94c4c', cursor: 'pointer' }}>✕ Quitter</button>
            </div>
          </div>
        )
      })()}

      {/* ── Panneau Narration ────────────────────────────────────────────────── */}
      {narrationPanel && (
        <NarrationPanel
          sectionId={narrationPanel.sectionId}
          content={narrationPanel.content}
          onApply={(sectionId, newContent) => {
            setSections(ss => ss.map(s => s.id === sectionId ? { ...s, content: newContent } : s))
            fetch(`/api/sections/${sectionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: newContent }) })
            setNarrationPanel(null)
          }}
          onClose={() => setNarrationPanel(null)}
        />
      )}

      {/* ── Modal Couverture ────────────────────────────────────────────────── */}
      {showCoverModal && (
        <CoverModal
          book={book}
          description={coverDescription}
          style={coverStyle}
          includeProtagonist={coverIncludeProtagonist}
          provider={imageProvider}
          onDescriptionChange={setCoverDescription}
          onStyleChange={setCoverStyle}
          onIncludeProtagonistChange={setCoverIncludeProtagonist}
          onSaved={url => {
            setBook(b => b ? { ...b, cover_image_url: url } : b)
            fetch(`/api/books/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cover_image_url: url }) })
          }}
          onClose={() => setShowCoverModal(false)}
        />
      )}

      {/* ── Visionneur Intro ─────────────────────────────────────────────────── */}
      {introViewer && introFrames.length > 0 && (
        <IntroViewer
          frames={introFrames}
          audioUrl={introAudioUrl || undefined}
          onClose={() => setIntroViewer(false)}
        />
      )}

      {/* ── Modal Freesound ─────────────────────────────────────────────────── */}
      {freesoundModal && (
        <FreesoundModal
          sectionType={freesoundModal.sectionType}
          onSelect={url => {
            if (freesoundModal.onSelect) freesoundModal.onSelect(url)
            else setEditMusicUrl(url)
            setFreesoundModal(null)
          }}
          onClose={() => setFreesoundModal(null)}
        />
      )}

      {/* ── Onglet Plan ─────────────────────────────────────────────────────── */}
      {tab === 'plan' && <GraphView sections={sections} choices={choices} activeFilters={activeFilters} highlightNumber={planHighlight} onHighlightDone={() => setPlanHighlight(null)} onNavigate={(n) => { setTab('sections'); scrollToSection(n) }} />}

      {/* ── Onglet Intro — Ordre & timing ────────────────────────────────────── */}
      {tab === 'intro_order' && (
        <IntroOrderTab
          bookId={id}
          initialOrder={book.intro_order ?? null}
          onSaved={(order) => setBook(b => b ? { ...b, intro_order: order } : b)}
          onNavigate={setTab}
          protagonistName={npcs.find(n => n.id === book.protagonist_npc_id)?.name ?? ''}
          introFrames={introFrames}
          introAudioUrl={introAudioUrl}
          protagonist={npcs.find(n => n.id === book.protagonist_npc_id) ?? null}
        />
      )}

      {/* ── Onglet Intro FBI ─────────────────────────────────────────────────── */}
      {tab === 'fbi' && (
        <FBIAnimTab protagonistName={npcs.find(n => n.id === book.protagonist_npc_id)?.name ?? ''} />
      )}

      {/* ── Onglet Fiche personnage ──────────────────────────────────────────── */}
      {tab === 'fiche' && (
        <FichePersonnageTab
          bookId={id}
          protagonistNpcId={book.protagonist_npc_id ?? null}
          npcs={npcs}
          setNpcs={setNpcs}
          imageProvider={imageProvider}
          bookTheme={book.theme}
          bookIllustrationStyle={book.illustration_style ?? 'realistic'}
          illustrationBible={book.illustration_bible ?? ''}
          onGoToNpcs={() => setTab('npcs')}
        />
      )}

      {/* ── Onglet Préférences joueur ───────────────────────────────────────── */}
      {tab === 'player_settings' && (
        <PlayerSettingsTab
          bookId={id}
          introOrder={book.intro_order ?? null}
          onSaved={(order) => setBook(b => b ? { ...b, intro_order: order } : b)}
        />
      )}

      {/* ── Onglet Écran Section ─────────────────────────────────────────────── */}
      {tab === 'section_layout' && (
        <SectionLayoutTab
          bookId={id}
          sectionLayout={book.section_layout ?? null}
          protagonist={npcs.find(n => n.id === book.protagonist_npc_id) ?? null}
          npcs={npcs}
          sections={sections}
          introOrder={book.intro_order ?? null}
          onSaved={(layout) => setBook(b => b ? { ...b, section_layout: layout } : b)}
        />
      )}

      {/* ── Onglet Dialogue Manga ───────────────────────────────────────────── */}
      {tab === 'dialogue' && (
        <MangaDialogTab
          bookId={id}
          npcs={npcs}
          protagonist={npcs.find(n => n.id === book.protagonist_npc_id) ?? null}
          sectionLayout={book.section_layout ?? null}
          onSaved={layout => setBook(b => b ? { ...b, section_layout: layout } : b)}
        />
      )}

      {tab === 'game_sim' && (
        <GameSimTab
          bookId={id}
          sections={sections}
          choices={choices}
          npcs={npcs}
          protagonist={npcs.find(n => n.id === book.protagonist_npc_id) ?? null}
          sectionLayout={book.section_layout ?? null}
          introOrder={book.intro_order ?? null}
          onNavigate={setTab}
          book={book}
        />
      )}

      {/* ── Onglet PNJ ──────────────────────────────────────────────────────── */}
      {tab === 'npcs' && (
        <NpcTab bookId={id} bookTheme={book.theme} bookIllustrationStyle={book.illustration_style ?? 'realistic'} illustrationBible={book.illustration_bible ?? ''} imageProvider={imageProvider} npcs={npcs} setNpcs={setNpcs} sections={sections} onNavigate={(n) => { setTab('sections'); scrollToSection(n) }} protagonistNpcId={book.protagonist_npc_id ?? null} onSetProtagonist={async (npcId) => { await fetch(`/api/books/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protagonist_npc_id: npcId }) }); setBook(b => b ? { ...b, protagonist_npc_id: npcId } : b) }} voices={convVoices} voicesLoaded={convVoicesLoaded} />
      )}

      {/* ── Onglet Carte ─────────────────────────────────────────────────────── */}
      {tab === 'carte' && (
        <MapView
          bookId={id}
          locations={locations}
          setLocations={setLocations}
          sections={sections}
          choices={choices}
          mapStyle={book?.map_style ?? 'city'}
          mapVisibility={book?.map_visibility ?? 'full'}
          mapSvg={book?.map_svg}
          onSvgGenerated={(svg) => setBook(b => b ? { ...b, map_svg: svg } : b)}
          onNavigate={(n) => { setTab('sections'); scrollToSection(n) }}
        />
      )}

      {/* ── Onglet Cohérence ─────────────────────────────────────────────────── */}
      {/* ── Onglet Objets ───────────────────────────────────────────────────── */}
      {tab === 'objets' && (() => {
        // Chargement paresseux
        if (!itemsLoaded) {
          fetch(`/api/books/${id}/items`).then(r => r.json()).then(d => { setItems(d.items ?? []); setItemsLoaded(true) })
          return <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Chargement…</p>
        }
        const ITEM_TYPE_LABELS: Record<string, string> = { soin: '❤️ Soin', mana: '💧 Mana', arme: '⚔️ Arme', armure: '🛡 Armure', outil: '🔧 Outil', quete: '📜 Quête', grimoire: '📖 Grimoire' }
        async function saveItem() {
          setItemSaving(true)
          if (editingItem === 'new') {
            const res = await fetch(`/api/books/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(itemForm) })
            const d = await res.json()
            if (d.item) setItems(prev => [...prev, d.item])
          } else if (editingItem) {
            await fetch(`/api/items/${editingItem}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(itemForm) })
            setItems(prev => prev.map(it => it.id === editingItem ? { ...it, ...itemForm } as any : it))
          }
          setEditingItem(null); setItemForm({}); setItemSaving(false)
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={async () => {
                  if (!confirm('Générer les objets depuis le synopsis ? Les objets existants seront conservés.')) return
                  const res = await fetch(`/api/books/${id}/generate-items`, { method: 'POST' })
                  const d = await res.json()
                  if (!res.ok) return alert(`Erreur : ${d.error}`)
                  const r = await fetch(`/api/books/${id}/items`)
                  const rd = await r.json()
                  setItems(rd.items ?? [])
                  alert(`${d.items_count} objet(s) générés depuis le synopsis.`)
                }}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', cursor: 'pointer' }}
              >
                ✨ Générer depuis le synopsis
              </button>
              <button onClick={() => { setEditingItem('new'); setItemForm({ item_type: 'outil', sections_used: [], effect: {} }) }} style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#0f0f14', cursor: 'pointer', fontWeight: 'bold' }}>
                + Nouvel objet
              </button>
            </div>
            {items.length === 0 && !editingItem && (
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>Aucun objet — cliquez sur "+ Nouvel objet" ou "✨ Générer depuis le synopsis".</p>
            )}
            {/* Formulaire édition */}
            {editingItem && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--accent)', borderRadius: '8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: 'var(--accent)' }}>{editingItem === 'new' ? '+ Nouvel objet' : 'Modifier l\'objet'}</div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input value={itemForm.name ?? ''} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} placeholder="Nom *" style={{ flex: 2, minWidth: '160px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.35rem 0.5rem', color: 'var(--foreground)', fontSize: '0.82rem', outline: 'none' }} />
                  <select value={itemForm.item_type ?? 'outil'} onChange={e => setItemForm(f => ({ ...f, item_type: e.target.value as any }))} style={{ flex: 1, minWidth: '120px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.35rem 0.5rem', color: 'var(--foreground)', fontSize: '0.82rem', outline: 'none', cursor: 'pointer' }}>
                    {Object.entries(ITEM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <textarea value={itemForm.description ?? ''} onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))} placeholder="Description de l'objet…" rows={3} style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.35rem 0.5rem', color: 'var(--foreground)', fontSize: '0.82rem', resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Section où on le trouve</div>
                    <select value={itemForm.section_found_id ?? ''} onChange={e => setItemForm(f => ({ ...f, section_found_id: e.target.value || undefined }))} style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.35rem 0.5rem', color: 'var(--foreground)', fontSize: '0.78rem', outline: 'none', cursor: 'pointer' }}>
                      <option value="">— Aucune —</option>
                      {sections.sort((a, b) => a.number - b.number).map(s => <option key={s.id} value={s.id}>§{s.number}{s.summary ? ` — ${s.summary.slice(0, 50)}` : ''}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Sections où il est utilisé</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.3rem', minHeight: '2rem', maxHeight: '80px', overflowY: 'auto' }}>
                      {sections.sort((a, b) => a.number - b.number).map(s => {
                        const used = (itemForm.sections_used ?? []).includes(s.id)
                        return <button key={s.id} onClick={() => setItemForm(f => ({ ...f, sections_used: used ? (f.sections_used ?? []).filter(x => x !== s.id) : [...(f.sections_used ?? []), s.id] }))} style={{ fontSize: '0.62rem', padding: '0.1rem 0.3rem', borderRadius: '3px', border: `1px solid ${used ? 'var(--accent)' : 'var(--border)'}`, background: used ? 'var(--accent)' : 'transparent', color: used ? '#0f0f14' : 'var(--muted)', cursor: 'pointer' }}>§{s.number}</button>
                      })}
                    </div>
                  </div>
                </div>
                {itemForm.illustration_url && <img src={itemForm.illustration_url} alt="" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border)' }} />}
                <input value={itemForm.illustration_url ?? ''} onChange={e => setItemForm(f => ({ ...f, illustration_url: e.target.value || undefined }))} placeholder="URL de l'illustration (optionnel)…" style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.35rem 0.5rem', color: 'var(--foreground)', fontSize: '0.78rem', outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={() => { setEditingItem(null); setItemForm({}) }} style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Annuler</button>
                  <button onClick={saveItem} disabled={!itemForm.name || itemSaving} style={{ fontSize: '0.78rem', padding: '0.3rem 0.85rem', borderRadius: '4px', border: 'none', background: 'var(--accent)', color: '#0f0f14', cursor: 'pointer', fontWeight: 'bold', opacity: !itemForm.name || itemSaving ? 0.6 : 1 }}>
                    {itemSaving ? 'Sauvegarde…' : '💾 Sauvegarder'}
                  </button>
                </div>
              </div>
            )}
            {/* Liste des objets */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
              {items.map(item => {
                const foundSection = item.section_found_id ? sections.find(s => s.id === item.section_found_id) : null
                const usedSections = (item.sections_used ?? []).map(sid => sections.find(s => s.id === sid)?.number).filter(Boolean).sort((a, b) => (a as number) - (b as number))
                return (
                  <div key={item.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', padding: '0.65rem 0.85rem', alignItems: 'flex-start' }}>
                      {item.illustration_url && <img src={item.illustration_url} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                          <span style={{ fontWeight: 'bold', fontSize: '0.85rem', color: 'var(--foreground)' }}>{item.name}</span>
                          <span style={{ fontSize: '0.65rem', color: 'var(--muted)', background: 'var(--surface)', padding: '0.1rem 0.35rem', borderRadius: '3px', border: '1px solid var(--border)', flexShrink: 0 }}>{ITEM_TYPE_LABELS[item.item_type] ?? item.item_type}</span>
                        </div>
                        {item.description && <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: 0, lineHeight: 1.4 }}>{item.description}</p>}
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.35rem', fontSize: '0.65rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
                          {foundSection && <span>📍 Trouvé §{foundSection.number}</span>}
                          {usedSections.length > 0 && <span>🔗 Utilisé §{usedSections.join(', §')}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', padding: '0.4rem 0.85rem', borderTop: '1px solid var(--border)', background: 'var(--surface)', justifyContent: 'flex-end' }}>
                      <button onClick={() => { setEditingItem(item.id); setItemForm({ ...item }) }} style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>✎ Modifier</button>
                      <button onClick={async () => { if (!confirm(`Supprimer "${item.name}" ?`)) return; await fetch(`/api/items/${item.id}`, { method: 'DELETE' }); setItems(prev => prev.filter(it => it.id !== item.id)) }} style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #c94c4c44', background: 'transparent', color: '#c94c4c', cursor: 'pointer' }}>✕ Supprimer</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {tab === 'coherence' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              onClick={analyzeCoherence}
              disabled={coherenceLoading}
              style={{ padding: '0.5rem 1.2rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: coherenceLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '0.875rem', opacity: coherenceLoading ? 0.7 : 1 }}
            >
              {coherenceLoading ? '⏳ Analyse…' : '🔍 Analyser la cohérence'}
            </button>
            {coherenceIssues && coherenceIssues.some(i => i.type === 'combat_no_enemy' && !coherenceFixed.has(i.id)) && (
              <button
                onClick={fixCombatEnemies}
                disabled={combatFixLoading}
                title="Utilise Claude pour assigner automatiquement un PNJ ennemi à chaque section de combat sans ennemi"
                style={{ padding: '0.5rem 1.2rem', background: '#e05c4b22', border: '1px solid #e05c4b66', borderRadius: '6px', cursor: combatFixLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '0.875rem', color: '#e05c4b', opacity: combatFixLoading ? 0.7 : 1 }}
              >
                {combatFixLoading ? '⏳ Assignation…' : `⚔️ Auto-assigner les ennemis (${coherenceIssues.filter(i => i.type === 'combat_no_enemy' && !coherenceFixed.has(i.id)).length})`}
              </button>
            )}
            {combatFixResult && (
              <span style={{ fontSize: '0.8rem', color: combatFixResult.assigned > 0 ? '#4caf7d' : 'var(--muted)' }}>
                {combatFixResult.assigned}/{combatFixResult.total} ennemis assignés
                {combatFixResult.errors?.length > 0 && <span style={{ color: '#f0a742' }}> — {combatFixResult.errors.length} erreur(s)</span>}
              </span>
            )}
            {coherenceIssues && coherenceIssues.some(i => i.type === 'self_loop' && !coherenceFixed.has(i.id)) && (
              <button
                onClick={fixSelfLoops}
                disabled={loopFixLoading}
                title="Utilise Claude pour rediriger automatiquement les choix en boucle vers la section narrative la plus cohérente"
                style={{ padding: '0.5rem 1.2rem', background: '#e05c4b22', border: '1px solid #e05c4b66', borderRadius: '6px', cursor: loopFixLoading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '0.875rem', color: '#e05c4b', opacity: loopFixLoading ? 0.7 : 1 }}
              >
                {loopFixLoading ? '⏳ Correction…' : `🔄 Auto-corriger les boucles (${coherenceIssues.filter(i => i.type === 'self_loop' && !coherenceFixed.has(i.id)).length})`}
              </button>
            )}
            {loopFixResult && (
              <span style={{ fontSize: '0.8rem', color: loopFixResult.fixed > 0 ? '#4caf7d' : 'var(--muted)' }}>
                {loopFixResult.fixed}/{loopFixResult.total} boucles corrigées
                {loopFixResult.errors?.length > 0 && <span style={{ color: '#f0a742' }}> — {loopFixResult.errors.length} erreur(s)</span>}
              </span>
            )}

            {/* Agent correcteur */}
            <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <button
                  onClick={runAgentRepair}
                  disabled={agentRunning}
                  style={{ padding: '0.5rem 1.2rem', background: agentRunning ? 'var(--surface)' : '#b48edd22', border: `1px solid ${agentRunning ? 'var(--border)' : '#b48edd66'}`, borderRadius: '6px', cursor: agentRunning ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '0.875rem', color: '#b48edd', opacity: agentRunning ? 0.7 : 1 }}
                >
                  {agentRunning ? '🤖 Agent en cours…' : '🤖 Agent correcteur (analyse narrative complète)'}
                </button>
                {agentDone && !agentRunning && (
                  <button onClick={() => setAgentLog([])} style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer' }}>
                    Effacer le log
                  </button>
                )}
              </div>

              {agentLog.length > 0 && (
                <div style={{ marginTop: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem', maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {agentLog.map((entry, i) => {
                    if (entry.type === 'start') return <div key={i} style={{ color: '#b48edd', fontWeight: 'bold' }}>▶ {entry.message}</div>
                    if (entry.type === 'thinking') return <div key={i} style={{ color: 'var(--muted)', fontStyle: 'italic', whiteSpace: 'pre-wrap', borderLeft: '2px solid var(--border)', paddingLeft: '0.5rem' }}>{entry.message}</div>
                    if (entry.type === 'tool_call') {
                      const inputStr = entry.input ? Object.entries(entry.input).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ') : ''
                      return <div key={i} style={{ color: 'var(--accent)' }}>⚙ {entry.name}({inputStr})</div>
                    }
                    if (entry.type === 'tool_result') {
                      const msg = (entry.result as any)?.message ?? JSON.stringify(entry.result).slice(0, 100)
                      return <div key={i} style={{ color: '#4caf7d' }}>✓ {msg}</div>
                    }
                    if (entry.type === 'tool_error') return <div key={i} style={{ color: '#e05c4b' }}>✗ {entry.name}: {entry.error}</div>
                    if (entry.type === 'done') return (
                      <div key={i} style={{ color: '#4caf7d', fontWeight: 'bold', borderTop: '1px solid var(--border)', paddingTop: '0.35rem', marginTop: '0.2rem', whiteSpace: 'pre-wrap' }}>
                        ✅ Terminé — {entry.corrections != null && entry.corrections >= 0 ? `${entry.corrections} corrections` : ''}{'\n'}{entry.summary ?? entry.message ?? ''}{entry.remaining && entry.remaining !== 'Aucun' ? `\n⚠ Restant : ${entry.remaining}` : ''}
                      </div>
                    )
                    if (entry.type === 'error') return <div key={i} style={{ color: '#e05c4b', fontWeight: 'bold' }}>💥 Erreur: {entry.message}</div>
                    return null
                  })}
                  {agentRunning && <div style={{ color: '#b48edd' }}>⏳ En attente…</div>}
                </div>
              )}
            </div>

            {coherenceIssues && (
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                {coherenceIssues.length} problème{coherenceIssues.length > 1 ? 's' : ''} détecté{coherenceIssues.length > 1 ? 's' : ''} —{' '}
                <span style={{ color: '#e05c4b' }}>{coherenceIssues.filter(i => i.severity === 'critical').length} critique{coherenceIssues.filter(i => i.severity === 'critical').length > 1 ? 's' : ''}</span>,{' '}
                <span style={{ color: '#f0a742' }}>{coherenceIssues.filter(i => i.severity === 'important').length} important{coherenceIssues.filter(i => i.severity === 'important').length > 1 ? 's' : ''}</span>,{' '}
                <span style={{ color: '#6b8cde' }}>{coherenceIssues.filter(i => i.severity === 'narrative').length} narratif{coherenceIssues.filter(i => i.severity === 'narrative').length > 1 ? 's' : ''}</span>
                {coherenceFixed.size > 0 && <span style={{ color: '#4caf7d' }}> — {coherenceFixed.size} corrigé{coherenceFixed.size > 1 ? 's' : ''}</span>}
              </span>
            )}
          </div>

          {coherenceIssues && coherenceIssues.length === 0 && (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#4caf7d', fontSize: '1.1rem' }}>
              ✅ Aucun problème détecté — la structure est cohérente.
            </div>
          )}

          {coherenceIssues && coherenceIssues.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {coherenceIssues.map(issue => {
                const isFixed = coherenceFixed.has(issue.id)
                const isFixing = coherenceFixing.has(issue.id)
                const err = coherenceError[issue.id]
                const inputs = coherenceInputs[issue.id] ?? {}
                const severityColor = issue.severity === 'critical' ? '#e05c4b' : issue.severity === 'important' ? '#f0a742' : '#6b8cde'
                const severityLabel = issue.severity === 'critical' ? '🔴 Critique' : issue.severity === 'important' ? '🟠 Important' : '🔵 Narratif'

                return (
                  <div key={issue.id} style={{
                    border: `1px solid ${isFixed ? '#4caf7d44' : severityColor + '44'}`,
                    borderRadius: '8px',
                    padding: '0.75rem 1rem',
                    background: isFixed ? '#4caf7d08' : severityColor + '08',
                    opacity: isFixed ? 0.7 : 1,
                    transition: 'opacity 0.3s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: severityColor, background: severityColor + '22', padding: '0.1rem 0.4rem', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                            {severityLabel}
                          </span>
                          {isFixed && <span style={{ fontSize: '0.7rem', color: '#4caf7d', fontWeight: 'bold' }}>✅ Corrigé</span>}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text)' }}>{issue.description}</div>
                        {issue.sections.length > 0 && (
                          <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                            {issue.sections.map(n => (
                              <button
                                key={n}
                                onClick={() => { setTab('sections'); scrollToSection(n) }}
                                style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'var(--accent)22', border: '1px solid var(--accent)44', color: 'var(--accent)', cursor: 'pointer' }}
                              >
                                §{n}
                              </button>
                            ))}
                          </div>
                        )}
                        {err && <div style={{ marginTop: '0.3rem', fontSize: '0.75rem', color: '#e05c4b' }}>⚠ {err}</div>}
                      </div>

                      {!isFixed && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end', flexShrink: 0 }}>
                          {/* Autofix button */}
                          {issue.autofix && (
                            <button
                              onClick={() => applyCoherenceFix(issue)}
                              disabled={isFixing}
                              style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem', background: '#4caf7d22', border: '1px solid #4caf7d66', borderRadius: '4px', color: '#4caf7d', cursor: isFixing ? 'wait' : 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                            >
                              {isFixing ? '⏳…' : `✓ ${issue.autofix.label}`}
                            </button>
                          )}

                          {/* Manual fix form */}
                          {issue.manual && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-end' }}>
                              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {issue.manual.fields.map(field => (
                                  <input
                                    key={field.key}
                                    placeholder={field.placeholder}
                                    value={inputs[field.key] ?? ''}
                                    onChange={e => setCoherenceInputs(prev => ({
                                      ...prev,
                                      [issue.id]: { ...prev[issue.id], [field.key]: e.target.value }
                                    }))}
                                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text)', width: '120px' }}
                                    title={field.label}
                                  />
                                ))}
                              </div>
                              <button
                                onClick={() => {
                                  const allFilled = issue.manual!.fields.every(f => inputs[f.key]?.trim())
                                  if (!allFilled) return
                                  applyCoherenceFix(issue, inputs)
                                }}
                                disabled={isFixing || !issue.manual.fields.every(f => inputs[f.key]?.trim())}
                                style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem', background: 'var(--accent)22', border: '1px solid var(--accent)66', borderRadius: '4px', color: 'var(--accent)', cursor: isFixing ? 'wait' : 'pointer', whiteSpace: 'nowrap', opacity: issue.manual.fields.every(f => inputs[f.key]?.trim()) ? 1 : 0.5 }}
                              >
                                {isFixing ? '⏳…' : '→ Appliquer'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Intro Cinématique ────────────────────────────────────────────── */}
      {tab === 'intro' && (() => {
        const DURATION_LABELS: Record<string, string> = { flash: '⚡ Flash (0.5s)', court: '▸ Court (1s)', normal: '▶ Normal (2.5s)', long: '⏸ Long (4s)', pause: '⏹ Pause (6s)' }
        const FRAMING_LABELS: Record<string, string> = { plan_large: '🌅 Plan large', plan_moyen: '🧍 Plan moyen', gros_plan: '🔍 Gros plan', detail: '🔎 Détail' }
        const TRANSITION_LABELS: Record<string, string> = { cut: '✂ Cut', fondu: '〰 Fondu', fondu_noir: '⬛ Fondu noir' }

        async function generateSequence() {
          setSeqGenerating(true)
          try {
            const res = await fetch(`/api/books/${id}/generate-intro-sequence`, { method: 'POST' })
            const d = await res.json()
            if (!res.ok) throw new Error(d.error ?? `Erreur ${res.status}`)
            if (d.frames) setIntroFrames(d.frames)
          } catch (err: any) {
            alert(`Erreur génération séquence : ${err.message}`)
          } finally { setSeqGenerating(false) }
        }

        async function translateFrame(frameId: string, promptFr: string) {
          setSeqTranslating(frameId)
          try {
            const res = await fetch(`/api/books/${id}/translate-intro-prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: promptFr }) })
            const d = await res.json()
            if (d.translated) setIntroFrames(fs => fs.map(f => f.id === frameId ? { ...f, prompt_en: d.translated } : f))
          } finally { setSeqTranslating(null) }
        }

        async function generateIntroMusic() {
          if (!introMusicPrompt.trim()) return
          setIntroGeneratingMusic(true)
          try {
            const res = await fetch('/api/generate-music', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: introMusicPrompt.trim(), duration: 30, path: `books/${id}/intro/music` }),
            })
            const data = await res.json()
            if (data.url) {
              const url = data.url
              setIntroAudioUrl(url)
              setIntroAudioBuster(b => b + 1)
              await fetch(`/api/books/${id}/save-intro-sequence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames: introFrames, audio_url: url }) })
            } else {
              alert('Erreur génération : ' + (data.error ?? 'inconnu'))
            }
          } finally { setIntroGeneratingMusic(false) }
        }

        async function saveSequence(frames: import('@/types').IntroFrame[]) {
          setSeqSaving(true)
          try {
            await fetch(`/api/books/${id}/save-intro-sequence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames }) })
          } finally { setSeqSaving(false) }
        }

        // Helper : génère + poll + upload Supabase → retourne URL persistante
        async function generateOneFrameImage(frame: import('@/types').IntroFrame): Promise<string | null> {
          // Récupérer l'image de référence si img2img
          const refFrame = frame.ref_frame_id ? introFrames.find(f => f.id === frame.ref_frame_id) : null
          const input_image_url = refFrame?.image_url ?? undefined

          const body: any = { type: 'intro', provider: imageProvider, data: { prompt_en: frame.prompt_en, prompt_fr: frame.prompt_fr, style: book?.illustration_style ?? 'realistic', illustration_bible: book?.illustration_bible ?? '' } }
          if (input_image_url) body.input_image_url = input_image_url

          const res = await fetch('/api/generate-image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const d = await res.json()
          if (!res.ok) throw new Error(d.error ?? 'Erreur génération')

          let rawUrl: string | null = null

          // Résultat immédiat
          if (d.image_url) {
            rawUrl = d.image_url
          } else if (d.prediction_id) {
            // Polling
            const start = Date.now()
            while (Date.now() - start < 300_000) {
              await new Promise(r => setTimeout(r, 3000))
              const poll = await fetch(`/api/generate-image?id=${d.prediction_id}&provider=${d.provider ?? imageProvider}`)
              const pd = await poll.json()
              if (pd.status === 'succeeded') { rawUrl = pd.image_url; break }
              if (pd.status === 'failed' || pd.status === 'canceled') throw new Error(pd.error ?? pd.status)
            }
          }

          if (!rawUrl) return null

          // Upload vers Supabase pour URL persistante
          const upload = await fetch('/api/upload-image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: rawUrl, path: `books/${id}/intro/${frame.id}` }),
          })
          const ud = await upload.json()
          return ud.url ?? null
        }

        async function generateFrameImage(frameId: string) {
          const frame = introFrames.find(f => f.id === frameId)
          if (!frame?.prompt_en) return alert('Traduisez le prompt en anglais d\'abord')
          setSeqImgGenerating(frameId)
          try {
            const url = await generateOneFrameImage(frame)
            if (url) {
              const updated = introFrames.map(f => f.id === frameId ? { ...f, image_url: url } : f)
              setIntroFrames(updated)
              setFrameImageVersions(v => ({ ...v, [frameId]: Date.now() }))
              await saveSequence(updated)
            }
          } finally { setSeqImgGenerating(null) }
        }

        async function generateFrameVideo(frameId: string) {
          const frame = introFrames.find(f => f.id === frameId)
          if (!frame?.prompt_en) return alert('Traduisez le prompt en anglais d\'abord')
          setFrameVideoGenerating(v => ({ ...v, [frameId]: true }))
          try {
            // 1. Démarrer la génération Veo
            const startRes = await fetch('/api/generate-video', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: frame.prompt_en, duration: 5 }),
            })
            const startData = await startRes.json()
            if (!startRes.ok) throw new Error(startData.error ?? 'Erreur démarrage Veo')

            const operationName = startData.operation_name
            const storagePath = `books/${id}/intro/${frameId}/video`

            // 2. Polling toutes les 5s (max 3 min)
            let video_url: string | null = null
            const deadline = Date.now() + 180_000
            while (Date.now() < deadline) {
              await new Promise(r => setTimeout(r, 5000))
              const pollRes = await fetch(`/api/generate-video?op=${encodeURIComponent(operationName)}&path=${encodeURIComponent(storagePath)}`)
              const pollData = await pollRes.json()
              if (pollData.status === 'succeeded' && pollData.video_url) {
                video_url = pollData.video_url
                break
              }
              if (pollData.status === 'failed') throw new Error(pollData.error ?? 'Génération vidéo échouée')
            }

            if (video_url) {
              const updated = introFrames.map(f => f.id === frameId ? { ...f, video_url } : f)
              setIntroFrames(updated)
              await saveSequence(updated)
            }
          } catch (err: any) {
            alert(`Erreur vidéo : ${err.message}`)
          } finally {
            setFrameVideoGenerating(v => ({ ...v, [frameId]: false }))
          }
        }

        async function generateAllImages() {
          const toGenerate = introFrames.filter(f => f.prompt_en.trim())
          if (toGenerate.length === 0) return alert('Aucun prompt anglais — cliquez sur "Traduire → EN" pour chaque frame d\'abord.')
          setSeqAllGenerating(true)
          setSeqAllProgress({ done: 0, total: toGenerate.length })
          setSeqAllErrors([])
          let current = [...introFrames]
          for (let i = 0; i < toGenerate.length; i++) {
            const frame = toGenerate[i]
            try {
              // Délai entre requêtes pour éviter le rate-limiting Replicate (6 req/min, burst=1)
              if (i > 0 && imageProvider === 'replicate') {
                const DELAY_MS = 12000
                const step = 500
                let remaining = DELAY_MS
                while (remaining > 0) {
                  setSeqAllProgress(p => p ? { ...p, waitSec: Math.ceil(remaining / 1000) } : null)
                  await new Promise(r => setTimeout(r, step))
                  remaining -= step
                }
                setSeqAllProgress(p => p ? { ...p, waitSec: undefined } : null)
              }
              const url = await generateOneFrameImage(frame)
              if (url) {
                current = current.map(f => f.id === frame.id ? { ...f, image_url: url } : f)
                setIntroFrames([...current])
                setFrameImageVersions(v => ({ ...v, [frame.id]: Date.now() }))
                setSeqAllProgress(p => p ? { ...p, done: p.done + 1 } : null)
                await fetch(`/api/books/${id}/save-intro-sequence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames: current }) })
              } else {
                setSeqAllErrors(e => [...e, `Frame ${frame.order} : aucune image retournée`])
              }
            } catch (err: any) {
              console.error(`[generateAll] frame ${frame.order}:`, err)
              setSeqAllErrors(e => [...e, `Frame ${frame.order} : ${err?.message ?? String(err)}`])
            }
          }
          setSeqAllGenerating(false)
          setSeqAllProgress(null)
        }

        function updateFrame(frameId: string, patch: Partial<import('@/types').IntroFrame>) {
          setIntroFrames(fs => fs.map(f => f.id === frameId ? { ...f, ...patch } : f))
        }

        function deleteFrame(frameId: string) {
          setIntroFrames(fs => fs.filter(f => f.id !== frameId).map((f, i) => ({ ...f, order: i + 1 })))
        }

        function addFrame() {
          const newFrame: import('@/types').IntroFrame = {
            id: Math.random().toString(36).slice(2),
            order: introFrames.length + 1,
            framing: 'plan_large',
            prompt_fr: '',
            prompt_en: '',
            duration: 'normal',
            transition: 'cut',
          }
          setIntroFrames(fs => [...fs, newFrame])
        }

        const inputSt: React.CSSProperties = { width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '5px', padding: '0.4rem 0.6rem', color: 'var(--foreground)', fontSize: '0.8rem', resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
        const selectSt: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '5px', padding: '0.3rem 0.5rem', color: 'var(--foreground)', fontSize: '0.75rem', cursor: 'pointer', outline: 'none' }
        const labelSt: React.CSSProperties = { fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 'bold', marginBottom: '0.2rem' }

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button onClick={generateSequence} disabled={seqGenerating} style={{ padding: '0.45rem 1.1rem', background: seqGenerating ? 'var(--surface-2)' : 'var(--accent)', color: seqGenerating ? 'var(--muted)' : '#0f0f14', border: 'none', borderRadius: '7px', cursor: seqGenerating ? 'default' : 'pointer', fontWeight: 'bold', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {seqGenerating ? '⏳ Génération…' : '🎬 Générer la séquence'}
              </button>
              {introFrames.length > 0 && (
                <>
                  <button onClick={addFrame} style={{ padding: '0.4rem 0.85rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--foreground)', cursor: 'pointer', fontSize: '0.78rem' }}>
                    + Ajouter un plan
                  </button>
                  <button
                    onClick={generateAllImages}
                    disabled={seqAllGenerating || seqGenerating}
                    style={{ padding: '0.4rem 0.85rem', background: seqAllGenerating ? 'var(--surface-2)' : '#2a2a3a', border: '1px solid var(--border)', borderRadius: '7px', color: seqAllGenerating ? 'var(--muted)' : 'var(--foreground)', cursor: (seqAllGenerating || seqGenerating) ? 'default' : 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    {seqAllGenerating && seqAllProgress
                      ? seqAllProgress.waitSec
                        ? `⏳ ${seqAllProgress.done}/${seqAllProgress.total} — attente ${seqAllProgress.waitSec}s…`
                        : `⏳ ${seqAllProgress.done}/${seqAllProgress.total} images…`
                      : `🖼 Générer toutes (${imageProvider === 'replicate' ? '⚡' : '🎨'})`}
                  </button>
                  {introFrames.some(f => f.image_url) && (
                    <button
                      onClick={() => setIntroViewer(true)}
                      style={{ padding: '0.4rem 0.85rem', background: 'var(--accent)', border: 'none', borderRadius: '7px', color: '#0f0f14', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      ▶ Visionner
                    </button>
                  )}
                  <button onClick={() => saveSequence(introFrames)} disabled={seqSaving} style={{ padding: '0.4rem 0.85rem', background: 'transparent', border: '1px solid var(--success)55', borderRadius: '7px', color: 'var(--success)', cursor: seqSaving ? 'default' : 'pointer', fontSize: '0.78rem' }}>
                    {seqSaving ? '⏳ Sauvegarde…' : '💾 Sauvegarder'}
                  </button>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)', marginLeft: 'auto' }}>
                    {introFrames.length} plans — ≈ {Math.round(introFrames.reduce((acc, f) => acc + ({ flash: 0.5, court: 1, normal: 2.5, long: 4, pause: 6 }[f.duration] ?? 2.5), 0))}s
                  </span>
                </>
              )}
            </div>

            {/* Erreurs génération */}
            {seqAllErrors.length > 0 && (
              <div style={{ background: 'var(--danger)11', border: '1px solid var(--danger)44', borderRadius: '7px', padding: '0.6rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 'bold', color: 'var(--danger)', marginBottom: '0.1rem' }}>Erreurs de génération :</div>
                {seqAllErrors.map((e, i) => (
                  <div key={i} style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>{e}</div>
                ))}
              </div>
            )}

            {/* ── Bande audio ──────────────────────────────────────────────── */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 'bold' }}>Bande audio</div>
              {/* URL manuelle + Freesound + Sauvegarder */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  value={introAudioUrl}
                  onChange={e => setIntroAudioUrl(e.target.value)}
                  placeholder="URL du fichier audio…"
                  style={{ flex: 1, minWidth: '220px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '5px', padding: '0.35rem 0.6rem', color: 'var(--foreground)', fontSize: '0.8rem', outline: 'none' }}
                />
                <button
                  onClick={() => setFreesoundModal({ sectionType: 'cinematic intro dramatic', onSelect: async (url) => {
                    setIntroAudioUrl(url)
                    await fetch(`/api/books/${id}/save-intro-sequence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames: introFrames, audio_url: url }) })
                  }})}
                  style={{ padding: '0.35rem 0.75rem', background: 'transparent', border: '1px solid #4c9bf044', borderRadius: '5px', color: '#4c9bf0', cursor: 'pointer', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                >
                  🎵 Freesound
                </button>
                <button
                  onClick={async () => {
                    await fetch(`/api/books/${id}/save-intro-sequence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames: introFrames, audio_url: introAudioUrl }) })
                  }}
                  style={{ padding: '0.35rem 0.75rem', background: 'transparent', border: '1px solid var(--success)44', borderRadius: '5px', color: 'var(--success)', cursor: 'pointer', fontSize: '0.75rem' }}
                >
                  💾 Sauvegarder
                </button>
              </div>
              {/* MusicGen */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  value={introMusicPrompt}
                  onChange={e => setIntroMusicPrompt(e.target.value)}
                  placeholder="Décrivez l'ambiance musicale…"
                  style={{ flex: 1, minWidth: '220px', background: 'var(--surface-2)', border: '1px solid #d4a84c33', borderRadius: '5px', padding: '0.35rem 0.6rem', color: 'var(--foreground)', fontSize: '0.75rem', outline: 'none' }}
                />
                <button
                  onClick={generateIntroMusic}
                  disabled={introGeneratingMusic || !introMusicPrompt.trim()}
                  style={{ padding: '0.35rem 0.75rem', background: introGeneratingMusic ? 'rgba(212,168,76,0.1)' : 'var(--accent)', border: introGeneratingMusic ? '1px solid var(--accent)' : 'none', borderRadius: '5px', color: introGeneratingMusic ? 'var(--accent)' : '#000', fontWeight: 'bold', fontSize: '0.73rem', cursor: introGeneratingMusic ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                >
                  {introGeneratingMusic ? '⟳ Génération…' : '🎵 MusicGen'}
                </button>
              </div>
              {introAudioUrl && (
                <audio key={`${introAudioUrl}-${introAudioBuster}`} controls src={`${introAudioUrl.split('?')[0]}?v=${introAudioBuster}`} style={{ height: '32px', width: '100%' }} />
              )}
            </div>

            {introFrames.length === 0 && !seqGenerating && (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted)', fontSize: '0.85rem', border: '1px dashed var(--border)', borderRadius: '10px' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎬</div>
                Cliquez sur "Générer la séquence" pour créer automatiquement le storyboard d'intro depuis la section 1.
              </div>
            )}

            {/* Frame cards */}
            {introFrames.map((frame) => (
              <div key={frame.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.9rem', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  <span style={{ background: 'var(--accent)22', color: 'var(--accent)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 'bold', flexShrink: 0 }}>
                    {frame.order}
                  </span>
                  <select value={frame.framing} onChange={e => updateFrame(frame.id, { framing: e.target.value as any })} style={selectSt}>
                    {Object.entries(FRAMING_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <select value={frame.duration} onChange={e => updateFrame(frame.id, { duration: e.target.value as any })} style={selectSt}>
                    {Object.entries(DURATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <select value={frame.transition} onChange={e => updateFrame(frame.id, { transition: e.target.value as any })} style={selectSt}>
                    {Object.entries(TRANSITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button onClick={() => deleteFrame(frame.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0.15rem 0.4rem' }} title="Supprimer ce plan">✕</button>
                </div>

                <div style={{ display: 'flex', gap: '1rem', padding: '0.85rem', flexWrap: 'wrap' }}>
                  {/* Colonne gauche : prompts + texte narratif */}
                  <div style={{ flex: 1, minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {/* Prompt FR */}
                    <div>
                      <div style={labelSt}>Prompt français</div>
                      <textarea
                        value={frame.prompt_fr}
                        onChange={e => updateFrame(frame.id, { prompt_fr: e.target.value })}
                        rows={3}
                        placeholder="Décrivez la scène en français…"
                        style={inputSt}
                      />
                      <button
                        onClick={() => translateFrame(frame.id, frame.prompt_fr)}
                        disabled={seqTranslating === frame.id || !frame.prompt_fr.trim()}
                        style={{ marginTop: '0.3rem', fontSize: '0.72rem', padding: '0.25rem 0.7rem', background: 'var(--accent)22', border: '1px solid var(--accent)44', borderRadius: '5px', color: 'var(--accent)', cursor: (seqTranslating === frame.id || !frame.prompt_fr.trim()) ? 'default' : 'pointer' }}
                      >
                        {seqTranslating === frame.id ? '⏳ Traduction…' : '🌐 Traduire → EN'}
                      </button>
                    </div>
                    {/* Prompt EN */}
                    <div>
                      <div style={labelSt}>Prompt anglais (envoyé à l'IA image)</div>
                      <textarea
                        value={frame.prompt_en}
                        onChange={e => updateFrame(frame.id, { prompt_en: e.target.value })}
                        rows={3}
                        placeholder="English prompt for image generation…"
                        style={{ ...inputSt, color: frame.prompt_en ? 'var(--foreground)' : 'var(--muted)' }}
                      />
                    </div>
                    {/* Texte narratif */}
                    <div>
                      <div style={labelSt}>Texte narratif (affiché sur l'image)</div>
                      <input
                        value={frame.narrative_text ?? ''}
                        onChange={e => updateFrame(frame.id, { narrative_text: e.target.value || undefined })}
                        placeholder="Ce soir-là, tous les gangs étaient réunis…"
                        style={{ ...inputSt, resize: undefined }}
                      />
                    </div>
                    {/* Référence visuelle (img2img) */}
                    {introFrames.some(f => f.id !== frame.id && f.image_url) && (
                      <div>
                        <div style={labelSt}>Référence visuelle (img2img)</div>
                        <select
                          value={frame.ref_frame_id ?? ''}
                          onChange={e => updateFrame(frame.id, { ref_frame_id: e.target.value || undefined })}
                          style={selectSt}
                        >
                          <option value="">— aucune (génération libre) —</option>
                          {introFrames.filter(f => f.id !== frame.id && f.image_url).map(f => (
                            <option key={f.id} value={f.id}>Plan {f.order}</option>
                          ))}
                        </select>
                        {frame.ref_frame_id && (
                          <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                            🔗 Kontext — variation depuis le plan {introFrames.find(f => f.id === frame.ref_frame_id)?.order}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Boutons générer image / vidéo */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => generateFrameImage(frame.id)}
                        disabled={seqImgGenerating === frame.id || !frame.prompt_en.trim()}
                        style={{ padding: '0.4rem 0.9rem', background: (seqImgGenerating === frame.id || !frame.prompt_en.trim()) ? 'var(--surface-2)' : '#2a2a3a', border: '1px solid var(--border)', borderRadius: '6px', color: (seqImgGenerating === frame.id || !frame.prompt_en.trim()) ? 'var(--muted)' : 'var(--foreground)', cursor: (seqImgGenerating === frame.id || !frame.prompt_en.trim()) ? 'default' : 'pointer', fontSize: '0.78rem' }}
                      >
                        {seqImgGenerating === frame.id ? '⏳…' : '🖼 Image'}
                      </button>
                      <button
                        onClick={() => generateFrameVideo(frame.id)}
                        disabled={frameVideoGenerating[frame.id] || !frame.prompt_en.trim()}
                        title="Générer une vidéo Veo (Google AI)"
                        style={{ padding: '0.4rem 0.9rem', background: frameVideoGenerating[frame.id] ? 'var(--surface-2)' : '#1a2a1a', border: `1px solid ${frameVideoGenerating[frame.id] ? 'var(--border)' : '#3a6a3a'}`, borderRadius: '6px', color: frameVideoGenerating[frame.id] ? 'var(--muted)' : '#7ecf7e', cursor: (frameVideoGenerating[frame.id] || !frame.prompt_en.trim()) ? 'default' : 'pointer', fontSize: '0.78rem' }}
                      >
                        {frameVideoGenerating[frame.id] ? '⏳ Veo…' : '🎬 Vidéo'}
                      </button>
                    </div>
                  </div>

                  {/* Colonne droite : aperçu image / vidéo */}
                  <div style={{ width: '260px', flexShrink: 0 }}>
                    {frame.video_url ? (
                      <div style={{ position: 'relative', cursor: 'zoom-in' }}>
                        <video src={frame.video_url} autoPlay muted loop playsInline style={{ width: '100%', borderRadius: '6px', display: 'block', border: '1px solid #3a6a3a' }} />
                        <div style={{ position: 'absolute', top: '4px', right: '4px', background: '#1a2a1a', border: '1px solid #3a6a3a', borderRadius: '4px', padding: '1px 5px', fontSize: '0.6rem', color: '#7ecf7e' }}>Veo</div>
                        {frame.narrative_text && (
                          <div style={{ position: 'absolute', bottom: '8px', left: '6px', right: '6px', fontSize: '0.65rem', color: '#fff', textShadow: '0 1px 3px #000', textAlign: 'center', fontStyle: 'italic' }}>
                            {frame.narrative_text}
                          </div>
                        )}
                      </div>
                    ) : frame.image_url ? (
                      <div style={{ position: 'relative', cursor: 'zoom-in' }} onClick={() => setZoomedImage(`${frame.image_url}?v=${frameImageVersions[frame.id] ?? 0}`)}>
                        <img src={`${frame.image_url}?v=${frameImageVersions[frame.id] ?? 0}`} alt={`Frame ${frame.order}`} style={{ width: '100%', borderRadius: '6px', display: 'block', border: '1px solid var(--border)' }} />
                        <div style={{ position: 'absolute', top: '4px', right: '4px', background: '#00000066', borderRadius: '4px', padding: '2px 5px', fontSize: '0.65rem', color: '#fff' }}>🔍</div>
                        {frame.narrative_text && (
                          <div style={{ position: 'absolute', bottom: '8px', left: '6px', right: '6px', fontSize: '0.65rem', color: '#fff', textShadow: '0 1px 3px #000', textAlign: 'center', fontStyle: 'italic' }}>
                            {frame.narrative_text}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--surface-2)', border: '1px dashed var(--border)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.72rem', textAlign: 'center', padding: '0.5rem' }}>
                        Pas encore d'image
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      })()}
          </div>{/* end padding div */}
        </div>{/* end content area */}
      </div>{/* end main area */}
    </div>{/* end flex wrapper */}

    {/* ── Lightbox image ──────────────────────────────────────────────────── */}
    {zoomedImage && (
      <div onClick={() => setZoomedImage(null)} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#000000cc', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
        <img src={zoomedImage} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: '8px', boxShadow: '0 8px 40px #000' }} />
      </div>
    )}

    {/* ── Panneau d'analyse ───────────────────────────────────────────────── */}
    {storyPanel && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
        <div onClick={() => setStoryPanel(false)} style={{ position: 'absolute', inset: 0, background: '#00000066' }} />
        <div style={{
          position: 'relative', zIndex: 1, width: 'min(700px, 94vw)', height: '100vh',
          background: 'var(--surface)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px #0008',
        }}>
          {/* En-tête */}
          <div style={{ padding: '1rem 1.4rem 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--accent)' }}>
                🔍 Analyse · {book?.title}
              </span>
              <button onClick={() => setStoryPanel(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
            </div>
            {/* Onglets */}
            <div style={{ display: 'flex', gap: '0' }}>
              {([
                { key: 'narrative', label: '📋 Cohérence narrative', hasData: !!storySummary },
                { key: 'language',  label: '🔤 Orthographe & Grammaire', hasData: !!langReport },
              ] as const).map(t => (
                <button key={t.key} onClick={() => setStoryTab(t.key)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '0.4rem 1rem', fontSize: '0.8rem',
                  fontWeight: storyTab === t.key ? 'bold' : 'normal',
                  color: storyTab === t.key ? 'var(--accent)' : 'var(--muted)',
                  borderBottom: storyTab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: '-1px', position: 'relative',
                }}>
                  {t.label}
                  {t.hasData && <span style={{ position: 'absolute', top: '4px', right: '6px', width: '6px', height: '6px', borderRadius: '50%', background: '#4caf7d' }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Erreur globale */}
          {storyError && (
            <div style={{ margin: '0.75rem 1.4rem 0', padding: '0.6rem 0.9rem', background: '#c94c4c11', border: '1px solid #c94c4c44', borderRadius: '6px', fontSize: '0.82rem', color: 'var(--danger)', display: 'flex', justifyContent: 'space-between' }}>
              ⚠ {storyError}
              <button onClick={() => setStoryError(null)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
            </div>
          )}

          {/* ── Onglet Narrative ── */}
          {storyTab === 'narrative' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.2rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={async () => {
                    setStoryGenerating(true); setStoryError(null)
                    try {
                      const res = await fetch(`/api/books/${id}/story-summary`, { method: 'POST' })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error)
                      setStorySummary(data.summary)
                    } catch (err: any) { setStoryError(err.message) }
                    finally { setStoryGenerating(false) }
                  }}
                  disabled={storyGenerating || fixingInconsistencies}
                  style={{
                    fontSize: '0.78rem', padding: '0.3rem 0.8rem', borderRadius: '6px',
                    background: storyGenerating ? 'var(--surface-2)' : 'var(--accent)', border: 'none',
                    color: storyGenerating ? 'var(--muted)' : '#0f0f14',
                    cursor: storyGenerating ? 'not-allowed' : 'pointer', fontWeight: 'bold',
                  }}
                >{storyGenerating ? '⏳ Analyse...' : storySummary ? '🔄 Relancer' : '▶ Lancer l\'analyse'}</button>
              </div>

              {fixResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {(fixResult.applied.length > 0 || fixResult.structural.length > 0) ? (
                    <div style={{ padding: '0.6rem 0.9rem', background: '#4caf7d22', border: '1px solid #4caf7d66', borderRadius: '8px', fontSize: '0.8rem', color: '#4caf7d', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>✓ {fixResult.summary}</div>
                        {fixResult.applied.length > 0 && <div>Texte : {fixResult.applied.map(n => `§${n}`).join(', ')}</div>}
                        {fixResult.structural.map((s, i) => <div key={i}>🔧 {s}</div>)}
                      </div>
                      <button onClick={() => setFixResult(null)} style={{ background: 'none', border: 'none', color: '#4caf7d', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ padding: '0.6rem 0.9rem', background: '#c9a84c22', border: '1px solid #c9a84c66', borderRadius: '8px', fontSize: '0.8rem', color: '#c9a84c' }}>
                      ⚠ Aucune correction appliquée automatiquement.
                    </div>
                  )}
                  {fixResult.skipped?.length > 0 && (
                    <div style={{ padding: '0.6rem 0.9rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '0.3rem', color: 'var(--foreground)' }}>⚠ À corriger manuellement :</div>
                      {fixResult.skipped.map((s, i) => (
                        <div key={i} style={{ marginBottom: '0.2rem' }}>
                          <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>§{s.number}</span> — {s.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {storyGenerating && !storySummary && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⏳</div>
                  <p style={{ fontSize: '0.85rem' }}>Lecture de toutes les sections en cours…</p>
                  <p style={{ fontSize: '0.72rem', opacity: 0.6, marginTop: '0.3rem' }}>20 à 40 secondes</p>
                </div>
              )}
              {!storySummary && !storyGenerating && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📋</div>
                  <p style={{ fontSize: '0.85rem' }}>Analyse de la cohérence narrative de toutes les sections.</p>
                </div>
              )}
              {storySummary && (
                <StoryReport
                  markdown={storySummary}
                  bookId={id}
                  fixing={fixingInconsistencies}
                  onFix={async () => {
                    setFixingInconsistencies(true); setFixResult(null); setStoryError(null)
                    try {
                      // 1. Corriger les incohérences
                      const res = await fetch(`/api/books/${id}/fix-inconsistencies`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ analysis: storySummary }),
                      })
                      let data: any
                      try { data = await res.json() } catch { throw new Error(`Réponse invalide (HTTP ${res.status})`) }
                      if (!res.ok) throw new Error(data?.error ?? `Erreur ${res.status}`)
                      setFixResult(data)
                      // 2. Recharger les sections
                      const secRes = await fetch(`/api/books/${id}`)
                      const secData = await secRes.json()
                      if (secData.sections) setSections(secData.sections)
                      // 3. Relancer l'analyse automatiquement
                      setStoryGenerating(true)
                      const anaRes = await fetch(`/api/books/${id}/story-summary`, { method: 'POST' })
                      const anaData = await anaRes.json()
                      if (anaData.summary) setStorySummary(anaData.summary)
                    } catch (err: any) { setStoryError(err.message) }
                    finally { setFixingInconsistencies(false); setStoryGenerating(false) }
                  }}
                />
              )}
            </div>
          )}

          {/* ── Onglet Langue ── */}
          {storyTab === 'language' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.2rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  onClick={async () => {
                    setLangGenerating(true); setStoryError(null); setLangFixResult([])
                    try {
                      const res = await fetch(`/api/books/${id}/check-language`, { method: 'POST' })
                      let data: any
                      try { data = await res.json() } catch { throw new Error(`Réponse invalide (HTTP ${res.status})`) }
                      if (!res.ok) throw new Error(data?.error)
                      setLangReport(data.report)
                      const newErrors = (data.errors ?? []).map((s: any) => ({
                        ...s,
                        errors: s.errors.filter((e: any) => !ignoredErrorKeys.has(`${s.number}:${e.original}`))
                      })).filter((s: any) => s.errors.length > 0)
                      setLangErrors(newErrors)
                    } catch (err: any) { setStoryError(err.message) }
                    finally { setLangGenerating(false) }
                  }}
                  disabled={langGenerating || langFixing}
                  style={{
                    fontSize: '0.78rem', padding: '0.3rem 0.8rem', borderRadius: '6px',
                    background: langGenerating ? 'var(--surface-2)' : 'var(--accent)', border: 'none',
                    color: langGenerating ? 'var(--muted)' : '#0f0f14',
                    cursor: langGenerating ? 'not-allowed' : 'pointer', fontWeight: 'bold',
                  }}
                >{langGenerating ? '⏳ Vérification...' : langReport ? '🔄 Revérifier' : '▶ Vérifier'}</button>
                {langErrors.length > 0 && (
                  <button
                    onClick={async () => {
                      setLangFixing(true); setStoryError(null)
                      try {
                        const res = await fetch(`/api/books/${id}/fix-language`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ errors: langErrors }),
                        })
                        let data: any
                        try { data = await res.json() } catch { throw new Error(`Réponse invalide (HTTP ${res.status})`) }
                        if (!res.ok) throw new Error(data?.error)
                        setLangFixResult(data.applied ?? [])
                        // Recharger les sections
                        const secRes = await fetch(`/api/books/${id}`)
                        const secData = await secRes.json()
                        if (secData.sections) setSections(secData.sections)
                        // Relancer l'analyse pour mettre à jour le rapport
                        setLangErrors([])
                        setLangGenerating(true)
                        const checkRes = await fetch(`/api/books/${id}/check-language`, { method: 'POST' })
                        const checkData = await checkRes.json()
                        if (checkData.report) setLangReport(checkData.report)
                        setLangErrors(checkData.errors ?? [])
                      } catch (err: any) { setStoryError(err.message) }
                      finally { setLangFixing(false); setLangGenerating(false) }
                    }}
                    disabled={langFixing}
                    style={{
                      fontSize: '0.78rem', padding: '0.3rem 0.8rem', borderRadius: '6px',
                      background: langFixing ? 'var(--surface-2)' : '#4caf7d', border: 'none',
                      color: langFixing ? 'var(--muted)' : '#fff',
                      cursor: langFixing ? 'not-allowed' : 'pointer', fontWeight: 'bold',
                    }}
                  >{langFixing ? '⏳ Correction...' : '✓ Tout corriger'}</button>
                )}
              </div>

              {langFixResult.length > 0 && (
                <div style={{ padding: '0.6rem 0.9rem', background: '#4caf7d22', border: '1px solid #4caf7d66', borderRadius: '8px', fontSize: '0.8rem', color: '#4caf7d' }}>
                  ✓ Sections corrigées : {langFixResult.map(n => `§${n}`).join(', ')}
                </div>
              )}
              {langGenerating && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔤</div>
                  <p style={{ fontSize: '0.85rem' }}>Vérification orthographique et grammaticale…</p>
                  <p style={{ fontSize: '0.72rem', opacity: 0.6, marginTop: '0.3rem' }}>Analyse par lots de 25 sections</p>
                </div>
              )}
              {!langReport && !langGenerating && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔤</div>
                  <p style={{ fontSize: '0.85rem' }}>Détecte les fautes d'orthographe et de grammaire dans toutes les sections.</p>
                </div>
              )}
              {langReport && !langGenerating && (
                <LangReport
                  markdown={langReport}
                  errors={langErrors}
                  fixingKeys={fixingErrorKeys}
                  onFix={async (sectionNum, errIdx) => {
                    const key = `${sectionNum}-${errIdx}`
                    const secErrors = langErrors.find(s => s.number === sectionNum)
                    if (!secErrors) return
                    const err = secErrors.errors[errIdx]
                    setFixingErrorKeys(prev => new Set(prev).add(key))
                    try {
                      const res = await fetch(`/api/books/${id}/fix-language`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ errors: [{ number: sectionNum, errors: [err] }] }),
                      })
                      const data = await res.json()
                      // Retirer l'erreur de la liste dans tous les cas
                      setLangErrors(prev => {
                        const updated = prev
                          .map(s => s.number === sectionNum
                            ? { ...s, errors: s.errors.filter((_: any, i: number) => i !== errIdx) }
                            : s)
                          .filter((s: any) => s.errors.length > 0)
                        if (updated.length === 0) setLangReport('')
                        return updated
                      })
                      if (data.applied?.length) {
                        setLangFixResult(prev => [...new Set([...prev, sectionNum])])
                      }
                    } finally {
                      setFixingErrorKeys(prev => { const n = new Set(prev); n.delete(key); return n })
                    }
                  }}
                  onIgnore={(sectionNum, original) => {
                    const key = `${sectionNum}:${original}`
                    const next = new Set(ignoredErrorKeys).add(key)
                    setIgnoredErrorKeys(next)
                    localStorage.setItem(`lang-ignored:${id}`, JSON.stringify([...next]))
                    setLangErrors(prev => prev
                      .map(s => s.number === sectionNum
                        ? { ...s, errors: s.errors.filter((e: any) => e.original !== original) }
                        : s)
                      .filter((s: any) => s.errors.length > 0))
                  }}
                  onNavigate={(sectionNum, errors) => {
                    const sec = sections.find(s => s.number === sectionNum)
                    if (sec) setSectionPreview({ number: sectionNum, content: sec.content ?? '', errors })
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    )}

    {/* ── Modal prévisualisation section avec erreurs surlignées ── */}
    {sectionPreview && (
      <div
        onClick={() => setSectionPreview(null)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem', maxWidth: '680px', width: '100%', maxHeight: '80vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>§{sectionPreview.number}</span>
            <button onClick={() => setSectionPreview(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
          </div>
          <div style={{ fontSize: '0.85rem', lineHeight: 1.75, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
            {highlightErrors(sectionPreview.content, sectionPreview.errors)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
            {sectionPreview.errors.map((e, i) => {
              const color = e.type === 'ortho' ? '#6b8cde' : e.type === 'style' ? '#c9a84c' : '#b48edd'
              return (
                <span key={i} style={{ fontSize: '0.72rem', padding: '2px 7px', borderRadius: '4px', background: `${color}22`, color, border: `1px solid ${color}44` }}>
                  {e.type} : <b>{e.original}</b>
                </span>
              )
            })}
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ── Rapport d'analyse narrative ───────────────────────────────────────────────

function StoryReport({ markdown, bookId, fixing, onFix }: {
  markdown: string
  bookId: string
  fixing: boolean
  onFix: () => void
}) {
  const blocks = markdown.split(/^## /m).filter(Boolean)
  const ICONS: Record<string, string> = {
    'Résumé': '📖',
    'Chemins': '🔀',
    'Incohérences': '⚠️',
    'Points forts': '✅',
    'Recommandations': '🛠',
  }

  function renderBody(body: string) {
    return body.split('\n').map((line, j) => {
      const parts = line.split(/(§\d+)/g)
      return (
        <div key={j} style={{ marginBottom: line.startsWith('-') ? '0.25rem' : 0 }}>
          {parts.map((part, k) =>
            /^§\d+$/.test(part)
              ? <span key={k} style={{ background: 'var(--accent)33', color: 'var(--accent)', borderRadius: '3px', padding: '0 3px', fontWeight: 'bold', fontSize: '0.78rem' }}>{part}</span>
              : part
          )}
        </div>
      )
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        const title = lines[0].trim()
        const body = lines.slice(1).join('\n').trim()
        const icon = Object.entries(ICONS).find(([k]) => title.includes(k))?.[1] ?? '📄'
        const isWarning = title.includes('Incohérence')
        const isGood = title.includes('forts')
        const hasNoIssue = isWarning && body.toLowerCase().includes('aucun problème')
        const borderColor = isWarning && !hasNoIssue ? '#c9a84c' : isGood ? '#4caf7d' : 'var(--border)'

        return (
          <div key={i} style={{
            background: 'var(--surface-2)', borderRadius: '8px',
            border: `1px solid ${borderColor}44`,
            borderLeft: `3px solid ${borderColor}`,
            padding: '1rem 1.1rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 'bold', color: isWarning && !hasNoIssue ? '#c9a84c' : isGood ? '#4caf7d' : 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {icon} {title}
              </div>
              {isWarning && !hasNoIssue && (
                <button
                  onClick={onFix}
                  disabled={fixing}
                  style={{
                    fontSize: '0.72rem', padding: '0.25rem 0.7rem', borderRadius: '5px',
                    background: fixing ? 'var(--surface)' : '#c9a84c',
                    border: 'none',
                    color: fixing ? 'var(--muted)' : '#0f0f14',
                    cursor: fixing ? 'not-allowed' : 'pointer', fontWeight: 'bold',
                    flexShrink: 0,
                  }}
                >{fixing ? '⏳ Correction...' : '🔧 Corriger'}</button>
              )}
            </div>
            <div style={{ fontSize: '0.83rem', lineHeight: 1.75, color: 'var(--foreground)', whiteSpace: 'pre-wrap' }}>
              {renderBody(body)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Surlignage des erreurs dans le texte de section ──────────────────────────

function highlightErrors(text: string, errors: { original: string; type: string }[]): React.ReactNode[] {
  const originals = [...new Set(errors.map(e => e.original))].filter(Boolean)
  if (!originals.length) return [text]
  const escaped = originals.map(o => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'g')
  return text.split(regex).map((part, i) => {
    const err = errors.find(e => e.original === part)
    if (!err) return part
    const color = err.type === 'ortho' ? '#6b8cde' : err.type === 'style' ? '#c9a84c' : '#b48edd'
    return <mark key={i} style={{ background: `${color}44`, color, borderRadius: '3px', padding: '0 2px', fontWeight: 'bold', textDecoration: 'underline wavy' }}>{part}</mark>
  })
}

// ── Parse markdown lang_analysis → données structurées ───────────────────────

function parseLangAnalysis(markdown: string) {
  const result: { number: number; errors: { type: string; original: string; correction: string; context: string }[] }[] = []
  let currentSection: typeof result[0] | null = null

  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Détecte "### §N"
    const secMatch = line.match(/^###\s+§(\d+)/)
    if (secMatch) {
      if (currentSection && currentSection.errors.length > 0) result.push(currentSection)
      currentSection = { number: parseInt(secMatch[1]), errors: [] }
      continue
    }
    if (!currentSection) continue
    // Détecte "- 🔤 **original** → `correction`"
    const errMatch = line.match(/^-\s+(🔤|📝|✏️)\s+\*\*(.+?)\*\*\s*→\s*`(.+?)`/)
    if (errMatch) {
      const type = errMatch[1] === '🔤' ? 'ortho' : errMatch[1] === '✏️' ? 'style' : 'grammar'
      const original = errMatch[2]
      const correction = errMatch[3]
      // Ligne suivante peut contenir le contexte "_..._"
      const nextLine = lines[i + 1] ?? ''
      const ctxMatch = nextLine.match(/^\s+_(.+?)_/)
      currentSection.errors.push({ type, original, correction, context: ctxMatch?.[1] ?? '' })
    }
  }
  if (currentSection && currentSection.errors.length > 0) result.push(currentSection)
  return result
}

// ── Rapport orthographique & grammatical ──────────────────────────────────────

function LangReport({ markdown, errors, fixingKeys, onFix, onIgnore, onNavigate }: {
  markdown: string
  errors?: { number: number; errors: { type: string; original: string; correction: string; context: string }[] }[]
  fixingKeys?: Set<string>
  onFix?: (sectionNum: number, errIdx: number) => void
  onIgnore?: (sectionNum: number, original: string) => void
  onNavigate?: (sectionNum: number, errors: { original: string; type: string }[]) => void
}) {
  // ── Rendu depuis données structurées (avec boutons individuels) ──────────
  if (errors && errors.length > 0 && onFix) {
    // Extraire le bilan depuis le markdown
    const bilanMatch = markdown.match(/## Bilan\n([\s\S]*?)(?=\n##|$)/)
    const bilanText = bilanMatch?.[1]?.trim() ?? ''
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {bilanText && (
          <div style={{ background: 'var(--surface-2)', borderRadius: '8px', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)', padding: '0.8rem 1rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--accent)', marginBottom: '0.3rem' }}>Bilan</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{bilanText.split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>
          </div>
        )}
        {errors.map(sec => (
          <div key={sec.number} style={{ background: 'var(--surface-2)', borderRadius: '8px', border: '1px solid #c9a84c44', borderLeft: '3px solid #c9a84c', padding: '0.8rem 1rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--muted)', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              📍 Section
              <button onClick={() => onNavigate?.(sec.number, sec.errors)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', padding: 0, textDecoration: 'underline' }}>§{sec.number}</button>
            </div>
            {sec.errors.map((err: any, errIdx: number) => {
              const key = `${sec.number}-${errIdx}`
              const isOrtho  = err.type === 'ortho'
              const isStyle  = err.type === 'style'
              const badgeColor = isOrtho ? '#6b8cde' : isStyle ? '#c9a84c' : '#b48edd'
              const badgeLabel = isOrtho ? 'ortho' : isStyle ? 'style' : 'gram.'
              const isFixing = fixingKeys?.has(key)
              return (
                <div key={errIdx} style={{ marginBottom: '0.5rem', paddingLeft: '0.5rem', borderLeft: `2px solid ${badgeColor}44` }}>
                  <div style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', padding: '1px 5px', borderRadius: '3px', background: `${badgeColor}22`, color: badgeColor, fontWeight: 'bold' }}>
                      {badgeLabel}
                    </span>
                    <span style={{ color: 'var(--danger)', textDecoration: 'line-through', fontWeight: 'bold' }}>{err.original}</span>
                    <span style={{ color: 'var(--muted)' }}>→</span>
                    <span style={{ color: '#4caf7d', fontWeight: 'bold' }}>{err.correction}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.3rem' }}>
                      <button
                        onClick={() => onFix(sec.number, errIdx)}
                        disabled={isFixing}
                        style={{
                          fontSize: '0.68rem', padding: '2px 8px', borderRadius: '4px',
                          background: isFixing ? 'var(--surface-2)' : '#4caf7d22',
                          border: `1px solid ${isFixing ? 'var(--border)' : '#4caf7d66'}`,
                          color: isFixing ? 'var(--muted)' : '#4caf7d',
                          cursor: isFixing ? 'not-allowed' : 'pointer', fontWeight: 'bold',
                        }}
                      >{isFixing ? '⏳' : '✓ Corriger'}</button>
                      <button
                        onClick={() => onIgnore?.(sec.number, err.original)}
                        style={{
                          fontSize: '0.68rem', padding: '2px 8px', borderRadius: '4px',
                          background: 'var(--surface-2)', border: '1px solid var(--border)',
                          color: 'var(--muted)', cursor: 'pointer',
                        }}
                      >Ignorer</button>
                    </span>
                  </div>
                  {err.context && <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontStyle: 'italic', marginTop: '0.2rem' }}>{err.context}</div>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  // ── Fallback : rendu depuis markdown (après rechargement de page) ────────
  const lines = markdown.split('\n')
  const blocks: { title: string; items: string[] }[] = []
  let current: { title: string; items: string[] } | null = null
  for (const line of lines) {
    if (line.startsWith('### ')) { if (current) blocks.push(current); current = { title: line.slice(4).trim(), items: [] } }
    else if (line.startsWith('## ')) { if (current) blocks.push(current); current = { title: line.slice(3).trim(), items: [] } }
    else if (line.trim()) { current?.items.push(line.trim()) }
  }
  if (current) blocks.push(current)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {blocks.map((block, i) => {
        const isBilan = block.title.startsWith('Bilan')
        const isSection = block.title.startsWith('§')
        const hasErrors = block.items.some(l => l.startsWith('-'))
        return (
          <div key={i} style={{ background: 'var(--surface-2)', borderRadius: '8px', border: `1px solid ${hasErrors ? '#c9a84c44' : 'var(--border)'}`, borderLeft: `3px solid ${isBilan ? 'var(--accent)' : hasErrors ? '#c9a84c' : '#4caf7d'}`, padding: '0.8rem 1rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: isBilan ? 'var(--accent)' : 'var(--muted)', marginBottom: hasErrors ? '0.5rem' : 0 }}>
              {isSection ? `📍 Section ${block.title}` : block.title}
            </div>
            {block.items.map((item, j) => {
              if (!item.startsWith('-')) return <div key={j} style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{item}</div>
              const isOrtho  = item.includes('🔤')
              const isStyle  = item.includes('✏️')
              const bColor = isOrtho ? '#6b8cde' : isStyle ? '#c9a84c' : '#b48edd'
              const bLabel = isOrtho ? 'ortho' : isStyle ? 'style' : 'gram.'
              const origMatch = item.match(/\*\*(.+?)\*\*/)
              const corrMatch = item.match(/`(.+?)`/)
              const ctxMatch = item.match(/_(.+?)_/)
              return (
                <div key={j} style={{ marginBottom: '0.5rem', paddingLeft: '0.5rem', borderLeft: `2px solid ${bColor}44` }}>
                  <div style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', padding: '1px 5px', borderRadius: '3px', background: `${bColor}22`, color: bColor, fontWeight: 'bold' }}>{bLabel}</span>
                    {origMatch && <span style={{ color: 'var(--danger)', textDecoration: 'line-through', fontWeight: 'bold' }}>{origMatch[1]}</span>}
                    {corrMatch && <><span style={{ color: 'var(--muted)' }}>→</span><span style={{ color: '#4caf7d', fontWeight: 'bold' }}>{corrMatch[1]}</span></>}
                  </div>
                  {ctxMatch && <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontStyle: 'italic', marginTop: '0.2rem' }}>{ctxMatch[1]}</div>}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── Carte de combat ───────────────────────────────────────────────────────────

function CombatCard({ trial, npcs, sections, onNavigate }: {
  trial: NonNullable<Section['trial']>
  npcs: Npc[]
  sections: Section[]
  onNavigate: (n: number) => void
}) {
  const npc = trial.npc_id ? npcs.find(n => n.id === trial.npc_id) : null
  const enemy = npc ?? trial.enemy
  const successNum = trial.success_section_id ? sections.find(s => s.id === trial.success_section_id)?.number : null
  const failureNum = trial.failure_section_id ? sections.find(s => s.id === trial.failure_section_id)?.number : null

  if (!enemy && !trial.type) return null

  const isMagic  = trial.type === 'magie'
  const borderCol = isMagic ? '#b48edd' : '#e05c4b'

  const statRows = npc ? [
    { key: 'force',        label: 'Force',   color: '#e05c4b', icon: '💪', val: npc.force },
    { key: 'endurance',    label: 'PV max',  color: '#4caf7d', icon: '❤️',  val: npc.endurance },
    { key: 'agilite',      label: 'Agilité', color: '#4ec9b0', icon: '🏃',  val: npc.agilite },
    { key: 'magie',        label: 'Magie',   color: '#b48edd', icon: '✨',  val: npc.magie },
    { key: 'intelligence', label: 'Intel.',  color: '#6b8cde', icon: '🧠',  val: npc.intelligence },
    { key: 'chance',       label: 'Chance',  color: '#f0a742', icon: '🎲',  val: npc.chance },
  ] : [
    { key: 'force',     label: 'Force',  color: '#e05c4b', icon: '💪', val: (enemy as any)?.force ?? 0 },
    { key: 'endurance', label: 'PV max', color: '#4caf7d', icon: '❤️',  val: (enemy as any)?.endurance ?? 0 },
  ]

  const tc = npc ? NPC_TYPE_CONFIG[npc.type] : NPC_TYPE_CONFIG['ennemi']

  return (
    <div style={{
      marginTop: '0.85rem',
      border: `1px solid ${borderCol}55`,
      borderRadius: '10px',
      padding: '0.9rem 1rem',
      background: `${borderCol}06`,
    }}>
      {/* En-tête adversaire */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.2rem' }}>{tc.icon}</span>
          <div>
            <span style={{ fontWeight: 'bold', color: '#e05c4b', fontSize: '0.95rem' }}>
              {(enemy as any)?.name ?? trial.type}
            </span>
            {npc && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: tc.color + '22', color: tc.color, fontWeight: 'bold' }}>
                {tc.label}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {trial.xp_reward && (
            <span style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '4px', background: '#f0a74222', color: '#f0a742', fontWeight: 'bold' }}>
              ⭐ +{trial.xp_reward} XP
            </span>
          )}
          {trial.mana_cost && (
            <span style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '4px', background: '#b48edd22', color: '#b48edd' }}>
              🔮 -{trial.mana_cost} mana
            </span>
          )}
        </div>
      </div>

      {/* Description du PNJ */}
      {npc?.description && (
        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic', margin: '0 0 0.65rem' }}>
          {npc.description}
        </p>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${statRows.length}, 1fr)`, gap: '0.35rem 0.6rem', marginBottom: '0.65rem' }}>
        {statRows.map(s => (
          <div key={s.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', marginBottom: '0.15rem' }}>
              <span style={{ color: s.color }}>{s.icon} {s.label}</span>
              <strong style={{ color: 'var(--foreground)' }}>{s.val}</strong>
            </div>
            <div style={{ height: '4px', background: 'var(--surface-2)', borderRadius: '2px' }}>
              <div style={{ width: `${Math.min((s.val / (s.key === 'endurance' ? 40 : 20)) * 100, 100)}%`, height: '100%', background: s.color, borderRadius: '2px' }} />
            </div>
          </div>
        ))}
      </div>

      {/* Capacité spéciale + résistances */}
      {(npc?.special_ability || npc?.resistances) && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.65rem', fontSize: '0.72rem' }}>
          {npc.special_ability && <span style={{ color: '#b48edd' }}>⚡ {npc.special_ability}</span>}
          {npc.resistances     && <span style={{ color: '#4ec9b0' }}>🛡 {npc.resistances}</span>}
        </div>
      )}

      {/* Récompenses victoire */}
      {(trial.item_rewards?.length || npc?.loot) && (
        <div style={{ marginBottom: '0.65rem', fontSize: '0.72rem', color: '#f0a742' }}>
          🎁 <strong>Butin :</strong> {[...(trial.item_rewards ?? []), ...(npc?.loot ? [npc.loot] : [])].join(' · ')}
        </div>
      )}

      {/* Redirections */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {successNum != null ? (
          <button onClick={() => onNavigate(successNum)} style={{
            fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: '5px',
            background: '#4caf7d22', color: '#4caf7d', border: '1px solid #4caf7d55',
            cursor: 'pointer', fontWeight: 'bold',
          }}>
            ✓ Victoire → §{successNum}
          </button>
        ) : (
          <span style={{ fontSize: '0.72rem', color: '#c9a84c', padding: '0.3rem 0.6rem', background: '#c9a84c11', borderRadius: '4px' }}>⚠ Section victoire manquante</span>
        )}
        {failureNum != null ? (
          <button onClick={() => onNavigate(failureNum)} style={{
            fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: '5px',
            background: '#c94c4c22', color: '#c94c4c', border: '1px solid #c94c4c55',
            cursor: 'pointer', fontWeight: 'bold',
          }}>
            ✗ Défaite → §{failureNum}
          </button>
        ) : (
          <span style={{ fontSize: '0.72rem', color: '#c9a84c', padding: '0.3rem 0.6rem', background: '#c9a84c11', borderRadius: '4px' }}>⚠ Section défaite manquante</span>
        )}
        {trial.endurance_loss_on_failure != null && (
          <span style={{ fontSize: '0.72rem', color: '#c94c4c' }}>
            💔 -{trial.endurance_loss_on_failure} PV en cas d'échec
          </span>
        )}
      </div>
    </div>
  )
}

// ── Carte de dialogue ─────────────────────────────────────────────────────────

interface NpcEncounter {
  section_number: number
  outcome: 'success' | 'failure' | 'abandoned'
  memory_summary: string
  timestamp: string
}

function memoryKey(bookId: string, npcId: string) {
  return `hero_npc_memory_${bookId}_${npcId}`
}

function loadMemory(bookId: string, npcId: string): NpcEncounter[] {
  try {
    return JSON.parse(localStorage.getItem(memoryKey(bookId, npcId)) ?? '[]')
  } catch { return [] }
}

function saveMemory(bookId: string, npcId: string, encounters: NpcEncounter[]) {
  localStorage.setItem(memoryKey(bookId, npcId), JSON.stringify(encounters))
}

function DialogueCard({ trial, npcs, sections, book, sectionNumber, onNavigate }: {
  trial: NonNullable<Section['trial']>
  npcs: Npc[]
  sections: Section[]
  book: Book
  sectionNumber: number
  onNavigate: (n: number) => void
}) {
  const npc = trial.npc_id ? npcs.find(n => n.id === trial.npc_id) : null
  const [history, setHistory] = useState<{ role: 'player' | 'npc'; text: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [resolved, setResolved] = useState<'success' | 'failure' | null>(null)
  const [suggestedChoice, setSuggestedChoice] = useState<number | null>(null)
  const [pastEncounters, setPastEncounters] = useState<NpcEncounter[]>([])
  const [showMemory, setShowMemory] = useState(false)
  const [dialogueMode, setDialogueMode] = useState<'free' | 'choices'>('choices')
  const [playerChoices, setPlayerChoices] = useState<string[]>([])

  // Charger la mémoire au montage
  useEffect(() => {
    if (npc) setPastEncounters(loadMemory(book.id, npc.id))
  }, [book.id, npc?.id])

  const successNum = trial.success_section_id ? sections.find(s => s.id === trial.success_section_id)?.number : null
  const failureNum = trial.failure_section_id ? sections.find(s => s.id === trial.failure_section_id)?.number : null
  const sectionChoices = [
    ...(successNum != null ? [{ label: 'Accord obtenu', section_number: successNum }] : []),
    ...(failureNum != null ? [{ label: 'Refus ou échec', section_number: failureNum }] : []),
  ]

  const opening = trial.dialogue_opening ?? npc?.dialogue_intro
  const opened = history.length > 0

  function startDialogue() {
    const initial = opening ? [{ role: 'npc' as const, text: opening }] : []
    setHistory(initial)
    if (dialogueMode === 'choices') generatePlayerChoices(initial)
  }

  async function generatePlayerChoices(currentHistory: { role: 'player' | 'npc'; text: string }[]) {
    setPlayerChoices([])
    try {
      const sectionContent = sections.find(s => s.number === sectionNumber)?.content ?? ''
      const res = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npc: { name: npc?.name ?? 'Personnage', description: npc?.description, speech_style: npc?.speech_style, type: npc?.type ?? 'neutre' },
          section_context: sectionContent,
          dialogue_goal: trial.dialogue_goal ?? '',
          history: currentHistory,
          player_message: '',
          choices: sectionChoices,
          book_theme: book.theme,
          age_range: book.age_range,
          past_encounters: pastEncounters,
          generate_choices_only: true,
        }),
      })
      const data = await res.json()
      setPlayerChoices(data.player_choices ?? [])
    } catch { /* silencieux */ }
  }

  // Génère et sauvegarde le résumé mémoriel à la fin du dialogue
  async function finalizeMemory(finalHistory: { role: 'player' | 'npc'; text: string }[], outcome: 'success' | 'failure') {
    if (!npc || finalHistory.length < 2) return
    try {
      const res = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npc: { name: npc.name, description: npc.description, speech_style: npc.speech_style, type: npc.type },
          section_context: '',
          dialogue_goal: trial.dialogue_goal ?? '',
          history: finalHistory,
          player_message: '',
          choices: [],
          book_theme: book.theme,
          age_range: book.age_range,
          generate_memory_summary: true,
        }),
      })
      const data = await res.json()
      const newEncounter: NpcEncounter = {
        section_number: sectionNumber,
        outcome,
        memory_summary: data.memory_summary ?? `Rencontre en §${sectionNumber}.`,
        timestamp: new Date().toISOString(),
      }
      const updated = [...pastEncounters, newEncounter]
      setPastEncounters(updated)
      saveMemory(book.id, npc.id, updated)
    } catch { /* silencieux */ }
  }

  async function sendMessage(overrideText?: string) {
    const playerMsg = (overrideText ?? input).trim()
    if (!playerMsg || loading || resolved) return
    if (!overrideText) setInput('')
    setPlayerChoices([])
    const newHistory = [...history, { role: 'player' as const, text: playerMsg }]
    setHistory(newHistory)
    setLoading(true)

    try {
      const sectionContent = sections.find(s => s.number === sectionNumber)?.content ?? ''
      const res = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npc: { name: npc?.name ?? 'Personnage', description: npc?.description, speech_style: npc?.speech_style, type: npc?.type ?? 'neutre' },
          section_context: sectionContent,
          dialogue_goal: trial.dialogue_goal ?? 'Obtenir des informations utiles du personnage.',
          history: newHistory.slice(0, -1),
          player_message: playerMsg,
          choices: sectionChoices,
          book_theme: book.theme,
          age_range: book.age_range,
          past_encounters: pastEncounters,
          dialogue_mode: dialogueMode,
        }),
      })
      const data = await res.json()
      const npcReply = data.npc_reply ?? '…'
      const finalHistory = [...newHistory, { role: 'npc' as const, text: npcReply }]
      setHistory(finalHistory)
      if (data.suggested_choice_index != null) setSuggestedChoice(data.suggested_choice_index)
      if (data.is_resolved) {
        const outcome = data.resolution_hint ?? 'success'
        setResolved(outcome)
        finalizeMemory(finalHistory, outcome)
      } else if (dialogueMode === 'choices') {
        if (data.player_choices?.length) {
          setPlayerChoices(data.player_choices)
        } else {
          generatePlayerChoices(finalHistory)
        }
      }
    } catch {
      setHistory(h => [...h, { role: 'npc', text: '…' }])
    }
    setLoading(false)
  }

  function resetMemory() {
    if (!npc) return
    saveMemory(book.id, npc.id, [])
    setPastEncounters([])
  }

  const tc = npc ? NPC_TYPE_CONFIG[npc.type] : NPC_TYPE_CONFIG['neutre']

  return (
    <div style={{ marginTop: '0.85rem', border: '1px solid #64b5f655', borderRadius: '10px', padding: '0.9rem 1rem', background: '#64b5f606' }}>
      {/* En-tête PNJ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.3rem' }}>💬</span>
          <div>
            <span style={{ fontWeight: 'bold', color: '#64b5f6', fontSize: '0.95rem' }}>{npc?.name ?? 'Personnage inconnu'}</span>
            {npc && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: tc.color + '22', color: tc.color, fontWeight: 'bold' }}>
                {tc.label}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {/* Toggle mode libre / choix */}
          <div style={{ display: 'flex', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border)', fontSize: '0.65rem' }}>
            <button onClick={() => { setDialogueMode('choices'); setPlayerChoices([]) }} style={{
              padding: '0.15rem 0.5rem', border: 'none', cursor: 'pointer',
              background: dialogueMode === 'choices' ? '#64b5f6' : 'transparent',
              color: dialogueMode === 'choices' ? '#0f0f14' : 'var(--muted)', fontWeight: dialogueMode === 'choices' ? 'bold' : 'normal',
            }}>🎯 Choix</button>
            <button onClick={() => { setDialogueMode('free'); setPlayerChoices([]) }} style={{
              padding: '0.15rem 0.5rem', border: 'none', cursor: 'pointer',
              background: dialogueMode === 'free' ? '#64b5f6' : 'transparent',
              color: dialogueMode === 'free' ? '#0f0f14' : 'var(--muted)', fontWeight: dialogueMode === 'free' ? 'bold' : 'normal',
            }}>✏ Libre</button>
          </div>
          {/* Indicateur mémoire */}
          {pastEncounters.length > 0 && (
            <button onClick={() => setShowMemory(m => !m)} style={{
              fontSize: '0.68rem', padding: '0.2rem 0.55rem', borderRadius: '20px',
              background: '#c9a84c22', color: '#c9a84c', border: '1px solid #c9a84c55', cursor: 'pointer',
            }}>
              🧠 {pastEncounters.length} souvenir{pastEncounters.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      {/* Panneau mémoire */}
      {showMemory && pastEncounters.length > 0 && (
        <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.75rem', background: '#c9a84c0a', border: '1px solid #c9a84c33', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', color: '#c9a84c', fontWeight: 'bold' }}>🧠 Mémoire du PNJ</span>
            <button onClick={resetMemory} style={{ fontSize: '0.62rem', color: '#c94c4c', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
              Effacer
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {pastEncounters.map((enc, i) => (
              <div key={i} style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                <span style={{ color: enc.outcome === 'success' ? '#4caf7d' : '#c94c4c', flexShrink: 0 }}>
                  {enc.outcome === 'success' ? '✓' : '✗'} §{enc.section_number}
                </span>
                <span style={{ fontStyle: 'italic' }}>{enc.memory_summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Style de parole */}
      {npc?.speech_style && (
        <p style={{ margin: '0 0 0.6rem', fontSize: '0.72rem', color: '#64b5f6', fontStyle: 'italic', borderLeft: '2px solid #64b5f644', paddingLeft: '0.5rem' }}>
          🎭 {npc.speech_style}
        </p>
      )}

      {/* Objectif */}
      {trial.dialogue_goal && (
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
          🎯 <strong>Objectif :</strong> {trial.dialogue_goal}
        </p>
      )}

      {/* Zone de chat */}
      {!opened ? (
        <button onClick={startDialogue} style={{
          width: '100%', padding: '0.55rem', borderRadius: '6px',
          background: '#64b5f622', color: '#64b5f6', border: '1px solid #64b5f655',
          cursor: 'pointer', fontSize: '0.82rem', fontWeight: 'bold',
        }}>
          {pastEncounters.length > 0 ? '💬 Reprendre la conversation' : '💬 Engager la conversation'}
        </button>
      ) : (
        <>
          <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.6rem', padding: '0.5rem', background: 'var(--surface)', borderRadius: '6px' }}>
            {history.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'player' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '80%', padding: '0.4rem 0.7rem',
                  borderRadius: msg.role === 'player' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  background: msg.role === 'player' ? '#64b5f633' : 'var(--surface-2)',
                  color: msg.role === 'player' ? '#64b5f6' : 'var(--foreground)',
                  fontSize: '0.8rem', lineHeight: 1.45,
                  border: msg.role === 'npc' ? '1px solid var(--border)' : 'none',
                }}>
                  {msg.role === 'npc' && <span style={{ fontWeight: 'bold', fontSize: '0.68rem', color: '#64b5f6', display: 'block', marginBottom: '0.15rem' }}>{npc?.name ?? '???'}</span>}
                  {msg.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '0.4rem 0.7rem', borderRadius: '12px 12px 12px 4px', background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--muted)' }}>…</div>
              </div>
            )}
          </div>

          {resolved ? (
            <div style={{ padding: '0.5rem', background: resolved === 'success' ? '#4caf7d11' : '#c94c4c11', borderRadius: '6px', fontSize: '0.8rem', color: resolved === 'success' ? '#4caf7d' : '#c94c4c', textAlign: 'center', marginBottom: '0.6rem' }}>
              {resolved === 'success' ? '✓ Conversation réussie — souvenir enregistré' : '✗ Conversation échouée — souvenir enregistré'}
            </div>
          ) : dialogueMode === 'choices' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {loading && playerChoices.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center', padding: '0.4rem' }}>…</div>
              ) : playerChoices.length > 0 ? (
                playerChoices.map((choice, i) => (
                  <button key={i} onClick={() => sendMessage(choice)} disabled={loading} style={{
                    textAlign: 'left', padding: '0.5rem 0.75rem', borderRadius: '8px',
                    background: 'var(--surface-2)', border: '1px solid #64b5f633',
                    color: 'var(--foreground)', fontSize: '0.82rem', cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.5 : 1, lineHeight: 1.35,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!loading) (e.target as HTMLButtonElement).style.background = '#64b5f611' }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'var(--surface-2)' }}
                  >
                    <span style={{ color: '#64b5f6', fontWeight: 'bold', marginRight: '0.4rem' }}>{i + 1}.</span>{choice}
                  </button>
                ))
              ) : (
                <button onClick={() => generatePlayerChoices(history)} style={{
                  padding: '0.4rem', borderRadius: '6px', border: '1px dashed #64b5f644',
                  background: 'transparent', color: '#64b5f6', fontSize: '0.78rem', cursor: 'pointer',
                }}>
                  ↻ Générer des options de réponse
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                placeholder="Votre réponse..."
                disabled={loading}
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.45rem 0.7rem', color: 'var(--foreground)', fontSize: '0.82rem', outline: 'none' }}
              />
              <button onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{
                padding: '0.45rem 0.9rem', borderRadius: '6px', border: 'none',
                background: input.trim() && !loading ? '#64b5f6' : 'var(--surface-2)',
                color: input.trim() && !loading ? '#0f0f14' : 'var(--muted)',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '0.82rem',
              }}>
                Envoyer
              </button>
            </div>
          )}
        </>
      )}

      {/* Redirections */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
        {successNum != null && (
          <button onClick={() => onNavigate(successNum)} style={{
            fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: '5px',
            background: suggestedChoice === 0 || resolved === 'success' ? '#4caf7d33' : '#4caf7d22',
            color: '#4caf7d', border: `1px solid ${suggestedChoice === 0 || resolved === 'success' ? '#4caf7d' : '#4caf7d55'}`,
            cursor: 'pointer', fontWeight: suggestedChoice === 0 || resolved === 'success' ? 'bold' : 'normal',
          }}>✓ Accord → §{successNum}{suggestedChoice === 0 ? ' ✦' : ''}</button>
        )}
        {failureNum != null && (
          <button onClick={() => onNavigate(failureNum)} style={{
            fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: '5px',
            background: suggestedChoice === 1 || resolved === 'failure' ? '#c94c4c33' : '#c94c4c22',
            color: '#c94c4c', border: `1px solid ${suggestedChoice === 1 || resolved === 'failure' ? '#c94c4c' : '#c94c4c55'}`,
            cursor: 'pointer', fontWeight: suggestedChoice === 1 || resolved === 'failure' ? 'bold' : 'normal',
          }}>✗ Refus → §{failureNum}{suggestedChoice === 1 ? ' ✦' : ''}</button>
        )}
      </div>
    </div>
  )
}

// ── Lecteur audio flottant ────────────────────────────────────────────────────

function AudioPlayer({ trackUrl, trackLabel }: { trackUrl: string | null; trackLabel: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.4)
  const [muted, setMuted] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const prevUrl = useRef<string | null>(null)

  // Initialiser l'élément audio une seule fois
  useEffect(() => {
    const audio = new Audio()
    audio.loop = true
    audio.volume = volume
    audioRef.current = audio
    return () => { audio.pause(); audio.src = '' }
  }, [])

  // Changer de piste avec fade out/in
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !enabled) return
    if (!trackUrl) { audio.pause(); setPlaying(false); return }
    if (trackUrl === prevUrl.current) return
    prevUrl.current = trackUrl

    // Fade out puis change de piste
    const fadeOut = setInterval(() => {
      if (audio.volume > 0.05) { audio.volume = Math.max(0, audio.volume - 0.05) }
      else {
        clearInterval(fadeOut)
        audio.pause()
        audio.src = trackUrl
        audio.volume = 0
        audio.play().catch(() => {})
        setPlaying(true)
        // Fade in
        const fadeIn = setInterval(() => {
          if (audio.volume < volume - 0.04) { audio.volume = Math.min(volume, audio.volume + 0.03) }
          else { audio.volume = volume; clearInterval(fadeIn) }
        }, 50)
      }
    }, 40)
    return () => clearInterval(fadeOut)
  }, [trackUrl, enabled])

  // Volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume
  }, [volume, muted])

  function activate() {
    setEnabled(true)
    if (trackUrl && audioRef.current) {
      audioRef.current.src = trackUrl
      prevUrl.current = trackUrl
      audioRef.current.volume = volume
      audioRef.current.play().then(() => setPlaying(true)).catch(() => {})
    }
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) { audio.pause(); setPlaying(false) }
    else { audio.play().then(() => setPlaying(true)).catch(() => {}) }
  }

  if (!enabled) {
    return (
      <button onClick={activate} style={{
        position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 100,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '30px', padding: '0.5rem 1rem',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        color: 'var(--muted)', fontSize: '0.8rem', cursor: 'pointer',
        boxShadow: '0 4px 16px #0006',
      }}>
        🔇 Activer la musique
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 100,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: '14px', padding: '0.6rem 1rem',
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      boxShadow: '0 4px 20px #0008', minWidth: '260px',
    }}>
      {/* Play/Pause */}
      <button onClick={togglePlay} style={{
        background: 'var(--accent)', border: 'none', borderRadius: '50%',
        width: '32px', height: '32px', cursor: 'pointer', fontSize: '0.9rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {playing ? '⏸' : '▶'}
      </button>

      {/* Info piste */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {playing ? '♪ En lecture' : '⏹ En pause'}
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--foreground)', fontWeight: 'bold', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {trackLabel || '—'}
        </div>
      </div>

      {/* Volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <button onClick={() => setMuted(m => !m)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--muted)' }}>
          {muted ? '🔇' : '🔊'}
        </button>
        <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
          onChange={e => { setVolume(parseFloat(e.target.value)); setMuted(false) }}
          style={{ width: '60px', accentColor: 'var(--accent)' }}
        />
      </div>
    </div>
  )
}

// ── Plan graphique ────────────────────────────────────────────────────────────

const NODE_W = 148
const NODE_H = 72
const COL_GAP = 190
const ROW_GAP = 110

function computeReachable(sections: Section[], choices: Choice[], endingType: 'victory' | 'death'): Set<string> {
  // BFS arrière : depuis les fins, remonter vers les sections qui y mènent
  const endings = new Set(sections.filter(s => s.is_ending && s.ending_type === endingType).map(s => s.id))
  const reachable = new Set(endings)
  // index inverse : target_section_id → section_ids qui pointent vers elle
  const inEdges = new Map<string, string[]>()
  for (const c of choices) {
    if (!c.target_section_id) continue
    if (!inEdges.has(c.target_section_id)) inEdges.set(c.target_section_id, [])
    inEdges.get(c.target_section_id)!.push(c.section_id)
  }
  // Aussi via les trials (success/failure)
  for (const s of sections) {
    if (s.trial?.success_section_id) {
      if (!inEdges.has(s.trial.success_section_id)) inEdges.set(s.trial.success_section_id, [])
      inEdges.get(s.trial.success_section_id)!.push(s.id)
    }
    if (s.trial?.failure_section_id) {
      if (!inEdges.has(s.trial.failure_section_id)) inEdges.set(s.trial.failure_section_id, [])
      inEdges.get(s.trial.failure_section_id)!.push(s.id)
    }
  }
  const queue = [...endings]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const src of (inEdges.get(current) ?? [])) {
      if (!reachable.has(src)) { reachable.add(src); queue.push(src) }
    }
  }
  return reachable
}

function GraphView({ sections, choices, activeFilters, highlightNumber, onHighlightDone, onNavigate }: {
  sections: Section[]
  choices: Choice[]
  activeFilters: Set<string>
  highlightNumber?: number | null
  onHighlightDone?: () => void
  onNavigate: (n: number) => void
}) {
  const [pathFilter, setPathFilter] = useState<'victory' | 'death' | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [zoom, setZoom] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [layoutMode, setLayoutMode] = useState<'tree' | 'grid'>('tree')
  const containerRef = useRef<HTMLDivElement>(null)
  const isPanning  = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })

  // ── Calcul du layout ──────────────────────────────────────────────────────
  const TREE_GAP_X = 22
  const TREE_GAP_Y = 80

  const { positions, canvasW, canvasH } = useMemo(() => {
    if (layoutMode === 'grid') {
      const COLS = Math.max(4, Math.ceil(Math.sqrt(sections.length)))
      const rows = Math.ceil(sections.length / COLS)
      const pos = new Map<string, { x: number; y: number; cx: number; cy: number }>()
      sections.forEach((s, i) => {
        const col = i % COLS, row = Math.floor(i / COLS)
        const x = col * COL_GAP + 16, y = row * ROW_GAP + 16
        pos.set(s.id, { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 })
      })
      return { positions: pos, canvasW: COLS * COL_GAP + NODE_W + 16, canvasH: rows * ROW_GAP + NODE_H + 16 }
    }

    // ── Tree layout (BFS depuis §1) ─────────────────────────────────────────
    if (sections.length === 0) return { positions: new Map(), canvasW: 800, canvasH: 600 }
    const sectionIds = new Set(sections.map(s => s.id))
    const childIds = new Map<string, string[]>()
    const addEdge = (from: string, to: string) => {
      if (!sectionIds.has(from) || !sectionIds.has(to)) return
      if (!childIds.has(from)) childIds.set(from, [])
      if (!childIds.get(from)!.includes(to)) childIds.get(from)!.push(to)
    }
    for (const c of choices) { if (c.target_section_id) addEdge(c.section_id, c.target_section_id) }
    for (const s of sections) {
      if (s.trial?.success_section_id) addEdge(s.id, s.trial.success_section_id)
      if (s.trial?.failure_section_id) addEdge(s.id, s.trial.failure_section_id)
    }

    // BFS
    const root = sections.find(s => s.number === 1) || sections[0]
    const depth = new Map<string, number>()
    const queue: string[] = [root.id]
    depth.set(root.id, 0)
    while (queue.length) {
      const id = queue.shift()!
      const d = depth.get(id)!
      for (const child of childIds.get(id) ?? []) {
        if (!depth.has(child)) { depth.set(child, d + 1); queue.push(child) }
      }
    }
    for (const s of sections) { if (!depth.has(s.id)) depth.set(s.id, 0) }

    // Grouper par niveau
    const levels = new Map<number, Section[]>()
    for (const s of sections) {
      const d = depth.get(s.id)!
      if (!levels.has(d)) levels.set(d, [])
      levels.get(d)!.push(s)
    }
    for (const nodes of levels.values()) nodes.sort((a, b) => a.number - b.number)

    // Dimensions canvas
    const maxLevel = Math.max(...levels.keys())
    const maxNodesInLevel = Math.max(...[...levels.values()].map(v => v.length))
    const cW = Math.max(maxNodesInLevel * (NODE_W + TREE_GAP_X) + TREE_GAP_X, NODE_W + TREE_GAP_X * 2)
    const cH = (maxLevel + 1) * (NODE_H + TREE_GAP_Y) + TREE_GAP_Y

    // Positionner les nœuds (chaque niveau centré)
    const pos = new Map<string, { x: number; y: number; cx: number; cy: number }>()
    for (const [level, nodes] of levels) {
      const levelWidth = nodes.length * (NODE_W + TREE_GAP_X) - TREE_GAP_X
      const startX = (cW - levelWidth) / 2
      for (let i = 0; i < nodes.length; i++) {
        const x = startX + i * (NODE_W + TREE_GAP_X)
        const y = TREE_GAP_Y / 2 + level * (NODE_H + TREE_GAP_Y)
        pos.set(nodes[i].id, { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 })
      }
    }
    return { positions: pos, canvasW: cW, canvasH: cH }
  }, [sections, choices, layoutMode])

  function fitToScreen() {
    const c = containerRef.current
    if (!c) return
    const { width, height } = c.getBoundingClientRect()
    if (width < 10 || height < 10) return   // container pas encore rendu
    const newZoom = Math.min(Math.max((width - 80) / canvasW, 0.1), Math.max((height - 80) / canvasH, 0.1), 1.5)
    setZoom(newZoom)
    setPan({ x: (width - canvasW * newZoom) / 2, y: (height - canvasH * newZoom) / 2 })
  }

  function centerOnSection(sectionId: string) {
    const pos = positions.get(sectionId)
    const c = containerRef.current
    if (!pos || !c) return
    const { width, height } = c.getBoundingClientRect()
    setPan({ x: width / 2 - pos.cx * zoom, y: height / 2 - pos.cy * zoom })
  }

  // Surbrillance du nœud — on ne déplace plus la vue automatiquement (fitToScreen suffit)
  // L'utilisateur peut centrer manuellement via le bouton "✦ §N" dans la barre
  useEffect(() => {
    if (!highlightNumber) return
    const t = setTimeout(() => onHighlightDone?.(), 3500)
    return () => clearTimeout(t)
  }, [highlightNumber])

  // Fit initial
  useEffect(() => { setTimeout(fitToScreen, 50) }, [sections.length])

  const sectionById = new Map(sections.map(s => [s.id, s]))

  const reachableVictory = computeReachable(sections, choices, 'victory')
  const reachableDeath   = computeReachable(sections, choices, 'death')

  const containerStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--background)', display: 'flex', flexDirection: 'column', padding: '0.75rem' }
    : {}

  return (
    <div style={containerStyle}>
      {/* Filtres chemins */}
      <style>{`
        @keyframes plan-pulse {
          0%   { box-shadow: 0 0 0 0px var(--pulse-color, #fff4), 0 0 16px 4px var(--pulse-color, #fff2); }
          50%  { box-shadow: 0 0 0 8px var(--pulse-color, #fff0), 0 0 28px 8px var(--pulse-color, #fff3); }
          100% { box-shadow: 0 0 0 0px var(--pulse-color, #fff4), 0 0 16px 4px var(--pulse-color, #fff2); }
        }
        .plan-node-highlighted {
          animation: plan-pulse 0.9s ease-in-out infinite;
          z-index: 10;
        }
      `}</style>

      {/* Barre d'outils */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chemins</span>
        {([
          { key: 'victory', label: `🏆 Victoire (${reachableVictory.size})`, color: '#4caf7d' },
          { key: 'death',   label: `💀 Mort (${reachableDeath.size})`,        color: '#c94c4c' },
        ] as const).map(f => (
          <button key={f.key} onClick={() => setPathFilter(p => p === f.key ? null : f.key)} style={{
            fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: '20px',
            border: `1.5px solid ${pathFilter === f.key ? f.color : f.color + '55'}`,
            background: pathFilter === f.key ? f.color + '33' : f.color + '11',
            color: f.color, cursor: 'pointer', fontWeight: pathFilter === f.key ? 'bold' : 'normal',
            transition: 'all 0.15s',
          }}>{f.label}</button>
        ))}
        {pathFilter && (
          <button onClick={() => setPathFilter(null)} style={{ fontSize: '0.68rem', padding: '0.2rem 0.55rem', borderRadius: '20px', background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            ✕ Tout afficher
          </button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          {/* Bouton centrer sur la section surlignée */}
          {highlightNumber && (
            <button
              onClick={() => { const s = sections.find(s => s.number === highlightNumber); if (s) centerOnSection(s.id) }}
              title={`Centrer sur §${highlightNumber}`}
              style={{ background: 'var(--accent)22', border: '1px solid var(--accent)66', borderRadius: '4px', color: 'var(--accent)', cursor: 'pointer', padding: '0.2rem 0.6rem', fontSize: '0.75rem', fontWeight: 'bold' }}
            >✦ §{highlightNumber}</button>
          )}
          {/* Recherche par numéro de section */}
          <form onSubmit={e => {
            e.preventDefault()
            const n = parseInt(searchInput)
            if (isNaN(n)) return
            const s = sections.find(s => s.number === n)
            if (s) centerOnSection(s.id)
          }} style={{ display: 'flex', gap: '0.2rem' }}>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="§ ..."
              style={{ width: '54px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--foreground)', padding: '0.2rem 0.4rem', fontSize: '0.75rem', outline: 'none' }}
            />
            <button type="submit" title="Aller à la section" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>↵</button>
          </form>
          <button onClick={() => setZoom(z => Math.min(z * 1.2, 3))} title="Zoom +" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--foreground)', cursor: 'pointer', padding: '0.2rem 0.55rem', fontSize: '0.8rem' }}>+</button>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', minWidth: '38px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(z / 1.2, 0.15))} title="Zoom −" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--foreground)', cursor: 'pointer', padding: '0.2rem 0.55rem', fontSize: '0.8rem' }}>−</button>
          <button onClick={() => { setLayoutMode(m => m === 'tree' ? 'grid' : 'tree'); setTimeout(fitToScreen, 60) }} title="Changer la disposition" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}>
            {layoutMode === 'tree' ? '▦ Grille' : '⇂ Arbre'}
          </button>
          <button onClick={fitToScreen} title="Ajuster à la fenêtre" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}>⊡ Tout afficher</button>
          <button onClick={() => { setFullscreen(f => !f); setTimeout(fitToScreen, 60) }} style={{ background: fullscreen ? 'var(--accent)22' : 'var(--surface-2)', border: `1px solid ${fullscreen ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '4px', color: fullscreen ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}>
            {fullscreen ? '✕ Réduire' : '⛶ Plein écran'}
          </button>
        </div>
      </div>

      {/* Canvas pan+zoom */}
      <div
        ref={containerRef}
        onPointerDown={e => {
          if (e.button !== 0) return
          isPanning.current = true
          lastPointer.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={e => {
          if (!isPanning.current) return
          const dx = e.clientX - lastPointer.current.x
          const dy = e.clientY - lastPointer.current.y
          lastPointer.current = { x: e.clientX, y: e.clientY }
          if (Math.abs(dx) + Math.abs(dy) < 2) return
          setPan(p => ({ x: p.x + dx, y: p.y + dy }))
        }}
        onPointerUp={() => { isPanning.current = false }}
        onPointerLeave={() => { isPanning.current = false }}
        onWheel={e => {
          e.preventDefault()
          const c = containerRef.current!
          const rect = c.getBoundingClientRect()
          const mx = e.clientX - rect.left, my = e.clientY - rect.top
          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
          setZoom(z => {
            const nz = Math.min(3, Math.max(0.15, z * factor))
            const sf = nz / z
            setPan(p => ({ x: mx - sf * (mx - p.x), y: my - sf * (my - p.y) }))
            return nz
          })
        }}
        style={{
          border: '1px solid var(--border)', borderRadius: '10px',
          background: 'var(--surface)', overflow: 'hidden',
          flex: fullscreen ? '1' : undefined,
          height: fullscreen ? undefined : 'calc(100vh - 320px)',
          minHeight: '400px',
          cursor: 'grab', position: 'relative',
          userSelect: 'none',
        }}
      >
        <div style={{ position: 'absolute', transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: canvasW, height: canvasH }}>
        <svg style={{ position: 'absolute', inset: 0, width: canvasW, height: canvasH, pointerEvents: 'none' }}>
          <defs>
            {[
              { id: 'arr',   color: '#c9a84c99' },
              { id: 'arr-v', color: '#4caf7d99' },
              { id: 'arr-d', color: '#c94c4c99' },
            ].map(({ id, color }) => (
              <marker key={id} id={id} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0,0 L0,7 L7,3.5 z" fill={color} />
              </marker>
            ))}
          </defs>
          {choices.map(choice => {
            if (!choice.target_section_id) return null
            const from = positions.get(choice.section_id)
            const to = positions.get(choice.target_section_id)
            if (!from || !to) return null
            const target = sectionById.get(choice.target_section_id)
            const source = sectionById.get(choice.section_id)
            const isVictory = target?.ending_type === 'victory'
            const isDeath = target?.ending_type === 'death'
            const reachable = pathFilter === 'victory' ? reachableVictory : reachableDeath
            const arrowDimmed = pathFilter !== null && (!reachable.has(choice.section_id) || !reachable.has(choice.target_section_id))
            const srcTypeDimmed = activeFilters.size > 0 && source && !activeFilters.has(getSectionType(source).label)
            const tgtTypeDimmed = activeFilters.size > 0 && target && !activeFilters.has(getSectionType(target).label)
            const arrowFaded = arrowDimmed || srcTypeDimmed || tgtTypeDimmed
            const color = arrowFaded ? '#ffffff11' : isVictory ? '#4caf7d88' : isDeath ? '#c94c4c88' : '#c9a84c66'
            const markerId = isVictory ? 'arr-v' : isDeath ? 'arr-d' : 'arr'
            let d: string
            if (layoutMode === 'tree') {
              const goesDown = to.y > from.y + NODE_H / 2
              if (goesDown) {
                // Flèche vers le bas : bas du parent → haut de l'enfant
                const x1 = from.cx, y1 = from.y + NODE_H
                const x2 = to.cx,   y2 = to.y
                const cp = Math.max(20, (y2 - y1) * 0.5)
                d = `M ${x1} ${y1} C ${x1} ${y1 + cp}, ${x2} ${y2 - cp}, ${x2} ${y2}`
              } else {
                // Backedge (remonte ou même niveau) : arc sur le côté
                const x1 = from.x, y1 = from.cy
                const x2 = to.x + NODE_W, y2 = to.cy
                const sag = 40 + Math.abs(y2 - y1) * 0.3
                d = `M ${x1} ${y1} C ${x1 - sag} ${y1}, ${x2 + sag} ${y2}, ${x2} ${y2}`
              }
            } else {
              const goRight = to.cx > from.cx + COL_GAP * 0.3
              const goLeft  = to.cx < from.cx - COL_GAP * 0.3
              if (goRight) {
                const x1 = from.x + NODE_W, y1 = from.cy, x2 = to.x, y2 = to.cy
                const mx = (x1 + x2) / 2
                d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
              } else if (goLeft) {
                const x1 = from.cx, y1 = from.y + NODE_H, x2 = to.cx, y2 = to.y + NODE_H
                const sag = Math.min(60 + Math.abs(to.cx - from.cx) * 0.25, 120)
                d = `M ${x1} ${y1} C ${x1} ${y1 + sag}, ${x2} ${y2 + sag}, ${x2} ${y2}`
              } else {
                const x1 = from.x + NODE_W, y1 = from.cy, x2 = to.x + NODE_W + 18, y2 = to.cy
                const mx = Math.max(x1, x2) + 30
                d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
              }
            }
            return <path key={choice.id} d={d} fill="none" stroke={color} strokeWidth="1.5" markerEnd={`url(#${markerId})`} />
          })}
        </svg>
        {sections.map(section => {
          const pos = positions.get(section.id)
          if (!pos) return null
          const sc = SECTION_STATUS_CONFIG[section.status ?? 'draft']
          const t = getSectionType(section)
          const typeDimmed = activeFilters.size > 0 && !activeFilters.has(t.label)
          const pathDimmed = pathFilter !== null && !(pathFilter === 'victory' ? reachableVictory : reachableDeath).has(section.id)
          const dimmed = typeDimmed || pathDimmed
          const isHighlighted = highlightNumber === section.number
          return (
            <div
              key={section.id}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => { if (!dimmed) onNavigate(section.number) }}
              title={`§${section.number} — cliquer pour lire la section`}
              className={isHighlighted ? 'plan-node-highlighted' : undefined}
              style={{
                position: 'absolute', left: pos.x, top: pos.y, width: NODE_W, height: NODE_H,
                background: isHighlighted ? t.color + '33' : 'var(--surface-2)',
                border: `${isHighlighted ? '3px' : '1.5px'} solid ${dimmed ? 'var(--border)' : t.color + (isHighlighted ? '' : '99')}`,
                outline: isHighlighted ? `3px solid ${t.color}` : 'none',
                outlineOffset: '4px',
                borderRadius: '7px', padding: '0.4rem 0.55rem', overflow: 'hidden', boxSizing: 'border-box',
                opacity: dimmed ? 0.15 : 1, transition: 'opacity 0.2s',
                cursor: dimmed ? 'default' : 'pointer',
                ['--pulse-color' as any]: t.color + '99',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ fontSize: '0.8rem' }}>{t.icon}</span>
                  <span style={{ fontWeight: 'bold', color: 'var(--accent)', fontSize: '0.72rem' }}>§{section.number}</span>
                </div>
                <span style={{ color: sc.color, fontSize: '0.6rem' }}>{sc.label}</span>
              </div>
              <p style={{ margin: 0, color: section.summary ? 'var(--foreground)' : 'var(--muted)', fontSize: '0.6rem', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, fontStyle: section.summary ? 'italic' : 'normal' }}>
                {section.summary ?? section.content.slice(0, 80)}
              </p>
            </div>
          )
        })}
        </div>{/* fin canvas transformé */}
        {/* Aide navigation */}
        <div style={{ position: 'absolute', bottom: '0.6rem', left: '0.75rem', fontSize: '0.62rem', color: 'var(--muted)', opacity: 0.5, pointerEvents: 'none' }}>
          🖱 Glisser pour déplacer · Molette pour zoomer · Clic sur un nœud pour ouvrir la section
        </div>
      </div>{/* fin container pan+zoom */}
    </div>
  )
}

// ── Audio Tag Palette (ElevenLabs v3 speech direction) ────────────────────────

const AUDIO_TAG_CATEGORIES = [
  { label: 'Émotions',     color: '#e879f9', tags: ['excité', 'fatigué', 'nerveux', 'frustré', 'triste', 'calme', 'en colère'] },
  { label: 'Réactions',    color: '#fb923c', tags: ['soupir', 'rire', 'avale', 'halète', 'chuchote'] },
  { label: 'Rythme',       color: '#60a5fa', tags: ['pause', 'pause courte', 'pause longue', 'hésite', 'bégaye', 'pressé'] },
  { label: 'Ton',          color: '#4ade80', tags: ['joyeusement', 'platement', 'impassible', 'enjoué', 'sarcastiquement', 'dramatique', 'pleurnichard', 'résigné', 'factuel'] },
  { label: 'Volume',       color: '#facc15', tags: ['chuchotant', 'criant', 'doucement', 'fort'] },
  { label: 'Accentuation', color: '#f87171', tags: ['accentué', 'atténué', 'accent sur le mot suivant'] },
  { label: 'Accents',      color: '#a78bfa', tags: ['accent britannique', 'accent australien', 'accent du sud des États-Unis'] },
  { label: 'Rôles',        color: '#34d399', tags: ['voix de pirate', 'voix de scientifique maléfique', 'ton enfantin'] },
]

function AudioTagPalette({ onInsert }: { onInsert: (tag: string) => void }) {
  const [vals, setVals] = React.useState<Record<string, string>>({})
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.3rem' }}>
      {AUDIO_TAG_CATEGORIES.map(cat => (
        <select key={cat.label} value={vals[cat.label] ?? ''}
          onChange={e => {
            const tag = e.target.value
            if (tag) { onInsert(tag); setVals(v => ({ ...v, [cat.label]: '' })) }
          }}
          style={{ fontSize: '0.67rem', padding: '0.2rem 0.3rem', borderRadius: '5px', border: `1px solid ${cat.color}55`, background: `${cat.color}12`, color: cat.color, cursor: 'pointer', maxWidth: '120px' }}>
          <option value="">{cat.label}</option>
          {cat.tags.map(tag => <option key={tag} value={tag}>[{tag}]</option>)}
        </select>
      ))}
    </div>
  )
}

// ── Onglet PNJ ────────────────────────────────────────────────────────────────

type VoiceForm = { voice_id: string; voice_settings: { stability: number; style: number; speed: number; similarity_boost: number }; voice_prompt: string }

function VoicePanel({ form, setForm, voices, voicesLoaded, playVoicePreview }: {
  form: VoiceForm
  setForm: (fn: (f: any) => any) => void
  voices: { voice_id: string; name: string; labels: Record<string, string>; preview_url: string | null }[]
  voicesLoaded: boolean
  playVoicePreview: (voiceId: string) => void
}) {
  const vs = form.voice_settings
  return (
    <div style={{ marginBottom: '1.25rem', padding: '1rem', background: '#4ec9b00a', border: '1px solid #4ec9b033', borderRadius: '8px' }}>
      <label style={{ fontSize: '0.72rem', color: '#4ec9b0', fontWeight: 'bold', display: 'block', marginBottom: '0.75rem' }}>🎙 Voix ElevenLabs</label>

      {/* Sélecteur */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <select value={form.voice_id} onChange={e => setForm(f => ({ ...f, voice_id: e.target.value }))} style={{ ...inputStyle, flex: 1 }}>
          <option value="">— Aucune voix assignée</option>
          {voices.map((v, i) => <option key={v.voice_id ?? i} value={v.voice_id}>{v.name}{v.labels?.gender ? ` (${v.labels.gender})` : ''}</option>)}
        </select>
        {form.voice_id && voices.find(v => v.voice_id === form.voice_id)?.preview_url && (
          <button onClick={() => playVoicePreview(form.voice_id)} title="Prévisualiser la voix" style={{ background: 'none', border: '1px solid #4ec9b044', borderRadius: '4px', color: '#4ec9b0', cursor: 'pointer', padding: '0.3rem 0.7rem', fontSize: '0.85rem', flexShrink: 0 }}>▶ Aperçu</button>
        )}
        {!voicesLoaded && <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Chargement…</span>}
      </div>

      {form.voice_id && (<>
        {/* Sliders */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.6rem 1.25rem', marginBottom: '0.75rem' }}>
          {([
            { key: 'stability', label: 'Stabilité', hint: '0 = émotionnel · 1 = monotone' },
            { key: 'style', label: 'Style / Expression', hint: '0 = neutre · 1 = très expressif' },
            { key: 'speed', label: 'Vitesse', min: 0.7, max: 1.2, step: 0.05, hint: '0.7 lent → 1.2 rapide' },
            { key: 'similarity_boost', label: 'Fidélité à la voix', hint: '0 = libre · 1 = proche original' },
          ] as { key: keyof typeof vs; label: string; hint: string; min?: number; max?: number; step?: number }[]).map(({ key, label, hint, min = 0, max = 1, step = 0.05 }) => (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>
                <span>{label}</span>
                <span style={{ color: '#4ec9b0', fontWeight: 'bold' }}>{vs[key].toFixed(2)}</span>
              </div>
              <input
                type="range" min={min} max={max} step={step}
                value={vs[key]}
                onChange={e => setForm((f: any) => ({ ...f, voice_settings: { ...f.voice_settings, [key]: parseFloat(e.target.value) } }))}
                style={{ width: '100%', accentColor: '#4ec9b0' }}
              />
              <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.1rem' }}>{hint}</div>
            </div>
          ))}
        </div>

        {/* Delivery prompt */}
        <div>
          <label style={{ fontSize: '0.68rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>
            Directive de jeu d'acteur <span style={{ color: '#4ec9b0' }}>(optionnel)</span>
          </label>
          <input
            value={form.voice_prompt}
            onChange={e => setForm((f: any) => ({ ...f, voice_prompt: e.target.value }))}
            style={{ ...inputStyle, fontSize: '0.78rem' }}
            placeholder="Ex: tense, slightly breathless — grave, menaçant — whispering"
          />
          <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
            Préfixe injecté avant chaque réplique. Peut être surchargé ligne par ligne.
          </div>
        </div>
      </>)}
    </div>
  )
}

// ── Fiche personnage — constantes et helpers partagés ──────────────────────────

const FICHE_DEFAULT_SETTINGS = {
  width: 180, bottom: 28, left: 0, rotation: -8,
  ill_height: 110, ill_gap: 4, bg_opacity: 0.4,
  tagline: '', tagline_font: 'Permanent Marker', tagline_size: 13, tagline_color: '#ede9df',
  tagline_offset_x: 0, tagline_offset_y: 0,
  text_overlays: [] as any[],
  portrait_effect: 'none' as string,
  ill_effect: 'none' as string,
  portrait_vignette: 0,
  portrait_box_shadow: 'none' as string,
  ill_box_shadow: 'none' as string,
  portrait_elev: 0,
  portrait_shadow_x: 6,
  portrait_shadow_y: 10,
  portrait_shadow_opacity: 0,
  music_url: '' as string,
  stats_label_size: 13,
  stats_label_color: '#d4a84c',
  stats_label_italic: true,
  stats_label_bold: true,
  stats_value_size: 27,
  stats_value_color: '#ede9df',
  stats_offset_y: 0,
  stats_offset_x: 0,
  dice_text: 'Lance les dés (3 essais)',
  dice_size: 12,
  dice_color: '#ede9df',
  dice_offset_y: 0,
  dice_bg_color: 'transparent' as string,
  dice_border_color: '' as string,
  cta_text: "COMMENCER L'AVENTURE",
  cta_color: '#d4a84c',
  cta_text_color: '#0d0d0d',
  cta_offset_y: 0,
  cta_font_size: 9,
  card_rotate_x: 0,
  card_rotate_y: 0,
  card_perspective: 800,
  // Layout & dimensions
  layout: 'horizontal' as 'horizontal' | 'vertical',
  portrait_width_pct: 40,    // % largeur colonne portrait (layout horizontal)
  portrait_height_pct: 52,   // % hauteur section portrait (layout vertical)
}

type FicheAllSettings = typeof FICHE_DEFAULT_SETTINGS & { tablet?: Partial<typeof FICHE_DEFAULT_SETTINGS> }

const FICHE_STATS_DISPLAY = [
  { key: 'force',        label: 'Force' },
  { key: 'agilite',      label: 'Agilité' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'chance',       label: 'Chance' },
  { key: 'endurance',    label: 'Endurance' },
]

function ficheEffectToFilter(effect: string | undefined): string {
  switch (effect) {
    case 'shadow':   return 'drop-shadow(4px 6px 14px rgba(0,0,0,0.95))'
    case 'neon':     return 'drop-shadow(0 0 10px rgba(212,168,76,0.9)) drop-shadow(0 0 22px rgba(212,168,76,0.45))'
    case 'dramatic': return 'contrast(1.18) saturate(1.25) drop-shadow(3px 4px 10px rgba(0,0,0,0.9))'
    case 'mist':     return 'drop-shadow(2px 3px 8px rgba(120,160,220,0.55)) brightness(1.06)'
    case 'blood':    return 'drop-shadow(0 0 10px rgba(220,40,40,0.75)) drop-shadow(0 0 22px rgba(180,0,0,0.4))'
    default:         return 'none'
  }
}

function ficheContainerShadow(preset: string | undefined): string {
  switch (preset) {
    case 'shadow':      return '0 8px 32px rgba(0,0,0,0.9), 0 2px 8px rgba(0,0,0,0.7)'
    case 'glow_gold':   return '0 0 18px rgba(212,168,76,0.65), 0 0 40px rgba(212,168,76,0.25)'
    case 'glow_red':    return '0 0 18px rgba(220,40,40,0.65), 0 0 40px rgba(180,0,0,0.25)'
    case 'glow_blue':   return '0 0 18px rgba(80,140,255,0.55), 0 0 40px rgba(40,80,220,0.25)'
    case 'border_gold': return 'inset 0 0 0 2px rgba(212,168,76,0.7), 0 4px 20px rgba(0,0,0,0.8)'
    default:            return 'none'
  }
}

function ficheOverlayStartTimes(overlays: any[]): number[] {
  let t = 0
  return overlays.map(ov => {
    const start = t
    if (ov.animation === 'typing')     t += ov.text.length * ((ov.typing_speed ?? 70) / 1000) + 0.5
    else if (ov.animation === 'fade')  t += 1.7
    else                               t += 0.5
    return start
  })
}

function FicheCardView({ protagonist, settings, device = 'phone' }: { protagonist: Npc; settings: FicheAllSettings; device?: 'phone' | 'tablet' }) {
  const [diceRolled, setDiceRolled] = React.useState(false)
  const illustrations = protagonist.character_illustrations ?? []
  const phoneS = { ...FICHE_DEFAULT_SETTINGS, ...settings }
  const s = device === 'tablet' ? { ...phoneS, ...(settings.tablet ?? {}) } : phoneS
  const isVertical = (s.layout ?? 'horizontal') === 'vertical'
  const portraitWidthPct  = s.portrait_width_pct  ?? 40
  const portraitHeightPct = s.portrait_height_pct ?? 52

  const insetShadow = (() => {
    const elev = s.portrait_elev ?? 0
    const op   = (s.portrait_shadow_opacity ?? 0) / 100
    if (elev === 0 && op === 0) return 'none'
    const blur = elev * 3 + 8
    if (isVertical) return `inset 0 ${blur}px ${blur}px -${Math.round(blur/2)}px rgba(0,0,0,${(0.4 + op * 0.5).toFixed(2)})`
    return `inset ${blur}px 0 ${blur}px -${Math.round(blur/2)}px rgba(0,0,0,${(0.4 + op * 0.5).toFixed(2)})`
  })()

  return (
    <div style={{ flex: 1, perspective: `${s.card_perspective ?? 800}px`, display: 'flex' }}>
      <div style={{
        position: 'relative', borderRadius: '12px', overflow: 'hidden',
        background: '#0a0a0c', border: '1px solid #2a2a30',
        flex: 1, display: 'flex', flexDirection: isVertical ? 'column' : 'row',
        transform: `rotateX(${s.card_rotate_x ?? 0}deg) rotateY(${s.card_rotate_y ?? 0}deg)`,
        transformStyle: 'preserve-3d',
        transition: 'transform 0.1s ease',
        boxShadow: (() => {
          const rx = s.card_rotate_x ?? 0; const ry = s.card_rotate_y ?? 0
          const depth = Math.sqrt(rx * rx + ry * ry)
          if (depth < 1) return '0 2px 20px rgba(0,0,0,0.5)'
          return `${ry*1.5}px ${-rx*1.5}px ${20+depth*3}px ${depth*0.5}px rgba(0,0,0,0.7)`
        })(),
      }}>
        <style>{`@keyframes overlay-fade{from{opacity:0}to{opacity:1}}@keyframes overlay-char{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@keyframes overlay-show{from{opacity:0}to{opacity:1}}`}</style>
        <div style={{ position: 'absolute', inset: 0, background: '#0a0a0c', zIndex: 0 }} />

        {/* Portrait section */}
        <div style={{
          position: 'relative', zIndex: 2, overflow: 'hidden', flexShrink: 0,
          ...(isVertical
            ? { width: '100%', height: `${portraitHeightPct}%` }
            : { width: `${portraitWidthPct}%`, alignSelf: 'stretch' }
          ),
        }}>
          {(protagonist.portrait_url ?? protagonist.image_url)
            ? <img src={protagonist.portrait_url ?? protagonist.image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', filter: ficheEffectToFilter(s.portrait_effect) }} />
            : <div style={{ position: 'absolute', inset: 0, background: '#1a1a1f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: '4rem', opacity: 0.15 }}>🧑</span></div>
          }
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }} />
          {(s.portrait_vignette ?? 0) > 0 && (
            <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${(s.portrait_vignette ?? 0) / 100}) 100%)`, pointerEvents: 'none' }} />
          )}
          {protagonist.name_image_url && (
            <div style={{ position: 'absolute', bottom: `${s.bottom}px`, left: `${s.left}px`, transform: `rotate(${s.rotation}deg)`, transformOrigin: 'left bottom', zIndex: 3, pointerEvents: 'none' }}>
              <img src={protagonist.name_image_url} alt={protagonist.name} style={{ width: `${s.width}px`, objectFit: 'contain', display: 'block', filter: 'drop-shadow(2px 2px 6px rgba(0,0,0,0.9))' }} />
              {s.tagline && (
                <p style={{ margin: 0, position: 'relative', top: `${s.tagline_offset_y}px`, left: `${s.tagline_offset_x}px`, fontFamily: `'${s.tagline_font}', cursive`, fontSize: `${s.tagline_size}px`, color: s.tagline_color, textShadow: '1px 1px 4px rgba(0,0,0,0.95)', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{s.tagline}</p>
              )}
            </div>
          )}
        </div>

        {/* Stats section */}
        <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 14px', overflow: 'hidden', boxShadow: insetShadow }}>
          {protagonist.background_image_url && (
            <img src={protagonist.background_image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: s.bg_opacity ?? 0.4, zIndex: 0 }} />
          )}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 0 }} />
          <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px', padding: '8px', marginTop: `${s.stats_offset_y ?? 0}px`, marginLeft: `${s.stats_offset_x ?? 0}px` }}>
              {FICHE_STATS_DISPLAY.map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '3px 0' }}>
                  <span style={{ fontFamily: 'Georgia, serif', fontWeight: (s.stats_label_bold ?? true) ? '900' : '400', fontStyle: (s.stats_label_italic ?? true) ? 'italic' : 'normal', fontSize: `${s.stats_label_size ?? 13}px`, textTransform: 'uppercase', letterSpacing: '1.5px', color: s.stats_label_color ?? '#d4a84c' }}>{label}</span>
                  <span style={{ fontFamily: 'Georgia, serif', fontWeight: '900', fontSize: `${s.stats_value_size ?? 27}px`, color: s.stats_value_color ?? '#ede9df', lineHeight: 1 }}>{(protagonist as any)[key] ?? 0}</span>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', padding: '4px 0', marginTop: `${s.dice_offset_y ?? 0}px`, flexShrink: 0 }}>
              <div onClick={() => setDiceRolled(true)} style={{ display: 'inline-block', background: s.dice_bg_color || 'transparent', border: `1px solid ${s.dice_border_color || s.dice_color || '#ede9df'}`, borderRadius: '3px', padding: '3px 10px', cursor: 'pointer', opacity: diceRolled ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                <span style={{ color: s.dice_color ?? '#ede9df', fontSize: `${s.dice_size ?? 12}px`, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
                  {diceRolled ? '✓ ' : ''}{s.dice_text || 'Lance les dés (3 essais)'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: `${s.ill_gap}px`, height: `${s.ill_height}px`, flexShrink: 0 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ flex: 1, background: illustrations[i] ? 'transparent' : '#1a1a1f', borderRadius: '4px', overflow: 'hidden', border: illustrations[i] ? '1px solid rgba(255,255,255,0.08)' : '1px dashed #2a2a30', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: ficheContainerShadow(s.ill_box_shadow) }}>
                  {illustrations[i]
                    ? <img src={illustrations[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: ficheEffectToFilter(s.ill_effect) }} />
                    : <span style={{ fontSize: '1rem', opacity: 0.15 }}>🧍</span>
                  }
                </div>
              ))}
            </div>
            <div style={{ padding: '6px 0', marginTop: `${s.cta_offset_y ?? 0}px`, flexShrink: 0 }}>
              <div onClick={() => diceRolled && setDiceRolled(false)} style={{ background: diceRolled ? (s.cta_color ?? '#d4a84c') : 'rgba(255,255,255,0.08)', borderRadius: '3px', padding: '6px', textAlign: 'center', cursor: diceRolled ? 'pointer' : 'default', transition: 'background 0.3s', border: diceRolled ? 'none' : `1px solid ${s.cta_color ?? '#d4a84c'}44` }}>
                <span style={{ fontFamily: 'Georgia, serif', fontWeight: '900', fontStyle: 'italic', color: diceRolled ? (s.cta_text_color ?? '#0d0d0d') : (s.cta_color ?? '#d4a84c'), fontSize: `${s.cta_font_size ?? 9}px`, letterSpacing: '1.5px', textTransform: 'uppercase', opacity: diceRolled ? 1 : 0.5 }}>{s.cta_text || "COMMENCER L'AVENTURE"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Text overlays */}
        {(() => {
          const overlays = s.text_overlays ?? []
          const startTimes = ficheOverlayStartTimes(overlays)
          return overlays.map((overlay: any, idx: number) => {
            const startTime = startTimes[idx]
            const baseStyle: React.CSSProperties = { position: 'absolute', left: `${overlay.x}%`, top: `${overlay.y}%`, fontFamily: `'${overlay.font}', Georgia, serif`, fontSize: `${overlay.size}px`, color: overlay.color, fontWeight: overlay.bold ? '900' : '400', fontStyle: overlay.italic ? 'italic' : 'normal', textShadow: overlay.shadow ? '1px 1px 6px rgba(0,0,0,0.95)' : undefined, pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap', lineHeight: 1.2 }
            if (overlay.animation === 'fade') return <div key={overlay.id} style={{ ...baseStyle, animation: `overlay-fade 1.4s ${startTime}s both` }}>{overlay.text}</div>
            if (overlay.animation === 'typing') return <div key={overlay.id} style={{ ...baseStyle, animation: `overlay-show 0.01s ${startTime}s both` }}>{overlay.text.split('').map((char: string, i: number) => <span key={i} style={{ display: 'inline-block', animation: `overlay-char 0.06s ${startTime + i * ((overlay.typing_speed ?? 70) / 1000)}s both` }}>{char === ' ' ? '\u00a0' : char}</span>)}</div>
            return <div key={overlay.id} style={{ ...baseStyle, animation: `overlay-show 0.01s ${startTime}s both` }}>{overlay.text}</div>
          })
        })()}
      </div>
    </div>
  )
}

// ── Écran Section — Layout ────────────────────────────────────────────────────

const SECTION_LAYOUT_DEFAULTS: import('@/types').SectionLayoutSettings = {
  // Illustration plein écran
  el_photo:         { x: 0, y: 0, w: 390, h: 845 },
  photo_border:     false,
  photo_shadow:     false,
  photo_border_width: 3,
  photo_bg:         '#0d0d0d',
  // Texte narratif
  el_text:          { x: 0, y: 500, w: 390, h: 155 },
  text_bg_opacity:  82,
  text_bg_color:    '#0d0d0d',
  text_font_size:   15,
  text_gradient:    true,
  text_padding:     18,
  // Choix
  el_choices:            { x: 8, y: 662, w: 374, h: 90 },
  choices_font_size:     13,
  choices_font_family:   'sans' as const,
  choices_italic:        false,
  choices_bold:          false,
  choices_text_color:    '#ede9df',
  choices_active_color:  '#d4a84c',
  choices_bg:            '#0d0d0d',
  choices_active_bg:     'rgba(212,168,76,0.18)',
  choices_border_color:  'rgba(255,255,255,0.08)',
  choices_active_border: '#d4a84c66',
  choices_border_radius: 6,
  // Opacité globale HUD
  overlay_opacity:  80,
  // Vignettes
  vignettes_show:   true,
  vignette_size:    52,
  vignette_style:   'circle',
  vignette_border_color: '#d4a84c',
  vignette_positions: [{ x: 10, y: 458 }, { x: 78, y: 458 }, { x: 146, y: 458 }],
  // HUD
  el_health:        { x: 12, y: 14, w: 366 },
  el_stats:         { x: 8, y: 762 },
  el_inventory:     { x: 210, y: 762 },
  health_show:       true,
  health_mode:       'text' as const,
  health_font_size:  7,
  health_text_color: '',   // vide = couleur dynamique selon état
  stats_show:        true,
  inventory_show:    true,
  settings_show:     true,
  el_settings:       { x: 350, y: 14 },
  clock_show:        true,
  clock_color:       '#ff3333',
  clock_font_size:   18,
  el_clock:          { x: 145, y: 10 },
  manga_dialog_show:        false,
  el_manga_dialog:          { x: 0, y: 480, w: 390, h: 365 },
  manga_dialog_bg_color:    '#0d0d0d',
  manga_npc_name_color:        '#d4a84c',
  manga_panel_bg_color:        '#0d0d0d',
  manga_player_panel_bg_color: '#0d0d0d',
  manga_panel_blend_mode:      'normal' as const,
  manga_player_blend_mode:     'normal' as const,
  manga_panel_portrait_inset_0: 0,
  manga_panel_portrait_inset_1: 0,
  manga_panel_portrait_inset_2: 0,
  manga_panel_portrait_inset_3: 0,
  manga_player_portrait_inset:  0,
  manga_panel_portrait_rotate_0: 0,
  manga_panel_portrait_rotate_1: 0,
  manga_panel_portrait_rotate_2: 0,
  manga_panel_portrait_rotate_3: 0,
  manga_player_portrait_rotate:  0,
  manga_panel_portrait_pos_x_0: 50, manga_panel_portrait_pos_y_0: 20,
  manga_panel_portrait_pos_x_1: 50, manga_panel_portrait_pos_y_1: 20,
  manga_panel_portrait_pos_x_2: 50, manga_panel_portrait_pos_y_2: 20,
  manga_panel_portrait_pos_x_3: 50, manga_panel_portrait_pos_y_3: 20,
  manga_player_portrait_pos_x: 50, manga_player_portrait_pos_y: 20,
  manga_npc_panel_zindex_0: 2,
  manga_npc_panel_zindex_1: 1,
  manga_npc_panel_zindex_2: 3,
  manga_npc_panel_zindex_3: 4,
  manga_dialog_shadow: false,
  manga_dialog_shadow_blur: 32,
  manga_dialog_shadow_color: '#000000',
  manga_dialog_shadow_opacity: 80,
  manga_dialog_border: false,
  manga_dialog_border_width: 2,
  manga_dialog_border_color: '#d4a84c',
  manga_dialog_border_radius: 0,
}

function SectionPreviewCard({ s, previewMode, scale = 1, onUpdate, protagonist, npcs, mangaSelectedNpcs = [], mangaEmotions = {}, settingsStep, section, sectionChoices, onChoiceClick, simMode, book }: {
  s: import('@/types').SectionLayoutSettings
  previewMode: 'phone' | 'tablet'
  scale?: number
  onUpdate?: (key: keyof import('@/types').SectionLayoutSettings, value: any) => void
  protagonist: import('@/types').Npc | null
  mangaSelectedNpcs?: string[]
  mangaEmotions?: Record<string, string>
  npcs: import('@/types').Npc[]
  settingsStep?: import('@/types').IntroStep
  section?: import('@/types').Section
  sectionChoices?: import('@/types').Choice[]
  onChoiceClick?: (choice: import('@/types').Choice) => void
  simMode?: boolean
  book?: import('@/types').Book | null
}) {
  const DEF = SECTION_LAYOUT_DEFAULTS
  const containerRef = React.useRef<HTMLDivElement>(null)
  const interactive = !!onUpdate
  const [showSettingsOverlay, setShowSettingsOverlay] = React.useState(false)
  const [simMangaOpen, setSimMangaOpen] = React.useState(false)
  const [simActiveNpc, setSimActiveNpc] = React.useState<import('@/types').Npc | null>(null)
  // ── Dialogue simulation ───────────────────────────────────────────────
  type SimNpcResponse = { npc_id: string; text: string; agrees: boolean; emotion: string; test_result: string }
  type SimDialogueData = { player_question: string; npc_responses: SimNpcResponse[] }
  const [simDialoguePhase, setSimDialoguePhase] = React.useState<'idle' | 'loading' | 'question' | 'responding' | 'done'>('idle')
  const [simDialogueData, setSimDialogueData] = React.useState<SimDialogueData | null>(null)
  const [simRevealedIds, setSimRevealedIds] = React.useState<string[]>([])
  const [simActiveBubbleId, setSimActiveBubbleId] = React.useState<string | null>(null)
  const [simAutoNpcIds, setSimAutoNpcIds] = React.useState<string[]>([])
  const [simNpcEmotions, setSimNpcEmotions] = React.useState<Record<string, string>>({})
  const [simPlayerBubbleVisible, setSimPlayerBubbleVisible] = React.useState(false)
  const [simClickedNpcId, setSimClickedNpcId] = React.useState<string | null>(null)
  const [simCaptionText, setSimCaptionText] = React.useState<string>('')
  const [simCaptionNpcId, setSimCaptionNpcId] = React.useState<string | null>(null)
  const simAudioRef = React.useRef<HTMLAudioElement | null>(null)
  const simCaptionTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  function closeMangaDialog() {
    setSimMangaOpen(false)
    setSimDialoguePhase('idle')
    setSimDialogueData(null)
    setSimRevealedIds([])
    setSimActiveBubbleId(null)
    setSimAutoNpcIds([])
    setSimNpcEmotions({})
    setSimPlayerBubbleVisible(false)
    setSimClickedNpcId(null)
    setSimCaptionText('')
    setSimCaptionNpcId(null)
    if (simCaptionTimerRef.current) { clearInterval(simCaptionTimerRef.current); simCaptionTimerRef.current = null }
    if (simAudioRef.current) { simAudioRef.current.pause(); simAudioRef.current = null }
  }

  type CaptionGroup = { text: string; start: number; end: number }
  type VoiceData = { audio: HTMLAudioElement; groups: CaptionGroup[] }

  function buildCaptionGroups(alignment: any, chunkSize = 3): CaptionGroup[] {
    const chars: string[] = alignment?.characters ?? []
    const starts: number[] = alignment?.character_start_times_seconds ?? []
    const ends: number[] = alignment?.character_end_times_seconds ?? []
    if (!chars.length) return []

    const words: { text: string; start: number; end: number }[] = []
    let word = '', wordStart = 0
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === ' ' || chars[i] === '\n') {
        if (word) { words.push({ text: word, start: wordStart, end: ends[i - 1] ?? ends[i] }); word = '' }
      } else {
        if (!word) wordStart = starts[i]
        word += chars[i]
      }
    }
    if (word) words.push({ text: word, start: wordStart, end: ends[ends.length - 1] })

    const groups: CaptionGroup[] = []
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize)
      groups.push({ text: chunk.map(w => w.text).join(' '), start: chunk[0].start, end: (chunk[chunk.length - 1].end ?? 0) + 0.08 })
    }
    return groups
  }

  async function playAudio(voiceData: VoiceData, npcId?: string) {
    const { audio, groups } = voiceData
    if (simAudioRef.current) { simAudioRef.current.pause(); simAudioRef.current = null }
    if (simCaptionTimerRef.current) { clearInterval(simCaptionTimerRef.current); simCaptionTimerRef.current = null }
    simAudioRef.current = audio

    if (groups.length > 0 && npcId) {
      setSimCaptionNpcId(npcId)
      setSimCaptionText('')
      simCaptionTimerRef.current = setInterval(() => {
        const t = audio.currentTime
        const g = groups.find(g => t >= g.start && t < g.end) ?? null
        setSimCaptionText(g?.text ?? '')
      }, 50)
    }

    await new Promise<void>(resolve => {
      const done = () => {
        if (simCaptionTimerRef.current) { clearInterval(simCaptionTimerRef.current); simCaptionTimerRef.current = null }
        setSimCaptionText('')
        setSimCaptionNpcId(null)
        resolve()
      }
      audio.addEventListener('ended', done, { once: true })
      audio.addEventListener('error', done, { once: true })
      const p = audio.play()
      if (p) p.catch(done)
      setTimeout(done, 30000)
    })
  }

  // Joue 400ms de silence via Web Audio API pour réveiller les écouteurs Bluetooth
  // avant le premier vrai stream audio (évite la coupure du début)
  async function primeAudioDevice() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.4), ctx.sampleRate)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start()
      await new Promise(r => setTimeout(r, 450))
      ctx.close()
    } catch { /* ignore si Web Audio non dispo */ }
  }

  function extractEmotionFromTags(text: string, availableEmotions: string[]): string {
    if (availableEmotions.length === 0) return 'neutre'
    const tags = [...text.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].toLowerCase())
    for (const tag of tags) {
      const found = availableEmotions.find(e => e.toLowerCase() === tag || tag.includes(e.toLowerCase()) || e.toLowerCase().includes(tag))
      if (found) return found
    }
    return availableEmotions[0] ?? 'neutre'
  }

  async function openMangaDialogue(npc: import('@/types').Npc) {
    setSimMangaOpen(true)
    setSimActiveNpc(npc)
    setSimClickedNpcId(npc.id)
    setSimDialoguePhase('loading')
    primeAudioDevice()
    setSimDialogueData(null)
    setSimRevealedIds([])
    setSimActiveBubbleId(null)
    setSimAutoNpcIds([])
    setSimNpcEmotions({})
    setSimPlayerBubbleVisible(false)

    // ── 1. Question aléatoire parmi celles ayant une réponse en BDD ──
    const storedQs = section?.player_questions ?? []
    const rawResponses: Record<string, any> = (section as any)?.player_responses ?? {}

    const getNpcResponse = (npcId: string, question: string): string | null => {
      const byNpc = rawResponses[npcId]
      if (byNpc && typeof byNpc === 'object') return byNpc[question] ?? null
      const flat = rawResponses[question]
      if (typeof flat === 'string') return flat
      return null
    }

    const getNpcAudioUrl = (npcId: string, question: string): string | null => {
      const byNpc = rawResponses[npcId]
      if (byNpc && typeof byNpc === 'object') return byNpc[question + '__audio'] ?? null
      return null
    }

    const getNpcAlignment = (npcId: string, question: string): any | null => {
      const byNpc = rawResponses[npcId]
      if (byNpc && typeof byNpc === 'object') return byNpc[question + '__alignment'] ?? null
      return null
    }

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    const isInternalKey = (k: string) => k.endsWith('__audio') || k.endsWith('__alignment') || uuidRe.test(k)
    const inferredQs: string[] = storedQs.length === 0
      ? (() => {
          const byNpc = rawResponses[npc.id]
          if (byNpc && typeof byNpc === 'object') return Object.keys(byNpc).filter(k => !isInternalKey(k))
          return Object.keys(rawResponses).filter(k => !isInternalKey(k))
        })()
      : []
    const allQs = storedQs.length > 0 ? storedQs : inferredQs

    const qsWithSaved = allQs.filter(q => getNpcResponse(npc.id, q))
    const playerQuestion = qsWithSaved.length > 0
      ? qsWithSaved[Math.floor(Math.random() * qsWithSaved.length)]
      : allQs.length > 0
        ? allQs[Math.floor(Math.random() * allQs.length)]
        : 'Vous avez une idée ?'

    // Question joueur affichée immédiatement et persistante
    setSimDialogueData({ player_question: playerQuestion, npc_responses: [] })
    setSimPlayerBubbleVisible(true)
    setSimDialoguePhase('question')

    // ── 2. Ordre des PNJ : défini par companion_npc_ids dans la section (max 3) ──
    // Le PNJ cliqué est toujours inclus, même s'il n'est pas dans companion_npc_ids
    const companions = (simMode
      ? npcs.filter(n => (section?.companion_npc_ids ?? []).includes(n.id) && n.type !== 'ennemi' && n.type !== 'boss')
      : npcs.filter(n => n.id !== protagonist?.id).slice(0, 2)
    )
    const allSceneNpcs = [npc, ...companions.filter(n => n.id !== npc.id)]
    const companionOrder = section?.companion_npc_ids ?? []
    const orderedCompanions = [
      ...companionOrder.map(id => allSceneNpcs.find(n => n.id === id)).filter(Boolean) as import('@/types').Npc[],
      ...allSceneNpcs.filter(n => !companionOrder.includes(n.id))
    ]
    const sceneNpcs = orderedCompanions.slice(0, 4)

    // ── 3. Réponses depuis BDD uniquement — pas d'appel API ──
    const savedDbResponses: SimNpcResponse[] = sceneNpcs
      .map(n => {
        const text = getNpcResponse(n.id, playerQuestion)
        if (!text) return null
        const availableEmotions = Object.keys(n.portrait_emotions ?? {})
        const emotion = extractEmotionFromTags(text, availableEmotions)
        return { npc_id: n.id, text, agrees: true, emotion, test_result: 'success' } as SimNpcResponse
      })
      .filter(Boolean) as SimNpcResponse[]

    if (savedDbResponses.length === 0) {
      setSimDialoguePhase('done')
      return
    }

    setSimDialogueData({ player_question: playerQuestion, npc_responses: savedDbResponses })
    setSimAutoNpcIds(savedDbResponses.map(r => r.npc_id))

    // ── 4. Voix joueur depuis BDD ──
    const playerAudioUrl: string | null =
      (rawResponses['__player__'] as any)?.[playerQuestion + '__audio'] ?? null
    const playerWords = playerQuestion.trim().split(/\s+/).length
    const playerReadMs = Math.max(2000, playerWords / 130 * 60000)
    if (playerAudioUrl) {
      try {
        const res = await fetch(playerAudioUrl)
        const buf = await res.arrayBuffer()
        const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' })))
        await playAudio({ audio, groups: [] })
        await new Promise(r => setTimeout(r, 400))
      } catch {
        // Audio indisponible → délai lecture
        await new Promise(r => setTimeout(r, playerReadMs))
      }
    } else {
      // Pas d'audio → délai basé sur le temps de lecture de la question
      await new Promise(r => setTimeout(r, playerReadMs))
    }

    setSimDialoguePhase('responding')

    // ── 5. Séquence automatique — max 3 PNJ, audio depuis BDD uniquement ──
    for (let i = 0; i < savedDbResponses.length; i++) {
      const resp = savedDbResponses[i]
      const npcObj = sceneNpcs.find(n => n.id === resp.npc_id)
      setSimRevealedIds(prev => [...prev, resp.npc_id])
      setSimActiveBubbleId(resp.npc_id)
      setSimNpcEmotions(prev => ({ ...prev, [resp.npc_id]: resp.emotion }))
      if (npcObj) setSimActiveNpc(npcObj)

      const audioUrl = getNpcAudioUrl(resp.npc_id, playerQuestion)
      if (audioUrl) {
        try {
          const res = await fetch(audioUrl)
          const buf = await res.arrayBuffer()
          const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' })))
          const alignment = getNpcAlignment(resp.npc_id, playerQuestion)
          const groups = alignment ? buildCaptionGroups(alignment) : []
          await playAudio({ audio, groups }, resp.npc_id)
        } catch {
          const words = resp.text.trim().split(/\s+/).length
          await new Promise(r => setTimeout(r, Math.max(2500, words / 130 * 60000)))
        }
      } else {
        const words = resp.text.trim().split(/\s+/).length
        await new Promise(r => setTimeout(r, Math.max(2500, words / 130 * 60000)))
      }
      await new Promise(r => setTimeout(r, 300))
    }
    setSimDialoguePhase('done')
  }

  // ── Live state refs (drag closures) + states (render) ───────────────
  const livePhotoRef   = React.useRef({ ...(s.el_photo    ?? DEF.el_photo) })
  const liveHealthRef  = React.useRef({ ...(s.el_health   ?? DEF.el_health) })
  const liveTextRef    = React.useRef({ ...(s.el_text     ?? DEF.el_text) })
  const liveChoicesRef = React.useRef({ ...(s.el_choices  ?? DEF.el_choices) })
  const liveStatsRef   = React.useRef({ ...(s.el_stats    ?? DEF.el_stats) })
  const liveInvRef     = React.useRef({ ...(s.el_inventory ?? DEF.el_inventory) })
  const liveVigPosRef   = React.useRef<{x:number,y:number}[]>((s.vignette_positions ?? DEF.vignette_positions).map(p => ({...p})))
  const liveSettingsRef = React.useRef({ ...(s.el_settings ?? DEF.el_settings) })
  const liveClockRef    = React.useRef({ ...(s.el_clock    ?? DEF.el_clock) })
  const liveMangaDialogRef  = React.useRef({ ...(s.el_manga_dialog  ?? DEF.el_manga_dialog) })
  const [livePhoto,    setLivePhoto]    = React.useState({ ...livePhotoRef.current })
  const [liveHealth,   setLiveHealth]   = React.useState({ ...liveHealthRef.current })
  const [liveText,     setLiveText]     = React.useState({ ...liveTextRef.current })
  const [liveChoices,  setLiveChoices]  = React.useState({ ...liveChoicesRef.current })
  const [liveStats,    setLiveStats]    = React.useState({ ...liveStatsRef.current })
  const [liveInv,      setLiveInv]      = React.useState({ ...liveInvRef.current })
  const [liveVigPos,   setLiveVigPos]   = React.useState<{x:number,y:number}[]>(liveVigPosRef.current)
  const [liveSettings, setLiveSettings] = React.useState({ ...liveSettingsRef.current })
  const [liveClock,    setLiveClock]    = React.useState({ ...liveClockRef.current })
  const [liveMangaDialog,  setLiveMangaDialog]  = React.useState({ ...liveMangaDialogRef.current })
  const [dragging,    setDragging]    = React.useState<string | null>(null)
  const isDraggingRef = React.useRef(false)

  // ── Sync from props (skipped during drag to avoid loop) ─────────────
  React.useEffect(() => { if (isDraggingRef.current) return; const v = { ...(s.el_photo    ?? DEF.el_photo) };    livePhotoRef.current   = v; setLivePhoto(v) },   [s.el_photo])
  React.useEffect(() => { if (isDraggingRef.current) return; const v = { ...(s.el_health   ?? DEF.el_health) };   liveHealthRef.current  = v; setLiveHealth(v) },  [s.el_health])
  React.useEffect(() => { if (isDraggingRef.current) return; const v = { ...(s.el_text     ?? DEF.el_text) };     liveTextRef.current    = v; setLiveText(v) },    [s.el_text])
  React.useEffect(() => { if (isDraggingRef.current) return; const v = { ...(s.el_choices  ?? DEF.el_choices) };  liveChoicesRef.current = v; setLiveChoices(v) }, [s.el_choices])
  React.useEffect(() => { if (isDraggingRef.current) return; const v = { ...(s.el_stats    ?? DEF.el_stats) };    liveStatsRef.current   = v; setLiveStats(v) },   [s.el_stats])
  React.useEffect(() => { if (isDraggingRef.current) return; const v = { ...(s.el_inventory ?? DEF.el_inventory) }; liveInvRef.current   = v; setLiveInv(v) },     [s.el_inventory])
  React.useEffect(() => { if (isDraggingRef.current) return; const v = (s.vignette_positions ?? DEF.vignette_positions).map(p => ({...p})); liveVigPosRef.current = v; setLiveVigPos(v) }, [s.vignette_positions])
  React.useEffect(() => { if (isDraggingRef.current) return; const v = { ...(s.el_settings ?? DEF.el_settings) }; liveSettingsRef.current = v; setLiveSettings(v) }, [s.el_settings])
  React.useEffect(() => { if (isDraggingRef.current) return; const v = { ...(s.el_clock    ?? DEF.el_clock) };    liveClockRef.current    = v; setLiveClock(v) },    [s.el_clock])
  React.useEffect(() => { if (isDraggingRef.current) return; const v = { ...(s.el_manga_dialog  ?? DEF.el_manga_dialog) };  liveMangaDialogRef.current  = v; setLiveMangaDialog(v) },  [s.el_manga_dialog])

  // ── Unified drag ─────────────────────────────────────────────────────
  const CW = 390, CH = 845, SNAP_T = 8
  function snapRect(x: number, y: number, w: number, h: number) {
    let nx = x, ny = y
    if (Math.abs(nx) < SNAP_T) nx = 0
    if (Math.abs(ny) < SNAP_T) ny = 0
    if (Math.abs(nx + w - CW) < SNAP_T) nx = CW - w
    if (Math.abs(ny + h - CH) < SNAP_T) ny = CH - h
    return { x: nx, y: ny }
  }
  function clampPoint(x: number, y: number) {
    return { x: Math.max(0, Math.min(x, CW)), y: Math.max(0, Math.min(y, CH)) }
  }

  type DragType = 'photo_pos'|'photo_size'|'health_pos'|'health_w'|'text_pos'|'text_size'|'choices_pos'|'choices_size'|'stats_pos'|'inv_pos'|'vignette_pos'|'settings_pos'|'clock_pos'|'manga_dialog_pos'|'manga_dialog_size'
  function startDrag(type: DragType, e: React.MouseEvent, idx?: number) {
    if (!interactive) return
    e.preventDefault(); e.stopPropagation()
    isDraggingRef.current = true
    setDragging(type === 'vignette_pos' ? `vignette_pos_${idx}` : type)
    const sx = e.clientX, sy = e.clientY
    const snap = {
      photo: { ...livePhotoRef.current }, health: { ...liveHealthRef.current },
      text: { ...liveTextRef.current }, choices: { ...liveChoicesRef.current },
      stats: { ...liveStatsRef.current }, inv: { ...liveInvRef.current },
      vigPos: liveVigPosRef.current.map(p => ({...p})),
      settings: { ...liveSettingsRef.current },
      clock: { ...liveClockRef.current },
      mangaDialog:  { ...liveMangaDialogRef.current },
    }
    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale
      if (type === 'photo_pos') {
        const { x, y } = snapRect(Math.round(snap.photo.x + dx), Math.round(snap.photo.y + dy), snap.photo.w, snap.photo.h)
        const v = { ...snap.photo, x: Math.max(0, x), y }
        livePhotoRef.current = v; setLivePhoto(v); onUpdate?.('el_photo', v)
      } else if (type === 'photo_size') {
        const w = Math.max(60, Math.round(snap.photo.w + dx)), h = Math.max(60, Math.round(snap.photo.h + dy))
        const v = { ...snap.photo, x: Math.max(0, snap.photo.x), w, h }
        livePhotoRef.current = v; setLivePhoto(v); onUpdate?.('el_photo', v)
      } else if (type === 'health_pos') {
        const { x, y } = clampPoint(Math.round(snap.health.x + dx), Math.round(snap.health.y + dy))
        const v = { ...snap.health, x, y }
        liveHealthRef.current = v; setLiveHealth(v); onUpdate?.('el_health', v)
      } else if (type === 'health_w') {
        const v = { ...snap.health, w: Math.max(80, Math.round(snap.health.w + dx)) }
        liveHealthRef.current = v; setLiveHealth(v); onUpdate?.('el_health', v)
      } else if (type === 'text_pos') {
        const { x, y } = snapRect(Math.round(snap.text.x + dx), Math.round(snap.text.y + dy), snap.text.w, snap.text.h)
        const v = { ...snap.text, x, y }
        liveTextRef.current = v; setLiveText(v); onUpdate?.('el_text', v)
      } else if (type === 'text_size') {
        const v = { ...snap.text, w: Math.max(80, Math.round(snap.text.w + dx)), h: Math.max(40, Math.round(snap.text.h + dy)) }
        liveTextRef.current = v; setLiveText(v); onUpdate?.('el_text', v)
      } else if (type === 'choices_pos') {
        const { x, y } = snapRect(Math.round(snap.choices.x + dx), Math.round(snap.choices.y + dy), snap.choices.w, snap.choices.h)
        const v = { ...snap.choices, x, y }
        liveChoicesRef.current = v; setLiveChoices(v); onUpdate?.('el_choices', v)
      } else if (type === 'choices_size') {
        const v = { ...snap.choices, w: Math.max(80, Math.round(snap.choices.w + dx)), h: Math.max(30, Math.round(snap.choices.h + dy)) }
        liveChoicesRef.current = v; setLiveChoices(v); onUpdate?.('el_choices', v)
      } else if (type === 'stats_pos') {
        const v = clampPoint(Math.round(snap.stats.x + dx), Math.round(snap.stats.y + dy))
        liveStatsRef.current = v; setLiveStats(v); onUpdate?.('el_stats', v)
      } else if (type === 'inv_pos') {
        const v = clampPoint(Math.round(snap.inv.x + dx), Math.round(snap.inv.y + dy))
        liveInvRef.current = v; setLiveInv(v); onUpdate?.('el_inventory', v)
      } else if (type === 'vignette_pos' && idx !== undefined) {
        const v = snap.vigPos.map((p, i) => i === idx ? clampPoint(Math.round(p.x + dx), Math.round(p.y + dy)) : p)
        liveVigPosRef.current = v; setLiveVigPos(v); onUpdate?.('vignette_positions', v)
      } else if (type === 'settings_pos') {
        const v = clampPoint(Math.round(snap.settings.x + dx), Math.round(snap.settings.y + dy))
        liveSettingsRef.current = v; setLiveSettings(v); onUpdate?.('el_settings', v)
      } else if (type === 'clock_pos') {
        const v = clampPoint(Math.round(snap.clock.x + dx), Math.round(snap.clock.y + dy))
        liveClockRef.current = v; setLiveClock(v); onUpdate?.('el_clock', v)
      } else if (type === 'manga_dialog_pos') {
        const { x, y } = snapRect(Math.round(snap.mangaDialog.x + dx), Math.round(snap.mangaDialog.y + dy), snap.mangaDialog.w, snap.mangaDialog.h)
        const v = { ...snap.mangaDialog, x, y }
        liveMangaDialogRef.current = v; setLiveMangaDialog(v); onUpdate?.('el_manga_dialog', v)
      } else if (type === 'manga_dialog_size') {
        const v = { ...snap.mangaDialog, w: Math.max(250, Math.round(snap.mangaDialog.w + dx)), h: Math.max(150, Math.round(snap.mangaDialog.h + dy)) }
        liveMangaDialogRef.current = v; setLiveMangaDialog(v); onUpdate?.('el_manga_dialog', v)
      }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      isDraggingRef.current = false
      setDragging(null)
      if (type === 'photo_pos' || type === 'photo_size') onUpdate?.('el_photo',    livePhotoRef.current)
      if (type === 'health_pos' || type === 'health_w')  onUpdate?.('el_health',   liveHealthRef.current)
      if (type === 'text_pos'   || type === 'text_size') onUpdate?.('el_text',     liveTextRef.current)
      if (type === 'choices_pos'|| type === 'choices_size') onUpdate?.('el_choices', liveChoicesRef.current)
      if (type === 'stats_pos')    onUpdate?.('el_stats',     liveStatsRef.current)
      if (type === 'inv_pos')      onUpdate?.('el_inventory', liveInvRef.current)
      if (type === 'vignette_pos') onUpdate?.('vignette_positions', liveVigPosRef.current)
      if (type === 'settings_pos') onUpdate?.('el_settings', liveSettingsRef.current)
      if (type === 'clock_pos')    onUpdate?.('el_clock',    liveClockRef.current)
      if (type === 'manga_dialog_pos' || type === 'manga_dialog_size') onUpdate?.('el_manga_dialog', liveMangaDialogRef.current)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Data ─────────────────────────────────────────────────────────────
  const placeholderImg = 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=800&q=80'
  const sceneCompanions = simMode
    ? npcs.filter(n => (section?.companion_npc_ids ?? []).includes(n.id) && n.type !== 'ennemi' && n.type !== 'boss')
    : npcs.filter(n => n.id !== protagonist?.id).slice(0, 2)
  const vignettes: { name: string; img?: string; npc?: import('@/types').Npc }[] = []
  if (protagonist) vignettes.push({ name: protagonist.name, img: protagonist.portrait_url ?? protagonist.image_url, npc: protagonist })
  sceneCompanions.filter(n => n.id !== protagonist?.id).forEach(n => vignettes.push({ name: n.name, img: n.image_url, npc: n }))
  if (vignettes.length === 0) vignettes.push({ name: 'Protagonist' }, { name: 'Rico' }, { name: 'Mara' })
  const vigPositions = vignettes.map((_, i) => liveVigPos[i] ?? { x: 10 + i * 68, y: DEF.vignette_positions[0].y })
  const fs = previewMode === 'tablet' ? 1.4 : 1
  const ovAlpha = Math.round((s.overlay_opacity ?? 80) * 2.55).toString(16).padStart(2, '0')
  const STATS_PREVIEW = [
    { icon: '⚔', label: 'FOR', val: 8 }, { icon: '🏃', label: 'AGI', val: 7 },
    { icon: '🧠', label: 'INT', val: 6 }, { icon: '✨', label: 'MAG', val: 5 },
    { icon: '❤', label: 'END', val: 10 }, { icon: '🍀', label: 'CHA', val: 6 },
  ]

  // ── Handle helpers ───────────────────────────────────────────────────
  const ResizeCorner = ({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) => (
    <div onMouseDown={e => { e.stopPropagation(); onMouseDown(e) }} style={{ position: 'absolute', bottom: -5, right: -5, width: 12, height: 12, background: '#d4a84c', borderRadius: '2px', cursor: 'se-resize', zIndex: 35 }} />
  )

  // ── Text background helper ───────────────────────────────────────────
  const textBg = s.text_gradient
    ? `linear-gradient(to bottom, transparent, ${s.text_bg_color}${Math.round(s.text_bg_opacity * 2.55).toString(16).padStart(2,'0')} 28%)`
    : `${s.text_bg_color}${Math.round(s.text_bg_opacity * 2.55).toString(16).padStart(2,'0')}`

  return (
    <div ref={containerRef} style={{ width: '390px', height: '845px', background: s.photo_bg, position: 'relative', overflow: 'hidden', userSelect: 'none' }}>

      {/* ── Illustration plein écran (fond) ─────────────────────────── */}
      <div
        onMouseDown={interactive ? e => startDrag('photo_pos', e) : undefined}
        style={{
          position: 'absolute', left: livePhoto.x, top: livePhoto.y, width: livePhoto.w, height: livePhoto.h,
          zIndex: 1,
          border: s.photo_border ? `${s.photo_border_width}px solid #f5f0e8` : 'none',
          boxShadow: s.photo_shadow ? '0 8px 32px rgba(0,0,0,0.8)' : 'none',
          overflow: 'hidden',
          outline: interactive ? '1px dashed rgba(212,168,76,0.2)' : 'none',
          cursor: interactive ? (dragging === 'photo_pos' ? 'grabbing' : 'grab') : 'default',
        }}>
        <img src={(section?.images?.[0]?.url) ?? section?.image_url ?? placeholderImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
        {interactive && <ResizeCorner onMouseDown={e => startDrag('photo_size', e)} />}
      </div>

      {/* ── Barre de santé ──────────────────────────────────────────── */}
      {s.health_show && (
        <div
          onMouseDown={interactive ? e => startDrag('health_pos', e) : undefined}
          onClick={interactive ? e => { e.stopPropagation(); onUpdate?.('health_mode', (s.health_mode ?? 'text') === 'text' ? 'bar' : 'text') } : undefined}
          style={{ position: 'absolute', left: liveHealth.x, top: liveHealth.y, width: (s.health_mode ?? 'text') === 'text' ? 'fit-content' : liveHealth.w, maxWidth: CW - liveHealth.x, zIndex: 25, cursor: interactive ? 'pointer' : 'default' }}>
          {interactive && (s.health_mode ?? 'text') === 'bar' && (
            <div onMouseDown={e => { e.stopPropagation(); startDrag('health_w', e) }}
              style={{ position: 'absolute', right: -5, top: '50%', transform: 'translateY(-50%)', width: 10, height: 10, background: '#d4a84c', borderRadius: '2px', cursor: 'ew-resize', zIndex: 35 }} />
          )}
          {(() => {
            const pct = 70 // preview 7/10
            const fs2 = (s.health_font_size ?? 7) * fs
            const mode = s.health_mode ?? 'text'
            const dynColor = pct >= 90 ? '#4caf7d' : pct >= 70 ? '#8bc34a' : pct >= 50 ? '#d4a84c' : pct >= 25 ? '#e07d55' : '#e05555'
            const dynText  = pct >= 90 ? 'Indemne' : pct >= 70 ? 'Tu tiens encore debout, mais chaque mouvement réveille une douleur sourde dans tes côtes' : pct >= 50 ? 'Blessé' : pct >= 25 ? 'Grièvement blessé' : 'À l\'agonie'
            const txtColor = s.health_text_color || dynColor
            return (
              <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: `${Math.round(fs2 * 0.55)}px`, padding: `${Math.round(fs2 * 0.5)}px ${Math.round(fs2 * 1.1)}px`, border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', gap: `${Math.round(fs2 * 0.6)}px`, pointerEvents: 'none' }}>
                {mode === 'text' ? (
                  <span style={{ fontSize: `${fs2}px`, color: txtColor, fontFamily: 'Georgia, serif', fontStyle: 'italic', letterSpacing: '0.04em', flex: 1, minWidth: 0 }}>{dynText}</span>
                ) : (
                  <>
                    <div style={{ flex: 1, height: `${fs2 * 0.85}px`, background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden', minWidth: 40 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: txtColor, borderRadius: '3px' }} />
                    </div>
                    <span style={{ fontSize: `${fs2}px`, color: txtColor, fontFamily: 'Georgia, serif', flexShrink: 0 }}>7/10</span>
                  </>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ── Texte narratif ──────────────────────────────────────────── */}
      <div
        onMouseDown={interactive ? e => startDrag('text_pos', e) : undefined}
        style={{ position: 'absolute', left: liveText.x, top: liveText.y, width: liveText.w, height: liveText.h, zIndex: 20, cursor: interactive ? (dragging === 'text_pos' ? 'grabbing' : 'grab') : 'default' }}>
        <div style={{ position: 'absolute', inset: 0, background: textBg, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ padding: `8px ${s.text_padding}px 8px`, height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
            <p style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: `${s.text_font_size * fs * 0.72}px`, color: '#ede9df', lineHeight: 1.6, overflow: 'hidden', height: '100%' }}>
              {section?.content ?? 'Le silence pesait sur la rue comme une chape de béton. Rico ajusta sa capuche et scruta les fenêtres obscures en face. Quelque chose clochait — il le sentait dans ses os.'}
            </p>
          </div>
        </div>
        {interactive && <ResizeCorner onMouseDown={e => startDrag('text_size', e)} />}
      </div>

      {/* ── Boutons de choix ────────────────────────────────────────── */}
      <div
        onMouseDown={!simMode && interactive ? e => startDrag('choices_pos', e) : undefined}
        style={{ position: 'absolute', left: liveChoices.x, top: liveChoices.y, width: liveChoices.w, height: liveChoices.h, zIndex: 21, cursor: interactive ? (dragging === 'choices_pos' ? 'grabbing' : 'grab') : 'default' }}>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: simMode ? 'auto' : 'none' }}>
          <div style={{ padding: '6px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
            {(sectionChoices && sectionChoices.length > 0 ? sectionChoices.map(c => c.label) : ['Entrer par la ruelle', 'Surveiller depuis le toit']).map((label, ci) => {
              const choice = sectionChoices?.[ci]
              const isActive = !simMode && ci === 0
              const choicesBg = s.choices_bg ?? '#0d0d0d'
              const bgNormal = `${choicesBg}${ovAlpha}`
              const bgActive = s.choices_active_bg ?? 'rgba(212,168,76,0.18)'
              const borderNormal = s.choices_border_color ?? 'rgba(255,255,255,0.08)'
              const borderActive = s.choices_active_border ?? '#d4a84c66'
              const colorNormal = s.choices_text_color ?? '#ede9df'
              const colorActive = s.choices_active_color ?? '#d4a84c'
              const radius = s.choices_border_radius ?? 6
              const fontFamily = s.choices_font_family === 'serif' ? 'Georgia, serif' : s.choices_font_family === 'mono' ? 'monospace' : 'system-ui, sans-serif'
              const fontWeight = s.choices_bold ? 700 : 400
              const fontStyle = s.choices_italic ? 'italic' : 'normal'
              const fontSize = `${(s.choices_font_size ?? 13) * fs * 0.72}px`
              return (
                <div key={ci} onClick={simMode && choice ? () => onChoiceClick?.(choice) : undefined} style={{ background: isActive ? bgActive : bgNormal, border: `1px solid ${isActive ? borderActive : borderNormal}`, borderRadius: `${radius}px`, padding: '5px 8px', backdropFilter: 'blur(4px)', cursor: simMode && choice ? 'pointer' : 'default' }}>
                  <span style={{ fontFamily, fontSize, color: isActive ? colorActive : colorNormal, fontWeight, fontStyle }}>{label}</span>
                </div>
              )
            })}
          </div>
        </div>
        {interactive && <ResizeCorner onMouseDown={e => startDrag('choices_size', e)} />}
      </div>

      {/* ── Stats HUD ───────────────────────────────────────────────── */}
      {s.stats_show && (
        <div
          onMouseDown={interactive ? e => startDrag('stats_pos', e) : undefined}
          style={{ position: 'absolute', left: liveStats.x, top: liveStats.y, zIndex: 26, cursor: interactive ? (dragging === 'stats_pos' ? 'grabbing' : 'grab') : 'default' }}>
          <div style={{ background: `#0d0d0d${ovAlpha}`, border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '5px 7px', backdropFilter: 'blur(6px)', pointerEvents: 'none' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px 8px' }}>
              {STATS_PREVIEW.map(({ icon, label, val }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ fontSize: '9px' }}>{icon}</span>
                  <span style={{ fontSize: '6px', color: '#9898b4', fontFamily: 'Georgia, serif' }}>{label}</span>
                  <span style={{ fontSize: '7px', color: '#ede9df', fontFamily: 'Georgia, serif', marginLeft: '1px' }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Inventaire ──────────────────────────────────────────────── */}
      {s.inventory_show && (
        <div
          onMouseDown={interactive ? e => startDrag('inv_pos', e) : undefined}
          style={{ position: 'absolute', left: liveInv.x, top: liveInv.y, zIndex: 26, cursor: interactive ? (dragging === 'inv_pos' ? 'grabbing' : 'grab') : 'default' }}>
          <div style={{ background: `#0d0d0d${ovAlpha}`, border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '5px 6px', backdropFilter: 'blur(6px)', pointerEvents: 'none' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['🗡', '🧪'] as const).map((icon, i) => (
                <div key={i} style={{ width: '18px', height: '18px', border: '1px solid #d4a84c44', borderRadius: '3px', background: 'rgba(212,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '9px' }}>{icon}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Horloge LCD ─────────────────────────────────────────────── */}
      {s.clock_show && (
        <div
          onMouseDown={interactive ? e => startDrag('clock_pos', e) : undefined}
          style={{ position: 'absolute', left: liveClock.x, top: liveClock.y, zIndex: 28, cursor: interactive ? (dragging === 'clock_pos' ? 'grabbing' : 'grab') : 'default' }}>
          {(() => {
            const sz = (s.clock_font_size ?? 18) * fs
            const col = s.clock_color ?? '#ff3333'
            const glow = `0 0 ${sz * 0.4}px ${col}, 0 0 ${sz * 0.8}px ${col}44`
            const ghostCol = col.replace(/[\d a-f]{2}(?=,|\))/i, '18') // ~10% opacity ghost
            const fontStyle: React.CSSProperties = {
              fontFamily: '"Courier New", "Lucida Console", monospace',
              fontSize: `${sz}px`,
              fontWeight: 700,
              letterSpacing: `${sz * 0.08}px`,
              lineHeight: 1,
              display: 'block',
              margin: 0,
              padding: 0,
            }
            return (
              <div style={{ background: 'rgba(0,0,0,0.35)', borderRadius: `${sz * 0.2}px`, padding: 0, pointerEvents: 'none', userSelect: 'none', position: 'relative', lineHeight: 1 }}>
                {/* Segments fantômes */}
                <span style={{ ...fontStyle, color: `${col}18`, position: 'absolute', top: 0, left: 0 }}>88:88</span>
                {/* Heure réelle */}
                <span style={{ ...fontStyle, color: col, textShadow: glow, position: 'relative' }}>23:14</span>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── Icône Paramètres ─────────────────────────────────────────── */}
      {s.settings_show && (
        <div
          onMouseDown={interactive ? e => startDrag('settings_pos', e) : undefined}
          style={{ position: 'absolute', left: liveSettings.x, top: liveSettings.y, zIndex: 28, cursor: interactive ? (dragging === 'settings_pos' ? 'grabbing' : 'grab') : 'default' }}>
          {(() => {
            const sz = (s.health_font_size ?? 7) * fs * 1.4
            return (
              <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: `${sz * 0.4}px`, padding: `${sz * 0.4}px`, border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(4px)', pointerEvents: 'none' }}>
                <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={showSettingsOverlay ? '#d4a84c' : 'rgba(255,255,255,0.6)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
            )
          })()}
          {/* Zone de clic pour ouvrir/fermer l'overlay — par dessus, pointerEvents actifs */}
          <div
            onClick={() => setShowSettingsOverlay(v => !v)}
            style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
          />
        </div>
      )}

      {/* ── Dialogue Manga RPG ──────────────────────────────────────── */}
      {s.manga_dialog_show && !simMode && (() => {
        const dlg = liveMangaDialog
        const W = dlg.w, H = dlg.h
        const bgColor = s.manga_dialog_bg_color ?? '#0d0d0d'

        // Ombre portée
        const shadow = (() => {
          if (!s.manga_dialog_shadow) return 'none'
          const blur = s.manga_dialog_shadow_blur ?? 32
          const hex = s.manga_dialog_shadow_color ?? '#000000'
          const op = (s.manga_dialog_shadow_opacity ?? 80) / 100
          const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
          return `0 ${Math.round(blur/4)}px ${blur}px rgba(${r},${g},${b},${op})`
        })()
        const dialogBorder = s.manga_dialog_border ? `${s.manga_dialog_border_width ?? 2}px solid ${s.manga_dialog_border_color ?? '#d4a84c'}` : 'none'
        const dialogBorderRadius = s.manga_dialog_border ? (s.manga_dialog_border_radius ?? 0) : 0

        // Rects des panneaux (même logique que MangaDialogTab)
        const nw = Math.round(W * 0.55), pw = W - nw - 4
        const npcRects = [
          s.manga_npc_panel_rect_0 ?? { x: 0, y: 0,                       w: nw, h: H },
          s.manga_npc_panel_rect_1 ?? { x: 0, y: 0,                       w: nw, h: Math.round(H * 0.6) },
          s.manga_npc_panel_rect_2 ?? { x: 0, y: Math.round(H * 0.6),     w: nw, h: Math.round(H * 0.4) },
          s.manga_npc_panel_rect_3 ?? { x: 0, y: Math.round(H * 0.6),     w: nw, h: Math.round(H * 0.2) },
        ]
        const playerRect = s.manga_player_panel_rect ?? { x: nw + 4, y: 0, w: pw, h: H }
        // Utilise les NPCs sélectionnés dans MangaDialogTab si disponibles
        const sceneNpcs = mangaSelectedNpcs.length > 0
          ? mangaSelectedNpcs.map(id => npcs.find(n => n.id === id)).filter(Boolean) as import('@/types').Npc[]
          : npcs.filter(n => n.id !== protagonist?.id).slice(0, 4)

        function getMangaPortrait(npc: import('@/types').Npc): string | undefined {
          const emotion = mangaEmotions[npc.id] ?? 'neutre'
          return npc.portrait_emotions?.[emotion] ?? npc.image_url ?? undefined
        }

        return (
          <div
            onMouseDown={interactive ? e => startDrag('manga_dialog_pos', e) : undefined}
            style={{
              position: 'absolute', left: dlg.x, top: dlg.y,
              width: W, height: H, zIndex: 30, overflow: 'hidden',
              background: bgColor, boxShadow: shadow,
              border: dialogBorder, borderRadius: dialogBorderRadius,
              cursor: interactive ? (dragging === 'manga_dialog_pos' ? 'grabbing' : 'grab') : 'default',
              outline: interactive ? '1px dashed rgba(212,168,76,0.25)' : 'none',
            }}>

            {/* Panneaux NPC */}
            {([0, 1, 2, 3] as const).map(idx => {
              const r = npcRects[idx]
              const panelImg = s[`manga_panel_image_${idx + 1}` as keyof import('@/types').SectionLayoutSettings] as string | undefined
              const npc = sceneNpcs[idx]
              const portrait = npc ? getMangaPortrait(npc) : undefined
              const zIdx = (s[`manga_npc_panel_zindex_${idx}` as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? (idx + 1)
              const inset = (s[`manga_panel_portrait_inset_${idx}` as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? 0
              const rotate = (s[`manga_panel_portrait_rotate_${idx}` as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? 0
              const posX = (s[`manga_panel_portrait_pos_x_${idx}` as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? 0
              const posY = (s[`manga_panel_portrait_pos_y_${idx}` as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? 0
              return (
                <div key={idx} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, overflow: 'hidden', background: s.manga_panel_bg_color ?? '#0d0d0d', zIndex: zIdx }}>
                  {portrait && (
                    <div style={{ position: 'absolute', top: inset, left: inset, right: inset, bottom: inset, overflow: 'hidden' }}>
                      <img src={portrait} alt="" style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%', objectFit: 'cover', transform: `translate(calc(-50% + ${posX}px), calc(-50% + ${posY}px)) rotate(${rotate}deg)`, transformOrigin: 'center' }} />
                    </div>
                  )}
                  {panelImg && <img src={panelImg} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', mixBlendMode: (s.manga_panel_blend_mode ?? 'normal') as React.CSSProperties['mixBlendMode'] }} />}
                  {npc && <span style={{ position: 'absolute', bottom: 3, left: 4, fontSize: '9px', color: s.manga_npc_name_color ?? '#d4a84c', fontFamily: 'Georgia, serif', fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,0.9)', zIndex: 2 }}>{npc.name}</span>}
                </div>
              )
            })}

            {/* Panneau Joueur */}
            {(() => {
              const r = playerRect
              const playerImg = s.manga_player_panel_image
              const playerPortrait = protagonist ? (protagonist.portrait_url ?? protagonist.image_url ?? undefined) : undefined

              const inset = s.manga_player_portrait_inset ?? 0
              const rotate = s.manga_player_portrait_rotate ?? 0
              const posX = s.manga_player_portrait_pos_x ?? 0
              const posY = s.manga_player_portrait_pos_y ?? 0
              return (
                <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, overflow: 'hidden', background: s.manga_player_panel_bg_color ?? '#0d0d0d' }}>
                  {playerPortrait && (
                    <div style={{ position: 'absolute', top: inset, left: inset, right: inset, bottom: inset, overflow: 'hidden' }}>
                      <img src={playerPortrait} alt="" style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%', objectFit: 'cover', transform: `translate(calc(-50% + ${posX}px), calc(-50% + ${posY}px)) rotate(${rotate}deg)`, transformOrigin: 'center' }} />
                    </div>
                  )}
                  {playerImg && <img src={playerImg} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', mixBlendMode: (s.manga_player_blend_mode ?? 'normal') as React.CSSProperties['mixBlendMode'] }} />}
                </div>
              )
            })()}

            {interactive && <ResizeCorner onMouseDown={e => startDrag('manga_dialog_size', e)} />}
          </div>
        )
      })()}

      {/* ── Vignettes — positionnement individuel ───────────────────── */}
      {s.vignettes_show && vignettes.map((v, i) => {
        const pos = vigPositions[i]
        const sz = s.vignette_size * (i === 0 ? 1.15 : 1) * fs * 0.7
        const isVigDragging = dragging === `vignette_pos_${i}`
        return (
          <div key={i}
            onMouseDown={interactive ? e => startDrag('vignette_pos', e, i) : undefined}
            onClick={simMode && i > 0 && v.npc ? (e) => { e.stopPropagation(); openMangaDialogue(v.npc!) } : undefined}
            style={{ position: 'absolute', left: pos.x, top: pos.y, zIndex: 27, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', cursor: simMode && i > 0 && v.npc ? 'pointer' : interactive ? (isVigDragging ? 'grabbing' : 'grab') : 'default' }}>
            <div style={{ width: `${sz}px`, height: `${sz}px`, borderRadius: s.vignette_style === 'circle' ? '50%' : '6px', overflow: 'hidden', border: `2px solid ${i === 0 ? s.vignette_border_color : '#3a3a48'}`, background: '#1a1a1f', flexShrink: 0, pointerEvents: 'none' }}>
              {v.img
                ? <img src={v.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 10%' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${sz * 0.35}px`, opacity: 0.3 }}>🧑</div>
              }
            </div>
            <span style={{ fontSize: `${5 * fs}px`, color: i === 0 ? s.vignette_border_color : '#9898b4', fontFamily: 'Georgia, serif', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{v.name}</span>
          </div>
        )
      })}

      {/* ── Overlay dialogue manga (simulation) ─────────────────────────── */}
      {simMangaOpen && simActiveNpc && (() => {
        const dlg = liveMangaDialog
        const W = dlg.w, H = dlg.h
        const bgColor = s.manga_dialog_bg_color ?? '#0d0d0d'
        const nw = Math.round(W * (s.manga_npc_zone_ratio ?? 0.55))
        const pw = W - nw - 4
        const playerRect = s.manga_player_panel_rect ?? { x: nw + 4, y: 0, w: pw, h: H }
        const playerPortrait = protagonist?.portrait_emotions?.['neutre'] ?? protagonist?.portrait_url ?? protagonist?.image_url ?? undefined
        const playerImg = s.manga_player_panel_image ?? undefined

        // Même ordre que le tab Manga (mangaSelectedNpcs) pour que les portraits correspondent aux bons rects
        const simSceneNpcs = (mangaSelectedNpcs.length > 0
          ? mangaSelectedNpcs.map(id => npcs.find(n => n.id === id)).filter(Boolean) as import('@/types').Npc[]
          : sceneCompanions
        ).slice(0, 4)

        const dlgBorder = s.manga_dialog_border ? `${s.manga_dialog_border_width ?? 2}px solid ${s.manga_dialog_border_color ?? '#d4a84c'}` : 'none'
        const dlgBorderRadius = s.manga_dialog_border ? (s.manga_dialog_border_radius ?? 0) : 0
        const shadow = (() => {
          if (!s.manga_dialog_shadow) return 'none'
          const blur = s.manga_dialog_shadow_blur ?? 32
          const hex = s.manga_dialog_shadow_color ?? '#000000'
          const op = (s.manga_dialog_shadow_opacity ?? 80) / 100
          const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
          return `0 ${Math.round(blur/4)}px ${blur}px rgba(${r},${g},${b},${op})`
        })()

        return (
          <div onClick={closeMangaDialog} style={{ position: 'absolute', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)' }}>
            <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: dlg.x, top: dlg.y, width: W, height: H, background: bgColor, overflow: 'hidden', border: dlgBorder, borderRadius: dlgBorderRadius, boxShadow: shadow }}>

              {/* Panneaux NPC — ordre fixe (slots 0-3), opacité pilotée par simActiveBubbleId */}
              {simSceneNpcs.map((npc, idx) => {
                const rKey = `manga_npc_panel_rect_${idx}` as keyof import('@/types').SectionLayoutSettings
                const slotH = Math.round(H / simSceneNpcs.length)
                const defaultRect = { x: 0, y: idx * slotH, w: nw, h: slotH }
                const r = (s[rKey] as any) ?? defaultRect
                if (!r) return null
                const isActive = npc.id === simActiveNpc.id
                const isRevealed = simRevealedIds.includes(npc.id)
                const resp = simDialogueData?.npc_responses.find(r => r.npc_id === npc.id)
                // Portrait : émotion de simulation > émotion manga tab > neutre
                const emotion = simNpcEmotions[npc.id] ?? mangaEmotions[npc.id] ?? 'neutre'
                const firstEmotion = npc.portrait_emotions ? Object.values(npc.portrait_emotions).find(Boolean) : undefined
                const portrait = npc.portrait_emotions?.[emotion] || npc.portrait_url || npc.image_url || npc.character_illustrations?.[0] || firstEmotion || undefined
                const panelImgKey = `manga_panel_image_${idx + 1}` as keyof import('@/types').SectionLayoutSettings
                const panelImg = s[panelImgKey] as string | undefined
                const zIdx = ((s[`manga_npc_panel_zindex_${idx}` as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? (idx + 1))
                // Bulle visible uniquement si c'est le NPC actif dans la séquence
                const isBubbleActive = npc.id === simActiveBubbleId
                // canReveal : réponse dispo, pas encore révélé, hors loading
                const canReveal = !isRevealed && resp && simDialoguePhase !== 'loading'
                // Déjà révélé mais bulle cachée → cliquer pour revoir
                const canShowBubble = isRevealed && !isBubbleActive && resp
                const clickable = canReveal || canShowBubble
                return (
                  <div key={npc.id}
                    onClick={clickable ? e => {
                      e.stopPropagation()
                      if (!isRevealed) {
                        setSimRevealedIds(prev => [...prev, npc.id])
                        setSimNpcEmotions(prev => ({ ...prev, [npc.id]: resp!.emotion }))
                      }
                      setSimActiveBubbleId(npc.id)
                      setSimActiveNpc(npc)
                    } : isActive ? undefined : e => { e.stopPropagation(); setSimActiveNpc(npc) }}
                    style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, overflow: 'hidden', background: bgColor, zIndex: zIdx, opacity: simActiveBubbleId ? (isBubbleActive ? 1 : 0.35) : (isActive ? 0.85 : 0.5), cursor: clickable ? 'pointer' : isActive ? 'default' : 'pointer', transition: 'opacity 0.3s ease' }}>
                    {portrait && (
                      <img src={portrait} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
                    )}
                    {panelImg && <img src={panelImg} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', mixBlendMode: (s.manga_panel_blend_mode ?? 'normal') as any }} />}
                    {/* Nom NPC — visible tant que sa bulle n'est pas affichée */}
                    {isActive && !isBubbleActive && (
                      <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
                        <span style={{ fontFamily: 'Georgia, serif', fontSize: '7px', fontWeight: 700, color: s.manga_npc_name_color ?? '#d4a84c', textShadow: '0 1px 4px #000', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{npc.name}</span>
                      </div>
                    )}
                    {/* Texte CapCut — NPC actif dans la séquence */}
                    {isBubbleActive && resp && (
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 6px 6px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', pointerEvents: 'none' }}>
                        <p style={{ margin: 0, fontFamily: '"Arial Black", Arial, sans-serif', fontSize: '8.5px', fontWeight: 900, color: '#fff', lineHeight: 1.35, textAlign: 'center', textShadow: '0 0 10px #000, 0 2px 4px #000', letterSpacing: '0.03em' }}>
                          {simCaptionNpcId === npc.id
                            ? simCaptionText
                            : resp.text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim()}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Panneau joueur */}
              <div style={{ position: 'absolute', left: playerRect.x, top: playerRect.y, width: playerRect.w, height: playerRect.h, overflow: 'hidden', background: bgColor }}>
                {playerPortrait && (
                  <img src={playerPortrait} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
                )}
                {playerImg && <img src={playerImg} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', mixBlendMode: (s.manga_player_blend_mode ?? 'normal') as any }} />}
                {/* Texte CapCut — question joueur persistante */}
                {simPlayerBubbleVisible && simDialogueData?.player_question && (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 6px 6px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', pointerEvents: 'none' }}>
                    <p style={{ margin: 0, fontFamily: '"Arial Black", Arial, sans-serif', fontSize: '8px', fontWeight: 900, color: '#ffe580', lineHeight: 1.35, textAlign: 'center', textShadow: '0 0 10px #000, 0 2px 4px #000', letterSpacing: '0.03em' }}>
                      {simDialogueData.player_question}
                    </p>
                  </div>
                )}
              </div>
            </div>
            {/* Tap pour fermer */}
            <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.35)', fontFamily: 'Georgia, serif' }}>Appuyez pour fermer</span>
            </div>
          </div>
        )
      })()}

      {/* ── Overlay Préférences joueur ────────────────────────────── */}
      {showSettingsOverlay && settingsStep && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50 }} onClick={() => setShowSettingsOverlay(false)}>
          <SettingsStepPreview step={settingsStep} fullscreen />
        </div>
      )}
    </div>
  )
}

// ── Game Simulation Tab ───────────────────────────────────────────────────────

function GameSimTab({ bookId, sections, choices, npcs, protagonist, sectionLayout, introOrder, onNavigate, book }: {
  bookId: string
  sections: import('@/types').Section[]
  choices: import('@/types').Choice[]
  npcs: import('@/types').Npc[]
  protagonist: import('@/types').Npc | null
  sectionLayout: import('@/types').SectionLayoutDevice | null
  introOrder: import('@/types').IntroStep[] | null
  onNavigate: (tab: any) => void
  book: import('@/types').Book | null
}) {
  const DEF = SECTION_LAYOUT_DEFAULTS

  // BFS depuis section 1 pour trouver les 4 premiers noeuds atteignables
  const reachableNodes = React.useMemo(() => {
    const start = sections.find(s => s.number === 1)
    if (!start) return []
    const visited = new Set<string>()
    const queue = [start.id]
    const result: import('@/types').Section[] = []
    while (queue.length > 0 && result.length < 4) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const sec = sections.find(s => s.id === id)
      if (sec) result.push(sec)
      choices
        .filter(c => c.section_id === id && c.target_section_id && !visited.has(c.target_section_id!))
        .sort((a, b) => a.sort_order - b.sort_order)
        .forEach(c => queue.push(c.target_section_id!))
    }
    return result
  }, [sections, choices])

  const [currentId, setCurrentId] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (reachableNodes.length > 0 && !currentId) setCurrentId(reachableNodes[0].id)
  }, [reachableNodes])

  const phoneRef = React.useRef<HTMLDivElement>(null)
  const [phoneScale, setPhoneScale] = React.useState(1)
  React.useEffect(() => {
    const el = phoneRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      const s = Math.min(width / 390, height / 845, 1)
      setPhoneScale(s)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const currentSection = reachableNodes.find(s => s.id === currentId) ?? reachableNodes[0] ?? null
  const currentChoices = currentSection
    ? choices.filter(c => c.section_id === currentSection.id).sort((a, b) => a.sort_order - b.sort_order)
    : []

  const s: import('@/types').SectionLayoutSettings = { ...DEF, ...(sectionLayout?.phone ?? {}) }

  const settingsStep = React.useMemo(() => {
    const order = introOrder ?? DEFAULT_INTRO_ORDER
    return order.find(st => st.id === 'settings') ?? DEFAULT_INTRO_ORDER.find(st => st.id === 'settings')!
  }, [introOrder])

  const mangaEmotions = React.useMemo<Record<string, string>>(() => {
    try { const v = localStorage.getItem(`manga_emotions_${bookId}`); return v ? JSON.parse(v) : {} } catch { return {} }
  }, [bookId])
  const mangaSelectedNpcs = React.useMemo<string[]>(() => {
    try { const v = localStorage.getItem(`manga_selected_npcs_${bookId}`); return v ? JSON.parse(v) : [] } catch { return [] }
  }, [bookId])

  function handleChoice(choice: import('@/types').Choice) {
    if (!choice.target_section_id) return
    const target = reachableNodes.find(s => s.id === choice.target_section_id)
    if (target) setCurrentId(target.id)
  }

  if (reachableNodes.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
        <span style={{ fontSize: '2rem' }}>📭</span>
        <p style={{ margin: 0 }}>Aucune section trouvée — générez d'abord la structure du livre.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#08080c' }}>

      {/* ── Téléphone ── */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        <div ref={phoneRef} style={{ height: '92%', aspectRatio: '9 / 19.5', maxWidth: '46%', position: 'relative', borderRadius: '28px', overflow: 'hidden', background: '#000', border: '2px solid #2a2a30', boxShadow: '0 0 0 5px #161618, 0 16px 48px rgba(0,0,0,0.9)', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '80px', height: '10px', background: '#161618', borderRadius: '0 0 8px 8px', zIndex: 100 }} />
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <div style={{ width: '390px', height: '845px', transformOrigin: 'top left', transform: `scale(${phoneScale})` }}>
              {currentSection && (
                <SectionPreviewCard
                  s={s}
                  previewMode="phone"
                  scale={phoneScale}
                  protagonist={protagonist}
                  npcs={npcs}
                  section={currentSection}
                  sectionChoices={currentChoices}
                  onChoiceClick={handleChoice}
                  simMode
                  mangaSelectedNpcs={mangaSelectedNpcs}
                  mangaEmotions={mangaEmotions}
                  settingsStep={settingsStep}
                  book={book}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Panneau latéral — nœuds ── */}
      <div style={{ width: 260, background: '#0e0e14', borderLeft: '1px solid #1e1e28', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1rem 0.5rem', borderBottom: '1px solid #1e1e28' }}>
          <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>🎮 Nœuds chargés ({reachableNodes.length})</p>
          <p style={{ margin: '4px 0 0', fontSize: '0.6rem', color: 'var(--muted)' }}>BFS depuis §1 · cliquez pour naviguer</p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
          {reachableNodes.map((sec, i) => {
            const isCurrent = sec.id === currentId
            const secChoices = choices.filter(c => c.section_id === sec.id)
            return (
              <div key={sec.id} onClick={() => setCurrentId(sec.id)}
                style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: isCurrent ? 'rgba(212,168,76,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isCurrent ? '#d4a84c66' : '#1e1e28'}`, transition: 'border-color 0.15s' }}>
                <p style={{ margin: '0 0 3px', fontSize: '0.7rem', fontWeight: 700, color: isCurrent ? '#d4a84c' : '#ede9df' }}>§{sec.number}{i === 0 ? ' — Départ' : ''}</p>
                <p style={{ margin: '0 0 4px', fontSize: '0.62rem', color: 'var(--muted)', lineHeight: 1.4 }}>{(sec.summary ?? sec.content).slice(0, 60)}…</p>
                {secChoices.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {secChoices.map(c => {
                      const reaches = reachableNodes.find(n => n.id === c.target_section_id)
                      return (
                        <span key={c.id} style={{ fontSize: '0.55rem', padding: '1px 5px', borderRadius: 3, background: reaches ? 'rgba(212,168,76,0.12)' : 'rgba(255,255,255,0.05)', color: reaches ? '#d4a84c' : '#555' }}>→ §{sections.find(s => s.id === c.target_section_id)?.number ?? '?'}</span>
                      )
                    })}
                  </div>
                )}
                {sec.is_ending && <span style={{ fontSize: '0.55rem', color: '#e05555', marginTop: 3, display: 'block' }}>⚑ Fin</span>}
              </div>
            )
          })}
        </div>
        <div style={{ padding: '0.75rem', borderTop: '1px solid #1e1e28' }}>
          <button onClick={() => onNavigate('section_layout')} style={{ width: '100%', padding: '6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: '0.65rem', cursor: 'pointer' }}>
            ← Éditer la mise en page
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Dialogue Manga Tab ────────────────────────────────────────────────────────

const EMOTIONS = ['neutre', 'tendu', 'souriant', 'choc', 'triste'] as const
type Emotion = typeof EMOTIONS[number]

function MangaDialogTab({ bookId, npcs, protagonist, sectionLayout, onSaved }: {
  bookId: string
  npcs: import('@/types').Npc[]
  protagonist: import('@/types').Npc | null
  sectionLayout: import('@/types').SectionLayoutDevice | null
  onSaved: (layout: import('@/types').SectionLayoutDevice) => void
}) {
  const DEF = SECTION_LAYOUT_DEFAULTS
  const [layout, setLayout] = React.useState<import('@/types').SectionLayoutDevice>(sectionLayout ?? {})
  const layoutRef = React.useRef(layout)
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [uploadingSlot, setUploadingSlot] = React.useState<string | null>(null)
  const [assetTs, setAssetTs] = React.useState(() => Date.now())

  const s: import('@/types').SectionLayoutSettings = { ...DEF, ...(layout.phone ?? {}) }

  function updateLayout(key: keyof import('@/types').SectionLayoutSettings, value: any) {
    setLayout(prev => {
      const next = { ...prev, phone: { ...(prev.phone ?? {}), [key]: value } }
      layoutRef.current = next
      return next
    })
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      await fetch(`/api/books/${bookId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section_layout: layoutRef.current }) })
      onSaved(layoutRef.current)
      setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500)
    }, 800)
  }

  function updateDlgSize(key: 'w' | 'h', val: number) {
    const next = { ...liveDlgRef.current, [key]: val }
    liveDlgRef.current = next; setLiveDlg({ ...next })
    updateLayout('el_manga_dialog', next)
  }

  async function resetAll() {
    if (!confirm('Réinitialiser tous les assets et positions ?')) return
    const keys: (keyof import('@/types').SectionLayoutSettings)[] = [
      'manga_panel_image_1', 'manga_panel_image_2', 'manga_panel_image_3', 'manga_panel_image_4',
      'manga_player_panel_image',
      'manga_npc_panel_rect_0', 'manga_npc_panel_rect_1', 'manga_npc_panel_rect_2', 'manga_npc_panel_rect_3',
      'manga_player_panel_rect', 'manga_dialog_bg_color',
    ]
    const newPhone = { ...(layoutRef.current.phone ?? {}) }
    keys.forEach(k => delete (newPhone as any)[k])
    const newLayout = { ...layoutRef.current, phone: newPhone }
    layoutRef.current = newLayout
    setLayout(newLayout)
    const newDlg = DEF.el_manga_dialog
    liveDlgRef.current = newDlg; setLiveDlg(newDlg)
    const newRects = computeDefaultRects(newDlg)
    liveRectsRef.current = newRects; setLiveRects(newRects)
    setSaving(true)
    await fetch(`/api/books/${bookId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section_layout: newLayout }) })
    onSaved(newLayout)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  async function uploadStructureImage(slot: string, key: keyof import('@/types').SectionLayoutSettings, file: File) {
    setUploadingSlot(slot)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('path', `books/${bookId}/dialogue/${slot}`)
      const res = await fetch('/api/upload-file', { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const { url } = await res.json()
      if (!url) throw new Error('No URL returned')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const newLayoutObj = { ...layoutRef.current, phone: { ...(layoutRef.current.phone ?? {}), [key]: url } }
      layoutRef.current = newLayoutObj
      setLayout(newLayoutObj)
      setSaving(true)
      const saveRes = await fetch(`/api/books/${bookId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section_layout: newLayoutObj }) })
      if (!saveRes.ok) throw new Error(`Save failed: ${saveRes.status}`)
      onSaved(newLayoutObj)
      setAssetTs(Date.now())
      setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      alert(`Erreur: ${err.message}`)
      setSaving(false)
    }
    setUploadingSlot(null)
  }

  // Slots visibles dans la preview (slot key → boolean)
  const pvKey = `manga_preview_visible_${bookId}`
  const [previewVisible, setPreviewVisible] = React.useState<Set<string>>(() => {
    try { const s = localStorage.getItem(pvKey); return s ? new Set(JSON.parse(s)) : new Set() } catch { return new Set() }
  })
  const [previewZoom, setPreviewZoom] = React.useState(1)
  function togglePreview(slot: string) {
    setPreviewVisible(prev => {
      const n = new Set(prev); n.has(slot) ? n.delete(slot) : n.add(slot)
      try { localStorage.setItem(pvKey, JSON.stringify([...n])) } catch {}
      return n
    })
  }

  // ── Phone scale ───────────────────────────────────────────────────────────────
  const phoneRef = React.useRef<HTMLDivElement>(null)
  const [phoneScale, setPhoneScale] = React.useState(1)
  React.useEffect(() => {
    const el = phoneRef.current; if (!el) return
    const obs = new ResizeObserver(([e]) => { const w = e.contentRect.width; if (w > 0) setPhoneScale(w / 390) })
    obs.observe(el); return () => obs.disconnect()
  }, [])
  const ps = phoneScale || 1
  const PW = 390 * ps, PH = 845 * ps
  const nfsNpc = 13 * ps * 0.72

  // ── Preview state ─────────────────────────────────────────────────────────────
  const availableNpcs = npcs.filter(n => n.id !== protagonist?.id)
  const selectedKey  = `manga_selected_npcs_${bookId}`
  const emotionsKey  = `manga_emotions_${bookId}`
  const [selectedIds, setSelectedIds] = React.useState<string[]>(() => {
    try { const v = localStorage.getItem(selectedKey); return v ? JSON.parse(v) : availableNpcs.slice(0, 2).map(n => n.id) } catch { return availableNpcs.slice(0, 2).map(n => n.id) }
  })
  const [activeEmotions, setActiveEmotions] = React.useState<Record<string, Emotion>>(() => {
    try { const v = localStorage.getItem(emotionsKey); return v ? JSON.parse(v) : {} } catch { return {} }
  })
  const sceneNpcs = selectedIds.map(id => npcs.find(n => n.id === id)).filter(Boolean) as import('@/types').Npc[]

  function getPortrait(npc: import('@/types').Npc): string | undefined {
    const emotion = activeEmotions[npc.id] ?? 'neutre'
    return npc.portrait_emotions?.[emotion] ?? npc.image_url ?? undefined
  }

  // ── Dialog box & per-element rects (390-space, relatifs à la dialog box) ──────
  const dlgBase = s.el_manga_dialog ?? DEF.el_manga_dialog

  function computeDefaultRects(dlg: { w: number; h: number }) {
    const nw = Math.round(dlg.w * 0.55)
    const pw = dlg.w - nw - 4
    return {
      npc_0:         s.manga_npc_panel_rect_0  ?? { x: 0,      y: 0,            w: nw,      h: dlg.h },
      npc_1:         s.manga_npc_panel_rect_1  ?? { x: 0,      y: 0,            w: nw,      h: Math.round(dlg.h * 0.6) },
      npc_2:         s.manga_npc_panel_rect_2  ?? { x: 0,      y: Math.round(dlg.h * 0.6), w: nw,      h: Math.round(dlg.h * 0.4) },
      npc_3:         s.manga_npc_panel_rect_3  ?? { x: 0,      y: Math.round(dlg.h * 0.6), w: nw,      h: Math.round(dlg.h * 0.2) },
      player:        s.manga_player_panel_rect ?? { x: nw + 4, y: 0,            w: pw,      h: dlg.h },
    }
  }

  type RectKey = 'npc_0' | 'npc_1' | 'npc_2' | 'npc_3' | 'player'
  const RECT_TO_SETTING: Record<RectKey, keyof import('@/types').SectionLayoutSettings> = {
    npc_0: 'manga_npc_panel_rect_0', npc_1: 'manga_npc_panel_rect_1',
    npc_2: 'manga_npc_panel_rect_2', npc_3: 'manga_npc_panel_rect_3',
    player: 'manga_player_panel_rect',
  }

  const [liveDlg, setLiveDlg] = React.useState(dlgBase)
  const liveDlgRef = React.useRef(dlgBase)
  const [liveRects, setLiveRects] = React.useState(() => computeDefaultRects(dlgBase))
  const liveRectsRef = React.useRef(liveRects)

  // ── Drag ─────────────────────────────────────────────────────────────────────
  type DragTarget = 'dlg_pos' | 'dlg_size' | `${RectKey}_pos` | `${RectKey}_size`
  const dragTypeRef = React.useRef<DragTarget | null>(null)
  const dragStartRef = React.useRef({ x: 0, y: 0 })
  const dragStartValRef = React.useRef<any>(null)
  const isDraggingRef = React.useRef(false)

  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      const t = dragTypeRef.current; if (!t) return
      if (t === 'dlg_pos') {
        const next = { ...liveDlgRef.current, x: Math.max(0, dragStartValRef.current.x + dx / ps), y: Math.max(0, dragStartValRef.current.y + dy / ps) }
        liveDlgRef.current = next; setLiveDlg({ ...next })
      } else if (t === 'dlg_size') {
        const next = { ...liveDlgRef.current, w: Math.max(100, dragStartValRef.current.w + dx / ps), h: Math.max(60, dragStartValRef.current.h + dy / ps) }
        liveDlgRef.current = next; setLiveDlg({ ...next })
      } else {
        const isPos = t.endsWith('_pos')
        const key = (isPos ? t.slice(0, -4) : t.slice(0, -5)) as RectKey
        const start = dragStartValRef.current
        const next = isPos
          ? { ...start, x: start.x + dx / ps, y: start.y + dy / ps }
          : { ...start, w: Math.max(30, start.w + dx / ps), h: Math.max(20, start.h + dy / ps) }
        liveRectsRef.current = { ...liveRectsRef.current, [key]: next }
        setLiveRects({ ...liveRectsRef.current })
      }
    }
    function onUp() {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      const t = dragTypeRef.current; dragTypeRef.current = null
      if (t === 'dlg_pos' || t === 'dlg_size') updateLayout('el_manga_dialog', { ...liveDlgRef.current })
      else if (t) {
        const isPos = t.endsWith('_pos')
        const key = (isPos ? t.slice(0, -4) : t.slice(0, -5)) as RectKey
        const settingKey = RECT_TO_SETTING[key]
        if (settingKey) updateLayout(settingKey, liveRectsRef.current[key])
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [ps])

  function startDrag(e: React.MouseEvent, type: DragTarget) {
    e.preventDefault(); e.stopPropagation()
    isDraggingRef.current = true; dragTypeRef.current = type
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    if (type === 'dlg_pos') dragStartValRef.current = { x: liveDlgRef.current.x, y: liveDlgRef.current.y }
    else if (type === 'dlg_size') dragStartValRef.current = { w: liveDlgRef.current.w, h: liveDlgRef.current.h }
    else {
      const isPos = type.endsWith('_pos')
      const key = (isPos ? type.slice(0, -4) : type.slice(0, -5)) as RectKey
      dragStartValRef.current = { ...liveRectsRef.current[key] }
    }
  }

  // ── Handles drag visuels (taille fixe en px, pas scalée) ─────────────────────
  function mkHandle(type: DragTarget, pos: 'move' | 'resize') {
    const isMove = pos === 'move'
    const isDlg = type === 'dlg_pos' || type === 'dlg_size'
    return (
      <div
        onMouseDown={e => startDrag(e, type)}
        style={{
          position: 'absolute',
          ...(isMove ? { top: 0, left: 0 } : { bottom: 0, right: 0 }),
          width: 18, height: 18,
          cursor: isMove ? 'move' : 'nwse-resize',
          // Handles dialog sous les panneaux (zIndex 0) pour que les handles NPC soient toujours accessibles
          zIndex: isDlg ? 0 : 40,
          background: '#d4a84c',
          borderRadius: isMove ? '0 0 5px 0' : '5px 0 0 0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 1px 4px rgba(0,0,0,0.6)',
        }}
      >
        <span style={{ fontSize: '9px', color: '#0d0d0d', lineHeight: 1, userSelect: 'none', pointerEvents: 'none' }}>
          {isMove ? '✥' : '⊿'}
        </span>
      </div>
    )
  }

  // ── Upload slots ──────────────────────────────────────────────────────────────
  const STRUCTURE_SLOTS: { key: keyof import('@/types').SectionLayoutSettings; slot: string; label: string; desc: string; icon: string }[] = [
    { key: 'manga_panel_image_1',            slot: 'panel_1',           label: 'Panneau NPC 1',          desc: 'Asset PNG du 1er panneau NPC',                icon: '◧' },
    { key: 'manga_panel_image_2',            slot: 'panel_2',           label: 'Panneau NPC 2',          desc: 'Asset PNG du 2e panneau NPC',                 icon: '◧' },
    { key: 'manga_panel_image_3',            slot: 'panel_3',           label: 'Panneau NPC 3',          desc: 'Asset PNG du 3e panneau NPC',                 icon: '◧' },
    { key: 'manga_panel_image_4',            slot: 'panel_4',           label: 'Panneau NPC 4',          desc: 'Asset PNG du 4e panneau NPC',                 icon: '◧' },
    { key: 'manga_player_panel_image',       slot: 'player_panel',      label: 'Panneau Joueur',         desc: 'Asset PNG du panneau joueur (droite)',         icon: '▶' },
  ]

  function renderUploadSlot(slotDef: typeof STRUCTURE_SLOTS[number]) {
    const url = s[slotDef.key] as string | undefined
    const isUploading = uploadingSlot === slotDef.slot
    const visible = previewVisible.has(slotDef.slot)
    return (
      <div key={slotDef.slot} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.25rem 0', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: '0.8rem', opacity: 0.7, flexShrink: 0 }}>{slotDef.icon}</span>
        <span style={{ fontSize: '0.63rem', color: url ? 'var(--foreground)' : 'var(--muted)', flex: 1 }}>{slotDef.label}</span>
        {isUploading && <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>⏳</span>}
        {url && !isUploading && (
          <button onClick={() => { updateLayout(slotDef.key, null); setPreviewVisible(p => { const n = new Set(p); n.delete(slotDef.slot); try { localStorage.setItem(pvKey, JSON.stringify([...n])) } catch {} return n }) }} style={{ background: 'none', border: '1px solid #c94c4c44', borderRadius: '3px', color: '#c94c4c', cursor: 'pointer', fontSize: '0.55rem', padding: '1px 5px', flexShrink: 0 }}>✕</button>
        )}
        <label style={{ cursor: 'pointer', flexShrink: 0 }} title={url ? 'Remplacer' : 'Uploader'}>
          <input type="file" accept="image/png,image/webp,image/jpeg" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadStructureImage(slotDef.slot, slotDef.key, f) }} />
          <div style={{ width: 24, height: 24, borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1 }}>↑</span>
          </div>
        </label>
        <button onClick={() => togglePreview(slotDef.slot)} title={visible ? 'Retirer de la preview' : 'Ajouter à la preview'}
          style={{ width: 24, height: 24, borderRadius: '4px', border: `1px solid ${visible ? '#d4a84c' : 'var(--border)'}`, background: visible ? 'rgba(212,168,76,0.18)' : 'var(--surface-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '0.75rem', color: visible ? '#d4a84c' : 'var(--muted)', lineHeight: 1 }}>{visible ? '−' : '+'}</span>
        </button>
      </div>
    )
  }

  const dlg = liveDlg
  const bgColor = s.manga_dialog_bg_color ?? '#0d0d0d'
  const dialogShadow = (() => {
    if (!s.manga_dialog_shadow) return 'none'
    const blur = s.manga_dialog_shadow_blur ?? 32
    const hex = s.manga_dialog_shadow_color ?? '#000000'
    const op = (s.manga_dialog_shadow_opacity ?? 80) / 100
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `0 ${Math.round(blur / 4)}px ${blur}px rgba(${r},${g},${b},${op})`
  })()
  const dlgBorder = s.manga_dialog_border ? `${s.manga_dialog_border_width ?? 2}px solid ${s.manga_dialog_border_color ?? '#d4a84c'}` : 'none'
  const dlgBorderRadius = s.manga_dialog_border ? (s.manga_dialog_border_radius ?? 0) : 0
  const bust = (url: string | undefined) => url ? `${url}?t=${assetTs}` : undefined

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* ── Panneau gauche ── */}
      <div style={{ width: '340px', flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>🎭 Dialogue Manga</span>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.6rem', color: 'var(--muted)' }}>Assets PNG de la boite de dialogue.</p>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            {(saving || saved) && <span style={{ fontSize: '0.62rem', color: saved ? '#4caf7d' : 'var(--muted)' }}>{saved ? '✓ Sauvegardé' : '⏳'}</span>}
            <button onClick={resetAll} style={{ marginLeft: 'auto', fontSize: '0.58rem', padding: '2px 8px', border: '1px solid #c94c4c55', borderRadius: '4px', background: 'none', color: '#c94c4c99', cursor: 'pointer' }}>↺ Reset</button>
          </div>
        </div>
        <div style={{ flexGrow: 1, height: 0, overflowY: 'auto', padding: '0.75rem', scrollbarWidth: 'thin', scrollbarColor: '#3a3a48 transparent' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

            {/* Assets */}
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Assets</span>
            {STRUCTURE_SLOTS.map(slot => renderUploadSlot(slot))}

            <div style={{ height: '1px', background: 'var(--border)' }} />

            {/* Dimensions boite de dialogue */}
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Boite de dialogue</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Ombre portée</span>
              <button onClick={() => updateLayout('manga_dialog_shadow', !(s.manga_dialog_shadow ?? false))}
                style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '0.62rem', cursor: 'pointer', border: `1px solid ${(s.manga_dialog_shadow ?? false) ? '#d4a84c' : 'var(--border)'}`, background: (s.manga_dialog_shadow ?? false) ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)', color: (s.manga_dialog_shadow ?? false) ? '#d4a84c' : 'var(--muted)' }}>
                {(s.manga_dialog_shadow ?? false) ? '● Activée' : '○ Désactivée'}
              </button>
            </div>
            {(s.manga_dialog_shadow ?? false) && (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Flou</span>
                <input type="range" min={0} max={80} value={s.manga_dialog_shadow_blur ?? 32} onChange={e => updateLayout('manga_dialog_shadow_blur', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{s.manga_dialog_shadow_blur ?? 32}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Couleur</span>
                <input type="color" value={s.manga_dialog_shadow_color ?? '#000000'} onChange={e => updateLayout('manga_dialog_shadow_color', e.target.value)} style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px' }}>Opacité</span>
                <input type="range" min={0} max={100} value={s.manga_dialog_shadow_opacity ?? 80} onChange={e => updateLayout('manga_dialog_shadow_opacity', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '24px', textAlign: 'right' }}>{s.manga_dialog_shadow_opacity ?? 80}</span>
              </div>
            </>)}
            {/* Bordure container */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Bordure</span>
              <button onClick={() => updateLayout('manga_dialog_border', !(s.manga_dialog_border ?? false))}
                style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '0.62rem', cursor: 'pointer', border: `1px solid ${(s.manga_dialog_border ?? false) ? '#d4a84c' : 'var(--border)'}`, background: (s.manga_dialog_border ?? false) ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)', color: (s.manga_dialog_border ?? false) ? '#d4a84c' : 'var(--muted)' }}>
                {(s.manga_dialog_border ?? false) ? '● Activée' : '○ Désactivée'}
              </button>
            </div>
            {(s.manga_dialog_border ?? false) && (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Épaisseur</span>
                <input type="range" min={1} max={12} value={s.manga_dialog_border_width ?? 2} onChange={e => updateLayout('manga_dialog_border_width', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{s.manga_dialog_border_width ?? 2}px</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Couleur</span>
                <input type="color" value={s.manga_dialog_border_color ?? '#d4a84c'} onChange={e => updateLayout('manga_dialog_border_color', e.target.value)} style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '50px' }}>Arrondi</span>
                <input type="range" min={0} max={24} value={s.manga_dialog_border_radius ?? 0} onChange={e => updateLayout('manga_dialog_border_radius', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '24px', textAlign: 'right' }}>{s.manga_dialog_border_radius ?? 0}px</span>
              </div>
            </>)}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Largeur</span>
              <input type="range" min={100} max={390} value={Math.round(liveDlg.w)} onChange={e => updateDlgSize('w', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '32px', textAlign: 'right' }}>{Math.round(liveDlg.w)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Hauteur</span>
              <input type="range" min={60} max={845} value={Math.round(liveDlg.h)} onChange={e => updateDlgSize('h', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '32px', textAlign: 'right' }}>{Math.round(liveDlg.h)}</span>
            </div>

            <div style={{ height: '1px', background: 'var(--border)' }} />

            {/* Style */}
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Style</span>

            {/* Fond */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Fond dialogue</span>
              <input type="color" value={bgColor} onChange={e => updateLayout('manga_dialog_bg_color', e.target.value)} style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
              <span style={{ fontSize: '0.65rem', color: bgColor }}>{bgColor}</span>
            </div>

            {/* ── Nom PNJ ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Couleur nom PNJ</span>
              <input type="color" value={s.manga_npc_name_color ?? '#d4a84c'} onChange={e => updateLayout('manga_npc_name_color', e.target.value)} style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
              <span style={{ fontSize: '0.65rem', color: s.manga_npc_name_color ?? '#d4a84c' }}>{s.manga_npc_name_color ?? '#d4a84c'}</span>
            </div>

            {/* ── Fond panneaux ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Fond panneaux NPC</span>
              <input type="color" value={s.manga_panel_bg_color ?? '#0d0d0d'} onChange={e => updateLayout('manga_panel_bg_color', e.target.value)} style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{s.manga_panel_bg_color ?? '#0d0d0d'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Blend NPC</span>
              {(['normal', 'multiply', 'screen', 'overlay'] as const).map(m => (
                <button key={m} onClick={() => updateLayout('manga_panel_blend_mode', m)}
                  style={{ flex: 1, padding: '2px 0', borderRadius: '4px', fontSize: '0.52rem', cursor: 'pointer', border: `1px solid ${(s.manga_panel_blend_mode ?? 'normal') === m ? '#d4a84c' : 'var(--border)'}`, background: (s.manga_panel_blend_mode ?? 'normal') === m ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)', color: (s.manga_panel_blend_mode ?? 'normal') === m ? '#d4a84c' : 'var(--muted)' }}>
                  {m}
                </button>
              ))}
            </div>
            {([0, 1, 2, 3] as const).map(i => {
              const insetKey  = `manga_panel_portrait_inset_${i}`  as keyof import('@/types').SectionLayoutSettings
              const rotKey    = `manga_panel_portrait_rotate_${i}` as keyof import('@/types').SectionLayoutSettings
              const posXKey   = `manga_panel_portrait_pos_x_${i}`  as keyof import('@/types').SectionLayoutSettings
              const posYKey   = `manga_panel_portrait_pos_y_${i}`  as keyof import('@/types').SectionLayoutSettings
              const zKey      = `manga_npc_panel_zindex_${i}`       as keyof import('@/types').SectionLayoutSettings
              const inset = (s[insetKey] as number | undefined) ?? 0
              const rot   = (s[rotKey]   as number | undefined) ?? 0
              const posX  = (s[posXKey]  as number | undefined) ?? 0
              const posY  = (s[posYKey]  as number | undefined) ?? 0
              const zVal  = (s[zKey]     as number | undefined) ?? (i + 1)
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.58rem', color: '#d4a84c', fontWeight: 600 }}>◧ NPC {i + 1}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '50px' }}>Inset</span>
                    <input type="range" min={0} max={60} value={inset} onChange={e => updateLayout(insetKey, Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: '0.6rem', color: 'var(--foreground)', minWidth: '20px', textAlign: 'right' }}>{inset}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '50px' }}>Rotation</span>
                    <input type="range" min={-180} max={180} value={rot} onChange={e => updateLayout(rotKey, Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: '0.6rem', color: 'var(--foreground)', minWidth: '30px', textAlign: 'right' }}>{rot}°</span>
                    {rot !== 0 && <button onClick={() => updateLayout(rotKey, 0)} style={{ fontSize: '0.5rem', padding: '1px 4px', border: '1px solid var(--border)', borderRadius: '3px', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>↺</button>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '50px' }}>X</span>
                    <input type="range" min={-100} max={100} value={posX} onChange={e => updateLayout(posXKey, Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: '0.6rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{posX}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '50px' }}>Y</span>
                    <input type="range" min={-100} max={100} value={posY} onChange={e => updateLayout(posYKey, Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: '0.6rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{posY}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '50px' }}>Avant-plan</span>
                    <input type="range" min={1} max={4} step={1} value={zVal} onChange={e => updateLayout(zKey, Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: '0.6rem', color: 'var(--foreground)', minWidth: '16px', textAlign: 'right' }}>{zVal}</span>
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Fond panneau joueur</span>
              <input type="color" value={s.manga_player_panel_bg_color ?? '#0d0d0d'} onChange={e => updateLayout('manga_player_panel_bg_color', e.target.value)} style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{s.manga_player_panel_bg_color ?? '#0d0d0d'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '110px', flexShrink: 0 }}>Blend joueur</span>
              {(['normal', 'multiply', 'screen', 'overlay'] as const).map(m => (
                <button key={m} onClick={() => updateLayout('manga_player_blend_mode', m)}
                  style={{ flex: 1, padding: '2px 0', borderRadius: '4px', fontSize: '0.52rem', cursor: 'pointer', border: `1px solid ${(s.manga_player_blend_mode ?? 'normal') === m ? '#4caf7d' : 'var(--border)'}`, background: (s.manga_player_blend_mode ?? 'normal') === m ? 'rgba(76,175,125,0.15)' : 'var(--surface-2)', color: (s.manga_player_blend_mode ?? 'normal') === m ? '#4caf7d' : 'var(--muted)' }}>
                  {m}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.58rem', color: '#4caf7d', fontWeight: 600 }}>▶ Joueur</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '50px' }}>Inset</span>
                <input type="range" min={0} max={60} value={s.manga_player_portrait_inset ?? 0} onChange={e => updateLayout('manga_player_portrait_inset', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.6rem', color: 'var(--foreground)', minWidth: '20px', textAlign: 'right' }}>{s.manga_player_portrait_inset ?? 0}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '50px' }}>Rotation</span>
                <input type="range" min={-180} max={180} value={s.manga_player_portrait_rotate ?? 0} onChange={e => updateLayout('manga_player_portrait_rotate', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.6rem', color: 'var(--foreground)', minWidth: '30px', textAlign: 'right' }}>{s.manga_player_portrait_rotate ?? 0}°</span>
                {(s.manga_player_portrait_rotate ?? 0) !== 0 && <button onClick={() => updateLayout('manga_player_portrait_rotate', 0)} style={{ fontSize: '0.5rem', padding: '1px 4px', border: '1px solid var(--border)', borderRadius: '3px', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>↺</button>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '50px' }}>X</span>
                <input type="range" min={-100} max={100} value={s.manga_player_portrait_pos_x ?? 0} onChange={e => updateLayout('manga_player_portrait_pos_x', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.6rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{s.manga_player_portrait_pos_x ?? 0}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '50px' }}>Y</span>
                <input type="range" min={-100} max={100} value={s.manga_player_portrait_pos_y ?? 0} onChange={e => updateLayout('manga_player_portrait_pos_y', Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.6rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{s.manga_player_portrait_pos_y ?? 0}</span>
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--border)' }} />

            {/* Preview controls */}
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preview</span>

            {/* PNJ dans la scène */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>PNJ dans la scène (max 4)</span>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {availableNpcs.map(npc => {
                  const sel = selectedIds.includes(npc.id)
                  return (
                    <button key={npc.id} onClick={() => setSelectedIds(p => { const n = sel ? p.filter(x => x !== npc.id) : [...p, npc.id].slice(0, 4); try { localStorage.setItem(selectedKey, JSON.stringify(n)) } catch {} return n })}
                      style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer', border: `1px solid ${sel ? '#d4a84c' : 'var(--border)'}`, background: sel ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)', color: sel ? '#d4a84c' : 'var(--muted)' }}>
                      {sel ? '✓' : '+'} {npc.name}
                    </button>
                  )
                })}
                {availableNpcs.length === 0 && <span style={{ fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucun PNJ dans ce livre</span>}
              </div>
            </div>

            {/* Émotions par PNJ */}
            {sceneNpcs.map(npc => (
              <div key={npc.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {npc.image_url && <img src={npc.image_url} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />}
                  <span style={{ fontSize: '0.63rem', fontWeight: 600, color: 'var(--foreground)' }}>{npc.name}</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {EMOTIONS.map(em => {
                    const hasImg = !!npc.portrait_emotions?.[em]
                    const isActive = (activeEmotions[npc.id] ?? 'neutre') === em
                    return (
                      <button key={em} onClick={() => setActiveEmotions(p => { const n = { ...p, [npc.id]: em }; try { localStorage.setItem(emotionsKey, JSON.stringify(n)) } catch {} return n })}
                        style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '0.57rem', cursor: 'pointer', border: `1px solid ${isActive ? '#d4a84c' : hasImg ? 'var(--border)' : 'rgba(100,100,120,0.3)'}`, background: isActive ? 'rgba(212,168,76,0.18)' : hasImg ? 'var(--surface-2)' : 'transparent', color: isActive ? '#d4a84c' : hasImg ? 'var(--foreground)' : 'var(--muted)', opacity: hasImg ? 1 : 0.5 }}>
                        {em}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

          </div>
        </div>
      </div>

      {/* ── Preview ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--surface)', padding: '1rem', overflow: 'hidden', gap: '0.5rem' }}>

        {/* Zoom bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>🔍</span>
          <input type="range" min={0.4} max={2} step={0.05} value={previewZoom} onChange={e => setPreviewZoom(Number(e.target.value))} style={{ width: '120px', accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: '0.6rem', color: 'var(--muted)', minWidth: '32px' }}>{Math.round(previewZoom * 100)}%</span>
          <button onClick={() => setPreviewZoom(1)} style={{ fontSize: '0.55rem', padding: '1px 6px', border: '1px solid var(--border)', borderRadius: '3px', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>1:1</button>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', width: '100%' }}>
        <div ref={phoneRef} style={{ position: 'relative', height: `${100 * previewZoom}%`, aspectRatio: '9 / 19.5', maxWidth: `${100 * previewZoom}%`, borderRadius: '28px', overflow: 'hidden', background: '#0d0d0d', border: '2px solid #2a2a30', boxShadow: '0 0 0 5px #161618, 0 16px 48px rgba(0,0,0,0.9)', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '80px', height: '10px', background: '#161618', borderRadius: '0 0 8px 8px', zIndex: 100 }} />

          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <div style={{ width: PW, height: PH, position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, #1a1a22 0%, #0d0d10 60%)' }} />

              {sceneNpcs.length > 0 && (
                <div
                  onMouseDown={e => { if (e.target === e.currentTarget) startDrag(e, 'dlg_pos') }}
                  style={{ position: 'absolute', left: dlg.x * ps, top: dlg.y * ps, width: dlg.w * ps, height: dlg.h * ps, background: bgColor, outline: '1px dashed rgba(212,168,76,0.35)', boxShadow: dialogShadow, border: dlgBorder, borderRadius: dlgBorderRadius, cursor: 'move' }}>
                  {mkHandle('dlg_pos', 'move')}
                  {mkHandle('dlg_size', 'resize')}

                  {/* Panneaux NPC — indépendants des NPCs sélectionnés */}
                  {([1, 2, 3, 4] as const).map(n => {
                    if (!previewVisible.has(`panel_${n}`)) return null
                    const rKey = `npc_${n - 1}` as RectKey
                    const r = liveRects[rKey]
                    const panelImg = s[`manga_panel_image_${n}` as keyof import('@/types').SectionLayoutSettings] as string | undefined
                    const npc = sceneNpcs[n - 1]
                    const portrait = npc ? getPortrait(npc) : undefined
                    const zIdx = (s[`manga_npc_panel_zindex_${n - 1}` as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? n
                    return (
                      <div key={`panel_${n}`} style={{ position: 'absolute', left: r.x * ps, top: r.y * ps, width: r.w * ps, height: r.h * ps, overflow: 'hidden', outline: '1px solid rgba(212,168,76,0.4)', background: s.manga_panel_bg_color ?? '#0d0d0d', zIndex: zIdx }}>
                        {(() => {
                          const idx = n - 1
                          const inset  = ((s[`manga_panel_portrait_inset_${idx}`  as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? 0) * ps
                          const rotate = ((s[`manga_panel_portrait_rotate_${idx}` as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? 0)
                          const posX   = ((s[`manga_panel_portrait_pos_x_${idx}`  as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? 50)
                          const posY   = ((s[`manga_panel_portrait_pos_y_${idx}`  as keyof import('@/types').SectionLayoutSettings] as number | undefined) ?? 20)
                          return portrait
                            ? <div style={{ position: 'absolute', top: inset, left: inset, right: inset, bottom: inset, overflow: 'hidden' }}>
                                <img src={portrait} alt="" style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%', objectFit: 'cover', transform: `translate(calc(-50% + ${posX}px), calc(-50% + ${posY}px)) rotate(${rotate}deg)`, transformOrigin: 'center' }} />
                              </div>
                            : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.12)', fontSize: `${r.h * ps * 0.35}px` }}>🧑</div>
                        })()}
                        {panelImg && <img src={bust(panelImg)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', mixBlendMode: (s.manga_panel_blend_mode ?? 'normal') as React.CSSProperties['mixBlendMode'] }} />}
                        {npc && <span style={{ position: 'absolute', bottom: 3 * ps, left: 4 * ps, fontSize: `${nfsNpc * 0.75}px`, color: s.manga_npc_name_color ?? '#d4a84c', fontFamily: 'Georgia, serif', fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,0.9)', zIndex: 2 }}>{npc.name}</span>}
                        {mkHandle(`${rKey}_pos` as DragTarget, 'move')}
                        {mkHandle(`${rKey}_size` as DragTarget, 'resize')}
                      </div>
                    )
                  })}

                  {/* Panneau Joueur */}
                  {previewVisible.has('player_panel') && (() => {
                    const r = liveRects.player
                    const playerImg = s.manga_player_panel_image
                    const playerPortrait = protagonist ? getPortrait(protagonist) : undefined
                    return (
                      <div style={{ position: 'absolute', left: r.x * ps, top: r.y * ps, width: r.w * ps, height: r.h * ps, overflow: 'hidden', outline: '1px solid rgba(76,175,125,0.4)', background: s.manga_player_panel_bg_color ?? '#0d0d0d' }}>
                        {(() => {
                          const inset  = (s.manga_player_portrait_inset  ?? 0)  * ps
                          const rotate = s.manga_player_portrait_rotate   ?? 0
                          const posX   = s.manga_player_portrait_pos_x    ?? 50
                          const posY   = s.manga_player_portrait_pos_y    ?? 20
                          return playerPortrait
                            ? <div style={{ position: 'absolute', top: inset, left: inset, right: inset, bottom: inset, overflow: 'hidden' }}>
                                <img src={playerPortrait} alt="" style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%', objectFit: 'cover', transform: `translate(calc(-50% + ${posX}px), calc(-50% + ${posY}px)) rotate(${rotate}deg)`, transformOrigin: 'center' }} />
                              </div>
                            : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.12)', fontSize: `${r.h * ps * 0.35}px` }}>🧑</div>
                        })()}
                        {playerImg && <img src={bust(playerImg)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', mixBlendMode: (s.manga_player_blend_mode ?? 'normal') as React.CSSProperties['mixBlendMode'] }} />}
                        <span style={{ position: 'absolute', bottom: 3 * ps, right: 4 * ps, fontSize: `${nfsNpc * 0.75}px`, color: '#4caf7d', fontFamily: 'Georgia, serif', fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,0.9)', zIndex: 2 }}>Joueur</span>
                        {mkHandle('player_pos', 'move')}
                        {mkHandle('player_size', 'resize')}
                      </div>
                    )
                  })()}

                </div>
              )}

              {sceneNpcs.length === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: 'var(--muted)', fontSize: `${14 * ps}px`, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>Sélectionnez des PNJ dans la scène</span>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

function SectionLayoutTab({ bookId, sectionLayout, protagonist, npcs, sections, introOrder, onSaved }: {
  bookId: string
  sectionLayout: import('@/types').SectionLayoutDevice | null
  protagonist: import('@/types').Npc | null
  npcs: import('@/types').Npc[]
  sections: import('@/types').Section[]
  introOrder: import('@/types').IntroStep[] | null
  onSaved: (layout: import('@/types').SectionLayoutDevice) => void
}) {
  const [previewMode, setPreviewMode] = React.useState<'phone' | 'tablet'>('phone')
  const [layout, setLayout] = React.useState<import('@/types').SectionLayoutDevice>(sectionLayout ?? {})
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const phoneRef = React.useRef<HTMLDivElement>(null)
  const [phoneScale, setPhoneScale] = React.useState(1)

  const settingsStep = React.useMemo(() => {
    const order = introOrder ?? DEFAULT_INTRO_ORDER
    return order.find(s => s.id === 'settings') ?? DEFAULT_INTRO_ORDER.find(s => s.id === 'settings')!
  }, [introOrder])

  // Lecture des sélections sauvegardées par MangaDialogTab
  const mangaSelectedNpcs = React.useMemo<string[]>(() => {
    try { const v = localStorage.getItem(`manga_selected_npcs_${bookId}`); return v ? JSON.parse(v) : [] } catch { return [] }
  }, [bookId])
  const mangaEmotions = React.useMemo<Record<string, string>>(() => {
    try { const v = localStorage.getItem(`manga_emotions_${bookId}`); return v ? JSON.parse(v) : {} } catch { return {} }
  }, [bookId])

  React.useEffect(() => {
    const el = phoneRef.current
    if (!el) return
    const obs = new ResizeObserver(([e]) => { const w = e.contentRect.width; if (w > 0) setPhoneScale(w / 390) })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Settings actifs selon le device
  const ds: import('@/types').SectionLayoutSettings = previewMode === 'tablet'
    ? { ...SECTION_LAYOUT_DEFAULTS, ...(layout.phone ?? {}), ...(layout.tablet ?? {}) }
    : { ...SECTION_LAYOUT_DEFAULTS, ...(layout.phone ?? {}) }

  const layoutRef = React.useRef(layout)
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  function update(key: keyof import('@/types').SectionLayoutSettings, value: any) {
    const device = previewMode === 'tablet' ? 'tablet' : 'phone'
    setLayout(prev => {
      const next = { ...prev, [device]: { ...(prev[device] ?? {}), [key]: value } }
      layoutRef.current = next
      return next
    })
    scheduleAutoSave()
  }

  function scheduleAutoSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section_layout: layoutRef.current }),
      })
      onSaved(layoutRef.current)
      setSaving(false); setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }, 800)
  }

  async function save() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaving(true)
    await fetch(`/api/books/${bookId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_layout: layoutRef.current }),
    })
    onSaved(layoutRef.current)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const [openSections, setOpenSections] = React.useState<Set<string>>(
    new Set<string>()
  )
  const toggleSection = (key: string) => setOpenSections(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  const slider = (key: keyof import('@/types').SectionLayoutSettings, label: string, min: number, max: number, unit = '') => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '90px', flexShrink: 0 }}>{label}</span>
      <input type="range" min={min} max={max} value={ds[key] as number}
        onChange={e => update(key, Number(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--accent)' }} />
      <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '30px', textAlign: 'right' }}>{ds[key] as number}{unit}</span>
    </div>
  )
  const toggle = (key: keyof import('@/types').SectionLayoutSettings, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--foreground)' }}>{label}</span>
      <button onClick={() => update(key, !ds[key])} style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer', border: `1px solid ${ds[key] ? '#4caf7d' : 'var(--border)'}`, background: ds[key] ? '#4caf7d22' : 'var(--surface-2)', color: ds[key] ? '#4caf7d' : 'var(--muted)' }}>
        {ds[key] ? '✓ Oui' : 'Non'}
      </button>
    </div>
  )
  const colorPicker = (key: keyof import('@/types').SectionLayoutSettings, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '90px', flexShrink: 0 }}>{label}</span>
      <input type="color" value={ds[key] as string} onChange={e => update(key, e.target.value)}
        style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
      <span style={{ fontSize: '0.65rem', color: ds[key] as string }}>{ds[key] as string}</span>
    </div>
  )
  const accordion = (key: string, title: string, children: React.ReactNode) => {
    const isOpen = openSections.has(key)
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
        <button onClick={() => toggleSection(key)} style={{ width: '100%', padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: isOpen ? 'rgba(255,255,255,0.04)' : 'transparent', border: 'none', textAlign: 'left' }}>
          <span style={{ fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{title}</span>
          <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
        </button>
        {isOpen && (
          <div style={{ padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.55rem', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
            {children}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Panneau gauche — accordéon */}
      <div style={{ width: '340px', flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {/* Header fixe */}
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Écran Section</span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {(['phone', 'tablet'] as const).map(m => (
                <button key={m} onClick={() => setPreviewMode(m)} style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '0.6rem', cursor: 'pointer', border: `1px solid ${previewMode === m ? (m === 'tablet' ? '#4c9bf0' : '#d4a84c') : 'var(--border)'}`, background: previewMode === m ? (m === 'tablet' ? 'rgba(76,155,240,0.12)' : 'rgba(212,168,76,0.12)') : 'var(--surface-2)', color: previewMode === m ? (m === 'tablet' ? '#4c9bf0' : '#d4a84c') : 'var(--muted)' }}>
                  {m === 'phone' ? '📱' : '📟'} {m === 'phone' ? 'Tél.' : 'Tablette'}
                </button>
              ))}
              {previewMode === 'tablet' && (
                <button
                  onClick={() => {
                    const phoneSettings = layout.phone ?? {}
                    setLayout(prev => {
                      const next = { ...prev, tablet: { ...phoneSettings } }
                      layoutRef.current = next
                      return next
                    })
                    scheduleAutoSave()
                  }}
                  title="Copie tous les settings phone vers tablette"
                  style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.58rem', cursor: 'pointer', border: '1px solid rgba(76,155,240,0.4)', background: 'rgba(76,155,240,0.08)', color: '#4c9bf0' }}>
                  ← depuis 📱
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {saving && <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>⏳</span>}
            {saved && !saving && <span style={{ fontSize: '0.6rem', color: '#4caf7d' }}>✓ Sauvegardé</span>}
            <button onClick={save} title="Forcer la sauvegarde" style={{ padding: '3px 10px', borderRadius: '6px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: '0.65rem', cursor: 'pointer' }}>↑</button>
          </div>
        </div>

        {/* Accordéons — scrollable avec ascenseur fin */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}>

          {accordion('photo', '🖼 Illustration', <>
            <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic' }}>Déplacer dans le preview · ↘ coin bas-droit pour redimensionner</p>
            <button onClick={() => update('el_photo', SECTION_LAYOUT_DEFAULTS.el_photo)} style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)' }}>
              ⛶ Remettre en plein écran
            </button>
            {toggle('photo_border', 'Bordure')}
            {ds.photo_border && slider('photo_border_width', 'Épaisseur', 1, 12, 'px')}
            {toggle('photo_shadow', 'Ombre')}
            {colorPicker('photo_bg', 'Fond')}
          </>)}

          {accordion('text', '📝 Texte narratif', <>
            <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic' }}>Panneau texte séparé des choix · déplacer + redimensionner dans le preview</p>
            {slider('text_font_size', 'Taille police', 10, 22, 'px')}
            {slider('text_bg_opacity', 'Opacité fond', 0, 100, '%')}
            {slider('text_padding', 'Padding', 4, 40, 'px')}
            {toggle('text_gradient', 'Fondu (haut → bas)')}
            {colorPicker('text_bg_color', 'Couleur fond')}
          </>)}

          {accordion('choices', '🔘 Boutons de choix', <>
            <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic' }}>Panneau choix séparé du texte · déplacer + redimensionner dans le preview</p>
            {slider('overlay_opacity', 'Opacité fond', 0, 100, '%')}
            {slider('choices_font_size', 'Taille police', 8, 24, 'px')}
            {slider('choices_border_radius', 'Arrondi bordure', 0, 24, 'px')}
            {/* Police */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '90px', flexShrink: 0 }}>Police</span>
              {(['sans', 'serif', 'mono'] as const).map(v => (
                <button key={v} onClick={() => update('choices_font_family', v)} style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer', border: `1px solid ${ds.choices_font_family === v ? '#d4a84c' : 'var(--border)'}`, background: ds.choices_font_family === v ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)', color: ds.choices_font_family === v ? '#d4a84c' : 'var(--muted)' }}>
                  {v}
                </button>
              ))}
            </div>
            {/* Style */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '90px', flexShrink: 0 }}>Style</span>
              {(['choices_italic', 'choices_bold'] as const).map(k => (
                <button key={k} onClick={() => update(k, !ds[k])} style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer', border: `1px solid ${ds[k] ? '#d4a84c' : 'var(--border)'}`, background: ds[k] ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)', color: ds[k] ? '#d4a84c' : 'var(--muted)', fontStyle: k === 'choices_italic' ? 'italic' : 'normal', fontWeight: k === 'choices_bold' ? 700 : 400 }}>
                  {k === 'choices_italic' ? 'I' : 'B'}
                </button>
              ))}
            </div>
            {colorPicker('choices_text_color', 'Couleur texte')}
            {colorPicker('choices_active_color', 'Couleur actif')}
            {(['choices_bg', 'choices_active_bg', 'choices_border_color', 'choices_active_border'] as const).map(k => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '90px', flexShrink: 0 }}>
                  {k === 'choices_bg' ? 'Fond normal' : k === 'choices_active_bg' ? 'Fond actif' : k === 'choices_border_color' ? 'Bordure' : 'Bordure active'}
                </span>
                <input type="text" value={ds[k] as string ?? ''} onChange={e => update(k, e.target.value)}
                  style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--fg)', fontSize: '0.62rem', padding: '2px 6px' }} />
              </div>
            ))}
          </>)}

          {accordion('vignettes', '👤 Vignettes', <>
            {toggle('vignettes_show', 'Afficher')}
            {ds.vignettes_show && <>
              {slider('vignette_size', 'Taille', 28, 80, 'px')}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '90px', flexShrink: 0 }}>Style</span>
                {(['circle', 'card'] as const).map(v => (
                  <button key={v} onClick={() => update('vignette_style', v)} style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer', border: `1px solid ${ds.vignette_style === v ? '#d4a84c' : 'var(--border)'}`, background: ds.vignette_style === v ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)', color: ds.vignette_style === v ? '#d4a84c' : 'var(--muted)' }}>
                    {v === 'circle' ? '⬤' : '▬'} {v === 'circle' ? 'Cercle' : 'Carte'}
                  </button>
                ))}
              </div>
              {colorPicker('vignette_border_color', 'Bordure')}
            </>}
          </>)}

          {accordion('health', '❤ Santé', <>
            {toggle('health_show', 'Afficher')}
            {ds.health_show && (<>
              {/* Mode */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--foreground)' }}>Mode</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(['text', 'bar'] as const).map(m => (
                    <button key={m} onClick={() => update('health_mode', m)} style={{ padding: '2px 10px', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer', border: `1px solid ${ds.health_mode === m ? '#d4a84c' : 'var(--border)'}`, background: ds.health_mode === m ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)', color: ds.health_mode === m ? '#d4a84c' : 'var(--muted)' }}>
                      {m === 'text' ? '✦ Texte' : '▬ Barre'}
                    </button>
                  ))}
                </div>
              </div>
              {/* Longueur */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '90px', flexShrink: 0 }}>Longueur</span>
                <input type="range" min={80} max={390} value={ds.el_health.w}
                  onChange={e => update('el_health', { ...ds.el_health, w: Number(e.target.value) })}
                  style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '30px', textAlign: 'right' }}>{ds.el_health.w}px</span>
              </div>
              {slider('health_font_size', 'Taille', 5, 18, 'px')}
              {/* Couleur */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--foreground)' }}>Couleur</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input type="color" value={ds.health_text_color || '#d4a84c'}
                    onChange={e => update('health_text_color', e.target.value)}
                    style={{ width: '28px', height: '22px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none', padding: 0 }} />
                  <button onClick={() => update('health_text_color', '')} title="Couleur dynamique selon état" style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border)', background: ds.health_text_color ? 'var(--surface-2)' : 'rgba(212,168,76,0.15)', color: ds.health_text_color ? 'var(--muted)' : '#d4a84c', cursor: 'pointer' }}>
                    Auto
                  </button>
                </div>
              </div>
            </>)}
          </>)}

          {accordion('manga_dialog', '🎭 Dialogue Manga', <>
            {toggle('manga_dialog_show', 'Afficher preview')}
            {ds.manga_dialog_show && (
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic' }}>Configurer le layout dans l'onglet Dialogue Manga. Déplacer + redimensionner dans le preview.</p>
            )}
          </>)}

          {accordion('hud', '🎮 HUD', <>
            <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic' }}>Déplacer les éléments directement dans le preview</p>
            {slider('overlay_opacity', 'Opacité', 0, 100, '%')}
            {toggle('stats_show', '⚔ Stats')}
            {toggle('inventory_show', '🎒 Inventaire')}
            {toggle('settings_show', '⚙ Paramètres')}
            {toggle('clock_show', '🕐 Horloge')}
            {ds.clock_show && (<>
              {slider('clock_font_size', 'Taille', 8, 36, 'px')}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--foreground)' }}>Couleur LED</span>
                <input type="color" value={ds.clock_color ?? '#ff3333'}
                  onChange={e => update('clock_color', e.target.value)}
                  style={{ width: '28px', height: '22px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none', padding: 0 }} />
              </div>
            </>)}
          </>)}

        </div>
      </div>

      {/* Panneau droit — preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', padding: '1rem', overflow: 'hidden', gap: '0.75rem' }}>
        {previewMode === 'phone' ? (
          <div ref={phoneRef} style={{ position: 'relative', height: '100%', aspectRatio: '9 / 19.5', maxWidth: '100%', borderRadius: '28px', overflow: 'hidden', background: '#000', border: '2px solid #2a2a30', boxShadow: '0 0 0 5px #161618, 0 16px 48px rgba(0,0,0,0.9)', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '80px', height: '10px', background: '#161618', borderRadius: '0 0 8px 8px', zIndex: 100 }} />
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              <div style={{ width: '390px', height: '845px', transformOrigin: 'top left', transform: `scale(${phoneScale})` }}>
                <SectionPreviewCard s={ds} previewMode="phone" scale={phoneScale} onUpdate={update} protagonist={protagonist} npcs={npcs} mangaSelectedNpcs={mangaSelectedNpcs} mangaEmotions={mangaEmotions} settingsStep={settingsStep} />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#000', borderRadius: '10px', border: '1px solid #2a2a30' }}>
            <SectionPreviewCard s={ds} previewMode="tablet" scale={1} onUpdate={update} protagonist={protagonist} npcs={npcs} mangaSelectedNpcs={mangaSelectedNpcs} mangaEmotions={mangaEmotions} settingsStep={settingsStep} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Préférences joueur ────────────────────────────────────────────────────────

function PlayerSettingsTab({ bookId, introOrder, onSaved }: {
  bookId: string
  introOrder: import('@/types').IntroStep[] | null
  onSaved: (order: import('@/types').IntroStep[]) => void
}) {
  const defaultStep = DEFAULT_INTRO_ORDER.find(s => s.id === 'settings')!
  const existingStep = introOrder?.find(s => s.id === 'settings') ?? defaultStep
  const [step, setStep] = React.useState<import('@/types').IntroStep>({ ...defaultStep, ...existingStep })
  const [previewMode, setPreviewMode] = React.useState<'phone' | 'tablet'>('phone')
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const phoneRef = React.useRef<HTMLDivElement>(null)
  const [phoneScale, setPhoneScale] = React.useState(1)

  React.useEffect(() => {
    const el = phoneRef.current
    if (!el) return
    const obs = new ResizeObserver(([e]) => { const w = e.contentRect.width; if (w > 0) setPhoneScale(w / 390) })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  function patch(fields: Partial<import('@/types').IntroStep>) {
    setStep(s => ({ ...s, ...fields }))
  }

  async function save() {
    setSaving(true)
    const newOrder = introOrder
      ? introOrder.map(s => s.id === 'settings' ? step : s)
      : DEFAULT_INTRO_ORDER.map(s => s.id === 'settings' ? step : s)
    await fetch(`/api/books/${bookId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intro_order: newOrder }),
    })
    onSaved(newOrder)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const field = (key: keyof import('@/types').IntroStep, label: string, placeholder: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <span style={{ fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <input
        type="text"
        value={(step as any)[key] ?? ''}
        placeholder={placeholder}
        onChange={e => patch({ [key]: e.target.value } as any)}
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.35rem 0.6rem', color: 'var(--foreground)', fontSize: '0.78rem', width: '100%', boxSizing: 'border-box' }}
      />
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Panneau gauche — config */}
      <div style={{ width: '340px', flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Préférences joueur</span>
            <button onClick={save} disabled={saving} style={{ padding: '4px 14px', borderRadius: '6px', background: saved ? '#4caf7d22' : 'var(--accent)', border: saved ? '1px solid #4caf7d' : 'none', color: saved ? '#4caf7d' : '#000', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}>
              {saved ? '✓ Sauvegardé' : saving ? '…' : 'Sauvegarder'}
            </button>
          </div>

          {/* Titre */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>TITRE DE L'ÉCRAN</p>
            {field('settings_title', '', 'RÉGLER TON EXPÉRIENCE')}
          </div>

          {/* Sons */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>SONS & MUSIQUE</p>
            {field('settings_sound_label', 'Label', 'Sons & musique')}
            {field('settings_sound_desc', 'Description', 'Musique et effets sonores du jeu')}
          </div>

          {/* Voix */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>VOIX DES PERSONNAGES</p>
            {field('settings_voice_label', 'Label', 'Voix des personnages')}
            {field('settings_voice_desc', 'Description', 'Doublage audio des dialogues')}
          </div>

          {/* Mode texte 1 */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MODE TEXTE — OPTION 1</p>
            {field('settings_mode1_label', 'Label', 'Descriptif')}
            {field('settings_mode1_desc', 'Description', 'Texte complet — richesse narrative maximale')}
          </div>

          {/* Mode texte 2 */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MODE TEXTE — OPTION 2</p>
            {field('settings_mode2_label', 'Label', 'Narratif')}
            {field('settings_mode2_desc', 'Description', "Résumés — plus rapide, essentiel à l'action")}
          </div>
        </div>
      </div>

      {/* Panneau droit — preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', gap: '1rem', padding: '1rem', overflow: 'hidden' }}>
        {/* Toggle phone / tablet */}
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
          {(['phone', 'tablet'] as const).map(m => (
            <button key={m} onClick={() => setPreviewMode(m)} style={{ padding: '4px 14px', borderRadius: '6px', border: `1px solid ${previewMode === m ? (m === 'tablet' ? '#4c9bf0' : '#d4a84c') : 'var(--border)'}`, background: previewMode === m ? (m === 'tablet' ? 'rgba(76,155,240,0.12)' : 'rgba(212,168,76,0.12)') : 'var(--surface-2)', color: previewMode === m ? (m === 'tablet' ? '#4c9bf0' : '#d4a84c') : 'var(--muted)', fontSize: '0.72rem', cursor: 'pointer' }}>
              {m === 'phone' ? '📱 Téléphone' : '📟 Tablette'}
            </button>
          ))}
        </div>

        {previewMode === 'phone' ? (
          <div ref={phoneRef} style={{ position: 'relative', height: '100%', aspectRatio: '9 / 19.5', maxWidth: '100%', borderRadius: '28px', overflow: 'hidden', background: '#000', border: '2px solid #2a2a30', boxShadow: '0 0 0 5px #161618, 0 16px 48px rgba(0,0,0,0.9)', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '80px', height: '10px', background: '#161618', borderRadius: '0 0 8px 8px', zIndex: 100 }} />
            <SettingsStepPreview step={step} scale={phoneScale} />
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#000', borderRadius: '10px', border: '1px solid #2a2a30' }}>
            <SettingsStepPreview step={step} fullscreen />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Settings Step Preview ─────────────────────────────────────────────────────

function SettingsStepPreview({ step, scale = 1, fullscreen = false }: {
  step: import('@/types').IntroStep
  scale?: number
  fullscreen?: boolean
}) {
  const [soundOn, setSoundOn] = React.useState(true)
  const [voiceOn, setVoiceOn] = React.useState(true)
  const [mode, setMode] = React.useState<1 | 2>(1)

  const title = step.settings_title || 'RÉGLER TON EXPÉRIENCE'
  const soundLabel = step.settings_sound_label || 'Sons & musique'
  const soundDesc = step.settings_sound_desc || 'Musique et effets sonores du jeu'
  const voiceLabel = step.settings_voice_label || 'Voix des personnages'
  const voiceDesc = step.settings_voice_desc || 'Doublage audio des dialogues'
  const mode1Label = step.settings_mode1_label || 'Descriptif'
  const mode1Desc = step.settings_mode1_desc || 'Texte complet — richesse narrative maximale'
  const mode2Label = step.settings_mode2_label || 'Narratif'
  const mode2Desc = step.settings_mode2_desc || "Résumés — plus rapide, essentiel à l'action"

  const inner = (
    <div style={{ width: '100%', height: '100%', background: '#0d0d0d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 10%', boxSizing: 'border-box' }}>
      {/* Titre */}
      <p style={{ margin: '0 0 20px 0', fontFamily: 'Georgia, serif', fontWeight: 900, fontStyle: 'italic', fontSize: fullscreen ? '22px' : '15px', color: '#d4a84c', letterSpacing: '3px', textTransform: 'uppercase', textAlign: 'center' }}>{title}</p>

      {/* Toggles son / voix */}
      {([
        { label: soundLabel, desc: soundDesc, on: soundOn, toggle: () => setSoundOn(v => !v) },
        { label: voiceLabel, desc: voiceDesc, on: voiceOn, toggle: () => setVoiceOn(v => !v) },
      ] as const).map(({ label, desc, on, toggle }) => (
        <div key={label} onClick={toggle} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: fullscreen ? '10px 14px' : '7px 10px', marginBottom: fullscreen ? '8px' : '5px', background: '#161618', border: '1px solid #2a2a30', borderRadius: '8px', cursor: 'pointer', boxSizing: 'border-box' }}>
          <div>
            <p style={{ margin: 0, fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: fullscreen ? '14px' : '9px', color: '#ede9df' }}>{label}</p>
            <p style={{ margin: 0, fontSize: fullscreen ? '11px' : '7px', color: '#9898b4', marginTop: '2px' }}>{desc}</p>
          </div>
          <div style={{ width: fullscreen ? 38 : 26, height: fullscreen ? 22 : 15, borderRadius: '99px', background: on ? '#d4a84c' : '#2a2a30', border: `1px solid ${on ? '#d4a84c' : '#3a3a48'}`, position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
            <div style={{ position: 'absolute', top: fullscreen ? 3 : 2, left: on ? (fullscreen ? 18 : 13) : (fullscreen ? 3 : 2), width: fullscreen ? 14 : 9, height: fullscreen ? 14 : 9, borderRadius: '50%', background: on ? '#0d0d0d' : '#9898b4', transition: 'left 0.2s' }} />
          </div>
        </div>
      ))}

      {/* Séparateur mode texte */}
      <p style={{ margin: (fullscreen ? '12px' : '8px') + ' 0 ' + (fullscreen ? '10px' : '7px'), fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: fullscreen ? '11px' : '7.5px', color: '#9898b4', letterSpacing: '2px', textTransform: 'uppercase', alignSelf: 'flex-start' }}>MODE TEXTE</p>

      {/* Options mode texte */}
      {([
        { n: 1 as const, label: mode1Label, desc: mode1Desc },
        { n: 2 as const, label: mode2Label, desc: mode2Desc },
      ]).map(({ n, label, desc }) => (
        <div key={n} onClick={() => setMode(n)} style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: fullscreen ? 12 : 8, padding: fullscreen ? '10px 14px' : '7px 10px', marginBottom: fullscreen ? '8px' : '5px', background: mode === n ? 'rgba(212,168,76,0.08)' : '#161618', border: `1px solid ${mode === n ? '#d4a84c66' : '#2a2a30'}`, borderRadius: '8px', cursor: 'pointer', boxSizing: 'border-box' }}>
          <div style={{ width: fullscreen ? 18 : 12, height: fullscreen ? 18 : 12, borderRadius: '50%', border: `2px solid ${mode === n ? '#d4a84c' : '#3a3a48'}`, background: mode === n ? '#d4a84c' : 'transparent', flexShrink: 0, marginTop: fullscreen ? 2 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {mode === n && <div style={{ width: fullscreen ? 7 : 5, height: fullscreen ? 7 : 5, borderRadius: '50%', background: '#0d0d0d' }} />}
          </div>
          <div>
            <p style={{ margin: 0, fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: fullscreen ? '14px' : '9px', color: mode === n ? '#d4a84c' : '#ede9df' }}>{label}</p>
            <p style={{ margin: 0, fontSize: fullscreen ? '11px' : '7px', color: '#9898b4', marginTop: '2px', lineHeight: 1.4 }}>{desc}</p>
          </div>
        </div>
      ))}

      {/* Bouton COMMENCER */}
      <div style={{ width: '100%', marginTop: fullscreen ? '16px' : '10px', background: '#d4a84c', borderRadius: '4px', padding: fullscreen ? '12px' : '8px', textAlign: 'center', cursor: 'pointer' }}>
        <span style={{ fontFamily: 'Georgia, serif', fontWeight: 900, fontStyle: 'italic', fontSize: fullscreen ? '13px' : '8.5px', color: '#0d0d0d', letterSpacing: '2px', textTransform: 'uppercase' }}>COMMENCER L'AVENTURE</span>
      </div>
    </div>
  )

  if (fullscreen) {
    return <div style={{ position: 'absolute', inset: 0 }}>{inner}</div>
  }
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{ width: '390px', height: '845px', transformOrigin: 'top left', transform: `scale(${scale})` }}>
        {inner}
      </div>
    </div>
  )
}

// ── Intro — Ordre & timing ────────────────────────────────────────────────────

const INTRO_STEP_DURATIONS_MS: Record<string, number> = { flash: 500, court: 1000, normal: 2500, long: 4000, pause: 6000 }

type IntroStepId = 'animatic' | 'fbi' | 'fiche' | 'settings'

const DEFAULT_INTRO_ORDER: import('@/types').IntroStep[] = [
  { id: 'animatic', label: 'Animatic',          icon: '🎬', enabled: true, delay_before: 0, exit_volume: 0 },
  { id: 'fbi',      label: 'Intro FBI',          icon: '🖥', enabled: true, delay_before: 0, exit_volume: 0 },
  { id: 'fiche',    label: 'Fiche personnage',   icon: '🃏', enabled: true, delay_before: 0, exit_volume: 0 },
  {
    id: 'settings', label: 'Préférences',        icon: '⚙', enabled: true, delay_before: 0, exit_volume: 0,
    settings_title: 'RÉGLER TON EXPÉRIENCE',
    settings_sound_label: 'Sons & musique',
    settings_sound_desc: 'Musique et effets sonores du jeu',
    settings_voice_label: 'Voix des personnages',
    settings_voice_desc: 'Doublage audio des dialogues',
    settings_mode1_label: 'Descriptif',
    settings_mode1_desc: 'Texte complet — richesse narrative maximale',
    settings_mode2_label: 'Narratif',
    settings_mode2_desc: 'Résumés — plus rapide, essentiel à l\'action',
  },
]

function IntroOrderTab({ bookId, initialOrder, onSaved, onNavigate, protagonistName, introFrames, introAudioUrl, protagonist }: {
  bookId: string
  initialOrder: import('@/types').IntroStep[] | null
  onSaved: (order: import('@/types').IntroStep[]) => void
  onNavigate: (tab: any) => void
  protagonistName: string
  introFrames: import('@/types').IntroFrame[]
  introAudioUrl: string
  protagonist: Npc | null
}) {
  const [steps, setSteps] = useState<import('@/types').IntroStep[]>(() => {
    if (!initialOrder) return DEFAULT_INTRO_ORDER
    const saved = initialOrder
    const missing = DEFAULT_INTRO_ORDER.filter(d => !saved.find(s => s.id === d.id))
    return [...saved, ...missing]
  })
  const [saving, setSaving] = useState(false)
  const [savedFlag, setSavedFlag] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [previewStep, setPreviewStep] = useState<number>(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [blackOpacity, setBlackOpacity] = useState(0)
  const dragIdx = useRef<number | null>(null)
  const playTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const playIntervals = useRef<ReturnType<typeof setInterval>[]>([])
  const stepCompleteRef = useRef<(() => void) | null>(null)
  const masterAudioRef = useRef<HTMLAudioElement | null>(null)
  const stepsRef = useRef(steps)
  stepsRef.current = steps   // toujours à jour, même dans les closures des timers
  const phoneFrameRef = useRef<HTMLDivElement>(null)
  const [ficheScale, setFicheScale] = useState(1)
  const [introPreviewMode, setIntroPreviewMode] = useState<'phone' | 'tablet'>('phone')
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const tabletFrameRef = useRef<HTMLDivElement>(null)
  const [tabletScale, setTabletScale] = useState(1)

  useEffect(() => {
    const el = tabletFrameRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect
      if (w > 0 && h > 0) setTabletScale(Math.min(w / 390, h / 845))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const activeSteps = steps.filter(s => s.enabled)

  // Scale the fiche card to fill the phone frame preview at native resolution
  useEffect(() => {
    const el = phoneFrameRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setFicheScale(w / 390)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  function getStepAudioUrl(stepId: string): string | undefined {
    if (stepId === 'animatic') return introAudioUrl || undefined
    if (stepId === 'fiche') return (protagonist?.name_image_settings as any)?.music_url || undefined
    return undefined
  }

  function fadeVolume(from: number, to: number, durationMs: number, onDone?: () => void) {
    const audio = masterAudioRef.current
    if (!audio) { onDone?.(); return }
    const STEPS = 30
    const stepMs = durationMs / STEPS
    const delta = (to - from) / STEPS
    let current = from
    let i = 0
    audio.volume = Math.max(0, Math.min(1, from))
    const iv = setInterval(() => {
      i++
      current += delta
      if (audio) audio.volume = Math.max(0, Math.min(1, current))
      if (i >= STEPS) { clearInterval(iv); onDone?.() }
    }, stepMs)
    playIntervals.current.push(iv)
  }

  function startStepAudio(stepId: string, fadeIn = false) {
    const audio = masterAudioRef.current
    if (!audio) return
    const url = getStepAudioUrl(stepId)
    if (url) {
      audio.src = url
      audio.volume = fadeIn ? 0 : 1
      audio.currentTime = 0
      audio.play().catch(() => {})
      if (fadeIn) fadeVolume(0, 1, 600)
    } else {
      audio.pause()
      audio.src = ''
    }
  }

  function clearPlay() {
    playTimers.current.forEach(clearTimeout)
    playTimers.current = []
    playIntervals.current.forEach(clearInterval)
    playIntervals.current = []
    stepCompleteRef.current = null
    const audio = masterAudioRef.current
    if (audio) { audio.pause(); audio.src = ''; audio.volume = 1 }
    setBlackOpacity(0)
    setCountdown(null)
  }

  const FADE_MS = 600
  const BLACK_MIN_MS = 300

  function getStepNaturalDuration(stepId: string): number {
    if (stepId === 'fbi') return 9500
    if (stepId === 'animatic') return Math.max(1000, introFrames.reduce((sum, f) => sum + (INTRO_STEP_DURATIONS_MS[f.duration] ?? 2500), 0))
    if (stepId === 'settings') return 3000  // preview statique 3s
    return 500
  }

  function startPlay() {
    if (activeSteps.length === 0) return
    clearPlay()
    setPreviewStep(0)
    setPlaying(true)
    setCountdown(null)
    setBlackOpacity(0)
    startStepAudio(activeSteps[0].id, true)
    scheduleNext(0)
  }

  function scheduleNext(currentIdx: number) {
    const nextIdx = currentIdx + 1
    if (nextIdx >= activeSteps.length) return

    const step = activeSteps[currentIdx]
    const naturalMs = getStepNaturalDuration(step.id)
    const pauseMs = (step.delay_before || 0) * 1000
    const blackHoldMs = Math.max(BLACK_MIN_MS, pauseMs)

    const nextStep = activeSteps[nextIdx]
    const nextAudioUrl = getStepAudioUrl(nextStep.id)

    function onNaturalEnd() {
      // Lire exit_volume en temps réel (slider peut être bougé pendant la lecture)
      const liveStep = stepsRef.current.find(s => s.id === step.id)
      const exitVol = (liveStep?.exit_volume ?? 0) / 100

      const audio = masterAudioRef.current
      const actualSrc = audio?.src || undefined

      // 1. Fade image au noir + descente progressive du son vers exit_volume (ou 0)
      setBlackOpacity(1)
      const targetVol = (exitVol > 0 && actualSrc) ? exitVol : 0
      if (actualSrc) fadeVolume(audio!.volume, targetVol, FADE_MS)

      // 2. Hold in black (avec countdown si pause > 0)
      if (pauseMs > 0) {
        let remaining = pauseMs / 1000
        const startCountdownAt = setTimeout(() => {
          setCountdown(remaining)
          const tick = setInterval(() => {
            remaining = Math.max(0, remaining - 0.1)
            setCountdown(remaining)
          }, 100)
          playIntervals.current.push(tick)
        }, FADE_MS)
        playTimers.current.push(startCountdownAt)
      }

      // 3. Basculer vers étape suivante + montée progressive du son
      const t = setTimeout(() => {
        setCountdown(null)
        setPreviewStep(nextIdx)
        scheduleNext(nextIdx)

        if (nextAudioUrl && nextAudioUrl !== actualSrc) {
          // Audio différent : démarrer le nouveau avec fade-in (0 → 1)
          startStepAudio(nextStep.id, true)
        } else if ((nextAudioUrl && nextAudioUrl === actualSrc) || (exitVol > 0 && actualSrc && !nextAudioUrl)) {
          // Même URL ou continuité : remonter progressivement le volume (exitVol → 1)
          fadeVolume(exitVol, 1, FADE_MS)
        } else if (actualSrc) {
          // exit_volume = 0 et pas de continuité : couper
          if (audio) { audio.pause(); audio.src = ''; audio.volume = 1 }
        }

        const t2 = setTimeout(() => setBlackOpacity(0), 50)
        playTimers.current.push(t2)
      }, FADE_MS + blackHoldMs)
      playTimers.current.push(t)
    }

    if (step.id === 'fbi' || (step.id === 'animatic' && introFrames.length > 0)) {
      stepCompleteRef.current = onNaturalEnd
    } else {
      stepCompleteRef.current = null
      const t = setTimeout(onNaturalEnd, naturalMs)
      playTimers.current.push(t)
    }
  }

  function stopPlay() {
    clearPlay()
    setPlaying(false)
  }

  function goTo(idx: number) {
    clearPlay()
    setPlaying(false)
    setPreviewStep(idx)
  }

  function move(from: number, to: number) {
    if (from === to) return
    setSteps(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  function update(idx: number, patch: Partial<import('@/types').IntroStep>) {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  async function save() {
    setSaving(true)
    await fetch(`/api/books/${bookId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intro_order: steps }),
    })
    onSaved(steps)
    setSaving(false)
    setSavedFlag(true)
    setTimeout(() => setSavedFlag(false), 2000)
  }

  useEffect(() => () => clearPlay(), [])

  const TAB_MAP: Record<IntroStepId, string> = { animatic: 'intro', fbi: 'fbi', fiche: 'fiche', settings: 'player_settings' }
  const currentStep = activeSteps[previewStep]

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Panneau gauche : config ───────────────────────────────────────── */}
      <div style={{ width: leftPanelCollapsed ? '0px' : '380px', flexShrink: 0, overflow: 'hidden', transition: 'width 0.2s ease', borderRight: leftPanelCollapsed ? 'none' : '1px solid var(--border)' }}>
        {/* Contenu intérieur à largeur fixe — ne se déforme pas pendant l'animation */}
        <div style={{ width: '380px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div style={{ padding: '1.5rem 1.5rem 1rem' }}>
          <h2 style={{ color: 'var(--foreground)', fontSize: '0.95rem', fontWeight: 'bold', marginBottom: '0.3rem' }}>Ordre & timing</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.73rem', marginBottom: '1.2rem', lineHeight: 1.5 }}>
            Glissez pour réordonner. Définissez la pause à la fin de chaque écran avant de passer au suivant.
          </p>

          {/* Bouton Play */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.2rem' }}>
            {!playing ? (
              <button onClick={startPlay} disabled={activeSteps.length === 0}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1.1rem', borderRadius: '8px', background: 'var(--accent)', border: 'none', color: '#000', fontWeight: 'bold', fontSize: '0.82rem', cursor: activeSteps.length === 0 ? 'default' : 'pointer', opacity: activeSteps.length === 0 ? 0.4 : 1 }}>
                ▶ Lancer la preview
              </button>
            ) : (
              <button onClick={stopPlay}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1.1rem', borderRadius: '8px', background: '#e0555522', border: '1px solid #e05555', color: '#e05555', fontWeight: 'bold', fontSize: '0.82rem', cursor: 'pointer' }}>
                ■ Arrêter
              </button>
            )}
          </div>

          {/* Liste des steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {steps.map((step, idx) => {
              const activeIdx = activeSteps.findIndex(s => s.id === step.id)
              const isCurrent = playing && activeIdx === previewStep && step.enabled
              return (
                <div
                  key={step.id}
                  draggable
                  onDragStart={() => { dragIdx.current = idx }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => { if (dragIdx.current !== null) move(dragIdx.current, idx); dragIdx.current = null }}
                  onClick={() => step.enabled && activeIdx >= 0 && goTo(activeIdx)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.7rem',
                    background: isCurrent ? 'rgba(212,168,76,0.1)' : 'var(--surface)',
                    border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '9px', padding: '0.65rem 0.8rem',
                    opacity: step.enabled ? 1 : 0.4, cursor: step.enabled ? 'pointer' : 'default',
                    transition: 'border-color 0.2s',
                  }}
                >
                  <div style={{ color: 'var(--muted)', fontSize: '0.9rem', cursor: 'grab', flexShrink: 0 }}>⠿</div>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: isCurrent ? 'var(--accent)' : 'var(--surface-2)', border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: isCurrent ? '#000' : 'var(--muted)', fontWeight: 'bold', flexShrink: 0 }}>
                    {step.enabled ? activeIdx + 1 : '–'}
                  </div>
                  <span style={{ fontSize: '1rem' }}>{step.icon}</span>
                  <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--foreground)', fontWeight: isCurrent ? 'bold' : 'normal' }}>{step.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                    <input
                      type="number" min={0} max={60} step={0.5}
                      value={step.delay_before}
                      onClick={e => e.stopPropagation()}
                      onChange={e => update(idx, { delay_before: parseFloat(e.target.value) || 0 })}
                      style={{ width: '46px', padding: '2px 5px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', fontSize: '0.75rem', textAlign: 'center' }}
                    />
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>s</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }} title="Volume de sortie (0 = silence, 100 = maintien)">
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>🔊</span>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={step.exit_volume ?? 0}
                      onClick={e => e.stopPropagation()}
                      onChange={e => update(idx, { exit_volume: parseInt(e.target.value) })}
                      style={{ width: '52px', accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '22px' }}>{step.exit_volume ?? 0}%</span>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); update(idx, { enabled: !step.enabled }) }}
                    style={{ background: step.enabled ? '#4caf7d22' : 'var(--surface-2)', border: `1px solid ${step.enabled ? '#4caf7d' : 'var(--border)'}`, borderRadius: '4px', padding: '2px 7px', color: step.enabled ? '#4caf7d' : 'var(--muted)', fontSize: '0.65rem', cursor: 'pointer', flexShrink: 0 }}
                  >
                    {step.enabled ? '✓' : '–'}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onNavigate(TAB_MAP[step.id as IntroStepId]) }}
                    title="Éditer"
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 7px', color: 'var(--muted)', fontSize: '0.65rem', cursor: 'pointer', flexShrink: 0 }}
                  >↗</button>
                </div>
              )
            })}
          </div>

          {/* Résumé séquence */}
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Séquence</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
              {activeSteps.map((s, i) => (
                <React.Fragment key={s.id}>
                  {i > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                      {activeSteps[i - 1]?.delay_before > 0 && <span style={{ fontSize: '0.55rem', color: 'var(--accent)' }}>pause {activeSteps[i - 1].delay_before}s</span>}
                      {(activeSteps[i - 1]?.exit_volume ?? 0) > 0 && <span style={{ fontSize: '0.55rem', color: '#4caf7d' }}>🔊{activeSteps[i - 1].exit_volume}%</span>}
                      <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>→</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: previewStep === i ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)', border: `1px solid ${previewStep === i ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '5px', padding: '3px 8px', fontSize: '0.72rem' }}>
                    {s.icon} <span style={{ color: 'var(--foreground)' }}>{s.label}</span>
                  </div>
                </React.Fragment>
              ))}
              {activeSteps.length === 0 && <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Aucun écran actif</span>}
            </div>
          </div>
        </div>

        <div style={{ padding: '0 1.5rem 1.5rem', marginTop: 'auto' }}>
          <button onClick={save} disabled={saving} style={{ padding: '0.55rem 1.2rem', borderRadius: '7px', background: savedFlag ? '#4caf7d22' : 'var(--accent)', border: savedFlag ? '1px solid #4caf7d' : 'none', color: savedFlag ? '#4caf7d' : '#000', fontWeight: 'bold', fontSize: '0.82rem', cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Sauvegarde…' : savedFlag ? '✓ Sauvegardé' : 'Sauvegarder'}
          </button>
        </div>
        </div>{/* fin du div intérieur 380px */}
      </div>

      {/* ── Panneau droit : preview ───────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0a0a0c' }}>
        {/* Barre de navigation preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
          <button onClick={() => setLeftPanelCollapsed(c => !c)} title={leftPanelCollapsed ? 'Afficher le panneau' : 'Masquer le panneau'}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', padding: '3px 8px', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 }}>
            {leftPanelCollapsed ? '▶|' : '|◀'}
          </button>
          <button onClick={() => goTo(Math.max(0, previewStep - 1))} disabled={previewStep === 0}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', padding: '3px 9px', color: previewStep === 0 ? 'var(--muted)' : 'var(--foreground)', cursor: previewStep === 0 ? 'default' : 'pointer', fontSize: '0.8rem', opacity: previewStep === 0 ? 0.3 : 1 }}>
            ←
          </button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
            {activeSteps.map((s, i) => (
              <button key={s.id} onClick={() => goTo(i)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '3px 10px', borderRadius: '5px', background: i === previewStep ? 'rgba(212,168,76,0.15)' : 'none', border: `1px solid ${i === previewStep ? 'var(--accent)' : 'var(--border)'}`, color: i === previewStep ? 'var(--accent)' : 'var(--muted)', fontSize: '0.72rem', cursor: 'pointer' }}>
                {s.icon} {s.label}
              </button>
            ))}
            {activeSteps.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Aucun écran à afficher</span>}
          </div>
          {countdown !== null && (
            <div style={{ fontSize: '0.72rem', color: 'var(--accent)', minWidth: '60px', textAlign: 'right' }}>
              pause {countdown.toFixed(1)}s
            </div>
          )}
          {/* Switch téléphone / tablette */}
          <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', flexShrink: 0 }}>
            {(['phone', 'tablet'] as const).map(mode => (
              <button key={mode} onClick={() => setIntroPreviewMode(mode)} style={{
                padding: '3px 10px', fontSize: '0.68rem', cursor: 'pointer', border: 'none',
                background: introPreviewMode === mode ? 'rgba(212,168,76,0.2)' : 'transparent',
                color: introPreviewMode === mode ? '#d4a84c' : 'var(--muted)',
              }}>
                {mode === 'phone' ? '📱' : '📟'}
              </button>
            ))}
          </div>
          <button onClick={() => goTo(Math.min(activeSteps.length - 1, previewStep + 1))} disabled={previewStep >= activeSteps.length - 1}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', padding: '3px 9px', color: previewStep >= activeSteps.length - 1 ? 'var(--muted)' : 'var(--foreground)', cursor: previewStep >= activeSteps.length - 1 ? 'default' : 'pointer', fontSize: '0.8rem', opacity: previewStep >= activeSteps.length - 1 ? 0.3 : 1 }}>
            →
          </button>
        </div>

        {/* Audio maître (volume contrôlé pour les transitions) */}
        <audio ref={masterAudioRef} loop style={{ display: 'none' }} />

        {/* Contenu preview */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0c', padding: introPreviewMode === 'tablet' ? '0' : '1rem' }}>
          {!currentStep ? (
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
              Activez au moins un écran pour voir la preview
            </div>
          ) : introPreviewMode === 'phone' ? (
            /* ── Mode téléphone : cadre portrait ── */
            <div ref={phoneFrameRef} style={{
              position: 'relative',
              height: '100%',
              aspectRatio: '9 / 19.5',
              maxWidth: '100%',
              borderRadius: '28px',
              overflow: 'hidden',
              background: '#000',
              border: '2px solid #2a2a30',
              boxShadow: '0 0 0 5px #161618, 0 16px 48px rgba(0,0,0,0.9)',
              flexShrink: 0,
            }}>
              {/* Encoche téléphone */}
              <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '80px', height: '10px', background: '#161618', borderRadius: '0 0 8px 8px', zIndex: 100 }} />

              {currentStep.id === 'fbi' && (
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                  <div style={{ width: '390px', height: '845px', transformOrigin: 'top left', transform: `scale(${ficheScale})`, position: 'relative' }}>
                    <FBIAnimTab key={`fbi-preview-${previewStep}`} protagonistName={protagonistName} onComplete={() => { const cb = stepCompleteRef.current; stepCompleteRef.current = null; cb?.() }} />
                  </div>
                </div>
              )}
              {currentStep.id === 'animatic' && introFrames.length > 0 && (
                <IntroViewer
                  key={`animatic-preview-${previewStep}`}
                  embedded
                  noAudio
                  frames={introFrames}
                  onClose={() => { const cb = stepCompleteRef.current; stepCompleteRef.current = null; cb?.() }}
                />
              )}
              {currentStep.id === 'animatic' && introFrames.length === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                  <div style={{ fontSize: '2rem' }}>🎬</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.7rem', textAlign: 'center' }}>Aucune frame</div>
                  <button onClick={() => onNavigate('intro')} style={{ padding: '0.3rem 0.7rem', borderRadius: '5px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: '0.6rem', cursor: 'pointer' }}>
                    Ouvrir ↗
                  </button>
                </div>
              )}
              {currentStep.id === 'fiche' && protagonist && (
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                  <div style={{ width: '390px', height: '845px', transformOrigin: 'top left', transform: `scale(${ficheScale})`, display: 'flex' }}>
                    <FicheCardView protagonist={protagonist} settings={{ ...FICHE_DEFAULT_SETTINGS, ...(protagonist.name_image_settings ?? {}) } as FicheAllSettings} device="phone" />
                  </div>
                </div>
              )}
              {currentStep.id === 'fiche' && !protagonist && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.7rem' }}>Aucun protagoniste défini</div>
              )}
              {currentStep.id === 'settings' && (() => {
                const st = steps.find(s => s.id === 'settings')!
                return <SettingsStepPreview step={st} scale={ficheScale} />
              })()}

              {/* Overlay fondu au noir entre séquences */}
              <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: blackOpacity, transition: 'opacity 0.6s ease', pointerEvents: 'none', zIndex: 50 }} />
            </div>
          ) : (
            /* ── Mode tablette : plein écran, scale natif ── */
            <div ref={tabletFrameRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {currentStep.id === 'fbi' && (
                <div style={{ width: '390px', height: '845px', transformOrigin: 'center center', transform: `scale(${tabletScale})`, flexShrink: 0, position: 'relative' }}>
                  <FBIAnimTab key={`fbi-tablet-${previewStep}`} protagonistName={protagonistName} onComplete={() => { const cb = stepCompleteRef.current; stepCompleteRef.current = null; cb?.() }} />
                </div>
              )}
              {currentStep.id === 'animatic' && introFrames.length > 0 && (
                <IntroViewer
                  key={`animatic-tablet-${previewStep}`}
                  embedded
                  noAudio
                  frames={introFrames}
                  onClose={() => { const cb = stepCompleteRef.current; stepCompleteRef.current = null; cb?.() }}
                />
              )}
              {currentStep.id === 'animatic' && introFrames.length === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                  <div style={{ fontSize: '2rem' }}>🎬</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.7rem', textAlign: 'center' }}>Aucune frame</div>
                  <button onClick={() => onNavigate('intro')} style={{ padding: '0.3rem 0.7rem', borderRadius: '5px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: '0.6rem', cursor: 'pointer' }}>
                    Ouvrir ↗
                  </button>
                </div>
              )}
              {currentStep.id === 'fiche' && protagonist && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                  <FicheCardView protagonist={protagonist} settings={{ ...FICHE_DEFAULT_SETTINGS, ...(protagonist.name_image_settings ?? {}) } as FicheAllSettings} device="tablet" />
                </div>
              )}
              {currentStep.id === 'fiche' && !protagonist && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.7rem' }}>Aucun protagoniste défini</div>
              )}
              {currentStep.id === 'settings' && (() => {
                const st = steps.find(s => s.id === 'settings')!
                return <SettingsStepPreview step={st} scale={tabletScale} fullscreen />
              })()}
              {/* Overlay fondu au noir entre séquences */}
              <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: blackOpacity, transition: 'opacity 0.6s ease', pointerEvents: 'none', zIndex: 50 }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── FBI Intro Animation ───────────────────────────────────────────────────────

function FBIAnimTab({ protagonistName, onComplete }: { protagonistName: string; onComplete?: () => void }) {
  const [phase, setPhase]         = useState<'login' | 'window'>('login')
  const [userText, setUserText]   = useState('')
  const [passText, setPassText]   = useState('')
  const [searchText, setSearchText] = useState('')
  const [mousePos, setMousePos]   = useState({ x: -50, y: -50 })
  const [btnPressed, setBtnPressed] = useState(false)
  const [searching, setSearching] = useState(false)
  const [dots, setDots]           = useState('')
  const [animKey, setAnimKey]     = useState(0)

  const btnRef       = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const rafRef       = useRef<number | null>(null)
  const timers       = useRef<ReturnType<typeof setTimeout>[]>([])

  function clearAll() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }

  function playKey() {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const ctx = audioCtxRef.current
      const now = ctx.currentTime

      // Couche 1 : bruit blanc filtré (le "clic" mécanique)
      const clickLen = ctx.sampleRate * 0.012
      const clickBuf = ctx.createBuffer(1, clickLen, ctx.sampleRate)
      const clickData = clickBuf.getChannelData(0)
      for (let i = 0; i < clickLen; i++) {
        clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.002))
      }
      const clickSrc = ctx.createBufferSource()
      clickSrc.buffer = clickBuf
      const clickFilter = ctx.createBiquadFilter()
      clickFilter.type = 'bandpass'
      clickFilter.frequency.value = 3800 + Math.random() * 800
      clickFilter.Q.value = 0.8
      const clickGain = ctx.createGain()
      clickGain.gain.setValueAtTime(0.55, now)
      clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.012)
      clickSrc.connect(clickFilter)
      clickFilter.connect(clickGain)
      clickGain.connect(ctx.destination)
      clickSrc.start(now)

      // Couche 2 : thud grave (le fond de course de la touche)
      const thudLen = ctx.sampleRate * 0.06
      const thudBuf = ctx.createBuffer(1, thudLen, ctx.sampleRate)
      const thudData = thudBuf.getChannelData(0)
      for (let i = 0; i < thudLen; i++) {
        thudData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.018))
      }
      const thudSrc = ctx.createBufferSource()
      thudSrc.buffer = thudBuf
      const thudFilter = ctx.createBiquadFilter()
      thudFilter.type = 'lowpass'
      thudFilter.frequency.value = 280
      const thudGain = ctx.createGain()
      thudGain.gain.setValueAtTime(0.0, now)
      thudGain.gain.linearRampToValueAtTime(0.35, now + 0.004)
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
      thudSrc.connect(thudFilter)
      thudFilter.connect(thudGain)
      thudGain.connect(ctx.destination)
      thudSrc.start(now)

      // Couche 3 : légère résonance plastique
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(900 + Math.random() * 200, now)
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.03)
      const oscGain = ctx.createGain()
      oscGain.gain.setValueAtTime(0.06, now)
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)
      osc.connect(oscGain)
      oscGain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.03)
    } catch {}
  }

  function playClick() {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const ctx = audioCtxRef.current
      const now = ctx.currentTime

      // Clic souris : snap sec + petit rebond
      const len = ctx.sampleRate * 0.025
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.003))
      }
      const src = ctx.createBufferSource()
      src.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 1200
      filter.Q.value = 1.5
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.7, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025)
      src.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      src.start(now)
    } catch {}
  }

  function addTimer(fn: () => void, ms: number) {
    const t = setTimeout(fn, ms)
    timers.current.push(t)
  }

  useEffect(() => {
    clearAll()
    setPhase('login')
    setUserText(''); setPassText(''); setSearchText('')
    setMousePos({ x: -50, y: -50 }); setBtnPressed(false)
    setSearching(false); setDots('')

    let userVal = '', passVal = '', searchVal = ''

    function typeChars(
      chars: string[], onChar: (v: string) => void,
      getVal: () => string, setVal: (v: string) => void,
      onDone: () => void,
    ) {
      let i = 0
      function step() {
        if (i >= chars.length) { addTimer(onDone, 500); return }
        const c = chars[i]
        if (c === 'BACK') setVal((getVal().slice(0, -1)))
        else              setVal(getVal() + c)
        onChar(getVal())
        playKey()
        i++
        addTimer(step, 110 + Math.random() * 160)
      }
      step()
    }

    function moveMouse(onDone: () => void) {
      if (!btnRef.current || !containerRef.current) { onDone(); return }
      const br = btnRef.current.getBoundingClientRect()
      const cr = containerRef.current.getBoundingClientRect()
      const targetX = br.left - cr.left + br.width / 2
      const targetY = br.top  - cr.top  + br.height / 2
      let x = -50, y = -50
      function frame() {
        x += (targetX - x) * 0.1
        y += (targetY - y) * 0.1
        setMousePos({ x, y })
        if (Math.abs(x - targetX) > 1.5) {
          rafRef.current = requestAnimationFrame(frame)
        } else {
          setMousePos({ x: targetX, y: targetY })
          addTimer(onDone, 300)
        }
      }
      rafRef.current = requestAnimationFrame(frame)
    }

    // Build search sequence with typo correction
    const name = 'Travis Cents'
    const searchSeq: string[] = [...name, 'z', 'BACK']

    addTimer(() => {
      typeChars(
        [...'agent_47'], v => setUserText(v), () => userVal, v => { userVal = v; setUserText(v) },
        () => typeChars(
          [...'••••••••'], v => setPassText(v), () => passVal, v => { passVal = v; setPassText(v) },
          () => {
            setPhase('window')
            addTimer(() => {
              typeChars(
                searchSeq, v => setSearchText(v), () => searchVal, v => { searchVal = v; setSearchText(v) },
                () => moveMouse(() => {
                  setBtnPressed(true)
                  playClick()
                  addTimer(() => { setBtnPressed(false); setSearching(true); addTimer(() => onComplete?.(), 1500) }, 280)
                }),
              )
            }, 120)
          }
        )
      )
    }, 700)

    return clearAll
  }, [animKey, protagonistName])

  // Dots
  useEffect(() => {
    if (!searching) return
    let n = 0
    const iv = setInterval(() => { n = (n + 1) % 4; setDots('.'.repeat(n)) }, 400)
    return () => clearInterval(iv)
  }, [searching])

  function replay() {
    clearAll()
    setAnimKey(k => k + 1)
  }

  return (
    <div style={{ background: '#000', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', fontFamily: 'Tahoma, Arial' }}>

      {/* LOGIN */}
      {phase === 'login' && (
        <div style={{ color: '#00ffcc', textAlign: 'center' }}>
          <h2 style={{ letterSpacing: '4px', marginBottom: '2rem', fontSize: '1.1rem' }}>FBI SECURE SYSTEM</h2>
          <input readOnly value={userText} placeholder="Username"
            style={{ display: 'block', margin: '10px auto', padding: '8px', width: '180px', background: 'black', border: '1px solid #00ffcc', color: '#00ffcc', outline: 'none' }} />
          <input readOnly value={'•'.repeat(passText.length)} placeholder="Password"
            style={{ display: 'block', margin: '10px auto', padding: '8px', width: '180px', background: 'black', border: '1px solid #00ffcc', color: '#00ffcc', outline: 'none' }} />
        </div>
      )}

      {/* FENÊTRE XP */}
      {phase === 'window' && (
        <div ref={containerRef} style={{ width: '340px', background: '#ece9d8', border: '2px solid #000080', position: 'relative', boxShadow: '4px 4px 20px rgba(0,0,0,0.8)' }}>
          {/* Title bar */}
          <div style={{ background: 'linear-gradient(to right, #0a246a, #3a6ea5)', color: 'white', padding: '4px 8px', fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🔒 FBI DATABASE — Recherche confidentielle</span>
            <div style={{ display: 'flex', gap: '2px' }}>
              {['_','□','✕'].map(c => (
                <span key={c} style={{ background: '#d4d0c8', border: '1px outset #fff', width: '16px', height: '14px', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#000' }}>{c}</span>
              ))}
            </div>
          </div>
          {/* Content */}
          <div style={{ padding: '24px 20px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#333', marginBottom: '10px', fontFamily: 'Tahoma' }}>Entrez le nom du suspect :</div>
            <input readOnly value={searchText}
              style={{ width: '82%', height: '28px', border: '2px inset #7f9db9', background: 'white', color: '#000', fontFamily: 'Tahoma, Arial', fontSize: '13px', padding: '0 8px', boxSizing: 'border-box' }} />
            <br /><br />
            <div ref={btnRef} style={{ display: 'inline-block', padding: '6px 20px', background: btnPressed ? '#1a4a8a' : '#2060c0', border: btnPressed ? '2px inset #0a1a4a' : '2px outset #6090e0', fontFamily: 'Tahoma', fontSize: '11px', color: 'white', userSelect: 'none', cursor: 'pointer', borderRadius: '3px' }}>
              Rechercher
            </div>
            {searching && (
              <div style={{ marginTop: '18px', color: '#000', fontFamily: '"Courier New", monospace', fontSize: '12px', letterSpacing: '1px' }}>
                SEARCHING DATABASE{dots}
              </div>
            )}
            {/* Curseur souris */}

            <div style={{
              position: 'absolute', width: '16px', height: '24px',
              background: 'white', border: '1px solid black',
              clipPath: 'polygon(0 0, 100% 50%, 60% 60%, 80% 100%, 60% 100%, 50% 65%, 0 100%)',
              left: `${mousePos.x}px`, top: `${mousePos.y}px`,
              pointerEvents: 'none', zIndex: 10,
            }} />
          </div>
          {/* Status bar */}
          <div style={{ borderTop: '1px solid #808080', padding: '2px 8px', fontSize: '10px', color: '#555', fontFamily: 'Tahoma', background: '#d4d0c8' }}>
            {searching ? 'Connexion sécurisée établie — Recherche en cours…' : 'Prêt'}
          </div>
        </div>
      )}

      {/* Replay */}
      <button onClick={replay} style={{ position: 'absolute', bottom: '1.5rem', right: '1.5rem', padding: '8px 16px', borderRadius: '6px', border: '1px solid #d4a84c', background: 'rgba(212,168,76,0.15)', color: '#d4a84c', fontSize: '0.8rem', cursor: 'pointer' }}>
        ↺ Replay
      </button>
    </div>
  )
}

// ── Fiche Personnage ──────────────────────────────────────────────────────────

function FichePersonnageTab({ bookId, protagonistNpcId, npcs, setNpcs, imageProvider, bookTheme, bookIllustrationStyle, illustrationBible, onGoToNpcs }: {
  bookId: string
  protagonistNpcId: string | null
  npcs: Npc[]
  setNpcs: (fn: (prev: Npc[]) => Npc[]) => void
  imageProvider?: 'replicate' | 'leonardo'
  bookTheme: string
  bookIllustrationStyle: string
  illustrationBible: string
  onGoToNpcs: () => void
}) {
  const protagonist = protagonistNpcId ? npcs.find(n => n.id === protagonistNpcId) ?? null : null
  const [uploading, setUploading] = useState<string | null>(null)
  const [imgBuster, setImgBuster] = useState(0)
  const [freesoundOpen, setFreesoundOpen] = useState(false)
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(
    () => new Set(['background_image_url', 'portrait_url', 'image_url', 'character_illustrations0', 'character_illustrations1', 'character_illustrations2', 'name_image_url', 'music', 'stats'])
  )
  function toggleBlock(id: string) {
    setCollapsedBlocks(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const bust = (url: string | undefined) => url ? `${url.split('?')[0]}?v=${imgBuster}` : undefined
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [generatingMusic, setGeneratingMusic] = useState(false)
  const [musicSaved, setMusicSaved] = useState(false)
  const [audioBuster, setAudioBuster] = useState(0)
  const [musicPrompt, setMusicPrompt] = useState(`dark urban hip-hop, tense cinematic atmosphere, ${bookTheme}`)

  async function generateMusic() {
    if (!protagonist || !musicPrompt.trim()) return
    setGeneratingMusic(true)
    try {
      const res = await fetch('/api/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: musicPrompt.trim(),
          duration: 30,
          path: `books/${bookId}/npcs/${protagonist.id}/create_music`,
        }),
      })
      const data = await res.json()
      if (data.url) {
        updateNameSetting('music_url', data.url)
        setAudioBuster(b => b + 1)
        setMusicSaved(true)
        setTimeout(() => setMusicSaved(false), 3000)
      } else {
        alert('Erreur génération : ' + (data.error ?? 'inconnue'))
      }
    } catch (e: any) {
      alert('Erreur : ' + e.message)
    } finally {
      setGeneratingMusic(false)
    }
  }

  async function uploadAudio(file: File) {
    if (!protagonist) return
    setUploadingAudio(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', `books/${bookId}/npcs/${protagonist.id}/create_music`)
    const res = await fetch('/api/upload-file', { method: 'POST', body: formData })
    if (!res.ok) { alert('Erreur upload audio'); setUploadingAudio(false); return }
    const { url } = await res.json()
    updateNameSetting('music_url', url)
    setAudioBuster(b => b + 1)
    setUploadingAudio(false)
  }
  const [showPlay, setShowPlay]   = useState(false)
  const [playAnimKey, setPlayAnimKey] = useState(0)
  const [previewMode, setPreviewMode] = useState<'phone' | 'tablet'>('phone')
  const fichePreviewRef = useRef<HTMLDivElement>(null)
  const [fichePreviewScale, setFichePreviewScale] = useState(1)
  useEffect(() => {
    const el = fichePreviewRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setFichePreviewScale(w / 390)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  // Prompts par slot : clé = field + slot (ex: 'background_image_url', 'character_illustrations0')
  const [promptsFr, setPromptsFr]     = useState<Record<string, string>>({})
  const [promptsEn, setPromptsEn]     = useState<Record<string, string>>({})
  const [translating, setTranslating] = useState<string | null>(null)
  // Refs pour les inputs file (une par slot, indexée par slotKey)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  // Refs pour les inputs file (une par slot, indexée par slotKey)
  // Paramètres visuels persistés dans name_image_settings
  type TextOverlayAnim = 'none' | 'typing' | 'fade'
  interface TextOverlay {
    id: string; text: string
    x: number; y: number          // % depuis coin haut-gauche de la carte
    font: string; color: string; size: number
    bold: boolean; italic: boolean; shadow: boolean
    animation: TextOverlayAnim
    typing_speed?: number          // ms par lettre, défaut 70
  }
  const [nameSettings, setNameSettings] = useState<FicheAllSettings>({ ...FICHE_DEFAULT_SETTINGS, ...(protagonist?.name_image_settings ?? {}) })

  // ds = settings for the currently active device (phone or tablet)
  const ds: typeof FICHE_DEFAULT_SETTINGS = previewMode === 'tablet'
    ? { ...FICHE_DEFAULT_SETTINGS, ...nameSettings, ...(nameSettings.tablet ?? {}) }
    : { ...FICHE_DEFAULT_SETTINGS, ...nameSettings }

  // Chargement des polices tag/graffiti + keyframes animations overlay
  useEffect(() => {
    const families = [
      'Permanent+Marker', 'Rock+Salt', 'Caveat:wght@700', 'Satisfy',
      'Covered+By+Your+Grace', 'Rubik+Spray+Paint', 'Boogaloo', 'Pacifico',
      'Special+Elite', 'Oswald:wght@700', 'Anton', 'Bebas+Neue',
    ]
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?${families.map(f => `family=${f}`).join('&')}&display=swap`
    document.head.appendChild(link)
    return () => {
      if (document.head.contains(link)) document.head.removeChild(link)
    }
  }, [])

  async function saveNameSettings(settings: typeof nameSettings) {
    if (!protagonist) return
    setNpcs(prev => prev.map(n => n.id === protagonist.id ? { ...n, name_image_settings: settings } : n))
    try {
      await fetch(`/api/npcs/${protagonist.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name_image_settings: settings }),
      })
    } catch (err) {
      console.error('[saveNameSettings]', err)
    }
  }

  function updateNameSetting(key: keyof typeof FICHE_DEFAULT_SETTINGS, value: number | string | boolean) {
    let next: FicheAllSettings
    if (previewMode === 'phone') {
      next = { ...nameSettings, [key]: value }
    } else {
      next = { ...nameSettings, tablet: { ...(nameSettings.tablet ?? {}), [key]: value } }
    }
    setNameSettings(next)
    saveNameSettings(next)
  }

  function updateOverlays(overlays: TextOverlay[]) {
    let next: FicheAllSettings
    if (previewMode === 'phone') {
      next = { ...nameSettings, text_overlays: overlays }
    } else {
      next = { ...nameSettings, tablet: { ...(nameSettings.tablet ?? {}), text_overlays: overlays } }
    }
    setNameSettings(next)
    saveNameSettings(next)
  }

  function addOverlay() {
    const newOverlay: TextOverlay = {
      id: Date.now().toString(),
      text: 'Nouveau texte',
      x: 10, y: 10,
      font: 'Georgia', color: '#ede9df', size: 16,
      bold: false, italic: false, shadow: true,
      animation: 'none',
    }
    updateOverlays([...(ds.text_overlays ?? []), newOverlay])
  }

  function patchOverlay(id: string, patch: Partial<TextOverlay>) {
    const overlays = (ds.text_overlays ?? []).map((o: any) => o.id === id ? { ...o, ...patch } : o)
    updateOverlays(overlays as TextOverlay[])
  }

  function removeOverlay(id: string) {
    updateOverlays((ds.text_overlays ?? []).filter((o: any) => o.id !== id))
  }

  async function translatePrompt(slotKey: string) {
    const fr = promptsFr[slotKey]?.trim()
    if (!fr) return
    setTranslating(slotKey)
    try {
      const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: fr }) })
      const { translated } = await res.json()
      setPromptsEn(prev => ({ ...prev, [slotKey]: translated }))
    } finally {
      setTranslating(null)
    }
  }

  async function uploadFile(field: string, file: File, slot?: number) {
    if (!protagonist) return
    setUploading(field)
    const suffix = slot !== undefined ? `${field}_${slot}` : field
    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', `books/${bookId}/npcs/${protagonist.id}/${suffix}`)
    const res = await fetch('/api/upload-file', { method: 'POST', body: formData })
    if (!res.ok) { alert('Erreur upload'); setUploading(null); return }
    const { url } = await res.json()

    if (field === 'character_illustrations' && slot !== undefined) {
      const current = [...(protagonist.character_illustrations ?? [])]
      current[slot] = url
      await fetch(`/api/npcs/${protagonist.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ character_illustrations: current }) })
      setNpcs(prev => prev.map(n => n.id === protagonist.id ? { ...n, character_illustrations: current } : n))
    } else {
      await fetch(`/api/npcs/${protagonist.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: url }) })
      setNpcs(prev => prev.map(n => n.id === protagonist.id ? { ...n, [field]: url } : n))
    }
    setUploading(null)
    setImgBuster(b => b + 1)
  }

  if (!protagonistNpcId || !protagonist) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '1rem' }}>
        <div style={{ fontSize: '3rem' }}>🃏</div>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', textAlign: 'center', maxWidth: '320px' }}>
          Aucun protagoniste défini. Allez dans l'onglet <strong style={{ color: 'var(--foreground)' }}>Personnages</strong> et cliquez 👑 sur le personnage principal.
        </p>
        <button onClick={onGoToNpcs} style={btnStyle('var(--accent)', '#0f0f14')}>→ Aller aux Personnages</button>
      </div>
    )
  }

  const illustrations = protagonist.character_illustrations ?? []

  const SLOTS: { field: string; label: string; icon: string; url: string | undefined; slot?: number; genData: Record<string, string> }[] = [
    {
      field: 'background_image_url', label: 'Background', icon: '🏙',
      url: bust(protagonist.background_image_url),
      genData: { type: 'background', theme: bookTheme, character: protagonist.name, description: protagonist.description ?? '', style: bookIllustrationStyle, illustration_bible: illustrationBible },
    },
    {
      field: 'name_image_url', label: 'Nom (image stylisée)', icon: '✍️',
      url: bust(protagonist.name_image_url),
      genData: { type: 'npc', custom_prompt: `Graffiti-style text logo of the name "${protagonist.name}", bold urban street art lettering, neon cyan glow, tilted angle, black background, no other elements` },
    },
    {
      field: 'portrait_url', label: 'Portrait buste', icon: '🧑',
      url: bust(protagonist.portrait_url ?? protagonist.image_url),
      genData: { type: 'npc', appearance: protagonist.appearance ?? '', origin: protagonist.origin ?? '', description: protagonist.description ?? '', theme: bookTheme, style: bookIllustrationStyle, illustration_bible: illustrationBible },
    },
    {
      field: 'character_illustrations', label: 'Illustration 1', icon: '🧍', slot: 0,
      url: bust(illustrations[0]),
      genData: { type: 'npc', appearance: protagonist.appearance ?? '', description: protagonist.description ?? '', theme: bookTheme, style: bookIllustrationStyle, illustration_bible: illustrationBible, framing: 'full body, front view' },
    },
    {
      field: 'character_illustrations', label: 'Illustration 2', icon: '🧍', slot: 1,
      url: bust(illustrations[1]),
      genData: { type: 'npc', appearance: protagonist.appearance ?? '', description: protagonist.description ?? '', theme: bookTheme, style: bookIllustrationStyle, illustration_bible: illustrationBible, framing: 'full body, three-quarter view' },
    },
    {
      field: 'character_illustrations', label: 'Illustration 3', icon: '🧍', slot: 2,
      url: bust(illustrations[2]),
      genData: { type: 'npc', appearance: protagonist.appearance ?? '', description: protagonist.description ?? '', theme: bookTheme, style: bookIllustrationStyle, illustration_bible: illustrationBible, framing: 'full body, action pose' },
    },
  ]

  // Protagonist avec URLs cache-bustées pour le preview (Supabase upsert = même URL)
  const bustedProtagonist = {
    ...protagonist,
    background_image_url: bust(protagonist.background_image_url),
    portrait_url:         bust(protagonist.portrait_url),
    image_url:            bust(protagonist.image_url),
    name_image_url:       bust(protagonist.name_image_url),
    character_illustrations: protagonist.character_illustrations?.map(url => bust(url) ?? url),
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 0, height: '100%', overflow: 'hidden' }}>

      {/* ── Aperçu fiche — fixe, pas de scroll ───────────────────────────────── */}
      <div style={{ padding: '1.5rem', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, gap: '0.75rem' }}>
        {/* Barre de contrôle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <p style={{ color: 'var(--muted)', fontSize: '0.78rem', margin: 0 }}>Aperçu du rendu en jeu</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Switch mode */}
            <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
              {(['phone', 'tablet'] as const).map(mode => (
                <button key={mode} onClick={() => setPreviewMode(mode)} style={{
                  padding: '3px 10px', fontSize: '0.68rem', cursor: 'pointer', border: 'none',
                  background: previewMode === mode ? 'rgba(212,168,76,0.2)' : 'transparent',
                  color: previewMode === mode ? '#d4a84c' : 'var(--muted)',
                  fontWeight: previewMode === mode ? 700 : 400,
                }}>
                  {mode === 'phone' ? '📱' : '📟'} {mode === 'phone' ? 'Téléphone' : 'Tablette'}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setPlayAnimKey(k => k + 1); setShowPlay(true) }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '4px 12px', borderRadius: '6px', border: '1px solid #d4a84c66', background: 'rgba(212,168,76,0.12)', color: '#d4a84c', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.05em' }}
            >
              ▶ Play
            </button>
          </div>
        </div>

        {/* Zone preview */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0c', borderRadius: '10px', overflow: 'hidden', padding: previewMode === 'phone' ? '1rem' : '0' }}>
          {previewMode === 'phone' ? (
            /* Cadre téléphone portrait */
            <div ref={fichePreviewRef} style={{
              position: 'relative', height: '100%', aspectRatio: '9 / 19.5', maxWidth: '100%',
              borderRadius: '28px', overflow: 'hidden', background: '#000',
              border: '2px solid #2a2a30', boxShadow: '0 0 0 4px #161618, 0 12px 40px rgba(0,0,0,0.9)',
              flexShrink: 0,
            }}>
              {/* Encoche */}
              <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '70px', height: '10px', background: '#161618', borderRadius: '0 0 8px 8px', zIndex: 10 }} />
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                <div style={{ width: '390px', height: '845px', transformOrigin: 'top left', transform: `scale(${fichePreviewScale})`, display: 'flex' }}>
                  <FicheCardView protagonist={bustedProtagonist as typeof protagonist} settings={nameSettings as FicheAllSettings} device="phone" />
                </div>
              </div>
            </div>
          ) : (
            /* Vue tablette — pleine largeur, légère bordure */
            <div style={{ width: '100%', height: '100%', display: 'flex', borderRadius: '10px', overflow: 'hidden' }}>
              <FicheCardView protagonist={bustedProtagonist as typeof protagonist} settings={nameSettings as FicheAllSettings} device="tablet" />
            </div>
          )}
        </div>
      </div>

      {/* ── Panneau médias ────────────────────────────────────────────────────── */}
      <div style={{ borderLeft: '1px solid var(--border)', padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p style={{ color: 'var(--muted)', fontSize: '0.78rem', margin: 0 }}>Médias du personnage</p>

        {SLOTS.map(slot => {
          const slotKey = `${slot.field}${slot.slot ?? ''}`
          const frPrompt  = promptsFr[slotKey] ?? ''
          const enPrompt  = promptsEn[slotKey] ?? ''
          const isTranslating = translating === slotKey
          // Données de génération : on injecte le prompt EN traduit si disponible
          const genData = enPrompt ? { ...slot.genData, custom_prompt: enPrompt } : slot.genData

          async function handleSaved(url: string) {
            if (slot.field === 'character_illustrations' && slot.slot !== undefined) {
              const current = [...(protagonist!.character_illustrations ?? [])]
              current[slot.slot] = url
              await fetch(`/api/npcs/${protagonist!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ character_illustrations: current }) })
              setNpcs(prev => prev.map(n => n.id === protagonist!.id ? { ...n, character_illustrations: current } : n))
            } else {
              await fetch(`/api/npcs/${protagonist!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [slot.field]: url }) })
              setNpcs(prev => prev.map(n => n.id === protagonist!.id ? { ...n, [slot.field]: url } : n))
            }
            setImgBuster(b => b + 1)
          }

          {
            const isCollapsed = collapsedBlocks.has(slotKey)
            return (
            <div key={slotKey} style={{ background: 'var(--surface)', border: `1px solid ${isCollapsed ? '#2a2a35' : '#3a3a55'}`, borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: isCollapsed ? 'none' : '0 2px 8px rgba(0,0,0,0.3)' }}>

              {/* En-tête cliquable */}
              <div onClick={() => toggleBlock(slotKey)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 0.9rem', background: isCollapsed ? '#1a1a1f' : '#222228', borderBottom: isCollapsed ? 'none' : '1px solid #3a3a48', cursor: 'pointer', userSelect: 'none' }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--muted)', transition: 'transform 0.15s', display: 'inline-block', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                <span style={{ fontSize: '1rem' }}>{slot.icon}</span>
                <strong style={{ fontSize: '0.78rem', color: isCollapsed ? 'var(--muted)' : 'var(--foreground)', flex: 1 }}>{slot.label}</strong>
                {slot.url
                  ? <span style={{ color: '#52c484', fontSize: '0.62rem', background: '#52c48420', border: '1px solid #52c48440', borderRadius: '4px', padding: '1px 6px' }}>✓</span>
                  : <span style={{ color: '#3a3a48', fontSize: '0.62rem' }}>—</span>}
              </div>

              {!isCollapsed && <div style={{ padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>

              {/* Miniature */}
              {slot.url && (
                <img src={slot.url} alt={slot.label} style={{ width: '100%', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)' }} />
              )}

              {/* Zone prompt français */}
              <div>
                <label style={{ fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '0.3rem' }}>
                  Prompt (français)
                </label>
                <textarea
                  value={frPrompt}
                  onChange={e => setPromptsFr(prev => ({ ...prev, [slotKey]: e.target.value }))}
                  placeholder={`Décrivez l'image souhaitée pour ${slot.label.toLowerCase()}…`}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical', fontSize: '0.75rem', lineHeight: '1.4' }}
                />
              </div>

              {/* Bouton traduire */}
              <button
                onClick={() => translatePrompt(slotKey)}
                disabled={!frPrompt.trim() || isTranslating}
                style={btnStyle(
                  frPrompt.trim() ? 'var(--surface-2)' : 'transparent',
                  frPrompt.trim() ? 'var(--foreground)' : 'var(--muted)',
                  '1px solid var(--border)'
                )}
              >
                {isTranslating ? '⟳ Traduction…' : '🌐 Traduire en anglais'}
              </button>

              {/* Prompt anglais (readonly) */}
              {enPrompt && (
                <div style={{ background: 'var(--surface-2)', borderRadius: '6px', padding: '0.5rem 0.6rem', border: '1px solid var(--border)' }}>
                  <p style={{ margin: '0 0 0.2rem', fontSize: '0.6rem', color: '#52c484', letterSpacing: '0.05em' }}>✓ PROMPT EN</p>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--muted)', lineHeight: '1.4', fontStyle: 'italic' }}>{enPrompt}</p>
                </div>
              )}

              {/* Actions : upload + générer */}
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  type="file" accept="image/*" style={{ display: 'none' }}
                  ref={el => { fileInputRefs.current[slotKey] = el }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) uploadFile(slot.field, f, slot.slot)
                    e.target.value = ''
                  }}
                />
                <button
                  onClick={() => fileInputRefs.current[slotKey]?.click()}
                  disabled={!!uploading}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                    padding: '0.4rem 0.6rem', borderRadius: '6px', fontSize: '0.72rem',
                    background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)',
                    cursor: uploading ? 'wait' : 'pointer',
                  }}
                >
                  {uploading === slotKey ? '…' : '📁 Importer'}
                </button>
                <div style={{ flex: 1 }}>
                  <ImageGenButton
                    type="npc"
                    provider={imageProvider ?? 'leonardo'}
                    storagePath={`books/${bookId}/npcs/${protagonist!.id}/${slot.field}${slot.slot !== undefined ? `_${slot.slot}` : ''}`}
                    data={genData}
                    currentUrl={slot.url}
                    label={enPrompt ? '✨ Générer (prompt)' : '✨ Générer'}
                    onSaved={handleSaved}
                  />
                </div>
              </div>

              {/* Slider opacité background — uniquement pour le slot background */}
              {slot.field === 'background_image_url' && protagonist.background_image_url && (
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>TRANSPARENCE (cadre stats)</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '58px' }}>Opacité</span>
                    <input
                      type="range" min={0} max={100} value={Math.round((ds.bg_opacity ?? 0.4) * 100)}
                      onChange={e => updateNameSetting('bg_opacity', Number(e.target.value) / 100)}
                      style={{ flex: 1, accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '36px', textAlign: 'right' }}>
                      {Math.round((ds.bg_opacity ?? 0.4) * 100)}%
                    </span>
                  </div>
                </div>
              )}

              {/* Effets & relief portrait — uniquement pour portrait_url */}
              {slot.field === 'portrait_url' && (<>
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>EFFETS PORTRAIT</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {([
                      { key: 'none',     label: 'Aucun' },
                      { key: 'shadow',   label: '◉ Ombre' },
                      { key: 'neon',     label: '✦ Néon doré' },
                      { key: 'dramatic', label: '◆ Dramatique' },
                      { key: 'mist',     label: '~ Brume' },
                      { key: 'blood',    label: '● Sang' },
                    ] as const).map(({ key, label }) => (
                      <button key={key} onClick={() => updateNameSetting('portrait_effect', key)} style={{
                        padding: '3px 9px', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer',
                        border: `1px solid ${(ds.portrait_effect ?? 'none') === key ? '#d4a84c' : 'var(--border)'}`,
                        background: (ds.portrait_effect ?? 'none') === key ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)',
                        color: (ds.portrait_effect ?? 'none') === key ? '#d4a84c' : 'var(--muted)',
                      }}>{label}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '68px' }}>Vignette</span>
                    <input type="range" min={0} max={100} value={ds.portrait_vignette ?? 0}
                      onChange={e => updateNameSetting('portrait_vignette', Number(e.target.value))}
                      style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '32px', textAlign: 'right' }}>{ds.portrait_vignette ?? 0}%</span>
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>RELIEF DU PORTRAIT</p>
                  {([
                    { key: 'portrait_elev'            as const, label: 'Élévation',  min: 0,   max: 40,  unit: 'px', def: 0  },
                    { key: 'portrait_shadow_x'        as const, label: 'Ombre →',    min: -20, max: 20,  unit: 'px', def: 6  },
                    { key: 'portrait_shadow_y'        as const, label: 'Ombre ↓',    min: -20, max: 20,  unit: 'px', def: 10 },
                    { key: 'portrait_shadow_opacity'  as const, label: 'Intensité',  min: 0,   max: 100, unit: '%',  def: 0  },
                  ]).map(({ key, label, min, max, unit, def }) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '68px' }}>{label}</span>
                      <input type="range" min={min} max={max} value={nameSettings[key] ?? def}
                        onChange={e => updateNameSetting(key, Number(e.target.value))}
                        style={{ flex: 1, accentColor: 'var(--accent)' }} />
                      <span style={{ fontSize: '0.65rem', color: (nameSettings[key] ?? def) !== def ? 'var(--accent)' : 'var(--foreground)', minWidth: '36px', textAlign: 'right' }}>
                        {nameSettings[key] ?? def}{unit}
                      </span>
                    </div>
                  ))}
                </div>
              </>)}

              {/* Sliders position/taille + tagline — uniquement pour l'image du nom */}
              {slot.field === 'name_image_url' && protagonist.name_image_url && (<>
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>POSITION & TAILLE</p>
                  {([
                    { key: 'width',    label: 'Largeur',  min: 40,  max: 400, unit: 'px' },
                    { key: 'bottom',   label: 'Bas ↕',    min: -100, max: 300, unit: 'px' },
                    { key: 'left',     label: 'Gauche ↔', min: -100, max: 300, unit: 'px' },
                    { key: 'rotation', label: 'Rotation', min: -45,  max: 45,  unit: '°'  },
                  ] as const).map(({ key, label, min, max, unit }) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '58px' }}>{label}</span>
                      <input
                        type="range" min={min} max={max} value={nameSettings[key] as number}
                        onChange={e => updateNameSetting(key, Number(e.target.value))}
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '36px', textAlign: 'right' }}>
                        {nameSettings[key]}{unit}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Tagline sous le nom */}
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>TAGLINE</p>
                  <input
                    type="text"
                    placeholder="ex: Chef des Freaks · Bronx, NY"
                    value={ds.tagline}
                    onChange={e => updateNameSetting('tagline', e.target.value)}
                    style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.35rem 0.6rem', color: 'var(--foreground)', fontSize: '0.75rem', boxSizing: 'border-box' }}
                  />
                  {/* Choix police */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '0.62rem', color: 'var(--muted)' }}>Police</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '180px', overflowY: 'auto' }}>
                      {[
                        'Permanent Marker', 'Rock Salt', 'Caveat', 'Satisfy',
                        'Covered By Your Grace', 'Rubik Spray Paint', 'Boogaloo', 'Pacifico',
                      ].map(font => (
                        <button key={font} onClick={() => updateNameSetting('tagline_font', font)} style={{
                          textAlign: 'left', padding: '4px 8px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                          background: ds.tagline_font === font ? 'rgba(212,168,76,0.2)' : 'var(--surface-2)',
                          color: ds.tagline_font === font ? '#d4a84c' : 'var(--foreground)',
                          fontFamily: `'${font}', cursive`, fontSize: '0.85rem',
                          outline: ds.tagline_font === font ? '1px solid #d4a84c55' : 'none',
                        }}>
                          {font}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Taille + couleur */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '40px' }}>Taille</span>
                    <input type="range" min={8} max={28} value={ds.tagline_size}
                      onChange={e => updateNameSetting('tagline_size', Number(e.target.value))}
                      style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.tagline_size}px</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '40px' }}>Couleur</span>
                    <input type="color" value={ds.tagline_color}
                      onChange={e => updateNameSetting('tagline_color', e.target.value)}
                      style={{ width: '36px', height: '24px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
                    <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', fontFamily: `'${ds.tagline_font}', cursive` }}>
                      {ds.tagline || 'aperçu'}
                    </span>
                  </div>
                  {/* Position du tagline */}
                  {([
                    { key: 'tagline_offset_x' as const, label: 'Décalage →', min: -100, max: 200, unit: 'px' },
                    { key: 'tagline_offset_y' as const, label: 'Décalage ↓', min: -60,  max: 60,  unit: 'px' },
                  ]).map(({ key, label, min, max, unit }) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '72px' }}>{label}</span>
                      <input type="range" min={min} max={max} value={nameSettings[key]}
                        onChange={e => updateNameSetting(key, Number(e.target.value))}
                        style={{ flex: 1, accentColor: 'var(--accent)' }} />
                      <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '36px', textAlign: 'right' }}>
                        {nameSettings[key]}{unit}
                      </span>
                    </div>
                  ))}
                </div>
              </>)}
            </div>}
            </div>
          )
          }
        })}

        {/* ── Musique ──────────────────────────────────────────────────────── */}
        {(() => { const _mc = collapsedBlocks.has('music'); return (
        <div style={{ background: 'var(--surface)', border: `1px solid ${_mc ? '#2a2a35' : '#3a3a55'}`, borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: _mc ? 'none' : '0 2px 8px rgba(0,0,0,0.3)' }}>
          <div onClick={() => toggleBlock('music')} style={{ padding: '0.55rem 0.9rem', background: _mc ? '#1a1a1f' : '#222228', borderBottom: _mc ? 'none' : '1px solid #3a3a48', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', display: 'inline-block', transform: _mc ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            <span style={{ fontSize: '1rem' }}>🎵</span>
            <strong style={{ fontSize: '0.78rem', color: _mc ? 'var(--muted)' : 'var(--foreground)', flex: 1 }}>Musique — Écran de création</strong>
            {nameSettings.music_url && <span style={{ color: '#52c484', fontSize: '0.62rem', background: '#52c48420', border: '1px solid #52c48440', borderRadius: '4px', padding: '1px 6px' }}>✓</span>}
            <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: '4px', background: previewMode === 'tablet' ? 'rgba(76,155,240,0.15)' : 'rgba(212,168,76,0.15)', color: previewMode === 'tablet' ? '#4c9bf0' : '#d4a84c', border: `1px solid ${previewMode === 'tablet' ? '#4c9bf040' : '#d4a84c40'}` }}>{previewMode === 'tablet' ? '📟' : '📱'}</span>
          </div>
          {!_mc && <div style={{ padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="URL directe (.mp3, .ogg…)"
                value={nameSettings.music_url ?? ''}
                onChange={e => updateNameSetting('music_url', e.target.value)}
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem 0.6rem', color: 'var(--foreground)', fontSize: '0.75rem', outline: 'none' }}
              />
              <button
                onClick={() => setFreesoundOpen(true)}
                style={{ padding: '0.35rem 0.6rem', background: 'none', border: '1px solid #4c9bf044', borderRadius: '5px', color: '#4c9bf0', cursor: 'pointer', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
              >🔍 Freesound</button>
              {nameSettings.music_url && (
                <button onClick={() => updateNameSetting('music_url', '')} style={{ padding: '0.3rem 0.5rem', background: 'none', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.78rem' }}>✕</button>
              )}
            </div>
            {/* Générer avec MusicGen */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.65rem 0.75rem', background: 'rgba(212,168,76,0.05)', border: '1px solid rgba(212,168,76,0.2)', borderRadius: '7px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--accent)', fontWeight: 'bold', letterSpacing: '0.05em' }}>✨ MUSICGEN — Générer par IA</span>
                {musicSaved && <span style={{ fontSize: '0.62rem', color: '#4caf7d', background: '#4caf7d22', border: '1px solid #4caf7d44', borderRadius: '4px', padding: '1px 6px' }}>✓ Sauvegardé</span>}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  type="text"
                  value={musicPrompt}
                  onChange={e => setMusicPrompt(e.target.value)}
                  placeholder="Décrivez la musique…"
                  style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '5px', padding: '0.35rem 0.55rem', color: 'var(--foreground)', fontSize: '0.73rem', outline: 'none' }}
                />
                <button
                  onClick={generateMusic}
                  disabled={generatingMusic || !musicPrompt.trim()}
                  style={{ padding: '0.35rem 0.75rem', background: generatingMusic ? 'rgba(212,168,76,0.1)' : 'var(--accent)', border: generatingMusic ? '1px solid var(--accent)' : 'none', borderRadius: '5px', color: generatingMusic ? 'var(--accent)' : '#000', fontWeight: 'bold', fontSize: '0.73rem', cursor: generatingMusic ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                >
                  {generatingMusic ? '⟳ Génération…' : '🎵 Générer'}
                </button>
              </div>
              <div style={{ fontSize: '0.62rem', color: 'var(--muted)' }}>30 secondes · stereo-large · ~45s de traitement</div>
            </div>
            {/* Upload fichier audio */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.7rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', cursor: uploadingAudio ? 'wait' : 'pointer', fontSize: '0.75rem', color: 'var(--muted)' }}>
              <input type="file" accept="audio/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadAudio(f); e.target.value = '' }} />
              {uploadingAudio ? '⟳ Upload…' : '📁 Importer un fichier audio'}
            </label>
            {/* Prévisualisation */}
            {nameSettings.music_url && (
              <audio key={`${nameSettings.music_url}-${audioBuster}`} controls src={`${(nameSettings.music_url ?? '').split('?')[0]}?v=${audioBuster}`}
                style={{ width: '100%', height: '36px', accentColor: 'var(--accent)' }} />
            )}
            {!nameSettings.music_url && (
              <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucune musique — la piste jouera en boucle pendant la création du personnage.</p>
            )}
          </div>}
        </div>
        )})()}

        {/* ── Layout & Dimensions ───────────────────────────────────────────── */}
        {(() => { const _lc = collapsedBlocks.has('layout'); return (
        <div style={{ background: 'var(--surface)', border: `1px solid ${_lc ? '#2a2a35' : '#3a3a55'}`, borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: _lc ? 'none' : '0 2px 8px rgba(0,0,0,0.3)' }}>
          <div onClick={() => toggleBlock('layout')} style={{ padding: '0.55rem 0.9rem', background: _lc ? '#1a1a1f' : '#222228', borderBottom: _lc ? 'none' : '1px solid #3a3a48', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', display: 'inline-block', transform: _lc ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            <span style={{ fontSize: '1rem' }}>📐</span>
            <strong style={{ fontSize: '0.78rem', color: _lc ? 'var(--muted)' : 'var(--foreground)', flex: 1 }}>Layout & Dimensions</strong>
            <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: '4px', background: previewMode === 'tablet' ? 'rgba(76,155,240,0.15)' : 'rgba(212,168,76,0.15)', color: previewMode === 'tablet' ? '#4c9bf0' : '#d4a84c', border: `1px solid ${previewMode === 'tablet' ? '#4c9bf040' : '#d4a84c40'}` }}>{previewMode === 'tablet' ? '📟' : '📱'}</span>
          </div>
          {!_lc && <div style={{ padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {/* Layout toggle */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>DISPOSITION</p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['horizontal', 'vertical'] as const).map(l => (
                  <button key={l} onClick={() => updateNameSetting('layout', l)} style={{
                    flex: 1, padding: '8px 4px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.72rem',
                    border: `1px solid ${(ds.layout ?? 'horizontal') === l ? '#d4a84c' : 'var(--border)'}`,
                    background: (ds.layout ?? 'horizontal') === l ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)',
                    color: (ds.layout ?? 'horizontal') === l ? '#d4a84c' : 'var(--muted)',
                  }}>
                    {l === 'horizontal' ? '◫  Portrait | Stats' : '▣  Portrait\n    Stats'}
                  </button>
                ))}
              </div>
            </div>
            {/* Slider portrait width (horizontal) ou height (vertical) */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>
                {(ds.layout ?? 'horizontal') === 'horizontal' ? 'LARGEUR PORTRAIT' : 'HAUTEUR PORTRAIT'}
              </p>
              {(ds.layout ?? 'horizontal') === 'horizontal' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Largeur</span>
                  <input type="range" min={20} max={65} value={ds.portrait_width_pct ?? 40}
                    onChange={e => updateNameSetting('portrait_width_pct', Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.portrait_width_pct ?? 40}%</span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Hauteur</span>
                  <input type="range" min={25} max={75} value={ds.portrait_height_pct ?? 52}
                    onChange={e => updateNameSetting('portrait_height_pct', Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.portrait_height_pct ?? 52}%</span>
                </div>
              )}
            </div>
          </div>}
        </div>
        )})()}

        {/* ── Stats & Boutons ───────────────────────────────────────────────── */}
        {(() => { const _sc = collapsedBlocks.has('stats'); return (
        <div style={{ background: 'var(--surface)', border: `1px solid ${_sc ? '#2a2a35' : '#3a3a55'}`, borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: _sc ? 'none' : '0 2px 8px rgba(0,0,0,0.3)' }}>
          <div onClick={() => toggleBlock('stats')} style={{ padding: '0.55rem 0.9rem', background: _sc ? '#1a1a1f' : '#222228', borderBottom: _sc ? 'none' : '1px solid #3a3a48', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', display: 'inline-block', transform: _sc ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            <span style={{ fontSize: '1rem' }}>📊</span>
            <strong style={{ fontSize: '0.78rem', color: _sc ? 'var(--muted)' : 'var(--foreground)', flex: 1 }}>Stats & Boutons</strong>
            <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: '4px', background: previewMode === 'tablet' ? 'rgba(76,155,240,0.15)' : 'rgba(212,168,76,0.15)', color: previewMode === 'tablet' ? '#4c9bf0' : '#d4a84c', border: `1px solid ${previewMode === 'tablet' ? '#4c9bf040' : '#d4a84c40'}` }}>{previewMode === 'tablet' ? '📟' : '📱'}</span>
          </div>
          {!_sc && <div style={{ padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {/* Position bloc stats */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>POSITION DU BLOC STATS</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Position ↕</span>
                <input type="range" min={-60} max={60} value={ds.stats_offset_y ?? 0}
                  onChange={e => updateNameSetting('stats_offset_y', Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.stats_offset_y ?? 0}px</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Position ↔</span>
                <input type="range" min={-60} max={60} value={ds.stats_offset_x ?? 0}
                  onChange={e => updateNameSetting('stats_offset_x', Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.stats_offset_x ?? 0}px</span>
              </div>
            </div>
            {/* Labels */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>LABELS (FORCE, AGILITÉ…)</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Taille</span>
                <input type="range" min={8} max={28} value={ds.stats_label_size ?? 13}
                  onChange={e => updateNameSetting('stats_label_size', Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.stats_label_size ?? 13}px</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Couleur</span>
                <input type="color" value={ds.stats_label_color ?? '#d4a84c'}
                  onChange={e => updateNameSetting('stats_label_color', e.target.value)}
                  style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                <span style={{ fontSize: '0.72rem', color: ds.stats_label_color ?? '#d4a84c', fontFamily: 'Georgia, serif', fontStyle: (ds.stats_label_italic ?? true) ? 'italic' : 'normal', fontWeight: (ds.stats_label_bold ?? true) ? '900' : '400', textTransform: 'uppercase', letterSpacing: '1px' }}>FORCE</span>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {([{ key: 'stats_label_bold' as const, label: 'G' }, { key: 'stats_label_italic' as const, label: 'I' }]).map(({ key, label }) => (
                  <button key={key} onClick={() => updateNameSetting(key, !(nameSettings[key] ?? true) as any)} style={{
                    padding: '2px 10px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer',
                    border: `1px solid ${(nameSettings[key] ?? true) ? '#d4a84c' : 'var(--border)'}`,
                    background: (nameSettings[key] ?? true) ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)',
                    color: (nameSettings[key] ?? true) ? '#d4a84c' : 'var(--muted)',
                    fontWeight: key === 'stats_label_bold' ? '900' : '400',
                    fontStyle: key === 'stats_label_italic' ? 'italic' : 'normal',
                  }}>{label}</button>
                ))}
              </div>
            </div>
            {/* Valeurs */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>VALEURS (chiffres)</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Taille</span>
                <input type="range" min={14} max={72} value={ds.stats_value_size ?? 27}
                  onChange={e => updateNameSetting('stats_value_size', Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.stats_value_size ?? 27}px</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Couleur</span>
                <input type="color" value={ds.stats_value_color ?? '#ede9df'}
                  onChange={e => updateNameSetting('stats_value_color', e.target.value)}
                  style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                <span style={{ fontFamily: 'Georgia, serif', fontWeight: '900', fontSize: '1.1rem', color: ds.stats_value_color ?? '#ede9df' }}>12</span>
              </div>
            </div>
            {/* Lance les dés */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>TEXTE "LANCE LES DÉS"</p>
              <input type="text" value={ds.dice_text ?? 'Lance les dés (3 essais)'}
                onChange={e => updateNameSetting('dice_text', e.target.value)}
                style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.35rem 0.6rem', color: 'var(--foreground)', fontSize: '0.75rem', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Taille</span>
                <input type="range" min={8} max={22} value={ds.dice_size ?? 12}
                  onChange={e => updateNameSetting('dice_size', Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.dice_size ?? 12}px</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Couleur</span>
                <input type="color" value={ds.dice_color ?? '#ede9df'}
                  onChange={e => updateNameSetting('dice_color', e.target.value)}
                  style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                <span style={{ fontSize: '0.65rem', color: ds.dice_color ?? '#ede9df', fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>aperçu</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '44px' }}>Fond</span>
                  <input type="color" value={ds.dice_bg_color && ds.dice_bg_color !== 'transparent' ? ds.dice_bg_color : '#000000'}
                    onChange={e => updateNameSetting('dice_bg_color', e.target.value)}
                    style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '44px' }}>Bordure</span>
                  <input type="color" value={ds.dice_border_color || ds.dice_color || '#ede9df'}
                    onChange={e => updateNameSetting('dice_border_color', e.target.value)}
                    style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Position ↕</span>
                <input type="range" min={-30} max={30} value={ds.dice_offset_y ?? 0}
                  onChange={e => updateNameSetting('dice_offset_y', Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.dice_offset_y ?? 0}px</span>
              </div>
            </div>
            {/* CTA */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>BOUTON "COMMENCER"</p>
              <input type="text" value={ds.cta_text ?? "COMMENCER L'AVENTURE"}
                onChange={e => updateNameSetting('cta_text', e.target.value)}
                style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.35rem 0.6rem', color: 'var(--foreground)', fontSize: '0.75rem', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '44px' }}>Fond</span>
                  <input type="color" value={ds.cta_color ?? '#d4a84c'}
                    onChange={e => updateNameSetting('cta_color', e.target.value)}
                    style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '44px' }}>Texte</span>
                  <input type="color" value={ds.cta_text_color ?? '#0d0d0d'}
                    onChange={e => updateNameSetting('cta_text_color', e.target.value)}
                    style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Taille</span>
                <input type="range" min={6} max={20} value={ds.cta_font_size ?? 9}
                  onChange={e => updateNameSetting('cta_font_size', Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.cta_font_size ?? 9}px</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '52px' }}>Position ↕</span>
                <input type="range" min={-30} max={30} value={ds.cta_offset_y ?? 0}
                  onChange={e => updateNameSetting('cta_offset_y', Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '28px', textAlign: 'right' }}>{ds.cta_offset_y ?? 0}px</span>
              </div>
            </div>
          </div>}
        </div>
        )})()}

        {/* ── Sliders illustrations ─────────────────────────────────────────── */}
        {(() => { const _ic = collapsedBlocks.has('illustrations'); return (
        <div style={{ background: 'var(--surface)', border: `1px solid ${_ic ? '#2a2a35' : '#3a3a55'}`, borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: _ic ? 'none' : '0 2px 8px rgba(0,0,0,0.3)' }}>
          <div onClick={() => toggleBlock('illustrations')} style={{ padding: '0.55rem 0.9rem', background: _ic ? '#1a1a1f' : '#222228', borderBottom: _ic ? 'none' : '1px solid #3a3a48', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', display: 'inline-block', transform: _ic ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            <span style={{ fontSize: '1rem' }}>🧍</span>
            <strong style={{ fontSize: '0.78rem', color: _ic ? 'var(--muted)' : 'var(--foreground)', flex: 1 }}>Illustrations — Mise en page</strong>
            <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: '4px', background: previewMode === 'tablet' ? 'rgba(76,155,240,0.15)' : 'rgba(212,168,76,0.15)', color: previewMode === 'tablet' ? '#4c9bf0' : '#d4a84c', border: `1px solid ${previewMode === 'tablet' ? '#4c9bf040' : '#d4a84c40'}` }}>{previewMode === 'tablet' ? '📟' : '📱'}</span>
          </div>
          {!_ic && <div style={{ padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>DIMENSIONS</p>
          {([
            { key: 'ill_height', label: 'Hauteur', min: 40, max: 300, unit: 'px' },
            { key: 'ill_gap',    label: 'Espacement', min: 0, max: 24, unit: 'px' },
          ] as const).map(({ key, label, min, max, unit }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '72px' }}>{label}</span>
              <input
                type="range" min={min} max={max} value={nameSettings[key]}
                onChange={e => updateNameSetting(key, Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '36px', textAlign: 'right' }}>
                {nameSettings[key]}{unit}
              </span>
            </div>
          ))}
          </div>}
        </div>
        )})()}

        {/* ── Effets image ─────────────────────────────────────────────────── */}
        {(() => { const _ec = collapsedBlocks.has('effects'); return (
        <div style={{ background: 'var(--surface)', border: `1px solid ${_ec ? '#2a2a35' : '#3a3a55'}`, borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: _ec ? 'none' : '0 2px 8px rgba(0,0,0,0.3)' }}>
          <div onClick={() => toggleBlock('effects')} style={{ padding: '0.55rem 0.9rem', background: _ec ? '#1a1a1f' : '#222228', borderBottom: _ec ? 'none' : '1px solid #3a3a48', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', display: 'inline-block', transform: _ec ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            <span style={{ fontSize: '1rem' }}>✨</span>
            <strong style={{ fontSize: '0.78rem', color: _ec ? 'var(--muted)' : 'var(--foreground)', flex: 1 }}>Effets image</strong>
            <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: '4px', background: previewMode === 'tablet' ? 'rgba(76,155,240,0.15)' : 'rgba(212,168,76,0.15)', color: previewMode === 'tablet' ? '#4c9bf0' : '#d4a84c', border: `1px solid ${previewMode === 'tablet' ? '#4c9bf040' : '#d4a84c40'}` }}>{previewMode === 'tablet' ? '📟' : '📱'}</span>
          </div>
          {!_ec && <div style={{ padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {/* Illustrations */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>ILLUSTRATIONS</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {([
                  { key: 'none',     label: 'Aucun' },
                  { key: 'shadow',   label: '◉ Ombre' },
                  { key: 'neon',     label: '✦ Néon doré' },
                  { key: 'dramatic', label: '◆ Dramatique' },
                  { key: 'mist',     label: '~ Brume' },
                  { key: 'blood',    label: '● Sang' },
                ] as const).map(({ key, label }) => (
                  <button key={key} onClick={() => updateNameSetting('ill_effect', key)} style={{
                    padding: '3px 9px', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer',
                    border: `1px solid ${(ds.ill_effect ?? 'none') === key ? '#d4a84c' : 'var(--border)'}`,
                    background: (ds.ill_effect ?? 'none') === key ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)',
                    color: (ds.ill_effect ?? 'none') === key ? '#d4a84c' : 'var(--muted)',
                  }}>{label}</button>
                ))}
              </div>
            </div>
            {/* Ombre illustrations */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>OMBRE ILLUSTRATIONS</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {([
                  { key: 'none',        label: 'Aucun' },
                  { key: 'shadow',      label: '◉ Ombre' },
                  { key: 'glow_gold',   label: '✦ Glow doré' },
                  { key: 'glow_red',    label: '● Glow rouge' },
                  { key: 'glow_blue',   label: '◈ Glow bleu' },
                  { key: 'border_gold', label: '▣ Cadre doré' },
                ] as const).map(({ key, label: btnLabel }) => (
                  <button key={key} onClick={() => updateNameSetting('ill_box_shadow', key)} style={{
                    padding: '3px 9px', borderRadius: '4px', fontSize: '0.7rem', cursor: 'pointer',
                    border: `1px solid ${(ds.ill_box_shadow ?? 'none') === key ? '#d4a84c' : 'var(--border)'}`,
                    background: (ds.ill_box_shadow ?? 'none') === key ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)',
                    color: (ds.ill_box_shadow ?? 'none') === key ? '#d4a84c' : 'var(--muted)',
                  }}>{btnLabel}</button>
                ))}
              </div>
            </div>

            {/* Bloc 3D */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ margin: 0, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>EFFET 3D — INCLINAISON</p>
                <button onClick={() => { updateNameSetting('card_rotate_x', 0); updateNameSetting('card_rotate_y', 0) }}
                  style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: '3px', border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>Reset</button>
              </div>
              {([
                { key: 'card_rotate_x' as const, label: 'Tilt X ↕', min: -30, max: 30, unit: '°' },
                { key: 'card_rotate_y' as const, label: 'Tilt Y ↔', min: -30, max: 30, unit: '°' },
                { key: 'card_perspective' as const, label: 'Perspective', min: 200, max: 2000, unit: 'px' },
              ]).map(({ key, label, min, max, unit }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '72px' }}>{label}</span>
                  <input type="range" min={min} max={max} value={nameSettings[key] ?? (key === 'card_perspective' ? 800 : 0)}
                    onChange={e => updateNameSetting(key, Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: '0.65rem', color: (nameSettings[key] ?? 0) !== 0 ? 'var(--accent)' : 'var(--foreground)', minWidth: '42px', textAlign: 'right' }}>
                    {nameSettings[key] ?? (key === 'card_perspective' ? 800 : 0)}{unit}
                  </span>
                </div>
              ))}
              <p style={{ margin: 0, fontSize: '0.6rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                Les ombres s'adaptent automatiquement à l'inclinaison. Remet à 0 avant de sauvegarder.
              </p>
            </div>

          </div>}
        </div>
        )})()}

        {/* ── Textes libres ────────────────────────────────────────────────── */}
        {(() => { const _tc = collapsedBlocks.has('overlays'); return (
        <div style={{ background: 'var(--surface)', border: `1px solid ${_tc ? '#2a2a35' : '#3a3a55'}`, borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: _tc ? 'none' : '0 2px 8px rgba(0,0,0,0.3)' }}>
          <div onClick={() => toggleBlock('overlays')} style={{ padding: '0.55rem 0.9rem', background: _tc ? '#1a1a1f' : '#222228', borderBottom: _tc ? 'none' : '1px solid #3a3a48', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--muted)', display: 'inline-block', transform: _tc ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            <span style={{ fontSize: '1rem' }}>✏️</span>
            <strong style={{ fontSize: '0.78rem', color: _tc ? 'var(--muted)' : 'var(--foreground)', flex: 1 }}>Textes libres</strong>
            <button onClick={e => { e.stopPropagation(); addOverlay() }} style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', border: '1px solid #d4a84c55', background: 'rgba(212,168,76,0.1)', color: '#d4a84c', cursor: 'pointer' }}>+ Ajouter</button>
          </div>
          {!_tc && <div style={{ padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {(ds.text_overlays ?? []).length === 0 && (
              <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center' }}>
                Aucun texte — clique sur "+ Ajouter"
              </p>
            )}
            {(ds.text_overlays ?? []).map((overlay, idx) => (
              <div key={overlay.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a48', borderRadius: '6px', padding: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {/* Header overlay */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.62rem', color: 'var(--muted)', fontWeight: 700 }}>TEXTE {idx + 1}</span>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => removeOverlay(overlay.id)} style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: '3px', border: '1px solid #e0555540', background: 'rgba(224,85,85,0.1)', color: '#e05555', cursor: 'pointer' }}>✕</button>
                </div>
                {/* Texte */}
                <textarea
                  value={overlay.text}
                  onChange={e => patchOverlay(overlay.id, { text: e.target.value })}
                  rows={2}
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.3rem 0.5rem', color: 'var(--foreground)', fontSize: '0.78rem', resize: 'vertical', boxSizing: 'border-box', fontFamily: `'${overlay.font}', sans-serif` }}
                />
                {/* Position X / Y */}
                {([
                  { key: 'x' as const, label: 'Position →', min: 0, max: 95, unit: '%' },
                  { key: 'y' as const, label: 'Position ↓', min: 0, max: 95, unit: '%' },
                ]).map(({ key, label, min, max, unit }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '68px' }}>{label}</span>
                    <input type="range" min={min} max={max} value={overlay[key]}
                      onChange={e => patchOverlay(overlay.id, { [key]: Number(e.target.value) })}
                      style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '32px', textAlign: 'right' }}>{overlay[key]}{unit}</span>
                  </div>
                ))}
                {/* Taille */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '68px' }}>Taille</span>
                  <input type="range" min={8} max={72} value={overlay.size}
                    onChange={e => patchOverlay(overlay.id, { size: Number(e.target.value) })}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '32px', textAlign: 'right' }}>{overlay.size}px</span>
                </div>
                {/* Couleur */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '68px' }}>Couleur</span>
                  <input type="color" value={overlay.color}
                    onChange={e => patchOverlay(overlay.id, { color: e.target.value })}
                    style={{ width: '36px', height: '22px', border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }} />
                  <span style={{ fontSize: '0.72rem', color: overlay.color, fontFamily: `'${overlay.font}', sans-serif` }}>Aperçu</span>
                </div>
                {/* Style : gras / italic / ombre */}
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {([
                    { key: 'bold' as const, label: 'G' },
                    { key: 'italic' as const, label: 'I' },
                    { key: 'shadow' as const, label: '◫ Ombre' },
                  ]).map(({ key, label }) => (
                    <button key={key} onClick={() => patchOverlay(overlay.id, { [key]: !overlay[key] })} style={{
                      padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem',
                      border: `1px solid ${overlay[key] ? '#d4a84c' : 'var(--border)'}`,
                      background: overlay[key] ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)',
                      color: overlay[key] ? '#d4a84c' : 'var(--muted)',
                      cursor: 'pointer',
                      fontWeight: key === 'bold' ? '900' : '400',
                      fontStyle: key === 'italic' ? 'italic' : 'normal',
                    }}>{label}</button>
                  ))}
                </div>
                {/* Animation */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '68px' }}>Animation</span>
                  <div style={{ display: 'flex', gap: '0.3rem', flex: 1 }}>
                    {(['none', 'typing', 'fade'] as const).map(anim => (
                      <button key={anim} onClick={() => patchOverlay(overlay.id, { animation: anim })} style={{
                        flex: 1, padding: '3px 6px', borderRadius: '4px', fontSize: '0.65rem',
                        border: `1px solid ${overlay.animation === anim ? '#d4a84c' : 'var(--border)'}`,
                        background: overlay.animation === anim ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)',
                        color: overlay.animation === anim ? '#d4a84c' : 'var(--muted)',
                        cursor: 'pointer',
                      }}>{anim === 'none' ? 'Fixe' : anim === 'typing' ? '✍ Typing' : '✦ Fade'}</button>
                    ))}
                  </div>
                </div>
                {/* Vitesse typing */}
                {overlay.animation === 'typing' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', minWidth: '68px' }}>Vitesse</span>
                    <input type="range" min={20} max={300} value={overlay.typing_speed ?? 70}
                      onChange={e => patchOverlay(overlay.id, { typing_speed: Number(e.target.value) })}
                      style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: '0.65rem', color: 'var(--foreground)', minWidth: '40px', textAlign: 'right' }}>{overlay.typing_speed ?? 70}ms</span>
                  </div>
                )}
                {/* Police */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '0.62rem', color: 'var(--muted)' }}>Police</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '140px', overflowY: 'auto' }}>
                    {[
                      'Georgia', 'Anton', 'Bebas Neue', 'Oswald',
                      'Special Elite', 'Permanent Marker', 'Rock Salt',
                      'Caveat', 'Satisfy', 'Rubik Spray Paint', 'Pacifico',
                    ].map(font => (
                      <button key={font} onClick={() => patchOverlay(overlay.id, { font })} style={{
                        textAlign: 'left', padding: '3px 6px', borderRadius: '3px', border: 'none', cursor: 'pointer',
                        background: overlay.font === font ? 'rgba(212,168,76,0.15)' : 'var(--surface-2)',
                        color: overlay.font === font ? '#d4a84c' : 'var(--foreground)',
                        fontFamily: `'${font}', serif`, fontSize: '0.82rem',
                        outline: overlay.font === font ? '1px solid #d4a84c55' : 'none',
                      }}>{font}</button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>}
        </div>
        )})()}

      </div>

      {/* ── Modal Play — simulation écran joueur ── */}
      {showPlay && (
        <div
          key={playAnimKey}
          onClick={() => setShowPlay(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}
        >
          {/* Carte centrée — stop propagation pour ne pas fermer en cliquant dedans */}
          <div
            onClick={e => e.stopPropagation()}
            style={{ position: 'relative', width: 'min(480px, 92vw)', height: 'min(76vh, 660px)', borderRadius: '16px', overflow: 'hidden', display: 'flex', boxShadow: '0 0 80px rgba(0,0,0,0.8)' }}
          >
            {/* Keyframes (play modal remonte via key={playAnimKey}) */}
            <style>{`
              @keyframes overlay-fade { from { opacity:0 } to { opacity:1 } }
              @keyframes overlay-char { from { opacity:0; transform:translateY(5px) } to { opacity:1; transform:translateY(0) } }
              @keyframes overlay-show { from { opacity:0 } to { opacity:1 } }
            `}</style>

            {/* Fond */}
            <div style={{ position: 'absolute', inset: 0, background: '#0a0a0c', zIndex: 0 }} />

            {/* Colonne gauche : portrait */}
            <div style={{ position: 'relative', zIndex: 2, width: '40%', flexShrink: 0, overflow: 'hidden', alignSelf: 'stretch' }}>
              {(protagonist.portrait_url ?? protagonist.image_url) ? (
                <img src={bust(protagonist.portrait_url ?? protagonist.image_url)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', filter: ficheEffectToFilter(ds.portrait_effect) }} />
              ) : (
                <div style={{ position: 'absolute', inset: 0, background: '#1a1a1f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '5rem', opacity: 0.12 }}>🧑</span>
                </div>
              )}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }} />
              {ds.portrait_vignette > 0 && (
                <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${ds.portrait_vignette / 100}) 100%)`, pointerEvents: 'none' }} />
              )}
              {protagonist.name_image_url && (
                <div style={{ position: 'absolute', bottom: `${ds.bottom}px`, left: `${ds.left}px`, transform: `rotate(${ds.rotation}deg)`, transformOrigin: 'left bottom', zIndex: 3, pointerEvents: 'none' }}>
                  <img src={bust(protagonist.name_image_url)} alt={protagonist.name} style={{ width: `${ds.width}px`, objectFit: 'contain', display: 'block', filter: 'drop-shadow(2px 2px 6px rgba(0,0,0,0.9))' }} />
                  {ds.tagline && (
                    <p style={{ margin: 0, position: 'relative', top: `${ds.tagline_offset_y}px`, left: `${ds.tagline_offset_x}px`, fontFamily: `'${ds.tagline_font}', cursive`, fontSize: `${ds.tagline_size}px`, color: ds.tagline_color, textShadow: '1px 1px 4px rgba(0,0,0,0.95)', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{ds.tagline}</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Relief portrait (modal play) ── */}
            {(ds.portrait_elev > 0 || ds.portrait_shadow_opacity > 0) && (() => {
              const elev = ds.portrait_elev ?? 0
              const sx   = ds.portrait_shadow_x ?? 6
              const op   = (ds.portrait_shadow_opacity ?? 0) / 100
              const width = Math.max(4, elev * 2.5 + 6)
              return (
                <>
                  <div style={{ position: 'absolute', top: 0, left: `calc(40% + ${Math.max(0, sx - 2)}px)`, width: `${width}px`, height: '100%', background: `linear-gradient(to right, rgba(0,0,0,${(0.3 + op * 0.65).toFixed(2)}), transparent)`, zIndex: 3, pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', top: 0, left: `calc(40% - 2px)`, width: '2px', height: '100%', background: `rgba(255,255,255,${Math.min(0.18, elev * 0.006).toFixed(3)})`, zIndex: 4, pointerEvents: 'none' }} />
                </>
              )
            })()}

            {/* Colonne droite : stats + illustrations */}
            <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 16px', overflow: 'hidden', boxShadow: (() => { const elev = ds.portrait_elev ?? 0; const op = (ds.portrait_shadow_opacity ?? 0) / 100; if (elev === 0 && op === 0) return 'none'; const blur = elev * 3 + 8; return `inset ${blur}px 0 ${blur}px -${Math.round(blur/2)}px rgba(0,0,0,${(0.4 + op * 0.5).toFixed(2)})`; })() }}>
              {protagonist.background_image_url && (
                <img src={bust(protagonist.background_image_url)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: ds.bg_opacity ?? 0.4, zIndex: 0 }} />
              )}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 0 }} />
              <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column' }}>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px', padding: '8px', marginTop: `${ds.stats_offset_y ?? 0}px`, marginLeft: `${ds.stats_offset_x ?? 0}px` }}>
                  {FICHE_STATS_DISPLAY.map(({ key, label }) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '3px 0' }}>
                      <span style={{ fontFamily: 'Georgia, serif', fontWeight: (ds.stats_label_bold ?? true) ? '900' : '400', fontStyle: (ds.stats_label_italic ?? true) ? 'italic' : 'normal', fontSize: `${ds.stats_label_size ?? 13}px`, textTransform: 'uppercase', letterSpacing: '1.5px', color: ds.stats_label_color ?? '#d4a84c' }}>{label}</span>
                      <span style={{ fontFamily: 'Georgia, serif', fontWeight: '900', fontSize: `${ds.stats_value_size ?? 27}px`, color: ds.stats_value_color ?? '#ede9df', lineHeight: 1 }}>{(protagonist as any)[key] ?? 0}</span>
                    </div>
                  ))}
                </div>
                <div style={{ textAlign: 'center', padding: '4px 0', marginTop: `${ds.dice_offset_y ?? 0}px`, flexShrink: 0 }}>
                  <div style={{ display: 'inline-block', background: ds.dice_bg_color || 'transparent', border: `1px solid ${ds.dice_border_color || ds.dice_color || '#ede9df'}`, borderRadius: '3px', padding: '3px 10px' }}>
                    <span style={{ color: ds.dice_color ?? '#ede9df', fontSize: `${ds.dice_size ?? 12}px`, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
                      {ds.dice_text || 'Lance les dés (3 essais)'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: `${ds.ill_gap}px`, height: `${ds.ill_height}px`, flexShrink: 0 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ flex: 1, background: illustrations[i] ? 'transparent' : '#1a1a1f', borderRadius: '4px', overflow: 'hidden', border: illustrations[i] ? '1px solid rgba(255,255,255,0.08)' : '1px dashed #2a2a30', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: ficheContainerShadow(ds.ill_box_shadow) }}>
                      {illustrations[i] ? <img src={bust(illustrations[i])} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: ficheEffectToFilter(ds.ill_effect) }} /> : <span style={{ fontSize: '1rem', opacity: 0.15 }}>🧍</span>}
                    </div>
                  ))}
                </div>
                <div style={{ padding: '6px 0', marginTop: `${ds.cta_offset_y ?? 0}px`, flexShrink: 0 }}>
                  <div style={{ background: ds.cta_color ?? '#d4a84c', borderRadius: '3px', padding: '8px', textAlign: 'center' }}>
                    <span style={{ fontFamily: 'Georgia, serif', fontWeight: '900', fontStyle: 'italic', color: ds.cta_text_color ?? '#0d0d0d', fontSize: `${ds.cta_font_size ?? 9}px`, letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                      {ds.cta_text || "COMMENCER L'AVENTURE"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Overlays texte avec animations séquentielles */}
            {(() => {
              const overlays = ds.text_overlays ?? []
              const startTimes = ficheOverlayStartTimes(overlays)
              return overlays.map((overlay, idx) => {
                const startTime = startTimes[idx]
                const base: React.CSSProperties = {
                  position: 'absolute', left: `${overlay.x}%`, top: `${overlay.y}%`,
                  fontFamily: `'${overlay.font}', Georgia, serif`,
                  fontSize: `${overlay.size}px`, color: overlay.color,
                  fontWeight: overlay.bold ? '900' : '400',
                  fontStyle: overlay.italic ? 'italic' : 'normal',
                  textShadow: overlay.shadow ? '1px 1px 6px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.8)' : undefined,
                  pointerEvents: 'none', zIndex: 20, whiteSpace: 'pre-wrap', lineHeight: 1.3,
                }
                if (overlay.animation === 'fade') return (
                  <div key={overlay.id} style={{ ...base, animation: `overlay-fade 1.4s ${startTime}s both` }}>{overlay.text}</div>
                )
                if (overlay.animation === 'typing') {
                  const ms = overlay.typing_speed ?? 70
                  return (
                    <div key={overlay.id} style={{ ...base, animation: `overlay-show 0.01s ${startTime}s both` }}>
                      {overlay.text.split('').map((char, i) => (
                        <span key={i} style={{ display: 'inline-block', animation: `overlay-char 0.06s ${startTime + i * (ms / 1000)}s both` }}>
                          {char === ' ' ? '\u00a0' : char === '\n' ? '\n' : char}
                        </span>
                      ))}
                    </div>
                  )
                }
                return <div key={overlay.id} style={{ ...base, animation: `overlay-show 0.01s ${startTime}s both` }}>{overlay.text}</div>
              })
            })()}
          </div>

          {/* Barre de contrôle */}
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button
              onClick={() => setPlayAnimKey(k => k + 1)}
              style={{ padding: '8px 20px', borderRadius: '8px', border: '1px solid #d4a84c', background: 'rgba(212,168,76,0.15)', color: '#d4a84c', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.05em' }}
            >↺ Replay</button>
            <button
              onClick={() => setShowPlay(false)}
              style={{ padding: '8px 20px', borderRadius: '8px', border: '1px solid #3a3a48', background: 'rgba(255,255,255,0.05)', color: 'var(--muted)', fontSize: '0.85rem', cursor: 'pointer' }}
            >✕ Fermer</button>
          </div>
          <p style={{ margin: 0, fontSize: '0.65rem', color: '#9898b4' }}>Clic sur le fond pour fermer</p>
        </div>
      )}

      {/* ── Modal Freesound musique création ── */}
      {freesoundOpen && (
        <FreesoundModal
          sectionType="dark urban ambient hip-hop"
          onSelect={url => {
            updateNameSetting('music_url', url)
            setFreesoundOpen(false)
          }}
          onClose={() => setFreesoundOpen(false)}
        />
      )}

    </div>
  )
}

const VOICE_SETTINGS_DEFAULTS = { stability: 0.5, style: 0, speed: 1, similarity_boost: 0.75 }

const NPC_DEFAULTS = {
  name: '', type: 'ennemi' as NpcType, description: '',
  appearance: '', origin: '',
  force: 5, agilite: 5, intelligence: 5, magie: 0, endurance: 10, chance: 5,
  special_ability: '', resistances: '', loot: '',
  speech_style: '', dialogue_intro: '',
  voice_id: '',
  voice_settings: { ...VOICE_SETTINGS_DEFAULTS },
  voice_prompt: '',
}

function NpcTab({ bookId, bookTheme, bookIllustrationStyle, illustrationBible = '', imageProvider, npcs, setNpcs, sections, onNavigate, protagonistNpcId, onSetProtagonist, voices = [], voicesLoaded = false }: { bookId: string; bookTheme: string; bookIllustrationStyle: string; illustrationBible?: string; imageProvider?: 'replicate' | 'leonardo'; npcs: Npc[]; setNpcs: (fn: (prev: Npc[]) => Npc[]) => void; sections: Section[]; onNavigate: (n: number) => void; protagonistNpcId: string | null; onSetProtagonist: (npcId: string | null) => Promise<void>; voices?: { voice_id: string; name: string; category?: string; labels: Record<string, string>; preview_url: string | null }[]; voicesLoaded?: boolean }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...NPC_DEFAULTS })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null)

  function playVoicePreview(voiceId: string) {
    const voice = voices.find(v => v.voice_id === voiceId)
    if (!voice?.preview_url) return
    if (previewAudio) { previewAudio.pause(); previewAudio.currentTime = 0 }
    const audio = new Audio(voice.preview_url)
    setPreviewAudio(audio)
    audio.play().catch(() => {})
  }

  function openCreate() { setForm({ ...NPC_DEFAULTS }); setEditingId(null); setShowForm(true) }
  function openEdit(npc: Npc) {
    setForm({
      name: npc.name, type: npc.type, description: npc.description ?? '',
      appearance: npc.appearance ?? '', origin: npc.origin ?? '',
      force: npc.force, agilite: npc.agilite, intelligence: npc.intelligence,
      magie: npc.magie, endurance: npc.endurance, chance: npc.chance,
      special_ability: npc.special_ability ?? '', resistances: npc.resistances ?? '', loot: npc.loot ?? '',
      speech_style: npc.speech_style ?? '', dialogue_intro: npc.dialogue_intro ?? '',
      voice_id: npc.voice_id ?? '',
      voice_settings: npc.voice_settings ?? { ...VOICE_SETTINGS_DEFAULTS },
      voice_prompt: npc.voice_prompt ?? '',
    })
    setEditingId(npc.id); setShowForm(true)
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    if (editingId) {
      const res = await fetch(`/api/npcs/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) { const err = await res.json().catch(() => ({})); alert('Erreur sauvegarde : ' + (err.error ?? res.status)); setSaving(false); return }
      setNpcs(prev => prev.map(n => n.id === editingId ? { ...n, ...form } : n))
    } else {
      const res = await fetch(`/api/books/${bookId}/npcs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) { const err = await res.json().catch(() => ({})); alert('Erreur création : ' + (err.error ?? res.status)); setSaving(false); return }
      const created = await res.json()
      setNpcs(prev => [...prev, created])
    }
    setSaving(false); setShowForm(false); setEditingId(null)
  }

  async function deleteNpc(id: string) {
    setDeletingId(id)
    await fetch(`/api/npcs/${id}`, { method: 'DELETE' })
    setNpcs(prev => prev.filter(n => n.id !== id))
    setDeletingId(null)
  }

  async function uploadNpcFile(npcId: string, field: 'background_image_url' | 'portrait_url', file: File) {
    const suffix = field === 'background_image_url' ? 'background' : 'portrait'
    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', `books/${bookId}/npcs/${npcId}/${suffix}`)
    const res = await fetch('/api/upload-file', { method: 'POST', body: formData })
    if (!res.ok) { alert('Erreur upload'); return }
    const { url } = await res.json()
    await fetch(`/api/npcs/${npcId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: url }) })
    setNpcs(prev => prev.map(n => n.id === npcId ? { ...n, [field]: url } : n))
  }

  const [uploadingEmotion, setUploadingEmotion] = useState<string | null>(null)
  async function uploadNpcEmotion(npcId: string, emotion: string, file: File) {
    setUploadingEmotion(`${npcId}_${emotion}`)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', `books/${bookId}/npcs/${npcId}/emotion_${emotion}`)
    const res = await fetch('/api/upload-file', { method: 'POST', body: formData })
    if (!res.ok) { alert('Erreur upload'); setUploadingEmotion(null); return }
    const { url } = await res.json()
    const npc = npcs.find(n => n.id === npcId)
    const newEmotions = { ...(npc?.portrait_emotions ?? {}), [emotion]: url }
    await fetch(`/api/npcs/${npcId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portrait_emotions: newEmotions }) })
    setNpcs(prev => prev.map(n => n.id === npcId ? { ...n, portrait_emotions: newEmotions } : n))
    setUploadingEmotion(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>
          Fiches des personnages non joueurs — utilisées lors des combats et épreuves.
        </p>
        <button onClick={openCreate} style={btnStyle('var(--accent)', '#0f0f14')}>+ Ajouter un PNJ</button>
      </div>

      {/* Formulaire création uniquement */}
      {showForm && !editingId && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: '10px',
          padding: '1.5rem', marginBottom: '1.5rem',
        }}>
          <h3 style={{ color: 'var(--accent)', marginTop: 0, marginBottom: '1.25rem', fontSize: '1rem' }}>
            {editingId ? '✏ Modifier le PNJ' : '+ Nouveau PNJ'}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={labelStyle}>Nom *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} placeholder="Ex: Seigneur Malven" />
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as NpcType }))} style={inputStyle}>
                {Object.entries(NPC_TYPE_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Apparence, rôle dans l'histoire..." />
          </div>

          {/* Statistiques */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ ...labelStyle, marginBottom: '0.75rem' }}>Statistiques de combat</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
              {STATS.map(stat => (
                <div key={stat.key}>
                  <label style={{ fontSize: '0.72rem', color: stat.color, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    {stat.icon} {stat.label}
                  </label>
                  <input type="number" min={0} max={99}
                    value={(form as any)[stat.key]}
                    onChange={e => setForm(f => ({ ...f, [stat.key]: parseInt(e.target.value) || 0 }))}
                    style={{ ...inputStyle, textAlign: 'center' }} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={labelStyle}>Capacité spéciale</label>
              <input value={form.special_ability} onChange={e => setForm(f => ({ ...f, special_ability: e.target.value }))} style={inputStyle} placeholder="Ex: Attaque de feu (×2 dégâts)" />
            </div>
            <div>
              <label style={labelStyle}>Résistances / Faiblesses</label>
              <input value={form.resistances} onChange={e => setForm(f => ({ ...f, resistances: e.target.value }))} style={inputStyle} placeholder="Ex: Immunisé au feu, sensible à l'eau" />
            </div>
            <div>
              <label style={labelStyle}>Butin (si vaincu)</label>
              <input value={form.loot} onChange={e => setForm(f => ({ ...f, loot: e.target.value }))} style={inputStyle} placeholder="Ex: Épée +2, 50 pièces d'or" />
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>👤 Allure (description physique)</label>
            <textarea value={form.appearance} onChange={e => setForm(f => ({ ...f, appearance: e.target.value }))}
              style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Ex: Grand, cheveux gris, cicatrice sur la joue gauche, cape noire effilochée..." />
          </div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>🌍 Origine (contexte géographique/social)</label>
            <textarea value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))}
              style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Ex: Ancien chevalier de la garde royale, tombé en disgrâce après la bataille de Voraven..." />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>🎭 Style de parole / Accent</label>
            <input value={form.speech_style} onChange={e => setForm(f => ({ ...f, speech_style: e.target.value }))} style={inputStyle} placeholder="Ex: Accent du sud, tutoie toujours, dit 'hé l'ami' en accroche, phrases courtes" />
          </div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>💬 Introduction du dialogue (facultatif)</label>
            <textarea value={form.dialogue_intro} onChange={e => setForm(f => ({ ...f, dialogue_intro: e.target.value }))} style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} placeholder="Ex: Une vieille femme aux yeux laiteux vous fait signe depuis l'ombre. 'Psst, mon moineau…'" />
          </div>

          <VoicePanel
            form={form} setForm={setForm}
            voices={voices} voicesLoaded={voicesLoaded}
            playVoicePreview={playVoicePreview}
          />

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={save} disabled={saving || !form.name.trim()} style={btnStyle('var(--accent)', '#0f0f14')}>
              {saving ? 'Sauvegarde...' : '✓ Sauvegarder'}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null) }} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Liste des PNJ */}
      {npcs.length === 0 && !showForm ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: 'var(--surface)', borderRadius: '10px', border: '1px dashed var(--border)' }}>
          <p style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>👥</p>
          <p style={{ color: 'var(--muted)' }}>Aucun PNJ pour ce livre.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {npcs.map(npc => {
            const tc = NPC_TYPE_CONFIG[npc.type]

            // ── Mode édition inline ──────────────────────────────────────────
            if (editingId === npc.id && showForm) {
              return (
                <div key={npc.id} style={{
                  background: 'var(--surface)', border: '1px solid var(--accent)',
                  borderRadius: '10px', padding: '1.5rem',
                }}>
                  <h3 style={{ color: 'var(--accent)', marginTop: 0, marginBottom: '1.25rem', fontSize: '1rem' }}>
                    ✏ Modifier — {npc.name}
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <label style={labelStyle}>Nom *</label>
                      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} placeholder="Ex: Seigneur Malven" />
                    </div>
                    <div>
                      <label style={labelStyle}>Type</label>
                      <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as NpcType }))} style={inputStyle}>
                        {Object.entries(NPC_TYPE_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.icon} {v.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={labelStyle}>Description</label>
                    <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Apparence, rôle dans l'histoire..." />
                  </div>

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ ...labelStyle, marginBottom: '0.75rem' }}>Statistiques de combat</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                      {STATS.map(stat => (
                        <div key={stat.key}>
                          <label style={{ fontSize: '0.72rem', color: stat.color, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            {stat.icon} {stat.label}
                          </label>
                          <input type="number" min={0} max={99}
                            value={(form as any)[stat.key]}
                            onChange={e => setForm(f => ({ ...f, [stat.key]: parseInt(e.target.value) || 0 }))}
                            style={{ ...inputStyle, textAlign: 'center' }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={labelStyle}>Capacité spéciale</label>
                      <input value={form.special_ability} onChange={e => setForm(f => ({ ...f, special_ability: e.target.value }))} style={inputStyle} placeholder="Ex: Attaque de feu (×2 dégâts)" />
                    </div>
                    <div>
                      <label style={labelStyle}>Résistances / Faiblesses</label>
                      <input value={form.resistances} onChange={e => setForm(f => ({ ...f, resistances: e.target.value }))} style={inputStyle} placeholder="Ex: Immunisé au feu, sensible à l'eau" />
                    </div>
                    <div>
                      <label style={labelStyle}>Butin (si vaincu)</label>
                      <input value={form.loot} onChange={e => setForm(f => ({ ...f, loot: e.target.value }))} style={inputStyle} placeholder="Ex: Épée +2, 50 pièces d'or" />
                    </div>
                  </div>

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={labelStyle}>👤 Allure (description physique)</label>
                    <textarea value={form.appearance} onChange={e => setForm(f => ({ ...f, appearance: e.target.value }))}
                      style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Ex: Grand, cheveux gris, cicatrice sur la joue gauche, cape noire effilochée..." />
                  </div>
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={labelStyle}>🌍 Origine (contexte géographique/social)</label>
                    <textarea value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))}
                      style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Ex: Ancien chevalier de la garde royale, tombé en disgrâce après la bataille de Voraven..." />
                  </div>

                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={labelStyle}>🎭 Style de parole / Accent</label>
                    <input value={form.speech_style} onChange={e => setForm(f => ({ ...f, speech_style: e.target.value }))} style={inputStyle} placeholder="Ex: Accent du sud, tutoie toujours, dit 'hé l'ami' en accroche, phrases courtes" />
                  </div>
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={labelStyle}>💬 Introduction du dialogue (facultatif)</label>
                    <textarea value={form.dialogue_intro} onChange={e => setForm(f => ({ ...f, dialogue_intro: e.target.value }))} style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} placeholder="Ex: Une vieille femme aux yeux laiteux vous fait signe depuis l'ombre." />
                  </div>

                  <VoicePanel
                    form={form} setForm={setForm}
                    voices={voices} voicesLoaded={voicesLoaded}
                    playVoicePreview={playVoicePreview}
                  />

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button onClick={save} disabled={saving || !form.name.trim()} style={btnStyle('var(--accent)', '#0f0f14')}>
                      {saving ? 'Sauvegarde...' : '✓ Sauvegarder'}
                    </button>
                    <button onClick={() => { setShowForm(false); setEditingId(null) }} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>
                      Annuler
                    </button>
                  </div>
                </div>
              )
            }

            const isProtagonist = npc.id === protagonistNpcId
            return (
              <div key={npc.id} style={{
                background: 'var(--surface)',
                border: isProtagonist ? '2px solid var(--accent)' : `1px solid ${tc.color}44`,
                borderRadius: '10px', padding: '1.25rem',
              }}>
                {/* Badge protagoniste */}
                {isProtagonist && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
                    <span style={{ fontSize: '0.7rem', background: 'var(--accent)', color: '#0f0f14', padding: '0.15rem 0.6rem', borderRadius: '20px', fontWeight: 'bold', letterSpacing: '0.05em' }}>
                      👑 PROTAGONISTE
                    </span>
                  </div>
                )}

                {/* En-tête PNJ */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    {/* Colonne images */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flexShrink: 0 }}>
                      {/* Portrait IA */}
                      <div style={{ position: 'relative' }}>
                        {npc.image_url ? (
                          <img src={npc.image_url} alt={npc.name} style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px', border: `2px solid ${tc.color}55` }} />
                        ) : (
                          <span style={{ fontSize: '1.5rem', width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: tc.color + '22', borderRadius: '8px' }}>{tc.icon}</span>
                        )}
                      </div>
                      {/* Miniatures background + portrait corps */}
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <label title="Background fiche personnage" style={{ cursor: 'pointer', position: 'relative' }}>
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadNpcFile(npc.id, 'background_image_url', f) }} />
                          {npc.background_image_url ? (
                            <img src={npc.background_image_url} alt="bg" style={{ width: '26px', height: '26px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--accent)55' }} />
                          ) : (
                            <span style={{ width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', borderRadius: '4px', border: '1px dashed var(--border)', fontSize: '0.65rem', color: 'var(--muted)' }} title="Ajouter un background">🖼</span>
                          )}
                        </label>
                        <label title="Portrait corps entier" style={{ cursor: 'pointer', position: 'relative' }}>
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadNpcFile(npc.id, 'portrait_url', f) }} />
                          {npc.portrait_url ? (
                            <img src={npc.portrait_url} alt="portrait" style={{ width: '26px', height: '26px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--accent)55' }} />
                          ) : (
                            <span style={{ width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', borderRadius: '4px', border: '1px dashed var(--border)', fontSize: '0.65rem', color: 'var(--muted)' }} title="Ajouter un portrait corps entier">🧍</span>
                          )}
                        </label>
                      </div>
                    </div>

                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--foreground)' }}>{npc.name}</h3>
                      <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.55rem', borderRadius: '20px', background: tc.color + '22', color: tc.color, fontWeight: 'bold' }}>
                        {tc.label}
                      </span>
                      <div style={{ marginTop: '0.3rem' }}>
                        <ImageGenButton
                          type="npc"
                          provider={imageProvider}
                          storagePath={`books/${bookId}/npcs/${npc.id}`}
                          data={{ type: npc.type, appearance: npc.appearance ?? '', origin: npc.origin ?? '', description: npc.description ?? '', theme: bookTheme, style: bookIllustrationStyle, illustration_bible: illustrationBible }}
                          currentUrl={npc.image_url}
                          label="Portrait IA"
                          onSaved={url => {
                            setNpcs(prev => prev.map(n => n.id === npc.id ? { ...n, image_url: url } : n))
                            fetch(`/api/npcs/${npc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: url }) })
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => onSetProtagonist(isProtagonist ? null : npc.id)}
                        title={isProtagonist ? 'Retirer le rôle de protagoniste' : 'Définir comme protagoniste'}
                        style={btnStyle(isProtagonist ? 'var(--accent)22' : 'var(--surface-2)', isProtagonist ? 'var(--accent)' : 'var(--muted)', `1px solid ${isProtagonist ? 'var(--accent)55' : 'var(--border)'}`)}
                      >👑</button>
                      <button onClick={() => openEdit(npc)} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>✏</button>
                      <button onClick={() => deleteNpc(npc.id)} disabled={deletingId === npc.id} style={btnStyle('#c94c4c22', '#c94c4c', '1px solid #c94c4c44')}>
                        {deletingId === npc.id ? '...' : '🗑'}
                      </button>
                    </div>
                    {/* Labels images upload */}
                    <div style={{ display: 'flex', gap: '0.4rem', fontSize: '0.6rem', color: 'var(--muted)' }}>
                      <span style={{ color: npc.background_image_url ? 'var(--accent)' : 'var(--muted)' }}>🖼 bg</span>
                      <span style={{ color: npc.portrait_url ? 'var(--accent)' : 'var(--muted)' }}>🧍 portrait</span>
                    </div>
                  </div>
                </div>

                {npc.description && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem', fontStyle: 'italic' }}>{npc.description}</p>
                )}
                {(npc.appearance || npc.origin) && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {npc.appearance && <span>👤 {npc.appearance}</span>}
                    {npc.origin && <span>🌍 {npc.origin}</span>}
                  </div>
                )}

                {/* Barres de stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem 1rem', marginBottom: '0.75rem' }}>
                  {STATS.map(stat => {
                    const val = (npc as any)[stat.key] as number
                    const max = stat.key === 'endurance' ? Math.max(val, 20) : 20
                    return (
                      <div key={stat.key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', marginBottom: '0.2rem' }}>
                          <span style={{ color: stat.color }}>{stat.icon} {stat.label}</span>
                          <span style={{ fontWeight: 'bold', color: 'var(--foreground)' }}>{val}</span>
                        </div>
                        <div style={{ height: '5px', background: 'var(--surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min((val / max) * 100, 100)}%`, height: '100%', background: stat.color, borderRadius: '3px' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Infos complémentaires */}
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.78rem', marginBottom: '0.6rem' }}>
                  {npc.special_ability && (
                    <span style={{ color: '#b48edd' }}>⚡ <strong>Capacité :</strong> {npc.special_ability}</span>
                  )}
                  {npc.resistances && (
                    <span style={{ color: '#4ec9b0' }}>🛡 <strong>Résistances :</strong> {npc.resistances}</span>
                  )}
                  {npc.loot && (
                    <span style={{ color: '#f0a742' }}>💰 <strong>Butin :</strong> {npc.loot}</span>
                  )}
                </div>

                {npc.speech_style && (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.73rem', color: '#64b5f6', fontStyle: 'italic', borderLeft: '2px solid #64b5f644', paddingLeft: '0.5rem' }}>
                    🎭 {npc.speech_style}
                  </p>
                )}
                {npc.voice_id && (
                  <div style={{ margin: '0.4rem 0 0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.72rem', color: '#4ec9b0' }}>🎙 {voices.find(v => v.voice_id === npc.voice_id)?.name ?? npc.voice_id}</span>
                    {voices.find(v => v.voice_id === npc.voice_id)?.preview_url && (
                      <button onClick={() => playVoicePreview(npc.voice_id!)} title="Écouter la voix" style={{ background: 'none', border: '1px solid #4ec9b044', borderRadius: '4px', color: '#4ec9b0', cursor: 'pointer', padding: '0.1rem 0.45rem', fontSize: '0.7rem' }}>▶</button>
                    )}
                  </div>
                )}

                {/* Portraits émotions (dialogue manga) */}
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.6rem' }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>😶 Portraits émotions</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                    {EMOTIONS.map(em => {
                      const url = npc.portrait_emotions?.[em]
                      const isUploading = uploadingEmotion === `${npc.id}_${em}`
                      return (
                        <label key={em} title={em} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadNpcEmotion(npc.id, em, f) }} />
                          <div style={{ width: '44px', height: '54px', borderRadius: '4px', overflow: 'hidden', border: `1px solid ${url ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {isUploading
                              ? <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>⏳</span>
                              : url
                                ? <img src={url} alt={em} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
                                : <span style={{ fontSize: '1rem', opacity: 0.3 }}>+</span>
                            }
                          </div>
                          <span style={{ fontSize: '0.5rem', color: url ? 'var(--accent)' : 'var(--muted)', whiteSpace: 'nowrap' }}>{em}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {/* Sections où ce PNJ apparaît */}
                {(() => {
                  const secs = sections.filter(s => s.trial?.npc_id === npc.id).sort((a, b) => a.number - b.number)
                  return secs.length > 0 ? (
                    <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.72rem' }}>
                      <span style={{ color: 'var(--muted)' }}>Apparaît dans :</span>
                      {secs.map(s => {
                        const t = getSectionType(s)
                        return (
                          <button key={s.id} onClick={() => onNavigate(s.number)} title={`Aller à la section ${s.number}`} style={{
                            padding: '0.2rem 0.55rem', borderRadius: '5px',
                            background: t.color + '22', color: t.color,
                            border: `1px solid ${t.color}55`,
                            fontWeight: 'bold', cursor: 'pointer', fontSize: '0.72rem',
                            display: 'flex', alignItems: 'center', gap: '0.25rem',
                          }}>
                            <span>{t.icon}</span> §{s.number}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                      Pas encore associé à une section
                    </p>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Panneau Narration ─────────────────────────────────────────────────────────

const NARRATION_MODES = [
  { key: 'bordage',     label: 'Style Bordage', icon: '📖', desc: 'Réécriture complète dans le style Pierre Bordage' },
  { key: 'intensifier', label: 'Intensifier',   icon: '🔥', desc: 'Phrases courtes, tension maximale' },
  { key: 'alléger',     label: 'Alléger',       icon: '🌱', desc: 'Vocabulaire simple, public 8-12 ans' },
  { key: 'corriger',    label: 'Corriger',      icon: '✓',  desc: 'Orthographe et grammaire uniquement' },
  { key: 'résumé',      label: 'Résumé',        icon: '✦',  desc: 'Génère la phrase résumé (12 mots max)' },
]

function NarrationPanel({ sectionId, content, onApply, onClose }: {
  sectionId: string
  content: string
  onApply: (sectionId: string, newContent: string) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState('bordage')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [compareMode, setCompareMode] = useState(false)
  const [compareLoading, setCompareLoading] = useState(false)
  const [claudeResult, setClaudeResult] = useState('')
  const [mistralResult, setMistralResult] = useState('')
  const [compareError, setCompareError] = useState('')
  const [applySource, setApplySource] = useState<'claude' | 'mistral' | null>(null)
  const [resultMode, setResultMode] = useState<string | null>(null)

  async function generate() {
    setLoading(true); setError(''); setResult('')
    try {
      const res = await fetch('/api/narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data.result)
      setResultMode(mode)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function compare() {
    // Si Claude a déjà généré un résultat pour ce mode, ne pas le regénérer
    const claudeAlreadyGenerated = result && resultMode === mode
    setCompareLoading(true); setCompareError('')
    setMistralResult('')
    if (claudeAlreadyGenerated) {
      setClaudeResult(result)
    } else {
      setClaudeResult('')
    }
    try {
      const res = await fetch('/api/compare-narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mode, skipClaude: claudeAlreadyGenerated }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.claudeError) setCompareError(`Claude : ${data.claudeError}`)
      if (data.mistralError) setCompareError(e => e ? `${e} | Mistral : ${data.mistralError}` : `Mistral : ${data.mistralError}`)
      if (!claudeAlreadyGenerated) setClaudeResult(data.claude ?? '')
      setMistralResult(data.mistral ?? '')
    } catch (err: any) {
      setCompareError(err.message)
    }
    setCompareLoading(false)
  }

  const resultForApply = applySource === 'claude' ? claudeResult : applySource === 'mistral' ? mistralResult : result

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0009', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid #b48edd66',
        borderRadius: '12px', width: '100%', maxWidth: compareMode ? '1200px' : '860px',
        maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        transition: 'max-width 0.2s',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontWeight: 'bold', color: '#b48edd', fontSize: '1rem' }}>✨ Atelier Narration</span>
            <button
              onClick={() => { setCompareMode(m => !m); setApplySource(null) }}
              style={{
                fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: '20px',
                border: `1px solid ${compareMode ? '#f0a742' : 'var(--border)'}`,
                background: compareMode ? '#f0a74222' : 'transparent',
                color: compareMode ? '#f0a742' : 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              ⚖ {compareMode ? 'Mode comparaison actif' : 'Comparer Claude vs Mistral'}
            </button>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>

        <div style={{ overflow: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Sélection du mode */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
            {NARRATION_MODES.map(m => (
              <button key={m.key} onClick={() => setMode(m.key)} style={{
                padding: '0.5rem 0.4rem', borderRadius: '7px', cursor: 'pointer', textAlign: 'center',
                border: `2px solid ${mode === m.key ? '#b48edd' : 'var(--border)'}`,
                background: mode === m.key ? '#b48edd22' : 'var(--surface-2)',
                color: mode === m.key ? '#b48edd' : 'var(--muted)',
                transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: '1.1rem', marginBottom: '0.15rem' }}>{m.icon}</div>
                <div style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>{m.label}</div>
                <div style={{ fontSize: '0.6rem', opacity: 0.75, marginTop: '0.1rem', lineHeight: 1.3 }}>{m.desc}</div>
              </button>
            ))}
          </div>

          {/* ── Mode normal ── */}
          {!compareMode && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Texte original</div>
                  <div style={{
                    background: 'var(--surface-2)', borderRadius: '8px', padding: '0.85rem',
                    fontSize: '0.82rem', lineHeight: 1.65, color: 'var(--muted)',
                    whiteSpace: 'pre-wrap', maxHeight: '320px', overflow: 'auto',
                  }}>
                    {content}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#b48edd', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                    Version {NARRATION_MODES.find(m2 => m2.key === mode)?.label}
                  </div>
                  <div style={{
                    background: 'var(--surface-2)', border: `1px solid ${result ? '#b48edd44' : 'var(--border)'}`,
                    borderRadius: '8px', padding: '0.85rem',
                    fontSize: '0.82rem', lineHeight: 1.65, color: result ? 'var(--foreground)' : 'var(--muted)',
                    whiteSpace: 'pre-wrap', maxHeight: '320px', overflow: 'auto',
                    minHeight: '80px', display: 'flex', alignItems: loading ? 'center' : 'flex-start', justifyContent: loading ? 'center' : 'flex-start',
                  }}>
                    {loading ? (
                      <span style={{ color: '#b48edd', fontSize: '0.85rem' }}>✨ Réécriture en cours...</span>
                    ) : result || (
                      <span style={{ fontStyle: 'italic' }}>Le texte réécrit apparaîtra ici.</span>
                    )}
                  </div>
                </div>
              </div>
              {error && <p style={{ color: '#c94c4c', fontSize: '0.82rem', background: '#c94c4c11', padding: '0.6rem', borderRadius: '6px' }}>⚠ {error}</p>}
            </>
          )}

          {/* ── Mode comparaison ── */}
          {compareMode && (
            <>
              {/* Texte original */}
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Texte original</div>
                <div style={{
                  background: 'var(--surface-2)', borderRadius: '8px', padding: '0.85rem',
                  fontSize: '0.8rem', lineHeight: 1.65, color: 'var(--muted)',
                  whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto',
                }}>
                  {content}
                </div>
              </div>

              {/* Comparaison côte à côte */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {/* Claude */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#c9a84c', fontWeight: 'bold' }}>
                      ⚡ Claude Sonnet 4.6
                    </div>
                    {claudeResult && (
                      <button
                        onClick={() => { setApplySource('claude'); onApply(sectionId, claudeResult) }}
                        style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: '4px', border: 'none', background: 'var(--accent)', color: '#0f0f14', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        ✓ Appliquer
                      </button>
                    )}
                  </div>
                  <div style={{
                    background: 'var(--surface-2)', border: `1px solid ${claudeResult ? '#c9a84c44' : 'var(--border)'}`,
                    borderRadius: '8px', padding: '0.85rem',
                    fontSize: '0.82rem', lineHeight: 1.65, color: claudeResult ? 'var(--foreground)' : 'var(--muted)',
                    whiteSpace: 'pre-wrap', maxHeight: '380px', overflow: 'auto', minHeight: '80px',
                  }}>
                    {compareLoading ? (
                      <span style={{ color: '#c9a84c', fontSize: '0.85rem' }}>⚡ Génération...</span>
                    ) : claudeResult || (
                      <span style={{ fontStyle: 'italic' }}>Résultat Claude ici.</span>
                    )}
                  </div>
                </div>

                {/* Mistral */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#f0824c', fontWeight: 'bold' }}>
                      🌟 Mistral Large
                    </div>
                    {mistralResult && (
                      <button
                        onClick={() => { setApplySource('mistral'); onApply(sectionId, mistralResult) }}
                        style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: '4px', border: 'none', background: 'var(--accent)', color: '#0f0f14', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        ✓ Appliquer
                      </button>
                    )}
                  </div>
                  <div style={{
                    background: 'var(--surface-2)', border: `1px solid ${mistralResult ? '#f0824c44' : 'var(--border)'}`,
                    borderRadius: '8px', padding: '0.85rem',
                    fontSize: '0.82rem', lineHeight: 1.65, color: mistralResult ? 'var(--foreground)' : 'var(--muted)',
                    whiteSpace: 'pre-wrap', maxHeight: '380px', overflow: 'auto', minHeight: '80px',
                  }}>
                    {compareLoading ? (
                      <span style={{ color: '#f0824c', fontSize: '0.85rem' }}>🌟 Génération...</span>
                    ) : mistralResult || (
                      <span style={{ fontStyle: 'italic' }}>
                        {process.env.NEXT_PUBLIC_HAS_MISTRAL ? 'Résultat Mistral ici.' : 'Ajoutez MISTRAL_API_KEY dans .env.local'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {compareError && <p style={{ color: '#c94c4c', fontSize: '0.82rem', background: '#c94c4c11', padding: '0.6rem', borderRadius: '6px' }}>⚠ {compareError}</p>}
            </>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>Annuler</button>
            {!compareMode ? (
              <>
                <button onClick={generate} disabled={loading} style={btnStyle(loading ? 'var(--muted)' : '#b48edd33', '#b48edd', '1px solid #b48edd66')}>
                  {loading ? '...' : '✨ Générer'}
                </button>
                {result && (
                  <button onClick={() => onApply(sectionId, result)} style={btnStyle('var(--accent)', '#0f0f14')}>
                    ✓ Appliquer
                  </button>
                )}
              </>
            ) : (
              <button onClick={compare} disabled={compareLoading} style={btnStyle(compareLoading ? 'var(--muted)' : '#f0a74222', '#f0a742', '1px solid #f0a74266')}>
                {compareLoading ? '...' : '⚖ Lancer la comparaison'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Génération d'image (Replicate FLUX) ───────────────────────────────────────

function ImageGenButton({ type, data, currentUrl, onSaved, label, provider = 'replicate', storagePath }: {
  type: 'cover' | 'section' | 'npc'
  data: Record<string, string>
  currentUrl?: string
  onSaved: (url: string) => void
  label?: string
  provider?: 'replicate' | 'leonardo'
  storagePath?: string  // ex: "books/123/cover", "books/123/sections/456"
}) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function saveImage(externalUrl: string): Promise<string> {
    if (!storagePath) return externalUrl
    setStatus('Sauvegarde…')
    try {
      const res = await fetch('/api/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: externalUrl, path: storagePath }),
      })
      const d = await res.json()
      return d.url ?? externalUrl
    } catch {
      return externalUrl
    }
  }

  async function generate() {
    setLoading(true); setError(''); setStatus('Génération…')
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data, provider }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)

      // Résultat immédiat (Replicate mode synchrone)
      if (d.image_url) {
        const url = await saveImage(d.image_url)
        onSaved(url)
        setLoading(false); setStatus('')
        return
      }

      // Polling (Leonardo toujours async, Replicate si > 55s)
      const { prediction_id, provider: resProvider } = d
      if (!prediction_id) throw new Error('Aucun identifiant de prédiction reçu')

      const start = Date.now()
      while (Date.now() - start < 300_000) {
        await new Promise(r => setTimeout(r, 3000))
        setStatus(`${Math.round((Date.now() - start) / 1000)}s…`)
        const poll = await fetch(`/api/generate-image?id=${prediction_id}&provider=${resProvider ?? provider}`)
        const pd = await poll.json()
        if (pd.status === 'succeeded') {
          const url = await saveImage(pd.image_url)
          onSaved(url)
          setLoading(false); setStatus('')
          return
        }
        if (pd.status === 'failed' || pd.status === 'canceled') {
          throw new Error(pd.error ?? pd.status)
        }
      }
      throw new Error('Délai dépassé (5 min)')
    } catch (err: any) {
      setError(err.message)
      setLoading(false); setStatus('')
    }
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.2rem' }}>
      <button onClick={generate} disabled={loading} style={{
        background: 'none', border: '1px solid #b48edd44', borderRadius: '4px',
        color: loading ? 'var(--muted)' : '#b48edd', cursor: loading ? 'not-allowed' : 'pointer',
        padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap',
      }}>
        {loading ? `⏳ ${status}` : `🎨 ${label ?? (currentUrl ? 'Régénérer' : 'Illustrer')}`}
      </button>
      {error && <span style={{ fontSize: '0.65rem', color: '#c94c4c' }}>{error}</span>}
    </div>
  )
}

// ── Section image prompts button ───────────────────────────────────────────────

function SectionImagePromptsButton({ sectionId, onPrompts }: {
  sectionId: string
  onPrompts: (prompts: string[], promptsFr: string[]) => void
}) {
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    try {
      const res = await fetch(`/api/sections/${sectionId}/image-prompts`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      onPrompts(d.prompts, d.prompts_fr ?? [])
    } catch (err: any) {
      alert('Erreur : ' + err.message)
    }
    setLoading(false)
  }

  return (
    <button onClick={generate} disabled={loading} style={{
      background: 'none', border: '1px solid #b48edd55', borderRadius: '4px',
      color: loading ? 'var(--muted)' : '#b48edd', cursor: loading ? 'not-allowed' : 'pointer',
      padding: '0.2rem 0.5rem', fontSize: '0.68rem', whiteSpace: 'nowrap',
    }}>
      {loading ? '⏳ Découpage…' : '🎬 Découper en 4 plans'}
    </button>
  )
}

// ── Cover Modal ────────────────────────────────────────────────────────────────

const ILLUSTRATION_STYLE_OPTIONS = [
  { value: 'realistic',    label: '🖼️ Réaliste' },
  { value: 'manga',        label: '⛩️ Manga' },
  { value: 'bnw',          label: '⬛ Noir & Blanc' },
  { value: 'watercolor',   label: '🎨 Aquarelle' },
  { value: 'comic',        label: '💬 BD franco-belge' },
  { value: 'dark_fantasy', label: '🩸 Dark Fantasy' },
  { value: 'pixel',        label: '👾 Pixel Art' },
]

function CoverModal({ book, description, style, includeProtagonist, provider: initialProvider, onDescriptionChange, onStyleChange, onIncludeProtagonistChange, onSaved, onClose }: {
  book: Book
  description: string
  style: string
  includeProtagonist: boolean
  provider?: 'replicate' | 'leonardo'
  onDescriptionChange: (v: string) => void
  onStyleChange: (v: string) => void
  onIncludeProtagonistChange: (v: boolean) => void
  onSaved: (url: string) => void
  onClose: () => void
}) {
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState('')
  const [error, setError] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [provider, setProvider] = useState<'replicate' | 'leonardo'>(initialProvider ?? 'replicate')

  async function summarize() {
    setSummarizing(true)
    try {
      const res = await fetch(`/api/books/${book.id}/cover-prompt`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      onDescriptionChange(d.prompt)
    } catch (err: any) {
      alert('Erreur : ' + err.message)
    }
    setSummarizing(false)
  }

  async function generate() {
    setGenerating(true); setError(''); setGenStatus('Génération…')
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cover', provider: provider ?? 'replicate', data: {
          title: book.title,
          theme: book.theme,
          style,
          description: description.trim() || book.story_analysis || book.intro_text || book.description || '',
          protagonist: includeProtagonist ? (book.protagonist_description ?? '') : '',
          illustration_bible: book.illustration_bible ?? '',
        }}),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)

      async function saveCover(externalUrl: string) {
        setGenStatus('Sauvegarde…')
        try {
          const up = await fetch('/api/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: externalUrl, path: `books/${book.id}/cover` }) })
          const upd = await up.json()
          onSaved(upd.url ?? externalUrl)
        } catch { onSaved(externalUrl) }
      }

      if (d.image_url) { await saveCover(d.image_url); setGenerating(false); setGenStatus(''); return }

      const { prediction_id, provider: resProvider } = d
      if (!prediction_id) throw new Error(d.error ?? 'Aucun identifiant reçu')

      const start = Date.now()
      while (Date.now() - start < 300_000) {
        await new Promise(r => setTimeout(r, 3000))
        setGenStatus(`${Math.round((Date.now() - start) / 1000)}s…`)
        const poll = await fetch(`/api/generate-image?id=${prediction_id}&provider=${resProvider ?? provider ?? 'replicate'}`)
        const pd = await poll.json()
        if (pd.status === 'succeeded') { await saveCover(pd.image_url); setGenerating(false); setGenStatus(''); return }
        if (pd.status === 'failed' || pd.status === 'canceled') throw new Error(pd.error ?? pd.status)
      }
      throw new Error('Délai dépassé')
    } catch (err: any) {
      setError(err.message); setGenerating(false); setGenStatus('')
    }
  }

  function download() {
    if (!book.cover_image_url) return
    const a = document.createElement('a')
    a.href = book.cover_image_url
    a.download = `${book.title.replace(/\s+/g, '_')}_cover.webp`
    a.target = '_blank'
    a.click()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)', width: '100%', maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Titre */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--accent)' }}>🎨 Couverture — {book.title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>

        {/* Preview */}
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0, width: '240px' }}>
            {book.cover_image_url ? (
              <img src={book.cover_image_url} alt="Couverture"
                style={{ width: '240px', height: '240px', objectFit: 'cover', borderRadius: '10px', border: '2px solid var(--accent)', display: 'block' }} />
            ) : (
              <div style={{ width: '240px', height: '240px', borderRadius: '10px', border: '2px dashed var(--border)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', gap: '0.5rem' }}>
                <span style={{ fontSize: '2.5rem' }}>🎨</span>
                <span style={{ fontSize: '0.75rem' }}>Aucune couverture</span>
              </div>
            )}
            {book.cover_image_url && (
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem' }}>
                <button onClick={download} style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--foreground)', cursor: 'pointer', padding: '0.4rem', fontSize: '0.75rem' }}>
                  ⬇ Télécharger
                </button>
                <a href={book.cover_image_url} target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--foreground)', cursor: 'pointer', padding: '0.4rem', fontSize: '0.75rem', textDecoration: 'none', textAlign: 'center', display: 'block' }}>
                  🔗 Ouvrir
                </a>
              </div>
            )}
            <div style={{ marginTop: '0.5rem', fontSize: '0.62rem', color: 'var(--muted)', lineHeight: 1.4 }}>
              Format 1:1 · 1024×1024 px<br/>
              Compatible iOS App Store &amp; Google Play
            </div>
          </div>

          {/* Contrôles */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Description / prompt
                </label>
                <button onClick={summarize} disabled={summarizing} style={{
                  background: 'none', border: '1px solid #b48edd55', borderRadius: '4px',
                  color: summarizing ? 'var(--muted)' : '#b48edd', cursor: summarizing ? 'not-allowed' : 'pointer',
                  padding: '0.2rem 0.5rem', fontSize: '0.68rem', whiteSpace: 'nowrap',
                }}>
                  {summarizing ? '⏳ Génération…' : '✨ Générer le prompt'}
                </button>
              </div>
              <textarea
                value={description}
                onChange={e => onDescriptionChange(e.target.value)}
                placeholder={`Cliquez sur "Générer le prompt" pour créer automatiquement un prompt depuis le synopsis,\nou saisissez une description libre de la scène de couverture…`}
                rows={5}
                style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.6rem', color: 'var(--foreground)', fontSize: '0.85rem', resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.3rem' }}>
                Style d'illustration
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.35rem' }}>
                {ILLUSTRATION_STYLE_OPTIONS.map(s => (
                  <button key={s.value} type="button" onClick={() => onStyleChange(s.value)} style={{
                    padding: '0.4rem 0.3rem', borderRadius: '6px', cursor: 'pointer', textAlign: 'center',
                    border: `2px solid ${style === s.value ? 'var(--accent)' : 'var(--border)'}`,
                    background: style === s.value ? 'var(--accent)22' : 'var(--surface-2)',
                    color: style === s.value ? 'var(--accent)' : 'var(--muted)',
                    fontSize: '0.68rem', transition: 'all 0.15s',
                  }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {book.protagonist_description && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--foreground)' }}>
                <input
                  type="checkbox"
                  checked={includeProtagonist}
                  onChange={e => onIncludeProtagonistChange(e.target.checked)}
                  style={{ accentColor: 'var(--accent)', width: '14px', height: '14px', cursor: 'pointer' }}
                />
                <span>Inclure le personnage principal</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                  {book.protagonist_description}
                </span>
              </label>
            )}

            {/* Sélecteur provider */}
            <div>
              <label style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.3rem' }}>
                Modèle de génération
              </label>
              <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                {(['replicate', 'leonardo'] as const).map(p => (
                  <button key={p} type="button" onClick={() => setProvider(p)} disabled={generating} style={{
                    flex: 1, padding: '0.4rem 0.75rem', fontSize: '0.78rem', border: 'none', cursor: generating ? 'default' : 'pointer',
                    background: provider === p ? 'var(--accent)' : 'transparent',
                    color: provider === p ? '#0f0f14' : 'var(--muted)',
                    fontWeight: provider === p ? 'bold' : 'normal', transition: 'all 0.15s',
                  }}>
                    {p === 'replicate' ? '⚡ Replicate' : '🎨 Leonardo'}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={generate} disabled={generating} style={{
              background: generating ? 'var(--surface-2)' : 'var(--accent)',
              color: generating ? 'var(--muted)' : '#0f0f14',
              border: 'none', borderRadius: '8px', padding: '0.65rem 1rem',
              fontWeight: 'bold', fontSize: '0.875rem', cursor: generating ? 'not-allowed' : 'pointer',
            }}>
              {generating ? `⏳ ${genStatus}` : book.cover_image_url ? '🎨 Régénérer la couverture' : '🎨 Générer la couverture'}
            </button>
            {error && <p style={{ margin: 0, fontSize: '0.75rem', color: '#c94c4c' }}>⚠ {error}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Intro Viewer ───────────────────────────────────────────────────────────────

const INTRO_DURATIONS: Record<string, number> = { flash: 500, court: 1000, normal: 2500, long: 4000, pause: 6000 }
const FADE_MS = 350

function IntroViewer({ frames, audioUrl, onClose, embedded, noAudio }: {
  frames: import('@/types').IntroFrame[]
  audioUrl?: string
  onClose: () => void
  embedded?: boolean
  noAudio?: boolean
}) {
  const [idx, setIdx] = React.useState(0)
  const [visible, setVisible] = React.useState(true)
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const frame = frames[idx]
  const isLast = idx >= frames.length - 1

  // Start audio
  React.useEffect(() => {
    if (!noAudio && audioRef.current) audioRef.current.play().catch(() => {})
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 } }
  }, [])

  // Auto-advance frames
  React.useEffect(() => {
    if (!frame) return
    const dur = INTRO_DURATIONS[frame.duration] ?? 2500
    const timer = setTimeout(() => {
      if (isLast) { setVisible(false); setTimeout(onClose, FADE_MS); return }
      if (frame.transition === 'fondu' || frame.transition === 'fondu_noir') {
        setVisible(false)
        setTimeout(() => { setIdx(i => i + 1); setVisible(true) }, FADE_MS)
      } else {
        setIdx(i => i + 1)
      }
    }, dur)
    return () => clearTimeout(timer)
  }, [idx])

  function skip() { setVisible(false); setTimeout(onClose, FADE_MS) }

  function goTo(i: number) {
    setVisible(false)
    setTimeout(() => { setIdx(i); setVisible(true) }, FADE_MS)
  }

  const isFondoNoir = frame?.transition === 'fondu_noir'

  return (
    <div style={{ position: embedded ? 'absolute' : 'fixed', inset: 0, zIndex: embedded ? 1 : 2000, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {audioUrl && !noAudio && <audio ref={audioRef} src={audioUrl} loop style={{ display: 'none' }} />}

      {/* Vidéo ou image plein écran */}
      {frame?.video_url
        ? <video key={frame.video_url} src={frame.video_url} autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }} />
        : frame?.image_url
          ? <img src={frame.image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }} />
          : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff33', fontSize: '0.85rem' }}>Pas d'image pour ce plan</div>
      }

      {/* Voile fondu_noir */}
      {isFondoNoir && !visible && (
        <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: 1, transition: `opacity ${FADE_MS}ms ease` }} />
      )}

      {/* Texte narratif */}
      {frame?.narrative_text && visible && (
        <div style={{
          position: 'absolute', bottom: '80px', left: '8%', right: '8%',
          textAlign: 'center', color: '#fff', fontSize: 'clamp(0.9rem, 2.5vw, 1.3rem)',
          fontStyle: 'italic', fontFamily: 'Georgia, serif', letterSpacing: '0.04em',
          textShadow: '0 2px 12px #000, 0 0 40px #000',
          animation: 'fadeInUp 0.6s ease',
        }}>
          {frame.narrative_text}
        </div>
      )}

      {/* Points de progression */}
      <div style={{ position: 'absolute', bottom: '28px', left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}>
        {frames.map((_, i) => (
          <button key={i} onClick={() => goTo(i)} style={{
            width: i === idx ? '22px' : '7px', height: '7px', borderRadius: '4px', border: 'none', cursor: 'pointer',
            background: i === idx ? '#fff' : i < idx ? '#ffffff88' : '#ffffff33',
            transition: 'all 0.3s', padding: 0,
          }} />
        ))}
      </div>

      {/* Compteur + Passer */}
      <div style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: '0.72rem', color: '#ffffff55' }}>{idx + 1} / {frames.length}</span>
        <button onClick={skip} style={{ background: '#ffffff18', border: '1px solid #ffffff33', borderRadius: '6px', color: '#ffffffcc', padding: '0.35rem 0.85rem', cursor: 'pointer', fontSize: '0.78rem', backdropFilter: 'blur(4px)' }}>
          ⏩ Passer
        </button>
      </div>

      {/* Label cadrage */}
      {frame && (
        <div style={{ position: 'absolute', top: '16px', left: '16px', fontSize: '0.68rem', color: '#ffffff44', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {{ plan_large: 'Plan large', plan_moyen: 'Plan moyen', gros_plan: 'Gros plan', detail: 'Détail' }[frame.framing]}
        </div>
      )}

      <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}

// ── Freesound Modal ────────────────────────────────────────────────────────────

function FreesoundModal({ sectionType, onSelect, onClose }: {
  sectionType: string
  onSelect: (previewUrl: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function search(q?: string) {
    setLoading(true); setError(''); setResults([])
    const params = new URLSearchParams()
    if (q ?? query) params.set('query', q ?? query)
    else params.set('type', sectionType)
    try {
      const res = await fetch(`/api/freesound?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResults(data.results ?? [])
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  // Lancer une recherche automatique à l'ouverture
  useEffect(() => { search() }, [])

  function togglePlay(track: any) {
    const url = track.previews['preview-lq-mp3']
    if (playingId === track.id) {
      audioRef.current?.pause()
      setPlayingId(null)
    } else {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = url; audioRef.current.play() }
      setPlayingId(track.id)
    }
  }

  function formatDuration(s: number) {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0009', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
      onClick={e => { if (e.target === e.currentTarget) { audioRef.current?.pause(); onClose() } }}>
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} />
      <div style={{ background: 'var(--surface)', border: '1px solid #4c9bf044', borderRadius: '12px', width: '100%', maxWidth: '700px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 'bold', color: '#4c9bf0', fontSize: '1rem' }}>🎵 Freesound — {sectionType}</span>
          <button onClick={() => { audioRef.current?.pause(); onClose() }} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>

        {/* Recherche */}
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.5rem' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder={`Rechercher... (ex: "dungeon ambient", "battle epic")`}
            style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.45rem 0.75rem', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' }}
          />
          <button onClick={() => search()} disabled={loading} style={{ background: '#4c9bf0', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.45rem 1rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}>
            {loading ? '…' : 'Chercher'}
          </button>
        </div>

        {/* Résultats */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 1.25rem 1rem' }}>
          {error && <p style={{ color: '#f06060', fontSize: '0.82rem', marginTop: '0.75rem' }}>{error}</p>}
          {loading && <p style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '1rem', textAlign: 'center' }}>Recherche en cours…</p>}
          {!loading && results.length === 0 && !error && (
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '1rem', textAlign: 'center' }}>Aucun résultat.</p>
          )}
          {results.map(track => (
            <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0', borderBottom: '1px solid var(--border)' }}>
              <button
                onClick={() => togglePlay(track)}
                style={{ background: playingId === track.id ? '#4c9bf0' : 'var(--surface-2)', border: '1px solid #4c9bf044', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', color: playingId === track.id ? '#fff' : '#4c9bf0', fontSize: '0.85rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {playingId === track.id ? '⏸' : '▶'}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--foreground)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>par {track.username} · {formatDuration(track.duration)}</div>
              </div>
              <button
                onClick={() => { audioRef.current?.pause(); onSelect(track.previews['preview-lq-mp3']) }}
                style={{ background: 'var(--accent)', color: '#0f0f14', border: 'none', borderRadius: '5px', padding: '0.3rem 0.65rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.72rem', flexShrink: 0 }}
              >
                ✓ Choisir
              </button>
            </div>
          ))}
          {results.length > 0 && (
            <p style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.75rem', textAlign: 'center' }}>
              Sons sous licence Freesound — vérifier la licence de chaque son avant usage commercial.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── SectionModal ──────────────────────────────────────────────────────────────

type EditImage = { url?: string; description: string; description_fr?: string; style: string; includeProtagonist: boolean }

function SectionModal({
  section, choices, book, npcs, sections,
  editContent, editSummary, editHint, editImages, editMusicUrl, imageProvider,
  isSaving, editingTransition, transitionDraft, generatingTransition,
  editingReturn, returnDraft, generatingReturn,
  setEditContent, setEditSummary, setEditHint, setEditImages, setEditMusicUrl, setImageProvider,
  setEditingTransition, setTransitionDraft, setGeneratingTransition,
  setEditingReturn, setReturnDraft, setGeneratingReturn,
  setFreesoundModal, setSections, setChoices,
  onSave, scrollToSection, detectCompanionsInText, consultCompanion, consultingCompanion, bookId, onOpenSection, previousSection, onGoBack, onClose, highlightChoiceId,
}: {
  section: Section
  choices: Choice[]
  book: Book
  npcs: Npc[]
  sections: Section[]
  editContent: string
  editSummary: string
  editHint: string
  editImages: EditImage[]
  editMusicUrl: string
  imageProvider: 'replicate' | 'leonardo'
  isSaving: boolean
  editingTransition: string | null
  transitionDraft: string
  generatingTransition: string | null
  editingReturn: string | null
  returnDraft: string
  generatingReturn: string | null
  setEditContent: (v: string) => void
  setEditSummary: (v: string) => void
  setEditHint: (v: string) => void
  setEditImages: React.Dispatch<React.SetStateAction<EditImage[]>>
  setEditMusicUrl: (v: string) => void
  setImageProvider: (v: 'replicate' | 'leonardo') => void
  setEditingTransition: (v: string | null) => void
  setTransitionDraft: (v: string) => void
  setGeneratingTransition: (v: string | null) => void
  setEditingReturn: (v: string | null) => void
  setReturnDraft: (v: string) => void
  setGeneratingReturn: (v: string | null) => void
  setFreesoundModal: (v: { sectionType: string } | null) => void
  setSections: React.Dispatch<React.SetStateAction<Section[]>>
  setChoices: React.Dispatch<React.SetStateAction<Choice[]>>
  onSave: (sectionId: string) => void
  scrollToSection: (n: number) => void
  detectCompanionsInText: (sectionId: string, content: string) => void
  consultCompanion: (sectionId: string, npcId: string) => void
  consultingCompanion: string | null
  bookId: string
  onOpenSection: (sectionId: string) => void
  previousSection: Section | null
  onGoBack: () => void
  onClose: () => void
  highlightChoiceId?: string
}) {
  const [openSubs, setOpenSubs] = React.useState<Set<number>>(new Set())
  const [companionSelectId, setCompanionSelectId] = React.useState('')
  const [editingChoiceLabel, setEditingChoiceLabel] = React.useState<string | null>(null)
  const [choiceLabelDraft, setChoiceLabelDraft] = React.useState('')
  const [editingChoiceTarget, setEditingChoiceTarget] = React.useState<string | null>(null)
  const [extractingDialogues, setExtractingDialogues] = React.useState(false)
  const [playingDialogue, setPlayingDialogue] = React.useState<number | null>(null)
  const [savingDialogue, setSavingDialogue] = React.useState<number | null>(null)
  const [focusedDialogue, setFocusedDialogue] = React.useState<number | null>(null)
  const dialogueAudioRef = React.useRef<HTMLAudioElement | null>(null)
  const dialogueTextareaRefs = React.useRef<(HTMLTextAreaElement | null)[]>([])

  const EMOTION_TAGS = ['sighs','exhales','whispers','laughs','laughs harder','excited','crying','sarcastic','curious','mischievously','snorts','frustrated sigh','happy gasp']

  function insertTagAtCursor(idx: number, tag: string) {
    const el = dialogueTextareaRefs.current[idx]
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const insertion = `[${tag}] `
    const newVal = el.value.slice(0, start) + insertion + el.value.slice(end)
    // Native input value setter to trigger React's onChange/onBlur correctly
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    nativeInputValueSetter?.call(el, newVal)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
    const newCursor = start + insertion.length
    el.setSelectionRange(newCursor, newCursor)
  }

  function buildTtsBody(npc: Npc, text: string) {
    // Tags embedded in text (e.g. "[aggressive] Sors d'ici") are passed as-is
    // NPC-level voice_prompt is prepended only if no tag already in text
    const hasInlineTag = /\[.+?\]/.test(text)
    const finalText = (!hasInlineTag && npc.voice_prompt) ? `[${npc.voice_prompt}] ${text}` : text
    return {
      voice_id: npc.voice_id!,
      text: finalText,
      voice_settings: npc.voice_settings,
    }
  }

  async function playDialogueTts(npc: Npc, text: string, idx: number) {
    if (dialogueAudioRef.current) { dialogueAudioRef.current.pause(); dialogueAudioRef.current = null }
    setPlayingDialogue(idx)
    try {
      const body = buildTtsBody(npc, text)
      console.log('[TTS] body:', JSON.stringify(body))
      const res = await fetch('/api/elevenlabs/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      console.log('[TTS] response status:', res.status, res.headers.get('content-type'))
      if (!res.ok) {
        const err = await res.json()
        console.error('[TTS] API error:', err)
        throw new Error(err.error ?? 'TTS error')
      }
      const blob = await res.blob()
      console.log('[TTS] blob size:', blob.size, blob.type)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      dialogueAudioRef.current = audio
      audio.onerror = (e) => console.error('[TTS] audio error:', e)
      audio.onended = () => { setPlayingDialogue(null); URL.revokeObjectURL(url) }
      const playPromise = audio.play()
      if (playPromise) playPromise.catch(e => console.error('[TTS] play() rejected:', e))
    } catch (e) {
      console.error('[TTS] exception:', e)
      setPlayingDialogue(null)
    }
  }

  async function saveDialogueTts(npc: Npc, text: string, idx: number, dialogues: import('@/types').SectionDialogue[]) {
    setSavingDialogue(idx)
    try {
      const savePath = `books/${bookId}/dialogues/${section.id}_${idx}`
      const res = await fetch('/api/elevenlabs/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...buildTtsBody(npc, text), save_path: savePath }) })
      if (!res.ok) throw new Error('TTS save error')
      const { url } = await res.json()
      const updated = dialogues.map((x, j) => j === idx ? { ...x, audio_url: url } : x)
      setSections(ss => ss.map(s => s.id === section.id ? { ...s, dialogues: updated } : s))
      await fetch(`/api/sections/${section.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dialogues: updated }) })
    } catch {
    } finally {
      setSavingDialogue(null)
    }
  }
  const toggleSub = (i: number) => setOpenSubs(prev => {
    const next = new Set(prev)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  })

  const t = getSectionType(section)
  const sectionType = t.label

  const SubHeader = ({ n, title }: { n: number; title: string }) => (
    <button
      onClick={() => toggleSub(n)}
      style={{
        width: '100%', textAlign: 'left', background: openSubs.has(n) ? 'var(--surface-2)' : 'transparent',
        border: 'none', borderRadius: '6px', padding: '0.55rem 0.75rem',
        cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        color: 'var(--foreground)', fontSize: '0.82rem', fontWeight: 'bold',
      }}
    >
      {title}
      <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{openSubs.has(n) ? '▲' : '▼'}</span>
    </button>
  )

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: '#00000088', zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '0.75rem', overflowY: 'auto',
      }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '12px', width: '100%', maxWidth: '760px',
        margin: '0 1rem 3rem', padding: '1.25rem',
        boxShadow: '0 8px 40px #00000066',
      }}>
        {/* Header */}
        {previousSection && (
          <button onClick={onGoBack} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            ← §{previousSection.number} — {previousSection.summary?.slice(0, 50) ?? `Section ${previousSection.number}`}
          </button>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1 }}>
            <span style={{ background: t.color + '33', color: t.color, borderRadius: '50%', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', flexShrink: 0 }}>{t.icon}</span>
            <span style={{ fontWeight: 'bold', color: 'var(--accent)', fontSize: '1.05rem', flexShrink: 0 }}>§{section.number}</span>
            <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.55rem', borderRadius: '4px', background: t.color + '22', color: t.color, fontWeight: 'bold', flexShrink: 0 }}>{t.label}</span>
            {section.summary && (
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {section.summary}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--muted)', cursor: 'pointer', padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>✕ Fermer</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

          {/* ── Sous-section 1 : Résumé et contenu ─────────────────────────────── */}
          <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            <SubHeader n={0} title="📝 Résumé et contenu" />
            {openSubs.has(0) && (
              <div style={{ padding: '0.85rem', borderTop: '1px solid var(--border)' }}>
                {/* Temps de lecture / décision */}
                {(section.reading_time != null || section.decision_time != null) && (
                  <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {section.reading_time != null && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.68rem', color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: '4px', padding: '0.1rem 0.45rem' }}>
                        📖
                        <input type="number" min={3} max={300} defaultValue={section.reading_time}
                          onBlur={async e => {
                            const v = parseInt(e.target.value)
                            if (!v || v === section.reading_time) return
                            await fetch(`/api/sections/${section.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reading_time: v }) })
                            setSections(ss => ss.map(s => s.id === section.id ? { ...s, reading_time: v } : s))
                          }}
                          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          style={{ width: '38px', background: 'transparent', border: 'none', outline: 'none', color: 'var(--muted)', fontSize: '0.68rem', padding: 0, textAlign: 'right' }}
                        /> s lecture
                      </label>
                    )}
                    {section.decision_time != null && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.68rem', color: '#c9a84c', background: '#c9a84c18', borderRadius: '4px', padding: '0.1rem 0.45rem' }}>
                        ⏳
                        <input type="number" min={5} max={300} defaultValue={section.decision_time}
                          onBlur={async e => {
                            const v = parseInt(e.target.value)
                            if (!v || v === section.decision_time) return
                            await fetch(`/api/sections/${section.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision_time: v }) })
                            setSections(ss => ss.map(s => s.id === section.id ? { ...s, decision_time: v } : s))
                          }}
                          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          style={{ width: '38px', background: 'transparent', border: 'none', outline: 'none', color: '#c9a84c', fontSize: '0.68rem', padding: 0, textAlign: 'right' }}
                        /> s décision
                      </label>
                    )}
                  </div>
                )}

                <label style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.3rem' }}>
                  Résumé (max 12 mots)
                </label>
                <input
                  value={editSummary}
                  onChange={e => setEditSummary(e.target.value)}
                  placeholder="Ex: Vous affrontez le garde devant la porte"
                  {...{ 'data-antidoteapi_jsconnect_groupe_id': 'hero_section' } as any}
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.45rem 0.7rem', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', marginBottom: '0.75rem', fontStyle: 'italic' }}
                />
                <label style={{ fontSize: '0.7rem', color: '#f0a742', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.3rem' }}>
                  💡 Aide (hint discret pour le joueur)
                </label>
                <input
                  value={editHint}
                  onChange={e => setEditHint(e.target.value)}
                  placeholder="Ex: Certains objets ramassés plus tôt pourraient s'avérer utiles ici…"
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid #f0a74244', borderRadius: '6px', padding: '0.45rem 0.7rem', color: '#f0a742', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box', marginBottom: '0.75rem', fontStyle: 'italic' }}
                />
                <label style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.3rem' }}>
                  Contenu
                </label>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  {...{ 'data-antidoteapi_jsconnect_groupe_id': 'hero_section' } as any}
                  style={{ width: '100%', minHeight: '220px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem', color: 'var(--foreground)', fontSize: '0.875rem', resize: 'vertical', outline: 'none', fontFamily: 'Georgia, serif', boxSizing: 'border-box' }}
                />
                {/* Antidote bar */}
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', marginBottom: '0.75rem' }}>
                  <div className="boutonCorrecteur" {...{ 'data-antidoteapi_jsconnect_lanceoutil': 'C', 'data-antidoteapi_jsconnect_groupe_id': 'hero_section' } as any} title="Correcteur Antidote" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <img src="/antidote/images/icone-correction-antidote.svg" style={{ height: '22px', width: 'auto' }} />
                  </div>
                  <div className="boutonAntidote" {...{ 'data-antidoteapi_jsconnect_lanceoutil': 'D' } as any} title="Dictionnaires Antidote" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <img src="/antidote/images/icone-antidote-dictionnaires.svg" style={{ height: '22px', width: 'auto' }} />
                  </div>
                  <div className="boutonAntidote" {...{ 'data-antidoteapi_jsconnect_lanceoutil': 'G' } as any} title="Guides Antidote" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <img src="/antidote/images/icone-antidote-guides.svg" style={{ height: '22px', width: 'auto' }} />
                  </div>
                </div>

                {/* Combat / Dialogue card */}
                {section.trial && section.trial.type !== 'dialogue' && (
                  <CombatCard trial={section.trial} npcs={npcs} sections={sections} onNavigate={scrollToSection} />
                )}
                {section.trial?.type === 'dialogue' && (
                  <DialogueCard trial={section.trial} npcs={npcs} sections={sections} book={book} sectionNumber={section.number} onNavigate={scrollToSection} />
                )}

                <button onClick={() => onSave(section.id)} disabled={isSaving} style={{ background: 'var(--accent)', color: '#0f0f14', border: 'none', borderRadius: '4px', padding: '0.4rem 0.9rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}>
                  {isSaving ? 'Sauvegarde...' : '💾 Sauvegarder'}
                </button>
              </div>
            )}
          </div>

          {/* ── Sous-section 2 : Illustrations ──────────────────────────────────── */}
          <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            <SubHeader n={1} title="🎨 Illustrations" />
            {openSubs.has(1) && (
              <div style={{ padding: '0.85rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {/* Provider toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', fontWeight: 'bold' }}>IA :</span>
                    <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                      {(['replicate', 'leonardo'] as const).map(p => (
                        <button key={p} onClick={() => setImageProvider(p)} style={{ padding: '0.15rem 0.5rem', fontSize: '0.65rem', border: 'none', cursor: 'pointer', background: imageProvider === p ? 'var(--accent)' : 'transparent', color: imageProvider === p ? '#0f0f14' : 'var(--muted)', fontWeight: imageProvider === p ? 'bold' : 'normal' }}>
                          {p === 'replicate' ? '⚡ Replicate' : '🎨 Leonardo'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <SectionImagePromptsButton
                    sectionId={section.id}
                    onPrompts={(prompts, promptsFr) => setEditImages(imgs => imgs.map((img, i) => ({ ...img, description: prompts[i] ?? img.description, description_fr: promptsFr[i] || img.description_fr })))}
                  />
                </div>
                {[0, 1, 2, 3].map(i => (
                  <div key={i} style={{ background: 'var(--surface-2)', borderRadius: '8px', padding: '0.75rem', marginBottom: '0.5rem', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginBottom: '0.4rem', fontWeight: 'bold' }}>Image {i + 1}</div>
                    {editImages[i]?.url && (
                      <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
                        <img src={editImages[i].url} style={{ width: '100%', maxHeight: '260px', objectFit: 'contain', borderRadius: '4px', border: '1px solid var(--border)', background: '#000' }} />
                        <button onClick={() => setEditImages(imgs => imgs.map((img, idx) => idx === i ? { ...img, url: undefined } : img))} style={{ position: 'absolute', top: '4px', right: '4px', background: '#c94c4ccc', border: 'none', borderRadius: '3px', color: '#fff', cursor: 'pointer', padding: '0.15rem 0.4rem', fontSize: '0.65rem' }}>✕</button>
                      </div>
                    )}
                    <textarea
                      value={editImages[i]?.description ?? ''}
                      onChange={e => setEditImages(imgs => imgs.map((img, idx) => idx === i ? { ...img, description: e.target.value } : img))}
                      placeholder={`Description de l'image ${i + 1} (utilisée comme prompt)…`}
                      rows={2}
                      style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.4rem 0.5rem', color: 'var(--foreground)', fontSize: '0.8rem', resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.25rem' }}
                    />
                    {editImages[i]?.description_fr && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic', marginBottom: '0.4rem', padding: '0 0.25rem' }}>
                        🇫🇷 {editImages[i].description_fr}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <select value={editImages[i]?.style ?? 'realistic'} onChange={e => setEditImages(imgs => imgs.map((img, idx) => idx === i ? { ...img, style: e.target.value } : img))} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.3rem 0.5rem', color: 'var(--foreground)', fontSize: '0.75rem', outline: 'none', cursor: 'pointer' }}>
                        <option value="realistic">🖼️ Réaliste</option>
                        <option value="manga">⛩️ Manga</option>
                        <option value="bnw">⬛ Noir & Blanc</option>
                        <option value="watercolor">🎨 Aquarelle</option>
                        <option value="comic">💬 BD franco-belge</option>
                        <option value="dark_fantasy">🩸 Dark Fantasy</option>
                        <option value="pixel">👾 Pixel Art</option>
                      </select>
                      {book.protagonist_description && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--muted)' }} title={book.protagonist_description}>
                          <input type="checkbox" checked={editImages[i]?.includeProtagonist ?? false} onChange={e => setEditImages(imgs => imgs.map((img, idx) => idx === i ? { ...img, includeProtagonist: e.target.checked } : img))} style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                          🧑 Personnage
                        </label>
                      )}
                      <ImageGenButton
                        type="section" provider={imageProvider}
                        storagePath={`books/${bookId}/sections/${section.id}_${i}`}
                        data={(() => {
                          const descText = editImages[i]?.description || editSummary || editContent
                          const mentionedNpcAppearances = npcs
                            .filter(n => n.name && descText.toLowerCase().includes(n.name.toLowerCase()) && (n.appearance || n.description))
                            .map(n => [n.appearance || n.description, n.origin].filter(Boolean).join(' '))
                            .join(' | ')
                          return { summary: editImages[i]?.description || editSummary, content: editContent, theme: book.theme, style: editImages[i]?.style ?? book.illustration_style ?? 'realistic', protagonist: editImages[i]?.includeProtagonist ? (book.protagonist_description ?? '') : '', illustration_bible: book.illustration_bible ?? '', npc_appearances: mentionedNpcAppearances }
                        })()}
                        currentUrl={editImages[i]?.url}
                        onSaved={url => {
                          // Bust browser cache by appending a timestamp to the display URL
                          const displayUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now()
                          const newImgs = editImages.map((img, idx) => idx === i ? { ...img, url: displayUrl } : img)
                          setEditImages(() => newImgs)
                          // Save clean URL (without cache-buster) to DB
                          const cleanImages = newImgs
                            .filter(img => img.url || img.description.trim())
                            .map(img => ({ url: img.url?.split('?')[0], description: img.description, style: img.style as any }))
                          fetch(`/api/sections/${section.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: cleanImages }) })
                          setSections(ss => ss.map(s => s.id === section.id ? { ...s, images: cleanImages } : s))
                        }}
                      />
                    </div>
                    {editImages[i]?.description.trim() && !editImages[i]?.url && (
                      <button onClick={() => {
                        const cleanImages = editImages.filter(img => img.url || img.description.trim()).map(img => ({ url: img.url, description: img.description, style: img.style as any }))
                        fetch(`/api/sections/${section.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: cleanImages }) })
                        setSections(ss => ss.map(s => s.id === section.id ? { ...s, images: cleanImages } : s))
                      }} style={{ marginTop: '0.3rem', background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.2rem 0.5rem', fontSize: '0.65rem' }}>
                        💾 Sauvegarder la description
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Sous-section 3 : Musique ─────────────────────────────────────────── */}
          <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            <SubHeader n={2} title="🎵 Musique" />
            {openSubs.has(2) && (
              <div style={{ padding: '0.85rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <input
                    value={editMusicUrl}
                    onChange={e => setEditMusicUrl(e.target.value)}
                    placeholder={`Par défaut : ${DEFAULT_MUSIC[sectionType] ?? '(aucune)'}`}
                    style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem 0.7rem', color: 'var(--foreground)', fontSize: '0.8rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                  <button onClick={() => setFreesoundModal({ sectionType })} title="Rechercher sur Freesound" style={{ background: 'none', border: '1px solid #4c9bf044', borderRadius: '4px', color: '#4c9bf0', cursor: 'pointer', padding: '0.3rem 0.5rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                    🔍 Freesound
                  </button>
                  {editMusicUrl && (
                    <button onClick={() => setEditMusicUrl('')} title="Supprimer la musique" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}>✕</button>
                  )}
                </div>
                {/* Lecteur de prévisualisation */}
                {(editMusicUrl || DEFAULT_MUSIC[sectionType]) && (
                  <audio
                    key={editMusicUrl || DEFAULT_MUSIC[sectionType]}
                    controls
                    src={editMusicUrl || DEFAULT_MUSIC[sectionType]}
                    style={{ width: '100%', height: '32px', marginBottom: '0.5rem', accentColor: 'var(--accent)' }}
                  />
                )}
                {!editMusicUrl && section.music_url && (
                  <p style={{ fontSize: '0.7rem', color: '#f0a742', margin: '0 0 0.4rem', fontStyle: 'italic' }}>⚠ Musique personnalisée en base — le champ est vide, sauvegarder supprimera cette musique.</p>
                )}
                <button onClick={() => onSave(section.id)} disabled={isSaving} style={{ background: 'var(--accent)', color: '#0f0f14', border: 'none', borderRadius: '4px', padding: '0.4rem 0.9rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}>
                  {isSaving ? 'Sauvegarde...' : '💾 Sauvegarder'}
                </button>
              </div>
            )}
          </div>

          {/* ── Sous-section 4 : Compagnons et Choix ────────────────────────────── */}
          <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            <SubHeader n={3} title="👥 Compagnons et Choix" />
            {openSubs.has(3) && (
              <div style={{ padding: '0.85rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Companions */}
                {npcs.length > 0 && (() => {
                  const presentIds = section.companion_npc_ids ?? []
                  const presentNpcs = presentIds.map(id => npcs.find(n => n.id === id)).filter(Boolean) as Npc[]
                  const availableNpcs = npcs.filter(n => !presentIds.includes(n.id))

                  const updateCompanions = async (newIds: string[]) => {
                    setSections(ss => ss.map(s => s.id === section.id ? { ...s, companion_npc_ids: newIds } : s))
                    await fetch(`/api/sections/${section.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companion_npc_ids: newIds }) })
                  }

                  return (
                    <div style={{ padding: '0.6rem 0.75rem', background: '#4caf7d0a', border: '1px solid #4caf7d33', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                        <div style={{ fontSize: '0.68rem', color: '#4caf7d', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>👥 Personnages présents</div>
                        <button onClick={() => detectCompanionsInText(section.id, section.content ?? '')} style={{ fontSize: '0.65rem', background: 'none', border: '1px solid #4caf7d44', borderRadius: '4px', color: '#4caf7d', cursor: 'pointer', padding: '0.15rem 0.5rem' }} title="Détecter depuis le texte">🔍 Auto-détecter</button>
                      </div>

                      {/* Tags des compagnons présents */}
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', minHeight: '28px', marginBottom: '0.65rem' }}>
                        {presentNpcs.length === 0
                          ? <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucun personnage présent</span>
                          : presentNpcs.map(npc => {
                            const key = `${section.id}:${npc.id}`
                            const isConsulting = consultingCompanion === key
                            return (
                              <span key={npc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '20px', background: NPC_TYPE_CONFIG[npc.type].color + '22', border: `1px solid ${NPC_TYPE_CONFIG[npc.type].color}55`, color: NPC_TYPE_CONFIG[npc.type].color }}>
                                {NPC_TYPE_CONFIG[npc.type].icon} {npc.name}
                                <button
                                  onClick={() => consultCompanion(section.id, npc.id)}
                                  disabled={!!consultingCompanion}
                                  title={`Générer une section de conseil avec ${npc.name}`}
                                  style={{ background: 'none', border: 'none', cursor: consultingCompanion ? 'default' : 'pointer', color: 'inherit', opacity: consultingCompanion ? 0.4 : 0.9, padding: 0, fontSize: '0.75rem', lineHeight: 1 }}
                                >
                                  {isConsulting ? '⏳' : '💬'}
                                </button>
                                <button onClick={() => updateCompanions(presentIds.filter(id => id !== npc.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, padding: 0, fontSize: '0.7rem', lineHeight: 1 }} title="Retirer">×</button>
                              </span>
                            )
                          })
                        }
                      </div>

                      {/* Ligne d'ajout */}
                      {availableNpcs.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <select
                            value={companionSelectId}
                            onChange={e => setCompanionSelectId(e.target.value)}
                            style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.3rem 0.5rem', color: 'var(--foreground)', fontSize: '0.78rem', outline: 'none', cursor: 'pointer' }}
                          >
                            <option value="">— Sélectionner un personnage —</option>
                            {(['allié', 'neutre', 'marchand', 'ennemi', 'boss'] as NpcType[]).map(type => {
                              const group = availableNpcs.filter(n => n.type === type)
                              if (!group.length) return null
                              return (
                                <optgroup key={type} label={`${NPC_TYPE_CONFIG[type].icon} ${type}`}>
                                  {group.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                                </optgroup>
                              )
                            })}
                          </select>
                          <button
                            onClick={() => {
                              if (!companionSelectId) return
                              updateCompanions([...presentIds, companionSelectId])
                              setCompanionSelectId('')
                            }}
                            disabled={!companionSelectId}
                            style={{ background: '#4caf7d', color: '#0f0f14', border: 'none', borderRadius: '4px', padding: '0.3rem 0.7rem', cursor: companionSelectId ? 'pointer' : 'default', fontSize: '0.78rem', fontWeight: 'bold', opacity: companionSelectId ? 1 : 0.4, whiteSpace: 'nowrap' }}
                          >
                            + Ajouter
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Routage trial (succès / échec) */}
                {section.trial && (section.trial.success_section_id || section.trial.failure_section_id) && (() => {
                  const successSec = sections.find(s => s.id === section.trial!.success_section_id)
                  const failureSec = sections.find(s => s.id === section.trial!.failure_section_id)
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Routage épreuve</div>
                      {successSec && (
                        <div style={{ border: '1px solid #4caf7d44', borderRadius: '6px', overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', background: '#4caf7d08' }}>
                            <button onClick={() => onOpenSection(successSec.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--foreground)', padding: 0 }}>
                              <span style={{ color: '#4caf7d', marginRight: '0.5rem' }}>✓</span>
                              Victoire
                              <span style={{ color: '#4caf7d', fontSize: '0.7rem', marginLeft: '0.5rem' }}>[§{successSec.number}]</span>
                            </button>
                          </div>
                        </div>
                      )}
                      {failureSec && (
                        <div style={{ border: '1px solid #c94c4c44', borderRadius: '6px', overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', background: '#c94c4c08' }}>
                            <button onClick={() => onOpenSection(failureSec.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--foreground)', padding: 0 }}>
                              <span style={{ color: '#c94c4c', marginRight: '0.5rem' }}>✗</span>
                              Défaite
                              <span style={{ color: '#c94c4c', fontSize: '0.7rem', marginLeft: '0.5rem' }}>[§{failureSec.number}]</span>
                            </button>
                          </div>
                        </div>
                      )}
                      {!successSec && section.trial.success_section_id && <span style={{ fontSize: '0.7rem', color: '#c9a84c' }}>⚠ Section victoire introuvable</span>}
                      {!failureSec && section.trial.failure_section_id && <span style={{ fontSize: '0.7rem', color: '#c9a84c' }}>⚠ Section défaite introuvable</span>}
                    </div>
                  )
                })()}

                {/* Choices */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {choices.map(choice => {
                    const targetNum = sections.find(s => s.id === choice.target_section_id)?.number
                    const targetSection = sections.find(s => s.id === choice.target_section_id)
                    const isEditingTransition_ = editingTransition === choice.id
                    const isGenerating = generatingTransition === choice.id
                    const isEditingReturn_ = editingReturn === choice.id
                    const isGeneratingReturn_ = generatingReturn === choice.id
                    const arrow = choice.is_back ? '↩' : '→'
                    const arrowColor = choice.is_back ? '#6b8cde' : 'var(--accent)'
                    const isPathChoice = highlightChoiceId === choice.id
                    return (
                      <div key={choice.id} style={{ border: isPathChoice ? '2px solid #4caf7d' : `1px solid ${choice.is_back ? '#6b8cde44' : 'var(--border)'}`, borderRadius: '6px', overflow: 'hidden', boxShadow: isPathChoice ? '0 0 8px #4caf7d44' : 'none' }}>
                        {isPathChoice && (
                          <div style={{ background: '#4caf7d22', padding: '0.2rem 0.75rem', fontSize: '0.65rem', color: '#4caf7d', fontWeight: 'bold', letterSpacing: '0.05em' }}>
                            ▶ PARCOURS EN COURS — corriger la transition
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', background: choice.is_back ? '#6b8cde0a' : 'var(--surface-2)' }}>
                          <span style={{ color: arrowColor, flexShrink: 0 }}>{arrow}</span>
                          {editingChoiceLabel === choice.id ? (
                            <input
                              autoFocus
                              value={choiceLabelDraft}
                              onChange={e => setChoiceLabelDraft(e.target.value)}
                              onBlur={async () => {
                                const trimmed = choiceLabelDraft.trim()
                                if (trimmed && trimmed !== choice.label) {
                                  await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: trimmed }) })
                                  setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, label: trimmed } : c))
                                }
                                setEditingChoiceLabel(null)
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingChoiceLabel(null) }}
                              style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: '4px', padding: '0.2rem 0.5rem', color: 'var(--foreground)', fontSize: '0.82rem', outline: 'none' }}
                            />
                          ) : (
                            <button
                              onClick={() => { if (choice.target_section_id) onOpenSection(choice.target_section_id) }}
                              onDoubleClick={() => { setEditingChoiceLabel(choice.id); setChoiceLabelDraft(choice.label) }}
                              title={targetNum ? `Ouvrir §${targetNum}` : 'Section cible non définie'}
                              style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: choice.target_section_id ? 'pointer' : 'default', fontSize: '0.82rem', color: 'var(--foreground)', padding: 0 }}>
                              {choice.label}
                              {targetNum && <span style={{ color: 'var(--accent)', fontSize: '0.7rem', marginLeft: '0.5rem' }}>[§{targetNum}]</span>}
                            </button>
                          )}
                          <button onClick={() => { setEditingChoiceLabel(choice.id); setChoiceLabelDraft(choice.label) }} title="Modifier le texte" style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>✎</button>
                          <button
                            onClick={() => setEditingChoiceTarget(editingChoiceTarget === choice.id ? null : choice.id)}
                            title={choice.target_section_id ? `Changer la section cible (§${targetNum})` : 'Définir la section cible'}
                            style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem', borderRadius: '4px', border: `1px solid ${choice.target_section_id ? 'var(--border)' : '#f0a74255'}`, background: 'transparent', color: choice.target_section_id ? 'var(--muted)' : '#f0a742', cursor: 'pointer', flexShrink: 0 }}
                          >§</button>
                          <button onClick={() => { if (isEditingTransition_) { setEditingTransition(null) } else { setEditingTransition(choice.id); setTransitionDraft(choice.transition_text ?? '') } }} style={{ fontSize: '0.65rem', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: choice.transition_text ? '#b48edd' : 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {choice.transition_text ? '✨ Transition' : '+ Transition'}
                          </button>
                          <button onClick={async () => {
                            if (!confirm('Supprimer ce choix ?')) return
                            await fetch(`/api/choices/${choice.id}`, { method: 'DELETE' })
                            setChoices(cs => cs.filter(c => c.id !== choice.id))
                          }} style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid #c94c4c44', background: 'transparent', color: '#c94c4c', cursor: 'pointer' }}>✕</button>
                        </div>
                        {editingChoiceTarget === choice.id && (
                          <div style={{ padding: '0.5rem 0.75rem', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>Section cible :</span>
                            <select
                              defaultValue={choice.target_section_id ?? ''}
                              onChange={async e => {
                                const val = e.target.value || null
                                await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_section_id: val }) })
                                setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, target_section_id: val ?? undefined } : c))
                                setEditingChoiceTarget(null)
                              }}
                              style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.3rem 0.5rem', color: 'var(--foreground)', fontSize: '0.78rem', outline: 'none', cursor: 'pointer' }}
                            >
                              <option value="">— Aucune cible —</option>
                              {sections.filter(s => s.id !== section.id).sort((a, b) => a.number - b.number).map(s => (
                                <option key={s.id} value={s.id}>§{s.number} — {s.summary?.slice(0, 60) ?? `Section ${s.number}`}</option>
                              ))}
                            </select>
                            <button onClick={() => setEditingChoiceTarget(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>✕</button>
                          </div>
                        )}
                        {isEditingTransition_ && (
                          <div style={{ padding: '0.6rem 0.75rem', background: '#b48edd08', borderTop: '1px solid #b48edd33' }}>
                            <div style={{ fontSize: '0.65rem', color: '#b48edd', marginBottom: '0.3rem', fontWeight: 'bold' }}>✨ Texte de transition — §{section.number} → §{targetNum ?? '?'}</div>
                            <textarea value={transitionDraft} onChange={e => setTransitionDraft(e.target.value)} placeholder="Texte affiché au joueur quand il revient à cette section (30-60 mots)…" rows={3} style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid #b48edd55', borderRadius: '4px', padding: '0.4rem 0.6rem', color: 'var(--foreground)', fontSize: '0.8rem', resize: 'vertical', outline: 'none', fontFamily: 'Georgia, serif', boxSizing: 'border-box', lineHeight: 1.5 }} />
                            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                              <button onClick={async () => {
                                if (!targetSection) return
                                setGeneratingTransition(choice.id)
                                try {
                                  const res = await fetch(`/api/books/${bookId}/generate-transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choiceId: choice.id, sourceContent: section.content, choiceLabel: choice.label, targetContent: targetSection.content }) })
                                  const data = await res.json()
                                  if (data.transition) { setTransitionDraft(data.transition); setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_text: data.transition } : c)); setEditingTransition(null) }
                                } finally { setGeneratingTransition(null) }
                              }} disabled={isGenerating || !targetSection} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '4px', border: 'none', background: '#b48edd', color: '#0f0f14', cursor: isGenerating || !targetSection ? 'default' : 'pointer', fontWeight: 'bold', opacity: isGenerating ? 0.6 : 1 }}>
                                {isGenerating ? '…' : '✨ Générer'}
                              </button>
                              <button onClick={async () => {
                                await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_text: transitionDraft || null }) })
                                setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_text: transitionDraft || undefined } : c))
                                setEditingTransition(null)
                              }} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '4px', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>
                                Sauvegarder
                              </button>
                              {choice.transition_text && (
                                <button onClick={async () => {
                                  await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_text: null }) })
                                  setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_text: undefined } : c))
                                  setEditingTransition(null)
                                }} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '4px', border: '1px solid #c94c4c55', background: 'transparent', color: '#c94c4c', cursor: 'pointer' }}>Supprimer</button>
                              )}
                            </div>
                            {/* Sélecteur d'image */}
                            {section.images && section.images.some(img => img.url) && (
                              <div style={{ marginTop: '0.5rem' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>Image affichée avec le texte de retour :</div>
                                <div style={{ display: 'flex', gap: '0.35rem' }}>
                                  {[0, 1, 2, 3].map(idx => {
                                    const imgUrl = section.images?.[idx]?.url
                                    const selected = (choice.transition_image_index ?? 3) === idx
                                    return (
                                      <button key={idx} onClick={async () => {
                                        await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_image_index: idx }) })
                                        setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_image_index: idx } : c))
                                      }} title={`Image ${idx + 1}`} style={{ padding: 0, border: selected ? '2px solid #b48edd' : '2px solid transparent', borderRadius: '4px', background: 'none', cursor: 'pointer', flexShrink: 0 }}>
                                        {imgUrl
                                          ? <img src={imgUrl} alt={`Image ${idx + 1}`} style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '3px', display: 'block' }} />
                                          : <div style={{ width: '48px', height: '48px', background: 'var(--surface-2)', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: 'var(--muted)' }}>{idx + 1}</div>
                                        }
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                            <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                              {choice.transition_image_url && (
                                <img src={choice.transition_image_url} alt="" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #b48edd55', flexShrink: 0 }} />
                              )}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <ImageGenButton
                                  type="section"
                                  provider={imageProvider}
                                  storagePath={`books/${bookId}/transitions/${choice.id}`}
                                  data={{ summary: transitionDraft || choice.transition_text || choice.label, content: transitionDraft || choice.transition_text || '', theme: book.theme, style: book.illustration_style ?? 'realistic', protagonist: book.protagonist_description ?? '', illustration_bible: book.illustration_bible ?? '' }}
                                  currentUrl={choice.transition_image_url}
                                  label="🖼 Illustrer"
                                  onSaved={async (url) => {
                                    const cleanUrl = url.split('?')[0]
                                    await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_image_url: cleanUrl }) })
                                    setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_image_url: cleanUrl } : c))
                                  }}
                                />
                                {choice.transition_image_url && (
                                  <button onClick={async () => {
                                    await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition_image_url: null }) })
                                    setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, transition_image_url: undefined } : c))
                                  }} style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem', borderRadius: '4px', border: '1px solid #c94c4c55', background: 'transparent', color: '#c94c4c', cursor: 'pointer' }}>✕ Image</button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                        {!isEditingTransition_ && choice.transition_text && (
                          <div style={{ padding: '0.35rem 0.75rem', background: '#b48edd08', borderTop: '1px solid #b48edd22', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                            {(() => {
                              const imgUrl = choice.transition_image_url || section.images?.[(choice.transition_image_index ?? 3)]?.url
                              return imgUrl ? <img src={imgUrl} alt="" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0, opacity: choice.transition_image_url ? 1 : 0.7 }} /> : null
                            })()}
                            <p style={{ fontSize: '0.75rem', color: '#b48edd', fontStyle: 'italic', margin: 0, lineHeight: 1.5 }}>{choice.transition_text}</p>
                          </div>
                        )}

                        {/* ── Texte de retour ── */}
                        <div style={{ borderTop: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.75rem', background: '#4ec9b008' }}>
                            <span style={{ fontSize: '0.62rem', color: '#4ec9b0', fontWeight: 'bold', flex: 1 }}>↩ Texte de retour</span>
                            <button onClick={() => { if (isEditingReturn_) { setEditingReturn(null) } else { setEditingReturn(choice.id); setReturnDraft(choice.return_text ?? '') } }} style={{ fontSize: '0.62rem', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: choice.return_text ? '#4ec9b0' : 'var(--foreground)', cursor: 'pointer' }}>
                              {choice.return_text ? '✏ Modifier' : '+ Ajouter'}
                            </button>
                          </div>
                          {isEditingReturn_ && (
                            <div style={{ padding: '0.5rem 0.75rem', background: '#4ec9b008', borderTop: '1px solid #4ec9b022' }}>
                              <textarea value={returnDraft} onChange={e => setReturnDraft(e.target.value)} placeholder="Texte mémoriel affiché quand le joueur revient ici (30-60 mots)…" rows={3} style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid #4ec9b044', borderRadius: '4px', padding: '0.4rem 0.6rem', color: 'var(--foreground)', fontSize: '0.8rem', resize: 'vertical', outline: 'none', fontFamily: 'Georgia, serif', boxSizing: 'border-box', lineHeight: 1.5 }} />
                              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                                <button onClick={async () => {
                                  if (!targetSection) return
                                  setGeneratingReturn(choice.id)
                                  try {
                                    const res = await fetch(`/api/books/${bookId}/generate-transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choiceId: choice.id, sourceContent: section.content, choiceLabel: choice.label, targetContent: targetSection.content, mode: 'return' }) })
                                    const data = await res.json()
                                    if (data.return_text) { setReturnDraft(data.return_text); setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, return_text: data.return_text } : c)); setEditingReturn(null) }
                                  } finally { setGeneratingReturn(null) }
                                }} disabled={isGeneratingReturn_ || !targetSection} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '4px', border: 'none', background: '#4ec9b0', color: '#0f0f14', cursor: isGeneratingReturn_ || !targetSection ? 'default' : 'pointer', fontWeight: 'bold', opacity: isGeneratingReturn_ ? 0.6 : 1 }}>
                                  {isGeneratingReturn_ ? '…' : '✨ Générer'}
                                </button>
                                <button onClick={async () => {
                                  await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ return_text: returnDraft || null }) })
                                  setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, return_text: returnDraft || undefined } : c))
                                  setEditingReturn(null)
                                }} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '4px', border: '1px solid #4ec9b0', background: 'transparent', color: '#4ec9b0', cursor: 'pointer' }}>
                                  Sauvegarder
                                </button>
                                {choice.return_text && (
                                  <button onClick={async () => {
                                    await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ return_text: null }) })
                                    setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, return_text: undefined } : c))
                                    setEditingReturn(null)
                                  }} style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '4px', border: '1px solid #c94c4c55', background: 'transparent', color: '#c94c4c', cursor: 'pointer' }}>Supprimer</button>
                                )}
                              </div>
                              {/* Sélecteur d'image */}
                              {section.images && section.images.some(img => img.url) && (
                                <div style={{ marginTop: '0.5rem' }}>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>Image affichée avec le texte de retour :</div>
                                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                                    {[0, 1, 2, 3].map(idx => {
                                      const imgUrl = section.images?.[idx]?.url
                                      const selected = (choice.return_image_index ?? 3) === idx
                                      return (
                                        <button key={idx} onClick={async () => {
                                          await fetch(`/api/choices/${choice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ return_image_index: idx }) })
                                          setChoices(cs => cs.map(c => c.id === choice.id ? { ...c, return_image_index: idx } : c))
                                        }} title={`Image ${idx + 1}`} style={{ padding: 0, border: selected ? '2px solid #4ec9b0' : '2px solid transparent', borderRadius: '4px', background: 'none', cursor: 'pointer', flexShrink: 0 }}>
                                          {imgUrl
                                            ? <img src={imgUrl} alt={`Image ${idx + 1}`} style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '3px', display: 'block' }} />
                                            : <div style={{ width: '48px', height: '48px', background: 'var(--surface-2)', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: 'var(--muted)' }}>{idx + 1}</div>
                                          }
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {!isEditingReturn_ && choice.return_text && (
                            <div style={{ padding: '0.35rem 0.75rem', background: '#4ec9b008', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                              {(() => {
                                const imgUrl = section.images?.[(choice.return_image_index ?? 3)]?.url
                                return imgUrl ? <img src={imgUrl} alt="" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0, opacity: 0.8 }} /> : null
                              })()}
                              <p style={{ margin: 0, fontSize: '0.75rem', color: '#4ec9b0', fontStyle: 'italic', lineHeight: 1.5 }}>{choice.return_text}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Sous-section 5 : Dialogues ──────────────────────────────────────── */}
          <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            <SubHeader n={4} title="🗨 Dialogues" />
            {openSubs.has(4) && (
              <div style={{ padding: '0.85rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Répliques extraites du contenu et des transitions — utilisées comme bulles dans le jeu.
                  </p>
                  <button
                    onClick={async () => {
                      setExtractingDialogues(true)
                      try {
                        const res = await fetch(`/api/sections/${section.id}/extract-dialogues`, { method: 'POST' })
                        const data = await res.json()
                        if (data.dialogues) {
                          setSections(ss => ss.map(s => s.id === section.id ? { ...s, dialogues: data.dialogues } : s))
                        }
                      } finally {
                        setExtractingDialogues(false)
                      }
                    }}
                    disabled={extractingDialogues}
                    style={{ background: 'none', border: '1px solid #64b5f644', borderRadius: '4px', color: '#64b5f6', cursor: extractingDialogues ? 'default' : 'pointer', padding: '0.25rem 0.65rem', fontSize: '0.72rem', whiteSpace: 'nowrap', opacity: extractingDialogues ? 0.6 : 1, flexShrink: 0 }}
                  >
                    {extractingDialogues ? '⏳ Extraction…' : '🔍 Extraire'}
                  </button>
                </div>
                {(() => {
                  const dialogues = section.dialogues ?? []
                  if (!dialogues.length) return (
                    <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center', padding: '0.5rem 0' }}>
                      Aucun dialogue extrait — cliquez sur Extraire.
                    </p>
                  )
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {dialogues.map((d, i) => {
                        const npc = d.npc_id ? npcs.find(n => n.id === d.npc_id) : null
                        const tc = npc ? NPC_TYPE_CONFIG[npc.type] : null
                        const speakerLabel = d.speaker === 'joueur' ? '🧑 Joueur' : npc ? `${tc!.icon} ${npc.name}` : d.speaker ? `👤 ${d.speaker}` : '? Inconnu'
                        const speakerColor = d.speaker === 'joueur' ? 'var(--accent)' : tc ? tc.color : 'var(--muted)'
                        return (
                          <div key={i} style={{ background: 'var(--surface-2)', borderRadius: '6px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                            {/* Ligne principale */}
                            {/* Ligne texte */}
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.4rem 0.6rem' }}>
                              <span style={{ fontSize: '0.65rem', color: speakerColor, fontWeight: 'bold', whiteSpace: 'nowrap', paddingTop: '0.1rem', minWidth: '80px' }}>{speakerLabel}</span>
                              <textarea
                                ref={el => { dialogueTextareaRefs.current[i] = el }}
                                defaultValue={d.text}
                                onFocus={() => setFocusedDialogue(i)}
                                onBlur={async e => {
                                  setFocusedDialogue(null)
                                  const newText = e.target.value.trim()
                                  if (newText === d.text) return
                                  const updated = dialogues.map((x, j) => j === i ? { ...x, text: newText } : x)
                                  setSections(ss => ss.map(s => s.id === section.id ? { ...s, dialogues: updated } : s))
                                  await fetch(`/api/sections/${section.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dialogues: updated }) })
                                }}
                                rows={1}
                                style={{ fontSize: '0.78rem', color: 'var(--foreground)', fontStyle: 'italic', flex: 1, lineHeight: 1.4, background: 'transparent', border: 'none', borderBottom: focusedDialogue === i ? '1px solid var(--accent)' : '1px solid transparent', outline: 'none', resize: 'none', padding: '0 0 1px', fontFamily: 'inherit', overflow: 'hidden', cursor: 'text', transition: 'border-color 0.15s' }}
                                onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px' }}
                              />
                              <span style={{ fontSize: '0.6rem', color: 'var(--muted)', whiteSpace: 'nowrap', paddingTop: '0.1rem' }}>{d.source === 'transition' ? 'trans.' : 'contenu'}</span>
                              <select
                                value={d.image_index ?? ''}
                                onChange={async e => {
                                  const val = e.target.value === '' ? undefined : Number(e.target.value)
                                  const updated = dialogues.map((x, j) => j === i ? { ...x, image_index: val } : x)
                                  setSections(ss => ss.map(s => s.id === section.id ? { ...s, dialogues: updated } : s))
                                  await fetch(`/api/sections/${section.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dialogues: updated }) })
                                }}
                                title="Associer à un plan"
                                style={{ fontSize: '0.62rem', background: 'var(--surface)', border: `1px solid ${d.image_index !== undefined ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '4px', color: d.image_index !== undefined ? 'var(--accent)' : 'var(--muted)', padding: '0.1rem 0.25rem', cursor: 'pointer', outline: 'none', flexShrink: 0 }}
                              >
                                <option value="">— plan</option>
                                {[1, 2, 3, 4].map(n => (
                                  <option key={n} value={n - 1}>Plan {n}</option>
                                ))}
                              </select>
                            </div>

                            {/* Sélecteur de tags (visible quand le textarea est focus) */}
                            {focusedDialogue === i && (
                              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', padding: '0.3rem 0.6rem', borderTop: '1px solid var(--accent)22', background: 'var(--accent)08' }}>
                                <span style={{ fontSize: '0.6rem', color: 'var(--muted)', alignSelf: 'center', marginRight: '0.2rem' }}>Intonation :</span>
                                {EMOTION_TAGS.map(tag => (
                                  <button
                                    key={tag}
                                    onMouseDown={e => { e.preventDefault(); insertTagAtCursor(i, tag) }}
                                    style={{ fontSize: '0.6rem', padding: '0.1rem 0.45rem', borderRadius: '10px', border: '1px solid var(--accent)44', background: 'var(--accent)15', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'monospace' }}
                                  >
                                    [{tag}]
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Barre voix (si NPC avec voice_id) */}
                            {npc?.voice_id && (
                              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', padding: '0.3rem 0.6rem', borderTop: '1px solid #4ec9b015', background: '#4ec9b008' }}>
                                <span style={{ fontSize: '0.6rem', color: '#4ec9b066', flex: 1 }}>
                                  {/\[.+?\]/.test(d.text) ? '⚡ v3 (tags)' : '· multilingual v2'}
                                </span>
                                {/* Bouton ▶ preview */}
                                <button
                                  onClick={() => {
                                    if (playingDialogue === i) {
                                      dialogueAudioRef.current?.pause(); dialogueAudioRef.current = null; setPlayingDialogue(null)
                                    } else {
                                      playDialogueTts(npc, d.text, i)
                                    }
                                  }}
                                  disabled={savingDialogue !== null}
                                  title={playingDialogue === i ? 'Arrêter' : 'Écouter'}
                                  style={{ background: 'none', border: `1px solid ${playingDialogue === i ? '#4ec9b0' : '#4ec9b044'}`, borderRadius: '4px', color: '#4ec9b0', cursor: 'pointer', padding: '0.1rem 0.45rem', fontSize: '0.68rem', flexShrink: 0 }}
                                >
                                  {playingDialogue === i ? '■' : '▶'}
                                </button>
                                {/* Bouton 💾 save */}
                                <button
                                  onClick={() => saveDialogueTts(npc, d.text, i, dialogues)}
                                  disabled={savingDialogue !== null || playingDialogue !== null}
                                  title="Générer et sauvegarder le MP3"
                                  style={{ background: 'none', border: `1px solid ${d.audio_url ? '#4ec9b0' : '#4ec9b044'}`, borderRadius: '4px', color: d.audio_url ? '#4ec9b0' : 'var(--muted)', cursor: 'pointer', padding: '0.1rem 0.45rem', fontSize: '0.68rem', flexShrink: 0 }}
                                >
                                  {savingDialogue === i ? '⏳' : d.audio_url ? '✓ MP3' : '💾'}
                                </button>
                                {/* Lecteur si audio sauvegardé */}
                                {d.audio_url && (
                                  <audio controls src={d.audio_url} style={{ height: '22px', flex: 1, minWidth: 0, maxWidth: '160px' }} />
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

        </div>

        {/* Footer persistant */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--muted)', cursor: 'pointer', padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}>
            Fermer
          </button>
          <button onClick={() => onSave(section.id)} disabled={isSaving} style={{ background: 'var(--accent)', color: '#0f0f14', border: 'none', borderRadius: '6px', padding: '0.4rem 1rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', opacity: isSaving ? 0.6 : 1 }}>
            {isSaving ? 'Sauvegarde…' : '💾 Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Styles partagés ───────────────────────────────────────────────────────────

function btnStyle(bg: string, color: string, border?: string): React.CSSProperties {
  return { background: bg, color, border: border ?? 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.875rem' }
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: '6px', padding: '0.5rem 0.7rem', color: 'var(--foreground)',
  fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.72rem', color: 'var(--muted)',
  marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em',
}

// ── Carte des lieux ────────────────────────────────────────────────────────────

const MAP_STYLE_LABELS: Record<string, string> = {
  subway:  '🚇 Plan de métro',
  city:    '🏙️ Plan de ville',
  dungeon: '🏰 Plan de donjon',
  forest:  '🌲 Carte de forêt',
  sea:     '⚓ Carte maritime',
}

const MAP_VISIBILITY_LABELS: Record<string, string> = {
  full:  '👁️ Connue dès le début',
  found: '🗺️ Trouvée en chemin',
  fog:   '🌫️ Brouillard de guerre',
}

function MapView({ bookId, locations, setLocations, sections, choices, mapStyle, mapVisibility, mapSvg, onSvgGenerated, onNavigate }: {
  bookId: string
  locations: Location[]
  setLocations: React.Dispatch<React.SetStateAction<Location[]>>
  sections: Section[]
  choices: Choice[]
  mapStyle: string
  mapVisibility: string
  mapSvg?: string | null
  onSvgGenerated: (svg: string) => void
  onNavigate: (n: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [selectedLoc, setSelectedLoc] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'admin' | 'player'>('admin')

  async function generateMap() {
    setGenerating(true); setGenError(null)
    try {
      const res = await fetch(`/api/books/${bookId}/generate-map`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSvgGenerated(data.svg)
    } catch (err: any) { setGenError(err.message) }
    finally { setGenerating(false) }
  }

  // Index section id → location id
  const sectionLocMap = new Map(sections.filter(s => s.location_id).map(s => [s.id, s.location_id!]))

  // Sections par lieu
  const sectsByLoc = new Map<string, Section[]>()
  for (const loc of locations) sectsByLoc.set(loc.id, [])
  for (const s of sections) {
    if (s.location_id && sectsByLoc.has(s.location_id))
      sectsByLoc.get(s.location_id)!.push(s)
  }

  // Arêtes entre lieux (dédupliquées)
  const edges = new Set<string>()
  const edgeList: { from: Location; to: Location }[] = []
  for (const choice of choices) {
    if (!choice.target_section_id) continue
    const fromLocId = sectionLocMap.get(choice.section_id)
    const toLocId   = sectionLocMap.get(choice.target_section_id)
    if (!fromLocId || !toLocId || fromLocId === toLocId) continue
    const key = [fromLocId, toLocId].sort().join('|')
    if (edges.has(key)) continue
    edges.add(key)
    const from = locations.find(l => l.id === fromLocId)
    const to   = locations.find(l => l.id === toLocId)
    if (from && to) edgeList.push({ from, to })
  }

  function onPointerDown(e: React.PointerEvent, loc: Location) {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setDragging({ id: loc.id, startX: e.clientX, startY: e.clientY, origX: loc.x, origY: loc.y })
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const dx = ((e.clientX - dragging.startX) / rect.width)  * 100
    const dy = ((e.clientY - dragging.startY) / rect.height) * 100
    const newX = Math.round(Math.min(97, Math.max(3, dragging.origX + dx)))
    const newY = Math.round(Math.min(95, Math.max(5, dragging.origY + dy)))
    setLocations(ls => ls.map(l => l.id === dragging.id ? { ...l, x: newX, y: newY } : l))
  }

  async function onPointerUp() {
    if (!dragging) return
    const loc = locations.find(l => l.id === dragging.id)
    if (loc) {
      await fetch(`/api/books/${bookId}/locations`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: loc.id, x: loc.x, y: loc.y }),
      })
    }
    setDragging(null)
  }

  const selLoc = locations.find(l => l.id === selectedLoc)
  const selSections = selLoc ? (sectsByLoc.get(selLoc.id) ?? []) : []

  if (locations.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem', background: 'var(--surface)', borderRadius: '12px', border: '1px dashed var(--border)' }}>
        <p style={{ fontSize: '2rem', marginBottom: '1rem' }}>🗺️</p>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Aucun lieu généré pour ce livre.</p>
        <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.5rem' }}>
          Regénérez le livre avec un type de carte autre que "Aucune".
        </p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            {MAP_STYLE_LABELS[mapStyle] ?? mapStyle} · {MAP_VISIBILITY_LABELS[mapVisibility] ?? mapVisibility} · {locations.length} lieux
          </span>
          {/* Toggle vue joueur / admin */}
          <div style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)' }}>
            {(['admin', 'player'] as const).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                padding: '0.2rem 0.65rem', fontSize: '0.72rem', fontWeight: 'bold',
                border: 'none', cursor: 'pointer',
                background: viewMode === mode ? 'var(--accent)' : 'var(--surface-2)',
                color: viewMode === mode ? '#0f0f14' : 'var(--muted)',
              }}>
                {mode === 'admin' ? '⚙ Admin' : '🎮 Joueur'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {viewMode === 'admin' && (
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)', opacity: 0.7 }}>
              Glissez les marqueurs pour repositionner
            </span>
          )}
          <button
            onClick={generateMap} disabled={generating}
            style={{
              background: generating ? 'var(--surface-2)' : 'var(--accent)22',
              border: `1px solid ${generating ? 'var(--border)' : 'var(--accent)66'}`,
              borderRadius: '6px', color: generating ? 'var(--muted)' : 'var(--accent)',
              cursor: generating ? 'not-allowed' : 'pointer',
              padding: '0.25rem 0.7rem', fontSize: '0.75rem', fontWeight: 'bold',
            }}
          >{generating ? '⏳ Génération...' : mapSvg ? '🔄 Régénérer' : '🗺 Générer la carte'}</button>
          {genError && <span style={{ color: 'var(--danger)', fontSize: '0.72rem' }}>⚠ {genError}</span>}
        </div>
      </div>

      {/* ── Canvas de la carte ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
        <div
          ref={containerRef}
          onPointerMove={viewMode === 'admin' ? onPointerMove : undefined}
          onPointerUp={viewMode === 'admin' ? onPointerUp : undefined}
          onPointerLeave={viewMode === 'admin' ? onPointerUp : undefined}
          onClick={() => setSelectedLoc(null)}
          style={{
            flex: 1, position: 'relative', height: '520px',
            backgroundColor: mapSvg && viewMode === 'player' ? 'transparent' : 'var(--surface)',
            backgroundImage: viewMode === 'admin' ? 'radial-gradient(circle, var(--border) 1px, transparent 1px)' : 'none',
            backgroundSize: viewMode === 'admin' ? '32px 32px' : undefined,
            border: '1px solid var(--border)',
            borderRadius: '12px', overflow: 'hidden',
            cursor: viewMode === 'admin' && dragging ? 'grabbing' : 'default',
          }}
        >
          {/* SVG généré en fond (vue joueur + admin) */}
          {mapSvg ? (
            <div
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: '11px' }}
              dangerouslySetInnerHTML={{ __html: mapSvg.replace(/width="[^"]*"/, 'width="100%"').replace(/height="[^"]*"/, 'height="100%"') }}
            />
          ) : viewMode === 'player' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
              Aucune carte générée — cliquez sur "Générer la carte"
            </div>
          )}

          {/* ── Vue admin : arêtes + marqueurs de lieux ─────────────────────── */}
          {viewMode === 'admin' && (<>
            {/* Arêtes SVG */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#c9a84c66" />
                </marker>
              </defs>
              {edgeList.map(({ from, to }, i) => (
                <line key={i} x1={`${from.x}%`} y1={`${from.y}%`} x2={`${to.x}%`} y2={`${to.y}%`}
                  stroke="#c9a84c44" strokeWidth="1.5" strokeDasharray="5,3"
                  markerEnd="url(#arrowhead)" />
              ))}
            </svg>

            {/* Marqueurs de lieux avec références de sections */}
            {locations.map(loc => {
              const sects = sectsByLoc.get(loc.id) ?? []
              const hasVictory = sects.some(s => s.is_ending && s.ending_type === 'victory')
              const hasDeath   = sects.some(s => s.is_ending && s.ending_type === 'death')
              const isSelected = selectedLoc === loc.id
              const borderColor = hasVictory ? '#4caf7d' : hasDeath ? '#c94c4c' : isSelected ? 'var(--accent)' : 'var(--border)'

              return (
                <div
                  key={loc.id}
                  onPointerDown={e => onPointerDown(e, loc)}
                  onClick={e => { e.stopPropagation(); setSelectedLoc(loc.id) }}
                  style={{
                    position: 'absolute',
                    left: `${loc.x}%`, top: `${loc.y}%`,
                    transform: 'translate(-50%, -50%)',
                    cursor: 'grab', userSelect: 'none',
                    zIndex: isSelected ? 10 : 1,
                  }}
                >
                  <div style={{
                    background: '#0f0f14cc',
                    border: `2px solid ${borderColor}`,
                    borderRadius: '10px',
                    padding: '0.35rem 0.55rem',
                    boxShadow: isSelected ? `0 0 0 3px ${borderColor}44, 0 4px 16px #0008` : '0 2px 8px #0006',
                    transition: 'box-shadow 0.15s, border-color 0.15s',
                    minWidth: '72px', maxWidth: '110px',
                    textAlign: 'center',
                    backdropFilter: 'blur(2px)',
                  }}>
                    <div style={{ fontSize: '1.1rem', lineHeight: 1 }}>{loc.icon}</div>
                    <div style={{ fontSize: '0.62rem', color: 'var(--foreground)', fontWeight: 'bold', marginTop: '0.2rem', lineHeight: 1.2 }}>
                      {loc.name}
                    </div>
                    {/* Numéros de sections */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', justifyContent: 'center', marginTop: '0.25rem' }}>
                      {sects.sort((a, b) => a.number - b.number).map(s => {
                        const t = getSectionType(s)
                        return (
                          <span key={s.id} style={{
                            fontSize: '0.52rem', fontWeight: 'bold',
                            color: t.color, background: `${t.color}22`,
                            borderRadius: '3px', padding: '1px 3px',
                          }}>§{s.number}</span>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </>)}
        </div>

        {/* ── Panneau détail du lieu sélectionné (admin uniquement) ──────────── */}
        {viewMode === 'admin' && <div style={{
          width: '240px', flexShrink: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '10px', padding: '1rem',
          minHeight: '200px',
        }}>
          {selLoc ? (
            <>
              <div style={{ fontSize: '1.5rem', textAlign: 'center', marginBottom: '0.4rem' }}>{selLoc.icon}</div>
              <h3 style={{ fontSize: '0.9rem', color: 'var(--accent)', textAlign: 'center', margin: '0 0 0.25rem' }}>{selLoc.name}</h3>
              <p style={{ fontSize: '0.68rem', color: 'var(--muted)', textAlign: 'center', margin: '0 0 0.9rem' }}>
                {selSections.length} section{selSections.length !== 1 ? 's' : ''}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {selSections.sort((a, b) => a.number - b.number).map(s => {
                  const t = getSectionType(s)
                  return (
                    <button key={s.id} onClick={() => onNavigate(s.number)} style={{
                      textAlign: 'left', background: 'var(--surface-2)',
                      border: `1px solid ${t.color}44`, borderRadius: '6px',
                      padding: '0.35rem 0.6rem', cursor: 'pointer',
                      fontSize: '0.75rem', color: 'var(--foreground)',
                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                    }}>
                      <span style={{ color: t.color }}>{t.icon}</span>
                      <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>§{s.number}</span>
                      {s.summary && <span style={{ color: 'var(--muted)', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.summary}</span>}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: '0.8rem', textAlign: 'center', marginTop: '2rem' }}>
              Cliquez sur un lieu pour voir ses sections
            </p>
          )}
        </div>}
      </div>
    </div>
  )
}
