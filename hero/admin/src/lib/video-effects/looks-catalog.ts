/**
 * looks-catalog.ts — Catalogue de looks composites narratifs (refonte 2026-05-15ca).
 *
 * Hiérarchie hybride validée 2026-05-15 (cf. project_effects_popup_design) :
 *   - Looks de base EXCLUSIFS  : color grading + cinéma. Un seul à la fois.
 *   - Modules EMPILABLES        : HUD, cadres, ambiance. Plusieurs combinables.
 *
 * Catégories :
 *   Looks  : Cinéma×5, Vintage×4, Surveillance×4, Glitch×4
 *   Modules: Cible×4, Cadre×4, Ambiance×4
 *
 * Résolution : `resolveEffects(state)` → { params shader pour VideoEffectsCanvas,
 *   overlays HTML actifs (flags), mouse_track + options pour SniperScope }.
 *
 * V1 stricte. Les ajouts/réorgs passent par cette table — la modale et les
 * thumbnails s'adaptent automatiquement.
 */

import type { VideoEffectsParams } from './VideoEffectsCanvas'
import type { WeatherParams } from '@/components/image-editor/types'

// ─── Types ────────────────────────────────────────────────────────────────

// Refonte 2026-05-15cd — fusion 'vintage' dans 'cinema' (depuis le passage en
// LUTs film stock, la distinction est artificielle : Polaroid 665 et Kodak
// Ektar sont tous deux du grading "Film").
export type LookCategory = 'cinema' | 'surveillance' | 'glitch'
// Refonte 2026-05-15dq — 'capture' retiré du catalogue : déplacé en outil
// séparé accessible via bandeau bas des tiles/blocks (modale dédiée mode='capture').
export type ModuleCategory = 'cible' | 'cadre' | 'ambiance' | 'meteo' | 'temps'

export interface LookDef {
  id: string
  label: string
  description: string
  category: LookCategory
  /** Params shader appliqués au quad WebGL. Override les défauts neutres.
   *  Si `lut_url` est défini, ces params s'appliquent EN POST de la LUT
   *  (ex: vignette + grain post-grading). */
  params: VideoEffectsParams
  /** URL d'une LUT 3D au format `.cube` (Adobe Cube LUT 1.0). Si présente, le
   *  rendu applique la LUT en première étape (= remplace mon grading
   *  paramétrique amateur par un grading pro calibré par coloriste).
   *  Refonte 2026-05-15cb — adoption du standard LUT.
   *  Sources : repo MIT YahiaAngelo/Film-Luts (G'MIC film stock emulation). */
  lut_url?: string
}

export interface ModuleDef {
  id: string
  label: string
  description: string
  category: ModuleCategory
  /** Params shader éventuels (ex: ambiance "Grain fort" pousse filmGrain). */
  params?: VideoEffectsParams
  /** Flag overlay HTML/CSS (le composant modal lit ces flags pour render). */
  overlay?: OverlayKind
  /** Si true, ce module nécessite la trajectoire mouse track (ex: sniper). */
  needsMouseTrack?: boolean
  /** Si présent, ce module est un effet météo qui pousse un WeatherParams
   *  préconfiguré (depuis WEATHER_PRESETS) dans state.weather quand activé.
   *  Refonte 2026-05-15de — port depuis système image. */
  weatherPresetKey?: string
}

export type OverlayKind =
  | 'sniper_scope' | 'viewfinder_photo' | 'hud_reticle' | 'night_vision'
  | 'phone_frame' | 'polaroid' | 'letterbox_235' | 'old_film'
  | 'light_leaks' | 'lens_dirt' | 'film_grain_strong' | 'vignette_strong'
  | 'camcorder' | 'bad_signal'

// ─── Catalogue Looks (base, exclusifs) ────────────────────────────────────

