'use client'
/**
 * Fold « Atmosphère » — overlay météo / effets d'ambiance pleine scène ou zone.
 *
 * Layout : sections collapsibles pour éviter le bruit visuel. Chaque section
 * regroupe des paramètres cohérents :
 *   - « Paramètres <kind> » : densité, vitesse, inclinaison, trailLength…
 *   - « Zone » : full / rect / pinceau pour la zone principale
 *   - « Impacts au sol » (rain only) : toggle + niveau sol + taille + intensité
 *     + sous-toggles (éclaboussures, flash) + zone dédiée (couleur orange)
 *
 * Pas de bake IA, rendu live à 60 fps via ParticleLayer.
 */
import React, { useState } from 'react'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { Trash2, Square, Paintbrush, Maximize2, ChevronDown, Undo2, Plus } from 'lucide-react'
import { useEditorState } from '../EditorStateContext'
import { WEATHER_PRESETS, type WeatherPreset, type WeatherZone, type WeatherParams, type ImpactZoneEntry, type ImpactSurface } from '../types'

export default function FoldAtmosphere() {
  const { layers, activeLayerIdx, addLayer } = useEditorState()
  const activeLayer = layers[activeLayerIdx]
  const isActiveWeather = !!activeLayer?.weather

  if (isActiveWeather && activeLayer?.weather) {
    return <WeatherLayerPanel />
  }

  // Picker presets (calque non-météo actif)
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: 'var(--ie-space-2)',
    }}>
      {WEATHER_PRESETS.map(preset => (
        <motion.button
          key={preset.key}
          onClick={() => addWeatherLayer(preset, addLayer)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          title={preset.hint}
          style={{
            padding: 'var(--ie-space-3) var(--ie-space-2)',
            background: 'var(--ie-surface-2)',
            color: 'var(--ie-text)',
            border: '1px solid var(--ie-border)',
            borderRadius: 'var(--ie-radius)',
            cursor: 'pointer',
            fontSize: 'var(--ie-text-sm)',
            fontWeight: 500,
            fontFamily: 'inherit',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--ie-space-1)',
            transition: 'all var(--ie-transition)',
          }}
        >
          <span style={{ fontSize: '1.75em', lineHeight: 1 }}>{preset.icon}</span>
          <span>{preset.label}</span>
        </motion.button>
      ))}
    </div>
  )
}

// Exporté pour être réutilisé par le nouveau DesignerCatalog (catégorie Effets)
// sans dupliquer la logique d'ajout d'un calque météo.
export function addWeatherLayer(preset: WeatherPreset, addLayer: ReturnType<typeof useEditorState>['addLayer']) {
  addLayer({
    name: preset.label,
    type: 'image',
    visible: true,
    opacity: preset.defaultOpacity,
    blend: 'normal',
    weather: {
      ...preset.defaults,
      preset: preset.key,  // référence stable pour retrouver l'icône
      zone: {
        ...preset.defaults.zone,
        strokes: preset.defaults.zone.strokes ? [...preset.defaults.zone.strokes] : undefined,
      },
    },
  })
}

// ── Panel pour calque météo actif ────────────────────────────────────────

type SectionId = 'params' | 'impacts'

