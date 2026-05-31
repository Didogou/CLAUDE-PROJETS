import 'server-only';

/**
 * Modération automatique via Google Cloud Vision SafeSearch.
 * - Gratuit jusqu'à 1 000 unités/mois, puis ~1,50 USD / 1 000.
 * - Si la clé n'est pas configurée → la modération est désactivée (fail-open),
 *   on log un warning et on laisse passer. Permet de dev sans la clé.
 * - Si l'API renvoie une erreur → fail-open aussi, pour ne pas bloquer Karine
 *   si Google a un incident. Les uploads passeront tels quels.
 *
 * Seuils de rejet :
 *   adult     ≥ LIKELY  → rejet
 *   violence  ≥ LIKELY  → rejet
 *   racy      ≥ VERY_LIKELY → rejet (plus permissif sur le suggestif)
 *
 * Variables d'env requises (côté Vercel) :
 *   - GOOGLE_CLOUD_VISION_API_KEY
 */

type Verdict = { safe: boolean; reason?: string };

const BAD_LIKELIHOODS = ['LIKELY', 'VERY_LIKELY'];

export async function moderatePhoto(file: File): Promise<Verdict> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    console.warn('[moderation] GOOGLE_CLOUD_VISION_API_KEY non configurée — modération désactivée');
    return { safe: true };
  }

  let base64: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    base64 = buffer.toString('base64');
  } catch (e) {
    console.warn('[moderation] échec lecture fichier', e);
    return { safe: true }; // fail-open
  }

  let data: unknown;
  try {
    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64 },
              features: [{ type: 'SAFE_SEARCH_DETECTION' }],
            },
          ],
        }),
      },
    );
    if (!res.ok) {
      console.warn('[moderation] Vision API erreur', res.status, await res.text());
      return { safe: true }; // fail-open
    }
    data = await res.json();
  } catch (e) {
    console.warn('[moderation] Vision API exception', e);
    return { safe: true };
  }

  const ann = (data as {
    responses?: Array<{
      safeSearchAnnotation?: {
        adult?: string;
        violence?: string;
        racy?: string;
        spoof?: string;
        medical?: string;
      };
    }>;
  })?.responses?.[0]?.safeSearchAnnotation;

  if (!ann) return { safe: true };

  if (BAD_LIKELIHOODS.includes(ann.adult ?? ''))
    return { safe: false, reason: 'Photo refusée : contenu adulte détecté.' };
  if (BAD_LIKELIHOODS.includes(ann.violence ?? ''))
    return { safe: false, reason: 'Photo refusée : contenu violent détecté.' };
  if (ann.racy === 'VERY_LIKELY')
    return { safe: false, reason: 'Photo refusée : contenu suggestif détecté.' };

  return { safe: true };
}
