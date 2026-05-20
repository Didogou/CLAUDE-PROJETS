/**
 * Migration des `section.images[]` JSONB legacy vers les nouvelles tables :
 *   assets_image / assets_animation / assets_audio / assets_text
 *   asset_usage / section_timeline
 *
 * Doit être lancé APRÈS les migrations 082 + 083 (= tables + index créés).
 *
 * IDEMPOTENT : DELETE FROM section_timeline + asset_usage + assets_* avant
 * INSERT. À chaque run, on repart d'un état propre. À utiliser sur la DB
 * locale pendant le dev V2. Pour la prod (= cloud), on fera la migration
 * une seule fois avec backup préalable.
 *
 * Usage :
 *   cd hero/admin && node scripts/migrate-section-images-to-assets.mjs
 *
 * Gère les 3 kinds :
 *   - 'image'      → 1 asset_image + 1 row section_timeline (track=video_image)
 *   - 'animation'  → N assets_animation (1 par pellicule) + 1 row timeline par pellicule
 *                    + assets_audio pour chaque audioTrack + assets_text pour textOverlays
 *   - 'choice'     → 1 asset_image (image du choix) + 1 row timeline
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_ROOT = resolve(__dirname, '..')

function parseEnvFile(path) {
  const raw = readFileSync(path, 'utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const out = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"'))
        || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[m[1]] = val
  }
  return out
}

const env = parseEnvFile(resolve(ADMIN_ROOT, '.env.local'))
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Creds Supabase manquants dans .env.local')

console.log('Target DB :', url)

const sb = createClient(url, key, { auth: { persistSession: false } })

// ── Step 1 : RESET — wipe les tables V2 (skip avec --no-wipe pour la prod) ─

const noWipe = process.argv.includes('--no-wipe')

if (noWipe) {
  console.log('\n1/4 — Wipe SKIPPED (mode --no-wipe). Les rows V2 existantes')
  console.log('       ne seront PAS écrasées. Le script peut créer des doublons')
  console.log('       si les sections ont déjà été migrées (ON CONFLICT IGNORÉ).')
} else {
  console.log('\n1/4 — Wipe tables V2 (idempotence)…')
  console.log('       ⚠ DANGER : efface toute la banque V2. Utilise --no-wipe')
  console.log('         pour la prod ou les data partiellement migrées.')
  await sb.from('section_timeline').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await sb.from('asset_usage').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await sb.from('assets_image').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await sb.from('assets_animation').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await sb.from('assets_audio').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await sb.from('assets_text').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('  → OK')
}

// ── Step 2 : Fetch toutes les sections avec leur book_id ─────────────────

console.log('\n2/4 — Fetch sections + book_id…')
const { data: sections, error: secErr } = await sb
  .from('sections')
  .select('id, book_id, images')
if (secErr) throw new Error(`Fetch sections : ${secErr.message}`)
console.log(`  → ${sections.length} sections`)

// ── Step 3 : Décompose chaque section.images[] en rows V2 ────────────────

console.log('\n3/4 — Décomposition + INSERT…')

const stats = {
  imageAssets: 0,
  animationAssets: 0,
  audioAssets: 0,
  textAssets: 0,
  timelineRows: 0,
  usageRows: 0,
  skippedNoUrl: 0,
}

for (const section of sections) {
  const images = (section.images ?? [])
  if (images.length === 0) continue

  let positionIdx = 0
  let cursorMs = 0

  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const kind = img.kind ?? 'image'

    // ── kind='image' ou kind='choice' ──
    if (kind === 'image' || kind === 'choice') {
      const imgUrl = kind === 'choice' ? (img.choice_data?.image_url ?? img.url) : img.url
      if (!imgUrl) { stats.skippedNoUrl++; continue }

      const { data: assetImg, error: aiErr } = await sb
        .from('assets_image')
        .insert({
          url: imgUrl,
          label: img.description?.slice(0, 60) ?? null,
          description: img.description ?? null,
          prompt_fr: img.prompt_fr ?? null,
          prompt_en: img.prompt_en ?? null,
          style: img.style ?? null,
          comfyui_settings: img.comfyui_settings ?? null,
          source_type: 'generated',
        })
        .select('id')
        .single()
      if (aiErr) { console.warn(`  ⚠ INSERT assets_image: ${aiErr.message}`); continue }
      stats.imageAssets++

      // asset_usage
      await sb.from('asset_usage').insert({
        asset_type: 'image',
        asset_id: assetImg.id,
        book_id: section.book_id,
        section_id: section.id,
      })
      stats.usageRows++

      // section_timeline (= 1 bloc image fixe)
      const durMs = 3000  // default 3s pour image fixe
      await sb.from('section_timeline').insert({
        section_id: section.id,
        position_idx: positionIdx++,
        track: 'video_image',
        asset_type: 'image',
        asset_id: assetImg.id,
        start_ms: cursorMs,
        duration_ms: durMs,
        overrides: kind === 'choice'
          ? { kind: 'choice', choice_data: img.choice_data }
          : null,
      })
      stats.timelineRows++
      cursorMs += durMs
    }

    // ── kind='animation' ──
    else if (kind === 'animation') {
      const pellicules = img.pellicules ?? []
      // Si pas de pellicules : on traite comme un placeholder (= 1 asset
      // animation vide avec firstFrameUrl si img.url existe)
      if (pellicules.length === 0) {
        const { data: assetAnim, error: aaErr } = await sb
          .from('assets_animation')
          .insert({
            video_url: img.base_video_url ?? null,
            first_frame_url: img.first_frame_url ?? img.url ?? null,
            last_frame_url: img.last_frame_url ?? null,
            label: img.description?.slice(0, 60) ?? `Animation`,
            character_ids: img.tags?.characters ?? [],
            shots: [],
            type: 'animation',
            source: 'ltx',
          })
          .select('id')
          .single()
        if (aaErr) { console.warn(`  ⚠ INSERT assets_animation: ${aaErr.message}`); continue }
        stats.animationAssets++

        await sb.from('asset_usage').insert({
          asset_type: 'animation',
          asset_id: assetAnim.id,
          book_id: section.book_id,
          section_id: section.id,
        })
        stats.usageRows++

        const durMs = 4000
        await sb.from('section_timeline').insert({
          section_id: section.id,
          position_idx: positionIdx++,
          track: 'video_image',
          asset_type: 'animation',
          asset_id: assetAnim.id,
          start_ms: cursorMs,
          duration_ms: durMs,
        })
        stats.timelineRows++
        cursorMs += durMs
        continue
      }

      // Pour chaque pellicule réelle : 1 asset_animation
      for (const pell of pellicules) {
        const { data: assetAnim, error: aaErr } = await sb
          .from('assets_animation')
          .insert({
            video_url: pell.videoUrl ?? null,
            first_frame_url: pell.firstFrameUrl ?? null,
            last_frame_url: pell.lastFrameUrl ?? null,
            label: pell.label ?? img.description?.slice(0, 40) ?? null,
            scene_visible: pell.scene_visible ?? null,
            scene_offscreen: pell.scene_offscreen ?? null,
            characters_appearance: pell.characters_appearance ?? null,
            character_ids: pell.characterIds ?? [],
            shots: pell.shots ?? [],
            type: pell.type ?? 'animation',
            source: pell.source ?? 'ltx',
            v2v_continue: pell.v2vContinue ?? false,
            exit_data: pell.exit ?? null,
          })
          .select('id')
          .single()
        if (aaErr) { console.warn(`  ⚠ INSERT assets_animation: ${aaErr.message}`); continue }
        stats.animationAssets++

        await sb.from('asset_usage').insert({
          asset_type: 'animation',
          asset_id: assetAnim.id,
          book_id: section.book_id,
          section_id: section.id,
        })
        stats.usageRows++

        // Durée pellicule = somme shots[].duration
        const durSec = (pell.shots ?? []).reduce((s, sh) => s + (sh.duration ?? 4), 0) || 4
        const durMs = durSec * 1000

        await sb.from('section_timeline').insert({
          section_id: section.id,
          position_idx: positionIdx++,
          track: 'video_image',
          asset_type: 'animation',
          asset_id: assetAnim.id,
          start_ms: cursorMs,
          duration_ms: durMs,
        })
        stats.timelineRows++

        // Audio tracks de cette pellicule
        for (const audio of pell.audioTracks ?? []) {
          if (!audio.audioUrl) continue
          const { data: assetAudio, error: auErr } = await sb
            .from('assets_audio')
            .insert({
              audio_url: audio.audioUrl,
              kind: audio.kind ?? 'sfx',
              label: audio.label ?? null,
              duration_sec: audio.durationMs ? audio.durationMs / 1000 : null,
              source_type: 'generated',
            })
            .select('id')
            .single()
          if (auErr) { console.warn(`  ⚠ INSERT assets_audio: ${auErr.message}`); continue }
          stats.audioAssets++

          await sb.from('asset_usage').insert({
            asset_type: 'audio',
            asset_id: assetAudio.id,
            book_id: section.book_id,
            section_id: section.id,
          })
          stats.usageRows++

          await sb.from('section_timeline').insert({
            section_id: section.id,
            position_idx: positionIdx++,
            track: audio.kind === 'music' ? 'music' : 'sfx',
            asset_type: 'audio',
            asset_id: assetAudio.id,
            start_ms: cursorMs + (audio.startMs ?? 0),
            duration_ms: audio.durationMs ?? 3000,
            overrides: {
              volume: audio.volume,
              fadeInMs: audio.fadeInMs,
              fadeOutMs: audio.fadeOutMs,
              loop: audio.loop,
            },
          })
          stats.timelineRows++
        }

        // Text overlays per shot
        let shotCursorMs = cursorMs
        for (const shot of pell.shots ?? []) {
          const shotDurMs = (shot.duration ?? 4) * 1000
          for (const ovl of shot.textOverlays ?? []) {
            const { data: assetText, error: atErr } = await sb
              .from('assets_text')
              .insert({
                text: ovl.text,
                template: ovl.template ?? 'fade',
                position: ovl.position ?? 'center',
                size: ovl.size ?? 'lg',
                default_duration_sec: ovl.durationSec ?? 3,
              })
              .select('id')
              .single()
            if (atErr) { console.warn(`  ⚠ INSERT assets_text: ${atErr.message}`); continue }
            stats.textAssets++

            await sb.from('asset_usage').insert({
              asset_type: 'text',
              asset_id: assetText.id,
              book_id: section.book_id,
              section_id: section.id,
            })
            stats.usageRows++

            await sb.from('section_timeline').insert({
              section_id: section.id,
              position_idx: positionIdx++,
              track: 'text',
              asset_type: 'text',
              asset_id: assetText.id,
              start_ms: shotCursorMs + (ovl.startSec ?? 0) * 1000,
              duration_ms: (ovl.durationSec ?? 3) * 1000,
            })
            stats.timelineRows++
          }
          shotCursorMs += shotDurMs
        }

        cursorMs += durMs
      }
    }
  }
}

console.log('  → OK')
console.log('\n4/4 — Stats :')
console.log(`  Assets image      : ${stats.imageAssets}`)
console.log(`  Assets animation  : ${stats.animationAssets}`)
console.log(`  Assets audio      : ${stats.audioAssets}`)
console.log(`  Assets text       : ${stats.textAssets}`)
console.log(`  Asset usage rows  : ${stats.usageRows}`)
console.log(`  Timeline rows     : ${stats.timelineRows}`)
console.log(`  Skipped (no url)  : ${stats.skippedNoUrl}`)
console.log('\n✓ Migration terminée.')
