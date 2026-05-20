/**
 * MultiTrackTimeline — types pour l'éditeur multi-pistes (refonte 2026-05-12).
 *
 * Vision UX validée :
 *   - 4 pistes : VIDEO_IMAGE · SFX · MUSIC · TEXT
 *   - Pas d'overlap par piste (1 bloc à la fois sur sa piste)
 *   - Mini-player en haut à droite, drag-drop depuis la bibliothèque
 *   - Curseur de lecture synchronisé 60 Hz via cursorMsRef + rAF
 *
 * Mapping vers le modèle Hero existant :
 *   - Piste VIDEO_IMAGE → représente les `pellicules[].shots[]` du Plan animation,
 *     plus les pellicules `image_static` (image fixe affichée X secondes).
 *     Chaque bloc vidéo = 1 shot d'une pellicule animation, ou 1 pellicule
 *     image_static. L'ordre des blocs sur la piste = l'ordre temporel
 *     d'exécution dans la séquence.
 *   - Piste SFX → nouveau champ `pellicule.audioTracks[]` filtré sur kind='sfx'
 *   - Piste MUSIC → idem mais kind='music' (mono-bloc typique : musique
 *     d'ambiance qui couvre toute la séquence)
 *   - Piste TEXT → projection des `shot.textOverlays[]` de chaque shot sur la
 *     timeline globale (start = shot.startInSequence + textOverlay.startSec)
 *
 * Persistance : tous les blocs sont dérivés des champs Hero existants.
 * Pas de nouvelle table — la timeline est une VUE sur le modèle Plan +
 * Pellicule + Shot + audioTracks + textOverlays.
 */

// ── Types des pistes ──────────────────────────────────────────────────────

export type TrackKind = 'video_image' | 'layers' | 'sfx' | 'music' | 'text'

export const TRACK_LABELS: Record<TrackKind, string> = {
  video_image: 'Vidéo / Image',
  // Phase A bis 2026-05-18 — nouvelle track Calques entre vidéo et son.
  layers:      'Calques',
  sfx:         'Effets sonores',
  music:       'Musique',
  text:        'Textes',
}

export const TRACK_ORDER: ReadonlyArray<TrackKind> = ['video_image', 'layers', 'sfx', 'music', 'text']

// ── Types des blocs ───────────────────────────────────────────────────────

/** Type discriminant des blocs — drive le rendu visuel + le panneau d'édition. */
export type BlockKind =
  | 'video'         // pellicule animation (LTX généré ou uploadé)
  | 'image_static'  // pellicule image fixe (Z-Image / Flux / upload)
  | 'layer'         // Phase A bis 2026-05-18 — calque image/video/gif posé sur une pellicule parente
  | 'sfx'           // effet sonore court (sonnerie, coup de feu, etc.)
  | 'music'         // musique d'ambiance (souvent piste mono couvrant tout)
  | 'text'          // overlay texte (titre, sous-titre, narration)

/** Bloc commun à toutes les pistes — propriétés temporelles. */
interface BaseBlock {
  /** UUID stable côté client. */
  id: string
  /** Position de début en millisecondes (0 = début de la séquence Plan). */
  startMs: number
  /** Durée en ms. Pour video : durée native de la vidéo (lecture 1×). Pour
   *  image/sfx/music/text : choisie par l'auteur (image_static peut être
   *  étirée, sfx clampé à durée du fichier audio). */
  durationMs: number
}

/** Bloc vidéo (= 1 pellicule animation entière, refonte 2026-05-14as).
 *  Avant : 1 bloc par shot — perdait l'unité "pellicule = 1 vidéo MP4
 *  multi-shots concaténée par LTX". Maintenant : 1 bloc par pellicule
 *  avec sous-divisions visuelles `shots[]` pour matérialiser les coupes. */
export interface VideoBlock extends BaseBlock {
  kind: 'video'
  trackKind: 'video_image'
  /** ID de la pellicule source (pour reconstruire l'animation au save). */
  pelliculeId: string
  /** URL vidéo MP4 (depuis pellicule.videoUrl). null si pas encore généré. */
  videoUrl: string | null
  /** Première frame (pour preview poster + miniature timeline). */
  firstFrameUrl: string | null
  /** Label affiché sur le bloc (ex: "Survol Cirius"). */
  label: string
  /** Sous-divisions internes — 1 entrée par shot. startMs relatif au début
   *  du bloc, pas à la timeline. Sert à dessiner les lignes verticales
   *  séparatrices + permettre le click sur shot pour sélection contextuelle.
   *  `prompt` (refonte 2026-05-15bh) = résumé lisible du contenu du shot
   *  (sceneAction + actions perso) affiché à droite du bloc timeline. */
  shots: Array<{ id: string; startMs: number; durationMs: number; prompt?: string }>
}

/** Bloc image fixe (= pellicule image_static). */
export interface ImageStaticBlock extends BaseBlock {
  kind: 'image_static'
  trackKind: 'video_image'
  /** ID de la pellicule (= pellicule.id, type='image_static'). */
  pelliculeId: string
  /** URL de l'image fixe (depuis pellicule.firstFrameUrl). */
  imageUrl: string
  /** Label (ex: "Plaque Detective Duke Duo"). */
  label: string
}

