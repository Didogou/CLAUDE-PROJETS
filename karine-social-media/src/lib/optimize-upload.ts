import 'server-only';
import sharp from 'sharp';

/**
 * Convertit une image uploadée par l'admin en WebP optimisé avant Supabase Storage.
 *
 *  - Qualité 85 (visuellement quasi-identique à l'original, gain de poids ~80-95%)
 *  - Resize à 1920×1920 max (fit inside, sans agrandissement) pour les photos
 *  - Resize à 512×512 max pour les icônes (variant)
 *  - Conserve la transparence si présente
 *
 * Usage côté route admin (formData) :
 *   const file = form.get('cover') as File;
 *   const { buffer, ext, contentType } = await optimizeUploadToWebp(file);
 *   await supabase.storage.from(BUCKET).upload(path + '.' + ext, buffer, { contentType });
 */
export type OptimizedUpload = {
  buffer: Buffer;
  ext: 'webp';
  contentType: 'image/webp';
  originalBytes: number;
  optimizedBytes: number;
};

export async function optimizeUploadToWebp(
  file: File,
  opts?: {
    /** Variant icône (max 512px) au lieu de photo (max 1920px). */
    icon?: boolean;
    /** Qualité WebP, défaut 85. */
    quality?: number;
  },
): Promise<OptimizedUpload> {
  const max = opts?.icon ? 512 : 1920;
  const quality = opts?.quality ?? 85;

  const originalBytes = file.size;
  const input = Buffer.from(await file.arrayBuffer());

  const pipeline = sharp(input, { failOn: 'truncated' })
    .rotate() // auto-orient via EXIF
    .resize({
      width: max,
      height: max,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality, effort: 4 });

  const buffer = await pipeline.toBuffer();

  return {
    buffer,
    ext: 'webp',
    contentType: 'image/webp',
    originalBytes,
    optimizedBytes: buffer.length,
  };
}
