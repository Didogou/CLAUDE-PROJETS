'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Coffee, UtensilsCrossed, Cookie, Soup, X } from 'lucide-react';

/**
 * Bouton "Ajouter un repas" + modale de selection du type de repas.
 *
 * Comportement :
 *  - Clic sur le bouton → ouvre la modale
 *  - La modale affiche 4 choix : Petit-dej / Dejeuner / Gouter / Diner
 *  - Le choix par defaut est determine par l'heure courante
 *  - Clic sur un choix → navigue vers /mes-calories/<slug>?focus=add
 *    (page de recherche d'ingredients pour ce repas)
 */

type MealCategory = 'breakfast' | 'lunch' | 'snack' | 'dinner';

const MEAL_OPTIONS: Array<{
  key: MealCategory;
  label: string;
  slug: string;
  icon: typeof Coffee;
  accent: string;
}> = [
  { key: 'breakfast', label: "P'tit dej", slug: 'petit-dej', icon: Coffee, accent: '#E8A33D' },
  { key: 'lunch', label: 'Déjeuner', slug: 'dejeuner', icon: UtensilsCrossed, accent: '#C76B4A' },
  { key: 'snack', label: 'Goûter', slug: 'gouter', icon: Cookie, accent: '#E879B5' },
  { key: 'dinner', label: 'Dîner', slug: 'diner', icon: Soup, accent: '#9CAE6B' },
];

/** Determine le type de repas par defaut selon l'heure courante.
 *  Meme regle que /mes-calories : < 11h petit-dej, < 14h dej, < 18h gouter, sinon diner. */
function defaultMealForNow(): MealCategory {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 18) return 'snack';
  return 'dinner';
}

export function AddMealButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const defaultMeal = defaultMealForNow();

  function selectMeal(slug: string) {
    setOpen(false);
    // `back=mes-repas` → la fleche back de la page d'ajout d'ingredient
    // ramene vers /mes-repas (au lieu de /mes-calories par defaut).
    // On garde "back" distinct de "from" (deja utilise par le FAB camera).
    router.push(`/mes-calories/${slug}?focus=add&back=mes-repas`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-coral px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-coral-dark active:scale-95"
      >
        <Plus className="size-5" strokeWidth={2.5} />
        Ajouter un repas
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 md:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Choisir le type de repas"
          onClick={() => setOpen(false)}
        >
          <div
            className="anim-slide-up w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl md:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-coral-soft/30 px-4 py-3">
              <h2 className="text-base font-bold text-coral-dark">
                Quel repas voulez-vous ajouter&nbsp;?
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="rounded-full p-1.5 hover:bg-coral-soft/30"
              >
                <X className="size-5 text-ink-soft" />
              </button>
            </header>
            <ul className="divide-y divide-coral-soft/20">
              {MEAL_OPTIONS.map((opt) => {
                const isDefault = opt.key === defaultMeal;
                const Icon = opt.icon;
                return (
                  <li key={opt.key}>
                    <button
                      type="button"
                      onClick={() => selectMeal(opt.slug)}
                      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-coral-soft/10 active:bg-coral-soft/20 ${
                        isDefault ? 'bg-coral-soft/15' : ''
                      }`}
                    >
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-full"
                        style={{ background: `${opt.accent}22`, color: opt.accent }}
                      >
                        <Icon className="size-5" strokeWidth={2.2} />
                      </span>
                      <span className="flex-1 text-sm font-semibold text-ink">
                        {opt.label}
                      </span>
                      {isDefault && (
                        <span className="rounded-full bg-coral px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-white">
                          Suggéré
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
              className="bg-white"
            />
          </div>
        </div>
      )}
    </>
  );
}
