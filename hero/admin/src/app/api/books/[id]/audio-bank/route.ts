import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * /api/books/[id]/audio-bank
 *
 * Banque audio par-livre (Phase 2 timeline multi-pistes 2026-05-12).
 * Persiste les SFX et musiques générés/importés pour réutilisation entre
 * pellicules de toutes les sections.
 *
 * Stocké dans `books.audio_bank` jsonb (cf migration 081_books_audio_bank.sql).
 *
 * GET   → retourne { sfx: [...], music: [...] }
 * POST  → ajoute une entrée { kind: 'sfx'|'music', entry: { id, label, url, durationSec, createdAt? } }
 * DELETE ?id=xxx → retire une entrée (par id) — utile pour cleanup
 */

export const runtime = 'nodejs'

interface AudioEntry {
  id: string
  label: string
  url: string
  durationSec: number
  createdAt: number
}

interface AudioBank {
  sfx: AudioEntry[]
  music: AudioEntry[]
}

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { data, error } = await supabaseAdmin
      .from('books')
      .select('audio_bank')
      .eq('id', id)
      .single()
    if (error) {
      // Migration 081 (colonne books.audio_bank) pas encore appliquée → on
      // retourne une banque vide au lieu de planter. Code 42703 = "undefined
      // column". Tout autre code = vrai problème, on log et on return vide
      // aussi pour ne pas casser l'UI.
      const errAny = error as { code?: string; message?: string }
      if (errAny.code === '42703' || (errAny.message ?? '').includes('audio_bank')) {
        console.warn('[audio-bank GET] colonne audio_bank manquante (migration 081 à appliquer) — fallback bank vide')
      } else {
        console.warn('[audio-bank GET] read failed (non-bloquant):', errAny.message)
      }
      return NextResponse.json({ sfx: [], music: [] })
    }
    const bank: AudioBank = (data?.audio_bank as AudioBank) ?? { sfx: [], music: [] }
    return NextResponse.json(bank)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[audio-bank GET] exception (fallback bank vide):', msg)
    return NextResponse.json({ sfx: [], music: [] })
  }
}

// ── POST (ajout entrée) ────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json() as { kind?: 'sfx' | 'music'; entry?: Partial<AudioEntry> }
    if (!body.kind || !['sfx', 'music'].includes(body.kind)) {
      return NextResponse.json({ error: 'kind invalide (sfx|music attendu)' }, { status: 400 })
    }
    if (!body.entry?.id || !body.entry?.url || !body.entry?.label) {
      return NextResponse.json({ error: 'entry incomplète (id, url, label requis)' }, { status: 400 })
    }
    const newEntry: AudioEntry = {
      id: body.entry.id,
      label: body.entry.label,
      url: body.entry.url,
      durationSec: body.entry.durationSec ?? 3,
      createdAt: body.entry.createdAt ?? Date.now(),
    }

    // Lit la banque actuelle puis update (pas de jsonb_insert atomique simple
    // côté Supabase JS — le read-modify-write est OK pour un usage léger).
    const { data: cur, error: readErr } = await supabaseAdmin
      .from('books')
      .select('audio_bank')
      .eq('id', id)
      .single()
    if (readErr) throw readErr
    const bank: AudioBank = (cur?.audio_bank as AudioBank) ?? { sfx: [], music: [] }
    // Dédupe par id (si le caller renvoie un id existant, on remplace)
    bank[body.kind] = [
      newEntry,
      ...bank[body.kind].filter(e => e.id !== newEntry.id),
    ]
    const { error: upErr } = await supabaseAdmin
      .from('books')
      .update({ audio_bank: bank })
      .eq('id', id)
    if (upErr) throw upErr
    return NextResponse.json({ ok: true, entry: newEntry, total: bank[body.kind].length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── DELETE ?id=xxx&kind=sfx (retrait d'une entrée par id) ─────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const entryId = req.nextUrl.searchParams.get('id')
    const kind = req.nextUrl.searchParams.get('kind') as 'sfx' | 'music' | null
    if (!entryId) {
      return NextResponse.json({ error: 'query param `id` requis' }, { status: 400 })
    }
    if (!kind || !['sfx', 'music'].includes(kind)) {
      return NextResponse.json({ error: 'query param `kind` (sfx|music) requis' }, { status: 400 })
    }
    const { data: cur, error: readErr } = await supabaseAdmin
      .from('books')
      .select('audio_bank')
      .eq('id', id)
      .single()
    if (readErr) throw readErr
    const bank: AudioBank = (cur?.audio_bank as AudioBank) ?? { sfx: [], music: [] }
    bank[kind] = bank[kind].filter(e => e.id !== entryId)
    const { error: upErr } = await supabaseAdmin
      .from('books')
      .update({ audio_bank: bank })
      .eq('id', id)
    if (upErr) throw upErr
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
