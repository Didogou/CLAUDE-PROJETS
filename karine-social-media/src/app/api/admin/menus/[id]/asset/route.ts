import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { optimizeUploadToWebp } from '@/lib/optimize-upload';

const BUCKET = 'content-images';

type AssetType = 'cover' | 'shopping' | 'day_cover' | 'day_lunch' | 'day_dinner' | 'day_prep';

const ALLOWED: AssetType[] = [
  'cover',
  'shopping',
  'day_cover',
  'day_lunch',
  'day_dinner',
  'day_prep',
];

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const form = await request.formData();
    const type = String(form.get('type') || '') as AssetType;
    const dayIndexRaw = form.get('dayIndex');
    const file = form.get('file') as File | null;

    if (!ALLOWED.includes(type))
      return NextResponse.json({ error: 'Type d’asset invalide' }, { status: 400 });
    if (!file || file.size === 0)
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });

    const needsDay =
      type === 'day_cover' ||
      type === 'day_lunch' ||
      type === 'day_dinner' ||
      type === 'day_prep';
    const dayIndex = dayIndexRaw == null ? null : Number(dayIndexRaw);
    if (needsDay && (dayIndex == null || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6))
      return NextResponse.json({ error: 'dayIndex requis (0-6) pour ce type' }, { status: 400 });

    const supabase = createServiceClient();

    // Compression OBLIGATOIRE avant upload (regle Karine, cf. memoire
    // feedback-always-compress-images). WebP 1920px max q85 → gain
    // ~80-95% sur le poids vs JPEG brut, qualité visuelle équivalente.
    const optimized = await optimizeUploadToWebp(file);

    // Construire le nom de fichier et la cible
    const ext = optimized.ext;
    let storagePath = '';
    let column = '';
    let table = '';
    let matchCondition: { field: string; value: string | number }[] = [];

    if (type === 'cover') {
      storagePath = `menus/${id}/cover-${Date.now().toString(36)}.${ext}`;
      column = 'cover_image_url';
      table = 'weekly_menus';
      matchCondition = [{ field: 'id', value: id }];
    } else if (type === 'shopping') {
      storagePath = `menus/${id}/shopping-${Date.now().toString(36)}.${ext}`;
      column = 'shopping_list_image_url';
      table = 'weekly_menus';
      matchCondition = [{ field: 'id', value: id }];
    } else if (type === 'day_cover') {
      storagePath = `menus/${id}/day-${dayIndex}-cover-${Date.now().toString(36)}.${ext}`;
      column = 'cover_image_url';
      table = 'weekly_menu_days';
      matchCondition = [
        { field: 'menu_id', value: id },
        { field: 'day_index', value: dayIndex as number },
      ];
    } else if (type === 'day_lunch') {
      storagePath = `menus/${id}/day-${dayIndex}-lunch-${Date.now().toString(36)}.${ext}`;
      column = 'lunch_image_url';
      table = 'weekly_menu_days';
      matchCondition = [
        { field: 'menu_id', value: id },
        { field: 'day_index', value: dayIndex as number },
      ];
    } else if (type === 'day_dinner') {
      storagePath = `menus/${id}/day-${dayIndex}-dinner-${Date.now().toString(36)}.${ext}`;
      column = 'dinner_image_url';
      table = 'weekly_menu_days';
      matchCondition = [
        { field: 'menu_id', value: id },
        { field: 'day_index', value: dayIndex as number },
      ];
    } else if (type === 'day_prep') {
      // Pellicule : on accumule dans le tableau prep_photos
      storagePath = `menus/${id}/day-${dayIndex}-prep-${Date.now().toString(36)}.${ext}`;
      column = 'prep_photos';
      table = 'weekly_menu_days';
      matchCondition = [
        { field: 'menu_id', value: id },
        { field: 'day_index', value: dayIndex as number },
      ];
    }

    // Upload Storage (buffer compressé en WebP)
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, optimized.buffer, {
        upsert: true,
        contentType: optimized.contentType,
      });
    if (upErr) throw upErr;
    const url = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;

    // Update colonne : pour prep_photos (array), on append. Sinon, on remplace.
    if (column === 'prep_photos') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let readQ = (supabase.from(table as any) as any).select('prep_photos');
      for (const c of matchCondition) readQ = readQ.eq(c.field, c.value);
      const { data: current, error: rdErr } = await readQ.maybeSingle();
      if (rdErr) throw rdErr;
      const prev: string[] = (current?.prep_photos as string[]) ?? [];
      const nextPhotos = [...prev, url];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let upQ = (supabase.from(table as any) as any).update({ prep_photos: nextPhotos });
      for (const c of matchCondition) upQ = upQ.eq(c.field, c.value);
      const { error: updErr } = await upQ;
      if (updErr) throw updErr;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase.from(table as any) as any).update({ [column]: url });
      for (const c of matchCondition) {
        query = query.eq(c.field, c.value);
      }
      const { error: updErr } = await query;
      if (updErr) throw updErr;
    }

    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE — supprime une image existante (set la colonne à null OU retire
 * une URL du tableau prep_photos). Le fichier dans Storage est aussi supprimé
 * en best-effort.
 * Body JSON : { type, dayIndex?, photoUrl? }
 *   - Pour types uniques (cover/shopping/day_cover/day_lunch/day_dinner) :
 *     la colonne est mise à null.
 *   - Pour day_prep : retire `photoUrl` du tableau prep_photos.
 */
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const type = String(body?.type || '') as AssetType;
    const dayIndex = body?.dayIndex == null ? null : Number(body.dayIndex);
    const photoUrl = String(body?.photoUrl || '') || null;

    if (!ALLOWED.includes(type))
      return NextResponse.json({ error: 'Type d’asset invalide' }, { status: 400 });

    const needsDay =
      type === 'day_cover' ||
      type === 'day_lunch' ||
      type === 'day_dinner' ||
      type === 'day_prep';
    if (needsDay && (dayIndex == null || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6))
      return NextResponse.json({ error: 'dayIndex requis (0-6) pour ce type' }, { status: 400 });

    const supabase = createServiceClient();

    let table = '';
    let column = '';
    let matchCondition: { field: string; value: string | number }[] = [];

    if (type === 'cover') {
      column = 'cover_image_url';
      table = 'weekly_menus';
      matchCondition = [{ field: 'id', value: id }];
    } else if (type === 'shopping') {
      column = 'shopping_list_image_url';
      table = 'weekly_menus';
      matchCondition = [{ field: 'id', value: id }];
    } else if (type === 'day_cover') {
      column = 'cover_image_url';
      table = 'weekly_menu_days';
      matchCondition = [
        { field: 'menu_id', value: id },
        { field: 'day_index', value: dayIndex as number },
      ];
    } else if (type === 'day_lunch') {
      column = 'lunch_image_url';
      table = 'weekly_menu_days';
      matchCondition = [
        { field: 'menu_id', value: id },
        { field: 'day_index', value: dayIndex as number },
      ];
    } else if (type === 'day_dinner') {
      column = 'dinner_image_url';
      table = 'weekly_menu_days';
      matchCondition = [
        { field: 'menu_id', value: id },
        { field: 'day_index', value: dayIndex as number },
      ];
    } else if (type === 'day_prep') {
      column = 'prep_photos';
      table = 'weekly_menu_days';
      matchCondition = [
        { field: 'menu_id', value: id },
        { field: 'day_index', value: dayIndex as number },
      ];
    }

    // Pour day_prep : on retire l'URL spécifique du tableau
    if (column === 'prep_photos') {
      if (!photoUrl)
        return NextResponse.json({ error: 'photoUrl requise pour day_prep' }, { status: 400 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let readQ = (supabase.from(table as any) as any).select('prep_photos');
      for (const c of matchCondition) readQ = readQ.eq(c.field, c.value);
      const { data: current, error: rdErr } = await readQ.maybeSingle();
      if (rdErr) throw rdErr;
      const prev: string[] = (current?.prep_photos as string[]) ?? [];
      const nextPhotos = prev.filter((u) => u !== photoUrl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let upQ = (supabase.from(table as any) as any).update({ prep_photos: nextPhotos });
      for (const c of matchCondition) upQ = upQ.eq(c.field, c.value);
      const { error: updErr } = await upQ;
      if (updErr) throw updErr;
      // Best-effort suppression Storage
      const path = extractStoragePath(photoUrl);
      if (path) await supabase.storage.from(BUCKET).remove([path]);
    } else {
      // Types uniques : on lit l'URL actuelle pour supprimer le fichier,
      // puis on met la colonne à null.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let readQ = (supabase.from(table as any) as any).select(column);
      for (const c of matchCondition) readQ = readQ.eq(c.field, c.value);
      const { data: current, error: rdErr } = await readQ.maybeSingle();
      if (rdErr) throw rdErr;
      const oldUrl = (current as Record<string, string | null> | null)?.[column] as string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let upQ = (supabase.from(table as any) as any).update({ [column]: null });
      for (const c of matchCondition) upQ = upQ.eq(c.field, c.value);
      const { error: updErr } = await upQ;
      if (updErr) throw updErr;
      if (oldUrl) {
        const path = extractStoragePath(oldUrl);
        if (path) await supabase.storage.from(BUCKET).remove([path]);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin/menus DELETE asset] error:', e);
    const message = 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Extrait le chemin Storage d'une URL publique Supabase.
 * Format URL : https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
 */
function extractStoragePath(url: string): string | null {
  try {
    const u = new URL(url);
    const idx = u.pathname.indexOf(`/${BUCKET}/`);
    if (idx === -1) return null;
    return u.pathname.slice(idx + BUCKET.length + 2);
  } catch {
    return null;
  }
}
