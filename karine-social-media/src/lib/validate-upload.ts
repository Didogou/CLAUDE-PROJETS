/**
 * Validation upload image AVANT décodage Sharp.
 *
 * Pourquoi : sans cap de taille AVANT le buffer, un attaquant peut
 * uploader un fichier 50 MB qui sature la RAM du serveur pendant que
 * Sharp essaie de le décoder (DoS). file.type est aussi spoofable :
 * un .svg renommé en .jpg avec Content-Type forgé peut passer la
 * vérification triviale "startsWith image/".
 *
 * Cette fonction :
 *  1. Borne la taille AVANT toute lecture
 *  2. Refuse explicitement image/svg+xml (XSS via <script> inline)
 *  3. Vérifie les magic bytes (JPEG/PNG/WebP/GIF/HEIC) — file.type
 *     n'est jamais source de vérité.
 */

export type AllowedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'image/heic';

export type UploadCheckResult =
  | { ok: true; buffer: Buffer; mime: AllowedMime }
  | { ok: false; status: number; error: string };

function detectMime(b: Buffer): AllowedMime | null {
  if (b.length < 12) return null;
  // JPEG : FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  // PNG : 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'image/png';
  // WebP : "RIFF....WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'image/webp';
  // GIF87a / GIF89a
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return 'image/gif';
  // HEIC : "ftyp" à l'offset 4
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)
    return 'image/heic';
  return null;
}

export async function checkImageUpload(
  file: unknown,
  opts: { maxBytes: number; allowedMimes?: AllowedMime[] },
): Promise<UploadCheckResult> {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, status: 400, error: 'Fichier requis' };
  }
  if (file.size > opts.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `Fichier trop volumineux (max ${Math.round(opts.maxBytes / 1_000_000)} MB)`,
    };
  }
  // SVG bannis explicitement (XSS via <script>, <foreignObject>, etc.).
  if (file.type === 'image/svg+xml' || file.type === 'text/xml') {
    return { ok: false, status: 415, error: 'SVG non autorisé' };
  }
  const arr = await file.arrayBuffer();
  const buffer = Buffer.from(arr);
  const detected = detectMime(buffer);
  if (!detected) {
    return {
      ok: false,
      status: 415,
      error: 'Format image non reconnu (JPEG/PNG/WebP/GIF/HEIC uniquement)',
    };
  }
  if (opts.allowedMimes && !opts.allowedMimes.includes(detected)) {
    return { ok: false, status: 415, error: `Format ${detected} non autorisé` };
  }
  return { ok: true, buffer, mime: detected };
}