export const LOOKS: LookDef[] = [
  // 🎬 Cinéma — 5 looks (LUT film stock — MIT YahiaAngelo/Film-Luts)
  {
    id: 'cinema_warm', category: 'cinema',
    label: 'Cinéma chaud',
    description: 'Couleurs vives portrait — Kodak Ektar 100. Tons chauds peau et rouges nets.',
    lut_url: '/luts/film/kodak_ektar_100.cube',
    params: { vignette: 0.25, filmGrain: 0.05 },
  },
  {
    id: 'cinema_cold', category: 'cinema',
    label: 'Cinéma froid',
    description: 'Quotidien neutre froid — Fuji Superia 200. Verts/cyans légers, ambiance reportage.',
    lut_url: '/luts/film/fuji_superia_200.cube',
    params: { vignette: 0.3, filmGrain: 0.06 },
  },
  {
    id: 'cinema_noir', category: 'cinema',
    label: 'Noir & blanc',
    description: 'N&B reportage classique — Ilford HP-5 Plus 400. Grain moyen, contraste équilibré.',
    lut_url: '/luts/film/ilford_hp_5_plus_400.cube',
    params: { vignette: 0.4, filmGrain: 0.1 },
  },
  {
    id: 'cinema_pulp', category: 'cinema',
    label: 'Tarantino-pulp',
    description: 'Saturation extrême — Agfa Ultra Color 100. Couleurs poussées style 70s exploitation.',
    lut_url: '/luts/film/agfa_ultra_color_100.cube',
    params: { vignette: 0.25, filmGrain: 0.08 },
  },
  {
    id: 'cinema_blade_runner', category: 'cinema',
    label: 'Cyberpunk high-ISO',
    description: 'Néons saturés sensible — Fuji Superia X-Tra 800. Couleurs vives + grain visible.',
    lut_url: '/luts/film/fuji_superia_x-tra_800.cube',
    params: { vignette: 0.4, bloom: 0.4, chromaticAberration: 0.1, filmGrain: 0.15 },
  },

  // Anciens 'vintage' fusionnés dans 'cinema' (refonte 2026-05-15cd)
  {
    id: 'vhs_80s', category: 'cinema',
    label: 'Couleurs 80s',
    description: 'Tons couleur 80s — Kodak Elite Color 400. Chaleur ambrée, magenta léger.',
    lut_url: '/luts/film/kodak_elite_color_400.cube',
    params: { scanline: 0.45, chromaticAberration: 0.2, filmGrain: 0.18, vignette: 0.2 },
  },
  {
    id: 'super_8', category: 'cinema',
    label: 'Paysage saturé',
    description: 'Couleurs saturées paysage — Fuji Velvia 50. Verts vifs, ciels profonds.',
    lut_url: '/luts/film/fuji_velvia_50.cube',
    params: { vignette: 0.4, filmGrain: 0.15 },
  },
  {
    id: 'polaroid_look', category: 'cinema',
    label: 'Polaroid souvenir',
    description: 'Doux-laiteux — Polaroid 665. Tons pastel, ambiance souvenir.',
    lut_url: '/luts/film/polaroid_665.cube',
    params: { vignette: 0.2, filmGrain: 0.08 },
  },
  {
    id: 'sepia_souvenir', category: 'cinema',
    label: 'Polaroid vintage',
    description: 'Polaroid 669 — couleurs vieillies, contraste doux, ambiance mémoire ancienne.',
    lut_url: '/luts/film/polaroid_669.cube',
    params: { vignette: 0.35, filmGrain: 0.15 },
  },

  // 📺 Surveillance — 4 looks (LUT N&B film stock + scanline/dotScreen post)
  {
    id: 'security_cam', category: 'surveillance',
    label: 'Caméra de sécurité',
    description: 'N&B contrasté (Kodak Tri-X 400) + scanlines CRT + HUD complet.',
    lut_url: '/luts/film/kodak_tri-x_400.cube',
    params: { scanline: 0.45, filmGrain: 0.18, vignette: 0.4 },
  },
  {
    id: 'night_vision', category: 'surveillance',
    label: 'Vision nocturne',
    description: 'N&B très contrasté (Tri-X 400) + scanlines. Combine avec module "Vision nocturne (overlay)" pour le cercle vert.',
    lut_url: '/luts/film/kodak_tri-x_400.cube',
    params: { scanline: 0.35, filmGrain: 0.3, vignette: 0.5 },
  },
  {
    id: 'military_drone', category: 'surveillance',
    label: 'Drone militaire',
    description: 'N&B grain prononcé (Ilford Delta 3200) + HUD tactique vert (alt, GPS, distance, crosshair).',
    lut_url: '/luts/film/ilford_delta_3200.cube',
    params: { pixelate: 0.1, vignette: 0.5, filmGrain: 0.1 },
  },
  {
    id: 'hidden_cam', category: 'surveillance',
    label: 'Caméra cachée',
    description: 'N&B (Tri-X 400) légèrement pixellisé + vignette extrême + HUD anonyme.',
    lut_url: '/luts/film/kodak_tri-x_400.cube',
    params: { pixelate: 0.12, vignette: 0.65, filmGrain: 0.15 },
  },

  // ⚡ Glitch — 3 looks (shader pur, contrastes adoucis pour ne pas cramer)
  {
    id: 'datamosh', category: 'glitch',
    label: 'Datamosh',
    description: 'Glitch sporadique + chromatique RGB tirée.',
    params: { glitch: 'sporadic', chromaticAberration: 0.4, filmGrain: 0.12 },
  },
  {
    id: 'signal_lost', category: 'glitch',
    label: 'Signal coupé',
    description: 'Glitch constant + scanlines + bruit (sur LUT N&B Tri-X pour rester contrasté sans cramer).',
    lut_url: '/luts/film/kodak_tri-x_400.cube',
    params: { glitch: 'constant', scanline: 0.55, filmGrain: 0.35 },
  },
  {
    id: 'matrix_hack', category: 'glitch',
    label: 'Hacking matrix',
    description: 'Vert profond + grille HUD + bloom (sur LUT N&B Delta 3200 pour grain crédible).',
    lut_url: '/luts/film/ilford_delta_3200.cube',
    params: { hue: 0.32, grid: 0.35, bloom: 0.45, scanline: 0.25 },
  },
]