function WeatherLayerPanel() {
  const { layers, activeLayerIdx, updateLayer, setEditingWeatherZone } = useEditorState()
  // Accordion : 1 seule section ouverte à la fois. Toutes fermées à l'arrivée
  // sur un calque météo (null = rien d'ouvert).
  const [openSection, setOpenSection] = useState<SectionId | null>(null)
  const toggleSection = (id: SectionId) => setOpenSection(prev => (prev === id ? null : id))

  // Quand le calque actif change (ex : user clique sur un autre onglet météo),
  // on re-ferme tout pour un état propre.
  const layerUid = layers[activeLayerIdx]?._uid
  React.useEffect(() => { setOpenSection(null) }, [layerUid])

  const activeLayer = layers[activeLayerIdx]
  if (!activeLayer?.weather) return null
  const weather = activeLayer.weather
  const kind = weather.kind

  function patchWeather(patch: Partial<WeatherParams>) {
    updateLayer(activeLayerIdx, { weather: { ...weather, ...patch } })
  }

  const kindLabel =
    kind === 'rain' ? 'pluie'
    : kind === 'snow' ? 'neige'
    : kind === 'fog' ? 'brouillard'
    : kind === 'lightning' ? 'éclairs'
    : 'nuages'

  // Lightning : panneau dédié (pas de density/speed/angle qui n'ont pas de sens)
  if (kind === 'lightning') {
    return <LightningPanel weather={weather} patchWeather={patchWeather} activeLayer={activeLayer} layerIdx={activeLayerIdx} updateLayer={updateLayer} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)' }}>
      {/* Section 1 : Paramètres du kind */}
      <Section
        title={`Paramètres ${kindLabel}`}
        open={openSection === 'params'}
        onToggle={() => toggleSection('params')}
      >
        <Slider
          label={
            kind === 'fog' ? 'Nombre de volutes'
            : kind === 'cloud' ? 'Nombre de nuages'
            : 'Densité'
          }
          value={weather.density}
          min={kind === 'fog' || kind === 'cloud' ? 2 : 20}
          max={kind === 'fog' ? 20 : kind === 'cloud' ? 15 : 500}
          step={kind === 'fog' || kind === 'cloud' ? 1 : 10}
          display={Math.round(weather.density).toString()}
          onChange={v => patchWeather({ density: v })}
        />
        <Slider
          label="Vitesse"
          value={weather.speed}
          min={kind === 'fog' || kind === 'cloud' ? 0.1 : 0.25}
          max={kind === 'fog' || kind === 'cloud' ? 1 : 2}
          step={0.05}
          display={`${weather.speed.toFixed(2)}×`}
          onChange={v => patchWeather({ speed: v })}
        />
        {kind !== 'fog' && kind !== 'cloud' && (
          <Slider
            label="Inclinaison (vent)"
            value={weather.angle}
            min={-45} max={45} step={1}
            display={`${weather.angle > 0 ? '+' : ''}${weather.angle}°`}
            onChange={v => patchWeather({ angle: v })}
          />
        )}
        {(kind === 'fog' || kind === 'cloud') && (
          <>
            <Subfield label="Direction">
              <div style={toggleGroupStyle()}>
                <ToggleBtn active={!weather.reverse} onClick={() => patchWeather({ reverse: false })} label="→ Droite" />
                <ToggleBtn active={!!weather.reverse} onClick={() => patchWeather({ reverse: true })} label="← Gauche" />
              </div>
            </Subfield>
            <Slider
              label="Inclinaison"
              value={weather.angle}
              min={-30} max={30} step={1}
              display={`${weather.angle > 0 ? '+' : ''}${weather.angle}°`}
              onChange={v => patchWeather({ angle: v })}
            />
          </>
        )}
        {kind === 'rain' && (
          <Slider
            label="Longueur des traits"
            value={weather.trailLength ?? 14}
            min={4} max={40} step={1}
            display={`${weather.trailLength ?? 14} px`}
            onChange={v => patchWeather({ trailLength: v })}
          />
        )}
        <Slider
          label={
            weather.kind === 'rain'  ? 'Opacité de la pluie' :
            weather.kind === 'snow'  ? 'Opacité de la neige' :
            weather.kind === 'fog'   ? 'Opacité du brouillard' :
            weather.kind === 'cloud' ? 'Opacité des nuages' :
                                       'Opacité de l’effet'
          }
          value={weather.particleOpacity ?? 1}
          min={0.1} max={1} step={0.05}
          display={`${Math.round((weather.particleOpacity ?? 1) * 100)}%`}
          onChange={v => patchWeather({ particleOpacity: v })}
        />
        {/* Perspective profondeur */}
        <Subfield label="Perspective profondeur">
          <Checkbox
            checked={weather.depthEnabled ?? false}
            onChange={v => patchWeather({ depthEnabled: v })}
            label={weather.depthEnabled ? 'Activée' : 'Désactivée'}
          />
        </Subfield>
        {weather.depthEnabled && (
          <Slider
            label="Intensité profondeur"
            value={weather.depthStrength ?? 0.5}
            min={0} max={1} step={0.05}
            display={`${Math.round((weather.depthStrength ?? 0.5) * 100)}%`}
            onChange={v => patchWeather({ depthStrength: v })}
          />
        )}

        {/* Zone de l'effet principal — sous-bloc DANS la section Paramètres */}
        <InlineZoneBlock
          title={`Zone ${kindLabel}`}
          zone={weather.zone}
          onZoneChange={z => patchWeather({ zone: z })}
          onFocusEdit={() => setEditingWeatherZone('main')}
          colorHex="#4ed5d5"
          hideSizeSlider
        />
      </Section>

      {/* Section 2 : Impacts au sol (rain only, collapsible).
          Chaque zone d'impact a ses PROPRES params (taille/intensité/splash/
          flash) → flaque, pavé, herbe ont chacun leur comportement. Plus de
          sliders globaux au niveau de la section. */}
      {kind === 'rain' && (
        <Section
          title="Paramètres gouttes"
          open={openSection === 'impacts'}
          onToggle={() => toggleSection('impacts')}
        >
          <Subfield label="Activer les ploc ploc">
            <Checkbox
              checked={weather.impactEnabled ?? false}
              onChange={v => patchWeather({ impactEnabled: v })}
              label={weather.impactEnabled ? 'Activés' : 'Désactivés'}
            />
          </Subfield>
          {weather.impactEnabled && (
            <ImpactZonesList
              zones={weather.impactZones ?? []}
              onZonesChange={zones => patchWeather({ impactZones: zones })}
              /* Fallback values héritées des anciens champs globaux pour les
                 nouvelles zones créées (backward compat). */
              defaultSize={weather.impactSize ?? 1.8}
              defaultIntensity={weather.impactIntensity ?? 0.7}
              defaultSplash={weather.impactSplash ?? true}
              defaultFlash={weather.impactFlash ?? false}
            />
          )}
        </Section>
      )}

    </div>
  )
}

