import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * DELETE /api/nutrition/log/by-photo
 * Body : { photoUrl: string }
 *
 * Supprime TOUTES les entries food_log_entries de l'abonnée
 * connectée qui partagent la même `photo_url` (= un batch créé
 * depuis une photo). Côté UI : on supprime "le repas" entier.
 *
 * Supprime AUSSI le fichier dans Supabase Storage si l'URL pointe
 * vers le bucket `nutrition-meal-photos`. Best-effort : si l'objet
 * Storage est déjà absent ou si l'extraction du path échoue, on
 * continue (la suppression DB a déjà eu lieu).
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
  const photoUrl = typeof body?.photoUrl === 'string' ? body.photoUrl.trim() : '';
  if (!photoUrl) {
    return NextResponse.json({ error: 'photoUrl requis' }, { status: 400 });
  }

  // Suppression DB : RLS garantit qu'elle ne supprime que ses propres
  // entries. On filtre aussi côté user_id par sécurité.
  const { error, count } = await (supabase as any)
    .from('food_log_entries')
    .delete({ count: 'exact' })
    .eq('user_id', user.id)
    .eq('photo_url', photoUrl);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort : supprime aussi le fichier Storage. Extrait le path
  // après `/storage/v1/object/public/nutrition-meal-photos/`.
  const marker = '/nutrition-meal-photos/';
  const idx = photoUrl.indexOf(marker);
  if (idx >= 0) {
    const storagePath = photoUrl.slice(idx + marker.length);
    try {
      await (supabase as any).storage
        .from('nutrition-meal-photos')
        .remove([storagePath]);
    } catch (e) {
      console.warn('[by-photo] storage remove failed:', e);
    }
  }

  return NextResponse.json({ deleted: count ?? 0 });
}
