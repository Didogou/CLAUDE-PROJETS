'use client'
/**
 * ItemCreatorModal — fiche complète d'édition / création d'un objet (item).
 *
 * Refonte Objet 2026-05-12. Parallèle à CharacterCreatorModal pour les persos.
 *
 * Modes :
 *   - Création  : `editingItem={ id: 'new' }` → POST /api/books/{bookId}/items
 *   - Édition   : `editingItem={...full item}` → PATCH /api/items/{id}
 *
 * Champs gérés :
 *   - Identité : name (req), item_type, category, weapon_type (si arme)
 *   - Visuels  : illustration_url avec bouton Générer (Z-Image preset objet
 *                isolé fond gris) OU Importer depuis PC
 *   - Description narrative
 *   - Gameplay : effect.{hp_restore, mana_restore, stat, bonus, spell},
 *                quantity, auto_pickup
 *   - Liens   : sections_used (lecture seule, peut être édité depuis la
 *               section directement)
 */

import React, { useEffect, useRef, useState } from 'react'
import { X as XIcon, Loader2, Wand2, Upload, Trash2 } from 'lucide-react'
import { runZImage } from '@/lib/comfyui-z-image'
import { supabase } from '@/lib/supabase'

type ItemType = 'soin' | 'mana' | 'arme' | 'armure' | 'outil' | 'quete' | 'grimoire' | 'plan'
type ItemCategory = 'persistant' | 'consommable' | 'arme'

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  soin: 'Soin',
  mana: 'Mana',
  arme: 'Arme',
  armure: 'Armure',
  outil: 'Outil',
  quete: 'Quête',
  grimoire: 'Grimoire',
  plan: 'Plan / Carte',
}

const ITEM_CAT_LABELS: Record<ItemCategory, string> = {
  persistant: 'Persistant (clé, médaillon)',
  consommable: 'Consommable (potion, lettre)',
  arme: 'Arme',
}

const STAT_OPTIONS = ['', 'force', 'agilite', 'intelligence', 'magie', 'chance', 'endurance']

export interface ItemFormData {
  id?: string                          // 'new' = création
  name: string
  item_type: ItemType
  category: ItemCategory
  weapon_type?: string | null
  description?: string | null
  illustration_url?: string | null
  detail_url?: string | null
  effect?: {
    hp_restore?: number
    mana_restore?: number
    stat?: string
    bonus?: number
    spell?: string
  }
  quantity?: number
  auto_pickup?: boolean
  sections_used?: string[]
}

interface ItemCreatorModalProps {
  open: boolean
  onClose: () => void
  /** Item à éditer. `id: 'new'` ou null = mode création. */
  editingItem: ItemFormData | null
  /** ID du livre — requis pour POST /api/books/{bookId}/items. */
  bookId: string
  /** Callback après save réussi. Reçoit l'item complet (avec id en mode création). */
  onSaved?: (item: ItemFormData & { id: string }) => void
  /** Préfixe Supabase Storage pour les uploads (Générer / Importer). */
  storagePathPrefix: string
}

