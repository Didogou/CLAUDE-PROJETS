import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'

export const maxDuration = 60

// POST { image_url } — supprime le fond d'une image via Replicate (lucataco/remove-bg)
// Retourne { image_url } avec un PNG transparent

function replicateRequest(path: string, method: 'GET' | 'POST', token: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined
    const req = https.request(
      {
        hostname: 'api.replicate.com',
        path,
        method,
        timeout: 65_000,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          ...(method === 'POST' ? { 'Prefer': 'wait=55' } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
          catch (e) { reject(e) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout remove-bg')) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

export async function POST(req: NextRequest) {
  try {
    const { image_url } = await req.json() as { image_url: string }
    if (!image_url) return NextResponse.json({ error: 'image_url requis' }, { status: 400 })

    const token = process.env.REPLICATE_API_TOKEN
    if (!token) return NextResponse.json({ error: 'REPLICATE_API_TOKEN non configuré' }, { status: 500 })

    const prediction = await replicateRequest(
      '/v1/models/lucataco/remove-bg/predictions',
      'POST',
      token,
      { input: { image: image_url } }
    )

    if (prediction.error) throw new Error(prediction.error)
    if (prediction.detail) throw new Error(prediction.detail)

    // Résultat synchrone (wait=55)
    if (prediction.status === 'succeeded') {
      const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
      return NextResponse.json({ image_url: output })
    }

    // Polling si pas encore terminé
    const predId = prediction.id
    if (!predId) throw new Error(`Réponse inattendue remove-bg : ${JSON.stringify(prediction).slice(0, 200)}`)

    const start = Date.now()
    while (Date.now() - start < 50_000) {
      await new Promise(r => setTimeout(r, 2000))
      const poll = await replicateRequest(`/v1/predictions/${predId}`, 'GET', token)
      if (poll.status === 'succeeded') {
        const output = Array.isArray(poll.output) ? poll.output[0] : poll.output
        return NextResponse.json({ image_url: output })
      }
      if (poll.status === 'failed' || poll.status === 'canceled') {
        throw new Error(poll.error ?? poll.status)
      }
    }
    throw new Error('Délai dépassé remove-bg')
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
