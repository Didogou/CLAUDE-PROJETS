import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const token = process.env.FREESOUND_API_KEY
  if (!token) return NextResponse.json({ error: 'FREESOUND_API_KEY not configured' }, { status: 500 })

  const q = req.nextUrl.searchParams.get('q') ?? 'paper fold'
  const url = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}&fields=id,name,previews,username,license&page_size=12&token=${token}`

  const res = await fetch(url)
  if (!res.ok) return NextResponse.json({ error: `Freesound error ${res.status}` }, { status: 502 })
  const data = await res.json()
  return NextResponse.json(data)
}
