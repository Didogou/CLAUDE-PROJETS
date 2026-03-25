import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 15

const SECTION_TYPE_TAGS: Record<string, string> = {
  'Narration':   'ambient fantasy dungeon',
  'Combat':      'battle epic action fight',
  'Énigme':      'mystery puzzle suspense',
  'Repos':       'peaceful calm relaxing tavern',
  'Découverte':  'adventure exploration wonder',
  'Boss':        'epic boss dramatic intense',
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.FREESOUND_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'FREESOUND_API_KEY non configurée' }, { status: 500 })

  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query')
  const sectionType = searchParams.get('type') ?? ''

  const searchQuery = query || SECTION_TYPE_TAGS[sectionType] || 'ambient fantasy'

  const url = new URL('https://freesound.org/apiv2/search/text/')
  url.searchParams.set('query', searchQuery)
  url.searchParams.set('token', apiKey)
  url.searchParams.set('fields', 'id,name,previews,duration,username,tags,license')
  url.searchParams.set('filter', 'duration:[10 TO 300]')
  url.searchParams.set('page_size', '12')
  url.searchParams.set('sort', 'score')

  try {
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`Freesound error: ${res.status}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
