'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2 } from 'lucide-react';
import {
  MEAL_URL_SLUG,
  defaultMealForHour,
} from '@/components/nutrition/CalorieCounterSheetV2';

/**
 * Bouton appareil-photo flottant CENTRÉ dans la BottomNav.
 * Plus gros que la barre (60x60), surélevé style FAB iOS/Material.
 *
 * Workflow :
 *   1. Click → ouverture native de l'appareil photo (input file capture)
 *   2. Photo prise → POST /api/nutrition/describe-meal (Vision Mistral)
 *   3. Determine la mealCategory selon l'heure courante
 *   4. Navigate vers /mes-calories/<slug>?desc=...&photo=...&from=<from>
 *   5. La sub-page preremplit l'invite "Ajouter un plat", lance auto-parse,
 *      affiche la preview à valider, et revient vers `from` apres validation.
 *
 * Pendant l'upload (2-5s typiquement), un overlay full-screen est
 * affiche pour eviter que l'utilisatrice clique ailleurs entre temps.
 */
export function CameraFAB({ homeMode = false }: { homeMode?: boolean } = {}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      // 1. Determine le repas cible selon l'heure
      const cat = defaultMealForHour(new Date());
      const slug = MEAL_URL_SLUG[cat];

      // 2. Upload + analyse Vision (peut prendre 2-5s)
      const fd = new FormData();
      fd.append('photo', file);
      const res = await fetch('/api/nutrition/describe-meal', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Analyse impossible');
        return;
      }

      // 3. Construit l'URL de destination avec preremplissage en query
      // string. L'URL de provenance est passee en `from` pour pouvoir
      // y revenir apres validation.
      const params = new URLSearchParams();
      if (typeof data.description === 'string' && data.description.trim()) {
        params.set('desc', data.description.trim().slice(0, 500));
      }
      if (typeof data.photoUrl === 'string' && data.photoUrl) {
        params.set('photo', data.photoUrl);
      }
      const fromPath = window.location.pathname + window.location.search;
      params.set('from', fromPath);

      router.push(`/mes-calories/${slug}?${params.toString()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur photo');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      {/* Bouton FAB centre dans la BottomNav.
          Couleurs INVERSEES vs version d'origine : icone coral sur
          fond blanc + anneau coral autour (auparavant icone blanche
          sur fond coral plein). Plus discret, mieux integre. */}
      <label
        className={`anim-pulse-soft group relative grid size-12 cursor-pointer place-items-center rounded-full bg-white text-coral ring-2 ring-coral shadow-md shadow-coral/30 transition hover:scale-105 active:scale-95 ${
          uploading ? 'cursor-wait opacity-80' : ''
        }`}
        // marginTop negatif UNIQUEMENT quand integre dans la BottomNav
        // (mode pages secondaires) pour depasser la barre. En homeMode
        // il n'y a pas de barre, donc pas de translate vers le haut.
        style={homeMode ? undefined : { marginTop: '-1rem' }}
        title="Photo d'un plat — ajout rapide au repas en cours"
        aria-label="Prendre une photo d'un plat à ajouter à mes calories"
      >
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
          className="sr-only"
        />
        {uploading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Camera className="size-6" strokeWidth={2.2} />
        )}
      </label>

      {/* Overlay full-screen pendant l'upload pour bloquer toute autre
          interaction et signaler que le serveur travaille (Vision +
          upload Storage). 2-5s typiquement. */}
      {uploading && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-12 animate-spin text-white" />
          <p className="mt-3 text-sm font-semibold text-white">
            Analyse de la photo…
          </p>
        </div>
      )}

      {/* Affichage erreur (rare, fallback). */}
      {error && (
        <div className="fixed inset-x-0 bottom-24 z-[101] mx-auto max-w-md px-4">
          <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 shadow-lg ring-1 ring-red-200">
            {error}
          </div>
        </div>
      )}
    </>
  );
}
