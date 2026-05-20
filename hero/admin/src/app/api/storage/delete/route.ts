import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * DELETE un ou plusieurs fichiers Supabase Storage via leur URL publique.
 *
 * Body : { urls: string[] }
 * → Extrait `{bucket, path}` depuis chaque URL publique Supabase et supprime
 *   en groupes par bucket (images, videos, audio).
 *
 * Refonte 2026-05-13 : étendu pour gérer plusieurs buckets (avant : images
 * uniquement). Utilisé par la corbeille pellicule du Studio Section et
 * historiquement par le PlanWizard pour nettoyer les images orphelines.
 */
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { urls?: string[] }
    const urls = body.urls ?? []
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ deleted: 0 })
    }

    // Regex générique : capture le bucket ET le path depuis l'URL publique
    // Supabase format "https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>".
    const byBucket = new Map<string, string[]>()
    let skipped = 0
    for (const raw of urls) {
      try {
        const u = new URL(raw.split('?')[0])
        const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
        if (m) {
          const bucket = m[1]
          const path = decodeURIComponent(m[2])
          const list = byBucket.get(bucket) ?? []
          list.push(path)
          byBucket.set(bucket, list)
        } else {
          skipped++
        }
      } catch {
        skipped++
      }
    }

    if (byBucket.size === 0) {
      return NextResponse.json({ deleted: 0, skipped })
    }

    let totalDeleted = 0
    const errors: Array<{ bucket: string; error: string }> = []
    for (const [bucket, paths] of byBucket) {
      const { data, error } = await supabaseAdmin.storage.from(bucket).remove(paths)
      if (error) {
        console.error(`[storage/delete] ${bucket} error:`, error)
        errors.push({ bucket, error: error.message })
      } else {
        totalDeleted += data?.length ?? 0
      }
    }
    if (errors.length > 0) {
      return NextResponse.json({ deleted: totalDeleted, skipped, errors }, { status: 207 })
    }
    console.log(`[storage/delete] Deleted ${totalDeleted} files across ${byBucket.size} bucket(s)`)
    return NextResponse.json({ deleted: totalDeleted, skipped })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[storage/delete] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
