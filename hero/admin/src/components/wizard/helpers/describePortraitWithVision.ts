/**
 * Helper client : envoie une URL d'image à /api/describe-portrait et récupère
 * une description physique courte (1-2 phrases anglais, descripteurs comma-separated).
 *
 * Utilisé par generateCharacterVariants pour enrichir automatiquement le prompt
 * de régen sans demander à l'utilisateur de tout retaper.
 *
 * En cas d'erreur, renvoie une string vide plutôt que de throw → le helper
 * appelant peut tomber sur le prompt utilisateur d'origine sans planter.
 */
export async function describePortraitWithVision(imageUrl: string): Promise<string> {
  try {
    const res = await fetch('/api/describe-portrait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      console.warn('[describePortraitWithVision] API a renvoyé', res.status, txt.slice(0, 200))
      return ''
    }
    const d = await res.json()
    return (d.description as string | undefined)?.trim() ?? ''
  } catch (err) {
    console.warn('[describePortraitWithVision] échec :', err instanceof Error ? err.message : String(err))
    return ''
  }
}
