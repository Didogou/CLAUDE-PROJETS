import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { translateToEnglish } from '@/lib/ai-utils'

/**
 * POST /api/elevenlabs/sound-effects
 *
 * Génère un effet sonore via ElevenLabs Sound Effects API
 * (https://elevenlabs.io/docs/api-reference/sound-generation).
 *
 * Body :
 *   - text         : prompt FR/EN décrivant le SFX (ex: "sonnette de porte vintage, ding ding bref")
 *   - durationSec? : durée souhaitée en secondes (0.5-22). Si omis : auto par ElevenLabs.
 *   - bookId       : optionnel mais recommandé — sert au préfixe Storage et à
 *                    la banque par-livre. Si absent, upload dans 'orphan/'.
 *
 * Pipeline :
 *   1. POST ElevenLabs /v1/sound-generation → reçoit MP3 binaire
 *   2. Upload Supabase Storage bucket 'audio' au path `${bookId}/sfx/${ts}.mp3`
 *   3. Retourne { url, durationSec } (l'URL est publique et persistante)
 *
 * Refonte 2026-05-12 — Phase 2 MultiTrack timeline (piste SFX).
 */

export const maxDuration = 60
export const runtime = 'nodejs'

interface SfxRequest {
  text: string
  durationSec?: number
  bookId?: string
  /** Nom convivial pour la banque (ex: "Sonnette appartement Duke"). */
  label?: string
}

export async function POST(req: NextRequest) {
  let body: SfxRequest
  try {
    body = await req.json() as SfxRequest
  } catch {
    return NextResponse.json({ error: 'JSON body invalide' }, { status: 400 })
  }
  if (!body.text || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'text manquant' }, { status: 400 })
  }
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY manquante' }, { status: 500 })
  }

  // Clamp durée — ElevenLabs accepte 0.5 à 22s, sinon auto.
  const dur = body.durationSec != null
    ? Math.max(0.5, Math.min(22, body.durationSec))
    : undefined

  try {
    // ── 1. Traduction FR → EN ─────────────────────────────────────────────
    // ElevenLabs Sound Effects est entraîné principalement sur prompts EN —
    // qualité optimale en anglais. translateToEnglish() détecte le FR via
    // marqueurs ("le", "la", "et"…) et bascule sur Claude Haiku ; sinon
    // retourne le texte tel quel (= prompt déjà EN). No-op gratis si EN.
    // Refonte 2026-05-12.
    const promptEn = await translateToEnglish(body.text.trim())

    // ── 2. Appel ElevenLabs Sound Effects ─────────────────────────────────
    const elRes = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: promptEn,
        ...(dur != null && { duration_seconds: dur }),
        // prompt_influence : 0-1 (default 0.3). Plus haut = plus fidèle au
        // prompt mais moins créatif. Hero garde le default.
      }),
    })
    if (!elRes.ok) {
      const errText = await elRes.text()
      console.error('[sound-effects] ElevenLabs HTTP', elRes.status, errText.slice(0, 300))
      return NextResponse.json(
        { error: `ElevenLabs HTTP ${elRes.status} — ${errText.slice(0, 200)}` },
        { status: 502 },
      )
    }
    const audioBuffer = Buffer.from(await elRes.arrayBuffer())

    // ── 2. Upload Supabase Storage ────────────────────────────────────────
    const ts = Date.now()
    const safePrefix = body.bookId
      ? `books/${body.bookId}/sfx`
      : 'orphan/sfx'
    const filename = `${ts}.mp3`
    const fullPath = `${safePrefix}/${filename}`

    const { error: uploadErr } = await supabaseAdmin.storage
      .from('audio')
      .upload(fullPath, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: false,
      })
    if (uploadErr) {
      console.error('[sound-effects] Upload Supabase échoué:', uploadErr.message)
      return NextResponse.json(
        { error: `Upload Storage échoué : ${uploadErr.message}` },
        { status: 500 },
      )
    }
    const { data: pub } = supabaseAdmin.storage.from('audio').getPublicUrl(fullPath)

    // ── 3. Réponse ────────────────────────────────────────────────────────
    return NextResponse.json({
      url: pub.publicUrl,
      durationSec: dur ?? null,  // null si auto (le caller lira la vraie via <audio>.duration)
      label: body.label ?? body.text.slice(0, 60),
      bytes: audioBuffer.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sound-effects] erreur:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
