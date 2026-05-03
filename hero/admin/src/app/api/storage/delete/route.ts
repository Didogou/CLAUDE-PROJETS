import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * DELETE un ou plusieurs fichiers du bucket Supabase "images" via leur URL publique.
 *
 * Body : { urls: string[] }
 * → Extrait le path depuis chaque URL publique Supabase et supprime.
 *
 * Utilisé par le PlanWizard pour nettoyer les images non sélectionnées lors de
 * la fermeture d'un sous-wizard / du wizard principal.
 */
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { urls?: string[] }
    const urls = body.urls ?? []
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ deleted: 0 })
    }

    // Extraction du path relatif depuis les URLs publiques Supabase.
    // Format attendu : "https://<project>.supabase.co/storage/v1/object/public/images/<path>"
    const paths: string[] = []
    for (const raw of urls) {
      try {
        const u = new URL(raw.split('?')[0]) // strip query string
        const m = u.pathname.match(/\/storage\/v1\/object\/public\/images\/(.+)$/)
        if (m) paths.push(decodeURIComponent(m[1]))
      } catch { /* URL malformée → ignore */ }
    }

    if (paths.length === 0) {
      return NextResponse.json({ deleted: 0, skipped: urls.length })
    }

    const { data, error } = await supabaseAdmin.storage.from('images').remove(paths)
    if (error) {
      console.error('[storage/delete] Supabase error:', error)
      return NextResponse.json({ error: error.message, attempted: paths.length }, { status: 500 })
    }
    console.log('[storage/delete] Deleted', data?.length ?? 0, 'files')
    return NextResponse.json({ deleted: data?.length ?? 0, paths })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[storage/delete] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
