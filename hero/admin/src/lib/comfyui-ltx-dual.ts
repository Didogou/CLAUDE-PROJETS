/**
 * Helper pour LTX 2.3 + IC LoRA Dual Characters (Lightricks + MaqueAI).
 *
 * Pipeline cinématique multi-perso : prend 1 image + prompt structuré
 * (scene/characters/shots) → vidéo MP4 avec persos animés en plusieurs plans.
 *
 * État 2026-05-02 :
 *   - Modèles téléchargés (LTX 2.3 GGUF, distilled LoRA, IC LoRA Dual, Gemma, VAE)
 *   - Custom node ComfyUI-LTXVideo à jour
 *   - ⚠ Workflow API JSON à exporter depuis ComfyUI puis bake dans Hero
 *     (cf. instructions dans la page POC `/editor-test/ltx-dual-characters`)
 *
 * Workflow type backend : 'ltx_2_3_dual'
 * Le builder lit un JSON template (ltx_2_3_dual.api.json) et substitue :
 *   - LoadImage filename (= image source uploadée)
 *   - CLIPTextEncode positive widget_values (= prompt positif)
 *   - CLIPTextEncode negative widget_values (= prompt négatif)
 *   - Optionnel : seed pour variance
 */

import { extractFramesFromVideo } from './extract-frames'

export interface Ltx23DualProgress {
  stage: 'upload' | 'queuing' | 'generating' | 'fetching' | 'extracting_frames' | 'done' | 'error'
  label?: string
}

export interface Ltx23DualOptions {
  /** URL Supabase de l'image source à animer. */
  imageUrl: string
  /** Prompt positif structuré (scene/characters/shot 1.../shot 2...). */
  positivePrompt: string
  /** Prompt négatif (court). */
  negativePrompt?: string
  /** Seed (-1 = random). */
  seed?: number
  /** Callback de progression UI. */
  onProgress?: (p: Ltx23DualProgress) => void
  /** Si true, capture première + dernière frame du MP4 et upload Supabase
   *  (cf décision 2026-05-03 : vignette banque + modale "image début/fin"
   *  ont besoin de ces thumbnails). Défaut true. Mettre false pour tests
   *  rapides où on ne stocke pas dans la banque. */
  extractFrames?: boolean
  /** URL Supabase d'un fichier audio (mp3/wav). Si fourni, active le mode
   *  CUSTOM AUDIO LIPSYNC du workflow Vantage : MelBandRoFormer extrait les
   *  vocaux, LTXVAudioVAEEncode les transforme en latent, et le sampler cale
   *  les lèvres dessus pour produire un vrai lipsync intelligible. Sans ce
   *  paramètre, LTX 2.3 reste en mode foley généré (audio environnemental
   *  cohérent mais dialogues = gibberish). */
  audioUrl?: string
  /** Dimensions cible de la vidéo générée (multiples de 32 obligatoires côté
   *  LTX, longer edge ≤ 1280 sur 8 GB VRAM). Si non fournies, le workflow
   *  utilise ses defaults (1280×720 = 16:9). À fournir pour que la vidéo
   *  préserve l'aspect de l'image source (ex: 720×1280 pour un 9:16). */
  width?: number
  height?: number
  /** Durée de la vidéo en secondes (1-20). Si non fournie, default workflow
   *  = 15s. Typiquement = somme des shot.duration de la pellicule. */
  durationSec?: number
}

/** Résultat enrichi avec les frames extraites (si extractFrames!=false). */
export interface Ltx23DualResult {
  video_url: string
  /** URL Supabase de la 1ère frame du MP4 (état initial). null si extractFrames=false. */
  first_frame_url: string | null
  /** URL Supabase de la dernière frame du MP4 (état final figé). null si extractFrames=false. */
  last_frame_url: string | null
}

const POLL_INTERVAL_MS = 5000
// 25 min : LTX 2.3 sur 8 GB lowvram est lent (modèle 14 GB + Gemma 9.4 GB en
// swap RAM/VRAM constant). Mesure réelle 2026-05-03 sur RTX 5060 8GB Blackwell
// = ~16-17 min pour le wf Vantage Dual Characters complet (1 plan, T2V).
// 25 min laisse une marge de sécurité ; sur GPU plus rapide ça finira plus tôt.
const MAX_WAIT_MS = 25 * 60 * 1000

/** Upload une image OU un audio (URL Supabase) dans le file store de ComfyUI. */
async function uploadToComfy(url: string, name: string): Promise<string> {
  const res = await fetch('/api/comfyui/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'url', url, name }),
  })
  const data = await res.json()
  if (!res.ok || !data.filename) {
    throw new Error(data.error ?? `comfy upload ${name} failed`)
  }
  return data.filename
}

