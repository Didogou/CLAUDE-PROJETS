'use client'
/**
 * Studio Creator — page d'édition d'un livre (route /editor-test/studio-creator/[bookId]).
 *
 * Phase B (V0 mock) : rail (Sections + 3 Banques), tab Sections par défaut
 * affiche grille de tuiles + tuile "+ Nouvelle section". Click section →
 * navigue vers Studio Section. Tabs Banques = placeholders.
 *
 * Branchement BDD = Phase C. Pour l'instant, mock data dérivée du bookId.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRouter, useParams } from 'next/navigation'
import StudioCreatorLayout, { type CreatorTab } from '@/components/studio-creator/StudioCreatorLayout'
import SectionTile from '@/components/studio-creator/SectionTile'
import SectionPlansPanel from '@/components/studio-creator/SectionPlansPanel'
import SectionInfoPanel from '@/components/studio-creator/SectionInfoPanel'
import BookNpcsBank from '@/components/studio-creator/BookNpcsBank'
import CharacterCreatorModal from '@/components/image-editor/designer/CharacterCreatorModal'
import ItemCreatorModal, { type ItemFormData } from '@/components/image-editor/designer/ItemCreatorModal'
import { CharacterStoreProvider } from '@/lib/character-store'
import { CharacterPersistProvider } from '@/lib/character-persist-context'
import { mapApiSectionToSummary, type SectionSummary } from '@/components/studio-creator/types'
import { useThemePreference } from '@/lib/use-theme-preference'

export default function StudioCreatorPage() {
  const router = useRouter()
  const params = useParams<{ bookId: string }>()
  const bookId = params?.bookId ?? 'unknown'

  const [bookTitle, setBookTitle] = useState<string>(`Livre ${bookId}`)
  const [sections, setSections] = useState<SectionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Refonte UX 2026-05-12 — items du livre, utilisés par le panneau infos
  // section (filtre client-side par sections_used).
  const [bookItems, setBookItems] = useState<Array<{
    id: string; name: string; illustration_url: string | null; sections_used: string[]
  }>>([])
  const [activeTab, setActiveTab] = useState<CreatorTab>('sections')
  // Refonte UX 2026-05-12 : une seule section peut être étendue à la fois.
  // Lazy-load des plans = SectionPlansPanel fetch quand monté.
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null)
  // NPCs du livre — utilisés pour résoudre les chips persos cliquables vers
  // la fiche modal CharacterCreatorModal en mode édition.
  const [bookNpcs, setBookNpcs] = useState<Array<{
    id: string; name: string; portrait_url?: string | null;
    fullbody_gray_url?: string | null; appearance?: string | null;
    portrait_settings?: { gender?: string } | null
  }>>([])
  // Modals : édition perso et item
  const [editingNpcId, setEditingNpcId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<ItemFormData | null>(null)
  // Highlight bref d'une section (1.5s) après navigation depuis un click choix.
  const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null)
  const { theme, toggleTheme } = useThemePreference()

  // Phase C / B.4 — fetch book + sections + plans count.
  // V2 (refonte 2026-05-14) : 3 requêtes en parallèle.
  //   1. /api/books/[id]                  → book + sections (legacy bundle)
  //   2. /api/books/[id]/timeline-summary → count + thumb par section (V2)
  //   3. /api/books/[id]/items            → items du livre
  // Auparavant : /api/plans (table legacy `plans`) qui n'a aucun rapport avec
  // les data V2 assets_image / section_timeline. Donc le Studio Creator
  // affichait des thumbs / counts désynchronisés. Refonte 2026-05-14.
  useEffect(() => {
    let aborted = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const [bookRes, summaryRes, itemsRes] = await Promise.all([
          fetch(`/api/books/${bookId}`),
          fetch(`/api/books/${bookId}/timeline-summary`),
          fetch(`/api/books/${bookId}/items`),
        ])
        if (!bookRes.ok)    throw new Error(`book HTTP ${bookRes.status}`)
        if (!summaryRes.ok) throw new Error(`timeline-summary HTTP ${summaryRes.status}`)

        const bookData = await bookRes.json() as {
          book: { title?: string }
          sections: Parameters<typeof mapApiSectionToSummary>[0][]
          npcs?: Array<{
            id: string; name: string; portrait_url?: string | null;
            fullbody_gray_url?: string | null; appearance?: string | null;
            portrait_settings?: { gender?: string } | null
          }>
        }
        const summaryData = await summaryRes.json() as {
          bySection: Record<string, { count: number; thumbUrl: string | null }>
        }
        const itemsData = itemsRes.ok
          ? await itemsRes.json() as { items?: Array<{
              id: string; name: string; illustration_url: string | null; sections_used: string[]
            }> }
          : { items: [] }
        if (aborted) return

        setBookNpcs(bookData.npcs ?? [])
        setBookTitle(bookData.book?.title ?? `Livre ${bookId}`)

        // Map sections + override numPlans + thumbUrl avec les data V2.
        // Si une section n'est pas dans bySection (cas edge : nouvelle section
        // sans bloc) → fallback à mapApiSectionToSummary (legacy section.images).
        const mapped = (bookData.sections ?? []).map(s => {
          const summary = mapApiSectionToSummary(s)
          const v2 = summaryData.bySection[s.id]
          return {
            ...summary,
            numPlans: v2?.count ?? summary.numPlans ?? 0,
            thumbUrl: v2?.thumbUrl ?? summary.thumbUrl,
          }
        })
        setSections(mapped)
        setBookItems(itemsData.items ?? [])
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[StudioCreator] load book failed:', msg)
        setError(msg)
      } finally {
        if (!aborted) setLoading(false)
      }
    }
    void load()
    return () => { aborted = true }
  }, [bookId])

  // Map id → number pour résoudre les target_section_id côté SectionInfoPanel
  // (évite un re-fetch par cible).
  const sectionNumberById = useMemo(() => {
    const m = new Map<string, number>()
    sections.forEach(s => m.set(s.id, s.number))
    return m
  }, [sections])

  // Auto-scroll vers la section nouvellement étendue (refonte UX 2026-05-12).
  // Skip au premier render pour ne pas scroll au mount initial. Le scroll
  // smooth fait un mouvement doux en parallèle de l'animation d'expand.
  const firstExpandRef = useRef(true)
  useEffect(() => {
    if (firstExpandRef.current) {
      firstExpandRef.current = false
      return
    }
    if (!expandedSectionId) return
    // Petit delay pour laisser React peindre le DOM updated avant de chercher
    // l'élément, et synchroniser visuellement avec l'animation d'expand.
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-section-id="${expandedSectionId}"]`)
      if (el && 'scrollIntoView' in el) {
        (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 60)
    return () => clearTimeout(timer)
  }, [expandedSectionId])

  function handleOpenSection(sectionId: string) {
    router.push(`/editor-test/studio-section?sectionId=${sectionId}`)
  }
  function handleNewSection() {
    alert('TODO Phase C : POST /api/sections (créer une nouvelle section dans le livre)')
  }
  // Mémorise la position scroll à l'ouverture pour pouvoir y revenir à la
  // fermeture. Refonte UX 2026-05-12 — restore position + highlight visité.
  const prevScrollYRef = useRef<number | null>(null)

  function handleToggleExpand(sectionId: string) {
    setExpandedSectionId(prev => {
      if (prev === sectionId) {
        // Fermeture : marque comme récemment visité + restore scroll
        setHighlightedSectionId(sectionId)
        if (prevScrollYRef.current != null) {
          // Petit delay pour laisser l'animation collapse démarrer
          setTimeout(() => {
            window.scrollTo({ top: prevScrollYRef.current ?? 0, behavior: 'smooth' })
          }, 80)
        }
        return null
      }
      // Ouverture (ou switch vers une autre section)
      prevScrollYRef.current = window.scrollY
      setHighlightedSectionId(null)  // efface highlight précédent
      return sectionId
    })
  }
  function handleOpenPlan(assetId: string, assetType: 'image' | 'animation') {
    // V2 (refonte 2026-05-14) : route vers Designer/AnimationStudio avec
    // ?assetId=X selon le type. Auparavant : ?planId=X (table legacy plans).
    if (!expandedSectionId) return
    const params = new URLSearchParams({
      assetId,
      sectionId: expandedSectionId,
      returnSectionId: expandedSectionId,
    })
    const target = assetType === 'animation'
      ? '/editor-test/animation-studio'
      : '/editor-test/new-layout'
    router.push(`${target}?${params.toString()}`)
  }

  return (
    <CharacterStoreProvider>
    <StudioCreatorLayout
      bookTitle={bookTitle}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      theme={theme}
      onToggleTheme={toggleTheme}
      onBackToLibrary={() => router.push('/editor-test/library')}
    >
      {activeTab === 'sections' && (
        <>
          <div className="sc-section-header">
            <div>
              <h1>Sections</h1>
              <p>
                {loading
                  ? 'Chargement…'
                  : `${sections.length} section${sections.length > 1 ? 's' : ''} dans le livre`}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="sc-loading">Chargement des sections…</div>
          ) : error ? (
            <div className="sc-empty" style={{ color: '#EF4444' }}>
              ⚠ Erreur de chargement : {error}
            </div>
          ) : (
            <div className="sc-grid">
              {sections.map(s => {
                const isExpanded = expandedSectionId === s.id
                const isRecentlyVisited = highlightedSectionId === s.id
                // Structure constante pour que AnimatePresence persiste et
                // les exit animations puissent fire correctement (refonte
                // 2026-05-12 — fix close abrupt).
                return (
                  <React.Fragment key={s.id}>
                    <SectionTile
                      section={s}
                      onToggleExpand={handleToggleExpand}
                      onOpen={handleOpenSection}
                      expanded={isExpanded}
                      recentlyVisited={isRecentlyVisited}
                    />
                    {/* Info panel (à droite de la tile en mode étendu).
                     *  AnimatePresence permet l'exit animation au close. */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          key={`info-${s.id}`}
                          className="sc-section-info-floating"
                          initial={{ opacity: 0, x: -16 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -16 }}
                          transition={{
                            duration: 0.5,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                        >
                          <SectionInfoPanel
                            sectionId={s.id}
                            bookItems={bookItems}
                            sectionNumberById={sectionNumberById}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {/* Panel plans en dessous (full-row, slide vertical) */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <SectionPlansPanel
                          key={`panel-${s.id}`}
                          sectionId={s.id}
                          sectionLabel={s.title ?? `§${s.number}`}
                          onOpenPlan={handleOpenPlan}
                        />
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                )
              })}
              <button
                type="button"
                className="sc-tile sc-tile-new"
                onClick={handleNewSection}
                title="Créer une nouvelle section"
              >
                <span className="sc-tile-new-plus">+</span>
                <span>Nouvelle section</span>
              </button>
            </div>
          )}
        </>
      )}

      {activeTab === 'bank-images' && (
        <BankPlaceholder
          title="🖼 Banque d'images"
          desc="Toutes les images réutilisables du livre (plans, transitions, illustrations)."
          lines={[
            'Grille des images uploadées + générées',
            'Filtres par section, par tag (lieu, perso, ambiance)',
            'Utilisée par les Plans Static dans Studio Section',
            'Drag-drop pour insérer dans un Plan',
          ]}
        />
      )}
      {activeTab === 'bank-characters' && (
        <BookNpcsBank bookId={bookId} />
      )}
      {activeTab === 'bank-items' && (
        <BankPlaceholder
          title="📦 Banque d'objets"
          desc="Les objets du livre (inventaire joueur, items sur scène, échangeables NPC)."
          lines={[
            'Liste des objets (nom, icône, description, valeur)',
            'Items d\'inventaire vs items de scène (items_on_scene)',
            'Conditions d\'usage (clé pour porte, arme pour combat)',
            'Échanges via DiscussionScene (item_exchange)',
          ]}
        />
      )}
    </StudioCreatorLayout>
    </CharacterStoreProvider>
  )
}

function BankPlaceholder({ title, desc, lines }: { title: string; desc: string; lines: string[] }) {
  return (
    <div className="sc-bank-placeholder">
      <div className="sc-bank-placeholder-title">{title}</div>
      <div>{desc}</div>
      <ul className="sc-bank-placeholder-list">
        {lines.map((l, i) => <li key={i}>• {l}</li>)}
      </ul>
    </div>
  )
}
