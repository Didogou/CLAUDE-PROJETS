'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Carrot, X } from 'lucide-react';
import type { CiqualFoodLite } from '@/lib/nutriscore-aggregate';
import type { RecipeIngredient } from '@/data/recipes';

/**
 * Lien "Détail nutritionnel" à côté de "Base de calcul" sous le badge
 * Nutri-Score utilisateur. Au clic, ouvre une modale qui montre :
 *
 *   - Une ligne (ou carte mobile) par ingrédient
 *   - Pour chaque : poids estimé · kcal · protéines · AGS · sucres · fibres · sel
 *   - Le Ciqual matché ("→ Œuf, cru")
 *   - Total agrégé en pied
 *   - Mention "Source : Ciqual ANSES" + disclaimer valeurs moyennes
 *
 * Même mécanique d'animation que NutriScoreInfoLink (slide haut→bas
 * à la fermeture, fade backdrop, createPortal pour éviter le bug
 * containing-block).
 */

// Densité moyenne pour convertir ml/cl → g si pas d'override.
const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1, gr: 1, gramme: 1, grammes: 1, kg: 1000,
  ml: 1, cl: 10, l: 1000,
  cs: 15, cc: 5,
  'c. à soupe': 15, 'c. à café': 5,
  'cuillère à soupe': 15, 'cuillère à café': 5,
  pincée: 0.5, pincee: 0.5,
  tasse: 200, bol: 250, verre: 200,
};

/**
 * Conversion (qty, unit, ciqual.avg_unit_weight_g) → grammes.
 *
 * Aligné sur le backend (src/lib/nutriscore-aggregate.ts) :
 *  - Unité de masse/volume connue → conversion directe
 *  - Pas d'unité MAIS Ciqual lié avec poids unitaire → qty × weight
 *    (la valeur vient de Mistral, persistée sur ciqual_foods)
 *  - Sinon → 0 (affiché "Poids inconnu" dans la modale)
 *
 * Plus de table hardcodée : la modale reflète exactement ce qui a
 * servi à calculer le score persisté en BDD.
 */
function unitToGrams(
  qty: number | null,
  unit: string | null,
  ciqualUnitWeight: number | null | undefined,
): number {
  if (typeof qty !== 'number' || qty <= 0) return 0;
  const u = (unit ?? '').trim().toLowerCase();
  if (u) {
    const factor = UNIT_TO_GRAMS[u];
    if (typeof factor === 'number') return qty * factor;
  }
  // Sentinel ~0.0001 = "1 unité n'a pas de sens pour cet aliment"
  // (huile, sel, farine…). Mistral a explicitement renvoyé null.
  if (typeof ciqualUnitWeight === 'number' && ciqualUnitWeight > 0.01) {
    return qty * ciqualUnitWeight;
  }
  return 0;
}

type Row = {
  label: string;
  ciqualName: string | null;
  grams: number;
  kcal: number;
  proteins: number;
  ags: number; // estimé à 30% des lipides
  sugars: number;
  fibers: number;
  saltG: number;
};