// ─── Catalogue Modules (empilables) ───────────────────────────────────────

export const MODULES: ModuleDef[] = [
  // 🎯 Cible — 4 modules (Sniper + Viewfinder + HUD trackables, Night vision overlay seul)
  {
    id: 'sniper', category: 'cible',
    label: 'Sniper scope',
    description: 'Lunette de fusil avec mask circulaire + réticule. Mouse tracking.',
    overlay: 'sniper_scope',
    needsMouseTrack: true,
  },
  {
    id: 'viewfinder_photo', category: 'cible',
    label: 'Viseur photo',
    description: 'Cadre appareil photo + crosshair qui suit la cible (mouse tracking).',
    overlay: 'viewfinder_photo',
    needsMouseTrack: true,
  },
  {
    id: 'hud_reticle', category: 'cible',
    label: 'HUD réticule',
    description: 'Réticule HUD discret qui suit la cible (mouse tracking).',
    overlay: 'hud_reticle',
    needsMouseTrack: true,
  },
  {
    id: 'night_vision_overlay', category: 'cible',
    label: 'Vision nocturne (overlay)',
    description: 'Cercle vert nocturne — overlay seul, sans changer le shader.',
    overlay: 'night_vision',
  },

  // 🖼️ Cadre — 4 modules
  {
    id: 'phone_frame', category: 'cadre',
    label: 'Phone frame',
    description: 'Cadre smartphone vertical avec notch.',
    overlay: 'phone_frame',
  },
  {
    id: 'polaroid', category: 'cadre',
    label: 'Polaroid frame',
    description: 'Cadre photo Polaroid blanc épais avec bandeau bas.',
    overlay: 'polaroid',
  },
  {
    id: 'letterbox_235', category: 'cadre',
    label: 'Cinéma 2.35:1',
    description: 'Bandes noires haut/bas pour ratio cinémascope.',
    overlay: 'letterbox_235',
  },
  {
    id: 'old_film', category: 'cadre',
    label: 'Vieux film rayures',
    description: 'Rayures verticales + taches qui passent style projection 16mm.',
    overlay: 'old_film',
  },

  // ✨ Ambiance — 4 modules
  {
    id: 'light_leaks', category: 'ambiance',
    label: 'Light leaks',
    description: 'Fuites lumineuses chaudes qui passent au bord du cadre.',
    overlay: 'light_leaks',
  },
  {
    id: 'lens_dirt', category: 'ambiance',
    label: 'Lens dirt',
    description: 'Saletés et poussières sur l\'objectif, halations légères.',
    overlay: 'lens_dirt',
  },
  {
    id: 'film_grain_strong', category: 'ambiance',
    label: 'Grain fort',
    description: 'Grain pellicule appuyé, ambiance argentique.',
    params: { filmGrain: 0.55 },
  },
  {
    id: 'vignette_strong', category: 'ambiance',
    label: 'Vignette appuyée',
    description: 'Vignette très marquée pour focus dramatique.',
    params: { vignette: 0.7 },
  },

  // 🌦 Météo — 8 modules (refonte 2026-05-15de — port depuis système image)
  // Chaque module pointe sur un WEATHER_PRESETS[].key. Activer le module
  // pousse le preset par défaut dans state.weather. Empilable (multi-effets).
  {
    id: 'weather_rain_light', category: 'meteo',
    label: 'Pluie légère',
    description: 'Pluie fine, ambiance mélancolique.',
    weatherPresetKey: 'rain-light',
  },
  {
    id: 'weather_rain_heavy', category: 'meteo',
    label: 'Pluie forte',
    description: 'Orage, pluie battante avec impacts au sol.',
    weatherPresetKey: 'rain-heavy',
  },
  {
    id: 'weather_snow_light', category: 'meteo',
    label: 'Neige lente',
    description: 'Flocons qui tombent doucement.',
    weatherPresetKey: 'snow-light',
  },
  {
    id: 'weather_snow_heavy', category: 'meteo',
    label: 'Neige dense',
    description: 'Tempête, blizzard.',
    weatherPresetKey: 'snow-heavy',
  },
  {
    id: 'weather_fog', category: 'meteo',
    label: 'Brouillard',
    description: 'Volutes qui dérivent lentement.',
    weatherPresetKey: 'fog',
  },
  {
    id: 'weather_cloud', category: 'meteo',
    label: 'Nuages',
    description: 'Nuages qui passent. Peindre où ils apparaissent (M4).',
    weatherPresetKey: 'cloud',
  },
  {
    id: 'weather_lightning_rare', category: 'meteo',
    label: 'Éclairs rares',
    description: 'Orage lointain, flashs espacés.',
    weatherPresetKey: 'lightning-rare',
  },
  {
    id: 'weather_lightning_storm', category: 'meteo',
    label: 'Tempête',
    description: 'Orage violent, éclairs rapprochés.',
    weatherPresetKey: 'lightning-storm',
  },

  // 🕒 Temps — modules temporels (refonte 2026-05-15dn)
  {
    id: 'time_slowmo', category: 'temps',
    label: 'Ralenti',
    description: 'Joue une portion de la vidéo au ralenti. La durée totale est allongée.',
  },

  // 📸 Capture — retiré du catalogue 2026-05-15dq (outil séparé via bandeau bas tile)
]

