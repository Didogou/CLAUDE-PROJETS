'use client'
/**
 * AnimationStudioBankPanel — Banque V2 unifiée du Studio Animation (refonte 2026-05-14bd).
 *
 * Pattern aligné DesignerBankPanel (aside slide-in à gauche).
 *
 * Contenu :
 *   - Onglets Animations / Images
 *   - Liste accordéon par Section du livre courant (toutes sections, pas
 *     juste la section ouverte → réutilisation cross-section)
 *   - Grandes vignettes (~ 8rem côté, 3 par row)
 *     · Animation : play overlay central qui joue la vidéo inline au hover
 *     · Image : bouton "Ajouter" qui place sur la timeline
 *   - Upload depuis PC en haut du panel
 *   - Search filtre sur label
 *
 * Remplace l'ancienne TimelineLibrary (sera supprimée Phase 3 quand stable).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, Upload, Loader2, ChevronDown, ChevronRight, Plus, Play, Film, Image as ImageIcon, Sparkles, Camera, Trash2, Clapperboard, ArrowUpDown, CheckSquare, Check, Edit2, Users, Package } from 'lucide-react'
import ConfirmDialog from '@/components/studio-section/ConfirmDialog'
// Refonte 2026-05-16 — CSS co-localisé pour que le panel marche aussi
// quand il est monté en dehors de AnimationStudioInner (ex : Studio Section
// après chantier 1). Auparavant le CSS n'était importé qu'au niveau page.
import './animation-studio-bank.css'

interface BankAsset {
  id: string
  url: string | null
  label?: string | null
  description?: string | null
  first_frame_url?: string | null  // pour animations
  video_url?: string | null         // pour animations
  type?: string | null              // 'animation' | 'image_static' | etc
  effects_params?: Record<string, unknown> | null  // refonte 2026-05-15dt
  created_at?: string | null        // refonte 2026-05-16 — tri + affichage
  updated_at?: string | null        // chantier 5 — pour Récents
}

// Re-export pour les callers (parent qui stocke un asset banque dans son state).
export type { BankAsset }

interface SectionInfo {
  id: string
  number: number
  title?: string | null
}

interface UsageRow {
  asset_id: string
  section_id: string
}

interface AnimationStudioBankPanelProps {
  bookId: string | null
  /** Section courante (ouverte par défaut dans l'accordéon). */
  currentSectionId: string | null
  /** Callback pour fermer le panel. */
  onClose: () => void
  /** Click "Ajouter" sur une image → place sur la timeline. */
  onAddImage: (imageId: string, imageUrl: string) => void
  /** Click "Ajouter" sur une animation → place sur la timeline. */
  onAddAnimation: (animationId: string) => void
  /** Upload d'un fichier image. Doit retourner l'asset créé en DB pour
   *  que le panel l'ajoute à son state local (refonte 2026-05-14bm). */
  onUploadImage?: (file: File) => Promise<BankAsset>
  /** Idem upload vidéo. Retourne l'asset_animation créé. */
  onUploadVideo?: (file: File) => Promise<BankAsset>
  /** Rename d'un asset depuis sa tile (refonte 2026-05-15bf). PATCH côté caller
   *  (`/api/assets/[type]/[id]` avec body { label }) + sync du label sur la
   *  pellicule live si elle est dans animationPellicules. */
  onRenameAsset?: (assetId: string, kind: 'animations' | 'images', newLabel: string) => void
  /** Refonte 2026-05-14bt — Counter externe qui force un refetch des assets.
   *  Le parent l'incrémente après une gen / commit asset → la banque V2
   *  ouverte affiche immédiatement la nouvelle animation. */
  refreshKey?: number
  /** Click sur l'icône ✨ Effets au hover d'une tile animation → ouvre la
   *  modale Bibliothèque d'effets pour cette pellicule. Refonte 2026-05-15ca,
   *  passe l'asset complet (videoUrl + first_frame + effects_params) pour que
   *  la modale fonctionne aussi quand l'asset n'est pas en timeline (refonte
   *  2026-05-15dt). */
  onOpenEffects?: (asset: BankAsset) => void
  /** Refonte 2026-05-15dq — bouton Capture séparé d'Effets dans bandeau bas tile.
   *  Reçoit l'asset complet (refonte 2026-05-15dt, idem onOpenEffects). */
  onOpenCapture?: (asset: BankAsset) => void
  /** Refonte 2026-05-16 — assetIds déjà présents dans la timeline de la section
   *  courante. Affiche une icône 🎬 clap discrète sur les tiles concernées. */
  inTimelineAssetIds?: string[]
  /** Chantier 3 (2026-05-16) — click Modifier sur une tile : ouvre le Studio
   *  approprié (Animation Studio pour anim, Designer pour image). Le `source`
   *  permet au parent de décider standalone ou contextuel (option C, cf
   *  memory project_hero_studios_architecture). */
  onEditAsset?: (
    asset: BankAsset,
    kind: 'animations' | 'images',
    source: 'recents' | 'section',
  ) => void
  /** Chantier 3 — click "Créer animation" dans le bandeau upload (active le
   *  bouton stub). Si undefined, le bouton reste disabled (pas de Studio). */
  onCreateAnimation?: () => void
  /** Idem "Créer image" (chantier 2 ré-activera). */
  onCreateImage?: () => void
  /** Refonte 2026-05-16 — bouton 🗑️ supprimer asset banque. Le panel passe les
   *  sections utilisant l'asset (enrichies id+number+title) pour que le parent
   *  affiche un warning + navigation. Cascade DELETE côté API. */
  onDeleteAsset?: (
    asset: BankAsset,
    kind: 'animations' | 'images',
    sectionsUsing: { id: string; number: number; title?: string | null }[],
  ) => void
  /** Refonte 2026-05-19 — verrouille l'onglet visible. Masque les autres tabs.
   *  Usage Studio Section : click toolbar Animation/Image/Persos/Objets ouvre
   *  la banque scopée. null/undefined = mode libre (tous tabs visibles). */
  lockedTab?: 'animations' | 'images' | 'characters' | 'items' | null
  /** Refonte 2026-05-19 — click sur une tile perso dans la banque (V1 stub). */
  onAddCharacter?: (npcId: string) => void
  /** Idem objet. V1 stub. */
  onAddItem?: (itemId: string) => void
  /** Click sur la tile "+ Créer" du tab Persos → ouvre BookNpcCreatorModal côté caller. */
  onCreateCharacter?: () => void
  /** Idem tab Objets. */
  onCreateItem?: () => void
  /** Click crayon ✎ sur une tile perso → caller ouvre BookNpcCreatorModal en
   *  édition. La bank rafraîchira via refreshKey après save côté caller. */
  onEditCharacter?: (npc: NpcTile) => void
  /** Click corbeille 🗑 sur une tile perso → caller confirme + DELETE. Le bank
   *  retire localement le row pour feedback instantané. */
  onDeleteCharacter?: (npc: NpcTile) => Promise<void> | void
  /** Symétriques pour les Objets (refonte 2026-05-19). */
  onEditItem?: (item: ItemTile) => void
  onDeleteItem?: (item: ItemTile) => Promise<void> | void
}