// ── ImpactZonesList : liste de zones d'impact (multi-surface) ────────────

const SURFACE_OPTIONS: { value: ImpactSurface; label: string; icon: string }[] = [
  { value: 'water', label: 'Eau / flaque', icon: '💧' },
  { value: 'hard',  label: 'Dur (pavé, pierre)', icon: '🪨' },
  { value: 'soft',  label: 'Absorbant (herbe, tissu)', icon: '🌱' },
  { value: 'glass', label: 'Vitre (gouttes qui glissent)', icon: '🪟' },
]

function surfaceLabel(s: ImpactSurface): string {
  return SURFACE_OPTIONS.find(o => o.value === s)?.label ?? s
}
function surfaceIcon(s: ImpactSurface): string {
  return SURFACE_OPTIONS.find(o => o.value === s)?.icon ?? '•'
}

function genZoneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `iz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

interface ImpactZonesListProps {
  zones: ImpactZoneEntry[]
  onZonesChange: (next: ImpactZoneEntry[]) => void
  defaultSize: number
  defaultIntensity: number
  defaultSplash: boolean
  defaultFlash: boolean
}

function ImpactZonesList({
  zones, onZonesChange, defaultSize, defaultIntensity, defaultSplash, defaultFlash,
}: ImpactZonesListProps) {
  const { activeImpactZoneId, setEditingWeatherZone } = useEditorState()

  function addZone() {
    const newZone: ImpactZoneEntry = {
      id: genZoneId(),
      surface: 'water',
      zone: { mode: 'brush', strokes: [], brushSize: 0.015, brushMode: 'paint' },
      size: defaultSize,
      intensity: defaultIntensity,
      splash: defaultSplash,
      flash: defaultFlash,
    }
    onZonesChange([...zones, newZone])
    setEditingWeatherZone('impact', newZone.id)  // auto-open + edit
  }
  function removeZone(id: string) {
    onZonesChange(zones.filter(z => z.id !== id))
    if (activeImpactZoneId === id) setEditingWeatherZone('main')
  }
  function updateZone(id: string, patch: Partial<ImpactZoneEntry>) {
    onZonesChange(zones.map(z => z.id === id ? { ...z, ...patch } : z))
  }
  function toggleOpen(id: string) {
    if (activeImpactZoneId === id) setEditingWeatherZone('main')
    else setEditingWeatherZone('impact', id)
  }

  // État vide : un gros bouton central pour amorcer
  if (zones.length === 0) {
    return (
      <motion.button
        onClick={addZone}
        whileTap={{ scale: 0.97 }}
        style={{
          padding: 'var(--ie-space-4)',
          borderRadius: 'var(--ie-radius-md)',
          background: hexToRgba('#F59E0B', 0.08),
          border: `1px dashed ${hexToRgba('#F59E0B', 0.45)}`,
          color: '#B45309',
          fontSize: 'var(--ie-text-sm)',
          fontWeight: 600,
          fontFamily: 'inherit',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-2)',
        }}
      >
        <Plus size={14} /> Ajouter une zone d&apos;impact
      </motion.button>
    )
  }

  // Une ou plusieurs zones : accordion + drag-and-drop pour réordonner.
  // Convention : ordre dans la liste = z-order (premier = au-dessus, comme
  // les calques additionnels dans LayerTabs). Le rendu (Canvas + ParticleLayer)
  // respecte cet ordre.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)' }}>
      <Reorder.Group
        axis="y"
        values={zones}
        onReorder={onZonesChange}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)', listStyle: 'none', padding: 0, margin: 0 }}
      >
        {zones.map(z => (
          <ImpactZoneCard
            key={z.id}
            entry={z}
            isOpen={activeImpactZoneId === z.id}
            onToggleOpen={() => toggleOpen(z.id)}
            onUpdate={patch => updateZone(z.id, patch)}
            onRemove={() => removeZone(z.id)}
          />
        ))}
      </Reorder.Group>
      <motion.button
        onClick={addZone}
        whileTap={{ scale: 0.97 }}
        style={{
          marginTop: 'var(--ie-space-1)',
          padding: 'var(--ie-space-2)',
          borderRadius: 'var(--ie-radius-sm)',
          background: 'transparent',
          border: '1px dashed var(--ie-border-strong)',
          color: 'var(--ie-text-muted)',
          fontSize: 'var(--ie-text-xs)',
          fontWeight: 500,
          fontFamily: 'inherit',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-1)',
        }}
      >
        <Plus size={12} /> Ajouter une zone
      </motion.button>
    </div>
  )
}

function ImpactZoneCard({
  entry, isOpen, onToggleOpen, onUpdate, onRemove,
}: {
  entry: ImpactZoneEntry
  isOpen: boolean
  onToggleOpen: () => void
  onUpdate: (patch: Partial<ImpactZoneEntry>) => void
  onRemove: () => void
}) {
  const isSoft = entry.surface === 'soft'
  // dragControls + dragListener=false : seul le handle (⋮⋮) lance le drag,
  // pas le clic n'importe où. Même pattern que LayerTabs.LayerTab.
  const dragControls = useDragControls()
  return (
    <Reorder.Item
      as="div"
      value={entry}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={{ zIndex: 10, scale: 1.01, boxShadow: '0 4px 12px rgba(0,0,0,0.18)' }}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      style={{
        borderRadius: 'var(--ie-radius-md)',
        // Bordure neutre pour toutes les zones, accent orange uniquement sur la
        // barre verticale gauche quand la zone est active (style "tab actif"
        // VSCode/Notion) — moins de bruit visuel qu'un encadré complet jaune.
        border: '1px solid var(--ie-border)',
        borderLeftWidth: '3px',
        borderLeftColor: isOpen ? '#F59E0B' : 'var(--ie-border)',
        background: 'var(--ie-surface)',
        overflow: 'hidden',
        transition: 'all var(--ie-transition)',
        listStyle: 'none',
      }}>
      {/* Header (toujours visible, clic = ouvre/ferme). Handle drag à gauche. */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div
          onPointerDown={(e) => dragControls.start(e)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 16,
            cursor: 'grab',
            color: 'var(--ie-text-faint)',
            flexShrink: 0,
            background: 'transparent',
            userSelect: 'none',
          }}
          title="Glisser pour réordonner"
        >
          <span style={{ fontSize: 10, lineHeight: 1, letterSpacing: -2 }}>⋮⋮</span>
        </div>
        <motion.button
          onClick={onToggleOpen}
          whileHover={{ x: 2 }}
          whileTap={{ scale: 0.98 }}
          style={{
            flex: 1,
            display: 'flex', alignItems: 'center', gap: 'var(--ie-space-2)',
            padding: 'var(--ie-space-2) var(--ie-space-3) var(--ie-space-2) 0',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: '1.15em', lineHeight: 1, flexShrink: 0 }}>{surfaceIcon(entry.surface)}</span>
          <span style={{
            flex: 1,
            fontSize: 'var(--ie-text-sm)',
            color: 'var(--ie-text)',
            fontWeight: isOpen ? 600 : 500,
          }}>
            {surfaceLabel(entry.surface)}
          </span>
          <motion.span
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            style={{ display: 'flex', alignItems: 'center', color: 'var(--ie-text-faint)', flexShrink: 0 }}
          >
            <ChevronDown size={14} />
          </motion.span>
        </motion.button>
      </div>

      {/* Corps déplié */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: 'var(--ie-space-3)',
              paddingTop: 0,
              display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)',
              borderTop: '1px solid var(--ie-border)',
            }}>
              {/* Type de surface */}
              <Subfield label="Type de surface">
                <select
                  value={entry.surface}
                  onChange={e => onUpdate({ surface: e.target.value as ImpactSurface })}
                  style={{
                    padding: 'var(--ie-space-1) var(--ie-space-2)',
                    background: 'var(--ie-surface-2)',
                    border: '1px solid var(--ie-border)',
                    borderRadius: 'var(--ie-radius-sm)',
                    color: 'var(--ie-text)',
                    fontSize: 'var(--ie-text-xs)',
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {SURFACE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
                  ))}
                </select>
              </Subfield>

              <GroupTitle label="Dessin de la zone" />
              {/* Masque géométrique */}
              <Subfield label="Zone d'application">
                <ZoneControls
                  zone={entry.zone}
                  onZoneChange={z => onUpdate({ zone: z })}
                  onFocusEdit={() => { /* déjà focus via isOpen */ }}
                  colorHex="#F59E0B"
                />
              </Subfield>

              {/* Params per-surface : masqués si 'soft' (aucun effet visible) */}
              {!isSoft && (
                <>
                  <GroupTitle label="Effet visuel" />
                  {entry.surface === 'hard' ? (
                    <Slider
                      label="Taille de la pointe"
                      value={entry.size ?? 4.5}
                      min={0.1} max={5} step={0.1}
                      display={`${(entry.size ?? 4.5).toFixed(1)} px`}
                      onChange={v => onUpdate({ size: v })}
                    />
                  ) : entry.surface === 'glass' ? (
                    <Slider
                      label="Taille des gouttes"
                      value={entry.size ?? 1.8}
                      min={0.5} max={10} step={0.1}
                      display={`${(entry.size ?? 1.8).toFixed(1)} px`}
                      onChange={v => onUpdate({ size: v })}
                    />
                  ) : (
                    <Slider
                      label="Taille du ploc"
                      value={entry.size ?? 1.8}
                      min={0.5} max={10} step={0.1}
                      display={`${(entry.size ?? 1.8).toFixed(1)} px`}
                      onChange={v => onUpdate({ size: v })}
                    />
                  )}
                  <Slider
                    label="Intensité"
                    value={entry.intensity ?? 0.7}
                    min={0.1} max={1} step={0.05}
                    display={`${Math.round((entry.intensity ?? 0.7) * 100)}%`}
                    onChange={v => onUpdate({ intensity: v })}
                  />
                  {/* Opacité visuelle de l'effet, applicable à toutes surfaces.
                       Pour glass : opacity CSS sur le wrapper. Pour les autres :
                       multiplicateur d'alpha sur les anneaux/éclats/gouttelettes. */}
                  <Slider
                    label="Opacité de l’effet"
                    value={entry.opacity ?? entry.glassOpacity ?? 1}
                    min={0} max={1} step={0.05}
                    display={`${Math.round((entry.opacity ?? entry.glassOpacity ?? 1) * 100)}%`}
                    onChange={v => onUpdate({ opacity: v })}
                  />
                  {entry.surface === 'glass' && (
                    <>
                      <Slider
                        label="Vitesse de chute"
                        value={entry.glassSpeed ?? 0.80}
                        min={0.2} max={3} step={0.05}
                        display={`${(entry.glassSpeed ?? 0.80).toFixed(2)}×`}
                        onChange={v => onUpdate({ glassSpeed: v })}
                      />
                      <Slider
                        label="Flou (vitre dépolie)"
                        value={entry.glassBlur ?? 20}
                        min={0} max={50} step={1}
                        display={`${entry.glassBlur ?? 20}`}
                        onChange={v => onUpdate({ glassBlur: v })}
                      />
                    </>
                  )}
                  <GroupTitle label="Options" />
                  <Subfield label="Éclaboussures">
                    <Checkbox
                      checked={entry.splash ?? false}
                      onChange={v => onUpdate({ splash: v })}
                      label={entry.splash ? 'Oui' : 'Non'}
                    />
                  </Subfield>
                  <Subfield label="Flash lumineux">
                    <Checkbox
                      checked={entry.flash ?? false}
                      onChange={v => onUpdate({ flash: v })}
                      label={entry.flash ? 'Oui' : 'Non'}
                    />
                  </Subfield>
                </>
              )}
              {isSoft && (
                <div style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)', fontStyle: 'italic', lineHeight: 1.4 }}>
                  Surface absorbante — la pluie disparait sans effet visible. Aucun paramètre à régler.
                </div>
              )}

              {/* Suppression */}
              <motion.button
                onClick={onRemove}
                whileTap={{ scale: 0.97 }}
                style={{
                  marginTop: 'var(--ie-space-1)',
                  padding: 'var(--ie-space-2)',
                  background: 'transparent',
                  border: '1px solid var(--ie-border-strong)',
                  borderRadius: 'var(--ie-radius-sm)',
                  color: 'var(--ie-danger)',
                  fontSize: 'var(--ie-text-xs)',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-1)',
                }}
                title="Retire cette zone"
              >
                <Trash2 size={12} /> Retirer cette zone
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}

// ── InlineZoneBlock : sous-bloc compact avec bordure dashed colorée ─────
//
// Pattern visuel commun pour les zones (pluie ou gouttes) quand elles
// s'intègrent DANS une section parent plutôt qu'en section top-level.
// Fond et bordure dérivés de `colorHex` (teal pour main, orange pour impact).

function InlineZoneBlock({
  title, tooltip, zone, onZoneChange, onFocusEdit, colorHex, hideSizeSlider = false,
}: {
  title: string
  tooltip?: string
  zone: WeatherZone
  onZoneChange: (z: WeatherZone) => void
  onFocusEdit: () => void
  colorHex: string
  hideSizeSlider?: boolean
}) {
  return (
    <div style={{
      marginTop: 'var(--ie-space-2)',
      padding: 'var(--ie-space-2)',
      background: hexToRgba(colorHex, 0.06),
      border: `1px dashed ${hexToRgba(colorHex, 0.3)}`,
      borderRadius: 'var(--ie-radius-sm)',
      display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)',
    }}>
      <div
        title={tooltip}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.25em',
          fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)',
          fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase',
          cursor: tooltip ? 'help' : 'default',
        }}
      >
        {title}
        {tooltip && <span style={{ opacity: 0.6, fontSize: '0.9em', fontWeight: 400 }} aria-hidden>ⓘ</span>}
      </div>
      <ZoneControls
        zone={zone}
        onZoneChange={onZoneChange}
        onFocusEdit={onFocusEdit}
        colorHex={colorHex}
        hideSizeSlider={hideSizeSlider}
      />
    </div>
  )
}

/** Sous-titre de groupe dans le corps déplié d'une ImpactZoneCard. Sépare
 *  visuellement les sections logiques (Dessin / Effet visuel / Options).
 *  Visuel : fine ligne au-dessus + petit label uppercase doré. */
function GroupTitle({ label }: { label: string }) {
  return (
    <div style={{
      marginTop: 'var(--ie-space-2)',
      paddingTop: 'var(--ie-space-2)',
      borderTop: '1px solid var(--ie-border)',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--ie-text-muted)',
    }}>
      {label}
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ── ZoneControls : boutons mode + controls pinceau (réutilisable) ─────────

function ZoneControls({
  zone, onZoneChange, onFocusEdit, colorHex, hideSizeSlider = false, allowedModes,
}: {
  zone: WeatherZone
  onZoneChange: (z: WeatherZone) => void
  onFocusEdit: () => void
  colorHex: string  // pour harmoniser l'indicateur actif avec la couleur canvas
  /** Masque le slider "Taille de pointe". Utile pour la zone principale
   *  (pluie/neige/…) où le contrôle fin du pinceau est rarement utile. */
  hideSizeSlider?: boolean
  /** Restreint les modes visibles. Si absent, tous les modes (full/rect/brush)
   *  sont disponibles. Pour les éclairs : ['rect', 'brush'] (pas de full). */
  allowedModes?: WeatherZone['mode'][]
}) {
  const { setWeatherBrushEngaged } = useEditorState()
  function setZoneMode(mode: WeatherZone['mode']) {
    // Préserve TOUTES les data existantes (rect ET strokes) lors du switch de
    // mode — l'utilisateur peut tracer un rect, basculer en brush pour
    // ajouter/retirer, puis revenir au rect sans rien perdre. Le rendu
    // compose les deux (cf RainyDayGlassLayer + ParticleLayer.applyImpactZonesMask).
    const next: WeatherZone = { ...zone, mode }
    if (mode === 'brush') {
      next.brushSize = zone.brushSize ?? 0.015
      next.brushMode = zone.brushMode ?? 'paint'
      next.strokes = zone.strokes ?? []
    }
    onZoneChange(next)
    onFocusEdit()
    // Engage le tool d'édition pour brush ET rect (les deux affichent le
    // preview canvas overlay). Pleine désengage → le preview disparaît.
    setWeatherBrushEngaged(mode === 'brush' || mode === 'rect')
  }

  // Vue unifiée : rects[] + strokes[] forment UNE seule zone peinte aux yeux
  // de l'utilisateur. Pas de count individuel — juste "zone peinte / aucune".
  const draftRectExists = !!zone.rect && Math.abs(zone.rect.x2 - zone.rect.x1) > 0.001 && Math.abs(zone.rect.y2 - zone.rect.y1) > 0.001
  const hasAnyPaint = (zone.rects?.length ?? 0) > 0 || draftRectExists ||
    (zone.strokes?.some(s => s.points.length > 0) ?? false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)' }}>
      <div style={toggleGroupStyle()}>
        {(!allowedModes || allowedModes.includes('full')) && (
          <ZoneModeBtn active={zone.mode === 'full'}  onClick={() => setZoneMode('full')}  icon={<Maximize2 size={12} />} label="Pleine" color={colorHex} />
        )}
        {(!allowedModes || allowedModes.includes('rect')) && (
          <ZoneModeBtn active={zone.mode === 'rect'}  onClick={() => setZoneMode('rect')}  icon={<Square size={12} />}    label="Rectangle" color={colorHex} />
        )}
        {(!allowedModes || allowedModes.includes('brush')) && (
          <ZoneModeBtn active={zone.mode === 'brush'} onClick={() => setZoneMode('brush')} icon={<Paintbrush size={12} />} label="Pinceau" color={colorHex} />
        )}
      </div>
      {zone.mode !== 'full' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--ie-space-1) var(--ie-space-2)', background: 'var(--ie-surface)', borderRadius: 'var(--ie-radius-sm)', fontSize: 'var(--ie-text-xs)' }}>
          <span style={{ color: hasAnyPaint ? 'var(--ie-text)' : 'var(--ie-text-muted)' }}>
            {hasAnyPaint
              ? 'Zone peinte'
              : zone.mode === 'rect'
                ? 'Trace un rectangle…'
                : 'Peins la zone…'}
          </span>
          {hasAnyPaint && (
            <motion.button
              onClick={() => onZoneChange({ ...zone, rect: undefined, rects: [], strokes: [] })}
              whileTap={{ scale: 0.97 }}
              style={{ ...smallBtnStyle(), padding: '2px 8px' }}
              title="Effacer toute la zone peinte"
            ><Trash2 size={11} /> Effacer tout</motion.button>
          )}
        </div>
      )}
      {zone.mode === 'brush' && (
        <>
          <Subfield label="Mode">
            <div style={toggleGroupStyle()}>
              <ToggleBtn active={zone.brushMode !== 'erase'} onClick={() => { onZoneChange({ ...zone, brushMode: 'paint' }); onFocusEdit() }} label="Peindre" />
              <ToggleBtn active={zone.brushMode === 'erase'} onClick={() => { onZoneChange({ ...zone, brushMode: 'erase' }); onFocusEdit() }} label="Gomme" />
            </div>
          </Subfield>
          {!hideSizeSlider && (
            <Slider
              label="Taille de pointe"
              value={zone.brushSize ?? 0.015}
              min={0.005} max={0.12} step={0.002}
              display={`${((zone.brushSize ?? 0.015) * 100).toFixed(1)}%`}
              onChange={v => { onZoneChange({ ...zone, brushSize: v }); onFocusEdit() }}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── Section collapsible — même thème que FoldContainer de Sidebar.tsx ────
//
// Pattern visuel :
//   - Fermée : fond `var(--ie-surface)`, border neutre, texte normal
//   - Ouverte : fond `var(--ie-accent-faint)` (rose pâle), border accent,
//     texte en `var(--ie-accent-dark)`, chevron down rotaté 180°
//   - Animation height+opacity à l'ouverture/fermeture (framer-motion)

function Section({
  title, open, onToggle, children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  // PAS d'overflow:hidden sur le wrapper : sinon le bouton sticky serait
  // confiné au wrapper de la section (qui n'est pas le scroll container).
  // L'overflow:hidden de l'animation est porté par le motion.div interne.
  return (
    <div style={{
      background: open ? 'var(--ie-accent-faint)' : 'var(--ie-surface)',
      border: `1px solid ${open ? 'var(--ie-accent)' : 'var(--ie-border)'}`,
      borderRadius: 'var(--ie-radius-md)',
      transition: 'all var(--ie-transition)',
      position: 'relative',  // contexte pour le z-index du bouton sticky
    }}>
      <motion.button
        onClick={onToggle}
        whileTap={{ scale: 0.98 }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--ie-space-3) var(--ie-space-4)',
          fontSize: 'var(--ie-text-base)',
          fontWeight: 500,
          color: open ? 'var(--ie-accent-dark)' : 'var(--ie-text)',
          // Background OPAQUE sur l'état ouvert pour masquer le contenu qui
          // défile en dessous quand le bouton est sticky en haut du panel.
          background: open ? 'var(--ie-accent-faint)' : 'var(--ie-surface)',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
          // Sticky : le titre + chevron restent visibles en haut quand
          // l'utilisateur scrolle le panel pour voir les params plus bas.
          position: 'sticky',
          top: 0,
          zIndex: 2,
          // Coins arrondis qui matchent le wrapper (pour le visuel quand sticky)
          borderTopLeftRadius: 'var(--ie-radius-md)',
          borderTopRightRadius: 'var(--ie-radius-md)',
          // Ombrage subtil sous le bouton sticky pour le détacher du contenu
          boxShadow: open ? '0 1px 0 var(--ie-border)' : undefined,
        }}
      >
        <span>{title}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: 'flex', alignItems: 'center', color: 'var(--ie-text-faint)' }}
        >
          <ChevronDown size={16} />
        </motion.span>
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: 'var(--ie-space-3) var(--ie-space-4)',
              display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)',
            }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Petits composants de form ──────────────────────────────────────────────

function Subfield({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)' }}>
      <span style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)' }}>{label}</span>
      {children}
    </div>
  )
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 'var(--ie-space-2)',
      cursor: 'pointer',
      fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text)',
      fontWeight: 500,
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ cursor: 'pointer', accentColor: 'var(--ie-accent)' }}
      />
      {label}
    </label>
  )
}

function toggleGroupStyle(): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))',
    gap: '0.125rem',
    padding: '0.125rem',
    background: 'var(--ie-surface-3)',
    borderRadius: 'var(--ie-radius-sm)',
  }
}

function ZoneModeBtn({ active, onClick, icon, label, color }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; color: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: 'var(--ie-space-2) 0.25rem',
        borderRadius: 'var(--ie-radius-sm)',
        background: active ? color : 'transparent',
        color: active ? '#FFFFFF' : 'var(--ie-text-muted)',
        fontSize: '0.6875rem',
        fontWeight: active ? 600 : 500,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '0.125rem',
        cursor: 'pointer',
        border: 'none',
        fontFamily: 'inherit',
        transition: 'all var(--ie-transition)',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function ToggleBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: 'var(--ie-space-2)',
        borderRadius: 'var(--ie-radius-sm)',
        background: active ? 'var(--ie-surface)' : 'transparent',
        color: active ? 'var(--ie-text)' : 'var(--ie-text-muted)',
        fontSize: 'var(--ie-text-xs)',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        border: 'none',
        fontFamily: 'inherit',
        boxShadow: active ? 'var(--ie-shadow-sm)' : 'none',
        transition: 'all var(--ie-transition)',
      }}
    >{label}</button>
  )
}

function smallBtnStyle(): React.CSSProperties {
  return {
    padding: 'var(--ie-space-2)',
    borderRadius: 'var(--ie-radius-sm)',
    background: 'var(--ie-surface-3)',
    color: 'var(--ie-text-muted)',
    fontSize: 'var(--ie-text-xs)',
    fontWeight: 500,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ie-space-1)',
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    transition: 'all var(--ie-transition)',
  }
}

// ── Slider ───────────────────────────────────────────────────────────────

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step, display, onChange }: SliderProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)',
      }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: 'var(--ie-text)', fontVariantNumeric: 'tabular-nums' }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--ie-accent)' }}
      />
    </div>
  )
}

// ── LightningPanel ────────────────────────────────────────────────────────
// Panneau d'édition spécifique aux calques 'lightning'.
// Modèle simplifié 2026-04-25 : 4 paramètres user + 2 zones distinctes.

type LightningSectionId = 'effect' | 'zoneBolt' | 'zoneFlash'

function LightningPanel({
  weather, patchWeather, activeLayer, layerIdx, updateLayer,
}: {
  weather: WeatherParams
  patchWeather: (patch: Partial<WeatherParams>) => void
  activeLayer: { opacity: number }
  layerIdx: number
  updateLayer: ReturnType<typeof useEditorState>['updateLayer']
}) {
  const { setEditingWeatherZone } = useEditorState()
  const [openSection, setOpenSection] = useState<LightningSectionId | null>('effect')
  const toggle = (id: LightningSectionId) => setOpenSection(prev => (prev === id ? null : id))

  const flashEnabled = weather.lightningFlashEnabled !== false
  const boltZone: WeatherZone = weather.lightningBoltZone ?? { mode: 'rect', rect: { x1: 0.3, y1: 0.05, x2: 0.7, y2: 0.5 } }
  const flashZone: WeatherZone = weather.zone ?? { mode: 'rect', rect: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 } }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)' }}>
      {/* ── Effet ─────────────────────────────────────────────────────── */}
      <Section title="Effet" open={openSection === 'effect'} onToggle={() => toggle('effect')}>
        <Slider
          label="Luminosité"
          value={weather.lightningBrightness ?? 0.7}
          min={0.1} max={1} step={0.05}
          display={`${Math.round((weather.lightningBrightness ?? 0.7) * 100)}%`}
          onChange={v => patchWeather({ lightningBrightness: v })}
        />
        <Slider
          label="Intensité du halo"
          value={weather.lightningHaloIntensity ?? 0.6}
          min={0} max={1} step={0.05}
          display={`${Math.round((weather.lightningHaloIntensity ?? 0.6) * 100)}%`}
          onChange={v => patchWeather({ lightningHaloIntensity: v })}
        />
        <Slider
          label="Fréquence"
          value={weather.lightningFrequency ?? 0.4}
          min={0} max={1} step={0.05}
          display={
            (weather.lightningFrequency ?? 0.4) < 0.2 ? 'Rare'
            : (weather.lightningFrequency ?? 0.4) < 0.5 ? 'Moyen'
            : (weather.lightningFrequency ?? 0.4) < 0.8 ? 'Fréquent'
            : 'Très fréquent'
          }
          onChange={v => patchWeather({ lightningFrequency: v })}
        />
        <Subfield label="Flash blanc (illumination)">
          <Checkbox
            checked={flashEnabled}
            onChange={v => patchWeather({ lightningFlashEnabled: v })}
            label={flashEnabled ? 'Activé' : 'Désactivé (éclair seul)'}
          />
        </Subfield>
        <Slider
          label="Opacité du calque"
          value={activeLayer.opacity}
          min={0.1} max={1} step={0.05}
          display={`${Math.round(activeLayer.opacity * 100)}%`}
          onChange={v => updateLayer(layerIdx, { opacity: v })}
        />
      </Section>

      {/* ── Zone éclair (zigzag + halo) ───────────────────────────────── */}
      <Section title="Zone de l'éclair" open={openSection === 'zoneBolt'} onToggle={() => toggle('zoneBolt')}>
        <ZoneControls
          zone={boltZone}
          onZoneChange={(z) => patchWeather({ lightningBoltZone: z })}
          onFocusEdit={() => setEditingWeatherZone('main')}
          colorHex="#ffeb3b"
          allowedModes={['rect', 'brush']}
        />
      </Section>

      {/* ── Zone du flash ─────────────────────────────────────────────── */}
      {flashEnabled && (
        <Section title="Zone du flash (fenêtre)" open={openSection === 'zoneFlash'} onToggle={() => toggle('zoneFlash')}>
          <ZoneControls
            zone={flashZone}
            onZoneChange={(z) => patchWeather({ zone: z })}
            onFocusEdit={() => setEditingWeatherZone('main')}
            colorHex="#fff8e1"
            allowedModes={['rect', 'brush']}
          />
        </Section>
      )}
    </div>
  )
}