// ─── Labels catégories ────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<LookCategory | ModuleCategory, string> = {
  cinema: 'Cinéma',
  surveillance: 'Surveillance',
  glitch: 'Glitch',
  cible: 'Cible',
  cadre: 'Cadre',
  ambiance: 'Ambiance',
  meteo: 'Météo',
  temps: 'Temps',
}

export const LOOK_CATEGORIES: LookCategory[] = ['cinema', 'surveillance', 'glitch']
export const MODULE_CATEGORIES: ModuleCategory[] = ['cible', 'cadre', 'ambiance', 'meteo', 'temps']

// ─── État composite (= ce qui est persisté en effects_params) ─────────────

export interface ComposedEffectsState {
  /** ID du look de base actif. null = aucun (image neutre). */
  look_id: string | null
  /** IDs des modules empilés. Ordre = ordre d'application. */
  modules: string[]
  /** Sliders fins en override (recalibrage manuel après application d'un look). */
  overrides: VideoEffectsParams
  /** Trajectoire mouse track (si module sniper actif). */
  mouse_track?: { tMs: number; x: number; y: number }[] | null
  /** Couleur réticule sniper. Default 'red'. */
  sniper_color?: 'red' | 'green' | 'black'
  /** Taille zone scope (0..1). Default 0.22. */
  scope_size?: number
  /** Si appliqué via un preset perso, on garde la trace pour highlight UI. */
  custom_preset_id?: string | null
  /** Effets météo empilés (refonte 2026-05-15de — port depuis système image).
   *  Chaque entry est un WeatherParams complet (kind, density, speed, angle,
   *  zone, etc.). Le runtime instancie ParticleLayer ou LightningEffect pour
   *  chaque, posés en absolute par-dessus la vidéo. */
  weather?: WeatherParams[] | null
  /** Ralenti sur une portion de la pellicule (refonte 2026-05-15dm).
   *  startSec / endSec en secondes sur la timeline vidéo source.
   *  factor < 1 = ralenti (0.25 = 4× plus lent, 1 = normal).
   *  La durée totale de lecture devient :
   *    duration + (endSec - startSec) × (1/factor - 1)
   *  Au runtime, EffectsAwareVideo surveille currentTime et ajuste playbackRate. */
  slowMotion?: { startSec: number; endSec: number; factor: number } | null
}

