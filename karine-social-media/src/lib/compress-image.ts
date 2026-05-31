// Compression côté client : downscale + JPEG quality.
// Évite l'erreur 413 (Vercel Serverless limite ~4.5 MB par requête).
// Defaults adaptés aux images de ChatGPT (2-5 MB → ~300 KB).
// Pour les forms qui envoient beaucoup d'images (ex. menus = 23 images),
// passer un preset plus agressif via opts.

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.85;

export type CompressOpts = {
  maxDim?: number;
  quality?: number;
  /** Taille minimale (en KB) en-dessous de laquelle on ne recompresse pas. */
  skipBelowKB?: number;
};

/**
 * Détecte un fichier HEIC/HEIF (format Apple iPhone) et le convertit en JPEG
 * côté client via la lib `heic2any`. Sinon retourne le fichier tel quel.
 * Import dynamique : la lib (~50 KB + wasm libheif) n'est chargée que si nécessaire.
 */
async function maybeConvertHeic(file: File): Promise<File> {
  const isHeic =
    /image\/(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!isHeic) return file;
  try {
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const outBlob: Blob = Array.isArray(result) ? result[0] : result;
    const newName = file.name.replace(/\.(heic|heif)$/i, '') + '.jpg';
    return new File([outBlob], newName, {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch (e) {
    console.warn('[heic2any] échec conversion HEIC, fichier original utilisé:', file.name, e);
    return file;
  }
}

export async function compressImage(file: File, opts: CompressOpts = {}): Promise<File> {
  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIMENSION;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const skipBelowKB = opts.skipBelowKB ?? 400;

  try {
    // 1. Conversion HEIC → JPEG si nécessaire (iPhone par défaut)
    file = await maybeConvertHeic(file);

    // 2. PNG/JPEG/WebP uniquement. Si autre, on laisse passer.
    if (!file.type.startsWith('image/')) return file;
    // 3. Déjà petit : pas la peine de recompresser.
    if (file.size < skipBelowKB * 1024) return file;

    const bitmap = await loadBitmap(file);
    const { width, height } = scaleDown(bitmap.width, bitmap.height, maxDim);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) return file;

    const newName = file.name.replace(/\.(png|jpe?g|webp|heic|heif)$/i, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch (e) {
    // Format non supporté (HEIC iPhone), image corrompue, etc.
    // → on retourne le fichier original au lieu de planter tout le batch.
    console.warn('[compressImage] échec compression, fichier original utilisé:', file.name, e);
    return file;
  }
}

/**
 * Compresse une liste de fichiers. Chaque erreur individuelle est isolée :
 * un fichier problématique n'empêche pas les autres d'être compressés.
 */
export async function compressMany(files: File[], opts: CompressOpts = {}): Promise<File[]> {
  return Promise.all(files.map((f) => compressImage(f, opts)));
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // fallback img element
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function scaleDown(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w > h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}
