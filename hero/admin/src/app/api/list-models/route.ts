import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'GOOGLE_AI_API_KEY non configuré' }, { status: 500 })

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
  const data = await res.json()

  // Filtrer uniquement les modèles vidéo
  const videoModels = (data.models ?? []).filter((m: any) =>
    m.name?.toLowerCase().includes('veo') ||
    m.supportedGenerationMethods?.includes('predictLongRunning')
  )

  return NextResponse.json({ video_models: videoModels, all_count: data.models?.length ?? 0 })
}