export function NutriScoreDetailLink({
  ingredients,
  ciqualByIdEntries,
}: {
  ingredients: RecipeIngredient[];
  ciqualByIdEntries: Array<[number, CiqualFoodLite]>;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 280);
  };

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

  // Construit le breakdown au moment d'ouvrir la modale (ou au mount —
  // pas coûteux : map.lookup O(1) × ~15 ingrédients).
  const { rows, totals } = useMemo(() => {
    const ciqualMap = new Map(ciqualByIdEntries);
    const out: Row[] = [];
    let tGrams = 0,
      tKcal = 0,
      tProteins = 0,
      tAgs = 0,
      tSugars = 0,
      tFibers = 0,
      tSalt = 0;
    for (const ing of ingredients) {
      const ciqual =
        typeof ing.ciqual_food_id === 'number'
          ? ciqualMap.get(ing.ciqual_food_id)
          : null;
      // On lit le poids unitaire (avg_unit_weight_g) directement sur
      // le Ciqual lié. Si absent ou sentinel "pas de sens", grams = 0
      // pour les ingrédients sans unit explicite — la modale affichera
      // "Poids inconnu" plutôt qu'une valeur bidon.
      const grams = unitToGrams(
        ing.quantity,
        ing.unit,
        ciqual?.avg_unit_weight_g ?? null,
      );
      const kcal = ciqual ? ((ciqual.kcal_per_100g ?? 0) * grams) / 100 : 0;
      const proteins = ciqual ? ((ciqual.proteins_g ?? 0) * grams) / 100 : 0;
      // Ciqual ne fournit pas les AGS — on prend 30% des lipides comme
      // dans le calcul du score (approximation usuelle).
      const lipids = ciqual ? ((ciqual.lipids_g ?? 0) * grams) / 100 : 0;
      const ags = lipids * 0.3;
      const sugars = ciqual ? ((ciqual.sugars_g ?? 0) * grams) / 100 : 0;
      const fibers = ciqual ? ((ciqual.fibers_g ?? 0) * grams) / 100 : 0;
      const saltG = ciqual ? ((ciqual.salt_g ?? 0) * grams) / 100 : 0;
      out.push({
        label: ing.label,
        ciqualName: ciqual?.name ?? null,
        grams,
        kcal,
        proteins,
        ags,
        sugars,
        fibers,
        saltG,
      });
      tGrams += grams;
      tKcal += kcal;
      tProteins += proteins;
      tAgs += ags;
      tSugars += sugars;
      tFibers += fibers;
      tSalt += saltG;
    }
    return {
      rows: out,
      totals: {
        grams: tGrams,
        kcal: tKcal,
        proteins: tProteins,
        ags: tAgs,
        sugars: tSugars,
        fibers: tFibers,
        salt: tSalt,
      },
    };
  }, [ingredients, ciqualByIdEntries]);

  const overlay = (
    <div
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Détail nutritionnel"
      className={`fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-300 sm:items-center sm:p-4 ${
        closing ? 'opacity-0' : 'opacity-100 animate-[fadeIn_220ms_ease-out]'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-cream shadow-2xl transition-all duration-[280ms] ease-[cubic-bezier(0.4,0,0.2,1)] sm:max-h-[85vh] sm:rounded-3xl ${
          closing
            ? 'translate-y-full opacity-0 sm:translate-y-4 sm:scale-95'
            : 'translate-y-0 opacity-100 animate-[slideUp_320ms_cubic-bezier(0.22,1,0.36,1)]'
        }`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-coral-soft/40 bg-cream/95 px-4 py-3 backdrop-blur-sm sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[0.55rem] font-bold uppercase tracking-[0.22em] text-coral">
              Composition
            </p>
            <h2 className="truncate font-script text-xl text-coral-dark sm:text-2xl">
              Détail nutritionnel
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

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {/* Vue mobile : carte par ingrédient. Vue PC (≥ sm) : tableau. */}
          <div className="space-y-3 sm:hidden">
            {rows.map((r, i) => (
              <article
                key={i}
                className="rounded-xl border border-coral-soft/40 bg-white p-3 shadow-sm"
              >
                <header className="mb-2">
                  <p className="text-sm font-semibold text-ink">{r.label}</p>
                  {r.ciqualName && (
                    <p className="text-[0.65rem] italic text-coral-dark/70">
                      → {r.ciqualName}
                    </p>
                  )}
                  {!r.ciqualName && (
                    <p className="text-[0.65rem] italic text-tangerine">
                      Non identifié dans Ciqual
                    </p>
                  )}
                </header>
                <dl className="grid grid-cols-3 gap-2 text-[0.7rem]">
                  <Cell
                    label="Poids"
                    value={r.grams > 0 ? `${Math.round(r.grams)} g` : '—'}
                  />
                  <Cell label="Énergie" value={`${Math.round(r.kcal)} kcal`} />
                  <Cell label="Protéines" value={`${r.proteins.toFixed(1)} g`} />
                  <Cell label="AGS" value={`${r.ags.toFixed(1)} g`} />
                  <Cell label="Sucres" value={`${r.sugars.toFixed(1)} g`} />
                  <Cell label="Fibres" value={`${r.fibers.toFixed(1)} g`} />
                  <Cell label="Sel" value={`${r.saltG.toFixed(2)} g`} />
                </dl>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-coral-soft/40 bg-white shadow-sm sm:block">
            <table className="w-full text-sm">
              <thead className="bg-coral-soft/15 text-coral-dark">
                <tr>
                  <th className="px-3 py-2 text-left text-[0.7rem] font-bold uppercase tracking-wider">
                    Ingrédient
                  </th>
                  <th className="px-3 py-2 text-right text-[0.7rem] font-bold">Poids</th>
                  <th className="px-3 py-2 text-right text-[0.7rem] font-bold">kcal</th>
                  <th className="px-3 py-2 text-right text-[0.7rem] font-bold">Prot.</th>
                  <th className="px-3 py-2 text-right text-[0.7rem] font-bold">AGS</th>
                  <th className="px-3 py-2 text-right text-[0.7rem] font-bold">Sucres</th>
                  <th className="px-3 py-2 text-right text-[0.7rem] font-bold">Fibres</th>
                  <th className="px-3 py-2 text-right text-[0.7rem] font-bold">Sel</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={i % 2 === 0 ? 'bg-white' : 'bg-coral-soft/5'}
                  >
                    <td className="px-3 py-2">
                      <p className="font-semibold text-ink">{r.label}</p>
                      {r.ciqualName ? (
                        <p className="text-[0.65rem] italic text-coral-dark/70">
                          → {r.ciqualName}
                        </p>
                      ) : (
                        <p className="text-[0.65rem] italic text-tangerine">
                          Non identifié
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.grams > 0 ? `${Math.round(r.grams)} g` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {Math.round(r.kcal)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.proteins.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.ags.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.sugars.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.fibers.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.saltG.toFixed(2)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-coral/40 bg-coral-soft/20 font-bold text-coral-dark">
                  <td className="px-3 py-2">Total plat ({Math.round(totals.grams)} g)</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {Math.round(totals.grams)} g
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {Math.round(totals.kcal)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {totals.proteins.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {totals.ags.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {totals.sugars.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {totals.fibers.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {totals.salt.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Total mobile (sous les cartes) */}
          <div className="mt-3 rounded-xl bg-coral-soft/20 p-3 sm:hidden">
            <p className="text-[0.6rem] font-bold uppercase tracking-wider text-coral-dark">
              Total du plat
            </p>
            <dl className="mt-1 grid grid-cols-3 gap-2 text-[0.7rem]">
              <Cell label="Poids" value={`${Math.round(totals.grams)} g`} />
              <Cell label="Énergie" value={`${Math.round(totals.kcal)} kcal`} />
              <Cell label="Protéines" value={`${totals.proteins.toFixed(1)} g`} />
              <Cell label="AGS" value={`${totals.ags.toFixed(1)} g`} />
              <Cell label="Sucres" value={`${totals.sugars.toFixed(1)} g`} />
              <Cell label="Fibres" value={`${totals.fibers.toFixed(1)} g`} />
              <Cell label="Sel" value={`${totals.salt.toFixed(2)} g`} />
            </dl>
          </div>

          <p className="mt-4 text-[0.65rem] italic text-ink-soft">
            Source des valeurs : <strong>Ciqual ANSES</strong>{' '}
            (table de composition nutritionnelle officielle française).
            Valeurs moyennes par 100&nbsp;g d&apos;aliment. Peuvent varier selon la marque,
            la saison ou le mode de préparation. AGS estimés à 30 % des lipides totaux.
          </p>
        </div>
      </div>

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
        <Carrot className="h-3 w-3" />
        Détail nutritionnel
      </button>
      {open && mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-coral-soft/15 px-2 py-1.5 text-center">
      <p className="text-[0.55rem] font-bold uppercase tracking-wider text-coral-dark/80">
        {label}
      </p>
      <p className="font-mono text-[0.75rem] font-bold text-ink">{value}</p>
    </div>
  );
}
