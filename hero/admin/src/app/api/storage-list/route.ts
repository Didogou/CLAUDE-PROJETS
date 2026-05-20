import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/storage-list?prefix=X[&bucket=Y]
 *
 * Helper dev pour lister les fichiers d'un préfixe Supabase Storage.
 * Utile pour retrouver des images orphelines (genre après cascade delete
 * d'un book qui n'efface pas les fichiers storage).
 *
 * Bucket par défaut : 'images'.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const prefix = sp.get('prefix') ?? ''
    const bucket = sp.get('bucket') ?? 'images'

    const { data, error } = await supabaseAdmin
      .storage
      .from(bucket)
      .list(prefix, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

    if (error) throw error

    // Construit l'URL publique pour chaque fichier
    const items = (data ?? []).map(f => {
      const fullPath = prefix ? `${prefix}/${f.name}` : f.name
      const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(fullPath)
      return {
        name: f.name,
        path: fullPath,
        size: f.metadata?.size ?? null,
        created_at: f.created_at,
        url: urlData.publicUrl,
        is_folder: !f.id,  // dossiers Supabase Storage = entries sans id
      }
    })

    return NextResponse.json({ prefix, bucket, items })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
