'use client'
/**
 * Éditeur de composition pour panorama 360° (admin).
 *
 * Architecture "décor + acteurs + props" :
 *   - Décor = panorama 360° équirectangulaire 2048×1024 (ratio 2:1)
 *   - Acteurs = NPCs du livre (chacun identifié par son portrait_url)
 *   - Props = Items du livre (chacun identifié par son illustration_url)
 *
 * UX :
 *   - Pano affiché flat (étalé 2:1) — sera wrappé sur sphère côté player
 *   - Sidebar : liste des NPCs/Items disponibles avec thumbnails
 *   - Clic sur un NPC/Item → add au centre du pano avec scale 1
 *   - Drag pour repositionner, scroll pour resize, clic droit pour supprimer
 *
 * Conversion coords flat (pixels) ↔ sphériques (theta, phi) :
 *   theta = (x / panoWidth) × 360°        x = (theta / 360°) × panoWidth
 *   phi   = -((y / panoHeight) - 0.5) × 180°   y = (-phi/180° + 0.5) × panoHeight
 *
 * Note : le rendu final (sphère 3D avec sprites billboards) est fait côté
 * player via Three.js. Ici on est en vue flat pour édition.
 */
import React, { useRef, useState } from 'react'
import type { Npc, Item } from '@/types'
import type { SceneComposition, SceneNpcPlacement, SceneItemPlacement, NpcImageVariant } from '../types'
import { resolveNpcImageUrl, availableVariants } from '../helpers/npcImageVariant'
import Pano360Viewer from './Pano360Viewer'
import Pano360ObjectGen from './Pano360ObjectGen'
import Pano360Eraser from './Pano360Eraser'

/** Objet généré IA à la volée dans le compositeur (pas en DB). */
interface TempObject { id: string; name: string; url: string }

/** Shape de progress utilisée dans l'UI du composer (aligné sur BakeProgress du helper). */
interface BakeProgressUI {
  charName: string
  done: number
  total: number
  attempt?: number
  maxAttempts?: number
  lastScore?: number
}

export interface Pano360ComposerProps {
  /** URL du panorama équirectangulaire à composer. */
  panoramaUrl: string
  /** NPCs disponibles (filtré sur ceux avec portrait_url côté appelant). */
  npcs: Npc[]
  /** Items disponibles (filtré sur ceux avec illustration_url). */
  items: Item[]
  /** Composition initiale (si on édite une composition existante). */
  initial?: SceneComposition
  /** Préfixe Supabase pour images one-shot générées dans le compositeur
   *  (props IA, bake intermédiaires). */
  storagePathPrefix?: string
  /** Appelé au clic "Valider" (sprites composables côté player). */
  onSave: (composition: SceneComposition) => void
  /** Optionnel : appelé pour "baker" via IA. Le caller fournit l'implémentation
   *  (bakePanorama360) et renvoie l'URL de la version baked. */
  onBake?: (composition: SceneComposition, onProgress: (p: BakeProgressUI) => void) => Promise<string>
  /** Appelé après un bake réussi avec l'URL de la version baked + la composition. */
  onSaveBaked?: (bakedUrl: string, composition: SceneComposition) => void
  /** Optionnel : appelé quand l'utilisateur efface une zone via LAMA. Reçoit
   *  l'URL du nouveau pano (avec zone supprimée). Le parent doit mettre à jour
   *  son état pour que `panoramaUrl` prop bascule sur la nouvelle version. */
  onPanoramaReplaced?: (newPanoramaUrl: string) => void
  onCancel: () => void
}

type SelectedElement = { type: 'npc' | 'item'; index: number } | null

/** Convertit coords px (x,y) dans un pano de dimensions panoW×panoH en (theta, phi) sphériques. */
function pxToSpherical(x: number, y: number, panoW: number, panoH: number): { theta: number; phi: number } {
  const theta = (x / panoW) * 360
  const phi = -((y / panoH) - 0.5) * 180
  return { theta, phi }
}
/** Inverse de pxToSpherical. */
function sphericalToPx(theta: number, phi: number, panoW: number, panoH: number): { x: number; y: number } {
  const x = (theta / 360) * panoW
  const y = ((-phi / 180) + 0.5) * panoH
  return { x, y }
}

