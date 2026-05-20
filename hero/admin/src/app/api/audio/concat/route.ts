import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60
export const runtime = 'nodejs'

/** Strip un header ID3v2 en début de buffer s'il est présent.
 *  Format : "ID3" (3 octets) + version (2) + flags (1) + size synchsafe (4)
 *  → 10 octets header + `size` octets de tags. Total à skip = 10 + size.
 *  Si pas d'ID3v2 → buffer inchangé. */
function stripID3v2(buf: Buffer): Buffer {
  if (buf.length < 10) return buf
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return buf // pas "ID3"
  // size = synchsafe int (chaque octet a son MSB à 0, on assemble les 7 bits utiles)
  const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]
  return buf.subarray(10 + size)
}

/** Strip un trailer ID3v1 en fin de buffer s'il est présent.
 *  Format : 128 octets fixes commençant par "TAG". */
function stripID3v1(buf: Buffer): Buffer {
  if (buf.length < 128) return buf
  const tail = buf.subarray(buf.length - 128)
  if (tail[0] !== 0x54 || tail[1] !== 0x41 || tail[2] !== 0x47) return buf // pas "TAG"
  return buf.subarray(0, buf.length - 128)
}

/**
 * POST /api/audio/concat
 *
 * Concatène N fichiers audio MP3 en un seul, uploadé dans le bucket `audio`
 * Supabase. Retourne l'URL du résultat.
 *
 * Body : { urls: string[], path?: string }
 *   - `urls` (req) : tableau d'URLs publiques de fichiers MP3 à concaténer
 *     dans cet ordre. ⚠ Doivent tous avoir le MÊME format (même sample rate,
 *     même bitrate) — sinon le résultat peut avoir des artefacts. Les TTS
 *     ElevenLabs (`mp3_44100_128`) sont garantis homogènes.
 *   - `path` (opt) : chemin destination dans le bucket. Défaut : `temp/concat_{ts}.mp3`
 *
 * Retour : { url } (URL publique Supabase)
 *
 * Implémentation : concaténation BINAIRE des buffers MP3. Marche parce que
 * les frames MP3 sont auto-synchronisées (frame sync header) et le decoder
 * resynchronise au début de chaque frame indépendamment. Pas besoin de FFmpeg
 * tant que les fichiers viennent tous de la même source (ElevenLabs ici).
 *
 * Pas de gestion de pause entre les segments en V1 — ElevenLabs ajoute déjà
 * une respiration naturelle en fin de TTS. Si besoin (ex: dialogue percussif),
 * on ajoutera un silence.mp3 préenregistré inséré entre les segments.
 *
 * Use case Hero : multi-perso conversation dans LTX 2.3 lipsync — 1 TTS par
 * perso parlant, concat séquentiel, fichier unique passé à LTX qui cale les
 * lèvres au timing des phrases.
 */
export async function POST(req: NextRequest) {
  try {
    const { urls, path } = await req.json() as { urls?: string[]; path?: string }

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls (string[] non vide) requis' }, { status: 400 })
    }
    if (urls.length === 1) {
      // Cas dégénéré : 1 seule URL → on retourne tel quel sans re-uploader.
      return NextResponse.json({ url: urls[0] })
    }
    if (urls.some(u => typeof u !== 'string' || !u.startsWith('http'))) {
      return NextResponse.json({ error: 'toutes les urls doivent être des http(s) absolues' }, { status: 400 })
    }

    // Download séquentiel des MP3. Parallèle serait plus rapide mais on garde
    // séquentiel pour avoir un message d'erreur clair sur quel index a planté
    // (utile pour debug "le 3ème TTS a échoué").
    const buffers: Buffer[] = []
    for (let i = 0; i < urls.length; i++) {
      const r = await fetch(urls[i])
      if (!r.ok) {
        return NextResponse.json(
          { error: `Échec download urls[${i}] (${urls[i]}): HTTP ${r.status}` },
          { status: 500 },
        )
      }
      buffers.push(Buffer.from(await r.arrayBuffer()))
    }

    // Cleanup ID3 tags pour permettre une concat sans casser PyAV/FFmpeg.
    // ElevenLabs préfixe chaque mp3 d'un header ID3v2 + (parfois) ID3v1 en fin.
    // Si on colle binaire fichier1 + fichier2 sans cleanup, le 2ème ID3v2 se
    // retrouve au milieu du flux → frame_decoder lit ça comme audio corrompu
    // ("Invalid data found when processing input").
    //
    // Stratégie :
    //   - 1er fichier   : on garde tel quel (header ID3v2 utile pour les players)
    //   - Fichiers 2..N : on strip leur ID3v2 en début (header de 10 bytes +
    //     synchsafe size) pour ne garder que les frames MP3
    //   - Fichiers 1..N-1 : on strip leur ID3v1 en fin (128 bytes commençant
    //     par "TAG") pour éviter qu'il finisse au milieu après concat
    const cleaned = buffers.map((buf, i) => {
      let b = buf
      if (i > 0) b = stripID3v2(b)
      if (i < buffers.length - 1) b = stripID3v1(b)
      return b
    })

    const merged = Buffer.concat(cleaned)
    const finalPath = path ?? `temp/concat_${Date.now()}.mp3`

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { error: uploadError } = await supabase.storage
      .from('audio')
      .upload(finalPath, merged, { contentType: 'audio/mpeg', upsert: true })

    if (uploadError) {
      throw new Error(`Supabase upload: ${uploadError.message}`)
    }

    const { data: { publicUrl } } = supabase.storage.from('audio').getPublicUrl(finalPath)

    return NextResponse.json({
      url: publicUrl,
      // Méta utile pour debug (taille totale, nb segments)
      total_bytes: merged.length,
      segments: urls.length,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[audio/concat]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
