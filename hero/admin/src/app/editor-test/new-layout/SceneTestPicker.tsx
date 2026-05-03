'use client'
/**
 * SceneTestPicker — entrée du banc de test du nouveau Designer.
 *
 * Affiche les 12 scènes preset (depuis test-scenes.json) en grille.
 * Click → ouvre le Designer avec le prompt pré-rempli pour cette scène.
 * Si la scène a déjà été sauvegardée (Ctrl+S / Commencer), badge "Généré · X".
 * Bouton ✕ pour wipe la sauvegarde.
 *
 * Port du legacy /editor-test/page.tsx vers le nouveau Designer 2-phases.
 */

import React, { useEffect, useState } from 'react'
import testScenesData from '@/data/test-scenes.json'
import type { DesignerVariant } from '@/components/image-editor/designer/types'
import type { EditorLayer } from '@/components/image-editor/types'

// ── Types ────────────────────────────────────────────────────────────────

export interface TestScene {
  id: string
  name: string
  prompt: string
  negative: string
  usage: string[]
}

export interface SavedSceneState {
  /** URL de l'image base sélectionnée et committée par Commencer */
  committedImageUrl: string | null
  /** Variantes générées/banque pendant la session (sérialisées) */
  variants: DesignerVariant[]
  /** ID de la variante sélectionnée au moment du save */
  selectedVariantId: string | null
  /** Calques d'édition (Phase B) — atmosphère, découpe, etc. */
  layers: EditorLayer[]
  /** Phase du Designer (creation / editing) au save */
  phase: 'creation' | 'editing'
  /** Timestamp ms */
  savedAt: number
}

const SCENES: TestScene[] = testScenesData.scenes

// ── localStorage helpers (clés dz_test_v1_scene_<id>) ────────────────────

const STORAGE_PREFIX = 'dz_test_v1_scene_'
/** Préfixe legacy de l'ancien /editor-test (à migrer une fois). */
const LEGACY_PREFIX = 'ie_test_v1_scene_'

export function loadSceneState(sceneId: string): SavedSceneState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sceneId)
    return raw ? JSON.parse(raw) as SavedSceneState : null
  } catch {
    return null
  }
}

export function saveSceneState(sceneId: string, state: Omit<SavedSceneState, 'savedAt'>): SavedSceneState {
  const full: SavedSceneState = { ...state, savedAt: Date.now() }
  if (typeof window === 'undefined') return full
  try {
    localStorage.setItem(STORAGE_PREFIX + sceneId, JSON.stringify(full))
  } catch (err) {
    console.warn('[scene-picker] save failed:', err)
  }
  return full
}

export function clearSceneState(sceneId: string) {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_PREFIX + sceneId)
}

/** Migration des sauvegardes legacy /editor-test vers le nouveau format.
 * Convertit les clés ie_test_v1_scene_* (imageUrl + layers + savedAt) vers
 * dz_test_v1_scene_* (committedImageUrl + layers + variants + phase=editing).
 * Ne touche PAS aux clés legacy (laissées intactes pour rollback éventuel).
 * N'écrase JAMAIS un nouveau save existant (priorité au state actuel).
 * À appeler au mount du picker. */
export function migrateLegacySceneSaves(): { migrated: number; skipped: number } {
  if (typeof window === 'undefined') return { migrated: 0, skipped: 0 }
  let migrated = 0
  let skipped = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(LEGACY_PREFIX)) continue
      const sceneId = key.slice(LEGACY_PREFIX.length)
      const newKey = STORAGE_PREFIX + sceneId
      // Si déjà migré (nouveau save existe) → skip pour ne pas écraser
      if (localStorage.getItem(newKey) !== null) { skipped++; continue }
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const legacy = JSON.parse(raw) as { imageUrl?: string; layers?: EditorLayer[]; savedAt: number }
      // Construit une variante "image restaurée" pour qu'elle apparaisse dans
      // le strip si l'utilisateur revient en Phase A.
      const restoredVariant: DesignerVariant = {
        id: `legacy-${sceneId}`,
        url: legacy.imageUrl ?? null,
        stage: 'done',
        label: 'Image legacy',
        source: { kind: 'generated', modelKey: 'legacy', modelLabel: 'Restaurée du test legacy' },
        isReference: false,
        addedAt: legacy.savedAt,
      }
      const newState: SavedSceneState = {
        committedImageUrl: legacy.imageUrl ?? null,
        variants: legacy.imageUrl ? [restoredVariant] : [],
        selectedVariantId: legacy.imageUrl ? restoredVariant.id : null,
        layers: legacy.layers ?? [],
        // Si une image était committée → on entre directement en Phase B
        // (édition restaurée). Sinon en creation.
        phase: legacy.imageUrl ? 'editing' : 'creation',
        savedAt: legacy.savedAt,
      }
      localStorage.setItem(newKey, JSON.stringify(newState))
      migrated++
      console.log('[scene-picker] migrated', sceneId, '→', newKey)
    }
  } catch (err) {
    console.warn('[scene-picker] migration failed:', err)
  }
  return { migrated, skipped }
}

