import { Camera } from 'lucide-react';

/**
 * Petit badge "Réel" sur la vignette d'une recette quand Karine a publié
 * des photos de préparation (prepPhotos.length > 0).
 */
export function RealBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-coral/95 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-white shadow-sm">
      <Camera className="h-3 w-3" strokeWidth={2.5} />
      Réel
    </span>
  );
}
