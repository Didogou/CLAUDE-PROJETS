/**
 * Helper pour le workflow `sonic` de ComfyUI.
 *
 * Sonic (Tencent, 2025, arXiv:2411.16331) : "Shifting Focus to Global Audio
 * Perception in Portrait Animation". Talking-head audio-driven : input =
 * 1 portrait + 1 audio (WAV/MP3), output = MP4 lipsync.
 *
 * Pipeline interne ComfyUI :
 *   ImageOnlyCheckpointLoader (SVD xt 1.1)
 *     → SONICTLoader (UNet patch + RIFE + dtype)
 *     → SONIC_PreData (face crop YOLO + Whisper audio embed)
 *     → SONICSampler (denoise loop + frame interpolation)
 *     → CreateVideo + SaveVideo
 *
 * Cas d'usage Hero (à valider) :
 *   - Plans dialogue mono-perso plan rapproché → alternative à LTX 2.3 +
 *     Vantage Dual + ElevenLabs (qui force du multi-perso et du fullbody).
 *
 * Setup install : voir mémoire `project_sonic_install_2026_05_14` (rapport
 * complet : modèles téléchargés, paths, premier test, comparaison LTX).
 */

export interface SonicProgress {
  stage: 'upload' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  label?: string
}

export interface SonicOptions {
  /** URL publique du portrait (image carrée recommandée, visage centré). */
  portraitUrl: string
  /** URL publique de l'audio (WAV ou MP3). */
  audioUrl: string
  /** Préfixe Supabase Storage pour ranger la vidéo (sans extension). */
  storagePathPrefix: string
  /** Durée d'inférence en secondes (default 5, capé à durée audio).
   *  Sonic supporte des longs (1-10 min) mais sur 8 GB rester court. */
  durationSec?: number
  /** Steps denoise (default 25). Plus = mieux mais plus lent. */
  inferenceSteps?: number
  /** FPS de sortie (default 25). 30 = plus fluide mais 20% plus long à gen. */
  fps?: number
  /** Seed (default random). Permet de reproduire un résultat. */
  seed?: number
  /** Callback de progression. */
  onProgress?: (p: SonicProgress) => void
}

const POLL_INTERVAL_MS = 3000
const MAX_WAIT_MS = 10 * 60 * 1000  // Sonic peut prendre plus que 5 min sur 8 GB

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

/** Lance le workflow sonic et retourne l'URL Supabase de la vidéo finale. */
export async function runSonic(opts: SonicOptions): Promise<string> {
  const {
    portraitUrl, audioUrl, storagePathPrefix,
    durationSec, inferenceSteps, fps, seed,
    onProgress,
  } = opts

  onProgress?.({ stage: 'upload', label: 'Upload portrait + audio…' })
  const upPortrait = await uploadToComfy(portraitUrl, 'sonic_portrait')
  const upAudio = await uploadToComfy(audioUrl, 'sonic_audio')

  onProgress?.({ stage: 'queuing', label: 'Queue ComfyUI (Sonic)…' })
  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'sonic',
      source_image: upPortrait,
      audio_filename: upAudio,
      // sonic ne consomme pas de prompt texte, mais l'API exige un prompt_positive.
      // On envoie un placeholder vide-mais-non-undefined.
      prompt_positive: 'sonic',
      duration_sec: durationSec ?? 5,
      inference_steps: inferenceSteps ?? 25,
      fps: fps ?? 25,
      seed: seed ?? -1,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'sonic queue failed')
  }

  onProgress?.({ stage: 'generating', label: 'Génération Sonic (peut prendre 2-5 min)…' })
  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'sonic failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('sonic timeout (10 min)')

  onProgress?.({ stage: 'fetching', label: 'Récupération vidéo…' })
  const storagePath = `${storagePathPrefix}_${Date.now()}`
  const vData = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=video_info&storage_path=${encodeURIComponent(storagePath)}`,
  ).then(r => r.json())
  if (!vData.video_url) throw new Error(vData.error ?? 'sonic video_url manquante')

  onProgress?.({ stage: 'done' })
  return vData.video_url as string
}
