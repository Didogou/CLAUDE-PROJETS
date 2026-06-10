import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/nutrition/photo/[photoId]
 *
 * Retourne une signed URL (valide 1h) pour afficher une photo repas.
 * Le path Storage est implicitement {user.id}/{photoId}.jpg —
 * la RLS storage filtre par foldername[0] = auth.uid() donc seul
 * le propriétaire peut générer la signed URL.
 *
 * Si la photo n'existe pas OU n'appartient pas à l'utilisatrice → 404.
 *
 * Le client cache la signed URL pendant 50 min puis re-fetch
 * (expire à 1h, marge de sécurité 10 min).
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ photoId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const { photoId } = await ctx.params;
  if (!photoId || typeof photoId !== 'string') {
    return NextResponse.json({ error: 'photoId manquant' }, { status: 400 });
  }

  // Validation : photoId doit être un UUID v4 (format strict).
  // Empêche path traversal (../../../etc), injection, etc.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(photoId)) {
    return NextResponse.json({ error: 'photoId invalide' }, { status: 400 });
  }

  // Le path est construit côté server à partir de l'user authentifié
  // → impossible de spoof un user_id victime.
  const photoPath = `${user.id}/${photoId}.jpg`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).storage
      .from('nutrition-meal-photos')
      .createSignedUrl(photoPath, 3600); // 1 heure

    if (error || !data?.signedUrl) {
      // RLS storage bloque OU fichier inexistant → renvoie 404 dans
      // les 2 cas (pas d'information disclosure sur existence).
      return NextResponse.json(
        { error: 'Photo non trouvée' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      expiresIn: 3600,
    });
  } catch (e) {
    console.error('[photo] signed url failed:', e);
    return NextResponse.json(
      { error: 'Erreur interne' },
      { status: 500 },
    );
  }
}
