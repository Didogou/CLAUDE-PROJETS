import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * DELETE /api/nutrition/log/by-photo
 * Body : { photoPath: string } (ou { photoUrl: string } pour compat legacy)
 *
 * Supprime TOUTES les entries food_log_entries de l'abonnée connectée
 * qui partagent la même photo. Supprime AUSSI le fichier Storage.
 *
 * SECURITE :
 *  - Filtre WHERE user_id = auth.uid() (RLS + filtre explicite)
 *  - Validation ownership : path DOIT commencer par `${user.id}/`
 *    avant tout DELETE (anti IDOR : un user ne peut pas spoofer le
 *    path d'une autre utilisatrice pour supprimer ses photos)
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  // Accept `photoPath` (nouveau) ou `photoUrl` (legacy URL complète)
  const raw =
    typeof body?.photoPath === 'string' && body.photoPath.trim()
      ? body.photoPath.trim()
      : typeof body?.photoUrl === 'string' && body.photoUrl.trim()
        ? body.photoUrl.trim()
        : '';
  if (!raw) {
    return NextResponse.json({ error: 'photoPath requis' }, { status: 400 });
  }

  // Extraire le path Storage (gère URL legacy ou signed URL avec
  // query string).
  const marker = '/nutrition-meal-photos/';
  const idx = raw.indexOf(marker);
  let photoPath = idx >= 0 ? raw.slice(idx + marker.length) : raw;
  // Retire la query string (signed URL = `?token=...`).
  const qIdx = photoPath.indexOf('?');
  if (qIdx >= 0) photoPath = photoPath.slice(0, qIdx);

  // SECURITE IDOR + path traversal : le path DOIT matcher exactement
  // `{user.id}/{uuid}.ext` (pas de `..`, pas de slash en plus).
  const PATH_RE = /^[0-9a-f-]+\/[0-9a-zA-Z-]+\.(?:jpg|jpeg|png|webp)$/i;
  if (!PATH_RE.test(photoPath) || !photoPath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  // 1. Supprime Storage en premier. Si ça échoue, on n'efface PAS la DB
  //    (sinon photo orpheline accessible si RLS storage est mal config).
  //    Note : on accepte aussi le cas "déjà absent" (idempotent).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storageRes = await (supabase as any).storage
    .from('nutrition-meal-photos')
    .remove([photoPath]);
  if (storageRes.error) {
    // Code 'NoSuchKey' ou 404 → déjà supprimée, on continue.
    const errMsg = storageRes.error.message ?? '';
    const isAlreadyGone = /not.*found|no.*such.*key|404/i.test(errMsg);
    if (!isAlreadyGone) {
      console.error('[by-photo] storage remove failed:', errMsg);
      return NextResponse.json(
        { error: `Suppression photo échouée : ${errMsg}` },
        { status: 500 },
      );
    }
  }

  // 2. Supprime DB (RLS + filtre explicite user_id pour défense en profondeur).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (supabase as any)
    .from('food_log_entries')
    .delete({ count: 'exact' })
    .eq('user_id', user.id)
    .eq('photo_url', photoPath);
  if (error) {
    // Photo supprimée mais DB rate → log pour cleanup manuel possible.
    console.error('[by-photo] DB delete failed after storage success:', {
      photoPath,
      userId: user.id,
      error: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: count ?? 0 });
}
