'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { NutriScoreRulesPanel } from '@/components/admin/NutriScoreRulesPanel';

/**
 * Lien discret "Base de calcul" sous le badge Nutri-Score utilisateur.
 *
 * Au clic, ouvre une modale qui affiche les règles officielles (tables
 * de points + seuils A-E), en mode `forUser` (sans mini éditeur, sans
 * outils de vérification externes).
 *
 * ⚠️ Cause racine fix 2026-06-08 : la modale était auparavant rendue
 * en tant qu'enfant DOM de RecipeNutriScorePanel, qui lui-même portait
 * `backdrop-blur-sm`. Par spec CSS, `backdrop-filter` (et `filter`,
 * `transform`, etc.) crée un *containing block* pour les descendants
 * `position: fixed`. Résultat : `fixed inset-0` n'était pas relatif au
 * viewport mais à la petite carte du panneau Nutri-Score → la modale
 * apparaissait minuscule en bas, tronquée.
 *
 * Fix : on porte la modale dans `<body>` via `createPortal`. Idem
 * pattern que MainDrawer / LockedTileModal qui ont déjà ce problème
 * documenté dans leur code.
 *
 * UX :
 *   - Mobile : bottom-sheet plein écran (rounded-t-3xl) avec header
 *     sticky et zone de contenu scrollable.
 *   - Desktop : modal centrée max-w-2xl, scrollable interne.
 *   - Backdrop semi-opaque, click pour fermer, Esc pour fermer.
 */
export function NutriScoreInfoLink() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portail créé seulement côté client (pas de document côté SSR).
  useEffect(() => {
    setMounted(true);
  }, []);

  // Déclenche l'animation de fermeture (slide top → bottom), puis
  // unmount après la durée de transition.
  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 280);
  };

  // Esc pour fermer + lock du scroll body tant que la modale est ouverte.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const overlay = (
    <div
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Base de calcul du Nutri-Score"
      // z-[200] pour passer au-dessus de TOUT (AppHeader z-40, drawers
      // z-[100]). Backdrop : fade-in/fade-out animé.
      className={`fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-300 sm:items-center sm:p-4 ${
        closing ? 'opacity-0' : 'opacity-100 animate-[fadeIn_220ms_ease-out]'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        // Slide haut → bas à la fermeture (mobile bottom-sheet).
        // Sur desktop, on adoucit avec un scale-down + opacity.
        // Au mount : slide bottom → haut (entrée).
        className={`flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-cream shadow-2xl transition-all duration-[280ms] ease-[cubic-bezier(0.4,0,0.2,1)] sm:max-h-[85vh] sm:rounded-3xl ${
          closing
            ? 'translate-y-full opacity-0 sm:translate-y-4 sm:scale-95'
            : 'translate-y-0 opacity-100 animate-[slideUp_320ms_cubic-bezier(0.22,1,0.36,1)]'
        }`}
      >
        {/* Header sticky : titre + bouton fermer. Reste visible quand
            l'utilisatrice scrolle dans les tables de points. */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-coral-soft/40 bg-cream/95 px-4 py-3 backdrop-blur-sm sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[0.55rem] font-bold uppercase tracking-[0.22em] text-coral">
              Info
            </p>
            <h2 className="truncate font-script text-xl text-coral-dark sm:text-2xl">
              Base de calcul du Nutri-Score
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fermer"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral-soft/30 text-coral-dark transition hover:bg-coral-soft/60"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Contenu scrollable. overflow-y-auto pour que le scroll soit
            INTERNE à la modale (le body restant locké). */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          <NutriScoreRulesPanel forUser />
        </div>
      </div>
      {/* Keyframes locales pour l'entrée. Pas dans tailwind.config car
          usage très local. */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-coral-dark/80 underline-offset-2 transition hover:text-coral-dark hover:underline"
      >
        <Info className="h-3 w-3" />
        Base de calcul
      </button>

      {/* Portal vers <body> pour échapper au `backdrop-filter` parent
          (RecipeNutriScorePanel + AppHeader). Cf. commentaire en tête. */}
      {open && mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}
