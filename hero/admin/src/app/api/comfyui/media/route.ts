import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/comfyui/media?filename=X&subfolder=Y&type=Z
 *
 * Proxy qui sert un fichier depuis ComfyUI (bypass des restrictions CORS/origin
 * ajoutées dans les versions récentes de ComfyUI).
 *
 * Le browser fetch → Next.js (même origine) → ComfyUI server-side → stream retour.
 */
export async function GET(req: NextRequest) {
  const filename = req.nextUrl.searchParams.get('filename')
  const subfolder = req.nextUrl.searchParams.get('subfolder') ?? ''
  const type = req.nextUrl.searchParams.get('type') ?? 'output'

  if (!filename) {
    return NextResponse.json({ error: 'filename requis' }, { status: 400 })
  }

  const comfyUrl = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188'
  const url = `${comfyUrl}/api/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Hero-Admin-Proxy' },
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: `ComfyUI retourne ${res.status}` },
        { status: res.status },
      )
    }

    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    const buffer = await res.arrayBuffer()

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Proxy fail: ${message}` }, { status: 502 })
  }
}
