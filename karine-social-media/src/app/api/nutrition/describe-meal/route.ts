import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { describeMealFromImage } from '@/lib/claude-meal-vision';

export const runtime = 'nodejs';
export const maxDuration = 30;

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

  let description: string | null;
  try {
    const arrayBuffer = await photo.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    description = await describeMealFromImage(buffer, mediaType);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Vision indisponible';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!description) {
    return NextResponse.json(
      {
        error:
          "Aucun aliment détecté sur la photo. Essaie avec une vue plus claire du plat.",
      },
      { status: 422 },
    );
  }
  return NextResponse.json({ description });
}