export default function ItemCreatorModal({
  open, onClose, editingItem, bookId, onSaved, storagePathPrefix,
}: ItemCreatorModalProps) {
  const [form, setForm] = useState<ItemFormData>({
    name: '',
    item_type: 'outil',
    category: 'consommable',
    effect: {},
    quantity: 1,
    auto_pickup: false,
  })
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingLabel, setGeneratingLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Hydrate à l'ouverture (mode édition) ou reset (création)
  useEffect(() => {
    if (!open) return
    if (editingItem && editingItem.id && editingItem.id !== 'new') {
      setForm({
        ...editingItem,
        effect: editingItem.effect ?? {},
        quantity: editingItem.quantity ?? 1,
        auto_pickup: editingItem.auto_pickup ?? false,
      })
    } else {
      // Mode création : reset aux defaults MAIS préserve sections_used si
      // pré-rempli par le parent (ex: handleCreateItem injecte la section
      // courante pour que le nouvel item apparaisse direct dans le panel).
      setForm({
        id: editingItem?.id,  // 'new' ou undefined
        name: editingItem?.name ?? '',
        item_type: editingItem?.item_type ?? 'outil',
        category: editingItem?.category ?? 'consommable',
        sections_used: editingItem?.sections_used ?? [],
        effect: {},
        quantity: 1,
        auto_pickup: false,
      })
    }
  }, [open, editingItem])

  if (!open) return null

  const isNew = !form.id || form.id === 'new'
  const canSave = form.name.trim().length > 0 && !saving

  // ── Génération image objet (Z-Image preset fond gris isolé) ───────────
  async function handleGenerateImage() {
    if (!form.name.trim() || generating) return
    setGenerating(true)
    setGeneratingLabel('Préparation…')
    try {
      const promptParts = [
        form.name.trim(),
        form.description?.trim() ?? '',
        // Preset "objet isolé sur fond gris" — pour faciliter la mise en
        // calque lors de l'insertion Kontext multi-image.
        'isolated object centered on light gray studio background, no shadow on background, product photography, high detail, sharp focus',
      ].filter(Boolean)
      const prompt = promptParts.join(', ')
      const url = await runZImage({
        prompt,
        storagePathPrefix: `${storagePathPrefix}/items_gen/${Date.now()}`,
        width: 1024,
        height: 1024,
        onProgress: p => setGeneratingLabel(p.label ?? p.stage),
      })
      setForm(f => ({ ...f, illustration_url: url }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Génération échouée : ${msg}`)
    } finally {
      setGenerating(false)
      setGeneratingLabel('')
    }
  }

  // ── Upload depuis PC ──────────────────────────────────────────────────
  async function handleFileUpload(file: File) {
    if (!file || uploading) return
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
      const filePath = `${storagePathPrefix}/items_upload/${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('images')
        .upload(filePath, file, { contentType: file.type, upsert: false })
      if (error) throw new Error(error.message)
      const { data: { publicUrl } } = supabase.storage
        .from('images')
        .getPublicUrl(filePath)
      setForm(f => ({ ...f, illustration_url: publicUrl }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Upload échoué : ${msg}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        item_type: form.item_type,
        category: form.category,
        weapon_type: form.weapon_type ?? null,
        description: form.description?.trim() || null,
        illustration_url: form.illustration_url ?? null,
        detail_url: form.detail_url ?? null,
        effect: form.effect ?? {},
        quantity: form.quantity ?? 1,
        auto_pickup: !!form.auto_pickup,
        sections_used: form.sections_used ?? [],
      }
      let savedItem: (ItemFormData & { id: string }) | null = null
      if (isNew) {
        const res = await fetch(`/api/books/${bookId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json() as { item?: ItemFormData & { id: string }; error?: string }
        if (!res.ok || !data.item) throw new Error(data.error ?? 'POST failed')
        savedItem = data.item
      } else {
        const res = await fetch(`/api/items/${form.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json() as { success?: boolean; error?: string }
        if (!res.ok || !data.success) throw new Error(data.error ?? 'PATCH failed')
        savedItem = { ...form, id: form.id! }
      }
      onSaved?.(savedItem)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Sauvegarde échouée : ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="icm-overlay">
      <div className="icm-modal">
        <header className="icm-header">
          <h2 className="icm-title">{isNew ? 'Créer un objet' : 'Modifier l\'objet'}</h2>
          <button type="button" className="icm-close" onClick={onClose} aria-label="Fermer">
            <XIcon size={18} />
          </button>
        </header>

        <div className="icm-body">
          {/* Identité ----------------------------------------------- */}
          <section className="icm-section">
            <div className="icm-section-title">Identité</div>
            <label className="icm-field">
              <span className="icm-label">Nom *</span>
              <input
                type="text"
                className="icm-input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="ex: Enveloppe scellée de la Junte"
                autoFocus
              />
            </label>
            <div className="icm-row">
              <label className="icm-field" style={{ flex: 1 }}>
                <span className="icm-label">Type</span>
                <select
                  className="icm-input"
                  value={form.item_type}
                  onChange={e => setForm(f => ({ ...f, item_type: e.target.value as ItemType }))}
                >
                  {Object.entries(ITEM_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="icm-field" style={{ flex: 1 }}>
                <span className="icm-label">Catégorie</span>
                <select
                  className="icm-input"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value as ItemCategory }))}
                >
                  {Object.entries(ITEM_CAT_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
            </div>
            {form.item_type === 'arme' && (
              <label className="icm-field">
                <span className="icm-label">Type d&apos;arme</span>
                <input
                  type="text"
                  className="icm-input"
                  value={form.weapon_type ?? ''}
                  onChange={e => setForm(f => ({ ...f, weapon_type: e.target.value || null }))}
                  placeholder="ex: pistolet, batte, couteau"
                />
              </label>
            )}
          </section>

          {/* Visuel ------------------------------------------------- */}
          <section className="icm-section">
            <div className="icm-section-title">Image de l&apos;objet</div>
            {form.illustration_url ? (
              <div className="icm-image-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.illustration_url} alt="" />
                <button
                  type="button"
                  className="icm-image-remove"
                  onClick={() => setForm(f => ({ ...f, illustration_url: null }))}
                  title="Supprimer l'image"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <div className="icm-image-empty">Aucune image</div>
            )}
            <div className="icm-image-actions">
              <button
                type="button"
                className="icm-btn icm-btn-primary"
                onClick={() => void handleGenerateImage()}
                disabled={generating || uploading || !form.name.trim()}
                title={!form.name.trim() ? 'Renseigne d\'abord le nom' : 'Générer via Z-Image (~25s)'}
              >
                {generating ? (
                  <>
                    <Loader2 size={14} className="icm-spin" />
                    <span>{generatingLabel || 'Génération…'}</span>
                  </>
                ) : (
                  <>
                    <Wand2 size={14} />
                    <span>Générer</span>
                  </>
                )}
              </button>
              <label className="icm-btn icm-btn-ghost" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
                <Upload size={14} />
                <span>{uploading ? 'Upload…' : 'Importer'}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) void handleFileUpload(f)
                  }}
                  disabled={uploading || generating}
                />
              </label>
            </div>
          </section>

          {/* Description ------------------------------------------- */}
          <section className="icm-section">
            <div className="icm-section-title">Description</div>
            <textarea
              className="icm-input icm-textarea"
              value={form.description ?? ''}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description narrative de l'objet…"
              rows={3}
            />
          </section>

          {/* Gameplay ---------------------------------------------- */}
          <section className="icm-section">
            <div className="icm-section-title">Gameplay</div>
            <div className="icm-row">
              <label className="icm-field" style={{ flex: 1 }}>
                <span className="icm-label">HP rendu</span>
                <input
                  type="number"
                  className="icm-input"
                  value={form.effect?.hp_restore ?? ''}
                  onChange={e => setForm(f => ({
                    ...f,
                    effect: { ...f.effect, hp_restore: e.target.value === '' ? undefined : Number(e.target.value) },
                  }))}
                  placeholder="0"
                />
              </label>
              <label className="icm-field" style={{ flex: 1 }}>
                <span className="icm-label">Mana rendue</span>
                <input
                  type="number"
                  className="icm-input"
                  value={form.effect?.mana_restore ?? ''}
                  onChange={e => setForm(f => ({
                    ...f,
                    effect: { ...f.effect, mana_restore: e.target.value === '' ? undefined : Number(e.target.value) },
                  }))}
                  placeholder="0"
                />
              </label>
            </div>
            <div className="icm-row">
              <label className="icm-field" style={{ flex: 1 }}>
                <span className="icm-label">Stat boostée</span>
                <select
                  className="icm-input"
                  value={form.effect?.stat ?? ''}
                  onChange={e => setForm(f => ({
                    ...f,
                    effect: { ...f.effect, stat: e.target.value || undefined },
                  }))}
                >
                  {STAT_OPTIONS.map(s => (
                    <option key={s} value={s}>{s || '— aucune —'}</option>
                  ))}
                </select>
              </label>
              <label className="icm-field" style={{ flex: 1 }}>
                <span className="icm-label">Bonus</span>
                <input
                  type="number"
                  className="icm-input"
                  value={form.effect?.bonus ?? ''}
                  onChange={e => setForm(f => ({
                    ...f,
                    effect: { ...f.effect, bonus: e.target.value === '' ? undefined : Number(e.target.value) },
                  }))}
                  placeholder="0"
                  disabled={!form.effect?.stat}
                />
              </label>
            </div>
            <div className="icm-row">
              <label className="icm-field" style={{ flex: 1 }}>
                <span className="icm-label">Quantité</span>
                <input
                  type="number"
                  min={1}
                  className="icm-input"
                  value={form.quantity ?? 1}
                  onChange={e => setForm(f => ({ ...f, quantity: Math.max(1, Number(e.target.value) || 1) }))}
                />
              </label>
              <label className="icm-field icm-field-checkbox" style={{ flex: 1 }}>
                <input
                  type="checkbox"
                  checked={!!form.auto_pickup}
                  onChange={e => setForm(f => ({ ...f, auto_pickup: e.target.checked }))}
                />
                <span className="icm-label">Auto-pickup (ramassé sans clic)</span>
              </label>
            </div>
          </section>

          {/* Sections où l'objet apparaît (lecture seule V1) -------- */}
          {form.sections_used && form.sections_used.length > 0 && (
            <section className="icm-section">
              <div className="icm-section-title">Sections où il apparaît ({form.sections_used.length})</div>
              <div className="icm-sections-readonly">
                {form.sections_used.length} section(s) — édition depuis la fiche section.
              </div>
            </section>
          )}
        </div>

        <footer className="icm-footer">
          <button type="button" className="icm-btn icm-btn-ghost" onClick={onClose} disabled={saving}>
            Annuler
          </button>
          <button
            type="button"
            className="icm-btn icm-btn-primary"
            onClick={() => void handleSave()}
            disabled={!canSave}
          >
            {saving ? (
              <>
                <Loader2 size={14} className="icm-spin" />
                <span>Sauvegarde…</span>
              </>
            ) : (
              <span>{isNew ? 'Créer' : 'Enregistrer'}</span>
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