export default function Pano360Composer({ panoramaUrl, npcs, items, initial, storagePathPrefix, onSave, onBake, onSaveBaked, onPanoramaReplaced, onCancel }: Pano360ComposerProps) {
  const [composition, setComposition] = useState<SceneComposition>(initial ?? { npcs: [], items: [] })
  const [selected, setSelected] = useState<SelectedElement>(null)
  const [show3D, setShow3D] = useState(false)
  /** Objets générés IA dans le compositeur (vivants seulement dans la session). */
  const [tempObjects, setTempObjects] = useState<TempObject[]>([])
  /** Si true → affiche la modale Eraser (remplace le canvas). */
  const [erasing, setErasing] = useState(false)
  const [baking, setBaking] = useState(false)
  const [bakeProgress, setBakeProgress] = useState<BakeProgressUI | null>(null)
  const [bakeError, setBakeError] = useState<string | null>(null)
  /** URL de la version baked en cours de review (avant validation finale). */
  const [bakedPreviewUrl, setBakedPreviewUrl] = useState<string | null>(null)
  const panoRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startPxX: number; startPxY: number; startTheta: number; startPhi: number } | null>(null)

  async function handleBake() {
    if (!onBake) return
    if (composition.npcs.length === 0) { setBakeError('Place au moins un NPC avant de baker.'); return }
    setBakeError(null); setBaking(true); setBakeProgress({ charName: '', done: 0, total: composition.npcs.length })
    try {
      const bakedUrl = await onBake(composition, (p) => setBakeProgress(p))
      // Ne sauve PAS direct : affiche le preview → user valide ou rebake
      setBakedPreviewUrl(bakedUrl)
    } catch (err: unknown) {
      setBakeError(err instanceof Error ? err.message : String(err))
    } finally {
      setBaking(false)
      setBakeProgress(null)
    }
  }

  // Dimensions display (flat scaled)
  const [displayW, setDisplayW] = useState(0)
  const [displayH, setDisplayH] = useState(0)
  function onPanoLoad() {
    const img = panoRef.current
    if (!img) return
    setDisplayW(img.clientWidth)
    setDisplayH(img.clientHeight)
  }

  function addNpc(npc: Npc) {
    // Défaut : variant 'fullbody_gray' si dispo (mieux pour un placement au sol), sinon portrait
    const variants = availableVariants(npc)
    const defaultVariant: NpcImageVariant = variants.find(v => v.key === 'fullbody_gray') ? 'fullbody_gray'
      : variants.find(v => v.key === 'fullbody_scenic') ? 'fullbody_scenic'
      : 'portrait'
    setComposition(prev => ({
      ...prev,
      npcs: [...prev.npcs, { npc_id: npc.id, theta: 180, phi: 0, scale: 1, image_variant: defaultVariant }],
    }))
    setSelected({ type: 'npc', index: composition.npcs.length })
  }
  function addItem(item: Item) {
    setComposition(prev => ({
      ...prev,
      items: [...prev.items, { item_id: item.id, theta: 180, phi: -10, scale: 0.5 }],
    }))
    setSelected({ type: 'item', index: composition.items.length })
  }
  function addTempObject(obj: TempObject) {
    setComposition(prev => ({
      ...prev,
      items: [...prev.items, { item_id: obj.id, theta: 180, phi: -10, scale: 0.5, custom_url: obj.url, custom_name: obj.name }],
    }))
    setSelected({ type: 'item', index: composition.items.length })
  }
  function onObjectGenerated(url: string, name: string) {
    const obj: TempObject = { id: `temp_${Date.now()}`, name, url }
    setTempObjects(prev => [...prev, obj])
    addTempObject(obj)
  }

  /** Résout l'URL d'illustration d'un placement item (DB ou temp/custom). */
  function resolveItemUrl(p: SceneItemPlacement): string | undefined {
    if (p.custom_url) return p.custom_url
    return items.find(i => i.id === p.item_id)?.illustration_url ?? undefined
  }
  /** Résout le nom d'un placement item (DB ou custom). */
  function resolveItemName(p: SceneItemPlacement): string {
    if (p.custom_name) return p.custom_name
    return items.find(i => i.id === p.item_id)?.name ?? '?'
  }

  function updatePlacement(sel: NonNullable<SelectedElement>, patch: Partial<SceneNpcPlacement & SceneItemPlacement>) {
    setComposition(prev => {
      const next = { ...prev }
      if (sel.type === 'npc') next.npcs = next.npcs.map((p, i) => i === sel.index ? { ...p, ...patch } : p)
      else                    next.items = next.items.map((p, i) => i === sel.index ? { ...p, ...patch } : p)
      return next
    })
  }

  function removePlacement(sel: NonNullable<SelectedElement>) {
    setComposition(prev => {
      const next = { ...prev }
      if (sel.type === 'npc') next.npcs = next.npcs.filter((_, i) => i !== sel.index)
      else                    next.items = next.items.filter((_, i) => i !== sel.index)
      return next
    })
    setSelected(null)
  }

  function onMouseDownOnPlacement(e: React.MouseEvent, sel: NonNullable<SelectedElement>) {
    e.stopPropagation()
    setSelected(sel)
    const placement = sel.type === 'npc' ? composition.npcs[sel.index] : composition.items[sel.index]
    if (!placement) return
    dragRef.current = {
      startPxX: e.clientX,
      startPxY: e.clientY,
      startTheta: placement.theta,
      startPhi: placement.phi,
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current || !selected || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const drag = dragRef.current
    const dx = (e.clientX - drag.startPxX) / rect.width
    const dy = (e.clientY - drag.startPxY) / rect.height
    const newTheta = (drag.startTheta + dx * 360) % 360
    const newPhi = Math.max(-90, Math.min(90, drag.startPhi - dy * 180))
    updatePlacement(selected, { theta: (newTheta + 360) % 360, phi: newPhi })
  }
  function onMouseUp() { dragRef.current = null }

  /** Scroll sur un sprite → resize */
  function onWheelOnPlacement(e: React.WheelEvent, sel: NonNullable<SelectedElement>) {
    e.preventDefault()
    const placement = sel.type === 'npc' ? composition.npcs[sel.index] : composition.items[sel.index]
    if (!placement) return
    const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1
    updatePlacement(sel, { scale: Math.max(0.1, Math.min(3, placement.scale * delta)) })
  }

  // Tailles sprite en pixels sur le flat pano (scale 1 = 10% de la hauteur du pano)
  function spritePxSize(scale: number): number {
    return displayH * 0.10 * scale
  }

  // Vue dédiée au review du bake : user voit le résultat avant de valider/rebaker
  if (bakedPreviewUrl) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#e0a742', fontWeight: 'bold' }}>
          🎨 Preview du bake IA — persos intégrés dans la scène
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          Voici la version baked (persos insérés via SDXL inpaint + FaceID).
          Compare avec le pano d&apos;origine pour vérifier l&apos;intégration des persos
          (ombres, lumière, raccord). Valide pour sauver, ou re-baker avec ajustements.
        </div>

        {/* Comparaison flat original vs baked */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>🎬 Version baked (IA intégrée)</div>
          <div style={{ width: '100%', overflow: 'hidden', background: '#000', borderRadius: '4px', border: '2px solid #e0a742' }}>
            <img src={bakedPreviewUrl} alt="baked" style={{ display: 'block', width: '100%', height: 'auto' }} />
          </div>

          <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.4rem' }}>📷 Pano d&apos;origine (avant bake)</div>
          <div style={{ width: '100%', overflow: 'hidden', background: '#000', borderRadius: '4px', border: '1px solid var(--border)' }}>
            <img src={panoramaUrl} alt="original" style={{ display: 'block', width: '100%', height: 'auto', opacity: 0.7 }} />
          </div>
        </div>

        {/* Preview 3D du baked */}
        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.4rem' }}>🌐 Preview 3D du baked</div>
        <Pano360Viewer panoramaUrl={bakedPreviewUrl} height={380} />

        <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid var(--border)' }}>
          <button onClick={() => setBakedPreviewUrl(null)}
            style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer' }}>
            ← Retour compositeur
          </button>
          <button onClick={() => { setBakedPreviewUrl(null); void handleBake() }}
            style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
            ↻ Re-baker (nouveau seed)
          </button>
          <button onClick={() => onSaveBaked?.(bakedPreviewUrl, composition)}
            style={{ marginLeft: 'auto', background: '#e0a742', border: 'none', borderRadius: '4px', padding: '0.5rem 1.2rem', color: '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}>
            ✓ Valider ce bake
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
        Compose ta scène 360° : clique un NPC/Item dans la sidebar pour l&apos;ajouter, glisse pour repositionner, molette pour redimensionner, clic droit pour supprimer.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '0.8rem' }}>
        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--foreground)', fontWeight: 'bold' }}>🧍 NPCs ({npcs.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 220, overflowY: 'auto' }}>
            {npcs.length === 0 && <div style={{ fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucun NPC avec portrait.</div>}
            {npcs.map(n => (
              <button key={n.id} onClick={() => addNpc(n)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', cursor: 'pointer', fontSize: '0.65rem', textAlign: 'left' }}>
                {n.portrait_url && <img src={n.portrait_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />}
                <span style={{ flex: 1 }}>{n.name}</span>
                <span style={{ opacity: 0.5 }}>+</span>
              </button>
            ))}
          </div>

          <div style={{ fontSize: '0.7rem', color: 'var(--foreground)', fontWeight: 'bold', marginTop: '0.3rem' }}>📦 Objets ({items.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 160, overflowY: 'auto' }}>
            {items.length === 0 && <div style={{ fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucun Item avec illustration.</div>}
            {items.map(it => (
              <button key={it.id} onClick={() => addItem(it)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', cursor: 'pointer', fontSize: '0.65rem', textAlign: 'left' }}>
                {it.illustration_url && <img src={it.illustration_url} alt="" style={{ width: 24, height: 24, borderRadius: '3px', objectFit: 'cover' }} />}
                <span style={{ flex: 1 }}>{it.name}</span>
                <span style={{ opacity: 0.5 }}>+</span>
              </button>
            ))}
          </div>

          {/* Objets temporaires (IA, non persistés en DB) */}
          {tempObjects.length > 0 && (
            <>
              <div style={{ fontSize: '0.65rem', color: '#e0a742', fontWeight: 'bold', marginTop: '0.3rem' }}>✨ Props IA ({tempObjects.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 140, overflowY: 'auto' }}>
                {tempObjects.map(obj => (
                  <button key={obj.id} onClick={() => addTempObject(obj)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.4rem', borderRadius: '4px', border: '1px solid #e0a74266', background: 'rgba(224,167,66,0.08)', color: 'var(--foreground)', cursor: 'pointer', fontSize: '0.62rem', textAlign: 'left' }}>
                    <img src={obj.url} alt="" style={{ width: 24, height: 24, borderRadius: '3px', objectFit: 'cover' }} />
                    <span style={{ flex: 1 }}>{obj.name}</span>
                    <span style={{ opacity: 0.5 }}>+</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Générateur d'objets IA intégré */}
          {storagePathPrefix && (
            <Pano360ObjectGen
              storagePathPrefix={storagePathPrefix}
              onGenerated={onObjectGenerated}
            />
          )}

          {/* Panneau du sélectionné */}
          {selected && (() => {
            const p = selected.type === 'npc' ? composition.npcs[selected.index] : composition.items[selected.index]
            if (!p) return null
            const label = selected.type === 'npc'
              ? (npcs.find(n => n.id === (p as SceneNpcPlacement).npc_id)?.name ?? '?')
              : resolveItemName(p as SceneItemPlacement)
            return (
              <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'var(--surface-2)', borderRadius: '4px', border: '1px solid #b48edd66', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.62rem' }}>
                <div style={{ fontWeight: 'bold', color: '#b48edd' }}>✓ {label}</div>
                <div>θ : {Math.round(p.theta)}° · φ : {Math.round(p.phi)}°</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  Scale {p.scale.toFixed(2)}
                  <input type="range" min={0.1} max={3} step={0.05} value={p.scale}
                    onChange={e => updatePlacement(selected, { scale: Number(e.target.value) })}
                    style={{ flex: 1 }} />
                </label>
                {selected.type === 'npc' && (() => {
                  const npc = npcs.find(n => n.id === (p as SceneNpcPlacement).npc_id)
                  const variants = npc ? availableVariants(npc) : []
                  const currentVariant = (p as SceneNpcPlacement).image_variant ?? 'portrait'
                  const currentBakePrompt = (p as SceneNpcPlacement).bake_prompt ?? ''
                  return (
                    <>
                      {variants.length > 1 && (
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <span style={{ fontSize: '0.6rem', opacity: 0.75 }}>Image à utiliser</span>
                          <select
                            value={currentVariant}
                            onChange={e => updatePlacement(selected, { image_variant: e.target.value as NpcImageVariant })}
                            style={{ fontSize: '0.62rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.2rem 0.3rem', color: 'var(--foreground)' }}
                          >
                            {variants.map(v => (
                              <option key={v.key} value={v.key}>{v.label}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <input type="checkbox" checked={!!(p as SceneNpcPlacement).flip}
                          onChange={e => updatePlacement(selected, { flip: e.target.checked })} />
                        Retourner (flip)
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <span style={{ fontSize: '0.6rem', opacity: 0.75 }}>
                          Prompt baking (optionnel — override pose/action)
                        </span>
                        <textarea
                          value={currentBakePrompt}
                          onChange={e => updatePlacement(selected, { bake_prompt: e.target.value })}
                          placeholder={`ex: ${npc?.name ?? 'NPC'} debout sur une estrade, s'adresse à la foule, bras levé`}
                          rows={3}
                          style={{ fontSize: '0.58rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.25rem 0.3rem', color: 'var(--foreground)', fontFamily: 'inherit', resize: 'vertical' }}
                        />
                        <span style={{ fontSize: '0.54rem', opacity: 0.6, lineHeight: 1.3 }}>
                          Utilisé au moment du bake IA pour l&apos;inpaint SDXL. Si vide, prompt auto généré.
                        </span>
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <span style={{ fontSize: '0.6rem', opacity: 0.75 }}>
                          Prompt négatif baking (optionnel)
                        </span>
                        <textarea
                          value={(p as SceneNpcPlacement).bake_negative ?? ''}
                          onChange={e => updatePlacement(selected, { bake_negative: e.target.value })}
                          placeholder="ex: two men, duplicate figures, multiple protagonists, extra person"
                          rows={2}
                          style={{ fontSize: '0.58rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.25rem 0.3rem', color: 'var(--foreground)', fontFamily: 'inherit', resize: 'vertical' }}
                        />
                        <span style={{ fontSize: '0.54rem', opacity: 0.6, lineHeight: 1.3 }}>
                          Anti-tags au bake IA. Ex pour éviter 2 persos : <code>two men, duplicate, clones</code>.
                        </span>
                      </label>
                    </>
                  )
                })()}
                <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.2rem' }}>
                  <button onClick={() => setSelected(null)} style={{ flex: 1, fontSize: '0.58rem', padding: '0.25rem', borderRadius: '3px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
                    Désélectionner
                  </button>
                  <button onClick={() => removePlacement(selected)} style={{ flex: 1, fontSize: '0.58rem', padding: '0.25rem', borderRadius: '3px', border: '1px solid #c94c4c', background: 'rgba(201,76,76,0.1)', color: '#c94c4c', cursor: 'pointer' }}>
                    🗑 Retirer
                  </button>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Canvas pano flat + placements (ou preview 3D selon toggle) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Vue :</span>
            <button onClick={() => setShow3D(false)} disabled={erasing}
              style={{ fontSize: '0.62rem', padding: '0.25rem 0.6rem', borderRadius: '3px', border: `1px solid ${!show3D && !erasing ? '#b48edd' : 'var(--border)'}`, background: !show3D && !erasing ? 'rgba(180,142,221,0.15)' : 'var(--surface-2)', color: !show3D && !erasing ? '#b48edd' : 'var(--muted)', cursor: erasing ? 'not-allowed' : 'pointer', fontWeight: !show3D && !erasing ? 'bold' : 'normal', opacity: erasing ? 0.5 : 1 }}>📐 Flat (édition)</button>
            <button onClick={() => setShow3D(true)} disabled={erasing}
              style={{ fontSize: '0.62rem', padding: '0.25rem 0.6rem', borderRadius: '3px', border: `1px solid ${show3D && !erasing ? '#b48edd' : 'var(--border)'}`, background: show3D && !erasing ? 'rgba(180,142,221,0.15)' : 'var(--surface-2)', color: show3D && !erasing ? '#b48edd' : 'var(--muted)', cursor: erasing ? 'not-allowed' : 'pointer', fontWeight: show3D && !erasing ? 'bold' : 'normal', opacity: erasing ? 0.5 : 1 }}>🌐 3D (preview)</button>
            {onPanoramaReplaced && storagePathPrefix && (
              <button onClick={() => setErasing(e => !e)}
                title="Supprime un élément du pano via LAMA (CNN dédié). Ex : un lampadaire mal placé, un perso indésirable, un graffiti."
                style={{ fontSize: '0.62rem', padding: '0.25rem 0.6rem', borderRadius: '3px', border: `1px solid ${erasing ? '#52c484' : 'var(--border)'}`, background: erasing ? 'rgba(82,196,132,0.15)' : 'var(--surface-2)', color: erasing ? '#52c484' : 'var(--muted)', cursor: 'pointer', fontWeight: erasing ? 'bold' : 'normal', marginLeft: '0.3rem' }}>
                🧽 Effacer zone (LAMA)
              </button>
            )}
            <span style={{ fontSize: '0.58rem', color: 'var(--muted)', opacity: 0.7, marginLeft: '0.3rem' }}>
              {erasing ? 'Dessine la zone à effacer' : show3D ? 'Drag pour tourner · molette pour zoom' : 'Drag/molette sur un sprite pour le déplacer/resize'}
            </span>
          </div>

          {erasing && storagePathPrefix ? (
            <Pano360Eraser
              panoramaUrl={panoramaUrl}
              storagePathPrefix={storagePathPrefix}
              onErased={newUrl => {
                onPanoramaReplaced?.(newUrl)
                setErasing(false)
              }}
              onCancel={() => setErasing(false)}
            />
          ) : show3D ? (
            <Pano360Viewer
              panoramaUrl={panoramaUrl}
              composition={composition}
              npcs={npcs}
              items={items}
              height={480}
            />
          ) : (
        <div
          ref={containerRef}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', background: '#000', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <img
            ref={panoRef}
            src={panoramaUrl}
            alt="panorama 360"
            crossOrigin="anonymous"
            onLoad={onPanoLoad}
            draggable={false}
            style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none' }}
          />
          {/* Ligne horizon (phi=0) pour aider au placement */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />

          {/* Placements NPCs */}
          {composition.npcs.map((p, i) => {
            const pos = sphericalToPx(p.theta, p.phi, displayW || 1, displayH || 1)
            const size = spritePxSize(p.scale)
            const npc = npcs.find(n => n.id === p.npc_id)
            // Respecte la variante choisie (portrait / portrait_scenic / fullbody_gray / fullbody_scenic)
            // avec fallback automatique sur une variante dispo si la cible est vide.
            const spriteUrl = npc ? resolveNpcImageUrl(npc, p.image_variant) : null
            const sel = selected?.type === 'npc' && selected.index === i
            return (
              <div key={`npc-${i}`}
                onMouseDown={e => onMouseDownOnPlacement(e, { type: 'npc', index: i })}
                onWheel={e => onWheelOnPlacement(e, { type: 'npc', index: i })}
                onContextMenu={e => { e.preventDefault(); removePlacement({ type: 'npc', index: i }) }}
                style={{ position: 'absolute', left: pos.x - size * 0.3, top: pos.y - size * 0.8, width: size * 0.6, height: size, cursor: 'move', border: sel ? '2px solid #b48edd' : '1px dashed rgba(255,255,255,0.5)', background: spriteUrl ? `center/cover no-repeat url(${spriteUrl})` : '#808080', transform: p.flip ? 'scaleX(-1)' : undefined, borderRadius: '3px' }}
                title={`${npc?.name ?? 'NPC'} — θ:${Math.round(p.theta)}° φ:${Math.round(p.phi)}°${!spriteUrl ? ' — ⚠ pas d\'image' : ''}`}
              />
            )
          })}
          {/* Placements Items */}
          {composition.items.map((p, i) => {
            const pos = sphericalToPx(p.theta, p.phi, displayW || 1, displayH || 1)
            const size = spritePxSize(p.scale)
            const url = resolveItemUrl(p)
            const name = resolveItemName(p)
            const sel = selected?.type === 'item' && selected.index === i
            return (
              <div key={`item-${i}`}
                onMouseDown={e => onMouseDownOnPlacement(e, { type: 'item', index: i })}
                onWheel={e => onWheelOnPlacement(e, { type: 'item', index: i })}
                onContextMenu={e => { e.preventDefault(); removePlacement({ type: 'item', index: i }) }}
                style={{ position: 'absolute', left: pos.x - size * 0.4, top: pos.y - size * 0.4, width: size * 0.8, height: size * 0.8, cursor: 'move', border: sel ? '2px solid #e0a742' : '1px dashed rgba(255,255,255,0.5)', background: url ? `center/contain no-repeat url(${url})` : '#404040', borderRadius: '3px' }}
                title={`${name} — θ:${Math.round(p.theta)}° φ:${Math.round(p.phi)}°`}
              />
            )
          })}
        </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: '0.62rem', color: 'var(--muted)', opacity: 0.75, lineHeight: 1.4 }}>
        💡 Le rendu final (sphère 3D + sprites) sera visible dans le player. Ici c&apos;est la vue flat d&apos;édition. Place les acteurs près de la <strong>ligne d&apos;horizon</strong> (milieu) pour qu&apos;ils apparaissent au niveau des yeux dans le viewer.
      </div>

      {bakeError && <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px' }}>⚠ {bakeError}</div>}
      {baking && bakeProgress && (
        <div style={{ fontSize: '0.7rem', color: '#e0a742', padding: '0.5rem 0.7rem', background: 'rgba(224,167,66,0.1)', border: '1px solid #e0a74266', borderRadius: '4px' }}>
          🎨 Baking en cours… <strong>{bakeProgress.done}/{bakeProgress.total}</strong>
          {bakeProgress.charName ? ` · inpaint de « ${bakeProgress.charName} »` : ''}
          {bakeProgress.attempt && bakeProgress.maxAttempts && bakeProgress.maxAttempts > 1 ? (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.6rem', opacity: 0.9 }}>
              · essai {bakeProgress.attempt}/{bakeProgress.maxAttempts}
              {typeof bakeProgress.lastScore === 'number' && bakeProgress.lastScore >= 0 ? ` · meilleur score ${bakeProgress.lastScore}/10` : ''}
            </span>
          ) : null}
          <div style={{ fontSize: '0.58rem', opacity: 0.75, marginTop: '0.2rem' }}>
            Chaque perso prend ~30-60s d&apos;inpaint SDXL + FaceID. Juge Claude Vision vérifie la cohérence et retry si nécessaire.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={onCancel} disabled={baking} style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: baking ? 'wait' : 'pointer' }}>← Annuler</button>
        <div style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--muted)', alignSelf: 'center' }}>
          {composition.npcs.length} NPC{composition.npcs.length > 1 ? 's' : ''} · {composition.items.length} item{composition.items.length > 1 ? 's' : ''} placés
        </div>
        {onBake && onSaveBaked && (
          <button onClick={() => void handleBake()} disabled={baking || composition.npcs.length === 0}
            title="Intègre chaque NPC dans la scène via SDXL inpaint + FaceID (~30-60s par perso). Résultat final = pano avec persos VRAIMENT intégrés (ombres, lumière)."
            style={{ background: baking ? 'var(--surface-2)' : '#e0a742', border: 'none', borderRadius: '4px', padding: '0.5rem 1rem', color: baking ? 'var(--muted)' : '#0f0f14', fontSize: '0.72rem', fontWeight: 'bold', cursor: baking ? 'wait' : 'pointer', opacity: (baking || composition.npcs.length === 0) ? 0.5 : 1 }}>
            {baking ? '⏳ Baking…' : '🎨 Baker (intégrer via IA)'}
          </button>
        )}
        <button onClick={() => onSave(composition)} disabled={baking}
          style={{ background: '#b48edd', border: 'none', borderRadius: '4px', padding: '0.5rem 1.2rem', color: '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: baking ? 'wait' : 'pointer', opacity: baking ? 0.5 : 1 }}>
          ✓ Valider la composition (sprites)
        </button>
      </div>
    </div>
  )
}
