'use client';

import { Settings, Scale, PieChart } from 'lucide-react';
import { MyProfileSentence } from './MyProfileSentence';
import { WeightSection } from './WeightSection';
import { MacroBalanceSection } from './MacroBalanceSection';
import { WaterGoalSection } from './WaterGoalSection';

/**
 * Vue principale de la page "Mes Stats".
 *
 * Layout en 3 sections (du plus statique au plus dynamique) :
 *   1. Mes informations → phrase à la 1ʳᵉ personne, valeurs éditables (MyProfileSentence)
 *   2. Mon poids        → graphe avec ligne objectif (WeightSection)
 *   3. Équilibre alim.  → 3 anneaux G/L/P + score sur 7j / 30j / 90j
 *
 * Pas d'auth check ici (page server fait redirect si visiteur).
 */
export function MesStatsView() {
  return (
    <div className="space-y-5">
      {/* ============================== */}
      {/* 1. Mes informations            */}
      {/* ============================== */}
      <section className="rounded-2xl bg-white/90 p-4 shadow-[0_8px_24px_-10px_rgba(213,110,130,0.35)] ring-1 ring-coral-soft/30">
        <div className="mb-3 flex items-center gap-2">
          <Settings className="size-5 text-coral" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-coral-dark">
            Mes informations
          </h2>
        </div>
        {/* Phrase à la 1ère personne avec chaque valeur cliquable
            (drum picker au tap + auto-save). Remplace l'ancien
            bouton "Modifier" qui ouvrait une modale formulaire. */}
        <MyProfileSentence />
      </section>

      {/* ============================== */}
      {/* 2. Mon poids                    */}
      {/* ============================== */}
      <section className="rounded-2xl bg-white/90 p-4 shadow-[0_8px_24px_-10px_rgba(213,110,130,0.35)] ring-1 ring-coral-soft/30">
        <div className="mb-3 flex items-center gap-2">
          <Scale className="size-5 text-coral" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-coral-dark">
            Mon poids
          </h2>
        </div>
        <WeightSection />
      </section>

      {/* ============================== */}
      {/* 3. Équilibre alimentaire        */}
      {/* ============================== */}
      <section className="rounded-2xl bg-white/90 p-4 shadow-[0_8px_24px_-10px_rgba(213,110,130,0.35)] ring-1 ring-coral-soft/30">
        <div className="mb-3 flex items-center gap-2">
          <PieChart className="size-5 text-coral" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-coral-dark">
            Équilibre alimentaire
          </h2>
        </div>
        <MacroBalanceSection />
      </section>

      {/* ============================== */}
      {/* 4. Objectif Eau                */}
      {/* ============================== */}
      <WaterGoalSection />
    </div>
  );
}