/** Phase A bis 2026-05-18 — Bloc calque (image/video/gif posé au-dessus d'une
 *  pellicule parente). Le startMs est GLOBAL (calculé = parent.startMs +
 *  start_ms_rel) pour rendu visuel direct sur la timeline. La FK vers le
 *  parent est conservée via parentPelliculeId pour persistance + grouping. */
export interface LayerBlock extends BaseBlock {
  kind: 'layer'
  trackKind: 'layers'
  /** ID dans la table pellicule_layers. */
  layerId: string
  /** ID de la pellicule parente (FK section_timeline.id). Drive le grouping
   *  visuel + le scope de move (contraint dans les bornes du parent). */
  parentPelliculeId: string
  /** Type de média (image/video/gif). */
  layerType: 'image' | 'video' | 'gif'
  /** URL du média pour la miniature dans le bloc. */
  mediaUrl: string | null
  /** Label (ex: "Travis PNG", nom de fichier upload). */
  label: string
  /** Ordre stacking (plus haut = au-dessus visuellement). */
  zIndex: number
  /** Toggle visibilité. */
  visible: boolean
}

/** Bloc SFX (effet sonore). */
export interface SfxBlock extends BaseBlock {
  kind: 'sfx'
  trackKind: 'sfx'
  /** ID dans la banque audio du livre. */
  audioId: string
  /** URL Supabase du fichier mp3/wav. */
  audioUrl: string
  /** Label depuis la banque (ex: "Sonnette de porte"). */
  label: string
  /** Volume 0-1 (default 0.7). */
  volume: number
  /** Fade in/out en ms (default 200). */
  fadeInMs: number
  fadeOutMs: number
}

/** Bloc musique (souvent un seul, longue durée couvrant la séquence). */
export interface MusicBlock extends BaseBlock {
  kind: 'music'
  trackKind: 'music'
  audioId: string
  audioUrl: string
  label: string
  volume: number  // typiquement plus bas que SFX (~0.4)
  fadeInMs: number
  fadeOutMs: number
  /** Si true, le bloc loope tant qu'il n'est pas atteint par sa durationMs. */
  loop: boolean
}

/** Bloc texte overlay (cadré 2026-05-12). */
export interface TextBlock extends BaseBlock {
  kind: 'text'
  trackKind: 'text'
  /** Texte FR à afficher. */
  text: string
  /** Style d'animation. */
  template: 'fade' | 'typewriter' | 'slide_up'
  /** Position verticale dans le canvas. */
  position: 'top' | 'center' | 'bottom'
  /** Taille relative. */
  size: 'sm' | 'md' | 'lg' | 'xl'
}

/** Union discriminée — l'identification du type de bloc se fait via `kind`. */
export type TimelineBlock =
  | VideoBlock
  | ImageStaticBlock
  | LayerBlock
  | SfxBlock
  | MusicBlock
  | TextBlock

// ── State global de la timeline ───────────────────────────────────────────

/** Représentation runtime de toute la séquence multi-pistes. Dérivée du
 *  modèle Plan + Pellicule + audioTracks + textOverlays via un mapper bidir
 *  (à coder en sous-tâche 5 : câblage AnimationStudioInner). */
export interface TimelineState {
  /** Tous les blocs, triés par track puis par startMs. */
  blocks: TimelineBlock[]
  /** Durée totale de la séquence en ms (= max(block.startMs + block.durationMs)). */
  totalDurationMs: number
}

// ── Helpers de filtrage / recherche ───────────────────────────────────────

/** Retourne les blocs d'une piste, triés par startMs ascendant. */
export function blocksOfTrack(state: TimelineState, track: TrackKind): TimelineBlock[] {
  return state.blocks
    .filter(b => b.trackKind === track)
    .sort((a, b) => a.startMs - b.startMs)
}

/** Retourne le bloc actif (cursor entre startMs et startMs+durationMs) sur
 *  une piste, ou null. */
export function activeBlockAt(
  state: TimelineState, track: TrackKind, cursorMs: number,
): TimelineBlock | null {
  for (const b of blocksOfTrack(state, track)) {
    if (cursorMs >= b.startMs && cursorMs < b.startMs + b.durationMs) {
      return b
    }
    if (b.startMs > cursorMs) break  // la liste est triée → on peut couper
  }
  return null
}

/** True si placer un bloc [start, start+duration] sur cette piste créerait
 *  un overlap avec un bloc existant (en ignorant excludeBlockId pour le drag
 *  de re-positionnement). */
export function wouldOverlap(
  state: TimelineState,
  track: TrackKind,
  startMs: number,
  durationMs: number,
  excludeBlockId?: string,
): boolean {
  const endMs = startMs + durationMs
  for (const b of blocksOfTrack(state, track)) {
    if (b.id === excludeBlockId) continue
    const bEnd = b.startMs + b.durationMs
    // Overlap si début ou fin du nouveau bloc tombe dans [b.startMs, bEnd]
    // OU si le nouveau bloc englobe entièrement b.
    if (startMs < bEnd && endMs > b.startMs) return true
  }
  return false
}
