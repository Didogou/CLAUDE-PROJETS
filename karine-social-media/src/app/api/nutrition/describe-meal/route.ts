import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { createClient } from '@/lib/supabase/server';
import { describeMealFromImage } from '@/lib/claude-meal-vision';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Compression des photos repas :
//  - resize à 1280px max sur le plus grand côté (largement suffisant
//    pour Claude Vision + vignette + lightbox)
//  - JPEG quality 80 (bon compromis qualité/taille)
//  - cible 100-300 KB par photo au lieu de 2-5 MB brut
//
// Conséquence : Vision reçoit aussi la version compressée (gain en
// bande passante + temps de transit + coût API Claude qui facture
// au token image ~= proportionnel à la résolution).
const COMPRESS_MAX_SIDE = 1280;
const COMPRESS_JPEG_QUALITY = 80;

/**
 * POST /api/nutrition/describe-meal
 *
 * Multipart/form-data avec un champ 'photo' (image).
 *
 * Pipeline :
 *  1. Reçoit la photo
 *  2. Appelle Claude Haiku Vision pour générer une description
 *     textuelle ("une assiette de X avec Y, environ 200g")
 *  3. Retourne cette description au front
 *  4. Le front injecte le texte dans la textarea de saisie
 *     naturelle puis lance le parse normal
 *
 * Pourquoi 2 étapes (Vision → parse) au lieu d'un parse direct
 * avec image ? Pour réutiliser 100% du pipeline existant
 * (correction → Mistral → Ciqual cascade → accompagnements) et
 * permettre à l'abonnée de corriger la description avant le parse.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  // Rate-limit Claude Vision (cout API explosif si exploite).
  // 5 req/min par user = largement assez pour usage humain legitime.
  const rl = checkRateLimit({
    req: request, key: 'describe-meal', windowMs: 60_000, max: 5, scope: user.id,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.error },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Form invalide (multipart/form-data attendu)' },
      { status: 400 },
    );
  }

  const photo = formData.get('photo');
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: 'Photo manquante' }, { status: 400 });
  }
  if (photo.size === 0) {
    return NextResponse.json({ error: 'Photo vide' }, { status: 400 });
  }
  // 8 Mo max (caméras modernes), Vercel max 4.5 MB body en fonction
  // de la version. On laisse passer mais on prévoit en cas de gros.
  if (photo.size > 8 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'Photo trop grande (max 8 Mo)' },
      { status: 413 },
    );
  }

  const mimeType = photo.type || 'image/jpeg';
  const mediaType =
    mimeType === 'image/png' ||
    mimeType === 'image/webp' ||
    mimeType === 'image/gif'
      ? mimeType
      : 'image/jpeg';

  const arrayBuffer = await photo.arrayBuffer();
  const rawBuffer = Buffer.from(arrayBuffer);

  // Compression : resize + JPEG qualité 80 (1 seule fois, réutilisée
  // pour Vision ET Storage). Si la compression plante (format
  // inconnu, image corrompue), on retombe sur le buffer brut.
  let compressedBuffer: Buffer;
  let compressedMimeType: 'image/jpeg' = 'image/jpeg';
  try {
    compressedBuffer = await sharp(rawBuffer)
      .rotate() // applique l'EXIF orientation (photos téléphone)
      // SECURITE RGPD : sharp STRIPPE par défaut tous les EXIF
      // (GPS, DateTime, Model, IMEI, XMP, IPTC). C'est exactement
      // ce qu'on veut. Ne PAS appeler .withMetadata() ici : ça
      // ferait l'inverse (keepMetadata = 0b11111 = tout préservé).
      // Le .rotate() au-dessus lit l'EXIF orientation pour pivoter
      // correctement la photo, puis l'EXIF est strippé en sortie.
      .resize(COMPRESS_MAX_SIDE, COMPRESS_MAX_SIDE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: COMPRESS_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    console.warn('[describe-meal] sharp compress failed, using raw:', e);
    compressedBuffer = rawBuffer;
  }

  // En parallèle : décrire via Vision + uploader en Storage pour
  // l'afficher en vignette côté front. Les 2 utilisent le buffer
  // compressé (cohérent + économe).
  // SECURITE : UUID imprévisible (au lieu de Date.now() devinable
  // par brute-force sur une fenêtre de quelques secondes). Le path
  // reste structuré {user_id}/{uuid}.jpg pour les RLS storage qui
  // filtrent sur foldername[0] = auth.uid().
  const photoPath = `${user.id}/${randomUUID()}.jpg`;
  const [descriptionResult, uploadResult] = await Promise.allSettled([
    describeMealFromImage(
      compressedBuffer,
      compressedBuffer === rawBuffer ? mediaType : compressedMimeType,
    ),
    (supabase as any).storage
      .from('nutrition-meal-photos')
      .upload(photoPath, compressedBuffer, {
        contentType: compressedBuffer === rawBuffer ? mediaType : compressedMimeType,
        upsert: false,
      }),
  ]);

  if (descriptionResult.status === 'rejected') {
    const msg =
      descriptionResult.reason instanceof Error
        ? descriptionResult.reason.message
        : 'Vision indisponible';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  const description: string | null = descriptionResult.value;
  if (!description) {
    return NextResponse.json(
      {
        error:
          "Aucun aliment détecté sur la photo. Essaie avec une vue plus claire du plat.",
      },
      { status: 422 },
    );
  }

  // SECURITE : ne PAS retourner une URL publique. Le bucket est privé,
  // on retourne le PATH + une signed URL temporaire (5 min) pour
  // l'affichage immédiat en vignette. Plus tard, le front demande de
  // nouvelles signed URLs via /api/nutrition/photo/[photoId].
  let photoPathResult: string | null = null;
  let photoSignedUrl: string | null = null;
  if (
    uploadResult.status === 'fulfilled' &&
    !uploadResult.value.error
  ) {
    photoPathResult = photoPath;
    try {
      const { data: signed } = await (supabase as any).storage
        .from('nutrition-meal-photos')
        .createSignedUrl(photoPath, 300); // 5 min pour la vignette immédiate
      photoSignedUrl = signed?.signedUrl ?? null;
    } catch (e) {
      console.warn('[describe-meal] signed URL failed:', e);
    }
  } else if (uploadResult.status === 'rejected') {
    console.warn('[describe-meal] upload failed:', uploadResult.reason);
  }

  return NextResponse.json({
    description,
    photoPath: photoPathResult,
    photoSignedUrl,
    // Compat retro : si le client ancien attend `photoUrl`, on lui
    // refile la signed URL temporaire. À retirer plus tard quand
    // le client est entièrement migré.
    photoUrl: photoSignedUrl,
  });
}