/** Helper rendu humain du timestamp ("il y a 2h", "il y a 1j") */
export function timeAgo(ts: number): string {
  const ms = Date.now() - ts
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}j`
}

// ── Composant ─────────────────────────────────────────────────────────────

interface SceneTestPickerProps {
  /** Callback quand l'utilisateur sélectionne une scène (avec son éventuel state sauvegardé) */
  onPick: (scene: TestScene, saved: SavedSceneState | null) => void
}

export default function SceneTestPicker({ onPick }: SceneTestPickerProps) {
  // savedStates : map scene.id → SavedSceneState (présent uniquement si sauvegardé)
  const [savedStates, setSavedStates] = useState<Record<string, SavedSceneState>>({})

  // Hydrate les états depuis localStorage au mount, AVEC migration legacy
  useEffect(() => {
    // 1. Migre les anciennes clés ie_test_v1_scene_* (silencieux si rien à faire)
    const migration = migrateLegacySceneSaves()
    if (migration.migrated > 0) {
      console.log(`[scene-picker] ${migration.migrated} sauvegarde(s) legacy migrée(s) (${migration.skipped} ignorée(s) car déjà présentes)`)
    }
    // 2. Hydrate l'état du picker depuis le nouveau format
    const next: Record<string, SavedSceneState> = {}
    for (const scene of SCENES) {
      const saved = loadSceneState(scene.id)
      if (saved) next[scene.id] = saved
    }
    setSavedStates(next)
  }, [])

  function handleWipe(e: React.MouseEvent, scene: TestScene) {
    e.stopPropagation()
    if (!confirm(`Effacer la sauvegarde "${scene.name}" ?`)) return
    clearSceneState(scene.id)
    setSavedStates(prev => {
      const next = { ...prev }
      delete next[scene.id]
      return next
    })
  }

  return (
    <div className="dz-scene-picker">
      <div className="dz-scene-picker-inner">
        <header className="dz-scene-picker-header">
          <h1>Studio Designer — Banc de test</h1>
          <p>
            <strong>Ctrl+S ou bouton Commencer</strong> sauvegarde ta session en localStorage.
            Tu retrouves les variantes, l&apos;image sélectionnée et la phase au prochain clic.
          </p>
        </header>

        <h2 className="dz-scene-picker-title">
          {SCENES.length} scènes génériques
        </h2>
        <p className="dz-scene-picker-sub">
          Couvrent le spectre produit (extérieur/intérieur, jour/nuit, moderne/fantasy/sci-fi).
          Clique sur une scène → le prompt SDXL est pré-rempli dans le Designer.
        </p>

        <div className="dz-scene-grid">
          {SCENES.map(scene => {
            const saved = savedStates[scene.id]
            return (
              <div key={scene.id} className="dz-scene-card-wrap">
                <button
                  type="button"
                  className={`dz-scene-card ${saved ? 'saved' : ''}`}
                  onClick={() => onPick(scene, saved ?? null)}
                >
                  <div className="dz-scene-card-name">
                    {saved && '💾 '}{scene.name}
                  </div>
                  <div className="dz-scene-card-id">{scene.id}</div>
                  {saved ? (
                    <div className="dz-scene-card-meta saved">
                      Généré · il y a {timeAgo(saved.savedAt)}
                    </div>
                  ) : (
                    <div className="dz-scene-card-meta">Prompt prêt, clique pour ouvrir</div>
                  )}
                </button>

                {/* Bouton wipe en dehors de la card pour éviter <button> imbriqué */}
                {saved && (
                  <button
                    type="button"
                    className="dz-scene-card-wipe"
                    onClick={(e) => handleWipe(e, scene)}
                    title="Effacer cette sauvegarde"
                    aria-label="Effacer"
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