export const NEUTRAL_STATE: ComposedEffectsState = {
  look_id: null,
  modules: [],
  overrides: {},
  mouse_track: null,
  sniper_color: 'red',
  scope_size: 0.22,
  custom_preset_id: null,
  weather: null,
  slowMotion: null,
}

// ─── Résolution ───────────────────────────────────────────────────────────

const NEUTRAL_PARAMS: Required<Omit<VideoEffectsParams, 'glitch' | 'preset'>> = {
  brightness: 0, contrast: 0, saturate: 0, hue: 0,
  vignette: 0, filmGrain: 0, chromaticAberration: 0, bloom: 0, pixelate: 0,
  sepia: 0, dotScreen: 0, scanline: 0, grid: 0, colorAverage: 0, colorDepth: 0,
}

/** Combine look de base + modules + overrides → params shader effectifs.
 *  Order : base look → modules (additif sur params) → overrides (écrasent).
 *  Pour les params numériques, modules ÉCRASENT le look (on prend la valeur
 *  la plus récente, pas une addition — sinon un module "Grain fort" sur un
 *  look déjà granuleux donne du noise insoutenable).  */
export function resolveShaderParams(state: ComposedEffectsState): VideoEffectsParams {
  const out: VideoEffectsParams = { ...NEUTRAL_PARAMS, glitch: 'off' }
  const look = state.look_id ? LOOKS.find(l => l.id === state.look_id) : null
  if (look) Object.assign(out, look.params)
  for (const mid of state.modules) {
    const mod = MODULES.find(m => m.id === mid)
    if (mod?.params) Object.assign(out, mod.params)
  }
  Object.assign(out, state.overrides ?? {})
  return out
}

/** Liste les overlays HTML à activer selon les modules choisis. */
export function resolveOverlays(state: ComposedEffectsState): OverlayKind[] {
  const out: OverlayKind[] = []
  for (const mid of state.modules) {
    const mod = MODULES.find(m => m.id === mid)
    if (mod?.overlay) out.push(mod.overlay)
  }
  return out
}

export function findLook(id: string | null): LookDef | null {
  if (!id) return null
  return LOOKS.find(l => l.id === id) ?? null
}

export function findModule(id: string): ModuleDef | null {
  return MODULES.find(m => m.id === id) ?? null
}

/** Migration backward-compat : accepte soit le legacy VideoEffectsParams direct
 *  (sliders Phase B/C), soit le nouveau ComposedEffectsState. Retourne toujours
 *  un ComposedEffectsState normalisé. Refonte 2026-05-15ca. */
export function migrateLegacyEffectsParams(
  legacy: VideoEffectsParams | ComposedEffectsState | null | undefined,
): ComposedEffectsState {
  if (!legacy) return NEUTRAL_STATE
  if (typeof legacy === 'object' && ('look_id' in legacy || 'modules' in legacy)) {
    // Nouveau format. Garde-fou : on remplit les champs manquants avec les neutres.
    const c = legacy as ComposedEffectsState
    return {
      look_id: c.look_id ?? null,
      modules: Array.isArray(c.modules) ? c.modules : [],
      overrides: c.overrides ?? {},
      mouse_track: c.mouse_track ?? null,
      sniper_color: c.sniper_color ?? 'red',
      scope_size: typeof c.scope_size === 'number' ? c.scope_size : 0.22,
      custom_preset_id: c.custom_preset_id ?? null,
      // Refonte 2026-05-15dg — préserve weather (était strippé → 2e activation
      // foirait, écrasée par useEffect[open, initialState] qui réinjectait un
      // initialState sans weather).
      weather: Array.isArray(c.weather) ? c.weather : null,
      // Refonte 2026-05-15dm — préserve slowMotion
      slowMotion: c.slowMotion && typeof c.slowMotion === 'object' ? c.slowMotion : null,
    }
  }
  // Legacy direct : c'était un VideoEffectsParams stocké à plat
  return { ...NEUTRAL_STATE, overrides: legacy as VideoEffectsParams }
}