/** Lance LTX 2.3 + IC LoRA Dual Characters et attend le résultat. Extrait
 *  automatiquement la première et la dernière frame du MP4 généré (sauf si
 *  `extractFrames: false`).
 *  Wrap avec retry-on-OOM automatique (refonte 2026-05-12). */
export async function runLtx23Dual(opts: Ltx23DualOptions): Promise<Ltx23DualResult> {
  const { withOomRetry } = await import('./oom-retry')
  return await withOomRetry(() => runLtx23DualCore(opts), {
    onOomDetected: () => {
      opts.onProgress?.({ stage: 'queuing', label: 'Récupération mémoire CUDA, retry…' })
    },
  })
}

async function runLtx23DualCore(opts: Ltx23DualOptions): Promise<Ltx23DualResult> {
  const { imageUrl, positivePrompt, negativePrompt, seed, onProgress, audioUrl, width, height, durationSec } = opts
  const extractFrames = opts.extractFrames !== false  // défaut true

  onProgress?.({ stage: 'upload', label: 'Préparation…' })

  // Free VRAM AVANT/APRÈS centralisé dans queuePrompt() (cache UNet conditionnel).
  // Pour LTX 2.3 (~24 GB), le free se déclenchera automatiquement si on
  // arrive depuis un autre modèle (Flux, Z-Image…), sinon skip = cache.
  const upImg = await uploadToComfy(imageUrl, 'ltx_dual_src')

  // Si audioUrl fourni → upload aussi le fichier audio. Le builder côté serveur
  // détectera audio_filename et basculera vers le workflow custom-audio (lipsync).
  let upAudio: string | undefined
  if (audioUrl) {
    onProgress?.({ stage: 'upload', label: 'Upload audio…' })
    upAudio = await uploadToComfy(audioUrl, 'ltx_dual_audio')
  }

  onProgress?.({ stage: 'queuing', label: 'Queue ComfyUI…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'ltx_2_3_dual',
      source_image: upImg,
      audio_filename: upAudio,  // undefined → mode foley ; défini → mode lipsync
      prompt_positive: positivePrompt,
      // Négatif renforcé 2026-05-07 : ajout de termes anti title-card / end
      // credits car LTX 2.3 + IC LoRA Dual a tendance à générer un "title
      // card" cinéma stylisé en fin de séquence (texte jaune sur la vidéo)
      // surtout quand le prompt contient des dialogues entre guillemets et
      // que la durée totale dépasse ~10s.
      // Refonte 2026-05-12 : negative prompt par défaut retiré (avait
      // "cartoon, childish, ..." qui bloquait les styles cartoon/anime
      // silencieusement, cf project_hero_style_toon_limitation). Le caller
      // peut toujours passer negativePrompt explicitement si besoin (ex:
      // anti text/watermark/title-card pour LTX classique réaliste).
      prompt_negative: negativePrompt ?? '',
      seed: seed ?? -1,
      width,
      height,
      duration_sec: durationSec,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    // Propage les détails de validation ComfyUI si présents (node_errors)
    let detail = ''
    if (queueRes.details && typeof queueRes.details === 'object' && !Array.isArray(queueRes.details)) {
      const lines: string[] = []
      for (const [nid, info] of Object.entries(queueRes.details as Record<string, { class_type?: string; errors?: Array<{ type?: string; message?: string; details?: unknown }> }>)) {
        const ct = info.class_type ?? '?'
        for (const e of info.errors ?? []) {
          lines.push(`Node ${nid} (${ct}): ${e.type ?? '?'} — ${e.message ?? ''}${e.details ? ` (${JSON.stringify(e.details)})` : ''}`)
        }
      }
      if (lines.length > 0) detail = '\n' + lines.join('\n')
    }
    console.error('[runLtx23Dual] queue failed:', queueRes)
    throw new Error((queueRes.error ?? 'ltx_2_3_dual queue failed') + detail)
  }

  onProgress?.({ stage: 'generating', label: 'Génération vidéo… (15-20 min sur 8 GB lowvram, plus rapide sur GPU + grosse)' })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'ltx_2_3_dual failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('ltx_2_3_dual timeout (12 min) — sysmem fallback peut-être désactivé')

  onProgress?.({ stage: 'fetching', label: 'Récupération vidéo…' })

  // LTX produit une vidéo MP4 (pas une image) → action=video_info pour la fetch
  const storagePath = `test/ltx-dual/result_${Date.now()}`
  const vRes = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=video_info&storage_path=${encodeURIComponent(storagePath)}`
  ).then(r => r.json())
  if (!vRes.video_url) throw new Error(vRes.error ?? 'video_url manquante (sortie pas une vidéo ?)')

  // Free APRÈS supprimé : cache UNet géré centralement dans queuePrompt
  // Capture des 2 frames (1ère + dernière) — vignette banque + modale copie.
  // Si l'extraction échoue (CORS, vidéo cassée), on log mais on retourne la
  // vidéo quand même : les frames sont un nice-to-have, pas un bloquant.
  let firstFrameUrl: string | null = null
  let lastFrameUrl: string | null = null
  if (extractFrames) {
    onProgress?.({ stage: 'extracting_frames', label: 'Capture des miniatures…' })
    try {
      const frames = await extractFramesFromVideo({
        videoUrl: vRes.video_url as string,
        storagePathPrefix: `test/ltx-dual/frames`,
      })
      firstFrameUrl = frames.first_frame_url
      lastFrameUrl = frames.last_frame_url
    } catch (err) {
      console.warn('[runLtx23Dual] extractFrames failed (non-bloquant):', err)
    }
  }

  onProgress?.({ stage: 'done' })
  return {
    video_url: vRes.video_url as string,
    first_frame_url: firstFrameUrl,
    last_frame_url: lastFrameUrl,
  }
}

// ── V2V Extend (refonte 2026-05-11) ────────────────────────────────────────

export interface Ltx23DualV2vOptions extends Omit<Ltx23DualOptions, 'imageUrl'> {
  /** URL Supabase de la vidéo précédente. Le workflow V2V Extend (RuneXX)
   *  charge la vidéo via VHS_LoadVideo PUIS utilise GetImageRangeFromBatch
   *  pour extraire les N dernières frames lui-même → on n'a PAS besoin de
   *  pré-extraire les frames côté Hero, on passe juste la vidéo entière. */
  prevVideoUrl: string
  /** Référence en secondes : combien de la fin de la vidéo source utiliser
   *  comme conditioning. Défaut 1s. Patche le INTConstant "REF. LENGTH". */
  refLengthSec?: number
}

/** Note workflow JSON 2026-05-12 : le template `ltx_2_3_dual_v2v.api.json`
 *  contient HISTORIQUEMENT 2 nodes VHS_VideoCombine en sortie :
 *   - 578 "EXTENDED VIDEO (BLEND - BEST FOR TWO PASS WF)" → vidéo source+nouveau
 *     concaténés/blendés (= ce que Hero NE veut PAS en single-pass).
 *   - 627 "EXTENDED VIDEO (CUT - ALTERNATIVE FOR SINGLE PASS WF)" → uniquement
 *     la nouvelle partie (= ce que Hero veut).
 *  Le node 578 a été RETIRÉ du JSON pour que le serveur (qui prend le 1er
 *  média de l'history) récupère systématiquement le CUT. Si tu vois encore
 *  "vidéo entière + petit nouveau", vérifie que 578 n'a pas été remis. */

/** Lance LTX 2.3 V2V Extend (continuité de mouvement entre 2 pellicules).
 *  Workflow basé sur RuneXX `LTX-2.3_-_V2V_Extend_Any_Video_towards_Last-Frame-image.json`
 *  + LoRA Vantage Dual Characters greffé via 2nd `LoraLoaderModelOnly`.
 *
 *  Pipeline :
 *    1. Extract N dernières frames de prevVideoUrl (côté client via canvas)
 *    2. Upload chaque frame dans ComfyUI input store
 *    3. Queue workflow_type='ltx_2_3_dual_v2v' avec input_frames[]
 *    4. Poll result, fetch vidéo MP4
 *    5. Extract first/last frames de la nouvelle vidéo (continuité downstream)
 *
 *  ⚠ Tant que le workflow JSON `ltx_2_3_dual_v2v.api.json` n'est pas livré
 *  côté `src/lib/workflows/`, l'endpoint serveur throw "workflow_type unknown"
 *  (gestion gracefully degradée). */
export async function runLtx23DualV2v(opts: Ltx23DualV2vOptions): Promise<Ltx23DualResult> {
  const { withOomRetry } = await import('./oom-retry')
  return await withOomRetry(() => runLtx23DualV2vCore(opts), {
    onOomDetected: () => {
      opts.onProgress?.({ stage: 'queuing', label: 'Récupération mémoire CUDA, retry…' })
    },
  })
}

async function runLtx23DualV2vCore(opts: Ltx23DualV2vOptions): Promise<Ltx23DualResult> {
  const {
    prevVideoUrl, positivePrompt, negativePrompt, seed, onProgress, audioUrl,
    width, height, durationSec, refLengthSec = 1,
  } = opts
  const extractFrames = opts.extractFrames !== false

  // Refonte 2026-05-11 : pas d'extraction de frames côté Hero. Le workflow
  // RuneXX V2V Extend charge la vidéo entière via VHS_LoadVideo puis utilise
  // GetImageRangeFromBatch pour extraire les dernières frames lui-même → on
  // upload juste prevVideoUrl tel quel à ComfyUI.
  //
  // Bug fix 2026-05-13 : le workflow exige une piste audio dans la prev vidéo
  // (chaîne 319 → 443 NormalizeAudioLoudness → 179 LTXVAudioVAEEncode). Les
  // vidéos LTX générées n'ont pas d'audio → VHS plante. On ajoute donc une
  // piste audio silencieuse via un endpoint serveur (ffmpeg) AVANT upload.
  let prevVideoForComfy = prevVideoUrl
  try {
    onProgress?.({ stage: 'upload', label: 'Préparation audio (mute → silent track)…' })
    const silentRes = await fetch('/api/video/add-silent-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: prevVideoUrl }),
    })
    if (silentRes.ok) {
      const data = await silentRes.json() as { url?: string; error?: string }
      if (data.url) prevVideoForComfy = data.url
      else console.warn('[runLtx23DualV2v] silent-audio endpoint returned no url:', data.error)
    } else {
      console.warn('[runLtx23DualV2v] silent-audio endpoint HTTP', silentRes.status, '— fallback sans piste audio (risque de fail si la prev n\'a pas d\'audio)')
    }
  } catch (err) {
    console.warn('[runLtx23DualV2v] silent-audio fallback:', err)
  }
  onProgress?.({ stage: 'upload', label: 'Upload vidéo source vers ComfyUI…' })
  const upPrevVideo = await uploadToComfy(prevVideoForComfy, 'ltx_v2v_prev_video')

  // Audio optionnel (lipsync). Idem mode I2V.
  let upAudio: string | undefined
  if (audioUrl) {
    onProgress?.({ stage: 'upload', label: 'Upload audio…' })
    upAudio = await uploadToComfy(audioUrl, 'ltx_dual_audio')
  }

  onProgress?.({ stage: 'queuing', label: 'Queue ComfyUI (V2V)…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'ltx_2_3_dual_v2v',
      prev_video_filename: upPrevVideo,
      audio_filename: upAudio,
      prompt_positive: positivePrompt,
      // Refonte 2026-05-12 : negative prompt par défaut retiré (avait
      // "cartoon, childish, ..." qui bloquait les styles cartoon/anime
      // silencieusement, cf project_hero_style_toon_limitation). Le caller
      // peut toujours passer negativePrompt explicitement si besoin (ex:
      // anti text/watermark/title-card pour LTX classique réaliste).
      prompt_negative: negativePrompt ?? '',
      seed: seed ?? -1,
      width,
      height,
      duration_sec: durationSec,
      ref_length_sec: refLengthSec,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    let detail = ''
    if (queueRes.details && typeof queueRes.details === 'object' && !Array.isArray(queueRes.details)) {
      const lines: string[] = []
      for (const [nid, info] of Object.entries(queueRes.details as Record<string, { class_type?: string; errors?: Array<{ type?: string; message?: string; details?: unknown }> }>)) {
        const ct = info.class_type ?? '?'
        for (const e of info.errors ?? []) {
          lines.push(`Node ${nid} (${ct}): ${e.type ?? '?'} — ${e.message ?? ''}${e.details ? ` (${JSON.stringify(e.details)})` : ''}`)
        }
      }
      if (lines.length > 0) detail = '\n' + lines.join('\n')
    }
    console.error('[runLtx23DualV2v] queue failed:', queueRes)
    throw new Error((queueRes.error ?? 'ltx_2_3_dual_v2v queue failed (workflow JSON pas encore livré ?)') + detail)
  }

  onProgress?.({ stage: 'generating', label: 'Génération V2V… (continuité de mouvement)' })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'ltx_2_3_dual_v2v failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('ltx_2_3_dual_v2v timeout (25 min)')

  onProgress?.({ stage: 'fetching', label: 'Récupération vidéo…' })

  const storagePath = `test/ltx-dual-v2v/result_${Date.now()}`
  const vRes = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=video_info&storage_path=${encodeURIComponent(storagePath)}`,
  ).then(r => r.json())
  if (!vRes.video_url) throw new Error(vRes.error ?? 'video_url manquante')

  let firstFrameUrl: string | null = null
  let lastFrameUrl: string | null = null
  if (extractFrames) {
    onProgress?.({ stage: 'extracting_frames', label: 'Capture des miniatures…' })
    try {
      const frames = await extractFramesFromVideo({
        videoUrl: vRes.video_url as string,
        storagePathPrefix: `test/ltx-dual-v2v/frames`,
      })
      firstFrameUrl = frames.first_frame_url
      lastFrameUrl = frames.last_frame_url
    } catch (err) {
      console.warn('[runLtx23DualV2v] extractFrames failed (non-bloquant):', err)
    }
  }

  onProgress?.({ stage: 'done' })
  return {
    video_url: vRes.video_url as string,
    first_frame_url: firstFrameUrl,
    last_frame_url: lastFrameUrl,
  }
}