type TabKind = 'animations' | 'images' | 'characters' | 'items'

/** Row personnage = NpcRow complet du BookNpcCreatorModal (refonte 2026-05-19).
 *  /api/npcs retourne déjà toutes les colonnes utiles → on passe l'objet complet
 *  au callback edit (le caller peut le ré-injecter directement dans le modal). */
import type { NpcRow as NpcTile } from '@/components/studio-creator/BookNpcCreatorModal'
/** Row minimaliste pour la grid Objets (data fetched via /api/books/{id}/items). */
interface ItemTile {
  id: string
  name: string
  illustration_url?: string | null
  category?: string | null
}

/** Refonte 2026-05-14bu — dedup safety pour éviter les duplicate keys React.
 *  Garde la 1ère occurrence de chaque id. Sert quand la DB retourne 2 rows
 *  pour le même asset (doublon usage, race condition fetch concurrent, etc). */
function dedupById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    out.push(it)
  }
  return out
}

export default function AnimationStudioBankPanel({
  bookId, currentSectionId, onClose, onAddImage, onAddAnimation,
  onUploadImage, onUploadVideo, refreshKey, onRenameAsset, onOpenEffects, onOpenCapture, onDeleteAsset, inTimelineAssetIds,
  onEditAsset, onCreateAnimation, onCreateImage, lockedTab, onAddCharacter, onAddItem,
  onCreateCharacter, onCreateItem, onEditCharacter, onDeleteCharacter,
  onEditItem, onDeleteItem,
}: AnimationStudioBankPanelProps) {
  // Refonte 2026-05-19 — si lockedTab fourni, il prime sur le state local.
  // Sync useEffect re-aligne le state local quand lockedTab change → permet
  // au caller de passer "animations" puis "images" sans démonter le panel.
  const [tab, setTab] = useState<TabKind>(lockedTab ?? 'animations')
  useEffect(() => {
    if (lockedTab && lockedTab !== tab) setTab(lockedTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedTab])
  const [query, setQuery] = useState('')
  const [sections, setSections] = useState<SectionInfo[]>([])
  const [animations, setAnimations] = useState<BankAsset[]>([])
  const [images, setImages] = useState<BankAsset[]>([])
  // Refonte 2026-05-19 — tabs Personnages/Objets : fetch séparé du bookId.
  const [characters, setCharacters] = useState<NpcTile[]>([])
  const [items, setItems] = useState<ItemTile[]>([])
  // Refonte 2026-05-19 — protagoniste = favori (épinglé en haut de la grid Persos).
  const [protagonistNpcId, setProtagonistNpcId] = useState<string | null>(null)
  const [animUsages, setAnimUsages] = useState<UsageRow[]>([])
  const [imgUsages, setImgUsages] = useState<UsageRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Section ouverte dans l'accordéon. Default = section courante. */
  const [openSectionId, setOpenSectionId] = useState<string | null>(currentSectionId)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Tri global (refonte 2026-05-16) — 3 modes, appliqué à toutes les sections.
  type SortMode = 'date_desc' | 'date_asc' | 'name'
  const [sortMode, setSortMode] = useState<SortMode>('date_desc')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  // Multi-sélection (refonte 2026-05-16) — par tab, reset quand on switch tab.
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Confirm bulk delete
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleteInFlight, setBulkDeleteInFlight] = useState(false)
  // Récents collapsable (refonte 2026-05-16) — ouverte par défaut, repliable
  // pour laisser plus de place à la section en cours.
  const [recentsOpen, setRecentsOpen] = useState(true)
  // Reset selection quand on change de tab
  useEffect(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [tab])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Bug A fix 2026-05-14bl — Escape pour fermer (le tooltip le promettait
  // mais aucun listener n'était branché).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fetch sections + assets quand bookId change
  useEffect(() => {
    if (!bookId) return
    let aborted = false
    setLoading(true); setError(null)
    void (async () => {
      try {
        const [bookRes, animRes, imgRes, npcRes, itemRes] = await Promise.all([
          fetch(`/api/books/${bookId}`),
          fetch(`/api/assets/animation?bookId=${bookId}`),
          fetch(`/api/assets/image?bookId=${bookId}`),
          // Refonte 2026-05-19 — NPCs + items pour les nouveaux tabs.
          // npcs : /api/npcs?bookId=X retourne directement un array.
          // items : /api/books/{id}/items retourne { items: [...] }.
          fetch(`/api/npcs?bookId=${bookId}`),
          fetch(`/api/books/${bookId}/items`),
        ])
        if (!bookRes.ok) throw new Error(`book HTTP ${bookRes.status}`)
        if (!animRes.ok) throw new Error(`animations HTTP ${animRes.status}`)
        if (!imgRes.ok) throw new Error(`images HTTP ${imgRes.status}`)
        const bookData = await bookRes.json() as {
          sections?: SectionInfo[]
          book?: { protagonist_npc_id?: string | null }
        }
        const animData = await animRes.json() as { assets: BankAsset[]; usages: UsageRow[] }
        const imgData = await imgRes.json() as { assets: BankAsset[]; usages: UsageRow[] }
        // NPCs/items non-bloquants : si erreur, on log et on laisse vide.
        let npcData: NpcTile[] = []
        let itemData: ItemTile[] = []
        if (npcRes.ok) {
          npcData = await npcRes.json() as NpcTile[]
        } else {
          console.warn('[AnimationStudioBankPanel] npcs fetch failed:', npcRes.status)
        }
        if (itemRes.ok) {
          const ij = await itemRes.json() as { items?: ItemTile[] }
          itemData = ij.items ?? []
        } else {
          console.warn('[AnimationStudioBankPanel] items fetch failed:', itemRes.status)
        }
        if (aborted) return
        setSections((bookData.sections ?? []).slice().sort((a, b) => a.number - b.number))
        setProtagonistNpcId(bookData.book?.protagonist_npc_id ?? null)
        setCharacters(dedupById(npcData))
        setItems(dedupById(itemData))
        // Refonte 2026-05-14bu — dedup par id à l'arrivée. Évite duplicate
        // keys React si la DB retourne 2 rows avec même id (race condition,
        // doublon, etc) ou si le refresh suit un push optimiste sans dedup.
        setAnimations(dedupById(animData.assets ?? []))
        setImages(dedupById(imgData.assets ?? []))
        setAnimUsages(animData.usages ?? [])
        setImgUsages(imgData.usages ?? [])
      } catch (err) {
        if (aborted) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [bookId, refreshKey])

  // Récents (chantier 5 2026-05-16) — top N assets triés par updated_at
  // desc (fallback created_at). Cross-section : un asset peut apparaître
  // dans Récents ET dans son folder section (raccourci d'accès, voulu).
  // Dédup INTERNE par id (défense en profondeur — assets déjà dédupé via
  // dedupById au fetch, mais safety net si le state devient incohérent).
  const RECENT_LIMIT = 6
  const recents = useMemo(() => {
    const assets = tab === 'animations' ? animations : images
    const filtered = query.trim()
      ? assets.filter(a => (a.label ?? a.description ?? '').toLowerCase().includes(query.trim().toLowerCase()))
      : assets
    const sorted = [...filtered].sort((a, b) => {
      const da = Date.parse(a.updated_at ?? a.created_at ?? '') || 0
      const db = Date.parse(b.updated_at ?? b.created_at ?? '') || 0
      return db - da
    })
    // Dédup explicit par id avant slice
    const seen = new Set<string>()
    const out: BankAsset[] = []
    for (const a of sorted) {
      if (seen.has(a.id)) continue
      seen.add(a.id)
      out.push(a)
      if (out.length >= RECENT_LIMIT) break
    }
    return out
  }, [tab, animations, images, query])

  // Groupage par section + tri par created_at desc dans chaque section
  // (refonte 2026-05-16). Les assets sans created_at finissent en bas.
  // Refonte 2026-05-16 (sémantique archi Studios) — pour la section
  // COURANTE, on ne montre QUE les assets effectivement présents dans sa
  // timeline (cf memory project_hero_studios_architecture : "folder section
  // = assets utilisés dans la timeline"). Les autres sections gardent
  // l'ancien comportement (toutes les usages) — V2 affinera quand on
  // exposera la timeline de chaque section.
  const grouped = useMemo(() => {
    const assets = tab === 'animations' ? animations : images
    const usages = tab === 'animations' ? animUsages : imgUsages
    const filtered = query.trim()
      ? assets.filter(a => (a.label ?? a.description ?? '').toLowerCase().includes(query.trim().toLowerCase()))
      : assets
    const bySection = new Map<string, BankAsset[]>()
    const timelineSet = inTimelineAssetIds ? new Set(inTimelineAssetIds) : null
    for (const u of usages) {
      const asset = filtered.find(a => a.id === u.asset_id)
      if (!asset) continue
      // Filtre section courante : seuls les assets en timeline
      if (
        timelineSet
        && currentSectionId
        && u.section_id === currentSectionId
        && !timelineSet.has(asset.id)
      ) continue
      const arr = bySection.get(u.section_id) ?? []
      if (!arr.some(a => a.id === asset.id)) arr.push(asset)
      bySection.set(u.section_id, arr)
    }
    // Tri selon sortMode (refonte 2026-05-16). Default = date_desc.
    for (const arr of bySection.values()) {
      arr.sort((a, b) => {
        if (sortMode === 'name') {
          const na = (a.label ?? a.description ?? a.id).toLowerCase()
          const nb = (b.label ?? b.description ?? b.id).toLowerCase()
          return na.localeCompare(nb)
        }
        const da = a.created_at ? Date.parse(a.created_at) : 0
        const db = b.created_at ? Date.parse(b.created_at) : 0
        return sortMode === 'date_asc' ? da - db : db - da
      })
    }
    return bySection
  }, [tab, animations, images, animUsages, imgUsages, query, sortMode, currentSectionId, inTimelineAssetIds])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const isVideo = file.type.startsWith('video/')
    const isImage = file.type.startsWith('image/')
    if (!isVideo && !isImage) {
      setUploadError('Format invalide (image ou vidéo uniquement)')
      return
    }
    setUploading(true); setUploadError(null)
    try {
      // Refonte 2026-05-14bm — l'asset uploadé doit apparaître dans le panel
      // immédiatement (sans attendre un re-fetch). Le caller fait le POST
      // asset_image/animation puis retourne l'asset frais ; on l'ajoute au
      // state + on synthétise un usage pour la section courante (pour qu'il
      // apparaisse dans la bonne section accordion).
      let newAsset: BankAsset | undefined
      if (isVideo && onUploadVideo) newAsset = await onUploadVideo(file)
      else if (isImage && onUploadImage) newAsset = await onUploadImage(file)
      if (newAsset) {
        // Dedup safety : si le refresh global est en flight, l'asset peut
        // déjà être dans prev. On vire la version potentiellement plus
        // ancienne et on push la nouvelle en tête.
        const merge = (prev: BankAsset[]) => dedupById([newAsset!, ...prev])
        const mergeUsage = (prev: UsageRow[]) => {
          if (!currentSectionId) return prev
          const exists = prev.some(u => u.asset_id === newAsset!.id && u.section_id === currentSectionId)
          return exists ? prev : [...prev, { asset_id: newAsset!.id, section_id: currentSectionId }]
        }
        if (isVideo) {
          setAnimations(merge)
          setAnimUsages(mergeUsage)
        } else {
          setImages(merge)
          setImgUsages(mergeUsage)
          if (currentSectionId) setOpenSectionId(currentSectionId)
        }
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <aside className="asb-panel" role="complementary" aria-label="Banque d'assets">
      {/* Refonte 2026-05-16 — header ultra-compact : juste la croix
       *  de fermeture alignée à droite, plus de titre ni d'icône. */}
      <header className="asb-header">
        <button
          type="button"
          className="asb-close"
          onClick={onClose}
          title="Fermer (Échap)"
          aria-label="Fermer la banque"
        >
          <X size={13} />
        </button>
      </header>

      {/* Onglets Animations / Images. Refonte 2026-05-19 — `lockedTab` masque
       *  l'onglet non-actif (caller Studio Section qui scope la banque sur le
       *  type cliqué dans la toolbar). */}
      <div className="asb-tabs">
        {(!lockedTab || lockedTab === 'animations') && (
          <button
            type="button"
            data-kind="animations"
            className={`asb-tab ${tab === 'animations' ? 'is-active' : ''}`}
            onClick={() => setTab('animations')}
            disabled={!!lockedTab}
          >
            <Film size={13} /> Animations <span className="asb-tab-count">{animations.length}</span>
          </button>
        )}
        {(!lockedTab || lockedTab === 'images') && (
          <button
            type="button"
            data-kind="images"
            className={`asb-tab ${tab === 'images' ? 'is-active' : ''}`}
            onClick={() => setTab('images')}
            disabled={!!lockedTab}
          >
            <ImageIcon size={13} /> Images <span className="asb-tab-count">{images.length}</span>
          </button>
        )}
        {/* Refonte 2026-05-19 — tabs Personnages + Objets. Data fetched depuis
         *  /api/npcs et /api/books/{id}/items en parallèle du fetch animations/images. */}
        {(!lockedTab || lockedTab === 'characters') && (
          <button
            type="button"
            data-kind="characters"
            className={`asb-tab ${tab === 'characters' ? 'is-active' : ''}`}
            onClick={() => setTab('characters')}
            disabled={!!lockedTab}
          >
            <Users size={13} /> Personnages <span className="asb-tab-count">{characters.length}</span>
          </button>
        )}
        {(!lockedTab || lockedTab === 'items') && (
          <button
            type="button"
            data-kind="items"
            className={`asb-tab ${tab === 'items' ? 'is-active' : ''}`}
            onClick={() => setTab('items')}
            disabled={!!lockedTab}
          >
            <Package size={13} /> Objets <span className="asb-tab-count">{items.length}</span>
          </button>
        )}
      </div>

      {/* Upload + Créer (refonte 2026-05-16) — 2 boutons côte à côte.
       *  Créer = stub V1 (disabled "À venir"), wizard de génération IA prévu V2.
       *  Refonte 2026-05-19 — masqué pour persos/objets (création via rail). */}
      {(tab === 'animations' || tab === 'images') && (
      <div className="asb-upload">
        <input
          ref={fileInputRef}
          type="file"
          accept={tab === 'animations' ? 'video/mp4,video/quicktime,video/webm' : 'image/*'}
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
        <div className="asb-upload-row">
          <button
            type="button"
            className="asb-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? <><Loader2 size={12} className="asb-spin" /><span>Upload…</span></>
              : <><Upload size={12} /><span>Upload {tab === 'animations' ? 'vidéo' : 'image'}</span></>}
          </button>
          {(() => {
            // Chantier 3 — bouton actif si callback fourni, sinon stub disabled.
            const cb = tab === 'animations' ? onCreateAnimation : onCreateImage
            return (
              <button
                type="button"
                className="asb-create-btn"
                onClick={cb}
                disabled={!cb}
                title={cb
                  ? `Créer une ${tab === 'animations' ? 'nouvelle animation' : 'nouvelle image'}`
                  : 'À venir : génération via IA'}
              >
                <Plus size={12} />
                <span>Créer {tab === 'animations' ? 'animation' : 'image'}</span>
              </button>
            )
          })()}
        </div>
        {uploadError && <div className="asb-upload-err">{uploadError}</div>}
      </div>
      )}

      {/* Search */}
      <div className="asb-search">
        <Search size={13} className="asb-search-icon" />
        <input
          type="text"
          placeholder="Rechercher…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Contenu — `data-active-tab` drive le tinting du fond (CSS). */}
      <div className="asb-body" data-active-tab={tab}>
        {loading && <div className="asb-status"><Loader2 size={14} className="asb-spin" /> Chargement…</div>}
        {error && <div className="asb-status asb-status-err">⚠ {error}</div>}
        {!loading && !error && sections.length === 0 && (
          <div className="asb-status">Aucune section dans ce livre.</div>
        )}

        {/* Refonte 2026-05-19 — Grids Persos + Objets : rendu simple en V1
         *  (pas de Récents/sections accordéon). Recherche `query` filtre par nom. */}
        {!loading && !error && tab === 'characters' && (() => {
          const q = query.trim().toLowerCase()
          const list = q
            ? characters.filter(c => c.name.toLowerCase().includes(q))
            : characters
          // Refonte 2026-05-19 — Favoris = protagoniste + alliés. Épinglés en
          // haut, mis en évidence visuellement (badge ★).
          const favoris = list.filter(c =>
            (protagonistNpcId && c.id === protagonistNpcId) || c.type === 'allié')
          const autres = list.filter(c => !favoris.includes(c))
          const renderTile = (c: NpcTile, fav: boolean) => (
            <div
              key={c.id}
              className={`asb-mini-tile-wrap${fav ? ' is-favori' : ''}`}
            >
              <button
                type="button"
                className={`asb-mini-tile${fav ? ' is-favori' : ''}`}
                onClick={() => onAddCharacter?.(c.id)}
                title={c.id === protagonistNpcId ? `${c.name} · Protagoniste` : (c.type === 'allié' ? `${c.name} · Allié` : c.name)}
              >
                {c.portrait_url || c.fullbody_gray_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.portrait_url ?? c.fullbody_gray_url ?? ''} alt={c.name} />
                ) : (
                  <div className="asb-mini-tile-placeholder"><Users size={20} /></div>
                )}
                <div className="asb-mini-tile-label">
                  {fav && <span aria-hidden style={{ marginRight: '0.2rem' }}>★</span>}
                  {c.name}
                </div>
              </button>
              {/* Refonte 2026-05-19 — actions hover (crayon édit + corbeille
               *  suppression). Visibles uniquement au hover du wrap. */}
              <div className="asb-mini-tile-actions">
                {onEditCharacter && (
                  <button
                    type="button"
                    className="asb-mini-tile-action"
                    onClick={(e) => { e.stopPropagation(); onEditCharacter(c) }}
                    title="Modifier ce personnage"
                    aria-label="Modifier"
                  >
                    <Edit2 size={11} />
                  </button>
                )}
                {onDeleteCharacter && (
                  <button
                    type="button"
                    className="asb-mini-tile-action asb-mini-tile-action-danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!window.confirm(`Supprimer "${c.name}" ? Les plans qui le référencent perdront leur lien.`)) return
                      // Optimistic remove + délègue le DELETE au caller.
                      setCharacters(prev => prev.filter(x => x.id !== c.id))
                      void Promise.resolve(onDeleteCharacter(c)).catch(err => {
                        console.error('[Bank] delete character failed, restoring', err)
                        setCharacters(prev => prev.find(x => x.id === c.id) ? prev : [...prev, c])
                        alert(`Suppression échouée : ${err instanceof Error ? err.message : String(err)}`)
                      })
                    }}
                    title="Supprimer ce personnage"
                    aria-label="Supprimer"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </div>
          )
          // Tile "+ Créer" toujours présente (même si liste vide), dans le bloc
          // "Autres" pour cohérence visuelle (favoris = stricts).
          const createTile = onCreateCharacter ? (
            <button
              key="create"
              type="button"
              className="asb-create-tile"
              onClick={onCreateCharacter}
              title="Créer un nouveau personnage"
            >
              <Plus size={18} />
              <span className="asb-create-tile-label">Créer</span>
            </button>
          ) : null
          return (
            <>
              {favoris.length > 0 && (
                <div className="asb-subsection">
                  <div className="asb-subsection-title">★ Favoris</div>
                  <div className="asb-grid">{favoris.map(c => renderTile(c, true))}</div>
                </div>
              )}
              <div className="asb-subsection">
                {favoris.length > 0 && <div className="asb-subsection-title">Autres</div>}
                <div className="asb-grid">
                  {createTile}
                  {autres.map(c => renderTile(c, false))}
                  {autres.length === 0 && createTile === null && (
                    <div className="asb-status" style={{ gridColumn: '1 / -1' }}>
                      {q ? `Aucun personnage matchant "${query}".` : 'Aucun personnage dans ce livre.'}
                    </div>
                  )}
                </div>
              </div>
            </>
          )
        })()}

        {!loading && !error && tab === 'items' && (() => {
          const q = query.trim().toLowerCase()
          const list = q
            ? items.filter(i => i.name.toLowerCase().includes(q))
            : items
          const createTile = onCreateItem ? (
            <button
              key="create"
              type="button"
              className="asb-create-tile"
              onClick={onCreateItem}
              title="Créer un nouvel objet"
            >
              <Plus size={18} />
              <span className="asb-create-tile-label">Créer</span>
            </button>
          ) : null
          return (
            <div className="asb-subsection">
              <div className="asb-grid">
                {createTile}
                {list.map(i => (
                  <div key={i.id} className="asb-mini-tile-wrap">
                    <button
                      type="button"
                      className="asb-mini-tile"
                      onClick={() => onAddItem?.(i.id)}
                      title={i.name}
                    >
                      {i.illustration_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.illustration_url} alt={i.name} />
                      ) : (
                        <div className="asb-mini-tile-placeholder"><Package size={20} /></div>
                      )}
                      <div className="asb-mini-tile-label">{i.name}</div>
                    </button>
                    <div className="asb-mini-tile-actions">
                      {onEditItem && (
                        <button
                          type="button"
                          className="asb-mini-tile-action"
                          onClick={(e) => { e.stopPropagation(); onEditItem(i) }}
                          title="Modifier cet objet"
                          aria-label="Modifier"
                        >
                          <Edit2 size={11} />
                        </button>
                      )}
                      {onDeleteItem && (
                        <button
                          type="button"
                          className="asb-mini-tile-action asb-mini-tile-action-danger"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!window.confirm(`Supprimer "${i.name}" ? Les sections qui le référencent perdront leur lien.`)) return
                            setItems(prev => prev.filter(x => x.id !== i.id))
                            void Promise.resolve(onDeleteItem(i)).catch(err => {
                              console.error('[Bank] delete item failed, restoring', err)
                              setItems(prev => prev.find(x => x.id === i.id) ? prev : [...prev, i])
                              alert(`Suppression échouée : ${err instanceof Error ? err.message : String(err)}`)
                            })
                          }}
                          title="Supprimer cet objet"
                          aria-label="Supprimer"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {list.length === 0 && createTile === null && (
                  <div className="asb-status" style={{ gridColumn: '1 / -1' }}>
                    {q ? `Aucun objet matchant "${query}".` : 'Aucun objet dans ce livre.'}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Section "Récents" (chantier 5 2026-05-16) — top assets triés par
         *  updated_at desc, indépendamment de leur section d'origine. Toujours
         *  ouverte, pas collapsable. Affichée si au moins 1 asset existe.
         *  Refonte 2026-05-19 — masquée si tab = persos/objets (pas applicable). */}
        {!loading && !error && (tab === 'animations' || tab === 'images') && recents.length > 0 && (
          <div className={`asb-section asb-section-recents ${recentsOpen ? 'is-open' : ''}`}>
            <div className="asb-section-header">
              <button
                type="button"
                className="asb-section-toggle"
                onClick={() => setRecentsOpen(o => !o)}
                aria-label={recentsOpen ? 'Replier Récents' : 'Déplier Récents'}
              >
                {recentsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="asb-section-title">⏱ Récents</span>
                <span className="asb-section-count">{recents.length}</span>
              </button>
            </div>
            {recentsOpen && (
            <div className="asb-grid">
              {recents.map(asset => (
                <BankTile
                  key={`recent-${asset.id}`}
                  asset={asset}
                  kind={tab}
                  onEdit={onEditAsset ? () => onEditAsset(asset, tab, 'recents') : undefined}
                  selectable={selectionMode}
                  selected={selectedIds.has(asset.id)}
                  onToggleSelect={() => {
                    setSelectedIds(prev => {
                      const next = new Set(prev)
                      if (next.has(asset.id)) next.delete(asset.id)
                      else next.add(asset.id)
                      return next
                    })
                  }}
                  onAdd={() => {
                    if (tab === 'animations') onAddAnimation(asset.id)
                    else if (asset.url) onAddImage(asset.id, asset.url)
                  }}
                  onRename={onRenameAsset
                    ? (newLabel) => {
                        const setter = tab === 'animations' ? setAnimations : setImages
                        setter(prev => prev.map(a =>
                          a.id === asset.id ? { ...a, label: newLabel } : a,
                        ))
                        onRenameAsset(asset.id, tab, newLabel)
                      }
                    : undefined}
                  onOpenEffects={tab === 'animations' && onOpenEffects
                    ? () => onOpenEffects(asset)
                    : undefined}
                  onOpenCapture={tab === 'animations' && onOpenCapture
                    ? () => onOpenCapture(asset)
                    : undefined}
                  onDelete={onDeleteAsset
                    ? () => {
                        const usages = tab === 'animations' ? animUsages : imgUsages
                        const sectionIds = usages
                          .filter(u => u.asset_id === asset.id)
                          .map(u => u.section_id)
                        const sectionsUsing = sectionIds
                          .map(sid => sections.find(s => s.id === sid))
                          .filter((s): s is SectionInfo => !!s)
                          .map(s => ({ id: s.id, number: s.number, title: s.title }))
                        onDeleteAsset(asset, tab, sectionsUsing)
                      }
                    : undefined}
                  inTimeline={!!inTimelineAssetIds?.includes(asset.id)}
                />
              ))}
            </div>
            )}
          </div>
        )}

        {!loading && !error && (tab === 'animations' || tab === 'images') && sections.map(section => {
          const sectionAssets = grouped.get(section.id) ?? []
          const isOpen = openSectionId === section.id
          if (sectionAssets.length === 0 && !isOpen) return null  // skip sections vides sauf si déjà ouverte
          // Nb assets sélectionnés DANS cette section (selectedIds est global mais
          // affiche le badge uniquement si match avec la section ouverte).
          const sectionSelectedCount = isOpen
            ? sectionAssets.filter(a => selectedIds.has(a.id)).length
            : 0
          return (
            <div key={section.id} className={`asb-section ${isOpen ? 'is-open' : ''}`}>
              {/* Refonte 2026-05-16 — header passe en div (avec sub-buttons
               *  pour Trier / Sélectionner / Trash bulk). Toggle accordéon =
               *  click sur titre uniquement. */}
              <div className="asb-section-header">
                <button
                  type="button"
                  className="asb-section-toggle"
                  onClick={() => setOpenSectionId(isOpen ? null : section.id)}
                  aria-label={isOpen ? 'Fermer la section' : 'Ouvrir la section'}
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="asb-section-title">
                    Section {section.number}
                    {section.title ? ` — ${section.title}` : ''}
                  </span>
                  <span className="asb-section-count">{sectionAssets.length}</span>
                </button>
                {/* Actions à droite du header (visibles uniquement si section
                 *  ouverte, sinon header reste lisible) */}
                {isOpen && (
                  <div className="asb-section-actions">
                    {/* Bouton Trier — menu dropdown global (refonte 2026-05-16) */}
                    <div className="asb-sort-wrap">
                      <button
                        type="button"
                        className={`asb-section-btn ${sortMenuOpen ? 'is-open' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setSortMenuOpen(o => !o) }}
                        title="Trier"
                      >
                        <ArrowUpDown size={11} />
                      </button>
                      {sortMenuOpen && (
                        <div className="asb-sort-menu" onClick={(e) => e.stopPropagation()}>
                          {([
                            { key: 'date_desc' as const, label: 'Date ↓ (plus récent)' },
                            { key: 'date_asc' as const, label: 'Date ↑ (plus ancien)' },
                            { key: 'name' as const, label: 'Nom (A-Z)' },
                          ]).map(opt => (
                            <button
                              key={opt.key}
                              type="button"
                              className={`asb-sort-menu-item ${sortMode === opt.key ? 'is-active' : ''}`}
                              onClick={() => { setSortMode(opt.key); setSortMenuOpen(false) }}
                            >
                              {sortMode === opt.key && <Check size={10} />}
                              <span>{opt.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Bouton Sélectionner — toggle mode multi-sélection */}
                    <button
                      type="button"
                      className={`asb-section-btn ${selectionMode ? 'is-active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (selectionMode) {
                          setSelectionMode(false)
                          setSelectedIds(new Set())
                        } else {
                          setSelectionMode(true)
                        }
                      }}
                      title={selectionMode ? 'Quitter le mode sélection' : 'Sélectionner plusieurs'}
                    >
                      <CheckSquare size={11} />
                      {sectionSelectedCount > 0 && (
                        <span className="asb-section-btn-count">{sectionSelectedCount}</span>
                      )}
                    </button>
                    {/* Bouton 🗑️ bulk delete — apparaît si au moins 1 sélectionné */}
                    {selectionMode && selectedIds.size > 0 && (
                      <button
                        type="button"
                        className="asb-section-btn asb-section-btn-danger"
                        onClick={(e) => { e.stopPropagation(); setConfirmBulkDelete(true) }}
                        title={`Supprimer ${selectedIds.size} asset${selectedIds.size > 1 ? 's' : ''}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {isOpen && (
                <div className="asb-grid">
                  {sectionAssets.length === 0 ? (
                    <div className="asb-empty">
                      Aucun {tab === 'animations' ? 'e animation' : 'e image'} dans cette section.
                    </div>
                  ) : (
                    sectionAssets.map(asset => (
                      <BankTile
                        key={asset.id}
                        asset={asset}
                        kind={tab}
                        onEdit={onEditAsset ? () => onEditAsset(asset, tab, 'section') : undefined}
                        selectable={selectionMode}
                        selected={selectedIds.has(asset.id)}
                        onToggleSelect={() => {
                          setSelectedIds(prev => {
                            const next = new Set(prev)
                            if (next.has(asset.id)) next.delete(asset.id)
                            else next.add(asset.id)
                            return next
                          })
                        }}
                        onAdd={() => {
                          if (tab === 'animations') onAddAnimation(asset.id)
                          else if (asset.url) onAddImage(asset.id, asset.url)
                        }}
                        onRename={onRenameAsset
                          ? (newLabel) => {
                              // Optimistic UI : update local state immédiat
                              const setter = tab === 'animations' ? setAnimations : setImages
                              setter(prev => prev.map(a =>
                                a.id === asset.id ? { ...a, label: newLabel } : a,
                              ))
                              onRenameAsset(asset.id, tab, newLabel)
                            }
                          : undefined}
                        onOpenEffects={tab === 'animations' && onOpenEffects
                          ? () => onOpenEffects(asset)
                          : undefined}
                        onOpenCapture={tab === 'animations' && onOpenCapture
                          ? () => onOpenCapture(asset)
                          : undefined}
                        onDelete={onDeleteAsset
                          ? () => {
                              // Construit la liste des sections utilisant cet asset
                              // (enrichie title+number depuis le state sections déjà chargé).
                              const usages = tab === 'animations' ? animUsages : imgUsages
                              const sectionIds = usages
                                .filter(u => u.asset_id === asset.id)
                                .map(u => u.section_id)
                              const sectionsUsing = sectionIds
                                .map(sid => sections.find(s => s.id === sid))
                                .filter((s): s is SectionInfo => !!s)
                                .map(s => ({ id: s.id, number: s.number, title: s.title }))
                              onDeleteAsset(asset, tab, sectionsUsing)
                            }
                          : undefined}
                        inTimeline={!!inTimelineAssetIds?.includes(asset.id)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ConfirmDialog bulk delete (refonte 2026-05-16). Cascade scoped au
       *  livre courant (DELETE /api/assets/[type]/[id]?bookId=X). Action
       *  irréversible — un seul confirm fort. */}
      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Supprimer ${selectedIds.size} ${tab === 'animations' ? 'animation' : 'image'}${selectedIds.size > 1 ? 's' : ''} ?`}
        message={
          <div>
            <p style={{ margin: 0 }}>
              Toutes les {tab === 'animations' ? 'animations' : 'images'} sélectionnées
              seront retirées de <strong>toutes les sections et timelines de ce livre</strong>.
            </p>
            <p style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: '#ef4444' }}>
              Action irréversible.
            </p>
          </div>
        }
        variant="danger"
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        loading={bulkDeleteInFlight}
        onCancel={() => setConfirmBulkDelete(false)}
        onConfirm={async () => {
          if (!bookId) return
          setBulkDeleteInFlight(true)
          const apiKind = tab === 'animations' ? 'animation' : 'image'
          const ids = Array.from(selectedIds)
          const failures: string[] = []
          try {
            // DELETE en série pour ne pas saturer le serveur.
            for (const id of ids) {
              const res = await fetch(
                `/api/assets/${apiKind}/${id}?bookId=${bookId}`,
                { method: 'DELETE' },
              )
              if (!res.ok) failures.push(id.slice(0, 8))
            }
            if (failures.length > 0) {
              alert(`${failures.length} échec(s) sur ${ids.length} : ${failures.join(', ')}`)
            }
          } catch (err) {
            console.error('[AnimationStudioBankPanel] bulk DELETE failed:', err)
            alert(`Erreur : ${err instanceof Error ? err.message : String(err)}`)
          } finally {
            setBulkDeleteInFlight(false)
            setConfirmBulkDelete(false)
            setSelectionMode(false)
            setSelectedIds(new Set())
            // Trigger refresh (re-fetch assets via parent qui incrémente refreshKey)
            // En interne on déclenche aussi un re-fetch local via state changes.
            // Le parent reçoit déjà refreshKey, mais pour assurer un refresh
            // immédiat sans round-trip, on retire les ids du state local.
            const removed = new Set(ids)
            if (tab === 'animations') {
              setAnimations(prev => prev.filter(a => !removed.has(a.id)))
              setAnimUsages(prev => prev.filter(u => !removed.has(u.asset_id)))
            } else {
              setImages(prev => prev.filter(a => !removed.has(a.id)))
              setImgUsages(prev => prev.filter(u => !removed.has(u.asset_id)))
            }
          }
        }}
      />
    </aside>
  )
}

// ── Tile ──────────────────────────────────────────────────────────────────

function BankTile({
  asset, kind, onAdd, onRename, onOpenEffects, onOpenCapture, onDelete, inTimeline,
  selectable, selected, onToggleSelect, onEdit,
}: {
  asset: BankAsset
  kind: TabKind
  onAdd: () => void
  onRename?: (newLabel: string) => void
  onOpenEffects?: () => void
  onOpenCapture?: () => void
  onDelete?: () => void
  inTimeline?: boolean
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  /** Chantier 3 (2026-05-16) — click "Modifier" → ouvre le Studio (Anim/Designer). */
  onEdit?: () => void
}) {
  const thumbSrc = kind === 'animations' ? asset.first_frame_url : asset.url
  const [hovering, setHovering] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Refonte 2026-05-15bf — édition inline du label par double-click.
  const [editing, setEditing] = useState(false)
  const [draftLabel, setDraftLabel] = useState(asset.label ?? '')
  function commitRename() {
    setEditing(false)
    const trimmed = draftLabel.trim()
    if (!trimmed || trimmed === asset.label) return
    onRename?.(trimmed)
  }

  // Hover sur animation → play inline preview
  useEffect(() => {
    if (kind !== 'animations') return
    const v = videoRef.current
    if (!v) return
    if (hovering && asset.video_url) {
      v.currentTime = 0
      void v.play().catch(() => {/* autoplay block */})
    } else {
      v.pause()
    }
  }, [hovering, kind, asset.video_url])

  // Formate la date de création en format compact "JJ/MM HH:MM" (refonte 2026-05-16).
  // Affichée en petit au-dessus de chaque miniature.
  const createdLabel = asset.created_at ? (() => {
    const d = new Date(asset.created_at)
    if (isNaN(d.getTime())) return null
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm} ${hh}:${mi}`
  })() : null

  return (
    <div
      className={`asb-tile ${selectable ? 'is-selectable' : ''} ${selected ? 'is-selected' : ''}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={selectable ? () => onToggleSelect?.() : undefined}
      role={selectable ? 'checkbox' : undefined}
      aria-checked={selectable ? !!selected : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={selectable ? (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggleSelect?.() }
      } : undefined}
    >
      {createdLabel && (
        <div className="asb-tile-date" title={`Créé le ${asset.created_at}`}>
          {createdLabel}
        </div>
      )}
      {/* Checkbox en mode sélection — top-left du thumb. Refonte 2026-05-16. */}
      {selectable && (
        <div className="asb-tile-checkbox" aria-hidden>
          {selected ? <Check size={11} /> : null}
        </div>
      )}
      <div className="asb-tile-thumb">
        {kind === 'animations' && asset.video_url && hovering ? (
          <video
            ref={videoRef}
            src={asset.video_url}
            muted
            loop
            playsInline
            className="asb-tile-video"
          />
        ) : thumbSrc ? (
          <img src={thumbSrc} alt={asset.label ?? ''} className="asb-tile-img" />
        ) : (
          <div className="asb-tile-placeholder">{asset.label ?? '(vide)'}</div>
        )}
        {kind === 'animations' && !hovering && (
          <div className="asb-tile-play-overlay" aria-hidden>
            <Play size={20} />
          </div>
        )}
        {/* Indicateur 🎬 clap — asset déjà présent dans la timeline section
         *  courante. Refonte 2026-05-16. Toujours visible (pas seulement hover). */}
        {inTimeline && (
          <div
            className="asb-tile-timeline-badge"
            title="Déjà présent dans la timeline de cette section"
            aria-label="Dans la timeline"
          >
            <Clapperboard size={11} />
          </div>
        )}
        {/* Bouton 🗑️ supprimer — visible au hover, top-right. Refonte 2026-05-16.
         *  Caché en mode sélection (le bulk delete est dans le header section). */}
        {onDelete && hovering && !selectable && (
          <button
            type="button"
            className="asb-tile-delete-btn"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="Supprimer cet asset de la banque"
            aria-label="Supprimer"
          >
            <Trash2 size={11} />
          </button>
        )}
        {/* Bandeau bas Effets/Capture — visible sur animation seulement, au hover.
         *  Posé DANS le thumb (.asb-tile-thumb est position:relative) pour ne pas
         *  chevaucher le footer + bouton Ajouter (refonte 2026-05-15dt). */}
        {/* Bandeau bas tile — animation : Effets / Capture / Modifier
         *  - image : Modifier seul
         *  Visible au hover, masqué en mode select (refonte chantier 3 2026-05-16). */}
        {((kind === 'animations' && (onOpenEffects || onOpenCapture || onEdit)) ||
          (kind === 'images' && onEdit)) && hovering && !selectable && (
          <div className="asb-tile-bottom-bar" onClick={(e) => e.stopPropagation()}>
            {/* Refonte 2026-05-17 — Effets/Capture uniquement sur animations
             *  RÉELLES (avec video_url). Pellicules sans vidéo générée ne
             *  doivent pas afficher ces actions inutilisables. */}
            {kind === 'animations' && asset.video_url && onOpenEffects && (
              <button
                type="button"
                className="asb-tile-bb-btn asb-tile-bb-effects"
                onClick={(e) => { e.stopPropagation(); onOpenEffects() }}
                title="Ouvrir la bibliothèque d'effets"
              >
                <Sparkles size={11} /> Effets
              </button>
            )}
            {kind === 'animations' && asset.video_url && onOpenCapture && (
              <button
                type="button"
                className="asb-tile-bb-btn asb-tile-bb-capture"
                onClick={(e) => { e.stopPropagation(); onOpenCapture() }}
                title="Capturer des frames de cette vidéo"
              >
                <Camera size={11} /> Capture
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                className="asb-tile-bb-btn asb-tile-bb-edit"
                onClick={(e) => { e.stopPropagation(); onEdit() }}
                title={kind === 'animations'
                  ? 'Modifier dans Studio Animation'
                  : 'Modifier dans Studio Image (Designer)'}
              >
                <Edit2 size={11} /> Modifier
              </button>
            )}
          </div>
        )}
      </div>
      <div className="asb-tile-footer">
        {editing && onRename ? (
          <input
            className="asb-tile-label-input"
            value={draftLabel}
            autoFocus
            onChange={e => setDraftLabel(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              else if (e.key === 'Escape') { setEditing(false); setDraftLabel(asset.label ?? '') }
            }}
          />
        ) : (
          <span
            className="asb-tile-label"
            onDoubleClick={onRename ? () => { setDraftLabel(asset.label ?? ''); setEditing(true) } : undefined}
            title={onRename ? 'Double-cliquer pour renommer' : undefined}
          >
            {asset.label ?? asset.description?.slice(0, 18) ?? asset.id.slice(0, 8)}
          </span>
        )}
        {/* Bouton Ajouter caché en mode sélection (refonte 2026-05-16) */}
        {!selectable && (
          <button
            type="button"
            className="asb-tile-add"
            onClick={(e) => { e.stopPropagation(); onAdd() }}
            title={`Ajouter ${kind === 'animations' ? 'cette animation' : 'cette image'} à la timeline`}
          >
            <Plus size={12} /> Ajouter
          </button>
        )}
      </div>
    </div>
  )
}
